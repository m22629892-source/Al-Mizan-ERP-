export interface Company {
  id: string;
  name_ar: string;
  name_en: string;
  legal_name: string;
  commercial_registry: string;
  tax_id: string;
  vat_number: string;
  address_ar: string;
  city: string;
  country: string;
  phone: string;
  email: string;
}

export interface Branch {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  address?: string;
  phone?: string;
}

export interface Warehouse {
  id: string;
  branch_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  branch_name?: string;
  is_damaged_stock: number;
}

export interface CashBox {
  id: string;
  branch_id: string;
  code: string;
  name_ar: string;
  current_balance: number;
}

export interface BankAccount {
  id: string;
  bank_name: string;
  account_number: string;
  iban?: string;
  current_balance: number;
  currency_code: string;
}

export interface Account {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  parent_id?: string | null;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'cogs';
  nature: 'debit' | 'credit';
  is_group: number;
  level: number;
  current_balance: number;
  is_reconciliation?: number;
  is_active?: number;
}

export interface Party {
  id: string;
  code: string;
  type: 'customer' | 'supplier' | 'both';
  name_ar: string;
  name_en: string;
  tax_id?: string;
  commercial_registry?: string;
  phone?: string;
  address?: string;
  city?: string;
  credit_limit: number;
  payment_terms_days: number;
  current_balance: number;
  is_active?: number;
}

export interface ItemCategory {
  id: string;
  code: string;
  name_ar: string;
  name_en?: string;
  parent_id?: string | null;
  is_active: number;
  items_count?: number;
  created_at?: string;
}

export interface Item {
  id: string;
  code: string;
  barcode?: string;
  name_ar: string;
  name_en: string;
  item_type: 'stock' | 'service';
  category: string;
  category_id?: string;
  base_unit: string;
  cost_price: number;
  sale_price: number;
  moving_avg_cost: number;
  tax_rate?: number;
  min_stock_level: number;
  total_quantity: number;
  eta_item_code?: string;
  is_active?: number;
}

export interface JournalEntryLine {
  id: string;
  line_number: number;
  account_id: string;
  account_code: string;
  account_name: string;
  party_id?: string;
  party_name?: string;
  cost_center_id?: string;
  cost_center_name?: string;
  debit: number;
  credit: number;
  description?: string;
}

export interface JournalEntry {
  id: string;
  entry_number: string;
  doc_type: string;
  doc_number?: string;
  entry_date: string;
  posting_date: string;
  status: 'draft' | 'posted' | 'reversed';
  description: string;
  total_debit: number;
  total_credit: number;
  branch_name: string;
  period_name: string;
  created_by: string;
  reversed_entry_id?: string;
  lines?: JournalEntryLine[];
}

export interface SalesInvoiceItem {
  id: string;
  item_id: string;
  item_name: string;
  item_code: string;
  barcode?: string;
  eta_item_code?: string;
  quantity: number;
  unit_price: number;
  cost_price: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
}

export interface SalesInvoice {
  id: string;
  invoice_number: string;
  branch_id: string;
  branch_name?: string;
  warehouse_name?: string;
  customer_id: string;
  customer_name?: string;
  customer_tax_id?: string;
  customer_address?: string;
  invoice_date: string;
  due_date: string;
  payment_type: 'cash' | 'credit' | 'mixed';
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  tax_amount: number;
  withholding_tax_amount: number;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: string;
  eta_status?: string;
  eta_uuid?: string;
  journal_number?: string;
  items?: SalesInvoiceItem[];
}

export interface PaymentVoucher {
  id: string;
  voucher_number: string;
  voucher_type: 'receipt' | 'payment';
  voucher_date: string;
  branch_name: string;
  payment_method: string;
  cashbox_name?: string;
  bank_name?: string;
  party_name?: string;
  amount: number;
  allocated_amount?: number;
  unallocated_amount?: number;
  description: string;
  journal_number?: string;
  status: string;
}

export interface PurchaseInvoiceItem {
  id: string;
  item_id: string;
  item_name?: string;
  item_code?: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  returned_quantity?: number;
}

export interface PurchaseInvoice {
  id: string;
  invoice_number: string;
  supplier_invoice_number?: string;
  branch_id: string;
  branch_name?: string;
  warehouse_id: string;
  warehouse_name?: string;
  supplier_id: string;
  supplier_name?: string;
  supplier_tax_id?: string;
  invoice_date: string;
  due_date: string;
  payment_type: 'cash' | 'credit';
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  tax_amount: number;
  withholding_tax_amount: number;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: string;
  journal_number?: string;
  items?: PurchaseInvoiceItem[];
}

export interface SalesReturnItem {
  id: string;
  item_id: string;
  item_name?: string;
  item_code?: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
}

export interface SalesReturn {
  id: string;
  return_number: string;
  original_invoice_id: string;
  original_invoice_number?: string;
  branch_id: string;
  branch_name?: string;
  warehouse_id: string;
  warehouse_name?: string;
  customer_id: string;
  customer_name?: string;
  return_date: string;
  refund_type: 'credit_note' | 'cash';
  subtotal: number;
  tax_amount: number;
  withholding_tax_amount: number;
  total_amount: number;
  status: string;
  journal_number?: string;
  items?: SalesReturnItem[];
}

export interface PurchaseReturnItem {
  id: string;
  item_id: string;
  item_name?: string;
  item_code?: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
}

