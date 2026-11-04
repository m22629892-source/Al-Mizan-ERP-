import Decimal from 'decimal.js';
import { db } from './db.js';
import type Database from 'better-sqlite3';

// Configure Decimal precision
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export interface JournalLineInput {
  accountId: string;
  partyId?: string | null;
  costCenterId?: string | null;
  debit: number | string;
  credit: number | string;
  description?: string;
  currencyCode?: string;
  exchangeRate?: number;
  amountCurrency?: number;
}

export interface JournalEntryInput {
  docType: string; // MANUAL, SALES_INV, PUR_INV, SALES_RET, PUR_RET, RCPT, PYMT, STK_ADJ, ASSET_DEP, CLOSING, REVERSAL
  docId?: string | null;
  docNumber?: string | null;
  entryDate: string; // YYYY-MM-DD
  postingDate: string; // YYYY-MM-DD
  branchId: string;
  fiscalPeriodId?: string;
  description: string;
  createdBy: string;
  currencyCode?: string;
  exchangeRate?: number;
  lines: JournalLineInput[];
}

/**
 * Get or determine the open fiscal period for a given date
 */
export function getFiscalPeriodForDate(dateStr: string, targetDb = db): { id: string; fiscal_year_id: string; is_closed: number } {
  const period = targetDb.prepare(`
    SELECT fp.id, fp.fiscal_year_id, fp.is_closed, fy.is_closed as year_closed
    FROM fiscal_periods fp
    JOIN fiscal_years fy ON fp.fiscal_year_id = fy.id
    WHERE ? BETWEEN fp.start_date AND fp.end_date
    LIMIT 1
  `).get(dateStr) as { id: string; fiscal_year_id: string; is_closed: number; year_closed: number } | undefined;

  if (!period) {
    throw new Error(`لا توجد فترة مالية معرفة للتاريخ ${dateStr}. يرجى إعداد السنوات والفترات المالية أولاً.`);
  }

  if (period.is_closed === 1 || period.year_closed === 1) {
    throw new Error(`الفترة المالية أو السنة المالية للتاريخ ${dateStr} مغلقة، ولا يمكن ترحيل قيود بها.`);
  }

  return period;
}

/**
 * Generate atomic sequential document number without gaps or collisions
 */
export function getNextDocumentNumber(docType: string, branchId: string, fiscalYearId: string, targetDb = db): string {
  const branch = targetDb.prepare('SELECT code FROM branches WHERE id = ?').get(branchId) as { code: string } | undefined;
  const branchCode = branch ? branch.code : 'B01';
  const year = targetDb.prepare('SELECT code FROM fiscal_years WHERE id = ?').get(fiscalYearId) as { code: string } | undefined;
  const yearCode = year ? year.code : new Date().getFullYear().toString();

  const prefix = `${docType}-${yearCode}-${branchCode}`;

  const getSeq = targetDb.prepare(`
    SELECT id, prefix, next_number 
    FROM document_sequences 
    WHERE doc_type = ? AND branch_id = ? AND fiscal_year_id = ?
  `);
  
  let seq = getSeq.get(docType, branchId, fiscalYearId) as { id: string; prefix: string; next_number: number } | undefined;

  // Scan existing tables to guarantee next_number is strictly greater than any existing document
  let maxExisting = 0;
  const checkQueries = [
    { sql: `SELECT invoice_number as num FROM sales_invoices WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1` },
    { sql: `SELECT invoice_number as num FROM purchase_invoices WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1` },
    { sql: `SELECT return_number as num FROM sales_returns WHERE return_number LIKE ? ORDER BY return_number DESC LIMIT 1` },
    { sql: `SELECT return_number as num FROM purchase_returns WHERE return_number LIKE ? ORDER BY return_number DESC LIMIT 1` },
    { sql: `SELECT voucher_number as num FROM payment_vouchers WHERE voucher_number LIKE ? ORDER BY voucher_number DESC LIMIT 1` },
    { sql: `SELECT entry_number as num FROM journal_entries WHERE entry_number LIKE ? ORDER BY entry_number DESC LIMIT 1` }
  ];

  for (const q of checkQueries) {
    try {
      const row = targetDb.prepare(q.sql).get(`${prefix}-%`) as { num: string } | undefined;
      if (row && row.num) {
        const parts = row.num.split('-');
        const lastPart = parts[parts.length - 1];
        const n = parseInt(lastPart, 10);
        if (!isNaN(n) && n > maxExisting) {
          maxExisting = n;
        }
      }
    } catch {
      // safe fallback if table is not yet initialized
    }
  }

  let nextVal = 1;
  if (seq) {
    nextVal = Math.max(seq.next_number, maxExisting + 1);
  } else {
    nextVal = maxExisting + 1;
    const id = `seq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    targetDb.prepare(`
      INSERT INTO document_sequences (id, doc_type, branch_id, fiscal_year_id, prefix, next_number)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, docType, branchId, fiscalYearId, prefix, nextVal);
    seq = { id, prefix, next_number: nextVal };
  }

  const currentNumber = nextVal;
  targetDb.prepare(`
    UPDATE document_sequences 
    SET next_number = ? 
    WHERE id = ?
  `).run(currentNumber + 1, seq.id);

  return `${prefix}-${currentNumber.toString().padStart(6, '0')}`;
}

