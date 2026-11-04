import { Router, Response } from 'express';
import Decimal from 'decimal.js';
import { db } from '../db.js';
import { AuthenticatedRequest, requireAuth, requirePermission } from '../api.js';
import { logAudit } from '../accounting-engine.js';
import { PeriodClosingDiagnostic, PeriodClosingStatus } from '../../types.js';

export const periodClosingRouter = Router();

/**
 * Diagnostic analysis function: runs full financial integrity and subledger reconciliation
 */
export function runPeriodDiagnostics(periodId: string): PeriodClosingStatus {
  const period = db.prepare(`
    SELECT fp.*, fy.code as year_code, fy.name_ar as year_name_ar, fy.is_closed as year_is_closed
    FROM fiscal_periods fp
    JOIN fiscal_years fy ON fp.fiscal_year_id = fy.id
    WHERE fp.id = ?
  `).get(periodId) as any;

  if (!period) {
    throw new Error('الفترة المالية المحددة غير موجودة في النظام.');
  }

  const diagnostics: PeriodClosingDiagnostic[] = [];

  // 1. Unbalanced Journal Entries Check (Blocking)
  const unbalancedEntries = db.prepare(`
    SELECT id, entry_number, entry_date, total_debit, total_credit,
           ABS(total_debit - total_credit) as diff
    FROM journal_entries
    WHERE fiscal_period_id = ? AND status = 'posted' AND ABS(total_debit - total_credit) > 0.001
  `).all(periodId) as any[];

  diagnostics.push({
    key: 'unbalanced_je',
    category: 'unbalanced_je',
    severity: 'blocking',
    title_ar: 'توازن قيود اليومية العامة بالأستاذ',
    title_en: 'General Ledger Entries Balance',
    expectedValue: 0,
    actualValue: unbalancedEntries.length,
    variance: unbalancedEntries.length,
    isPassed: unbalancedEntries.length === 0,
    message_ar: unbalancedEntries.length === 0
      ? 'جميع قيود اليومية المرحلة خلال الفترة متوازنة محاسبياً (المدين = الدائن).'
      : `يوجد عدد (${unbalancedEntries.length}) قيد مرحل غير متوازن محاسبياً يمنع الإقفال!`,
    documents: unbalancedEntries.map(e => ({
      id: e.id,
      number: e.entry_number,
      date: e.entry_date,
      amount: e.diff,
      type: 'قيد غير متوازن'
    }))
  });

  // 2. Unposted Draft Documents Check (Blocking)
  // Draft Sales Invoices
  const draftSales = db.prepare(`
    SELECT id, invoice_number, invoice_date, total_amount
    FROM sales_invoices
    WHERE status = 'draft' AND invoice_date BETWEEN ? AND ?
  `).all(period.start_date, period.end_date) as any[];

  // Draft Purchase Invoices
  const draftPurchases = db.prepare(`
    SELECT id, invoice_number, invoice_date, total_amount
    FROM purchase_invoices
    WHERE status = 'draft' AND invoice_date BETWEEN ? AND ?
  `).all(period.start_date, period.end_date) as any[];

  // Draft Sales Returns
  const draftSalesReturns = db.prepare(`
    SELECT id, return_number, return_date, total_amount
    FROM sales_returns
    WHERE status = 'draft' AND return_date BETWEEN ? AND ?
  `).all(period.start_date, period.end_date) as any[];

  // Draft Purchase Returns
  const draftPurReturns = db.prepare(`
    SELECT id, return_number, return_date, total_amount
    FROM purchase_returns
    WHERE status = 'draft' AND return_date BETWEEN ? AND ?
  `).all(period.start_date, period.end_date) as any[];

  // Draft Journal Entries
  const draftJournals = db.prepare(`
    SELECT id, entry_number, entry_date, total_debit as total_amount
    FROM journal_entries
    WHERE status = 'draft' AND fiscal_period_id = ?
  `).all(periodId) as any[];

  const allDrafts = [
    ...draftSales.map(d => ({ id: d.id, number: d.invoice_number, date: d.invoice_date, amount: d.total_amount, type: 'فاتورة مبيعات مسودة' })),
    ...draftPurchases.map(d => ({ id: d.id, number: d.invoice_number, date: d.invoice_date, amount: d.total_amount, type: 'فاتورة مشتريات مسودة' })),
    ...draftSalesReturns.map(d => ({ id: d.id, number: d.return_number, date: d.return_date, amount: d.total_amount, type: 'مردود مبيعات مسودة' })),
    ...draftPurReturns.map(d => ({ id: d.id, number: d.return_number, date: d.return_date, amount: d.total_amount, type: 'مردود مشتريات مسودة' })),
    ...draftJournals.map(d => ({ id: d.id, number: d.entry_number, date: d.entry_date, amount: d.total_amount, type: 'قيد يومية مسودة' }))
  ];

  diagnostics.push({
    key: 'unposted_drafts',
    category: 'unposted_draft',
    severity: 'blocking',
    title_ar: 'المستندات والمسودات المعلقة غير المرحلة',
    title_en: 'Unposted Pending Drafts',
    expectedValue: 0,
    actualValue: allDrafts.length,
    variance: allDrafts.length,
    isPassed: allDrafts.length === 0,
    message_ar: allDrafts.length === 0
      ? 'لا توجد أي مسودات معلقة في هذه الفترة المالية. جميع المستندات تم ترحيلها أو معالجتها.'
      : `يوجد عدد (${allDrafts.length}) مسودة معلقة في هذه الفترة يجب ترحيلها أو حذفها قبل الإقفال.`,
    documents: allDrafts
  });

  // 3. Customer Control Account Reconciliation (acc_1121) (Blocking)
  const custSubledgerRow = db.prepare(`
    SELECT COALESCE(ROUND(SUM(jel.debit - jel.credit), 2), 0) as subledger_total
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    WHERE jel.party_id IN (SELECT id FROM parties WHERE type IN ('customer', 'both'))
      AND jel.account_id = 'acc_1121'
      AND je.status = 'posted'
      AND je.posting_date <= ?
  `).get(period.end_date) as { subledger_total: number };

  const custControlRow = db.prepare(`
    SELECT COALESCE(ROUND(SUM(jel.debit - jel.credit), 2), 0) as control_total
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    WHERE jel.account_id = 'acc_1121'
      AND je.status = 'posted'
      AND je.posting_date <= ?
  `).get(period.end_date) as { control_total: number };

  const custSub = new Decimal(custSubledgerRow.subledger_total || 0);
  const custCtrl = new Decimal(custControlRow.control_total || 0);
  const custDiff = custSub.minus(custCtrl).abs();

  diagnostics.push({
    key: 'customers_reconciliation',
    category: 'control_account',
    severity: 'blocking',
    title_ar: 'مطابقة كشوف العملاء مع حساب الرقابة بالأستاذ (1121)',
    title_en: 'Trade Debtors Subledger vs Control Account',
    expectedValue: custCtrl.toNumber(),
    actualValue: custSub.toNumber(),
    variance: custDiff.toNumber(),
    isPassed: custDiff.lessThanOrEqualTo(0.01),
    message_ar: custDiff.lessThanOrEqualTo(0.01)
      ? `إجمالي كشوف حسابات العملاء (${custSub.toFixed(2)}) يطابق تماماً رصيد حساب الرقابة بالأستاذ العام.`
      : `يوجد فرق قدره (${custDiff.toFixed(2)} ج.م) بين إجمالي كشوف العملاء وحساب الرقابة العام (1121).`
  });

  // 4. Supplier Control Account Reconciliation (acc_2111) (Blocking)
  const suppSubledgerRow = db.prepare(`
    SELECT COALESCE(ROUND(SUM(jel.credit - jel.debit), 2), 0) as subledger_total
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    WHERE jel.party_id IN (SELECT id FROM parties WHERE type IN ('supplier', 'both'))
      AND jel.account_id = 'acc_2111'
      AND je.status = 'posted'
      AND je.posting_date <= ?
  `).get(period.end_date) as { subledger_total: number };

  const suppControlRow = db.prepare(`
    SELECT COALESCE(ROUND(SUM(jel.credit - jel.debit), 2), 0) as control_total
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    WHERE jel.account_id = 'acc_2111'
      AND je.status = 'posted'
      AND je.posting_date <= ?
  `).get(period.end_date) as { control_total: number };

  const suppSub = new Decimal(suppSubledgerRow.subledger_total || 0);
  const suppCtrl = new Decimal(suppControlRow.control_total || 0);
  const suppDiff = suppSub.minus(suppCtrl).abs();

  diagnostics.push({
    key: 'suppliers_reconciliation',
    category: 'control_account',
    severity: 'blocking',
    title_ar: 'مطابقة كشوف الموردين مع حساب الرقابة بالأستاذ (2111)',
    title_en: 'Trade Creditors Subledger vs Control Account',
    expectedValue: suppCtrl.toNumber(),
    actualValue: suppSub.toNumber(),
    variance: suppDiff.toNumber(),
    isPassed: suppDiff.lessThanOrEqualTo(0.01),
    message_ar: suppDiff.lessThanOrEqualTo(0.01)
      ? `إجمالي كشوف حسابات الموردين (${suppSub.toFixed(2)}) يطابق تماماً رصيد حساب الرقابة بالأستاذ العام.`
      : `يوجد فرق قدره (${suppDiff.toFixed(2)} ج.م) بين إجمالي كشوف الموردين وحساب الرقابة العام (2111).`
  });

  // 5. Inventory Valuation Reconciliation (acc_1141 + acc_1142)
  const stockValuationRow = db.prepare(`
    SELECT COALESCE(ROUND(SUM(ws.quantity * i.moving_avg_cost), 2), 0) as valuation
    FROM warehouse_stock ws
    JOIN items i ON ws.item_id = i.id
    WHERE i.item_type = 'stock'
  `).get() as { valuation: number };

  const invLedgerRow = db.prepare(`
    SELECT COALESCE(ROUND(SUM(jel.debit - jel.credit), 2), 0) as ledger_total
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    WHERE jel.account_id IN ('acc_1141', 'acc_1142')
      AND je.status = 'posted'
      AND je.posting_date <= ?
  `).get(period.end_date) as { ledger_total: number };

  const stockVal = new Decimal(stockValuationRow.valuation || 0);
  const stockLedg = new Decimal(invLedgerRow.ledger_total || 0);
  const stockDiff = stockVal.minus(stockLedg).abs();

  diagnostics.push({
    key: 'inventory_reconciliation',
    category: 'control_account',
    severity: 'blocking',
    title_ar: 'مطابقة تقييم المخزون الفعلي مع حساب المخزن بالأستاذ (1141/1142)',
    title_en: 'Inventory Valuation vs Inventory Ledger',
    expectedValue: stockLedg.toNumber(),
    actualValue: stockVal.toNumber(),
    variance: stockDiff.toNumber(),
    isPassed: stockDiff.lessThanOrEqualTo(1.0), // allow rounding cents
    message_ar: stockDiff.lessThanOrEqualTo(1.0)
      ? `قيمة المخزون الإجمالية (${stockVal.toFixed(2)}) متطابقة مع رصيد حساب المخزون بالأستاذ العام.`
      : `يوجد فرق قدره (${stockDiff.toFixed(2)} ج.م) بين تقييم المخزون الفعلي وحساب المخزون بالأستاذ العام.`
  });

  // 6. Cash & Bank Subledger vs General Ledger
  const cashboxesTotal = db.prepare('SELECT COALESCE(ROUND(SUM(current_balance), 2), 0) as tot FROM cash_boxes').get() as { tot: number };
  const cashLedger = db.prepare(`
    SELECT COALESCE(ROUND(SUM(jel.debit - jel.credit), 2), 0) as tot
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    WHERE jel.account_id IN ('acc_1111', 'acc_1112') AND je.status = 'posted' AND je.posting_date <= ?
  `).get(period.end_date) as { tot: number };

  const bankAccountsTotal = db.prepare('SELECT COALESCE(ROUND(SUM(current_balance), 2), 0) as tot FROM bank_accounts').get() as { tot: number };
  const bankLedger = db.prepare(`
    SELECT COALESCE(ROUND(SUM(jel.debit - jel.credit), 2), 0) as tot
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    WHERE jel.account_id IN ('acc_1113', 'acc_1114') AND je.status = 'posted' AND je.posting_date <= ?
  `).get(period.end_date) as { tot: number };

  diagnostics.push({
    key: 'treasury_reconciliation',
    category: 'control_account',
    severity: 'warning',
    title_ar: 'مطابقة أرصدة الخزائن والبنوك مع الأستاذ العام',
    title_en: 'Treasury & Bank Balances vs GL Accounts',
    expectedValue: (cashLedger.tot || 0) + (bankLedger.tot || 0),
    actualValue: (cashboxesTotal.tot || 0) + (bankAccountsTotal.tot || 0),
    variance: Math.abs(((cashboxesTotal.tot || 0) + (bankAccountsTotal.tot || 0)) - ((cashLedger.tot || 0) + (bankLedger.tot || 0))),
    isPassed: Math.abs(((cashboxesTotal.tot || 0) + (bankAccountsTotal.tot || 0)) - ((cashLedger.tot || 0) + (bankLedger.tot || 0))) <= 1.0,
    message_ar: 'مطابقة أرصدة الخزينة النقدية والحسابات البنكية التفصيلية مع حسابات الأستاذ.'
  });

  // 7. Unallocated Payment Vouchers (Warning)
  const unallocatedVouchers = db.prepare(`
    SELECT pv.id, pv.voucher_number, pv.voucher_date, pv.unallocated_amount, pv.voucher_type, p.name_ar as party_name
    FROM payment_vouchers pv
    LEFT JOIN parties p ON pv.party_id = p.id
    WHERE pv.unallocated_amount > 0 AND pv.voucher_date BETWEEN ? AND ?
  `).all(period.start_date, period.end_date) as any[];

  diagnostics.push({
    key: 'unallocated_vouchers',
    category: 'unallocated_voucher',
    severity: 'warning',
    title_ar: 'السندات غير المخصصة بالكامل (دفعات مقدمة تحتاج مراجعة)',
    title_en: 'Unallocated Payment/Receipt Vouchers (Advance Payments)',
    expectedValue: 0,
    actualValue: unallocatedVouchers.length,
    variance: unallocatedVouchers.length,
    isPassed: true, // Warning only: advance payments may legitimately remain unallocated
    message_ar: unallocatedVouchers.length === 0
      ? 'جميع سندات القبض والدفع مخصصة بالكامل لفواتير محددة.'
      : `يوجد عدد (${unallocatedVouchers.length}) سند به مبالغ غير مخصصة (دفعات مقدمة). لا يمنع الإقفال إذا كانت مقصودة كدفعات تحت الحساب.`,
    documents: unallocatedVouchers.map(v => ({
      id: v.id,
      number: v.voucher_number,
      date: v.voucher_date,
      amount: v.unallocated_amount,
      type: v.voucher_type === 'receipt' ? `سند قبض غير مخصص (${v.party_name || 'عام'})` : `سند صرف غير مخصص (${v.party_name || 'عام'})`
    }))
  });

  // 8. Bank Reconciliation Variance Check (Warning)
  const unreconciledBanks = db.prepare(`
    SELECT b.bank_name, b.account_number,
           COALESCE(SUM(CASE WHEN bsl.is_matched = 0 THEN 1 ELSE 0 END), 0) as unmatched_count
    FROM bank_accounts b
    LEFT JOIN bank_statement_lines bsl ON b.id = bsl.bank_account_id
    GROUP BY b.id
    HAVING unmatched_count > 0
  `).all() as any[];

  diagnostics.push({
    key: 'bank_reconciliation_variance',
    category: 'bank_variance',
    severity: 'warning',
    title_ar: 'فروق التسوية البنكية والحركات غير المطابقة',
    title_en: 'Bank Statement Reconciliation Discrepancies',
    expectedValue: 0,
    actualValue: unreconciledBanks.length,
    variance: unreconciledBanks.length,
    isPassed: unreconciledBanks.length === 0,
    message_ar: unreconciledBanks.length === 0
      ? 'لا توجد حركات بنكية غير مطابقة في كشوف الحسابات المستوردة.'
      : `يوجد عدد (${unreconciledBanks.length}) حساب بنكي به حركات كشف حساب تنتظر المطابقة في شاشة تسوية البنك.`
  });

  const blockingCount = diagnostics.filter(d => d.severity === 'blocking' && !d.isPassed).length;
  const warningCount = diagnostics.filter(d => d.severity === 'warning' && !d.isPassed).length;

  return {
    period: {
      id: period.id,
      period_number: period.period_number,
      name_ar: period.name_ar,
      name_en: period.name_en,
      start_date: period.start_date,
      end_date: period.end_date,
      is_closed: period.is_closed,
      closed_at: period.closed_at,
      closed_by: period.closed_by
    },
    fiscalYear: {
      id: period.fiscal_year_id,
      code: period.year_code,
      name_ar: period.year_name_ar,
      is_closed: period.year_is_closed
    },
    canClose: blockingCount === 0 && period.is_closed === 0,
    blockingCount,
    warningCount,
    lastReviewDate: new Date().toISOString(),
    diagnostics,
    reconciliationSummary: {
      customersSubledger: custSub.toNumber(),
      customersControlAccount: custCtrl.toNumber(),
      customersVariance: custDiff.toNumber(),
      suppliersSubledger: suppSub.toNumber(),
      suppliersControlAccount: suppCtrl.toNumber(),
      suppliersVariance: suppDiff.toNumber(),
      inventoryValuation: stockVal.toNumber(),
      inventoryControlAccount: stockLedg.toNumber(),
      inventoryVariance: stockDiff.toNumber(),
      cashSubledger: cashboxesTotal.tot || 0,
      cashControlAccount: cashLedger.tot || 0,
      bankSubledger: bankAccountsTotal.tot || 0,
      bankControlAccount: bankLedger.tot || 0
    }
  };
}