export interface PurchaseReturn {
  id: string;
  return_number: string;
  original_purchase_invoice_id: string;
  original_invoice_number?: string;
  branch_id: string;
  branch_name?: string;
  warehouse_id: string;
  warehouse_name?: string;
  supplier_id: string;
  supplier_name?: string;
  return_date: string;
  refund_type: 'debit_note' | 'cash';
  subtotal: number;
  tax_amount: number;
  withholding_tax_amount: number;
  total_amount: number;
  status: string;
  journal_number?: string;
  items?: PurchaseReturnItem[];
}

export interface User {
  id: string;
  username: string;
  display_name: string;
  role: string;
  is_active: number;
  permissions?: string[];
  permissions_csv?: string;
  allowed_branch_ids?: string;
  allowed_warehouse_ids?: string;
  allowed_cashbox_ids?: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  username?: string;
  display_name?: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details?: string;
  ip_address?: string;
  created_at: string;
}

export interface PeriodClosingDiagnostic {
  key: string;
  category: 'control_account' | 'unbalanced_je' | 'unposted_draft' | 'unallocated_voucher' | 'bank_variance';
  severity: 'blocking' | 'warning';
  title_ar: string;
  title_en: string;
  expectedValue: number | string;
  actualValue: number | string;
  variance: number;
  isPassed: boolean;
  message_ar: string;
  documents?: {
    id: string;
    number: string;
    date: string;
    amount: number;
    type: string;
  }[];
}

export interface PeriodClosingStatus {
  period: {
    id: string;
    period_number: number;
    name_ar: string;
    name_en: string;
    start_date: string;
    end_date: string;
    is_closed: number;
    closed_at?: string;
    closed_by?: string;
  };
  fiscalYear: {
    id: string;
    code: string;
    name_ar: string;
    is_closed: number;
  };
  canClose: boolean;
  blockingCount: number;
  warningCount: number;
  lastReviewDate: string;
  diagnostics: PeriodClosingDiagnostic[];
  reconciliationSummary: {
    customersSubledger: number;
    customersControlAccount: number;
    customersVariance: number;
    suppliersSubledger: number;
    suppliersControlAccount: number;
    suppliersVariance: number;
    inventoryValuation: number;
    inventoryControlAccount: number;
    inventoryVariance: number;
    cashSubledger: number;
    cashControlAccount: number;
    bankSubledger: number;
    bankControlAccount: number;
  };
}

export interface BankStatementLine {
  id: string;
  statement_id: string;
  bank_account_id: string;
  line_date: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  is_matched: number;
  matched_voucher_id?: string;
  matched_journal_line_id?: string;
  matched_at?: string;
  matched_by?: string;
}

export interface BankReconciliationRecord {
  id: string;
  bank_account_id: string;
  period_id: string;
  reconciliation_date: string;
  statement_balance: number;
  book_balance: number;
  adjusted_bank_balance: number;
  adjusted_book_balance: number;
  variance: number;
  status: 'draft' | 'approved';
  approved_by?: string;
  approved_at?: string;
  notes?: string;
  created_at: string;
}

export interface InventoryCountItem {
  id: string;
  count_id: string;
  item_id: string;
  item_code: string;
  item_name: string;
  category: string;
  base_unit: string;
  system_quantity: number;
  counted_quantity: number;
  diff_quantity: number;
  unit_cost: number;
  total_diff_cost: number;
  notes?: string;
}

export interface InventoryCount {
  id: string;
  count_number: string;
  branch_id: string;
  branch_name?: string;
  warehouse_id: string;
  warehouse_name?: string;
  count_date: string;
  status: 'draft' | 'posted' | 'cancelled';
  notes?: string;
  journal_number?: string;
  total_shortage_cost: number;
  total_surplus_cost: number;
  net_variance_cost: number;
  created_by: string;
  created_at: string;
  posted_by?: string;
  posted_at?: string;
  items?: InventoryCountItem[];
}

export interface SystemBackup {
  id: string;
  filename: string;
  file_path: string;
  file_size: number;
  schema_version: string;
  integrity_status: string;
  record_counts: Record<string, number>;
  created_by: string;
  created_at: string;
}

export interface AgingBucketRow {
  partyId: string;
  partyCode: string;
  partyName: string;
  partyPhone?: string;
  creditLimit?: number;
  paymentTermsDays?: number;
  totalOutstanding: number;
  currentNotDue: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  daysOver90: number;
  unallocatedPayments: number;
  invoices: {
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    totalAmount: number;
    remainingAmount: number;
    daysOverdue: number;
    bucket: string;
  }[];
}

export interface ActionRequiredSummary {
  overdueSalesCount: number;
  overdueSalesTotal: number;
  overduePurchasesCount: number;
  overduePurchasesTotal: number;
  unallocatedVouchersCount: number;
  unallocatedVouchersTotal: number;
  draftsTotalCount: number;
  draftSalesCount: number;
  draftPurchasesCount: number;
  draftReturnsCount: number;
  draftJournalsCount: number;
  lowStockItemsCount: number;
}

export type ColumnDataType = 'number' | 'date' | 'text' | 'category' | 'currency';

export interface ColumnMeta {
  name: string;
  originalName: string;
  index: number;
  inferredType: ColumnDataType;
  userType?: ColumnDataType;
  totalCount: number;
  nonEmptyCount: number;
  nullCount: number;
  uniqueCount: number;
  sampleValues: any[];
}

export interface SheetAnalysis {
  name: string;
  totalRows: number;
  headerRowIndex: number;
  columns: ColumnMeta[];
  duplicateRowsCount: number;
  currenciesDetected: string[];
  hasInvoiceNumbers: boolean;
  hasSalesAndReturns: boolean;
}
