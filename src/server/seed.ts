import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import Decimal from 'decimal.js';
import { db } from './db.js';
import { postJournalEntry, getFiscalPeriodForDate } from './accounting-engine.js';

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, storedHash: string): { valid: boolean; needsRehash: boolean } {
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
    const valid = bcrypt.compareSync(plain, storedHash);
    return { valid, needsRehash: false };
  }
  // Fallback for legacy sha256
  const legacySha = crypto.createHash('sha256').update(plain).digest('hex');
  if (legacySha === storedHash) {
    return { valid: true, needsRehash: true };
  }
  return { valid: false, needsRehash: false };
}

export function seedInitialData(targetDb = db) {
  const conn = targetDb;
  const companyCheck = conn.prepare('SELECT COUNT(*) as cnt FROM companies').get() as { cnt: number };
  if (companyCheck && companyCheck.cnt > 0) {
    console.log('Database already has company data.');
    return;
  }

  console.log('Starting full Egyptian Commercial ERP Seed...');

  const db = targetDb;
  const transaction = db.transaction(() => {
    // 1. Company Information
    const companyId = 'comp_al_mizan';
    db.prepare(`
      INSERT INTO companies (
        id, name_ar, name_en, legal_name, commercial_registry, tax_id, vat_number,
        activity_code, address_ar, address_en, city, country, postal_code, phone, email, website
      ) VALUES (
        ?, 'شركة الميزان للتجارة والتوريدات ش.م.م', 'Al-Mizan Commercial Trading S.A.E',
        'شركة الميزان للتجارة والتوريدات المساهمة المصرية', '189452', '458-921-364', 'EG458921364',
        '4690', '15 شارع مكرم عبيد، المنطقة السادسة، مدينة نصر، القاهرة',
        '15 Makram Ebeid St, 6th District, Nasr City, Cairo', 'القاهرة', 'مصر', '11765',
        '+20 2 22718900', 'info@almizan-erp.eg', 'https://almizan-erp.eg'
      )
    `).run(companyId);

    // 2. Branches
    const branchCairoId = 'br_cairo';
    const branchAlexId = 'br_alex';
    db.prepare(`
      INSERT INTO branches (id, company_id, code, name_ar, name_en, address, phone)
      VALUES 
      (?, ?, 'CAI', 'الفرع الرئيسي - القاهرة (مدينة نصر)', 'Cairo Main Branch', '15 شارع مكرم عبيد، مدينة نصر', '+20 2 22718901'),
      (?, ?, 'ALX', 'فرع الإسكندرية (سموحة)', 'Alexandria Branch', 'شارع فوزي معاذ، سموحة، الإسكندرية', '+20 3 4298100')
    `).run(branchCairoId, companyId, branchAlexId, companyId);

    // 3. Fiscal Year 2026 and 12 Monthly Periods
    const yearId = 'fy_2026';
    db.prepare(`
      INSERT INTO fiscal_years (id, code, name_ar, name_en, start_date, end_date, is_closed)
      VALUES (?, '2026', 'السنة المالية 2026', 'Fiscal Year 2026', '2026-01-01', '2026-12-31', 0)
    `).run(yearId);

    const monthNamesAr = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const monthNamesEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    for (let m = 1; m <= 12; m++) {
      const pNum = m;
      const mm = m.toString().padStart(2, '0');
      const lastDay = new Date(2026, m, 0).getDate();
      const periodId = `fp_2026_${mm}`;
      db.prepare(`
        INSERT INTO fiscal_periods (id, fiscal_year_id, period_number, name_ar, name_en, start_date, end_date, is_closed)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        periodId, yearId, pNum,
        `فترة ${monthNamesAr[m - 1]} 2026`, `Period ${monthNamesEn[m - 1]} 2026`,
        `2026-${mm}-01`, `2026-${mm}-${lastDay}`
      );
    }

    // 4. Currencies
    db.prepare(`
      INSERT INTO currencies (code, name_ar, name_en, symbol, decimal_places, is_base)
      VALUES
      ('EGP', 'الجنيه المصري', 'Egyptian Pound', 'ج.م', 2, 1),
      ('USD', 'الدولار الأمريكي', 'US Dollar', '$', 2, 0),
      ('EUR', 'اليورو الأوروبي', 'Euro', '€', 2, 0),
      ('SAR', 'الريال السعودي', 'Saudi Riyal', 'ر.س', 2, 0)
    `).run();

    // Exchange Rates
    db.prepare(`
      INSERT INTO exchange_rates (id, currency_code, rate, rate_date)
      VALUES
      ('rate_usd_2026', 'USD', 48.50, '2026-01-01'),
      ('rate_eur_2026', 'EUR', 52.20, '2026-01-01'),
      ('rate_sar_2026', 'SAR', 12.92, '2026-01-01')
    `).run();

    // 5. Cost Centers
    db.prepare(`
      INSERT INTO cost_centers (id, code, name_ar, name_en)
      VALUES
      ('cc_admin', 'CC-101', 'الإدارة العامة والمكتب التنفيذي', 'General Administration'),
      ('cc_sales', 'CC-201', 'قطاع المبيعات والتسويق', 'Sales & Marketing'),
      ('cc_warehouses', 'CC-301', 'إدارة المخازن واللوجستيات', 'Warehousing & Logistics'),
      ('cc_tech', 'CC-401', 'إدارة تقنية المعلومات والدعم الفني', 'IT & Support')
    `).run();

    // 6. Complete Standard Egyptian Chart of Accounts (دليل الحسابات المصري الموحد)
    const accountsData = [
      // Level 1: Main Headings
      { id: 'acc_1', code: '1', name_ar: 'الأصول', name_en: 'Assets', parent: null, type: 'asset', nature: 'debit', is_group: 1, level: 1 },
      { id: 'acc_2', code: '2', name_ar: 'الالتزامات', name_en: 'Liabilities', parent: null, type: 'liability', nature: 'credit', is_group: 1, level: 1 },
      { id: 'acc_3', code: '3', name_ar: 'حقوق الملكية', name_en: 'Equity', parent: null, type: 'equity', nature: 'credit', is_group: 1, level: 1 },
      { id: 'acc_4', code: '4', name_ar: 'الإيرادات', name_en: 'Revenues', parent: null, type: 'revenue', nature: 'credit', is_group: 1, level: 1 },
      { id: 'acc_5', code: '5', name_ar: 'تكلفة المبيعات', name_en: 'Cost of Goods Sold', parent: null, type: 'cogs', nature: 'debit', is_group: 1, level: 1 },
      { id: 'acc_6', code: '6', name_ar: 'المصروفات التشغيلية والإدارية', name_en: 'Operating Expenses', parent: null, type: 'expense', nature: 'debit', is_group: 1, level: 1 },

      // Level 2 & 3: Assets
      { id: 'acc_11', code: '11', name_ar: 'الأصول المتداولة', name_en: 'Current Assets', parent: 'acc_1', type: 'asset', nature: 'debit', is_group: 1, level: 2 },
      { id: 'acc_111', code: '111', name_ar: 'النقدية وما في حكمها', name_en: 'Cash and Cash Equivalents', parent: 'acc_11', type: 'asset', nature: 'debit', is_group: 1, level: 3 },
      { id: 'acc_1111', code: '1111', name_ar: 'خزينة المركز الرئيسي - القاهرة', name_en: 'Cairo Main Cash Box', parent: 'acc_111', type: 'asset', nature: 'debit', is_group: 0, level: 4 },
      { id: 'acc_1112', code: '1112', name_ar: 'خزينة فرع الإسكندرية', name_en: 'Alexandria Cash Box', parent: 'acc_111', type: 'asset', nature: 'debit', is_group: 0, level: 4 },
      { id: 'acc_1113', code: '1113', name_ar: 'البنك الأهلي المصري (حساب جاري بالجنيه)', name_en: 'National Bank of Egypt (EGP)', parent: 'acc_111', type: 'asset', nature: 'debit', is_group: 0, level: 4 },
      { id: 'acc_1114', code: '1114', name_ar: 'بنك مصر (حساب جاري بالدولار)', name_en: 'Banque Misr (USD)', parent: 'acc_111', type: 'asset', nature: 'debit', is_group: 0, level: 4 },

      { id: 'acc_112', code: '112', name_ar: 'العملاء والمدينون', name_en: 'Accounts Receivable', parent: 'acc_11', type: 'asset', nature: 'debit', is_group: 1, level: 3 },
      { id: 'acc_1121', code: '1121', name_ar: 'العملاء التجاريون (حساب الرقابة العام)', name_en: 'Trade Debtors Control Account', parent: 'acc_112', type: 'asset', nature: 'debit', is_group: 0, level: 4, is_reconciliation: 1 },
      { id: 'acc_1122', code: '1122', name_ar: 'عملاء التوزيع والتجزئة', name_en: 'Retail Debtors', parent: 'acc_112', type: 'asset', nature: 'debit', is_group: 0, level: 4 },

      { id: 'acc_113', code: '113', name_ar: 'أوراق القبض', name_en: 'Notes Receivable', parent: 'acc_11', type: 'asset', nature: 'debit', is_group: 1, level: 3 },
      { id: 'acc_1131', code: '1131', name_ar: 'شيكات برسم التحصيل بالخزينة', name_en: 'Cheques in Hand', parent: 'acc_113', type: 'asset', nature: 'debit', is_group: 0, level: 4 },
      { id: 'acc_1132', code: '1132', name_ar: 'شيكات مودعة بالبنك للتحصيل', name_en: 'Cheques under Collection', parent: 'acc_113', type: 'asset', nature: 'debit', is_group: 0, level: 4 },

      { id: 'acc_114', code: '114', name_ar: 'المخزون السلعي', name_en: 'Inventory Asset', parent: 'acc_11', type: 'asset', nature: 'debit', is_group: 1, level: 3 },
      { id: 'acc_1141', code: '1141', name_ar: 'مخزون بضاعة بغرض البيع (المخزن الرئيسي)', name_en: 'Finished Goods Inventory - Cairo', parent: 'acc_114', type: 'asset', nature: 'debit', is_group: 0, level: 4 },
      { id: 'acc_1142', code: '1142', name_ar: 'مخزون فرع الإسكندرية', name_en: 'Inventory - Alexandria', parent: 'acc_114', type: 'asset', nature: 'debit', is_group: 0, level: 4 },
      { id: 'acc_1143', code: '1143', name_ar: 'مخزون بضاعة تالفة ومرتجعات فحص', name_en: 'Damaged & Inspection Stock', parent: 'acc_114', type: 'asset', nature: 'debit', is_group: 0, level: 4 },

      { id: 'acc_115', code: '115', name_ar: 'أرصدة مدينة لدى مصلحة الضرائب', name_en: 'Tax Authority Debit Balances', parent: 'acc_11', type: 'asset', nature: 'debit', is_group: 1, level: 3 },
      { id: 'acc_1151', code: '1151', name_ar: 'مصلحة الضرائب - ضريبة القيمة المضافة (مدخلات قابلة للخصم)', name_en: 'Input VAT Recoverable (14%)', parent: 'acc_115', type: 'asset', nature: 'debit', is_group: 0, level: 4 },
      { id: 'acc_1152', code: '1152', name_ar: 'مصلحة الضرائب - خصم وتحصيل مستقطع من العملاء (1%)', name_en: 'Withholding Tax Deducted by Customers', parent: 'acc_115', type: 'asset', nature: 'debit', is_group: 0, level: 4 },

      // Non-Current Assets
      { id: 'acc_12', code: '12', name_ar: 'الأصول غير المتداولة (الثابتة)', name_en: 'Non-Current Assets', parent: 'acc_1', type: 'asset', nature: 'debit', is_group: 1, level: 2 },
      { id: 'acc_1211', code: '1211', name_ar: 'أجهزة حاسب آلي ومعدات شبكات', name_en: 'Computers & IT Equipment', parent: 'acc_12', type: 'asset', nature: 'debit', is_group: 0, level: 3 },
      { id: 'acc_1212', code: '1212', name_ar: 'أثاث ومفروشات وتجهيزات مكتبية', name_en: 'Office Furniture & Fixtures', parent: 'acc_12', type: 'asset', nature: 'debit', is_group: 0, level: 3 },
      { id: 'acc_1213', code: '1213', name_ar: 'سيارات نقل وتوزيع', name_en: 'Vehicles & Delivery Trucks', parent: 'acc_12', type: 'asset', nature: 'debit', is_group: 0, level: 3 },
      { id: 'acc_1221', code: '1221', name_ar: 'مجمع إهلاك أجهزة حاسب آلي', name_en: 'Accum. Deprec. - Computers', parent: 'acc_12', type: 'asset', nature: 'credit', is_group: 0, level: 3 },
      { id: 'acc_1222', code: '1222', name_ar: 'مجمع إهلاك أثاث وتجهيزات', name_en: 'Accum. Deprec. - Furniture', parent: 'acc_12', type: 'asset', nature: 'credit', is_group: 0, level: 3 },
      { id: 'acc_1223', code: '1223', name_ar: 'مجمع إهلاك سيارات', name_en: 'Accum. Deprec. - Vehicles', parent: 'acc_12', type: 'asset', nature: 'credit', is_group: 0, level: 3 },

      // Liabilities
      { id: 'acc_21', code: '21', name_ar: 'الالتزامات المتداولة', name_en: 'Current Liabilities', parent: 'acc_2', type: 'liability', nature: 'credit', is_group: 1, level: 2 },
      { id: 'acc_211', code: '211', name_ar: 'الموردون والدائنون التجاريون', name_en: 'Accounts Payable', parent: 'acc_21', type: 'liability', nature: 'credit', is_group: 1, level: 3 },
      { id: 'acc_2111', code: '2111', name_ar: 'الموردون التجاريون (حساب الرقابة العام)', name_en: 'Trade Creditors Control Account', parent: 'acc_211', type: 'liability', nature: 'credit', is_group: 0, level: 4, is_reconciliation: 1 },
      { id: 'acc_2121', code: '2121', name_ar: 'أوراق الدفع (شيكات صادرة للموردين)', name_en: 'Notes Payable (Issued Cheques)', parent: 'acc_21', type: 'liability', nature: 'credit', is_group: 0, level: 3 },
      
      { id: 'acc_213', code: '213', name_ar: 'الالتزامات الضريبية (مصلحة الضرائب المصرية)', name_en: 'Tax Liabilities (ETA)', parent: 'acc_21', type: 'liability', nature: 'credit', is_group: 1, level: 3 },
      { id: 'acc_2131', code: '2131', name_ar: 'مصلحة الضرائب - ضريبة القيمة المضافة (مخرجات مستحقة 14%)', name_en: 'Output VAT Payable (14%)', parent: 'acc_213', type: 'liability', nature: 'credit', is_group: 0, level: 4 },
      { id: 'acc_2132', code: '2132', name_ar: 'مصلحة الضرائب - ضرائب الخصم والتحصيل أمانات (مستقطعة من الموردين)', name_en: 'Withholding Tax Payable (1%/3%)', parent: 'acc_213', type: 'liability', nature: 'credit', is_group: 0, level: 4 },
      { id: 'acc_2133', code: '2133', name_ar: 'مصلحة الضرائب - ضريبة كسب العمل', name_en: 'Payroll Tax Payable', parent: 'acc_213', type: 'liability', nature: 'credit', is_group: 0, level: 4 },
      { id: 'acc_2141', code: '2141', name_ar: 'مصروفات مستحقة وأرصدة دائنة أخرى', name_en: 'Accrued Expenses & Other Payables', parent: 'acc_21', type: 'liability', nature: 'credit', is_group: 0, level: 3 },

      // Equity
      { id: 'acc_31', code: '31', name_ar: 'رأس المال والاحتياطيات', name_en: 'Capital & Reserves', parent: 'acc_3', type: 'equity', nature: 'credit', is_group: 1, level: 2 },
      { id: 'acc_3111', code: '3111', name_ar: 'رأس المال المدفوع', name_en: 'Paid-in Capital', parent: 'acc_31', type: 'equity', nature: 'credit', is_group: 0, level: 3 },
      { id: 'acc_3211', code: '3211', name_ar: 'الاحتياطي القانوني', name_en: 'Legal Reserve', parent: 'acc_31', type: 'equity', nature: 'credit', is_group: 0, level: 3 },
      { id: 'acc_3311', code: '3311', name_ar: 'الأرباح المحتجزة / المرحلة', name_en: 'Retained Earnings', parent: 'acc_31', type: 'equity', nature: 'credit', is_group: 0, level: 3 },
      { id: 'acc_3411', code: '3411', name_ar: 'أرباح وخسائر العام الحالي', name_en: 'Current Year Profit/Loss', parent: 'acc_31', type: 'equity', nature: 'credit', is_group: 0, level: 3 },

      // Revenues
      { id: 'acc_41', code: '41', name_ar: 'إيرادات النشاط الرئيسي', name_en: 'Operating Revenues', parent: 'acc_4', type: 'revenue', nature: 'credit', is_group: 1, level: 2 },
      { id: 'acc_4111', code: '4111', name_ar: 'إيرادات مبيعات أجهزة وإلكترونيات', name_en: 'Sales Revenue - Electronics', parent: 'acc_41', type: 'revenue', nature: 'credit', is_group: 0, level: 3 },
      { id: 'acc_4112', code: '4112', name_ar: 'إيرادات مبيعات مستلزمات وإكسسوارات', name_en: 'Sales Revenue - Accessories', parent: 'acc_41', type: 'revenue', nature: 'credit', is_group: 0, level: 3 },
      { id: 'acc_4113', code: '4113', name_ar: 'إيرادات خدمات صيانة ودعم فني', name_en: 'Maintenance & Service Revenue', parent: 'acc_41', type: 'revenue', nature: 'credit', is_group: 0, level: 3 },
      { id: 'acc_4211', code: '4211', name_ar: 'مردودات ومسموحات المبيعات', name_en: 'Sales Returns & Allowances', parent: 'acc_41', type: 'revenue', nature: 'debit', is_group: 0, level: 3 },
      { id: 'acc_4311', code: '4311', name_ar: 'الخصم المسموح به للعملاء', name_en: 'Sales Discounts Allowed', parent: 'acc_41', type: 'revenue', nature: 'debit', is_group: 0, level: 3 },
      { id: 'acc_4511', code: '4511', name_ar: 'إيرادات متنوعة وأرباح فروق عملة', name_en: 'Other Income & Forex Gain', parent: 'acc_4', type: 'revenue', nature: 'credit', is_group: 0, level: 2 },

      // Cost of Goods Sold
      { id: 'acc_51', code: '51', name_ar: 'تكلفة النشاط والمبيعات', name_en: 'Cost of Sales', parent: 'acc_5', type: 'cogs', nature: 'debit', is_group: 1, level: 2 },
      { id: 'acc_5111', code: '5111', name_ar: 'تكلفة البضاعة المباعة (أجهزة وإلكترونيات)', name_en: 'COGS - Electronics', parent: 'acc_51', type: 'cogs', nature: 'debit', is_group: 0, level: 3 },
      { id: 'acc_5112', code: '5112', name_ar: 'تكلفة البضاعة المباعة (إكسسوارات)', name_en: 'COGS - Accessories', parent: 'acc_51', type: 'cogs', nature: 'debit', is_group: 0, level: 3 },
      { id: 'acc_5211', code: '5211', name_ar: 'عجز وتسويات المخزون السلعي والهالك', name_en: 'Inventory Shrinkage & Loss', parent: 'acc_51', type: 'cogs', nature: 'debit', is_group: 0, level: 3 },

      // Operating Expenses
      { id: 'acc_61', code: '61', name_ar: 'المصروفات البيعية والعمومية', name_en: 'Selling & Admin Expenses', parent: 'acc_6', type: 'expense', nature: 'debit', is_group: 1, level: 2 },
      { id: 'acc_6111', code: '6111', name_ar: 'الأجور والمرتبات والمكافآت', name_en: 'Salaries, Wages & Bonuses', parent: 'acc_61', type: 'expense', nature: 'debit', is_group: 0, level: 3 },
      { id: 'acc_6211', code: '6211', name_ar: 'إيجار المقرات والمعارض والمخازن', name_en: 'Rent Expense', parent: 'acc_61', type: 'expense', nature: 'debit', is_group: 0, level: 3 },
      { id: 'acc_6311', code: '6311', name_ar: 'إهلاك الأصول الثابتة', name_en: 'Depreciation Expense', parent: 'acc_61', type: 'expense', nature: 'debit', is_group: 0, level: 3 },
      { id: 'acc_6411', code: '6411', name_ar: 'كهرباء ومياه وغاز ومرافق', name_en: 'Utilities Expense', parent: 'acc_61', type: 'expense', nature: 'debit', is_group: 0, level: 3 },
      { id: 'acc_6412', code: '6412', name_ar: 'اتصالات وإنترنت وموقع إلكتروني', name_en: 'Telecommunications & Internet', parent: 'acc_61', type: 'expense', nature: 'debit', is_group: 0, level: 3 },
      { id: 'acc_6511', code: '6511', name_ar: 'مصاريف بنكية وعمولات تحصيل', name_en: 'Bank Charges & Commissions', parent: 'acc_61', type: 'expense', nature: 'debit', is_group: 0, level: 3 },
      { id: 'acc_6611', code: '6611', name_ar: 'خسائر فروق تقييم العملة الأجنبية', name_en: 'Foreign Exchange Losses', parent: 'acc_61', type: 'expense', nature: 'debit', is_group: 0, level: 3 }
    ];

    const insertAcc = db.prepare(`
      INSERT INTO accounts (id, code, name_ar, name_en, parent_id, account_type, nature, is_group, level, is_reconciliation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const a of accountsData) {
      insertAcc.run(a.id, a.code, a.name_ar, a.name_en, a.parent, a.type, a.nature, a.is_group, a.level, a.is_reconciliation || 0);
    }

    // 7. Warehouses
    const whMainId = 'wh_main';
    const whAlexId = 'wh_alex';
    const whDamagedId = 'wh_damaged';
    db.prepare(`
      INSERT INTO warehouses (id, branch_id, code, name_ar, name_en, address, is_damaged_stock)
      VALUES
      (?, ?, 'WH-CAI-01', 'المخزن الرئيسي - القاهرة (مصر الجديدة)', 'Cairo Central Warehouse', 'منطقة شيراتون، مصر الجديدة', 0),
      (?, ?, 'WH-ALX-01', 'مخزن فرع الإسكندرية (سموحة)', 'Alexandria Regional Warehouse', 'المنطقة الصناعية، سموحة', 0),
      (?, ?, 'WH-DMG-01', 'مخزن البضاعة المرتجعة والتالفة', 'Damaged & Inspection Warehouse', 'ملحق المخزن الرئيسي، القاهرة', 1)
    `).run(whMainId, branchCairoId, whAlexId, branchAlexId, whDamagedId, branchCairoId);

    // 8. Cash Boxes & Bank Accounts
    const cashCairoId = 'cash_cairo';
    const cashAlexId = 'cash_alex';
    db.prepare(`
      INSERT INTO cash_boxes (id, branch_id, code, name_ar, name_en, account_id, currency_code, current_balance)
      VALUES
      (?, ?, 'CASH-01', 'خزينة المركز الرئيسي - القاهرة', 'Cairo Main Cash Box', 'acc_1111', 'EGP', 150000.00),
      (?, ?, 'CASH-02', 'خزينة فرع الإسكندرية', 'Alexandria Cash Box', 'acc_1112', 'EGP', 75000.00)
    `).run(cashCairoId, branchCairoId, cashAlexId, branchAlexId);

    const bankNbeId = 'bank_nbe';
    const bankMisrId = 'bank_misr';
    db.prepare(`
      INSERT INTO bank_accounts (id, bank_name, account_number, iban, swift_code, branch_name, account_id, currency_code, current_balance)
      VALUES
      (?, 'البنك الأهلي المصري', '100458921001', 'EG380003010045892100100000100', 'NBEGEGCX', 'فرع مكرم عبيد', 'acc_1113', 'EGP', 850000.00),
      (?, 'بنك مصر', '200987114002', 'EG920002020098711400200000200', 'BMISEGCX', 'فرع سموحة', 'acc_1114', 'USD', 25000.00)
    `).run(bankNbeId, bankMisrId);

    // 9. Users and Roles
    const usersList = [
      { id: 'usr_owner', u: 'owner', name: 'المهندس / أحمد البدري (المالك)', role: 'owner' },
      { id: 'usr_admin', u: 'admin', name: 'الأستاذ / شريف فوزي (مدير النظام)', role: 'admin' },
      { id: 'usr_fin_mgr', u: 'financial_mgr', name: 'المحاسب القانوني / محمد عبد الرحمن (المدير المالي)', role: 'finance_manager' },
      { id: 'usr_accountant', u: 'accountant1', name: 'الأستاذة / مي حسن (محاسب عام)', role: 'accountant' },
      { id: 'usr_sales', u: 'sales_rep', name: 'الأستاذ / كريم سليم (مسؤول المبيعات)', role: 'sales_officer' },
      { id: 'usr_procurement', u: 'procurement', name: 'الأستاذ / طارق جلال (مسؤول المشتريات)', role: 'purchase_officer' },
      { id: 'usr_storekeeper', u: 'storekeeper', name: 'العم / حسن رضوان (أمين المخزن الرئيسي)', role: 'storekeeper' },
      { id: 'usr_cashier', u: 'cashier', name: 'الأستاذة / نورهان كمال (أمين الخزينة)', role: 'cashier' },
      { id: 'usr_auditor', u: 'auditor', name: 'مكتب مراجعة الحسابات (مراجع قراءة فقط)', role: 'auditor_readonly' },
    ];

    const passHash = hashPassword('admin123');
    const insertUser = db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, role, is_active, allowed_branch_ids, allowed_warehouse_ids, allowed_cashbox_ids)
      VALUES (?, ?, ?, ?, ?, 1, '*', '*', '*')
    `);
    for (const u of usersList) {
      insertUser.run(u.id, u.u, passHash, u.name, u.role);
    }

    // User permissions matrix with granular unit-specific and action permissions
    const rolesPermissions: Record<string, string[]> = {
      owner: [
        '*', 'view', 'add', 'edit_draft', 'delete_draft', 'approve', 'post', 'reverse', 'print', 'export',
        'view_cost', 'view_profit', 'manage_settings', 'reopen_period',
        'dashboard.view',
        'accounts.view', 'accounts.create', 'accounts.edit', 'accounts.delete', 'accounts.manage',
        'journal.view', 'journal.create', 'journal.edit_draft', 'journal.delete_draft', 'journal.post', 'journal.reverse', 'journal.print', 'journal.export',
        'sales.view', 'sales.create', 'sales.edit_draft', 'sales.delete_draft', 'sales.post', 'sales.reverse', 'sales.print', 'sales.export',
        'sales_returns.view', 'sales_returns.create', 'sales_returns.edit_draft', 'sales_returns.delete_draft', 'sales_returns.post', 'sales_returns.reverse', 'sales_returns.print',
        'purchases.view', 'purchases.create', 'purchases.edit_draft', 'purchases.delete_draft', 'purchases.post', 'purchases.reverse', 'purchases.print', 'purchases.export',
        'purchase_returns.view', 'purchase_returns.create', 'purchase_returns.edit_draft', 'purchase_returns.delete_draft', 'purchase_returns.post', 'purchase_returns.reverse', 'purchase_returns.print',
        'parties.view', 'parties.create', 'parties.edit', 'parties.delete', 'parties.statement',
        'inventory.view', 'items.view', 'items.create', 'items.edit', 'items.delete', 'items.manage',
        'treasury.view', 'treasury.receipt.create', 'treasury.payment.create', 'treasury.receipt', 'treasury.payment', 'treasury.reverse', 'treasury.print',
        'reports.view', 'reports.print', 'reports.export',
        'eta.view', 'eta.send',
        'tests.view', 'tests.run',
        'users.view', 'users.manage'
      ],
      admin: [
        'view', 'add', 'edit_draft', 'delete_draft', 'approve', 'post', 'reverse', 'print', 'export',
        'view_cost', 'view_profit', 'manage_settings',
        'dashboard.view',
        'accounts.view', 'accounts.create', 'accounts.edit', 'accounts.delete', 'accounts.manage',
        'journal.view', 'journal.create', 'journal.edit_draft', 'journal.delete_draft', 'journal.post', 'journal.reverse', 'journal.print', 'journal.export',
        'sales.view', 'sales.create', 'sales.edit_draft', 'sales.delete_draft', 'sales.post', 'sales.reverse', 'sales.print', 'sales.export',
        'sales_returns.view', 'sales_returns.create', 'sales_returns.edit_draft', 'sales_returns.delete_draft', 'sales_returns.post', 'sales_returns.reverse', 'sales_returns.print',
        'purchases.view', 'purchases.create', 'purchases.edit_draft', 'purchases.delete_draft', 'purchases.post', 'purchases.reverse', 'purchases.print', 'purchases.export',
        'purchase_returns.view', 'purchase_returns.create', 'purchase_returns.edit_draft', 'purchase_returns.delete_draft', 'purchase_returns.post', 'purchase_returns.reverse', 'purchase_returns.print',
        'parties.view', 'parties.create', 'parties.edit', 'parties.delete', 'parties.statement',
        'inventory.view', 'items.view', 'items.create', 'items.edit', 'items.delete', 'items.manage',
        'treasury.view', 'treasury.receipt.create', 'treasury.payment.create', 'treasury.receipt', 'treasury.payment', 'treasury.reverse', 'treasury.print',
        'reports.view', 'reports.print', 'reports.export',
        'eta.view', 'eta.send',
        'tests.view', 'tests.run',
        'users.view', 'users.manage'
      ],
      finance_manager: [
        'view', 'add', 'edit_draft', 'delete_draft', 'approve', 'post', 'reverse', 'print', 'export',
        'view_cost', 'view_profit', 'reopen_period',
        'dashboard.view',
        'accounts.view', 'accounts.create', 'accounts.edit', 'accounts.manage',
        'journal.view', 'journal.create', 'journal.edit_draft', 'journal.delete_draft', 'journal.post', 'journal.reverse', 'journal.print', 'journal.export',
        'sales.view', 'sales.create', 'sales.edit_draft', 'sales.post', 'sales.reverse', 'sales.print', 'sales.export',
        'sales_returns.view', 'sales_returns.create', 'sales_returns.edit_draft', 'sales_returns.post', 'sales_returns.reverse', 'sales_returns.print',
        'purchases.view', 'purchases.create', 'purchases.edit_draft', 'purchases.post', 'purchases.reverse', 'purchases.print', 'purchases.export',
        'purchase_returns.view', 'purchase_returns.create', 'purchase_returns.edit_draft', 'purchase_returns.post', 'purchase_returns.reverse', 'purchase_returns.print',
        'parties.view', 'parties.create', 'parties.edit', 'parties.statement',
        'inventory.view', 'items.view',
        'treasury.view', 'treasury.receipt.create', 'treasury.payment.create', 'treasury.receipt', 'treasury.payment', 'treasury.reverse', 'treasury.print',
        'reports.view', 'reports.print', 'reports.export',
        'eta.view', 'eta.send',
        'tests.view'
      ],
      accountant: [
        'view', 'add', 'edit_draft', 'delete_draft', 'post', 'print', 'export', 'view_cost', 'view_profit',
        'dashboard.view',
        'accounts.view', 'accounts.create', 'accounts.edit',
        'journal.view', 'journal.create', 'journal.edit_draft', 'journal.delete_draft', 'journal.post', 'journal.print', 'journal.export',
        'sales.view', 'sales.create', 'sales.edit_draft', 'sales.delete_draft', 'sales.post', 'sales.print', 'sales.export',
        'sales_returns.view', 'sales_returns.create', 'sales_returns.edit_draft', 'sales_returns.delete_draft', 'sales_returns.post', 'sales_returns.print',
        'purchases.view', 'purchases.create', 'purchases.edit_draft', 'purchases.delete_draft', 'purchases.post', 'purchases.print', 'purchases.export',
        'purchase_returns.view', 'purchase_returns.create', 'purchase_returns.edit_draft', 'purchase_returns.delete_draft', 'purchase_returns.post', 'purchase_returns.print',
        'parties.view', 'parties.create', 'parties.edit', 'parties.statement',
        'inventory.view', 'items.view',
        'treasury.view', 'treasury.receipt.create', 'treasury.payment.create', 'treasury.receipt', 'treasury.payment', 'treasury.print',
        'reports.view', 'reports.print', 'reports.export',
        'eta.view'
      ],
      sales_officer: [
        'view', 'add', 'edit_draft', 'delete_draft', 'print',
        'dashboard.view',
        'sales.view', 'sales.create', 'sales.edit_draft', 'sales.delete_draft', 'sales.print', 'sales.export',
        'sales_returns.view', 'sales_returns.create', 'sales_returns.edit_draft', 'sales_returns.delete_draft', 'sales_returns.print',
        'parties.view', 'parties.create', 'parties.statement',
        'inventory.view', 'items.view'
      ],
      purchase_officer: [
        'view', 'add', 'edit_draft', 'delete_draft', 'print', 'view_cost',
        'dashboard.view',
        'purchases.view', 'purchases.create', 'purchases.edit_draft', 'purchases.delete_draft', 'purchases.print', 'purchases.export',
        'purchase_returns.view', 'purchase_returns.create', 'purchase_returns.edit_draft', 'purchase_returns.delete_draft', 'purchase_returns.print',
        'parties.view', 'parties.create', 'parties.statement',
        'inventory.view', 'items.view'
      ],
      storekeeper: [
        'inventory.view', 'items.view', 'items.create', 'items.edit',
        'inventory_count.view',
        'sales.view', 'purchases.view'
      ],
      cashier: [
        'view', 'add', 'print',
        'treasury.view', 'treasury.receipt.create', 'treasury.payment.create', 'treasury.receipt', 'treasury.payment', 'treasury.print',
        'sales.view', 'parties.view'
      ],
      auditor_readonly: [
        'view', 'print', 'export', 'view_cost', 'view_profit',
        'dashboard.view', 'accounts.view', 'journal.view',
        'sales.view', 'sales_returns.view', 'purchases.view', 'purchase_returns.view',
        'parties.view', 'inventory.view', 'items.view', 'treasury.view',
        'reports.view', 'reports.print', 'reports.export', 'eta.view'
      ]
    };

    const insertPerm = db.prepare('INSERT OR IGNORE INTO user_permissions (id, role, permission_key) VALUES (?, ?, ?)');
    for (const [role, perms] of Object.entries(rolesPermissions)) {
      for (const p of perms) {
        insertPerm.run(`perm_${role}_${p}`, role, p);
      }
    }

    // 10. Parties (20 Egyptian Customers & 15 Egyptian Suppliers)
    const customersData = [
      { name: 'شركة النيل للتوكيلات التجارية ش.م.م', tax: '210-458-791', reg: '109230', limit: 500000, days: 45, city: 'القاهرة' },
      { name: 'مؤسسة الأهرام للتوزيع والتجهيزات', tax: '104-589-322', reg: '84920', limit: 750000, days: 60, city: 'الجيزة' },
      { name: 'شركة الدلتا للتجارة والتوزيع', tax: '315-782-901', reg: '92314', limit: 300000, days: 30, city: 'طنطا' },
      { name: 'مكتبة وموزع الشروق الحديثة', tax: '402-911-344', reg: '71203', limit: 150000, days: 15, city: 'القاهرة' },
      { name: 'شركة الإسكندرية لتكنولوجيا المعلومات', tax: '501-239-880', reg: '45812', limit: 400000, days: 30, city: 'الإسكندرية' },
      { name: 'مؤسسة المستقبل للأنظمة الرقمية', tax: '620-114-599', reg: '63201', limit: 250000, days: 30, city: 'المنصورة' },
      { name: 'شركة الصعيد للمقاولات والتوريدات', tax: '719-402-188', reg: '39410', limit: 350000, days: 45, city: 'أسيوط' },
      { name: 'مؤسسة الفراعنة للإلكترونيات', tax: '810-993-211', reg: '81290', limit: 600000, days: 45, city: 'القاهرة' },
      { name: 'شركة طيبة للتجهيزات الفندقية', tax: '904-182-377', reg: '52891', limit: 450000, days: 30, city: 'الغردقة' },
      { name: 'شركة البحر الأحمر للتسويق', tax: '118-294-601', reg: '67412', limit: 200000, days: 30, city: 'شرم الشيخ' },
      { name: 'مؤسسة الصفوة للأجهزة الذكية', tax: '229-385-712', reg: '99201', limit: 300000, days: 30, city: 'القاهرة' },
      { name: 'شركة السويس للخدمات اللوجستية', tax: '330-496-823', reg: '34190', limit: 180000, days: 15, city: 'السويس' },
      { name: 'مؤسسة النور للأدوات والمعدات', tax: '441-507-934', reg: '87214', limit: 220000, days: 30, city: 'الزقازيق' },
      { name: 'شركة بورسعيد التجارية الحرة', tax: '552-618-045', reg: '18492', limit: 500000, days: 45, city: 'بورسعيد' },
      { name: 'مؤسسة المنار للإلكترونيات', tax: '663-729-156', reg: '92410', limit: 150000, days: 30, city: 'بنها' },
      { name: 'شركة المهندسين لتجهيز المكاتب', tax: '774-830-267', reg: '64819', limit: 280000, days: 30, city: 'الجيزة' },
      { name: 'مؤسسة مصر للحلول المتكاملة', tax: '885-941-378', reg: '49201', limit: 400000, days: 45, city: 'القاهرة' },
      { name: 'شركة الوادي للتجارة والتوكيلات', tax: '996-052-489', reg: '78290', limit: 320000, days: 30, city: 'سوهاج' },
      { name: 'مؤسسة العروبة للتجارة العامة', tax: '107-163-590', reg: '81029', limit: 200000, days: 15, city: 'الإسماعيلية' },
      { name: 'شركة الأندلس للأنظمة المكتبية', tax: '218-274-601', reg: '95412', limit: 350000, days: 30, city: 'الإسكندرية' }
    ];

    const insertParty = db.prepare(`
      INSERT INTO parties (
        id, code, type, name_ar, name_en, tax_id, commercial_registry, phone, address, city, credit_limit, payment_terms_days, currency_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EGP')
    `);

    let custIndex = 1;
    for (const c of customersData) {
      const pId = `party_cust_${custIndex.toString().padStart(3, '0')}`;
      const code = `CUST-${custIndex.toString().padStart(4, '0')}`;
      insertParty.run(
        pId, code, 'customer', c.name, `Customer ${custIndex}`,
        c.tax, c.reg, `+20 2 27${custIndex}0000`, `شارع التجارة الرئيسي، ${c.city}`, c.city,
        c.limit, c.days
      );
      custIndex++;
    }

    const suppliersData = [
      { name: 'شركة سامسونج مصر للإلكترونيات ش.م.م', tax: '100-200-301', reg: '48201', city: 'بني سويف' },
      { name: 'شركة العربي للتجارة والصناعة (توشيبا)', tax: '200-300-402', reg: '18204', city: 'القاهرة' },
      { name: 'شركة إتش بي مصر للحواسب (HP Egypt)', tax: '300-400-503', reg: '93810', city: 'القرية الذكية، الجيزة' },
      { name: 'شركة ديل تكنولوجيز مصر (Dell Technologies)', tax: '400-500-604', reg: '84912', city: 'القاهرة الجديدة' },
      { name: 'شركة كانون الشرق الأوسط - مكتب مصر', tax: '500-600-705', reg: '39201', city: 'القاهرة' },
      { name: 'شركة راية للتوزيع ش.م.م', tax: '600-700-806', reg: '72910', city: 'مدينة 6 أكتوبر' },
      { name: 'شركة بي تك للتجارة والتوزيع (B.TECH)', tax: '700-800-907', reg: '61928', city: 'المقطم، القاهرة' },
      { name: 'شركة مانتراك مصر للمعدات والحلول', tax: '800-900-018', reg: '51920', city: 'الإسكندرية' },
      { name: 'الشركة المصرية الدولية للتوريدات المكتبية', tax: '900-010-129', reg: '49201', city: 'القاهرة' },
      { name: 'مؤسسة البشير للمستلزمات التقنية', tax: '110-220-330', reg: '88201', city: 'الجيزة' },
      { name: 'شركة لوجيتك للملحقات الرقمية', tax: '220-330-441', reg: '39401', city: 'القاهرة' },
      { name: 'شركة شنايدر إليكتريك مصر (Schneider Electric)', tax: '330-440-552', reg: '91823', city: 'التجمع الخامس' },
      { name: 'الشركة العربية لتصنيع الشاشات', tax: '440-550-663', reg: '74819', city: 'العاشر من رمضان' },
      { name: 'مؤسسة الهلال للتجهيزات المكتبية المتطورة', tax: '550-660-774', reg: '83910', city: 'طنطا' },
      { name: 'شركة إيديال للحلول الرقمية والأثاث المكتبي', tax: '660-770-885', reg: '29481', city: 'حلوان' }
    ];

    let suppIndex = 1;
    for (const s of suppliersData) {
      const pId = `party_supp_${suppIndex.toString().padStart(3, '0')}`;
      const code = `SUPP-${suppIndex.toString().padStart(4, '0')}`;
      insertParty.run(
        pId, code, 'supplier', s.name, `Supplier ${suppIndex}`,
        s.tax, s.reg, `+20 2 33${suppIndex}0000`, `المنطقة الصناعية، ${s.city}`, s.city,
        0, 30
      );
      suppIndex++;
    }

    // 11. 60 Commercial Products (Items)
    const itemsCatalog = [
      // 1-15: Laptops & Computers
      { name_ar: 'لابتوب ديل فوسترو 3520 كور i5 رام 8 جيجا هارد 512 SSD', name_en: 'Dell Vostro 3520 Core i5 8GB 512GB SSD', cat: 'أجهزة حاسب آلي', cost: 18500, sale: 22000, eta: 'EG-458921364-IT01' },
      { name_ar: 'لابتوب إتش بي 250 G9 كور i7 رام 16 جيجا هارد 1 تيرا SSD', name_en: 'HP 250 G9 Core i7 16GB 1TB SSD', cat: 'أجهزة حاسب آلي', cost: 26000, sale: 31000, eta: 'EG-458921364-IT02' },
      { name_ar: 'لابتوب لينوفو ثينك باد E14 كور i5 الجيل 13', name_en: 'Lenovo ThinkPad E14 Gen 5 i5', cat: 'أجهزة حاسب آلي', cost: 24500, sale: 28500, eta: 'EG-458921364-IT03' },
      { name_ar: 'كمبيوتر مكتبي ديل أوبتيبليكس 3000 ميني تاور', name_en: 'Dell OptiPlex 3000 MT Core i5', cat: 'أجهزة حاسب آلي', cost: 16500, sale: 19500, eta: 'EG-458921364-IT04' },
      { name_ar: 'سيرفر إتش بي بروليانت ML30 الجيل العاشر', name_en: 'HPE ProLiant ML30 Gen10 Server', cat: 'أجهزة حاسب آلي', cost: 65000, sale: 78000, eta: 'EG-458921364-IT05' },
      { name_ar: 'لابتوب أسوس زينبوك 14 شاشة أوليد كور i7', name_en: 'Asus ZenBook 14 OLED Core i7', cat: 'أجهزة حاسب آلي', cost: 38000, sale: 44000, eta: 'EG-458921364-IT06' },
      { name_ar: 'جهاز أبل ماك بوك أير M2 شاشة 13.6 بوصة رام 8 جيجا', name_en: 'Apple MacBook Air M2 13.6 8GB 256GB', cat: 'أجهزة حاسب آلي', cost: 42000, sale: 49500, eta: 'EG-458921364-IT07' },
      { name_ar: 'محطة عمل لينوفو ثينك ستيشن P3 تاور للمهندسين', name_en: 'Lenovo ThinkStation P3 Tower Workstation', cat: 'أجهزة حاسب آلي', cost: 72000, sale: 86000, eta: 'EG-458921364-IT08' },
      { name_ar: 'كمبيوتر ديل أول إن ون شاشة 24 بوصة لمس', name_en: 'Dell Inspiron All-in-One 24 Touch', cat: 'أجهزة حاسب آلي', cost: 25000, sale: 29500, eta: 'EG-458921364-IT09' },
      { name_ar: 'لابتوب إيسر أسباير 5 كور i5 بطاقة شاشة مستقلة', name_en: 'Acer Aspire 5 Core i5 Dedicated GPU', cat: 'أجهزة حاسب آلي', cost: 19500, sale: 23200, eta: 'EG-458921364-IT10' },

      // 16-25: Monitors & Display
      { name_ar: 'شاشة ديل 24 بوصة فل إتش دي IPS بدون حواف', name_en: 'Dell 24 FHD IPS Borderless Monitor E2423H', cat: 'شاشات وعرض', cost: 4100, sale: 5200, eta: 'EG-458921364-DIS01' },
      { name_ar: 'شاشة سامسونج 27 بوصة منحنية 75 هرتز', name_en: 'Samsung 27 Curved Monitor Essential', cat: 'شاشات وعرض', cost: 5600, sale: 6900, eta: 'EG-458921364-DIS02' },
      { name_ar: 'شاشة إتش بي 22 بوصة مضادة للتوهج للمكاتب', name_en: 'HP V22e 21.5 FHD Anti-Glare Monitor', cat: 'شاشات وعرض', cost: 3200, sale: 3950, eta: 'EG-458921364-DIS03' },
      { name_ar: 'شاشة إل جي 32 بوصة 4K UHD للمصممين', name_en: 'LG 32 4K UHD Monitor HDR10', cat: 'شاشات وعرض', cost: 14500, sale: 17800, eta: 'EG-458921364-DIS04' },
      { name_ar: 'شاشة بروجكتور عرض إبسون EB-E01 ساطعة 3300 لومن', name_en: 'Epson EB-E01 XGA 3300 Lumens Projector', cat: 'شاشات وعرض', cost: 16500, sale: 19900, eta: 'EG-458921364-DIS05' },

      // 26-35: Printers & Scanners
      { name_ar: 'طابعة إتش بي ليزر جيت برو M404dn شبكة ودوبلكس', name_en: 'HP LaserJet Pro M404dn Duplex Network', cat: 'طابعات وماسحات', cost: 9800, sale: 12200, eta: 'EG-458921364-PRN01' },
      { name_ar: 'طابعة إبسون إيكو تانك L3250 ألوان خزان حبر واي فاي', name_en: 'Epson EcoTank L3250 All-in-One Wi-Fi', cat: 'طابعات وماسحات', cost: 7400, sale: 9100, eta: 'EG-458921364-PRN02' },
      { name_ar: 'طابعة كانون آي-سينسيس ليزر ألوان متعددة المهام', name_en: 'Canon i-SENSYS MF655Cdw Multifunction', cat: 'طابعات وماسحات', cost: 18500, sale: 22800, eta: 'EG-458921364-PRN03' },
      { name_ar: 'ماسح ضوئي إبسون فاست فوت مكتبي سريع للوثائق', name_en: 'Epson WorkForce Document Scanner DS-530', cat: 'طابعات وماسحات', cost: 13200, sale: 16000, eta: 'EG-458921364-PRN04' },
      { name_ar: 'طابعة باركود وإيصالات حرارية زيبرا ZD220', name_en: 'Zebra ZD220 Direct Thermal Barcode Printer', cat: 'طابعات وماسحات', cost: 5800, sale: 7300, eta: 'EG-458921364-PRN05' },

      // 36-45: Networking & Power
      { name_ar: 'راوتر سيسكو 2911 للأعمال والشبكات الآمنة', name_en: 'Cisco 2911 Integrated Services Router', cat: 'شبكات واتصالات', cost: 22000, sale: 27500, eta: 'EG-458921364-NET01' },
      { name_ar: 'سويتش شبكة تي بي لينك 24 بورت جيجابت معدني', name_en: 'TP-Link 24-Port Gigabit Rackmount Switch', cat: 'شبكات واتصالات', cost: 3600, sale: 4500, eta: 'EG-458921364-NET02' },
      { name_ar: 'سويتش شبكة سيسكو كاتاليست 2960 بورت 48 مع PoE', name_en: 'Cisco Catalyst 2960 48-Port PoE Switch', cat: 'شبكات واتصالات', cost: 34000, sale: 42000, eta: 'EG-458921364-NET03' },
      { name_ar: 'أكسس بوينت يوبيكويتي يونيفاي يو 6 برو واي فاي 6', name_en: 'Ubiquiti UniFi U6 Pro Access Point Wi-Fi 6', cat: 'شبكات واتصالات', cost: 7100, sale: 8800, eta: 'EG-458921364-NET04' },
      { name_ar: 'جهاز يو بي إس شنايدر APC سمارت 1500 فولت أمبير', name_en: 'APC Smart-UPS 1500VA LCD 230V', cat: 'شبكات واتصالات', cost: 18500, sale: 23000, eta: 'EG-458921364-NET05' },

      // 46-55: Accessories & Peripherals
      { name_ar: 'كيبورد وماوس لاسلكي لوجيتك MK270', name_en: 'Logitech MK270 Wireless Combo', cat: 'ملحقات وإكسسوارات', cost: 950, sale: 1350, eta: 'EG-458921364-ACC01' },
      { name_ar: 'ماوس ليزر بلوتوث لوجيتك MX ماستر 3S الفاخر', name_en: 'Logitech MX Master 3S Wireless Mouse', cat: 'ملحقات وإكسسوارات', cost: 4200, sale: 5400, eta: 'EG-458921364-ACC02' },
      { name_ar: 'سماعة رأس مركز اتصالات جابرا إيفولف 20 يو إس بي', name_en: 'Jabra Evolve 20 Stereo USB Headset', cat: 'ملحقات وإكسسوارات', cost: 1400, sale: 1900, eta: 'EG-458921364-ACC03' },
      { name_ar: 'كاميرا ويب لوجيتك C920 برو فل إتش دي 1080p', name_en: 'Logitech C920 HD Pro Webcam', cat: 'ملحقات وإكسسوارات', cost: 3100, sale: 4100, eta: 'EG-458921364-ACC04' },
      { name_ar: 'هارد خارجي ويسترن ديجيتال 2 تيرا باسبورت USB 3.0', name_en: 'WD My Passport 2TB External HDD', cat: 'ملحقات وإكسسوارات', cost: 2400, sale: 3150, eta: 'EG-458921364-ACC05' },
      { name_ar: 'وحدة تخزين سامسونج SSD خارجية T7 سعة 1 تيرا', name_en: 'Samsung T7 1TB Portable SSD USB 3.2', cat: 'ملحقات وإكسسوارات', cost: 4900, sale: 6200, eta: 'EG-458921364-ACC06' },
      { name_ar: 'فلاشة كينجستون داتا ترافيلر 64 جيجا معدنية', name_en: 'Kingston 64GB DataTraveler USB 3.2', cat: 'ملحقات وإكسسوارات', cost: 180, sale: 280, eta: 'EG-458921364-ACC07' },
      { name_ar: 'كابل شبكة كات 6 بكرة 305 متر ماركة شنايدر', name_en: 'Schneider Actassi Cat6 UTP Cable 305m', cat: 'ملحقات وإكسسوارات', cost: 3800, sale: 4900, eta: 'EG-458921364-ACC08' },
      { name_ar: 'خرطوشة حبر إتش بي ليزر أسود أصلية 58A', name_en: 'HP 58A Black Original LaserJet Toner', cat: 'ملحقات وإكسسوارات', cost: 2900, sale: 3750, eta: 'EG-458921364-ACC09' },
      { name_ar: 'كرتونة ورق تصوير دبل إيه وزن 80 جرام 5 رزم (A4)', name_en: 'Double A Copy Paper A4 80gsm Box 5 Reams', cat: 'ملحقات وإكسسوارات', cost: 780, sale: 990, eta: 'EG-458921364-ACC10' },

      // 56-60: Professional Services (خدمات)
      { name_ar: 'خدمة تركيب وتمديد شبكات محلية (لكل نقطة)', name_en: 'Network Cabling & Termination Service', cat: 'خدمات فنية', cost: 100, sale: 250, is_service: true, eta: 'EG-458921364-SRV01' },
      { name_ar: 'عقد صيانة سنوي لأنظمة الحواسب والخوادم', name_en: 'Annual IT Infrastructure Maintenance Contract', cat: 'خدمات فنية', cost: 5000, sale: 12000, is_service: true, eta: 'EG-458921364-SRV02' },
      { name_ar: 'جلسة استشارات أمن سيبراني وضبط خوادم', name_en: 'Cybersecurity Audit & Server Hardening', cat: 'خدمات فنية', cost: 1500, sale: 4000, is_service: true, eta: 'EG-458921364-SRV03' },
      { name_ar: 'خدمة تركيب وضبط كاميرات المراقبة الرقمية', name_en: 'IP CCTV Installation & Configuration Service', cat: 'خدمات فنية', cost: 400, sale: 950, is_service: true, eta: 'EG-458921364-SRV04' },
      { name_ar: 'خدمة التدريب الفني وتسليم الأنظمة للعميل', name_en: 'On-site Technical Staff Training Service', cat: 'خدمات فنية', cost: 1000, sale: 2500, is_service: true, eta: 'EG-458921364-SRV05' }
    ];

    const insertItem = db.prepare(`
      INSERT INTO items (
        id, code, barcode, name_ar, name_en, item_type, category, base_unit,
        cost_price, sale_price, min_stock_level, moving_avg_cost, tax_rate, eta_item_code, eta_code_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 14.0, ?, 'EGS')
    `);

    const insertUnit = db.prepare(`
      INSERT INTO item_units (id, item_id, unit_name, conversion_factor, sale_price, is_base)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertStock = db.prepare(`
      INSERT INTO warehouse_stock (warehouse_id, item_id, quantity)
      VALUES (?, ?, ?)
    `);

    let itemIdx = 1;
    for (const it of itemsCatalog) {
      const itId = `item_${itemIdx.toString().padStart(3, '0')}`;
      const code = `ITM-${itemIdx.toString().padStart(4, '0')}`;
      const barcode = `622100${itemIdx.toString().padStart(6, '0')}`;
      const isServ = (it as any).is_service ? 'service' : 'stock';
      const baseUnit = (it as any).is_service ? 'خدمة' : 'قطعة';

      insertItem.run(
        itId, code, barcode, it.name_ar, it.name_en, isServ, it.cat, baseUnit,
        it.cost, it.sale, isServ === 'stock' ? 5 : 0, it.cost, it.eta
      );

      // Base unit
      insertUnit.run(`unit_base_${itemIdx}`, itId, baseUnit, 1.0, it.sale, 1);

      // Extra multi-unit for high-volume items (Carton of 10)
      if (it.cat === 'ملحقات وإكسسوارات' && isServ === 'stock') {
        insertUnit.run(`unit_carton_${itemIdx}`, itId, 'كرتونة (10 قطع)', 10.0, it.sale * 9.5, 0);
      }

      // Initial Stock in Warehouses
      if (isServ === 'stock') {
        const qtyCairo = 15 + (itemIdx % 20) * 3;
        const qtyAlex = 5 + (itemIdx % 10) * 2;
        insertStock.run(whMainId, itId, qtyCairo);
        insertStock.run(whAlexId, itId, qtyAlex);
      }

      itemIdx++;
    }

    // 12. Fixed Assets Records (3 Commercial Fixed Assets)
    db.prepare(`
      INSERT INTO fixed_assets (
        id, code, name_ar, name_en, branch_id, cost_center_id, purchase_date, operation_date,
        purchase_cost, scrap_value, useful_life_years, annual_depreciation_rate, accumulated_depreciation, book_value,
        asset_account_id, depreciation_expense_account_id, accumulated_depreciation_account_id
      ) VALUES
      ('fa_01', 'AST-001', 'أجهزة كمبيوتر وخوادم الإدارة الرئيسية', 'HQ Core Servers & PCs', 'br_cairo', 'cc_tech', '2025-01-01', '2025-01-01', 120000.00, 10000.00, 3, 33.33, 40000.00, 80000.00, 'acc_1211', 'acc_6311', 'acc_1221'),
      ('fa_02', 'AST-002', 'أثاث ومكاتب المقر الرئيسي وفرع الإسكندرية', 'Office Furniture & Desks', 'br_cairo', 'cc_admin', '2025-01-01', '2025-01-01', 80000.00, 5000.00, 5, 20.00, 16000.00, 64000.00, 'acc_1212', 'acc_6311', 'acc_1222'),
      ('fa_03', 'AST-003', 'سيارة نقل وتوزيع شيفروليه جامبو', 'Chevrolet Jumbo Distribution Truck', 'br_cairo', 'cc_warehouses', '2025-01-01', '2025-01-01', 350000.00, 50000.00, 5, 20.00, 70000.00, 280000.00, 'acc_1213', 'acc_6311', 'acc_1223')
    `).run();

    console.log('Master data created. Now posting Opening Journal Entry...');

    // 13. Opening Balance Journal Entry (قيد الافتتاح المتوازن بدقة)
    // Total Debit = Total Credit = 3,000,000 EGP
    const openingPeriod = getFiscalPeriodForDate('2026-01-01', db);
    postJournalEntry({
      docType: 'MANUAL',
      docId: 'OPENING_2026',
      docNumber: 'OPN-2026-001',
      entryDate: '2026-01-01',
      postingDate: '2026-01-01',
      branchId: branchCairoId,
      fiscalPeriodId: openingPeriod.id,
      description: 'قيد الأرصدة الافتتاحية المعتمدة للسنة المالية 2026',
      createdBy: 'usr_fin_mgr',
      lines: [
        // Assets (Debits)
        { accountId: 'acc_1111', debit: 150000, credit: 0, description: 'رصيد افتتاحي - خزينة القاهرة' },
        { accountId: 'acc_1112', debit: 75000, credit: 0, description: 'رصيد افتتاحي - خزينة الإسكندرية' },
        { accountId: 'acc_1113', debit: 850000, credit: 0, description: 'رصيد افتتاحي - البنك الأهلي المصري' },
        { accountId: 'acc_1114', debit: 1212500, credit: 0, description: 'رصيد افتتاحي - بنك مصر دولار ($25,000 @ 48.5)' },
        { accountId: 'acc_1121', debit: 420000, credit: 0, description: 'رصيد افتتاحي - حساب رقابة العملاء' },
        { accountId: 'acc_1141', debit: 550000, credit: 0, description: 'رصيد افتتاحي - مخزون البضائع بالقاهرة' },
        { accountId: 'acc_1142', debit: 220000, credit: 0, description: 'رصيد افتتاحي - مخزون البضائع بالإسكندرية' },
        { accountId: 'acc_1211', debit: 120000, credit: 0, description: 'رصيد افتتاحي - أجهزة حاسب آلي' },
        { accountId: 'acc_1212', debit: 80000, credit: 0, description: 'رصيد افتتاحي - أثاث ومفروشات' },
        { accountId: 'acc_1213', debit: 350000, credit: 0, description: 'رصيد افتتاحي - سيارات نقل' },

        // Liabilities & Accumulated Depreciation (Credits)
        { accountId: 'acc_1221', debit: 0, credit: 40000, description: 'رصيد افتتاحي - مجمع إهلاك حواسب' },
        { accountId: 'acc_1222', debit: 0, credit: 16000, description: 'رصيد افتتاحي - مجمع إهلاك أثاث' },
        { accountId: 'acc_1223', debit: 0, credit: 70000, description: 'رصيد افتتاحي - مجمع إهلاك سيارات' },
        { accountId: 'acc_2111', debit: 0, credit: 401500, description: 'رصيد افتتاحي - حساب رقابة الموردين' },

        // Equity (Credits)
        { accountId: 'acc_3111', debit: 0, credit: 2000000, description: 'رأس المال المصدر والمدفوع' },
        { accountId: 'acc_3211', debit: 0, credit: 300000, description: 'الاحتياطي القانوني' },
        { accountId: 'acc_3311', debit: 0, credit: 1200000, description: 'الأرباح المحتجزة من السنوات السابقة' },
      ]
    }, db);

    console.log('Opening entry posted. Total Debit == Total Credit.');

    // 14. Seed 3 Months of Transactions (January, February, March 2026)
    // Multiple Sales Invoices, Purchases, Receipts, Payments, and Returns
    console.log('Seeding transactions for 3 months...');

    const sampleInvoices = [
      {
        num: 'INV-2026-CAI-000001',
        date: '2026-01-15',
        cust: 'party_cust_001',
        items: [{ id: 'item_001', qty: 2, price: 22000, cost: 18500 }],
        payment: 'credit'
      },
      {
        num: 'INV-2026-CAI-000002',
        date: '2026-01-22',
        cust: 'party_cust_002',
        items: [{ id: 'item_002', qty: 3, price: 31000, cost: 26000 }, { id: 'item_011', qty: 4, price: 5200, cost: 4100 }],
        payment: 'credit'
      },
      {
        num: 'INV-2026-ALX-000003',
        date: '2026-02-05',
        cust: 'party_cust_005',
        items: [{ id: 'item_003', qty: 2, price: 28500, cost: 24500 }],
        payment: 'credit'
      },
      {
        num: 'INV-2026-CAI-000004',
        date: '2026-02-18',
        cust: 'party_cust_008',
        items: [{ id: 'item_016', qty: 2, price: 12200, cost: 9800 }],
        payment: 'cash'
      },
      {
        num: 'INV-2026-CAI-000005',
        date: '2026-03-02',
        cust: 'party_cust_010',
        items: [{ id: 'item_021', qty: 1, price: 27500, cost: 22000 }],
        payment: 'credit'
      }
    ];

    for (const inv of sampleInvoices) {
      const invId = `inv_${inv.num}`;
      let subtotal = 0;
      let totalCost = 0;
      for (const it of inv.items) {
        subtotal += it.qty * it.price;
        totalCost += it.qty * it.cost;
      }
      const vatAmount = subtotal * 0.14;
      const whtAmount = subtotal * 0.01; // Withholding tax 1%
      const totalAmount = subtotal + vatAmount - whtAmount;

      const p = getFiscalPeriodForDate(inv.date, db);
      const isAlex = inv.num.includes('ALX');
      const bId = isAlex ? branchAlexId : branchCairoId;
      const wId = isAlex ? whAlexId : whMainId;

      // 1. Post Journal Entry for the Sales Invoice
      const { entryId } = postJournalEntry({
        docType: 'SALES_INV',
        docId: invId,
        docNumber: inv.num,
        entryDate: inv.date,
        postingDate: inv.date,
        branchId: bId,
        fiscalPeriodId: p.id,
        description: `فاتورة مبيعات رقم ${inv.num}`,
        createdBy: 'usr_sales',
        lines: [
          // Debit Customer for Total
          { accountId: 'acc_1121', partyId: inv.cust, debit: totalAmount, credit: 0, description: `استحقاق فاتورة مبيعات ${inv.num}` },
          // Debit Withholding Tax Asset (1%)
          { accountId: 'acc_1152', debit: whtAmount, credit: 0, description: `ضريبة الخصم والتحصيل المستقطعة (1%) للفاتورة ${inv.num}` },
          // Credit Revenue
          { accountId: 'acc_4111', debit: 0, credit: subtotal, description: `إيراد مبيعات فاتورة ${inv.num}` },
          // Credit Output VAT (14%)
          { accountId: 'acc_2131', debit: 0, credit: vatAmount, description: `ضريبة القيمة المضافة (14%) فاتورة ${inv.num}` },

          // COGS & Stock Journal Entries
          { accountId: 'acc_5111', debit: totalCost, credit: 0, description: `تكلفة البضاعة المباعة للفاتورة ${inv.num}` },
          { accountId: isAlex ? 'acc_1142' : 'acc_1141', debit: 0, credit: totalCost, description: `صرف مخزون للفاتورة ${inv.num}` }
        ]
      }, db);

      // 2. Insert Sales Invoice Record
      db.prepare(`
        INSERT INTO sales_invoices (
          id, invoice_number, branch_id, warehouse_id, customer_id, invoice_date, due_date,
          payment_type, subtotal, discount_amount, taxable_amount, tax_amount, withholding_tax_amount,
          total_amount, paid_amount, remaining_amount, cogs_amount, status, journal_entry_id,
          eta_status, created_by
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, 'SimulationAccepted', 'usr_sales'
        )
      `).run(
        invId, inv.num, bId, wId, inv.cust, inv.date, inv.date,
        inv.payment, subtotal, subtotal, vatAmount, whtAmount,
        totalAmount, inv.payment === 'cash' ? totalAmount : 0, inv.payment === 'cash' ? 0 : totalAmount,
        totalCost, entryId
      );

      // 3. Insert Invoice Items & Update Stock
      for (const it of inv.items) {
        db.prepare(`
          INSERT INTO sales_invoice_items (
            id, invoice_id, item_id, unit_name, unit_factor, quantity, unit_price, cost_price, tax_rate, tax_amount, total_amount
          ) VALUES (?, ?, ?, 'قطعة', 1.0, ?, ?, ?, 14.0, ?, ?)
        `).run(
          `sii_${inv.num}_${it.id}`, invId, it.id, it.qty, it.price, it.cost, (it.qty * it.price * 0.14), (it.qty * it.price * 1.14)
        );

        db.prepare(`
          UPDATE warehouse_stock 
          SET quantity = quantity - ? 
          WHERE warehouse_id = ? AND item_id = ?
        `).run(it.qty, wId, it.id);
      }

      // If cash sale, also record the receipt entry and payment voucher
      if (inv.payment === 'cash') {
        const rcptPeriod = getFiscalPeriodForDate(inv.date, db);
        const rcptJe = postJournalEntry({
          docType: 'RCPT',
          docId: `rcpt_${inv.num}`,
          docNumber: `RC-${inv.num}`,
          entryDate: inv.date,
          postingDate: inv.date,
          branchId: bId,
          fiscalPeriodId: rcptPeriod.id,
          description: `سند تحصيل نقدي فوري للفاتورة ${inv.num}`,
          createdBy: 'usr_cashier',
          lines: [
            { accountId: 'acc_1111', debit: totalAmount, credit: 0, description: `تحصيل نقدي بالخزينة - فاتورة ${inv.num}` },
            { accountId: 'acc_1121', partyId: inv.cust, debit: 0, credit: totalAmount, description: `سداد قيمة الفاتورة ${inv.num}` }
          ]
        }, db);

        db.prepare(`
          INSERT INTO payment_vouchers (
            id, voucher_number, voucher_type, branch_id, payment_method, cash_box_id,
            party_id, voucher_date, amount, allocated_amount, unallocated_amount,
            description, journal_entry_id, status, created_by
          ) VALUES (?, ?, 'receipt', ?, 'cash', ?, ?, ?, ?, ?, 0, ?, ?, 'posted', 'usr_cashier')
        `).run(
          `pv_${inv.num}`, `RV-2026-${inv.num.slice(-6)}`, bId, cashCairoId,
          inv.cust, inv.date, totalAmount, totalAmount, `تحصيل نقدي للفاتورة ${inv.num}`, rcptJe.entryId
        );
      }
    }

    // 15. Seed Sample Purchase Invoices
    const samplePurchases = [
      {
        num: 'PINV-2026-CAI-000001',
        suppInv: 'SAMS-90214',
        supp: 'party_supp_001',
        date: '2026-01-10',
        payment: 'credit',
        items: [{ id: 'item_011', qty: 10, price: 4000 }] // monitors
      },
      {
        num: 'PINV-2026-CAI-000002',
        suppInv: 'HP-55410',
        supp: 'party_supp_003',
        date: '2026-02-01',
        payment: 'cash',
        items: [{ id: 'item_016', qty: 5, price: 9500 }] // printers
      }
    ];

    for (const pur of samplePurchases) {
      const pId = `pur_${pur.num}`;
      let subtotal = 0;
      for (const it of pur.items) {
        subtotal += it.qty * it.price;
      }
      const vat = subtotal * 0.14;
      const wht = subtotal * 0.01;
      const totalAmount = subtotal + vat - wht;
      const period = getFiscalPeriodForDate(pur.date, db);

      const purJe = postJournalEntry({
        docType: 'PUR_INV',
        docId: pId,
        docNumber: pur.num,
        entryDate: pur.date,
        postingDate: pur.date,
        branchId: branchCairoId,
        fiscalPeriodId: period.id,
        description: `فاتورة مشتريات رقم ${pur.num} من المورد`,
        createdBy: 'usr_procurement',
        lines: [
          { accountId: 'acc_1141', debit: subtotal, credit: 0, description: `إضافة مخزون مشتريات فاتورة ${pur.num}` },
          { accountId: 'acc_1151', debit: vat, credit: 0, description: `ضريبة مدخلات 14% فاتورة مشتريات ${pur.num}` },
          { accountId: pur.payment === 'cash' ? 'acc_1111' : 'acc_2111', partyId: pur.payment === 'cash' ? null : pur.supp, debit: 0, credit: totalAmount, description: `استحقاق المورد عن فاتورة مشتريات ${pur.num}` },
          { accountId: 'acc_2132', debit: 0, credit: wht, description: `أمانات خصم وتحصيل 1% فاتورة مشتريات ${pur.num}` }
        ]
      }, db);

      db.prepare(`
        INSERT INTO purchase_invoices (
          id, invoice_number, supplier_invoice_number, branch_id, warehouse_id, supplier_id,
          invoice_date, due_date, payment_type, subtotal, discount_amount, taxable_amount,
          tax_amount, withholding_tax_amount, total_amount, paid_amount, remaining_amount,
          status, journal_entry_id, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'posted', ?, 'usr_procurement')
      `).run(
        pId, pur.num, pur.suppInv, branchCairoId, whMainId, pur.supp, pur.date, pur.date,
        pur.payment, subtotal, subtotal, vat, wht, totalAmount, pur.payment === 'cash' ? totalAmount : 0,
        pur.payment === 'cash' ? 0 : totalAmount, purJe.entryId
      );

      for (const it of pur.items) {
        db.prepare(`
          INSERT INTO purchase_invoice_items (
            id, invoice_id, item_id, unit_name, unit_factor, quantity, unit_price, tax_rate, tax_amount, total_amount
          ) VALUES (?, ?, ?, 'قطعة', 1.0, ?, ?, 14.0, ?, ?)
        `).run(
          `pii_${pur.num}_${it.id}`, pId, it.id, it.qty, it.price, (it.qty * it.price * 0.14), (it.qty * it.price * 1.14)
        );

        db.prepare(`
          UPDATE warehouse_stock 
          SET quantity = quantity + ? 
          WHERE warehouse_id = ? AND item_id = ?
        `).run(it.qty, whMainId, it.id);
      }
    }

    // 16. Seed Sample Sales Return (for INV-2026-CAI-000001: 1 unit of item_001 returned)
    const retNum = 'RET-2026-CAI-000001';
    const retId = `ret_${retNum}`;
    const origInv = db.prepare('SELECT * FROM sales_invoices WHERE invoice_number = ?').get('INV-2026-CAI-000001') as any;
    if (origInv) {
      const retSubtotal = 22000;
      const retVat = retSubtotal * 0.14;
      const retWht = retSubtotal * 0.01;
      const retTotal = retSubtotal + retVat - retWht;
      const retCost = 18500;
      const retPeriod = getFiscalPeriodForDate('2026-01-20', db);

      const retJe = postJournalEntry({
        docType: 'SALES_RET',
        docId: retId,
        docNumber: retNum,
        entryDate: '2026-01-20',
        postingDate: '2026-01-20',
        branchId: branchCairoId,
        fiscalPeriodId: retPeriod.id,
        description: `مردود مبيعات جزئي للفاتورة ${origInv.invoice_number}`,
        createdBy: 'usr_sales',
        lines: [
          { accountId: 'acc_4211', debit: retSubtotal, credit: 0, description: `مردودات مبيعات ${retNum}` },
          { accountId: 'acc_2131', debit: retVat, credit: 0, description: `عكس ضريبة مبيعات ${retNum}` },
          { accountId: 'acc_1121', partyId: origInv.customer_id, debit: 0, credit: retTotal, description: `تخفيض مديونية العميل عن مردود ${retNum}` },
          { accountId: 'acc_1152', debit: 0, credit: retWht, description: `عكس خصم وتحصيل ${retNum}` },
          { accountId: 'acc_1141', debit: retCost, credit: 0, description: `إعادة مخزون بضاعة مرتجعة ${retNum}` },
          { accountId: 'acc_5111', debit: 0, credit: retCost, description: `عكس تكلفة مبيعات ${retNum}` }
        ]
      }, db);

      db.prepare(`
        INSERT INTO sales_returns (
          id, return_number, original_invoice_id, branch_id, warehouse_id, customer_id,
          return_date, refund_type, subtotal, tax_amount, withholding_tax_amount,
          total_amount, cogs_reversed_amount, journal_entry_id, status, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, '2026-01-20', 'credit_note', ?, ?, ?, ?, ?, ?, 'posted', 'usr_sales')
      `).run(
        retId, retNum, origInv.id, branchCairoId, whMainId, origInv.customer_id,
        retSubtotal, retVat, retWht, retTotal, retCost, retJe.entryId
      );

      db.prepare(`
        INSERT INTO sales_return_items (
          id, return_id, item_id, unit_name, unit_factor, quantity, unit_price, unit_cost, tax_rate, tax_amount, total_amount
        ) VALUES (?, ?, 'item_001', 'قطعة', 1.0, 1, 22000, 18500, 14.0, 3080, 25080)
      `).run(`sri_${retNum}_item001`, retId);

      // Update returned_quantity on sales_invoice_items
      db.prepare(`
        UPDATE sales_invoice_items 
        SET returned_quantity = returned_quantity + 1 
        WHERE invoice_id = ? AND item_id = 'item_001'
      `).run(origInv.id);

      // Restore stock
      db.prepare(`
        UPDATE warehouse_stock 
        SET quantity = quantity + 1 
        WHERE warehouse_id = ? AND item_id = 'item_001'
      `).run(whMainId);
    }

    // 17. Seed Initialized Document Sequences above existing seeded numbers
    const initialSeqs = [
      { docType: 'INV', branchId: branchCairoId, prefix: 'INV-2026-CAI', next: 7 },
      { docType: 'INV', branchId: branchAlexId, prefix: 'INV-2026-ALX', next: 1 },
      { docType: 'PINV', branchId: branchCairoId, prefix: 'PINV-2026-CAI', next: 3 },
      { docType: 'PINV', branchId: branchAlexId, prefix: 'PINV-2026-ALX', next: 1 },
      { docType: 'SR', branchId: branchCairoId, prefix: 'SR-2026-CAI', next: 2 },
      { docType: 'SR', branchId: branchAlexId, prefix: 'SR-2026-ALX', next: 1 },
      { docType: 'PR', branchId: branchCairoId, prefix: 'PR-2026-CAI', next: 1 },
      { docType: 'PR', branchId: branchAlexId, prefix: 'PR-2026-ALX', next: 1 },
      { docType: 'RV', branchId: branchCairoId, prefix: 'RV-2026-CAI', next: 10 },
      { docType: 'RV', branchId: branchAlexId, prefix: 'RV-2026-ALX', next: 1 },
      { docType: 'PV', branchId: branchCairoId, prefix: 'PV-2026-CAI', next: 5 },
      { docType: 'PV', branchId: branchAlexId, prefix: 'PV-2026-ALX', next: 1 },
      { docType: 'JV', branchId: branchCairoId, prefix: 'JV-2026-CAI', next: 30 },
      { docType: 'JV', branchId: branchAlexId, prefix: 'JV-2026-ALX', next: 1 },
    ];

    const insSeq = db.prepare(`
      INSERT OR REPLACE INTO document_sequences (id, doc_type, branch_id, fiscal_year_id, prefix, next_number)
      VALUES (?, ?, ?, 'fy_2026', ?, ?)
    `);

    // 18. Sync party_sequences and account_sequences with seeded records
    for (const pType of ['customer', 'supplier']) {
      const pfx = pType === 'supplier' ? 'SUPP' : 'CUST';
      const rows = db.prepare("SELECT code FROM parties WHERE code LIKE ?").all(`${pfx}-%`) as { code: string }[];
      let maxNum = 0;
      for (const r of rows) {
        const parts = r.code.split('-');
        const n = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
      db.prepare(`
        INSERT INTO party_sequences (type, last_number)
        VALUES (?, ?)
        ON CONFLICT(type) DO UPDATE SET last_number = MAX(last_number, excluded.last_number)
      `).run(pType, maxNum);
    }

    const parents = db.prepare('SELECT id, code FROM accounts WHERE is_group = 1').all() as { id: string; code: string }[];
    for (const p of parents) {
      const children = db.prepare('SELECT code FROM accounts WHERE parent_id = ?').all(p.id) as { code: string }[];
      let maxSub = 0;
      for (const c of children) {
        if (c.code.startsWith(p.code)) {
          const suffix = c.code.substring(p.code.length);
          const num = parseInt(suffix, 10);
          if (!isNaN(num) && num > maxSub) maxSub = num;
        }
      }
      if (maxSub > 0) {
        db.prepare(`
          INSERT INTO account_sequences (sequence_key, last_number)
          VALUES (?, ?)
          ON CONFLICT(sequence_key) DO UPDATE SET last_number = MAX(last_number, excluded.last_number)
        `).run(`parent_${p.id}`, maxSub);
      }
    }

    console.log('Seed completed successfully with sales, purchases, returns, and synced sequences!');
  });

  transaction();
}
