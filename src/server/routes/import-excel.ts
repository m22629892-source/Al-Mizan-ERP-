import { Router, Response } from 'express';
import Decimal from 'decimal.js';
import * as XLSX from 'xlsx';
import { db } from '../db.js';
import { AuthenticatedRequest, requireAuth, requirePermission, isBranchAllowed, isWarehouseAllowed } from '../api.js';
import { postJournalEntry, getFiscalPeriodForDate, logAudit } from '../accounting-engine.js';

export const importExcelRouter = Router();

/**
 * Generate Excel Template with Schema and Realistic Egyptian Accounting Data
 */
importExcelRouter.get('/templates/:type', requireAuth, requirePermission('import.excel', 'excel_import.view'), (req: AuthenticatedRequest, res: Response) => {
  const { type } = req.params;
  const wb = XLSX.utils.book_new();

  if (type === 'chart_of_accounts') {
    const data = [
      { 'كود الحساب': '1115', 'اسم الحساب بالعربي': 'خزينة فرع المعادي', 'اسم الحساب بالإنجليزي': 'Maadi Branch Cashbox', 'كود حساب الأب': '111', 'نوع الحساب': 'asset', 'طبيعة الحساب': 'debit', 'حساب رئيسي (1/0)': 0, 'المستوى': 4 },
      { 'كود الحساب': '6112', 'اسم الحساب بالعربي': 'مصاريف بوفيه وضيافة', 'اسم الحساب بالإنجليزي': 'Hospitality Expense', 'كود حساب الأب': '61', 'نوع الحساب': 'expense', 'طبيعة الحساب': 'debit', 'حساب رئيسي (1/0)': 0, 'المستوى': 3 }
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'دليل الحسابات');
  } else if (type === 'parties') {
    const data = [
      { 'النوع (customer/supplier)': 'customer', 'كود الطرف': 'CUST-0099', 'الاسم بالعربي': 'شركة النيل للخدمات الهندسية', 'الاسم بالإنجليزي': 'Nile Engineering Co', 'الرقم الضريبي': '394-812-701', 'السجل التجاري': '84291', 'الهاتف': '01012345678', 'العنوان': 'مدينة نصر، القاهرة', 'حد الائتمان': 100000, 'فترة السداد بالأيام': 30 },
      { 'النوع (customer/supplier)': 'supplier', 'كود الطرف': 'SUPP-0099', 'الاسم بالعربي': 'مؤسسة الدلتا للأجهزة الإلكترونية', 'الاسم بالإنجليزي': 'Delta Electronics', 'الرقم الضريبي': '205-994-118', 'السجل التجاري': '59102', 'الهاتف': '01198765432', 'العنوان': 'سموحة، الإسكندرية', 'حد الائتمان': 250000, 'فترة السداد بالأيام': 45 }
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'العملاء والموردون');
  } else if (type === 'items') {
    const data = [
      { 'كود الصنف': 'ITM-901', 'الباركود': '6221009901012', 'اسم الصنف بالعربي': 'لوحة مفاتيح لاسلكية لوجيتك K380', 'اسم الصنف بالإنجليزي': 'Logitech Wireless Keyboard K380', 'نوع الصنف (stock/service)': 'stock', 'الفئة': 'ملحقات وإكسسوارات', 'الوحدة الأساسية': 'قطعة', 'سعر التكلفة': 850, 'سعر البيع': 1200, 'نسبة الضريبة': 14, 'حد الطلب الأدنى': 10, 'كود الفاتورة الإلكترونية ETA': 'EG-458921364-ITM-901' },
      { 'كود الصنف': 'ITM-902', 'الباركود': '6221009901029', 'اسم الصنف بالعربي': 'ماوس لاسلكي لوجيتك M330', 'اسم الصنف بالإنجليزي': 'Logitech Silent Mouse M330', 'نوع الصنف (stock/service)': 'stock', 'الفئة': 'ملحقات وإكسسوارات', 'الوحدة الأساسية': 'قطعة', 'سعر التكلفة': 420, 'سعر البيع': 650, 'نسبة الضريبة': 14, 'حد الطلب الأدنى': 15, 'كود الفاتورة الإلكترونية ETA': 'EG-458921364-ITM-902' }
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'الأصناف والمخزون');
  } else if (type === 'opening_balances') {
    // Multi-sheet comprehensive opening balances template
    const glData = [
      { 'كود الحساب': '1111', 'اسم الحساب': 'خزينة القاهرة الرئيسية', 'رصيد مدين': 150000, 'رصيد دائن': 0, 'ملاحظات': 'مطابق لجرد الخزينة الافتتاحي' },
      { 'كود الحساب': '1113', 'اسم الحساب': 'البنك الأهلي المصري', 'رصيد مدين': 850000, 'رصيد دائن': 0, 'ملاحظات': 'مطابق لكشف الحساب البنكي' },
      { 'كود الحساب': '1121', 'اسم الحساب': 'العملاء التجاريون (حساب الرقابة)', 'رصيد مدين': 35000, 'رصيد دائن': 0, 'ملاحظات': 'مطابق لإجمالي كشوف العملاء' },
      { 'كود الحساب': '1141', 'اسم الحساب': 'بضاعة بالمخازن (القاهرة)', 'رصيد مدين': 65000, 'رصيد دائن': 0, 'ملاحظات': 'مطابق لجرد المخزن الافتتاحي' },
      { 'كود الحساب': '2111', 'اسم الحساب': 'الموردون التجاريون (حساب الرقابة)', 'رصيد مدين': 0, 'رصيد دائن': 50000, 'ملاحظات': 'مطابق لإجمالي كشوف الموردين' },
      { 'كود الحساب': '3111', 'اسم الحساب': 'رأس المال المدفوع', 'رصيد مدين': 0, 'رصيد دائن': 1050000, 'ملاحظات': 'رأس المال الافتتاحي' }
    ];
    const custData = [
      { 'كود العميل': 'CUST-001', 'اسم العميل': 'شركة الأهرام للتوزيع والتوكيلات', 'رصيد مدين': 20000, 'رصيد دائن': 0, 'رقم المستند المرجعي': 'OP-CUST-01' },
      { 'كود العميل': 'CUST-002', 'اسم العميل': 'مؤسسة الشروق للحلول البرمجية', 'رصيد مدين': 15000, 'رصيد دائن': 0, 'رقم المستند المرجعي': 'OP-CUST-02' }
    ];
    const suppData = [
      { 'كود المورد': 'SUPP-001', 'اسم المورد': 'الشركة الهندسية للاستيراد والتصدير', 'رصيد دائن': 50000, 'رصيد مدين': 0, 'رقم المستند المرجعي': 'OP-SUPP-01' }
    ];
    const stockData = [
      { 'كود الصنف': 'ITM-001', 'اسم الصنف': 'لابتوب ديل فوسترو 3520 كور i5', 'كود المخزن': 'WH-CAI-MAIN', 'الكمية': 4, 'تكلفة الوحدة': 16250, 'إجمالي القيمة': 65000 }
    ];

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(glData), 'الأستاذ العام');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(custData), 'تفاصيل العملاء');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(suppData), 'تفاصيل الموردين');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stockData), 'تفاصيل المخزون');
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="almizan_${type}_template.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

