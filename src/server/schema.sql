-- Al-Mizan ERP Relational Database Schema (SQLite 3.x with Strict Types & Foreign Keys)

-- 1. Company Information
CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    legal_name TEXT NOT NULL,
    commercial_registry TEXT NOT NULL,
    tax_id TEXT NOT NULL, -- 9 digits Egyptian Tax Registration
    vat_number TEXT,
    activity_code TEXT,
    address_ar TEXT NOT NULL,
    address_en TEXT,
    city TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'مصر',
    postal_code TEXT,
    phone TEXT,
    email TEXT,
    website TEXT,
    logo_url TEXT,
    currency_code TEXT NOT NULL DEFAULT 'EGP',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Branches
CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    code TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Fiscal Years & Periods
CREATE TABLE IF NOT EXISTS fiscal_years (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_closed INTEGER NOT NULL DEFAULT 0,
    closed_at DATETIME,
    closed_by TEXT
);

CREATE TABLE IF NOT EXISTS fiscal_periods (
    id TEXT PRIMARY KEY,
    fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
    period_number INTEGER NOT NULL,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_closed INTEGER NOT NULL DEFAULT 0,
    closed_at DATETIME,
    closed_by TEXT,
    UNIQUE(fiscal_year_id, period_number)
);

-- 4. Currencies & Exchange Rates
CREATE TABLE IF NOT EXISTS currencies (
    code TEXT PRIMARY KEY, -- EGP, USD, EUR, SAR
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    symbol TEXT NOT NULL,
    decimal_places INTEGER NOT NULL DEFAULT 2,
    is_base INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS exchange_rates (
    id TEXT PRIMARY KEY,
    currency_code TEXT NOT NULL REFERENCES currencies(code),
    rate NUMERIC NOT NULL,
    rate_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(currency_code, rate_date)
);

-- 5. Cost Centers & Projects
CREATE TABLE IF NOT EXISTS cost_centers (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    parent_id TEXT REFERENCES cost_centers(id),
    is_active INTEGER NOT NULL DEFAULT 1
);

-- 6. Chart of Accounts (دليل الحسابات الهرمي)
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    parent_id TEXT REFERENCES accounts(id),
    account_type TEXT NOT NULL, -- asset, liability, equity, revenue, expense, cogs
    nature TEXT NOT NULL, -- debit, credit
    is_group INTEGER NOT NULL DEFAULT 0, -- 1: parent category (cannot post to), 0: posting account
    level INTEGER NOT NULL DEFAULT 1,
    currency_code TEXT REFERENCES currencies(code),
    is_reconciliation INTEGER NOT NULL DEFAULT 0, -- Is Control Account for Customers/Suppliers
    is_active INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_accounts_code ON accounts(code);

-- 7. Document Sequences (Per branch, document type, and year)
CREATE TABLE IF NOT EXISTS document_sequences (
    id TEXT PRIMARY KEY,
    doc_type TEXT NOT NULL, -- JV, SI, PI, SR, PR, CR, CP, ST, FA
    branch_id TEXT NOT NULL REFERENCES branches(id),
    fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
    prefix TEXT NOT NULL,
    next_number INTEGER NOT NULL DEFAULT 1,
    UNIQUE(doc_type, branch_id, fiscal_year_id)
);

-- 8. Parties (Customers & Suppliers / أطراف المعاملات)
CREATE TABLE IF NOT EXISTS parties (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL, -- customer, supplier, both
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    tax_id TEXT, -- الرقم الضريبي المصري
    commercial_registry TEXT, -- السجل التجاري
    national_id TEXT, -- الرقم القومي إن وجد
    is_company INTEGER NOT NULL DEFAULT 1,
    phone TEXT,
    mobile TEXT,
    email TEXT,
    address TEXT,
    city TEXT,
    governorate TEXT,
    credit_limit NUMERIC NOT NULL DEFAULT 0,
    payment_terms_days INTEGER NOT NULL DEFAULT 0,
    currency_code TEXT NOT NULL DEFAULT 'EGP' REFERENCES currencies(code),
    account_id TEXT REFERENCES accounts(id), -- Linked specific account if any, otherwise uses control account
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS party_contacts (
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    contact_name TEXT NOT NULL,
    job_title TEXT,
    phone TEXT,
    email TEXT
);

-- 9. Warehouses & Storage Locations
CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL REFERENCES branches(id),
    code TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    address TEXT,
    is_damaged_stock INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
);

-- 10. Items, Units & Stock (الأصناف والمخزون)
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    barcode TEXT,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    item_type TEXT NOT NULL, -- stock, service
    category TEXT NOT NULL DEFAULT 'عام',
    base_unit TEXT NOT NULL DEFAULT 'قطعة',
    cost_price NUMERIC NOT NULL DEFAULT 0,
    sale_price NUMERIC NOT NULL DEFAULT 0,
    min_stock_level NUMERIC NOT NULL DEFAULT 0,
    moving_avg_cost NUMERIC NOT NULL DEFAULT 0,
    tax_rate NUMERIC NOT NULL DEFAULT 14.0, -- Standard Egyptian VAT is 14%
    eta_item_code TEXT, -- GS1 / EGS code for Egyptian Tax Authority
    eta_code_type TEXT DEFAULT 'EGS',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS item_units (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    unit_name TEXT NOT NULL,
    conversion_factor NUMERIC NOT NULL DEFAULT 1.0, -- Relative to base unit
    sale_price NUMERIC NOT NULL DEFAULT 0,
    barcode TEXT,
    is_base INTEGER NOT NULL DEFAULT 0,
    UNIQUE(item_id, unit_name)
);

CREATE TABLE IF NOT EXISTS warehouse_stock (
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    item_id TEXT NOT NULL REFERENCES items(id),
    quantity NUMERIC NOT NULL DEFAULT 0,
    reserved_qty NUMERIC NOT NULL DEFAULT 0,
    PRIMARY KEY(warehouse_id, item_id)
);

-- 11. Journal Entries (قيود اليومية العامة)
CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    entry_number TEXT NOT NULL UNIQUE,
    doc_type TEXT NOT NULL, -- MANUAL, SALES_INV, PUR_INV, SALES_RET, PUR_RET, RCPT, PYMT, STK_ADJ, ASSET_DEP, CLOSING, REVERSAL
    doc_id TEXT,
    doc_number TEXT,
    entry_date DATE NOT NULL,
    posting_date DATE NOT NULL,
    fiscal_period_id TEXT NOT NULL REFERENCES fiscal_periods(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    status TEXT NOT NULL DEFAULT 'posted', -- draft, pending_approval, approved, posted, reversed
    description TEXT NOT NULL,
    total_debit NUMERIC NOT NULL DEFAULT 0,
    total_credit NUMERIC NOT NULL DEFAULT 0,
    currency_code TEXT NOT NULL DEFAULT 'EGP' REFERENCES currencies(code),
    exchange_rate NUMERIC NOT NULL DEFAULT 1.0,
    reversed_entry_id TEXT REFERENCES journal_entries(id),
    is_system_generated INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    posted_by TEXT,
    posted_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_je_date ON journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_je_status ON journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_je_doc ON journal_entries(doc_type, doc_id);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    party_id TEXT REFERENCES parties(id),
    cost_center_id TEXT REFERENCES cost_centers(id),
    debit NUMERIC NOT NULL DEFAULT 0,
    credit NUMERIC NOT NULL DEFAULT 0,
    description TEXT,
    currency_code TEXT NOT NULL DEFAULT 'EGP',
    exchange_rate NUMERIC NOT NULL DEFAULT 1.0,
    amount_currency NUMERIC NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jel_account ON journal_entry_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_jel_party ON journal_entry_lines(party_id);
CREATE INDEX IF NOT EXISTS idx_jel_entry ON journal_entry_lines(entry_id);

-- 12. Sales Invoices & Items (فواتير المبيعات)
CREATE TABLE IF NOT EXISTS sales_invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT NOT NULL UNIQUE,
    branch_id TEXT NOT NULL REFERENCES branches(id),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    customer_id TEXT NOT NULL REFERENCES parties(id),
    invoice_date DATE NOT NULL,
    due_date DATE NOT NULL,
    payment_type TEXT NOT NULL, -- cash, credit, mixed
    currency_code TEXT NOT NULL DEFAULT 'EGP' REFERENCES currencies(code),
    exchange_rate NUMERIC NOT NULL DEFAULT 1.0,
    subtotal NUMERIC NOT NULL DEFAULT 0,
    discount_amount NUMERIC NOT NULL DEFAULT 0,
    taxable_amount NUMERIC NOT NULL DEFAULT 0,
    tax_amount NUMERIC NOT NULL DEFAULT 0, -- 14% VAT
    withholding_tax_amount NUMERIC NOT NULL DEFAULT 0, -- خصم وتحصيل تحت حساب الضريبة (1%)
    total_amount NUMERIC NOT NULL DEFAULT 0,
    paid_amount NUMERIC NOT NULL DEFAULT 0,
    remaining_amount NUMERIC NOT NULL DEFAULT 0,
    cogs_amount NUMERIC NOT NULL DEFAULT 0, -- Total COGS recorded
    status TEXT NOT NULL DEFAULT 'posted', -- draft, posted, partially_paid, paid, cancelled, reversed
    notes TEXT,
    journal_entry_id TEXT REFERENCES journal_entries(id),
    eta_uuid TEXT,
    eta_submission_id TEXT,
    eta_status TEXT DEFAULT 'NotSubmitted', -- NotSubmitted, Submitted, Valid, Invalid, Cancelled
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales_invoice_items (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id),
    unit_name TEXT NOT NULL,
    unit_factor NUMERIC NOT NULL DEFAULT 1.0,
    quantity NUMERIC NOT NULL,
    returned_quantity NUMERIC NOT NULL DEFAULT 0,
    unit_price NUMERIC NOT NULL,
    cost_price NUMERIC NOT NULL DEFAULT 0, -- Historical unit cost at time of sale
    discount_percent NUMERIC NOT NULL DEFAULT 0,
    discount_amount NUMERIC NOT NULL DEFAULT 0,
    tax_rate NUMERIC NOT NULL DEFAULT 14.0,
    tax_amount NUMERIC NOT NULL DEFAULT 0,
    total_amount NUMERIC NOT NULL
);

-- 13. Sales Returns (مردودات المبيعات)
CREATE TABLE IF NOT EXISTS sales_returns (
    id TEXT PRIMARY KEY,
    return_number TEXT NOT NULL UNIQUE,
    original_invoice_id TEXT REFERENCES sales_invoices(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    customer_id TEXT NOT NULL REFERENCES parties(id),
    return_date DATE NOT NULL,
    refund_type TEXT NOT NULL, -- credit_note, cash
    subtotal NUMERIC NOT NULL DEFAULT 0,
    tax_amount NUMERIC NOT NULL DEFAULT 0,
    withholding_tax_amount NUMERIC NOT NULL DEFAULT 0,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    refunded_cash_amount NUMERIC NOT NULL DEFAULT 0,
    cogs_reversed_amount NUMERIC NOT NULL DEFAULT 0,
    journal_entry_id TEXT REFERENCES journal_entries(id),
    status TEXT NOT NULL DEFAULT 'posted',
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales_return_items (
    id TEXT PRIMARY KEY,
    return_id TEXT NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
    original_invoice_item_id TEXT REFERENCES sales_invoice_items(id),
    item_id TEXT NOT NULL REFERENCES items(id),
    unit_name TEXT NOT NULL,
    unit_factor NUMERIC NOT NULL DEFAULT 1.0,
    quantity NUMERIC NOT NULL,
    unit_price NUMERIC NOT NULL,
    unit_cost NUMERIC NOT NULL,
    tax_rate NUMERIC NOT NULL DEFAULT 14.0,
    tax_amount NUMERIC NOT NULL DEFAULT 0,
    total_amount NUMERIC NOT NULL
);

-- 14. Purchase Invoices & Items (فواتير المشتريات)
CREATE TABLE IF NOT EXISTS purchase_invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT NOT NULL UNIQUE,
    supplier_invoice_number TEXT,
    branch_id TEXT NOT NULL REFERENCES branches(id),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    supplier_id TEXT NOT NULL REFERENCES parties(id),
    invoice_date DATE NOT NULL,
    due_date DATE NOT NULL,
    payment_type TEXT NOT NULL, -- cash, credit
    currency_code TEXT NOT NULL DEFAULT 'EGP' REFERENCES currencies(code),
    exchange_rate NUMERIC NOT NULL DEFAULT 1.0,
    subtotal NUMERIC NOT NULL DEFAULT 0,
    discount_amount NUMERIC NOT NULL DEFAULT 0,
    taxable_amount NUMERIC NOT NULL DEFAULT 0,
    tax_amount NUMERIC NOT NULL DEFAULT 0,
    withholding_tax_amount NUMERIC NOT NULL DEFAULT 0,
    additional_expenses NUMERIC NOT NULL DEFAULT 0,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    paid_amount NUMERIC NOT NULL DEFAULT 0,
    remaining_amount NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'posted',
    notes TEXT,
    journal_entry_id TEXT REFERENCES journal_entries(id),
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_invoice_items (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id),
    unit_name TEXT NOT NULL,
    unit_factor NUMERIC NOT NULL DEFAULT 1.0,
    quantity NUMERIC NOT NULL,
    returned_quantity NUMERIC NOT NULL DEFAULT 0,
    unit_price NUMERIC NOT NULL,
    discount_percent NUMERIC NOT NULL DEFAULT 0,
    discount_amount NUMERIC NOT NULL DEFAULT 0,
    tax_rate NUMERIC NOT NULL DEFAULT 14.0,
    tax_amount NUMERIC NOT NULL DEFAULT 0,
    total_amount NUMERIC NOT NULL
);

-- 15. Purchase Returns (مردودات المشتريات)
CREATE TABLE IF NOT EXISTS purchase_returns (
    id TEXT PRIMARY KEY,
    return_number TEXT NOT NULL UNIQUE,
    original_invoice_id TEXT REFERENCES purchase_invoices(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    supplier_id TEXT NOT NULL REFERENCES parties(id),
    return_date DATE NOT NULL,
    subtotal NUMERIC NOT NULL DEFAULT 0,
    tax_amount NUMERIC NOT NULL DEFAULT 0,
    withholding_tax_amount NUMERIC NOT NULL DEFAULT 0,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    journal_entry_id TEXT REFERENCES journal_entries(id),
    status TEXT NOT NULL DEFAULT 'posted',
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_return_items (
    id TEXT PRIMARY KEY,
    return_id TEXT NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id),
    quantity NUMERIC NOT NULL,
    unit_price NUMERIC NOT NULL,
    tax_rate NUMERIC NOT NULL DEFAULT 14.0,
    tax_amount NUMERIC NOT NULL DEFAULT 0,
    total_amount NUMERIC NOT NULL
);

-- 16. Treasury & Banks (الخزائن والبنوك)
CREATE TABLE IF NOT EXISTS cash_boxes (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL REFERENCES branches(id),
    code TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    currency_code TEXT NOT NULL DEFAULT 'EGP' REFERENCES currencies(code),
    current_balance NUMERIC NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bank_accounts (
    id TEXT PRIMARY KEY,
    bank_name TEXT NOT NULL,
    account_number TEXT NOT NULL,
    iban TEXT,
    swift_code TEXT,
    branch_name TEXT,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    currency_code TEXT NOT NULL DEFAULT 'EGP' REFERENCES currencies(code),
    current_balance NUMERIC NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
);

-- 17. Payment Vouchers & Allocations (سندات القبض والصرف)
CREATE TABLE IF NOT EXISTS payment_vouchers (
    id TEXT PRIMARY KEY,
    voucher_number TEXT NOT NULL UNIQUE,
    voucher_type TEXT NOT NULL, -- receipt (قبض), payment (صرف)
    branch_id TEXT NOT NULL REFERENCES branches(id),
    payment_method TEXT NOT NULL, -- cash, bank_transfer, cheque
    cash_box_id TEXT REFERENCES cash_boxes(id),
    bank_account_id TEXT REFERENCES bank_accounts(id),
    party_id TEXT REFERENCES parties(id),
    direct_account_id TEXT REFERENCES accounts(id), -- For direct expense/revenue vouchers
    cost_center_id TEXT REFERENCES cost_centers(id),
    voucher_date DATE NOT NULL,
    amount NUMERIC NOT NULL,
    currency_code TEXT NOT NULL DEFAULT 'EGP' REFERENCES currencies(code),
    exchange_rate NUMERIC NOT NULL DEFAULT 1.0,
    allocated_amount NUMERIC NOT NULL DEFAULT 0,
    unallocated_amount NUMERIC NOT NULL DEFAULT 0,
    description TEXT NOT NULL,
    journal_entry_id TEXT REFERENCES journal_entries(id),
    status TEXT NOT NULL DEFAULT 'posted',
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS voucher_allocations (
    id TEXT PRIMARY KEY,
    voucher_id TEXT NOT NULL REFERENCES payment_vouchers(id) ON DELETE CASCADE,
    invoice_type TEXT NOT NULL, -- sales_invoice, purchase_invoice
    invoice_id TEXT NOT NULL,
    allocated_amount NUMERIC NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 18. Cheques Management (دورة الشيكات)
CREATE TABLE IF NOT EXISTS cheques (
    id TEXT PRIMARY KEY,
    cheque_number TEXT NOT NULL,
    cheque_type TEXT NOT NULL, -- received (شيك قبض), issued (شيك دفع)
    bank_name TEXT NOT NULL,
    branch_id TEXT NOT NULL REFERENCES branches(id),
    party_id TEXT NOT NULL REFERENCES parties(id),
    amount NUMERIC NOT NULL,
    due_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_portfolio', -- in_portfolio, under_collection, collected, bounced, cancelled
    deposit_bank_id TEXT REFERENCES bank_accounts(id),
    collection_date DATE,
    bounce_date DATE,
    bounce_reason TEXT,
    journal_entry_id TEXT REFERENCES journal_entries(id),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 19. Stock Transactions & Inventory Counting (حركات المخزون والجرد)
CREATE TABLE IF NOT EXISTS stock_transactions (
    id TEXT PRIMARY KEY,
    trans_number TEXT NOT NULL UNIQUE,
    trans_type TEXT NOT NULL, -- receipt, issue, transfer, physical_count, adjustment
    branch_id TEXT NOT NULL REFERENCES branches(id),
    from_warehouse_id TEXT REFERENCES warehouses(id),
    to_warehouse_id TEXT REFERENCES warehouses(id),
    trans_date DATE NOT NULL,
    notes TEXT,
    journal_entry_id TEXT REFERENCES journal_entries(id),
    status TEXT NOT NULL DEFAULT 'posted',
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_transaction_items (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES stock_transactions(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id),
    quantity NUMERIC NOT NULL,
    unit_cost NUMERIC NOT NULL,
    total_cost NUMERIC NOT NULL,
    batch_number TEXT,
    expiry_date DATE
);

-- 20. Fixed Assets & Depreciation (الأصول الثابتة والإهلاك)
CREATE TABLE IF NOT EXISTS fixed_assets (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    branch_id TEXT NOT NULL REFERENCES branches(id),
    cost_center_id TEXT REFERENCES cost_centers(id),
    purchase_date DATE NOT NULL,
    operation_date DATE NOT NULL,
    purchase_cost NUMERIC NOT NULL,
    scrap_value NUMERIC NOT NULL DEFAULT 0,
    useful_life_years NUMERIC NOT NULL,
    depreciation_method TEXT NOT NULL DEFAULT 'straight_line', -- straight_line (القسط الثابت)
    annual_depreciation_rate NUMERIC NOT NULL,
    accumulated_depreciation NUMERIC NOT NULL DEFAULT 0,
    book_value NUMERIC NOT NULL,
    asset_account_id TEXT NOT NULL REFERENCES accounts(id),
    depreciation_expense_account_id TEXT NOT NULL REFERENCES accounts(id),
    accumulated_depreciation_account_id TEXT NOT NULL REFERENCES accounts(id),
    status TEXT NOT NULL DEFAULT 'active', -- active, disposed, sold
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fixed_asset_depreciations (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES fixed_assets(id),
    depreciation_date DATE NOT NULL,
    amount NUMERIC NOT NULL,
    journal_entry_id TEXT REFERENCES journal_entries(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(asset_id, depreciation_date)
);

-- 21. Users, Roles & Granular Permissions
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL, -- owner, admin, finance_manager, accountant, sales_officer, purchase_officer, storekeeper, cashier, auditor_readonly
    is_active INTEGER NOT NULL DEFAULT 1,
    force_change_password INTEGER NOT NULL DEFAULT 0,
    allowed_branch_ids TEXT, -- JSON array of branch IDs, or '*' for all
    allowed_warehouse_ids TEXT, -- JSON array
    allowed_cashbox_ids TEXT, -- JSON array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_permissions (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    permission_key TEXT NOT NULL, -- view, add, edit_draft, approve, post, reverse, print, export, view_cost, view_profit, change_price, override_discount, override_credit, manage_settings, reopen_period
    UNIQUE(role, permission_key)
);

-- 22. Immutable Audit Log (سجل التدقيق غير القابل للتعديل)
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL, -- LOGIN, POST_JOURNAL, REVERSE_ENTRY, CREATE_INVOICE, APPROVE_PAYMENT, REOPEN_PERIOD, etc.
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    details TEXT,
    old_values TEXT, -- JSON
    new_values TEXT, -- JSON
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);

-- 23. ETA Egyptian Tax Authority E-Invoicing Submissions
CREATE TABLE IF NOT EXISTS eta_submissions (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES sales_invoices(id),
    submission_uuid TEXT NOT NULL UNIQUE,
    eta_document_id TEXT,
    submission_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL, -- Submitted, Valid, Invalid, Rejected
    eta_code TEXT,
    error_details TEXT,
    hash_signature TEXT,
    json_payload TEXT
);

-- 24. Period Closings & Re-open Audit Logs (إقفال ومراجعة الفترات المالية)
CREATE TABLE IF NOT EXISTS period_closings (
    id TEXT PRIMARY KEY,
    period_id TEXT NOT NULL REFERENCES fiscal_periods(id),
    closed_by TEXT NOT NULL,
    closed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    summary_json TEXT NOT NULL -- Detailed snapshot of trial balance, control accounts, drafts, and reconciliation
);

CREATE TABLE IF NOT EXISTS period_reopen_logs (
    id TEXT PRIMARY KEY,
    period_id TEXT NOT NULL REFERENCES fiscal_periods(id),
    reopened_by TEXT NOT NULL,
    reopened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reason TEXT NOT NULL,
    previous_status TEXT NOT NULL DEFAULT 'closed'
);

-- 25. Bank Reconciliation & Statements (تسوية كشف الحساب البنكي)
CREATE TABLE IF NOT EXISTS bank_statements (
    id TEXT PRIMARY KEY,
    bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
    statement_date DATE NOT NULL,
    opening_balance NUMERIC NOT NULL DEFAULT 0,
    closing_balance NUMERIC NOT NULL DEFAULT 0,
    filename TEXT,
    imported_by TEXT NOT NULL,
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
    id TEXT PRIMARY KEY,
    statement_id TEXT NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
    bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
    line_date DATE NOT NULL,
    reference TEXT,
    description TEXT NOT NULL,
    debit NUMERIC NOT NULL DEFAULT 0,
    credit NUMERIC NOT NULL DEFAULT 0,
    is_matched INTEGER NOT NULL DEFAULT 0,
    matched_voucher_id TEXT REFERENCES payment_vouchers(id),
    matched_journal_line_id TEXT REFERENCES journal_entry_lines(id),
    matched_at DATETIME,
    matched_by TEXT
);

CREATE TABLE IF NOT EXISTS bank_reconciliations (
    id TEXT PRIMARY KEY,
    bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
    period_id TEXT NOT NULL REFERENCES fiscal_periods(id),
    reconciliation_date DATE NOT NULL,
    statement_balance NUMERIC NOT NULL DEFAULT 0,
    book_balance NUMERIC NOT NULL DEFAULT 0,
    adjusted_bank_balance NUMERIC NOT NULL DEFAULT 0,
    adjusted_book_balance NUMERIC NOT NULL DEFAULT 0,
    variance NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft', -- draft, approved
    approved_by TEXT,
    approved_at DATETIME,
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 26. Physical Inventory Count & Stock Adjustments (جرد المخزون ومحاضر التسوية)
CREATE TABLE IF NOT EXISTS inventory_counts (
    id TEXT PRIMARY KEY,
    count_number TEXT NOT NULL UNIQUE,
    branch_id TEXT NOT NULL REFERENCES branches(id),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    count_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', -- draft, posted, cancelled
    notes TEXT,
    journal_entry_id TEXT REFERENCES journal_entries(id),
    stock_transaction_id TEXT REFERENCES stock_transactions(id),
    total_shortage_cost NUMERIC NOT NULL DEFAULT 0,
    total_surplus_cost NUMERIC NOT NULL DEFAULT 0,
    net_variance_cost NUMERIC NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    posted_by TEXT,
    posted_at DATETIME
);

CREATE TABLE IF NOT EXISTS inventory_count_items (
    id TEXT PRIMARY KEY,
    count_id TEXT NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id),
    system_quantity NUMERIC NOT NULL DEFAULT 0,
    counted_quantity NUMERIC NOT NULL DEFAULT 0,
    diff_quantity NUMERIC NOT NULL DEFAULT 0,
    unit_cost NUMERIC NOT NULL DEFAULT 0,
    total_diff_cost NUMERIC NOT NULL DEFAULT 0,
    notes TEXT
);

-- 27. Excel Import Logs & Tracking (سجلات استيراد البيانات والأرصدة)
CREATE TABLE IF NOT EXISTS excel_imports_log (
    id TEXT PRIMARY KEY,
    import_type TEXT NOT NULL, -- chart_of_accounts, parties, items, opening_balances
    filename TEXT NOT NULL,
    total_rows INTEGER NOT NULL DEFAULT 0,
    valid_rows INTEGER NOT NULL DEFAULT 0,
    error_rows INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL, -- previewed, committed, failed
    details_json TEXT,
    imported_by TEXT NOT NULL,
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 28. System Backups Registry (سجل النسخ الاحتياطية المتسقة)
CREATE TABLE IF NOT EXISTS system_backups (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    schema_version TEXT NOT NULL DEFAULT '1.0',
    integrity_status TEXT NOT NULL DEFAULT 'OK',
    record_counts_json TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

