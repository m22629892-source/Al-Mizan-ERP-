import { Router, Response } from 'express';
import Decimal from 'decimal.js';
import { db } from '../db.js';
import { AuthenticatedRequest, requireAuth, requirePermission, isBranchAllowed, isWarehouseAllowed } from '../api.js';
import { postJournalEntry, getFiscalPeriodForDate, getNextDocumentNumber, logAudit } from '../accounting-engine.js';
import { InventoryCount } from '../../types.js';

export const inventoryCountsRouter = Router();

/**
 * GET /: List all physical inventory count sessions
 */
inventoryCountsRouter.get('/', requireAuth, requirePermission('inventory_count.view', 'inventory.count', 'inventory.view'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const counts = db.prepare(`
      SELECT ic.*, b.name_ar as branch_name, w.name_ar as warehouse_name, u.display_name as creator_name,
             je.entry_number as journal_number
      FROM inventory_counts ic
      JOIN branches b ON ic.branch_id = b.id
      JOIN warehouses w ON ic.warehouse_id = w.id
      JOIN users u ON ic.created_by = u.id
      LEFT JOIN journal_entries je ON ic.journal_entry_id = je.id
      ORDER BY ic.count_date DESC, ic.created_at DESC
    `).all() as any[];

    const scopedCounts = counts.filter(c => isBranchAllowed(req.user, c.branch_id) && isWarehouseAllowed(req.user, c.warehouse_id));

    res.json({ success: true, counts: scopedCounts });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /:id: Get full details of a physical inventory count with items
 */
inventoryCountsRouter.get('/:id', requireAuth, requirePermission('inventory_count.view', 'inventory.count', 'inventory.view'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const count = db.prepare(`
      SELECT ic.*, b.name_ar as branch_name, w.name_ar as warehouse_name, u.display_name as creator_name,
             je.entry_number as journal_number
      FROM inventory_counts ic
      JOIN branches b ON ic.branch_id = b.id
      JOIN warehouses w ON ic.warehouse_id = w.id
      JOIN users u ON ic.created_by = u.id
      LEFT JOIN journal_entries je ON ic.journal_entry_id = je.id
      WHERE ic.id = ?
    `).get(req.params.id) as any;

    if (!count) {
      return res.status(404).json({ error: 'محضر الجرد الفعلي غير موجود.' });
    }

    if (!isBranchAllowed(req.user, count.branch_id) || !isWarehouseAllowed(req.user, count.warehouse_id)) {
      return res.status(403).json({ error: 'محضر الجرد خارج نطاق صلاحياتك.' });
    }

    const items = db.prepare(`
      SELECT ici.*, i.code as item_code, i.name_ar as item_name, i.category, i.base_unit
      FROM inventory_count_items ici
      JOIN items i ON ici.item_id = i.id
      WHERE ici.count_id = ?
      ORDER BY i.name_ar ASC
    `).all(req.params.id) as any[];

    res.json({ success: true, count, items });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /: Create a new physical inventory count session (in Draft)
 */
inventoryCountsRouter.post('/', requireAuth, requirePermission('inventory.count'), (req: AuthenticatedRequest, res: Response) => {
  const { branchId, warehouseId, countDate, notes, items: customItems } = req.body;

  if (!branchId || !warehouseId) {
    return res.status(400).json({ error: 'يرجى تحديد الفرع والمستودع المراد جرده.' });
  }

  if (!isBranchAllowed(req.user, branchId)) {
    return res.status(403).json({ error: 'الفرع المحدد خارج نطاق صلاحياتك.' });
  }

  if (!isWarehouseAllowed(req.user, warehouseId)) {
    return res.status(403).json({ error: 'المستودع المحدد خارج نطاق صلاحياتك.' });
  }

  const effectiveDate = countDate || new Date().toISOString().split('T')[0];
  const period = getFiscalPeriodForDate(effectiveDate);

  if (period.is_closed === 1) {
    return res.status(400).json({ error: 'الفترة المالية لتاريخ الجرد مقفلة، ولا يمكن إنشاء محضر جرد بها.' });
  }

  try {
    const countId = `invcnt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const countNumber = getNextDocumentNumber('STK-CNT', branchId, period.fiscal_year_id);

    db.transaction(() => {
      // 1. Snapshot all stockable items and their current book quantity and unit cost
      const stockItems = db.prepare(`
        SELECT i.id, i.name_ar, i.code, i.moving_avg_cost,
               COALESCE(ws.quantity, 0) as system_quantity
        FROM items i
        LEFT JOIN warehouse_stock ws ON i.id = ws.item_id AND ws.warehouse_id = ?
        WHERE i.item_type = 'stock' AND i.is_active = 1
        ORDER BY i.name_ar ASC
      `).all(warehouseId) as any[];

      db.prepare(`
        INSERT INTO inventory_counts (
          id, count_number, branch_id, warehouse_id, count_date, status, notes,
          total_shortage_cost, total_surplus_cost, net_variance_cost, created_by
        ) VALUES (?, ?, ?, ?, ?, 'draft', ?, 0, 0, 0, ?)
      `).run(countId, countNumber, branchId, warehouseId, effectiveDate, notes || null, req.user!.id);

      const insLine = db.prepare(`
        INSERT INTO inventory_count_items (
          id, count_id, item_id, system_quantity, counted_quantity, diff_quantity, unit_cost, total_diff_cost, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of stockItems) {
        const lineId = `ici_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        // Check if custom counted qty provided
        const custom = customItems?.find((c: any) => c.itemId === item.id);
        const countedQty = custom ? Number(custom.countedQuantity) : item.system_quantity;
        const diffQty = countedQty - item.system_quantity;
        const unitCost = item.moving_avg_cost || 0;
        const totalDiffCost = diffQty * unitCost;

        insLine.run(lineId, countId, item.id, item.system_quantity, countedQty, diffQty, unitCost, totalDiffCost, custom?.notes || null);
      }
    })();

    logAudit(req.user!.id, 'CREATE_INVENTORY_COUNT', 'inventory_counts', countId, `إنشاء مسودة محضر جرد فعلي رقم ${countNumber}`);

    res.json({
      success: true,
      message: `تم إنشاء مسودة محضر الجرد برقم ${countNumber} بنجاح.`,
      countId,
      countNumber
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /:id: Update counted quantities on draft
 */
inventoryCountsRouter.put('/:id', requireAuth, requirePermission('inventory.count'), (req: AuthenticatedRequest, res: Response) => {
  const { items, notes } = req.body;

  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: 'بيانات بنود الجرد غير صحيحة.' });
  }

  const count = db.prepare('SELECT * FROM inventory_counts WHERE id = ?').get(req.params.id) as any;
  if (!count) return res.status(404).json({ error: 'محضر الجرد غير موجود.' });
  if (count.status === 'posted') return res.status(400).json({ error: 'لا يمكن تعديل محضر جرد تم اعتماده وترحيله.' });
  if (!isBranchAllowed(req.user, count.branch_id) || !isWarehouseAllowed(req.user, count.warehouse_id)) {
    return res.status(403).json({ error: 'محضر الجرد خارج نطاق صلاحياتك.' });
  }

  try {
    db.transaction(() => {
      let totalShortage = new Decimal(0);
      let totalSurplus = new Decimal(0);

      const updateLine = db.prepare(`
        UPDATE inventory_count_items
        SET counted_quantity = ?, diff_quantity = ?, total_diff_cost = ?, notes = ?
        WHERE count_id = ? AND item_id = ?
      `);

      for (const it of items) {
        const counted = Number(it.countedQuantity || 0);
        const currentLine = db.prepare('SELECT system_quantity, unit_cost FROM inventory_count_items WHERE count_id = ? AND item_id = ?').get(req.params.id, it.itemId) as any;
        if (currentLine) {
          const diff = counted - currentLine.system_quantity;
          const totalDiff = diff * currentLine.unit_cost;

          if (diff < 0) {
            totalShortage = totalShortage.plus(Math.abs(totalDiff));
          } else if (diff > 0) {
            totalSurplus = totalSurplus.plus(totalDiff);
          }

          updateLine.run(counted, diff, totalDiff, it.notes || null, req.params.id, it.itemId);
        }
      }

      const netVariance = totalSurplus.minus(totalShortage);
      db.prepare(`
        UPDATE inventory_counts
        SET notes = COALESCE(?, notes), total_shortage_cost = ?, total_surplus_cost = ?, net_variance_cost = ?
        WHERE id = ?
      `).run(notes || null, totalShortage.toNumber(), totalSurplus.toNumber(), netVariance.toNumber(), req.params.id);
    })();

    res.json({ success: true, message: 'تم حفظ تعديلات محضر الجرد بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /:id: Delete draft count
 */
inventoryCountsRouter.delete('/:id', requireAuth, requirePermission('inventory.count'), (req: AuthenticatedRequest, res: Response) => {
  const count = db.prepare('SELECT * FROM inventory_counts WHERE id = ?').get(req.params.id) as any;
  if (!count) return res.status(404).json({ error: 'محضر الجرد غير موجود.' });
  if (count.status === 'posted') return res.status(400).json({ error: 'ممنوع حذف محضر جرد معتمد ومرحل.' });
  if (!isBranchAllowed(req.user, count.branch_id) || !isWarehouseAllowed(req.user, count.warehouse_id)) {
    return res.status(403).json({ error: 'محضر الجرد خارج نطاق صلاحياتك.' });
  }

  try {
    db.transaction(() => {
      db.prepare('DELETE FROM inventory_count_items WHERE count_id = ?').run(req.params.id);
      db.prepare('DELETE FROM inventory_counts WHERE id = ?').run(req.params.id);
    })();

    logAudit(req.user!.id, 'DELETE_INVENTORY_COUNT', 'inventory_counts', req.params.id, `حذف مسودة محضر الجرد رقم ${count.count_number}`);
    res.json({ success: true, message: 'تم حذف مسودة محضر الجرد بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /:id/post: Approve & Post Inventory Count (Creates Atomic Adjustment Transaction + Balanced Journal Entry)
 */
inventoryCountsRouter.post('/:id/post', requireAuth, requirePermission('inventory.count'), (req: AuthenticatedRequest, res: Response) => {
  const count = db.prepare('SELECT * FROM inventory_counts WHERE id = ?').get(req.params.id) as any;
  if (!count) return res.status(404).json({ error: 'محضر الجرد غير موجود.' });
  if (count.status === 'posted') return res.status(400).json({ error: 'تم ترحيل واعتماد هذا الجرد مسبقاً لمنع التكرار.' });
  if (!isBranchAllowed(req.user, count.branch_id) || !isWarehouseAllowed(req.user, count.warehouse_id)) {
    return res.status(403).json({ error: 'محضر الجرد خارج نطاق صلاحياتك.' });
  }

  const period = getFiscalPeriodForDate(count.count_date);
  if (period.is_closed === 1) {
    return res.status(400).json({ error: 'الفترة المالية للجرد مقفلة، ولا يمكن الترحيل بها.' });
  }

  try {
    let jeResult: any = null;

    db.transaction(() => {
      const items = db.prepare(`
        SELECT ici.*, i.name_ar as item_name
        FROM inventory_count_items ici
        JOIN items i ON ici.item_id = i.id
        WHERE ici.count_id = ?
      `).all(req.params.id) as any[];

      let totalShortage = new Decimal(0);
      let totalSurplus = new Decimal(0);
      const itemsWithDiff: any[] = [];

      for (const it of items) {
        const diff = new Decimal(it.diff_quantity || 0);
        const cost = new Decimal(it.unit_cost || 0);
        if (!diff.isZero()) {
          const val = diff.times(cost);
          if (diff.isNegative()) {
            totalShortage = totalShortage.plus(val.abs());
          } else {
            totalSurplus = totalSurplus.plus(val);
          }
          itemsWithDiff.push(it);
        }
      }

      const invGlAccount = count.branch_id === 'br_alex' ? 'acc_1142' : 'acc_1141';
      const lines: any[] = [];

      // Shortage Entry Line
      if (totalShortage.greaterThan(0)) {
        lines.push({
          accountId: 'acc_5211', // عجز وتسويات المخزون السلعي والهالك
          debit: totalShortage.toNumber(),
          credit: 0,
          description: `عجز تسوية جرد فعلي محضر ${count.count_number}`
        });
        lines.push({
          accountId: invGlAccount, // بضاعة بالمخازن
          debit: 0,
          credit: totalShortage.toNumber(),
          description: `تسوية عجز المخزون محضر ${count.count_number}`
        });
      }

      // Surplus Entry Line
      if (totalSurplus.greaterThan(0)) {
        lines.push({
          accountId: invGlAccount, // بضاعة بالمخازن
          debit: totalSurplus.toNumber(),
          credit: 0,
          description: `إثبات زيادة الجرد الفعلي محضر ${count.count_number}`
        });
        lines.push({
          accountId: 'acc_4511', // إيرادات متنوعة وأرباح تسوية المخزون
          debit: 0,
          credit: totalSurplus.toNumber(),
          description: `أرباح تسوية زيادة المخزون محضر ${count.count_number}`
        });
      }

      // If there are financial variances, post balanced Journal Entry
      if (lines.length > 0) {
        jeResult = postJournalEntry({
          docType: 'STK_ADJ',
          docId: count.id,
          docNumber: count.count_number,
          entryDate: count.count_date,
          postingDate: count.count_date,
          branchId: count.branch_id,
          fiscalPeriodId: period.id,
          description: `قيد تسوية فروق الجرد الفعلي محضر رقم ${count.count_number}`,
          createdBy: req.user!.id,
          lines
        });
      }

      // Create Stock Adjustment Transaction Record
      const transId = `stk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const transNumber = getNextDocumentNumber('STK-ADJ', count.branch_id, period.fiscal_year_id);
      db.prepare(`
        INSERT INTO stock_transactions (
          id, trans_number, trans_type, branch_id, from_warehouse_id, to_warehouse_id,
          trans_date, notes, journal_entry_id, status, created_by
        ) VALUES (?, ?, 'adjustment', ?, ?, ?, ?, ?, ?, 'posted', ?)
      `).run(
        transId,
        transNumber,
        count.branch_id,
        count.warehouse_id,
        count.warehouse_id,
        count.count_date,
        `تسوية جرد فعلي محضر ${count.count_number}`,
        jeResult ? jeResult.entryId : null,
        req.user!.id
      );

      // Update physical inventory in warehouse_stock
      for (const it of itemsWithDiff) {
        db.prepare(`
          UPDATE warehouse_stock
          SET quantity = ?
          WHERE warehouse_id = ? AND item_id = ?
        `).run(it.counted_quantity, count.warehouse_id, it.item_id);

        db.prepare(`
          INSERT INTO stock_transaction_items (
            id, transaction_id, item_id, quantity, unit_cost, total_cost
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          `sti_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          transId,
          it.item_id,
          it.diff_quantity,
          it.unit_cost,
          it.total_diff_cost
        );
      }

      // Mark count as posted
      db.prepare(`
        UPDATE inventory_counts
        SET status = 'posted', journal_entry_id = ?, stock_transaction_id = ?,
            posted_by = ?, posted_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(jeResult ? jeResult.entryId : null, transId, req.user!.id, count.id);

      logAudit(
        req.user!.id,
        'POST_INVENTORY_COUNT',
        'inventory_counts',
        count.id,
        `ترحيل واعتماد محضر الجرد الفعلي رقم ${count.count_number}. عجز: ${totalShortage.toFixed(2)} ج.م، زيادة: ${totalSurplus.toFixed(2)} ج.م`
      );
    })();

    res.json({
      success: true,
      message: 'تم ترحيل واعتماد محضر الجرد بنجاح، وتوليد القيود المحاسبية وحركات تسوية المخزن.',
      journalNumber: jeResult ? jeResult.entryNumber : null
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