export interface RowError {
  sheetName?: string;
  rowNumber: number;
  column: string;
  value: any;
  errorReason: string;
}

/**
 * Preview and Validate Uploaded Import File
 */
importExcelRouter.post('/preview', requireAuth, requirePermission('import.excel'), (req: AuthenticatedRequest, res: Response) => {
  const { importType, base64Data, jsonRows } = req.body;

  if (!importType) {
    return res.status(400).json({ error: 'يرجى تحديد نوع ملف الاستيراد.' });
  }

  const errors: RowError[] = [];
  let validRowsCount = 0;
  let parsedSheets: Record<string, any[]> = {};

  try {
    if (base64Data) {
      const buffer = Buffer.from(base64Data, 'base64');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      for (const sheetName of wb.SheetNames) {
        parsedSheets[sheetName] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
      }
    } else if (jsonRows) {
      parsedSheets['default'] = Array.isArray(jsonRows) ? jsonRows : [];
    } else {
      return res.status(400).json({ error: 'لم يتم إرسال بيانات الملف للمعاينة.' });
    }

    if (importType === 'chart_of_accounts') {
      const rows = parsedSheets['دليل الحسابات'] || parsedSheets['default'] || Object.values(parsedSheets)[0] || [];
      const seenCodes = new Set<string>();

      rows.forEach((row, idx) => {
        const rowNo = idx + 2; // header is row 1
        const code = String(row['كود الحساب'] || row.code || '').trim();
        const nameAr = String(row['اسم الحساب بالعربي'] || row.name_ar || '').trim();
        const accType = String(row['نوع الحساب'] || row.account_type || '').trim().toLowerCase();
        const nature = String(row['طبيعة الحساب'] || row.nature || '').trim().toLowerCase();
        const parentCode = row['كود حساب الأب'] || row.parent_code;

        if (!code) {
          errors.push({ rowNumber: rowNo, column: 'كود الحساب', value: code, errorReason: 'كود الحساب إجباري ولا يمكن تركه فارغاً.' });
        } else if (seenCodes.has(code)) {
          errors.push({ rowNumber: rowNo, column: 'كود الحساب', value: code, errorReason: 'كود الحساب مكرر داخل نفس الملف.' });
        } else {
          seenCodes.add(code);
          const existing = db.prepare('SELECT id FROM accounts WHERE code = ?').get(code);
          if (existing) {
            errors.push({ rowNumber: rowNo, column: 'كود الحساب', value: code, errorReason: 'كود الحساب موجود مسبقاً بدليل الحسابات في النظام.' });
          }
        }

        if (!nameAr) {
          errors.push({ rowNumber: rowNo, column: 'اسم الحساب بالعربي', value: nameAr, errorReason: 'اسم الحساب بالعربي إجباري.' });
        }

        if (!['asset', 'liability', 'equity', 'revenue', 'expense', 'cogs'].includes(accType)) {
          errors.push({ rowNumber: rowNo, column: 'نوع الحساب', value: accType, errorReason: 'نوع الحساب غير صحيح (المسموح: asset, liability, equity, revenue, expense, cogs).' });
        }

        if (!['debit', 'credit'].includes(nature)) {
          errors.push({ rowNumber: rowNo, column: 'طبيعة الحساب', value: nature, errorReason: 'طبيعة الحساب غير صحيحة (المسموح: debit, credit).' });
        }

        if (parentCode) {
          const parentExists = db.prepare('SELECT id FROM accounts WHERE code = ?').get(String(parentCode).trim());
          if (!parentExists && !seenCodes.has(String(parentCode).trim())) {
            errors.push({ rowNumber: rowNo, column: 'كود حساب الأب', value: parentCode, errorReason: 'حساب الأب غير موجود في دليل الحسابات ولا في الملف.' });
          }
        }
      });
      validRowsCount = rows.length - errors.length;
    } else if (importType === 'parties') {
      const rows = parsedSheets['العملاء والموردون'] || parsedSheets['default'] || Object.values(parsedSheets)[0] || [];
      const seenCodes = new Set<string>();

      rows.forEach((row, idx) => {
        const rowNo = idx + 2;
        const code = String(row['كود الطرف'] || row.code || '').trim();
        const type = String(row['النوع (customer/supplier)'] || row.type || '').trim().toLowerCase();
        const nameAr = String(row['الاسم بالعربي'] || row.name_ar || '').trim();

        if (!code) {
          errors.push({ rowNumber: rowNo, column: 'كود الطرف', value: code, errorReason: 'كود الطرف إجباري.' });
        } else if (seenCodes.has(code)) {
          errors.push({ rowNumber: rowNo, column: 'كود الطرف', value: code, errorReason: 'كود الطرف مكرر بالملف.' });
        } else {
          seenCodes.add(code);
          const existing = db.prepare('SELECT id FROM parties WHERE code = ?').get(code);
          if (existing) {
            errors.push({ rowNumber: rowNo, column: 'كود الطرف', value: code, errorReason: 'كود الطرف مسجل مسبقاً بالنظام.' });
          }
        }

        if (!['customer', 'supplier', 'both'].includes(type)) {
          errors.push({ rowNumber: rowNo, column: 'النوع', value: type, errorReason: 'النوع يجب أن يكون customer أو supplier أو both.' });
        }

        if (!nameAr) {
          errors.push({ rowNumber: rowNo, column: 'الاسم بالعربي', value: nameAr, errorReason: 'الاسم بالعربي إجباري.' });
        }
      });
      validRowsCount = rows.length - errors.length;
    } else if (importType === 'items') {
      const rows = parsedSheets['الأصناف والمخزون'] || parsedSheets['default'] || Object.values(parsedSheets)[0] || [];
      const seenCodes = new Set<string>();

      rows.forEach((row, idx) => {
        const rowNo = idx + 2;
        const code = String(row['كود الصنف'] || row.code || '').trim();
        const nameAr = String(row['اسم الصنف بالعربي'] || row.name_ar || '').trim();
        const itemType = String(row['نوع الصنف (stock/service)'] || row.item_type || 'stock').trim().toLowerCase();
        const costPrice = Number(row['سعر التكلفة'] || row.cost_price || 0);
        const salePrice = Number(row['سعر البيع'] || row.sale_price || 0);

        if (!code) {
          errors.push({ rowNumber: rowNo, column: 'كود الصنف', value: code, errorReason: 'كود الصنف إجباري.' });
        } else if (seenCodes.has(code)) {
          errors.push({ rowNumber: rowNo, column: 'كود الصنف', value: code, errorReason: 'كود الصنف مكرر بالملف.' });
        } else {
          seenCodes.add(code);
          const existing = db.prepare('SELECT id FROM items WHERE code = ?').get(code);
          if (existing) {
            errors.push({ rowNumber: rowNo, column: 'كود الصنف', value: code, errorReason: 'كود الصنف مسجل مسبقاً بالنظام.' });
          }
        }

        if (!nameAr) {
          errors.push({ rowNumber: rowNo, column: 'اسم الصنف بالعربي', value: nameAr, errorReason: 'اسم الصنف إجباري.' });
        }

        if (!['stock', 'service'].includes(itemType)) {
          errors.push({ rowNumber: rowNo, column: 'نوع الصنف', value: itemType, errorReason: 'نوع الصنف يجب أن يكون stock أو service.' });
        }

        if (costPrice < 0) {
          errors.push({ rowNumber: rowNo, column: 'سعر التكلفة', value: costPrice, errorReason: 'سعر التكلفة لا يمكن أن يكون سالباً.' });
        }
        if (salePrice < 0) {
          errors.push({ rowNumber: rowNo, column: 'سعر البيع', value: salePrice, errorReason: 'سعر البيع لا يمكن أن يكون سالباً.' });
        }
      });
      validRowsCount = rows.length - errors.length;
    } else if (importType === 'opening_balances') {
      const glRows = parsedSheets['الأستاذ العام'] || [];
      const custRows = parsedSheets['تفاصيل العملاء'] || [];
      const suppRows = parsedSheets['تفاصيل الموردين'] || [];
      const stockRows = parsedSheets['تفاصيل المخزون'] || [];

      let totalDebit = new Decimal(0);
      let totalCredit = new Decimal(0);

      // Validate GL Accounts Rows
      glRows.forEach((row, idx) => {
        const rowNo = idx + 2;
        const code = String(row['كود الحساب'] || '').trim();
        const d = new Decimal(row['رصيد مدين'] || 0);
        const c = new Decimal(row['رصيد دائن'] || 0);

        if (!code) {
          errors.push({ sheetName: 'الأستاذ العام', rowNumber: rowNo, column: 'كود الحساب', value: code, errorReason: 'كود الحساب إجباري.' });
        } else {
          const acc = db.prepare('SELECT id, is_group, is_active FROM accounts WHERE code = ?').get(code) as any;
          if (!acc) {
            errors.push({ sheetName: 'الأستاذ العام', rowNumber: rowNo, column: 'كود الحساب', value: code, errorReason: 'الحساب غير موجود بدليل الحسابات.' });
          } else if (acc.is_group === 1) {
            errors.push({ sheetName: 'الأستاذ العام', rowNumber: rowNo, column: 'كود الحساب', value: code, errorReason: 'الحساب رئيسي/تجميعي وممنوع الترحيل المباشر إليه.' });
          }
        }

        if (d.isNegative() || c.isNegative()) {
          errors.push({ sheetName: 'الأستاذ العام', rowNumber: rowNo, column: 'الرصيد', value: `${d.toString()} / ${c.toString()}`, errorReason: 'الرصيد لا يمكن أن يكون سالباً.' });
        }
        if (d.greaterThan(0) && c.greaterThan(0)) {
          errors.push({ sheetName: 'الأستاذ العام', rowNumber: rowNo, column: 'الرصيد', value: `${d.toString()} / ${c.toString()}`, errorReason: 'لا يمكن أن يحتوي نفس السطر على رصيد مدين ودائن معاً.' });
        }

        totalDebit = totalDebit.plus(d);
        totalCredit = totalCredit.plus(c);
      });

      // Strict Financial Invariant: Opening Entry Must Balance!
      const glDiff = totalDebit.minus(totalCredit).abs();
      if (glDiff.greaterThan(0.01)) {
        errors.push({
          sheetName: 'الأستاذ العام',
          rowNumber: 1,
          column: 'ميزان القيد الافتتاحي',
          value: `المدين: ${totalDebit.toFixed(2)} | الدائن: ${totalCredit.toFixed(2)}`,
          errorReason: `القيد الافتتاحي غير متوازن! إجمالي المدين (${totalDebit.toFixed(2)}) لا يساوي إجمالي الدائن (${totalCredit.toFixed(2)}). الفرق: ${glDiff.toFixed(2)}`
        });
      }

      // Reconcile Customer Subledger Details with Customer Control Account (acc_1121)
      let custDetailsTotal = new Decimal(0);
      custRows.forEach((row, idx) => {
        const rowNo = idx + 2;
        const code = String(row['كود العميل'] || '').trim();
        const d = new Decimal(row['رصيد مدين'] || 0);
        const c = new Decimal(row['رصيد دائن'] || 0);

        const party = db.prepare('SELECT id FROM parties WHERE code = ? AND type IN ("customer", "both")').get(code);
        if (!party) {
          errors.push({ sheetName: 'تفاصيل العملاء', rowNumber: rowNo, column: 'كود العميل', value: code, errorReason: 'العميل غير مسجل في بطاقات العملاء.' });
        }
        custDetailsTotal = custDetailsTotal.plus(d).minus(c);
      });

      const custControlGlRow = glRows.find((r: any) => String(r['كود الحساب']).trim() === '1121');
      const custGlBalance = custControlGlRow ? new Decimal(custControlGlRow['رصيد مدين'] || 0).minus(custControlGlRow['رصيد دائن'] || 0) : new Decimal(0);
      if (custRows.length > 0 && custDetailsTotal.minus(custGlBalance).abs().greaterThan(0.01)) {
        errors.push({
          sheetName: 'تفاصيل العملاء',
          rowNumber: 1,
          column: 'مطابقة رقابة العملاء',
          value: `تفاصيل: ${custDetailsTotal.toFixed(2)} | الأستاذ: ${custGlBalance.toFixed(2)}`,
          errorReason: `إجمالي تفاصيل كشوف العملاء (${custDetailsTotal.toFixed(2)}) لا يطابق رصيد حساب الرقابة العام للعملاء 1121 (${custGlBalance.toFixed(2)}). تم منع الازدواج أو التناقض.`
        });
      }

      // Reconcile Supplier Subledger Details with Supplier Control Account (acc_2111)
      let suppDetailsTotal = new Decimal(0);
      suppRows.forEach((row, idx) => {
        const rowNo = idx + 2;
        const code = String(row['كود المورد'] || '').trim();
        const c = new Decimal(row['رصيد دائن'] || 0);
        const d = new Decimal(row['رصيد مدين'] || 0);

        const party = db.prepare('SELECT id FROM parties WHERE code = ? AND type IN ("supplier", "both")').get(code);
        if (!party) {
          errors.push({ sheetName: 'تفاصيل الموردين', rowNumber: rowNo, column: 'كود المورد', value: code, errorReason: 'المورد غير مسجل في بطاقات الموردين.' });
        }
        suppDetailsTotal = suppDetailsTotal.plus(c).minus(d);
      });

      const suppControlGlRow = glRows.find((r: any) => String(r['كود الحساب']).trim() === '2111');
      const suppGlBalance = suppControlGlRow ? new Decimal(suppControlGlRow['رصيد دائن'] || 0).minus(suppControlGlRow['رصيد مدين'] || 0) : new Decimal(0);
      if (suppRows.length > 0 && suppDetailsTotal.minus(suppGlBalance).abs().greaterThan(0.01)) {
        errors.push({
          sheetName: 'تفاصيل الموردين',
          rowNumber: 1,
          column: 'مطابقة رقابة الموردين',
          value: `تفاصيل: ${suppDetailsTotal.toFixed(2)} | الأستاذ: ${suppGlBalance.toFixed(2)}`,
          errorReason: `إجمالي تفاصيل كشوف الموردين (${suppDetailsTotal.toFixed(2)}) لا يطابق رصيد حساب الرقابة العام للموردين 2111 (${suppGlBalance.toFixed(2)}).`
        });
      }

      // Reconcile Inventory Details with Inventory GL Account (acc_1141)
      let stockDetailsTotal = new Decimal(0);
      stockRows.forEach((row, idx) => {
        const rowNo = idx + 2;
        const itmCode = String(row['كود الصنف'] || '').trim();
        const whCode = String(row['كود المخزن'] || 'WH-CAI-MAIN').trim();
        const qty = Number(row['الكمية'] || 0);
        const cost = Number(row['تكلفة الوحدة'] || 0);

        const itm = db.prepare('SELECT id FROM items WHERE code = ?').get(itmCode);
        if (!itm) {
          errors.push({ sheetName: 'تفاصيل المخزون', rowNumber: rowNo, column: 'كود الصنف', value: itmCode, errorReason: 'الصنف غير مسجل في دليل الأصناف.' });
        }
        const wh = db.prepare('SELECT id, branch_id FROM warehouses WHERE code = ?').get(whCode) as any;
        if (!wh) {
          errors.push({ sheetName: 'تفاصيل المخزون', rowNumber: rowNo, column: 'كود المخزن', value: whCode, errorReason: 'المستودع المحدد غير موجود.' });
        } else {
          if (!isWarehouseAllowed(req.user, wh.id)) {
            errors.push({ sheetName: 'تفاصيل المخزون', rowNumber: rowNo, column: 'كود المخزن', value: whCode, errorReason: 'المستودع المحدد خارج نطاق صلاحياتك المخزنية.' });
          }
          if (!isBranchAllowed(req.user, wh.branch_id)) {
            errors.push({ sheetName: 'تفاصيل المخزون', rowNumber: rowNo, column: 'كود المخزن', value: whCode, errorReason: 'فرع المستودع المحدد خارج نطاق صلاحياتك الجغرافية.' });
          }
        }

        stockDetailsTotal = stockDetailsTotal.plus(new Decimal(qty).times(cost));
      });

      const invGlRow = glRows.find((r: any) => String(r['كود الحساب']).trim() === '1141');
      const invGlBalance = invGlRow ? new Decimal(invGlRow['رصيد مدين'] || 0) : new Decimal(0);
      if (stockRows.length > 0 && stockDetailsTotal.minus(invGlBalance).abs().greaterThan(1.0)) {
        errors.push({
          sheetName: 'تفاصيل المخزون',
          rowNumber: 1,
          column: 'مطابقة رصيد المخزون',
          value: `تفاصيل: ${stockDetailsTotal.toFixed(2)} | الأستاذ: ${invGlBalance.toFixed(2)}`,
          errorReason: `إجمالي قيمة بضاعة الجرد الافتتاحي (${stockDetailsTotal.toFixed(2)}) لا يطابق رصيد حساب بضاعة بالمخازن بالأستاذ 1141 (${invGlBalance.toFixed(2)}).`
        });
      }

      validRowsCount = glRows.length + custRows.length + suppRows.length + stockRows.length;
    }

    res.json({
      success: true,
      importType,
      parsedSheets,
      totalRowsCount: validRowsCount + errors.length,
      validRowsCount: errors.length === 0 ? validRowsCount : 0,
      errorsCount: errors.length,
      errors,
      canCommit: errors.length === 0
    });
  } catch (err: any) {
    res.status(400).json({ error: `فشل فحص ومعاينة الملف: ${err.message}` });
  }
});