/**
 * Log action to immutable audit log table
 */
export function logAudit(
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  details?: string,
  oldVal?: any,
  newVal?: any,
  targetDb = db,
  ipAddress?: string
) {
  // Redact sensitive credentials (passwords, tokens, hashes)
  const sanitize = (val: any) => {
    if (!val || typeof val !== 'object') return val;
    const cloned = Array.isArray(val) ? [...val] : { ...val };
    for (const k of Object.keys(cloned)) {
      if (/password|secret|token|hash/i.test(k)) {
        cloned[k] = '[REDACTED]';
      }
    }
    return cloned;
  };

  try {
    const id = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    targetDb.prepare(`
      INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, old_values, new_values, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      action,
      entityType,
      entityId,
      details || null,
      oldVal ? JSON.stringify(sanitize(oldVal)) : null,
      newVal ? JSON.stringify(sanitize(newVal)) : null,
      ipAddress || null
    );
  } catch (err) {
    console.error('Audit log fatal write error:', err);
    throw new Error(`فشل تسجيل التدقيق الرقابي للعملية (${action}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Central Journal Entry Posting
 */
export function postJournalEntry(input: JournalEntryInput, targetDb = db): { entryId: string; entryNumber: string } {
  if (!input.lines || input.lines.length < 2) {
    throw new Error('يجب أن يحتوي القيد المحاسبي على طرفين على الأقل (مدين ودائن).');
  }

  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);

  // Validate accounts and sum
  for (const line of input.lines) {
    const debit = new Decimal(line.debit || 0);
    const credit = new Decimal(line.credit || 0);

    if (debit.isNegative() || credit.isNegative()) {
      throw new Error('لا يمكن أن تكون قيمة المدين أو الدائن سالبة في القيد.');
    }
    if (debit.isZero() && credit.isZero()) {
      throw new Error('لا يمكن إدخال سطر في القيد بقيمة صفر للمدين والدائن معاً.');
    }
    if (!debit.isZero() && !credit.isZero()) {
      throw new Error('لا يمكن أن يحتوي نفس السطر على قيمتين للمدين والدائن معاً.');
    }

    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);

    // Verify Account
    const acc = targetDb.prepare('SELECT id, name_ar, is_group, is_active FROM accounts WHERE id = ?').get(line.accountId) as { id: string; name_ar: string; is_group: number; is_active: number } | undefined;
    if (!acc) {
      throw new Error(`الحساب ذو المعرف ${line.accountId} غير موجود في دليل الحسابات.`);
    }
    if (acc.is_active === 0) {
      throw new Error(`الحساب "${acc.name_ar}" معطل ولا يمكن الترحيل إليه.`);
    }
    if (acc.is_group === 1) {
      throw new Error(`الحساب "${acc.name_ar}" حساب رئيسي/تجميعي، وممنوع الترحيل المباشر إليه.`);
    }
  }

  // Ensure balance within 0.001
  const diff = totalDebit.minus(totalCredit).abs();
  if (diff.greaterThan(0.001)) {
    throw new Error(`القيد غير متوازن! إجمالي المدين (${totalDebit.toFixed(2)}) لا يساوي إجمالي الدائن (${totalCredit.toFixed(2)}). الفرق: ${diff.toFixed(2)}`);
  }

  const period = getFiscalPeriodForDate(input.postingDate, targetDb);
  const entryId = `je_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const entryNumber = getNextDocumentNumber('JV', input.branchId, period.fiscal_year_id, targetDb);

  targetDb.prepare(`
    INSERT INTO journal_entries (
      id, entry_number, doc_type, doc_id, doc_number, entry_date, posting_date,
      fiscal_period_id, branch_id, status, description, total_debit, total_credit,
      currency_code, exchange_rate, created_by, posted_by, posted_at, is_system_generated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
  `).run(
    entryId,
    entryNumber,
    input.docType,
    input.docId || null,
    input.docNumber || null,
    input.entryDate,
    input.postingDate,
    period.id,
    input.branchId,
    input.description,
    totalDebit.toNumber(),
    totalCredit.toNumber(),
    input.currencyCode || 'EGP',
    input.exchangeRate || 1.0,
    input.createdBy,
    input.createdBy
  );

  const insertLine = targetDb.prepare(`
    INSERT INTO journal_entry_lines (
      id, entry_id, line_number, account_id, party_id, cost_center_id,
      debit, credit, description, currency_code, exchange_rate, amount_currency
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let lineNo = 1;
  for (const line of input.lines) {
    const lineId = `jel_${Date.now()}_${lineNo}_${Math.random().toString(36).substring(2, 5)}`;
    const d = new Decimal(line.debit || 0).toNumber();
    const c = new Decimal(line.credit || 0).toNumber();
    const rate = line.exchangeRate || 1.0;
    const currAmt = d > 0 ? (d / rate) : (c / rate);

    insertLine.run(
      lineId,
      entryId,
      lineNo++,
      line.accountId,
      line.partyId || null,
      line.costCenterId || null,
      d,
      c,
      line.description || input.description,
      line.currencyCode || 'EGP',
      rate,
      currAmt
    );
  }

  logAudit(input.createdBy, 'POST_JOURNAL', 'journal_entries', entryId, `ترحيل قيد يومية برقم ${entryNumber}`, null, null, targetDb);

  return { entryId, entryNumber };
}

export function reverseJournalEntry(
  originalEntryId: string,
  reason: string,
  userId: string,
  targetDb = db,
  allowDocumentReversal = false
): { reverseEntryId: string; reverseNumber: string } {
  const orig = targetDb.prepare('SELECT * FROM journal_entries WHERE id = ?').get(originalEntryId) as any;
  if (!orig) {
    throw new Error('القيد المحاسبي المراد عكسه غير موجود.');
  }
  if (orig.status === 'reversed') {
    throw new Error('هذا القيد تم عكسه مسبقاً ولا يمكن عكسه مرة أخرى.');
  }
  if (orig.doc_type === 'REVERSAL') {
    throw new Error('لا يمكن عكس قيد تسوية عكسي مباشرة.');
  }

  // Prevent reversing invoice or return entries directly if they would orphan the document
  if (!allowDocumentReversal && ['SALES_INV', 'PUR_INV', 'SALES_RET', 'PUR_RET'].includes(orig.doc_type) && orig.doc_id) {
    throw new Error(`لا يمكن عكس قيد الفاتورة أو المردود (${orig.doc_type}) بشكل منفرد لأن ذلك يخل بتسوية المخزون والمديونية؛ يرجى استخدام إجراء إلغاء الفاتورة أو المردود.`);
  }

  const lines = targetDb.prepare('SELECT * FROM journal_entry_lines WHERE entry_id = ? ORDER BY line_number').all(originalEntryId) as any[];
  if (!lines || lines.length === 0) {
    throw new Error('لا توجد بنود مسجلة لهذا القيد.');
  }

  const today = new Date().toISOString().split('T')[0];
  const period = getFiscalPeriodForDate(today, targetDb);
  const reverseNumber = getNextDocumentNumber('REV', orig.branch_id, period.fiscal_year_id, targetDb);
  const reverseId = `je_rev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Swap debit and credit lines
  const reverseLines = lines.map(line => ({
    accountId: line.account_id,
    partyId: line.party_id,
    costCenterId: line.cost_center_id,
    debit: line.credit, // SWAP
    credit: line.debit, // SWAP
    description: `قيد عكسي للقيد ${orig.entry_number}: ${reason}`,
    currencyCode: line.currency_code,
    exchangeRate: line.exchange_rate,
    amountCurrency: line.amount_currency
  }));

  targetDb.transaction(() => {
    // 1. Insert reverse entry first (referencing originalEntryId)
    targetDb.prepare(`
      INSERT INTO journal_entries (
        id, entry_number, doc_type, doc_id, doc_number, entry_date, posting_date,
        fiscal_period_id, branch_id, status, description, total_debit, total_credit,
        currency_code, exchange_rate, created_by, posted_by, posted_at, reversed_entry_id, is_system_generated
      ) VALUES (?, ?, 'REVERSAL', ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 1)
    `).run(
      reverseId,
      reverseNumber,
      orig.doc_id,
      orig.entry_number,
      today,
      today,
      period.id,
      orig.branch_id,
      `قيد عكسي للقيد رقم ${orig.entry_number} - السبب: ${reason}`,
      orig.total_credit, // SWAPPED
      orig.total_debit,  // SWAPPED
      orig.currency_code,
      orig.exchange_rate,
      userId,
      userId,
      originalEntryId
    );

    // 2. Mark original entry as reversed
    targetDb.prepare(`
      UPDATE journal_entries 
      SET status = 'reversed', reversed_entry_id = ? 
      WHERE id = ?
    `).run(reverseId, originalEntryId);

    const insertLine = targetDb.prepare(`
      INSERT INTO journal_entry_lines (
        id, entry_id, line_number, account_id, party_id, cost_center_id,
        debit, credit, description, currency_code, exchange_rate, amount_currency
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let lineNo = 1;
    for (const line of reverseLines) {
      const lineId = `jel_rev_${Date.now()}_${lineNo}_${Math.random().toString(36).substring(2, 5)}`;
      insertLine.run(
        lineId,
        reverseId,
        lineNo++,
        line.accountId,
        line.partyId,
        line.costCenterId,
        line.debit,
        line.credit,
        line.description,
        line.currencyCode,
        line.exchangeRate,
        line.amountCurrency
      );
    }

    logAudit(userId, 'REVERSE_ENTRY', 'journal_entries', originalEntryId, `عكس القيد ${orig.entry_number} بالقيد العكسي ${reverseNumber}. السبب: ${reason}`, null, null, targetDb);
  })();

  return { reverseEntryId: reverseId, reverseNumber };
}

/**
 * Check whether system allows negative stock
 */
export function isNegativeStockAllowed(targetDb = db): boolean {
  const setting = targetDb.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get('allow_negative_stock') as { setting_value: string } | undefined;
  return setting?.setting_value === 'true';
}

/**
 * Multi-Line Aggregated Stock Check
 */
export function validateAndDeductStock(
  warehouseId: string,
  items: { itemId: string; quantity: number }[],
  targetDb = db
): { itemId: string; totalQty: number; costPrice: number }[] {
  const allowNegative = isNegativeStockAllowed(targetDb);
  const qtyMap = new Map<string, Decimal>();

  for (const it of items) {
    if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
      throw new Error(`الكمية غير صحيحة للصنف ${it.itemId}. يجب أن تكون رقماً موجباً.`);
    }
    const current = qtyMap.get(it.itemId) || new Decimal(0);
    qtyMap.set(it.itemId, current.plus(new Decimal(it.quantity)));
  }

  const results: { itemId: string; totalQty: number; costPrice: number }[] = [];

  for (const [itemId, totalQtyDec] of qtyMap.entries()) {
    const totalQty = totalQtyDec.toNumber();
    const itemRow = targetDb.prepare('SELECT id, name_ar, item_type, moving_avg_cost FROM items WHERE id = ?').get(itemId) as any;
    if (!itemRow) {
      throw new Error(`الصنف ${itemId} غير موجود.`);
    }

    if (itemRow.item_type === 'stock') {
      const currentStock = targetDb.prepare('SELECT quantity FROM warehouse_stock WHERE warehouse_id = ? AND item_id = ?').get(warehouseId, itemId) as { quantity: number } | undefined;
      const available = currentStock ? currentStock.quantity : 0;

      if (!allowNegative && available < totalQty) {
        throw new Error(`إجمالي الكمية المطلوبة من الصنف "${itemRow.name_ar}" عبر بنود الفاتورة (${totalQty}) يتجاوز الرصيد الفعلي المتاح بالمخزن (${available}). تم منع الترحيل لحماية المخزون من الأرصدة السالبة.`);
      }

      // Deduct stock in warehouse_stock
      targetDb.prepare(`
        UPDATE warehouse_stock 
        SET quantity = quantity - ? 
        WHERE warehouse_id = ? AND item_id = ?
      `).run(totalQty, warehouseId, itemId);
    }

    results.push({
      itemId,
      totalQty,
      costPrice: itemRow.moving_avg_cost || 0
    });
  }

  return results;
}
