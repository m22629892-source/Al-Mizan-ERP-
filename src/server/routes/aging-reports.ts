import { Router, Response } from 'express';
import Decimal from 'decimal.js';
import { db } from '../db.js';
import { AuthenticatedRequest, requireAuth, requirePermission, isBranchAllowed } from '../api.js';
import { AgingBucketRow } from '../../types.js';

export const agingRouter = Router();

function diffDays(laterDateStr: string, earlierDateStr: string): number {
  const d1 = new Date(laterDateStr);
  const d2 = new Date(earlierDateStr);
  const diffTime = d1.getTime() - d2.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * GET /receivables: Customer Aging Report as of Date
 */
agingRouter.get('/receivables', requireAuth, requirePermission('aging.receivables', 'reports.aging.customers', 'reports.view'), (req: AuthenticatedRequest, res: Response) => {
  const asOfDate = (req.query.asOfDate as string) || new Date().toISOString().split('T')[0];
  const branchId = req.query.branchId as string;
  const partyId = req.query.partyId as string;
  const currency = req.query.currency as string;

  if (branchId && branchId !== 'all' && !isBranchAllowed(req.user, branchId)) {
    return res.status(403).json({ error: 'الفرع المحدد خارج نطاق صلاحياتك.' });
  }

  try {
    let partyFilter = `WHERE p.type IN ('customer', 'both')`;
    const partyParams: any[] = [];
    if (partyId && partyId !== 'all') {
      partyFilter += ` AND p.id = ?`;
      partyParams.push(partyId);
    }
    if (currency && currency !== 'all') {
      partyFilter += ` AND p.currency_code = ?`;
      partyParams.push(currency);
    }

    const parties = db.prepare(`
      SELECT p.id, p.code, p.name_ar, p.phone, p.credit_limit, p.payment_terms_days, p.currency_code
      FROM parties p
      ${partyFilter}
      ORDER BY p.name_ar ASC
    `).all(...partyParams) as any[];

    const resultRows: AgingBucketRow[] = [];
    let grandTotal = new Decimal(0);
    let grandNotDue = new Decimal(0);
    let grand1to30 = new Decimal(0);
    let grand31to60 = new Decimal(0);
    let grand61to90 = new Decimal(0);
    let grandOver90 = new Decimal(0);
    let grandUnallocated = new Decimal(0);

    for (const party of parties) {
      let invQuery = `
        SELECT id, invoice_number, branch_id, invoice_date, due_date, total_amount, payment_type
        FROM sales_invoices
        WHERE customer_id = ?
          AND invoice_date <= ?
          AND status != 'draft' AND status != 'cancelled'
      `;
      const invParams: any[] = [party.id, asOfDate];
      if (branchId && branchId !== 'all') {
        invQuery += ` AND branch_id = ?`;
        invParams.push(branchId);
      }

      const invoices = db.prepare(invQuery).all(...invParams) as any[];

      let partyNotDue = new Decimal(0);
      let party1to30 = new Decimal(0);
      let party31to60 = new Decimal(0);
      let party61to90 = new Decimal(0);
      let partyOver90 = new Decimal(0);
      let partyTotal = new Decimal(0);
      const openInvoices: any[] = [];

      for (const inv of invoices) {
        if (!isBranchAllowed(req.user, inv.branch_id)) continue;

        const totalAmt = new Decimal(inv.total_amount || 0);

        // Historical payments allocated to this invoice on or before asOfDate
        const allocRow = db.prepare(`
          SELECT COALESCE(SUM(va.allocated_amount), 0) as paid_as_of
          FROM voucher_allocations va
          JOIN payment_vouchers pv ON va.voucher_id = pv.id
          WHERE va.invoice_id = ? AND pv.status = 'posted' AND pv.voucher_date <= ?
        `).get(inv.id, asOfDate) as { paid_as_of: number };

        // Historical sales returns on or before asOfDate
        const retRow = db.prepare(`
          SELECT COALESCE(SUM(sr.total_amount), 0) as ret_as_of
          FROM sales_returns sr
          WHERE sr.original_invoice_id = ? AND sr.status = 'posted' AND sr.return_date <= ?
        `).get(inv.id, asOfDate) as { ret_as_of: number };

        const paidAsOf = new Decimal(allocRow?.paid_as_of || 0);
        const retAsOf = new Decimal(retRow?.ret_as_of || 0);
        const remainingAsOf = Decimal.max(0, totalAmt.minus(paidAsOf).minus(retAsOf));

        if (remainingAsOf.greaterThan(0.01)) {
          const daysLate = diffDays(asOfDate, inv.due_date);
          let bucket = 'current';

          if (daysLate <= 0) {
            bucket = 'current';
            partyNotDue = partyNotDue.plus(remainingAsOf);
          } else if (daysLate <= 30) {
            bucket = '1-30';
            party1to30 = party1to30.plus(remainingAsOf);
          } else if (daysLate <= 60) {
            bucket = '31-60';
            party31to60 = party31to60.plus(remainingAsOf);
          } else if (daysLate <= 90) {
            bucket = '61-90';
            party61to90 = party61to90.plus(remainingAsOf);
          } else {
            bucket = 'over90';
            partyOver90 = partyOver90.plus(remainingAsOf);
          }

          partyTotal = partyTotal.plus(remainingAsOf);
          openInvoices.push({
            id: inv.id,
            invoiceNumber: inv.invoice_number,
            invoiceDate: inv.invoice_date,
            dueDate: inv.due_date,
            totalAmount: totalAmt.toNumber(),
            remainingAmount: remainingAsOf.toNumber(),
            daysOverdue: Math.max(0, daysLate),
            bucket
          });
        }
      }

      // Check unallocated receipt vouchers as of date
      const unallocRow = db.prepare(`
        SELECT COALESCE(SUM(unallocated_amount), 0) as unalloc_total
        FROM payment_vouchers
        WHERE party_id = ? AND voucher_type = 'receipt' AND status = 'posted' AND voucher_date <= ?
      `).get(party.id, asOfDate) as { unalloc_total: number };

      const unalloc = new Decimal(unallocRow?.unalloc_total || 0);

      if (partyTotal.greaterThan(0) || unalloc.greaterThan(0)) {
        resultRows.push({
          partyId: party.id,
          partyCode: party.code,
          partyName: party.name_ar,
          partyPhone: party.phone,
          creditLimit: party.credit_limit,
          paymentTermsDays: party.payment_terms_days,
          totalOutstanding: partyTotal.toNumber(),
          currentNotDue: partyNotDue.toNumber(),
          days1To30: party1to30.toNumber(),
          days31To60: party31to60.toNumber(),
          days61To90: party61to90.toNumber(),
          daysOver90: partyOver90.toNumber(),
          unallocatedPayments: unalloc.toNumber(),
          invoices: openInvoices
        });

        grandTotal = grandTotal.plus(partyTotal);
        grandNotDue = grandNotDue.plus(partyNotDue);
        grand1to30 = grand1to30.plus(party1to30);
        grand31to60 = grand31to60.plus(party31to60);
        grand61to90 = grand61to90.plus(party61to90);
        grandOver90 = grandOver90.plus(partyOver90);
        grandUnallocated = grandUnallocated.plus(unalloc);
      }
    }

    res.json({
      success: true,
      asOfDate,
      rows: resultRows,
      summary: {
        totalOutstanding: grandTotal.toNumber(),
        currentNotDue: grandNotDue.toNumber(),
        days1To30: grand1to30.toNumber(),
        days31To60: grand31to60.toNumber(),
        days61To90: grand61to90.toNumber(),
        daysOver90: grandOver90.toNumber(),
        totalUnallocated: grandUnallocated.toNumber(),
        netReceivables: grandTotal.minus(grandUnallocated).toNumber(),
        customersCount: resultRows.length
      }
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /payables: Supplier Aging Report as of Date
 */
agingRouter.get('/payables', requireAuth, requirePermission('aging.payables', 'reports.aging.suppliers', 'reports.view'), (req: AuthenticatedRequest, res: Response) => {
  const asOfDate = (req.query.asOfDate as string) || new Date().toISOString().split('T')[0];
  const branchId = req.query.branchId as string;
  const partyId = req.query.partyId as string;
  const currency = req.query.currency as string;

  if (branchId && branchId !== 'all' && !isBranchAllowed(req.user, branchId)) {
    return res.status(403).json({ error: 'الفرع المحدد خارج نطاق صلاحياتك.' });
  }

  try {
    let partyFilter = `WHERE p.type IN ('supplier', 'both')`;
    const partyParams: any[] = [];
    if (partyId && partyId !== 'all') {
      partyFilter += ` AND p.id = ?`;
      partyParams.push(partyId);
    }
    if (currency && currency !== 'all') {
      partyFilter += ` AND p.currency_code = ?`;
      partyParams.push(currency);
    }

    const parties = db.prepare(`
      SELECT p.id, p.code, p.name_ar, p.phone, p.credit_limit, p.payment_terms_days, p.currency_code
      FROM parties p
      ${partyFilter}
      ORDER BY p.name_ar ASC
    `).all(...partyParams) as any[];

    const resultRows: AgingBucketRow[] = [];
    let grandTotal = new Decimal(0);
    let grandNotDue = new Decimal(0);
    let grand1to30 = new Decimal(0);
    let grand31to60 = new Decimal(0);
    let grand61to90 = new Decimal(0);
    let grandOver90 = new Decimal(0);
    let grandUnallocated = new Decimal(0);

    for (const party of parties) {
      let invQuery = `
        SELECT id, invoice_number, branch_id, invoice_date, due_date, total_amount, payment_type
        FROM purchase_invoices
        WHERE supplier_id = ?
          AND invoice_date <= ?
          AND status != 'draft' AND status != 'cancelled'
      `;
      const invParams: any[] = [party.id, asOfDate];
      if (branchId && branchId !== 'all') {
        invQuery += ` AND branch_id = ?`;
        invParams.push(branchId);
      }

      const invoices = db.prepare(invQuery).all(...invParams) as any[];

      let partyNotDue = new Decimal(0);
      let party1to30 = new Decimal(0);
      let party31to60 = new Decimal(0);
      let party61to90 = new Decimal(0);
      let partyOver90 = new Decimal(0);
      let partyTotal = new Decimal(0);
      const openInvoices: any[] = [];

      for (const inv of invoices) {
        if (!isBranchAllowed(req.user, inv.branch_id)) continue;

        const totalAmt = new Decimal(inv.total_amount || 0);

        // Historical payments allocated to this invoice on or before asOfDate
        const allocRow = db.prepare(`
          SELECT COALESCE(SUM(va.allocated_amount), 0) as paid_as_of
          FROM voucher_allocations va
          JOIN payment_vouchers pv ON va.voucher_id = pv.id
          WHERE va.invoice_id = ? AND pv.status = 'posted' AND pv.voucher_date <= ?
        `).get(inv.id, asOfDate) as { paid_as_of: number };

        // Historical purchase returns on or before asOfDate
        const retRow = db.prepare(`
          SELECT COALESCE(SUM(pr.total_amount), 0) as ret_as_of
          FROM purchase_returns pr
          WHERE pr.original_invoice_id = ? AND pr.status = 'posted' AND pr.return_date <= ?
        `).get(inv.id, asOfDate) as { ret_as_of: number };

        const paidAsOf = new Decimal(allocRow?.paid_as_of || 0);
        const retAsOf = new Decimal(retRow?.ret_as_of || 0);
        const remainingAsOf = Decimal.max(0, totalAmt.minus(paidAsOf).minus(retAsOf));

        if (remainingAsOf.greaterThan(0.01)) {
          const daysLate = diffDays(asOfDate, inv.due_date);
          let bucket = 'current';

          if (daysLate <= 0) {
            bucket = 'current';
            partyNotDue = partyNotDue.plus(remainingAsOf);
          } else if (daysLate <= 30) {
            bucket = '1-30';
            party1to30 = party1to30.plus(remainingAsOf);
          } else if (daysLate <= 60) {
            bucket = '31-60';
            party31to60 = party31to60.plus(remainingAsOf);
          } else if (daysLate <= 90) {
            bucket = '61-90';
            party61to90 = party61to90.plus(remainingAsOf);
          } else {
            bucket = 'over90';
            partyOver90 = partyOver90.plus(remainingAsOf);
          }

          partyTotal = partyTotal.plus(remainingAsOf);
          openInvoices.push({
            id: inv.id,
            invoiceNumber: inv.invoice_number,
            invoiceDate: inv.invoice_date,
            dueDate: inv.due_date,
            totalAmount: totalAmt.toNumber(),
            remainingAmount: remainingAsOf.toNumber(),
            daysOverdue: Math.max(0, daysLate),
            bucket
          });
        }
      }

      // Check unallocated payment vouchers as of date
      const unallocRow = db.prepare(`
        SELECT COALESCE(SUM(unallocated_amount), 0) as unalloc_total
        FROM payment_vouchers
        WHERE party_id = ? AND voucher_type = 'payment' AND status = 'posted' AND voucher_date <= ?
      `).get(party.id, asOfDate) as { unalloc_total: number };

      const unalloc = new Decimal(unallocRow?.unalloc_total || 0);

      if (partyTotal.greaterThan(0) || unalloc.greaterThan(0)) {
        resultRows.push({
          partyId: party.id,
          partyCode: party.code,
          partyName: party.name_ar,
          partyPhone: party.phone,
          creditLimit: party.credit_limit,
          paymentTermsDays: party.payment_terms_days,
          totalOutstanding: partyTotal.toNumber(),
          currentNotDue: partyNotDue.toNumber(),
          days1To30: party1to30.toNumber(),
          days31To60: party31to60.toNumber(),
          days61To90: party61to90.toNumber(),
          daysOver90: partyOver90.toNumber(),
          unallocatedPayments: unalloc.toNumber(),
          invoices: openInvoices
        });

        grandTotal = grandTotal.plus(partyTotal);
        grandNotDue = grandNotDue.plus(partyNotDue);
        grand1to30 = grand1to30.plus(party1to30);
        grand31to60 = grand31to60.plus(party31to60);
        grand61to90 = grand61to90.plus(party61to90);
        grandOver90 = grandOver90.plus(partyOver90);
        grandUnallocated = grandUnallocated.plus(unalloc);
      }
    }

    res.json({
      success: true,
      asOfDate,
      rows: resultRows,
      summary: {
        totalOutstanding: grandTotal.toNumber(),
        currentNotDue: grandNotDue.toNumber(),
        days1To30: grand1to30.toNumber(),
        days31To60: grand31to60.toNumber(),
        days61To90: grand61to90.toNumber(),
        daysOver90: grandOver90.toNumber(),
        totalUnallocated: grandUnallocated.toNumber(),
        netPayables: grandTotal.minus(grandUnallocated).toNumber(),
        suppliersCount: resultRows.length
      }
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