/**
 * Commit Import Batch Atomically with Duplicate Check & Audit Trail
 */
importExcelRouter.post('/commit', requireAuth, requirePermission('import.excel'), (req: AuthenticatedRequest, res: Response) => {
  const { importType, parsedSheets, filename, batchKey } = req.body;

  if (!importType || !parsedSheets) {
    return res.status(400).json({ error: 'البيانات المعتمدة للاستيراد غير مكتملة.' });
  }

  // Idempotency / Duplicate Prevention Check
  const effectiveBatchKey = batchKey || `${importType}_${filename || 'import'}_${Date.now()}`;
  const existingImport = db.prepare('SELECT id FROM excel_imports_log WHERE filename = ? AND status = "committed"').get(effectiveBatchKey);
  if (existingImport) {
    return res.status(400).json({ error: 'تم استيراد واعتماد هذه الدفعة مسبقاً لمنع ازدواج الأثر المالي أو تكرار السجلات.' });
  }

  try {
    let resultMessage = '';
    let committedCount = 0;

    db.transaction(() => {
      if (importType === 'chart_of_accounts') {
        const rows = parsedSheets['دليل الحسابات'] || parsedSheets['default'] || Object.values(parsedSheets)[0] || [];
        const insAcc = db.prepare(`
          INSERT INTO accounts (id, code, name_ar, name_en, parent_id, account_type, nature, is_group, level, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `);

        for (const row of rows) {
          const code = String(row['كود الحساب'] || row.code).trim();
          const nameAr = String(row['اسم الحساب بالعربي'] || row.name_ar).trim();
          const nameEn = String(row['اسم الحساب بالإنجليزي'] || row.name_en || nameAr).trim();
          const accType = String(row['نوع الحساب'] || row.account_type).trim().toLowerCase();
          const nature = String(row['طبيعة الحساب'] || row.nature).trim().toLowerCase();
          const isGroup = Number(row['حساب رئيسي (1/0)'] || row.is_group || 0);
          const level = Number(row['المستوى'] || row.level || 4);
          const parentCode = row['كود حساب الأب'] || row.parent_code;

          let parentId = null;
          if (parentCode) {
            const p = db.prepare('SELECT id FROM accounts WHERE code = ?').get(String(parentCode).trim()) as any;
            if (p) parentId = p.id;
          }

          const accId = `acc_${code}`;
          insAcc.run(accId, code, nameAr, nameEn, parentId, accType, nature, isGroup, level);
          committedCount++;
        }
        resultMessage = `تم استيراد وإدراج (${committedCount}) حساباً بنجاح في دليل الحسابات.`;
      } else if (importType === 'parties') {
        const rows = parsedSheets['العملاء والموردون'] || parsedSheets['default'] || Object.values(parsedSheets)[0] || [];
        const insParty = db.prepare(`
          INSERT INTO parties (id, code, type, name_ar, name_en, tax_id, commercial_registry, phone, address, credit_limit, payment_terms_days, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `);

        for (const row of rows) {
          const code = String(row['كود الطرف'] || row.code).trim();
          const type = String(row['النوع (customer/supplier)'] || row.type).trim().toLowerCase();
          const nameAr = String(row['الاسم بالعربي'] || row.name_ar).trim();
          const nameEn = String(row['الاسم بالإنجليزي'] || row.name_en || nameAr).trim();
          const taxId = row['الرقم الضريبي'] || row.tax_id || null;
          const cr = row['السجل التجاري'] || row.commercial_registry || null;
          const phone = row['الهاتف'] || row.phone || null;
          const address = row['العنوان'] || row.address || null;
          const creditLimit = Number(row['حد الائتمان'] || row.credit_limit || 0);
          const terms = Number(row['فترة السداد بالأيام'] || row.payment_terms_days || 0);

          const partyId = `party_${code.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
          insParty.run(partyId, code, type, nameAr, nameEn, taxId, cr, phone, address, creditLimit, terms);
          committedCount++;
        }
        resultMessage = `تم استيراد وإدراج (${committedCount}) طرفاً تجارياً (عملاء وموردين) بنجاح.`;
      } else if (importType === 'items') {
        const rows = parsedSheets['الأصناف والمخزون'] || parsedSheets['default'] || Object.values(parsedSheets)[0] || [];
        const insItem = db.prepare(`
          INSERT INTO items (id, code, barcode, name_ar, name_en, item_type, category, base_unit, cost_price, sale_price, moving_avg_cost, tax_rate, min_stock_level, eta_item_code, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `);

        for (const row of rows) {
          const code = String(row['كود الصنف'] || row.code).trim();
          const barcode = row['الباركود'] || row.barcode || null;
          const nameAr = String(row['اسم الصنف بالعربي'] || row.name_ar).trim();
          const nameEn = String(row['اسم الصنف بالإنجليزي'] || row.name_en || nameAr).trim();
          const itemType = String(row['نوع الصنف (stock/service)'] || row.item_type || 'stock').trim().toLowerCase();
          const category = String(row['الفئة'] || row.category || 'عام').trim();
          const unit = String(row['الوحدة الأساسية'] || row.base_unit || 'قطعة').trim();
          const cost = Number(row['سعر التكلفة'] || row.cost_price || 0);
          const sale = Number(row['سعر البيع'] || row.sale_price || 0);
          const taxRate = Number(row['نسبة الضريبة'] || row.tax_rate || 14);
          const minStock = Number(row['حد الطلب الأدنى'] || row.min_stock_level || 0);
          const etaCode = row['كود الفاتورة الإلكترونية ETA'] || row.eta_item_code || null;

          const itemId = `itm_${code.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
          insItem.run(itemId, code, barcode, nameAr, nameEn, itemType, category, unit, cost, sale, cost, taxRate, minStock, etaCode);
          committedCount++;
        }
        resultMessage = `تم استيراد وإدراج (${committedCount}) صنفاً بنجاح في دليل الأصناف.`;
      } else if (importType === 'opening_balances') {
        const glRows = parsedSheets['الأستاذ العام'] || [];
        const custRows = parsedSheets['تفاصيل العملاء'] || [];
        const suppRows = parsedSheets['تفاصيل الموردين'] || [];
        const stockRows = parsedSheets['تفاصيل المخزون'] || [];

        // Validate branch & warehouse access for opening balances stock rows
        for (const s of stockRows) {
          const whCode = String(s['كود المخزن'] || 'WH-CAI-MAIN').trim();
          const wh = db.prepare('SELECT id, branch_id FROM warehouses WHERE code = ?').get(whCode) as any;
          if (wh) {
            if (!isWarehouseAllowed(req.user, wh.id)) {
              throw new Error(`المستودع (${whCode}) خارج نطاق صلاحياتك المخزنية.`);
            }
            if (!isBranchAllowed(req.user, wh.branch_id)) {
              throw new Error(`فرع المستودع (${whCode}) خارج نطاق صلاحياتك الجغرافية.`);
            }
          }
        }

        // 1. Post Balanced Opening Journal Entry
        const period = getFiscalPeriodForDate('2026-01-01');
        const lines: any[] = [];

        for (const r of glRows) {
          const code = String(r['كود الحساب']).trim();
          const d = Number(r['رصيد مدين'] || 0);
          const c = Number(r['رصيد دائن'] || 0);
          const acc = db.prepare('SELECT id FROM accounts WHERE code = ?').get(code) as any;
          if (acc && (d > 0 || c > 0)) {
            lines.push({
              accountId: acc.id,
              debit: d,
              credit: c,
              description: `رصيد افتتاحي - حساب ${code}`
            });
          }
        }

        const jeResult = postJournalEntry({
          docType: 'CLOSING', // Opening/Closing Balance Type
          docNumber: 'OP-2026-CAI-001',
          entryDate: '2026-01-01',
          postingDate: '2026-01-01',
          branchId: 'br_cairo',
          fiscalPeriodId: period.id,
          description: 'القيد الافتتاحي العام للسنة المالية 2026 (مستورد من Excel)',
          createdBy: req.user!.id,
          lines
        });

        // 2. Link details for stock
        for (const s of stockRows) {
          const itm = db.prepare('SELECT id FROM items WHERE code = ?').get(String(s['كود الصنف']).trim()) as any;
          const wh = db.prepare('SELECT id FROM warehouses WHERE code = ?').get(String(s['كود المخزن'] || 'WH-CAI-MAIN').trim()) as any;
          const qty = Number(s['الكمية'] || 0);
          const cost = Number(s['تكلفة الوحدة'] || 0);

          if (itm && wh && qty > 0) {
            db.prepare(`
              INSERT INTO warehouse_stock (warehouse_id, item_id, quantity)
              VALUES (?, ?, ?)
              ON CONFLICT(warehouse_id, item_id) DO UPDATE SET quantity = quantity + ?
            `).run(wh.id, itm.id, qty, qty);

            // Update moving avg cost
            db.prepare('UPDATE items SET cost_price = ?, moving_avg_cost = ? WHERE id = ?').run(cost, cost, itm.id);
          }
        }

        committedCount = glRows.length;
        resultMessage = `تم ترحيل القيد الافتتاحي برقم (${jeResult.entryNumber}) متزناً بنجاح، وتحديث أرصدة المخازن والأستاذ.`;
      }

      // Record in excel_imports_log
      const logId = `implog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      db.prepare(`
        INSERT INTO excel_imports_log (id, import_type, filename, total_rows, valid_rows, error_rows, status, details_json, imported_by)
        VALUES (?, ?, ?, ?, ?, 0, 'committed', ?, ?)
      `).run(
        logId,
        importType,
        effectiveBatchKey,
        committedCount,
        committedCount,
        JSON.stringify({ resultMessage, committedCount }),
        req.user!.id
      );

      logAudit(req.user!.id, 'EXCEL_IMPORT_COMMIT', 'excel_imports_log', logId, resultMessage);
    })();

    res.json({
      success: true,
      message: resultMessage,
      committedCount
    });
  } catch (err: any) {
    res.status(400).json({ error: `فشل اعتماد وحفظ دفعة الاستيراد (تم التراجع عن العملية بالكامل): ${err.message}` });
  }
});

/**
 * GET /history: Get past import batches
 */
importExcelRouter.get('/history', requireAuth, requirePermission('import.excel', 'excel_import.view'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const history = db.prepare(`
      SELECT l.*, u.display_name as user_name
      FROM excel_imports_log l
      JOIN users u ON l.imported_by = u.id
      ORDER BY l.imported_at DESC
      LIMIT 25
    `).all();

    res.json({ success: true, history });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
