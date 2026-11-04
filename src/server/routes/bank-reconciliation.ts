import { Router, Response } from 'express';
import Decimal from 'decimal.js';
import { db } from '../db.js';
import { AuthenticatedRequest, requireAuth, requirePermission } from '../api.js';
import { postJournalEntry, getFiscalPeriodForDate, logAudit } from '../accounting-engine.js';
import { BankStatementLine, BankReconciliationRecord } from '../../types.js';

export const bankReconciliationRouter = Router();

/**
 * GET /data: Fetch bank reconciliation workspace data
 */
bankReconciliationRouter.get('/data', requireAuth, requirePermission('bank_reconciliation.view', 'bank.reconciliation.view', 'bank.view', 'bank.reconcile', 'treasury.view'), (req: AuthenticatedRequest, res: Response) => {
  const bankAccountId = (req.query.bankAccountId as string) || 'bank_nbe';
  const fromDate = (req.query.fromDate as string) || '2026-01-01';
  const toDate = (req.query.toDate as string) || new Date().toISOString().split('T')[0];

  try {
    const bank = db.prepare(`
      SELECT ba.*, a.code as account_code, a.name_ar as account_name_ar
      FROM bank_accounts ba
      JOIN accounts a ON ba.account_id = a.id
      WHERE ba.id = ?
    `).get(bankAccountId) as any;

    if (!bank) {
      return res.status(404).json({ error: 'الحساب البنكي المحدد غير موجود.' });
    }

    // 1. Bank Statement Lines
    const statementLines = db.prepare(`
      SELECT bsl.*
      FROM bank_statement_lines bsl
      WHERE bsl.bank_account_id = ? AND bsl.line_date BETWEEN ? AND ?
      ORDER BY bsl.line_date ASC, bsl.id ASC
    `).all(bankAccountId, fromDate, toDate) as BankStatementLine[];

    // 2. Book Transactions from Payment Vouchers & General Ledger
    const bookVouchers = db.prepare(`
      SELECT pv.id, pv.voucher_number as doc_number, pv.voucher_date as doc_date,
             pv.description, pv.amount, pv.voucher_type,
             CASE WHEN pv.voucher_type = 'receipt' THEN pv.amount ELSE 0 END as debit,
             CASE WHEN pv.voucher_type = 'payment' THEN pv.amount ELSE 0 END as credit,
             p.name_ar as party_name,
             (SELECT COUNT(*) FROM bank_statement_lines WHERE matched_voucher_id = pv.id) as is_reconciled
      FROM payment_vouchers pv
      LEFT JOIN parties p ON pv.party_id = p.id
      WHERE pv.bank_account_id = ? AND pv.status = 'posted' AND pv.voucher_date BETWEEN ? AND ?
      ORDER BY pv.voucher_date ASC
    `).all(bankAccountId, fromDate, toDate) as any[];

    // Also include direct journal entry lines affecting this bank account (e.g. bank fee entries)
    const bookJournalLines = db.prepare(`
      SELECT jel.id, je.entry_number as doc_number, je.posting_date as doc_date,
             jel.description, jel.debit, jel.credit,
             (SELECT COUNT(*) FROM bank_statement_lines WHERE matched_journal_line_id = jel.id) as is_reconciled
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.entry_id = je.id
      WHERE jel.account_id = ? AND je.status = 'posted' AND je.posting_date BETWEEN ? AND ?
        AND je.doc_type NOT IN ('RCPT', 'PYMT') -- avoid duplicating vouchers
      ORDER BY je.posting_date ASC
    `).all(bank.account_id, fromDate, toDate) as any[];

    const allBookTransactions = [
      ...bookVouchers.map(v => ({
        id: v.id,
        type: 'voucher',
        docNumber: v.doc_number,
        docDate: v.doc_date,
        description: v.party_name ? `${v.description} (${v.party_name})` : v.description,
        debit: v.debit,
        credit: v.credit,
        isMatched: v.is_reconciled > 0
      })),
      ...bookJournalLines.map(j => ({
        id: j.id,
        type: 'journal_line',
        docNumber: j.doc_number,
        docDate: j.doc_date,
        description: j.description,
        debit: j.debit,
        credit: j.credit,
        isMatched: j.is_reconciled > 0
      }))
    ];

    // 3. Smart Auto-Match Suggestions
    // A statement line and a book transaction match if amounts match (statement credit == book debit or statement debit == book credit)
    const suggestions: { statementLineId: string; bookTxId: string; matchConfidence: number; reason: string }[] = [];

    for (const sLine of statementLines) {
      if (sLine.is_matched) continue;

      for (const bTx of allBookTransactions) {
        if (bTx.isMatched) continue;

        // In bank terminology:
        // Statement Credit = Deposit into bank (Book Debit)
        // Statement Debit = Withdrawal from bank (Book Credit)
        const isDepositMatch = Math.abs(sLine.credit - bTx.debit) <= 0.01 && sLine.credit > 0;
        const isWithdrawalMatch = Math.abs(sLine.debit - bTx.credit) <= 0.01 && sLine.debit > 0;

        if (isDepositMatch || isWithdrawalMatch) {
          const sDate = new Date(sLine.line_date).getTime();
          const bDate = new Date(bTx.docDate).getTime();
          const daysDiff = Math.abs(sDate - bDate) / (1000 * 60 * 60 * 24);

          if (daysDiff <= 5) {
            suggestions.push({
              statementLineId: sLine.id,
              bookTxId: bTx.id,
              matchConfidence: daysDiff === 0 ? 100 : 85,
              reason: `تطابق تام للمبلغ (${sLine.credit > 0 ? sLine.credit : sLine.debit} ج.م) وفارق زمني (${Math.round(daysDiff)} يوم)`
            });
            break;
          }
        }
      }
    }

    // 4. Calculate Balances
    // Current Book Balance
    const bookBalanceRow = db.prepare(`
      SELECT COALESCE(ROUND(SUM(jel.debit - jel.credit), 2), 0) as book_balance
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.entry_id = je.id
      WHERE jel.account_id = ? AND je.status = 'posted' AND je.posting_date <= ?
    `).get(bank.account_id, toDate) as { book_balance: number };

    const latestStatement = db.prepare(`
      SELECT closing_balance, statement_date
      FROM bank_statements
      WHERE bank_account_id = ?
      ORDER BY statement_date DESC
      LIMIT 1
    `).get(bankAccountId) as { closing_balance: number; statement_date: string } | undefined;

    const statementBalance = latestStatement?.closing_balance || bank.current_balance;

    // Unmatched Book Deposits (adds to bank statement balance)
    let unmatchedBookDeposits = new Decimal(0);
    // Unmatched Book Withdrawals / Issued Cheques (deducts from bank statement balance)
    let unmatchedBookWithdrawals = new Decimal(0);

    for (const b of allBookTransactions) {
      if (!b.isMatched) {
        if (b.debit > 0) unmatchedBookDeposits = unmatchedBookDeposits.plus(b.debit);
        if (b.credit > 0) unmatchedBookWithdrawals = unmatchedBookWithdrawals.plus(b.credit);
      }
    }

    // Unmatched Bank Credits / Direct Deposits (adds to book balance)
    let unmatchedBankCredits = new Decimal(0);
    // Unmatched Bank Debits / Fees & Charges (deducts from book balance)
    let unmatchedBankDebits = new Decimal(0);

    for (const s of statementLines) {
      if (!s.is_matched) {
        if (s.credit > 0) unmatchedBankCredits = unmatchedBankCredits.plus(s.credit);
        if (s.debit > 0) unmatchedBankDebits = unmatchedBankDebits.plus(s.debit);
      }
    }

    const currentBookBalanceDec = new Decimal(bookBalanceRow.book_balance || 0);
    const stmtBalanceDec = new Decimal(statementBalance);

    // Adjusted Bank Balance = Statement Balance + Deposits in Transit - Outstanding Cheques
    const adjustedBankBalance = stmtBalanceDec.plus(unmatchedBookDeposits).minus(unmatchedBookWithdrawals);

    // Adjusted Book Balance = Book Balance + Unrecorded Deposits - Unrecorded Fees/Debits
    const adjustedBookBalance = currentBookBalanceDec.plus(unmatchedBankCredits).minus(unmatchedBankDebits);

    const variance = adjustedBankBalance.minus(adjustedBookBalance).abs();

    res.json({
      success: true,
      bank,
      statementLines,
      bookTransactions: allBookTransactions,
      suggestions,
      reconciliationMetrics: {
        statementBalance: stmtBalanceDec.toNumber(),
        bookBalance: currentBookBalanceDec.toNumber(),
        unmatchedBookDeposits: unmatchedBookDeposits.toNumber(),
        unmatchedBookWithdrawals: unmatchedBookWithdrawals.toNumber(),
        unmatchedBankCredits: unmatchedBankCredits.toNumber(),
        unmatchedBankDebits: unmatchedBankDebits.toNumber(),
        adjustedBankBalance: adjustedBankBalance.toNumber(),
        adjustedBookBalance: adjustedBookBalance.toNumber(),
        variance: variance.toNumber(),
        isReconciled: variance.lessThanOrEqualTo(0.01)
      }
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /import-statement: Import Bank Statement Lines with Duplicate Prevention
 */
bankReconciliationRouter.post('/import-statement', requireAuth, requirePermission('bank.reconciliation.import', 'bank.reconcile'), (req: AuthenticatedRequest, res: Response) => {
  const { bankAccountId, statementDate, openingBalance, closingBalance, lines, filename } = req.body;

  if (!bankAccountId || !lines || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'بيانات كشف الحساب غير مكتملة أو لا تحتوي على حركات.' });
  }

  try {
    const stmtId = `bstmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const effectiveDate = statementDate || new Date().toISOString().split('T')[0];
    let insertedLines = 0;
    let skippedDuplicates = 0;

    db.transaction(() => {
      db.prepare(`
        INSERT INTO bank_statements (id, bank_account_id, statement_date, opening_balance, closing_balance, filename, imported_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        stmtId,
        bankAccountId,
        effectiveDate,
        Number(openingBalance || 0),
        Number(closingBalance || 0),
        filename || 'bank_statement.xlsx',
        req.user!.id
      );

      const insLine = db.prepare(`
        INSERT INTO bank_statement_lines (id, statement_id, bank_account_id, line_date, reference, description, debit, credit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const line of lines) {
        const lineDate = line.lineDate || line.date || effectiveDate;
        const ref = String(line.reference || line.ref || '').trim();
        const desc = String(line.description || line.desc || 'حركة كشف حساب').trim();
        const d = Number(line.debit || 0);
        const c = Number(line.credit || 0);

        // Duplicate Check: Same bank account, date, ref, debit, and credit
        if (ref) {
          const dupCheck = db.prepare(`
            SELECT id FROM bank_statement_lines
            WHERE bank_account_id = ? AND line_date = ? AND reference = ? AND debit = ? AND credit = ?
          `).get(bankAccountId, lineDate, ref, d, c);

          if (dupCheck) {
            skippedDuplicates++;
            continue;
          }
        }

        const lineId = `bsl_${Date.now()}_${insertedLines}_${Math.random().toString(36).slice(2, 5)}`;
        insLine.run(lineId, stmtId, bankAccountId, lineDate, ref || null, desc, d, c);
        insertedLines++;
      }
    })();

    logAudit(
      req.user!.id,
      'IMPORT_BANK_STATEMENT',
      'bank_statements',
      stmtId,
      `استيراد كشف حساب بنكي: تم إدراج (${insertedLines}) حركة، وتجاهل (${skippedDuplicates}) حركة مكررة لمنع الازدواج.`
    );

    res.json({
      success: true,
      message: `تم استيراد (${insertedLines}) حركة بنكية بنجاح${skippedDuplicates > 0 ? ` (تم استبعاد ${skippedDuplicates} حركة مكررة)` : ''}.`,
      insertedLines,
      skippedDuplicates
    });
  } catch (err: any) {
    res.status(400).json({ error: `فشل استيراد كشف الحساب: ${err.message}` });
  }
});

/**
 * POST /match: Match a statement line with a book voucher or journal line
 */
bankReconciliationRouter.post('/match', requireAuth, requirePermission('bank.reconciliation.match', 'bank.reconcile'), (req: AuthenticatedRequest, res: Response) => {
  const { statementLineId, bookTxId, bookTxType } = req.body;

  if (!statementLineId || !bookTxId) {
    return res.status(400).json({ error: 'يرجى تحديد حركة كشف الحساب وحركة الدفاتر المراد مطابقتهما.' });
  }

  try {
    const sLine = db.prepare('SELECT * FROM bank_statement_lines WHERE id = ?').get(statementLineId) as any;
    if (!sLine) return res.status(404).json({ error: 'حركة كشف الحساب غير موجودة.' });
    if (sLine.is_matched === 1) return res.status(400).json({ error: 'تمت مطابقة حركة كشف الحساب هذه مسبقاً.' });

    // Prevent double matching
    if (bookTxType === 'voucher') {
      const alreadyMatched = db.prepare('SELECT id FROM bank_statement_lines WHERE matched_voucher_id = ?').get(bookTxId);
      if (alreadyMatched) return res.status(400).json({ error: 'سند الدفاتر المحدد مرتبط ومطابق بالفعل مع حركة بنكية أخرى.' });

      db.prepare(`
        UPDATE bank_statement_lines
        SET is_matched = 1, matched_voucher_id = ?, matched_by = ?, matched_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(bookTxId, req.user!.id, statementLineId);
    } else {
      const alreadyMatched = db.prepare('SELECT id FROM bank_statement_lines WHERE matched_journal_line_id = ?').get(bookTxId);
      if (alreadyMatched) return res.status(400).json({ error: 'حركة القيد المحددة مطابقة بالفعل مع حركة بنكية أخرى.' });

      db.prepare(`
        UPDATE bank_statement_lines
        SET is_matched = 1, matched_journal_line_id = ?, matched_by = ?, matched_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(bookTxId, req.user!.id, statementLineId);
    }

    res.json({ success: true, message: 'تمت المطابقة بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /unmatch: Unmatch a previously matched statement line
 */
bankReconciliationRouter.post('/unmatch', requireAuth, requirePermission('bank.reconciliation.match', 'bank.reconcile'), (req: AuthenticatedRequest, res: Response) => {
  const { statementLineId } = req.body;

  if (!statementLineId) {
    return res.status(400).json({ error: 'يجب تحديد معرف حركة كشف الحساب.' });
  }

  try {
    db.prepare(`
      UPDATE bank_statement_lines
      SET is_matched = 0, matched_voucher_id = NULL, matched_journal_line_id = NULL, matched_by = NULL, matched_at = NULL
      WHERE id = ?
    `).run(statementLineId);

    res.json({ success: true, message: 'تم إلغاء المطابقة بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /record-fee: Record missing bank charge/interest directly with a balanced Journal Entry & match it
 */
bankReconciliationRouter.post('/record-fee', requireAuth, requirePermission('bank.reconciliation.fees', 'bank.reconcile'), (req: AuthenticatedRequest, res: Response) => {
  const { statementLineId, feeType, description } = req.body;

  if (!statementLineId) {
    return res.status(400).json({ error: 'يجب تحديد معرف حركة كشف الحساب لتسجيل القيد.' });
  }

  try {
    const sLine = db.prepare(`
      SELECT bsl.*, ba.account_id as bank_account_id_gl
      FROM bank_statement_lines bsl
      JOIN bank_accounts ba ON bsl.bank_account_id = ba.id
      WHERE bsl.id = ?
    `).get(statementLineId) as any;

    if (!sLine) return res.status(404).json({ error: 'حركة كشف الحساب غير موجودة.' });
    if (sLine.is_matched === 1) return res.status(400).json({ error: 'الحركة مطابقة بالفعل.' });

    const period = getFiscalPeriodForDate(sLine.line_date);
    const amount = sLine.debit > 0 ? sLine.debit : sLine.credit;
    const isFeeExpense = sLine.debit > 0; // Bank took money (fee)

    let jeResult: any = null;

    db.transaction(() => {
      // Create and post balanced journal entry
      jeResult = postJournalEntry({
        docType: 'MANUAL',
        entryDate: sLine.line_date,
        postingDate: sLine.line_date,
        branchId: 'br_cairo',
        fiscalPeriodId: period.id,
        description: description || (isFeeExpense ? `مصاريف وعمولات بنكية - مرجع ${sLine.reference || sLine.id}` : `فوائد وعوائد بنكية - مرجع ${sLine.reference || sLine.id}`),
        createdBy: req.user!.id,
        lines: isFeeExpense ? [
          { accountId: 'acc_6511', debit: amount, credit: 0, description: sLine.description }, // مصاريف بنكية
          { accountId: sLine.bank_account_id_gl, debit: 0, credit: amount, description: 'خصم من الحساب البنكي' }
        ] : [
          { accountId: sLine.bank_account_id_gl, debit: amount, credit: 0, description: 'إيداع بالحساب البنكي' },
          { accountId: 'acc_4511', debit: 0, credit: amount, description: sLine.description } // إيرادات وعوائد
        ]
      });

      // Find the created line for the bank account
      const createdLine = db.prepare(`
        SELECT id FROM journal_entry_lines
        WHERE entry_id = ? AND account_id = ?
        LIMIT 1
      `).get(jeResult.entryId, sLine.bank_account_id_gl) as any;

      // Auto-match this new line with the statement line
      db.prepare(`
        UPDATE bank_statement_lines
        SET is_matched = 1, matched_journal_line_id = ?, matched_by = ?, matched_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(createdLine.id, req.user!.id, statementLineId);
    })();

    logAudit(
      req.user!.id,
      'POST_BANK_FEE_ENTRY',
      'bank_statement_lines',
      statementLineId,
      `تسجيل قيد تسوية بنكية برقم (${jeResult.entryNumber}) بمبلغ (${amount} ج.م) ومطابقته فورياً.`
    );

    res.json({
      success: true,
      message: `تم تسجيل قيد التسوية البنكية برقم (${jeResult.entryNumber}) بنجاح ومطابقته آلياً مع كشف الحساب.`,
      entryNumber: jeResult.entryNumber
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