/**
 * GET /status: Detailed Diagnostic status of a financial period
 */
periodClosingRouter.get('/status', requireAuth, requirePermission('period.view', 'period.review', 'month_close.view'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const periodId = req.query.periodId as string || 'fp_2026_03';
    const status = runPeriodDiagnostics(periodId);

    // Also get all periods for selector
    const periods = db.prepare(`
      SELECT id, period_number, name_ar, start_date, end_date, is_closed, closed_at, closed_by
      FROM fiscal_periods
      ORDER BY period_number ASC
    `).all();

    res.json({
      success: true,
      status,
      periods
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /close: Executes month-end closing atomically with concurrency protection
 */
periodClosingRouter.post('/close', requireAuth, requirePermission('period.close'), (req: AuthenticatedRequest, res: Response) => {
  const { periodId, notes } = req.body;

  if (!periodId) {
    return res.status(400).json({ error: 'يجب تحديد معرف الفترة المالية المراد إقفالها.' });
  }

  try {
    let resultSummary: any = null;

    db.transaction(() => {
      // 1. Re-run diagnostics under active database transaction
      const diagnostics = runPeriodDiagnostics(periodId);

      if (diagnostics.period.is_closed === 1) {
        throw new Error('هذه الفترة المالية مقفلة بالفعل مسبقاً.');
      }

      if (diagnostics.blockingCount > 0) {
        const blockingNames = diagnostics.diagnostics
          .filter(d => d.severity === 'blocking' && !d.isPassed)
          .map(d => `• ${d.title_ar}: ${d.message_ar}`)
          .join('\n');
        throw new Error(`تعذر إقفال الشهر لوجود (${diagnostics.blockingCount}) أخطاء محاسبية مانعة للإقفال:\n${blockingNames}`);
      }

      // 2. Mark fiscal period as closed
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE fiscal_periods
        SET is_closed = 1, closed_at = ?, closed_by = ?
        WHERE id = ?
      `).run(now, req.user!.id, periodId);

      // 3. Save snapshot in period_closings table
      const closingId = `close_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      db.prepare(`
        INSERT INTO period_closings (id, period_id, closed_by, closed_at, notes, summary_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        closingId,
        periodId,
        req.user!.id,
        now,
        notes || 'تم إقفال الفترة المالية بنجاح بعد استيفاء جميع شروط ومطابقات الرقابة.',
        JSON.stringify(diagnostics)
      );

      logAudit(
        req.user!.id,
        'CLOSE_PERIOD',
        'fiscal_periods',
        periodId,
        `إقفال الفترة المالية (${diagnostics.period.name_ar}) بنجاح بمطابقة تامة لحسابات الرقابة.`,
        { is_closed: 0 },
        { is_closed: 1, closed_at: now, closed_by: req.user!.id }
      );

      resultSummary = diagnostics;
    })();

    res.json({
      success: true,
      message: 'تم إقفال الفترة المالية بنجاح. لن يُسمح بترحيل أو تعديل أي مستندات بتاريخ يقع ضمن هذه الفترة.',
      summary: resultSummary
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /reopen: Re-opens a closed fiscal period with mandatory documented reason and audit trail
 */
periodClosingRouter.post('/reopen', requireAuth, requirePermission('period.reopen', 'reopen_period'), (req: AuthenticatedRequest, res: Response) => {
  const { periodId, reason } = req.body;

  if (!periodId) {
    return res.status(400).json({ error: 'يجب تحديد معرف الفترة المالية المراد إعادة فتحها.' });
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
    return res.status(400).json({ error: 'إعادة فتح الفترة المالية يتطلب مسوغاً وسبباً رسمياً موثقاً لا يقل عن 5 أحرف.' });
  }

  try {
    const period = db.prepare('SELECT * FROM fiscal_periods WHERE id = ?').get(periodId) as any;
    if (!period) return res.status(404).json({ error: 'الفترة المالية غير موجودة.' });
    if (period.is_closed === 0) return res.status(400).json({ error: 'الفترة المالية مفتوحة بالفعل.' });

    db.transaction(() => {
      // 1. Reopen period
      db.prepare(`
        UPDATE fiscal_periods
        SET is_closed = 0, closed_at = NULL, closed_by = NULL
        WHERE id = ?
      `).run(periodId);

      // 2. Record in period_reopen_logs
      const logId = `reopen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      db.prepare(`
        INSERT INTO period_reopen_logs (id, period_id, reopened_by, reopened_at, reason, previous_status)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, 'closed')
      `).run(logId, periodId, req.user!.id, reason.trim());

      logAudit(
        req.user!.id,
        'REOPEN_PERIOD',
        'fiscal_periods',
        periodId,
        `إعادة فتح الفترة المالية (${period.name_ar}). السبب الرسمي: ${reason.trim()}`,
        { is_closed: 1, closed_at: period.closed_at, closed_by: period.closed_by },
        { is_closed: 0, reason: reason.trim() }
      );
    })();

    res.json({
      success: true,
      message: `تم إعادة فتح الفترة المالية (${period.name_ar}) بنجاح وتوثيق سبب الفتح بسجل التدقيق.`
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /history: Retrieve audit history of period closings and reopenings
 */
periodClosingRouter.get('/history', requireAuth, requirePermission('period.view', 'period.review', 'month_close.view'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const closings = db.prepare(`
      SELECT pc.*, u.display_name as closed_by_name, fp.name_ar as period_name
      FROM period_closings pc
      JOIN users u ON pc.closed_by = u.id
      JOIN fiscal_periods fp ON pc.period_id = fp.id
      ORDER BY pc.closed_at DESC
      LIMIT 20
    `).all();

    const reopenings = db.prepare(`
      SELECT prl.*, u.display_name as reopened_by_name, fp.name_ar as period_name
      FROM period_reopen_logs prl
      JOIN users u ON prl.reopened_by = u.id
      JOIN fiscal_periods fp ON prl.period_id = fp.id
      ORDER BY prl.reopened_at DESC
      LIMIT 20
    `).all();

    res.json({
      success: true,
      closings,
      reopenings
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
