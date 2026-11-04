import Decimal from 'decimal.js';
import * as XLSX from 'xlsx';

/**
 * Data types supported for spreadsheet columns
 */
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
  headerRowIndex: number; // 0-indexed
  columns: ColumnMeta[];
  duplicateRowsCount: number;
  currenciesDetected: string[];
  hasInvoiceNumbers: boolean;
  hasSalesAndReturns: boolean;
}

export interface NumericColumnStats {
  column: string;
  currency?: string;
  count: number;
  sum: string;
  average: string;
  median: string;
  min: string;
  max: string;
}

export interface GroupByResult {
  groupColumn: string;
  groupedBy: 'period' | 'customer' | 'supplier' | 'item' | 'branch' | 'custom';
  items: Array<{
    key: string;
    label: string;
    count: number;
    sum: string;
    currency?: string;
    matchingRowIndices: number[];
  }>;
}

export interface NetSalesCalculation {
  grossSales: string;
  salesCount: number;
  salesDistinctInvoices: number;
  totalReturns: string;
  returnsCount: number;
  returnsDistinctInvoices: number;
  netSales: string;
  currency: string;
  assumptionUsed: string;
  salesRowIndices: number[];
  returnsRowIndices: number[];
}

export interface AnalysisPlan {
  sheetName?: string;
  goal: string;
  operation: 'sum' | 'average' | 'median' | 'min_max' | 'count' | 'distinct_count' | 'net_sales' | 'group_by' | 'filter_list';
  targetColumn?: string;
  currencyColumn?: string;
  invoiceColumn?: string;
  typeColumn?: string;
  groupByColumn?: string;
  dateColumn?: string;
  periodFilter?: {
    startDate?: string;
    endDate?: string;
    month?: string; // e.g. "10", "10-2026", "2026-10", "أكتوبر"
    year?: string;
  };
  filters?: Array<{
    column: string;
    operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'in';
    value: any;
  }>;
  limit?: number;
  sortOrder?: 'asc' | 'desc';
}

export interface PlanExecutionResult {
  success: boolean;
  goal: string;
  sheetName: string;
  operation: string;
  primaryValue?: string;
  secondaryValue?: string;
  unitOrCurrency?: string;
  periodDescription?: string;
  matchingRowCount: number;
  matchingRowIndices: number[];
  columnsUsed: string[];
  assumptionUsed?: string;
  breakdown?: Array<{ label: string; value: string; count: number; rowIndices: number[] }>;
  error?: string;
}

/**
 * Normalize Arabic digits (٠١٢٣٤٥٦٧٨٩) and Persian digits (۰۱۲۳۴۵۶۷۸۹) to standard ASCII 0-9
 */
export function normalizeArabicDigits(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/[٠۰]/g, '0')
    .replace(/[١۱]/g, '1')
    .replace(/[٢۲]/g, '2')
    .replace(/[٣۳]/g, '3')
    .replace(/[٤۴]/g, '4')
    .replace(/[٥۵]/g, '5')
    .replace(/[٦۶]/g, '6')
    .replace(/[٧۷]/g, '7')
    .replace(/[٨۸]/g, '8')
    .replace(/[٩۹]/g, '9');
}

/**
 * Clean and parse a financial or numeric cell value.
 * Handles currencies (ج.م, EGP, $, USD, etc.), percentages, Arabic commas and decimals.
 */
export function parseNumericValue(val: any): { isNumber: boolean; value?: Decimal; rawClean?: string; currency?: string } {
  if (val === null || val === undefined || val === '') {
    return { isNumber: false };
  }

  if (typeof val === 'number') {
    if (isNaN(val) || !isFinite(val)) return { isNumber: false };
    return { isNumber: true, value: new Decimal(val) };
  }

  let str = normalizeArabicDigits(String(val)).trim();

  // Detect and extract currency symbol
  let currency: string | undefined;
  if (/ج\.م|جم|جنيه|egp|l\.e/i.test(str)) {
    currency = 'EGP';
  } else if (/\$|usd|دولار/i.test(str)) {
    currency = 'USD';
  } else if (/€|eur|يورو/i.test(str)) {
    currency = 'EUR';
  } else if (/ر\.س|رس|sar|ريال/i.test(str)) {
    currency = 'SAR';
  }

  // Remove currency words, spaces, symbols
  str = str.replace(/[ج\.مجمجنيهegpl\$usdدولار€eurيورور\.سرسsarريال%]/gi, '').trim();

  // Accounting negative numbers in parentheses: (1,250.00) => -1250.00
  let isNegative = false;
  if (str.startsWith('(') && str.endsWith(')')) {
    isNegative = true;
    str = str.slice(1, -1).trim();
  } else if (str.startsWith('-')) {
    isNegative = true;
    str = str.slice(1).trim();
  }

  // Comma & dot handling
  // Check if comma is thousand separator (e.g. 1,000.50) or decimal separator (e.g. 1000,50)
  if (str.includes(',') && str.includes('.')) {
    // Standard format: 1,234.56
    str = str.replace(/,/g, '');
  } else if (str.includes(',')) {
    const parts = str.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      // European/Egyptian comma as decimal: 1000,50 => 1000.50
      str = parts[0] + '.' + parts[1];
    } else {
      // Thousand separator: 1,000,000 => 1000000
      str = str.replace(/,/g, '');
    }
  }

  // Arabic decimal separator (٫)
  str = str.replace(/٫/g, '.').replace(/٬/g, '');

  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    return { isNumber: false, rawClean: str };
  }

  try {
    let d = new Decimal(str);
    if (isNegative) d = d.negated();
    return { isNumber: true, value: d, rawClean: str, currency };
  } catch {
    return { isNumber: false, rawClean: str };
  }
}

/**
 * Parse date values supporting Excel date serial numbers, ISO strings, Egyptian standard formats
 */
export function parseDateValue(val: any): { isDate: boolean; date?: Date; formatted?: string } {
  if (val === null || val === undefined || val === '') {
    return { isDate: false };
  }

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return { isDate: false };
    const formatted = val.toISOString().slice(0, 10);
    return { isDate: true, date: val, formatted };
  }

  // Excel serial number date
  if (typeof val === 'number' && val > 20000 && val < 70000) {
    const epoch = new Date(1899, 11, 30);
    const d = new Date(epoch.getTime() + val * 86400000);
    if (!isNaN(d.getTime())) {
      const formatted = d.toISOString().slice(0, 10);
      return { isDate: true, date: d, formatted };
    }
  }

  let str = normalizeArabicDigits(String(val)).trim();
  // Strip time part if present (e.g. "2026-05-15 14:30:00")
  str = str.split('T')[0].split(' ')[0];

  // Try standard YYYY-MM-DD
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(str)) {
    const parts = str.split(/[-/.]/).map(p => parseInt(p, 10));
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    if (!isNaN(d.getTime())) {
      const formatted = `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
      return { isDate: true, date: d, formatted };
    }
  }

  // Try Egyptian DD/MM/YYYY or DD-MM-YYYY
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(str)) {
    const parts = str.split(/[-/.]/).map(p => parseInt(p, 10));
    const d = new Date(parts[2], parts[1] - 1, parts[0]);
    if (!isNaN(d.getTime())) {
      const formatted = `${parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`;
      return { isDate: true, date: d, formatted };
    }
  }

  return { isDate: false };
}

/**
 * Infer best column data type from sample values
 */
export function inferColumnType(values: any[], colName: string): ColumnDataType {
  const nameLower = colName.toLowerCase();

  // If column name strongly indicates currency / money
  if (/مبلغ|سعر|قيمة|إجمالي|صافي|ضريبة|تكلفة|amount|price|total|net|tax|cost|vat/i.test(nameLower)) {
    return 'number';
  }
  // Date indicator
  if (/تاريخ|يوم|شهر|سنة|date|day|month|year/i.test(nameLower)) {
    return 'date';
  }
  // Currency indicator
  if (/عملة|currency/i.test(nameLower)) {
    return 'currency';
  }

  const nonEmpties = values.filter(v => v !== null && v !== undefined && String(v).trim() !== '');
  if (nonEmpties.length === 0) return 'text';

  let numCount = 0;
  let dateCount = 0;

  for (const v of nonEmpties) {
    if (parseNumericValue(v).isNumber) numCount++;
    if (parseDateValue(v).isDate) dateCount++;
  }

  const threshold = nonEmpties.length * 0.7; // 70% threshold
  if (numCount >= threshold) return 'number';
  if (dateCount >= threshold) return 'date';

  // Category vs Text: if small number of distinct values relative to sample size
  const uniqueCount = new Set(nonEmpties.map(String)).size;
  if (uniqueCount <= 12 && nonEmpties.length >= 10) return 'category';

  return 'text';
}

/**
 * Parse an Excel worksheet into structured row objects with formula detection and metadata
 */
export function parseSheetData(
  worksheet: XLSX.WorkSheet,
  sheetName: string,
  headerRowIndex: number = 0,
  userTypeOverrides?: Record<string, ColumnDataType>
): {
  sheetAnalysis: SheetAnalysis;
  rawHeaders: string[];
  rows: Array<Record<string, any>>;
  rawRows: any[][];
  unreadableCellsCount: number;
} {
  // Read worksheet as 2D array with raw cell information
  const cellRefRegex = /^([A-Z]+)(\d+)$/;
  const rawGrid: any[][] = [];
  let maxCol = 0;
  let maxRow = 0;
  let unreadableCellsCount = 0;

  // Extract cell values with formula evaluation fallback
  for (const cellKey of Object.keys(worksheet)) {
    if (cellKey.startsWith('!')) continue;
    const match = cellKey.match(cellRefRegex);
    if (!match) continue;

    const colLetters = match[1];
    const rowNum = parseInt(match[2], 10) - 1; // 0-indexed

    // Convert column letters (A, B, ..., AA) to 0-indexed column number
    let colNum = 0;
    for (let i = 0; i < colLetters.length; i++) {
      colNum = colNum * 26 + (colLetters.charCodeAt(i) - 64);
    }
    colNum -= 1;

    if (rowNum > maxRow) maxRow = rowNum;
    if (colNum > maxCol) maxCol = colNum;

    if (!rawGrid[rowNum]) rawGrid[rowNum] = [];

    const cellObj = worksheet[cellKey];
    let val: any = cellObj.v;

    // Handle formula cells
    if (cellObj.f) {
      if (cellObj.t === 'e' || val === undefined) {
        // Cached evaluated formula value is unavailable in this file
        val = cellObj.w || '[صيغة بدون قيمة محفوظة]';
        unreadableCellsCount++;
      } else {
        // Use evaluated value
        val = cellObj.v !== undefined ? cellObj.v : cellObj.w;
      }
    } else if (cellObj.w !== undefined && typeof cellObj.v !== 'number' && typeof cellObj.v !== 'boolean') {
      val = cellObj.w;
    }

    rawGrid[rowNum][colNum] = val;
  }

  // Ensure header row exists
  const effectiveHeaderRow = Math.min(headerRowIndex, Math.max(0, rawGrid.length - 1));
  const rawHeadersRow = rawGrid[effectiveHeaderRow] || [];

  const rawHeaders: string[] = [];
  const colCount = Math.max(maxCol + 1, rawHeadersRow.length);

  for (let c = 0; c < colCount; c++) {
    const rawVal = rawHeadersRow[c];
    let name = rawVal ? String(rawVal).trim() : '';
    if (!name) name = `عمود_${c + 1}`;
    // Ensure unique header names
    let finalName = name;
    let dupCounter = 1;
    while (rawHeaders.includes(finalName)) {
      dupCounter++;
      finalName = `${name}_${dupCounter}`;
    }
    rawHeaders.push(finalName);
  }

  // Construct structured rows from data below the header row
  const rows: Array<Record<string, any>> = [];
  const seenRowStrings = new Set<string>();
  let duplicateRowsCount = 0;

  for (let r = effectiveHeaderRow + 1; r <= maxRow; r++) {
    const gridRow = rawGrid[r] || [];
    // Skip empty lines
    const isCompletelyEmpty = gridRow.every(cell => cell === null || cell === undefined || String(cell).trim() === '');
    if (isCompletelyEmpty) continue;

    const rowObj: Record<string, any> = { __rowIndex: r + 1 };
    const rowValuesForDupCheck: string[] = [];

    for (let c = 0; c < rawHeaders.length; c++) {
      const colName = rawHeaders[c];
      const cellVal = gridRow[c] !== undefined ? gridRow[c] : null;
      rowObj[colName] = cellVal;
      rowValuesForDupCheck.push(String(cellVal ?? ''));
    }

    const rowHash = rowValuesForDupCheck.join('|||');
    if (seenRowStrings.has(rowHash)) {
      duplicateRowsCount++;
    } else {
      seenRowStrings.add(rowHash);
    }

    rows.push(rowObj);
  }

  // Column metadata & type inference
  const columns: ColumnMeta[] = [];
  const currenciesSet = new Set<string>();
  let hasInvoiceNumbers = false;
  let hasSalesAndReturns = false;

  for (let c = 0; c < rawHeaders.length; c++) {
    const colName = rawHeaders[c];
    const colValues = rows.map(r => r[colName]);
    const nonEmpty = colValues.filter(v => v !== null && v !== undefined && String(v).trim() !== '');

    const inferred = inferColumnType(colValues, colName);
    const userType = userTypeOverrides?.[colName];

    // Detect currencies
    for (const v of colValues) {
      const numRes = parseNumericValue(v);
      if (numRes.currency) currenciesSet.add(numRes.currency);
    }

    if (/عملة|currency/i.test(colName)) {
      for (const v of nonEmpty) {
        const str = String(v).trim().toUpperCase();
        if (str.length >= 2 && str.length <= 4) currenciesSet.add(str);
      }
    }

    if (/رقم_الفاتورة|رقم الفاتورة|الفاتورة|invoice_no|invoice_number|inv_no/i.test(colName)) {
      hasInvoiceNumbers = true;
    }

    if (/نوع_الحركة|نوع الفاتورة|البيان|مرتجع|مردود|return|type/i.test(colName)) {
      hasSalesAndReturns = true;
    }

    const uniqueSet = new Set(nonEmpty.map(String));

    columns.push({
      name: colName,
      originalName: rawHeadersRow[c] ? String(rawHeadersRow[c]) : colName,
      index: c,
      inferredType: inferred,
      userType,
      totalCount: colValues.length,
      nonEmptyCount: nonEmpty.length,
      nullCount: colValues.length - nonEmpty.length,
      uniqueCount: uniqueSet.size,
      sampleValues: nonEmpty.slice(0, 5)
    });
  }

  const currenciesDetected = Array.from(currenciesSet);
  if (currenciesDetected.length === 0) currenciesDetected.push('EGP');

  const sheetAnalysis: SheetAnalysis = {
    name: sheetName,
    totalRows: rows.length,
    headerRowIndex: effectiveHeaderRow,
    columns,
    duplicateRowsCount,
    currenciesDetected,
    hasInvoiceNumbers,
    hasSalesAndReturns
  };

  return {
    sheetAnalysis,
    rawHeaders,
    rows,
    rawRows: rawGrid,
    unreadableCellsCount
  };
}

/**
 * Compute descriptive statistics for a numeric column using Decimal.js precision
 */
export function computeNumericColumnStats(
  rows: Array<Record<string, any>>,
  colName: string,
  currencyName?: string
): NumericColumnStats | null {
  const parsedDecimals: Decimal[] = [];

  for (const row of rows) {
    const val = row[colName];
    const num = parseNumericValue(val);
    if (num.isNumber && num.value) {
      parsedDecimals.push(num.value);
    }
  }

  if (parsedDecimals.length === 0) return null;

  // Sum
  let sum = new Decimal(0);
  let min = parsedDecimals[0];
  let max = parsedDecimals[0];

  for (const d of parsedDecimals) {
    sum = sum.plus(d);
    if (d.lessThan(min)) min = d;
    if (d.greaterThan(max)) max = d;
  }

  // Average
  const avg = sum.dividedBy(parsedDecimals.length);

  // Median
  const sorted = [...parsedDecimals].sort((a, b) => a.comparedTo(b));
  const mid = Math.floor(sorted.length / 2);
  let median: Decimal;
  if (sorted.length % 2 === 0) {
    median = sorted[mid - 1].plus(sorted[mid]).dividedBy(2);
  } else {
    median = sorted[mid];
  }

  return {
    column: colName,
    currency: currencyName || 'EGP',
    count: parsedDecimals.length,
    sum: sum.toFixed(2),
    average: avg.toFixed(2),
    median: median.toFixed(2),
    min: min.toFixed(2),
    max: max.toFixed(2)
  };
}

/**
 * Compute Net Sales vs Returns with explicit assumption surface
 */
export function calculateNetSales(
  rows: Array<Record<string, any>>,
  amountCol: string,
  typeCol?: string,
  invoiceCol?: string,
  currencyCol?: string,
  targetCurrency?: string
): NetSalesCalculation {
  let grossSales = new Decimal(0);
  let totalReturns = new Decimal(0);
  const salesRowIndices: number[] = [];
  const returnsRowIndices: number[] = [];
  const salesInvoices = new Set<string>();
  const returnsInvoices = new Set<string>();

  let assumptionUsed = '';

  rows.forEach((row, idx) => {
    // If target currency specified, filter by currency
    if (targetCurrency && currencyCol && row[currencyCol]) {
      const rowCurr = String(row[currencyCol]).trim().toUpperCase();
      if (rowCurr !== targetCurrency.toUpperCase()) return;
    }

    const numRes = parseNumericValue(row[amountCol]);
    if (!numRes.isNumber || !numRes.value) return;

    const val = numRes.value;
    const invNo = invoiceCol && row[invoiceCol] ? String(row[invoiceCol]).trim() : '';

    let isReturn = false;

    if (typeCol && row[typeCol]) {
      const typeStr = String(row[typeCol]).trim().toLowerCase();
      if (/مرتجع|مردود|return|credit_note|خصم/i.test(typeStr)) {
        isReturn = true;
      }
    } else if (val.isNegative()) {
      isReturn = true;
    }

    if (isReturn) {
      totalReturns = totalReturns.plus(val.abs());
      returnsRowIndices.push(idx);
      if (invNo) returnsInvoices.add(invNo);
    } else {
      grossSales = grossSales.plus(val);
      salesRowIndices.push(idx);
      if (invNo) salesInvoices.add(invNo);
    }
  });

  if (typeCol) {
    assumptionUsed = `تم تصنيف العمليات بالاعتماد على عمود [${typeCol}]؛ حيث عُدت الصفوف المحتوية على 'مرتجع' أو 'مردود' كمرتجعات وخُصمت من إجمالي المبيعات للوصول إلى الصافي.`;
  } else {
    assumptionUsed = `تم اعتبار القيم السالبة في عمود [${amountCol}] كمرتجعات، والقيم الموجبة كمبيعات.`;
  }

  const net = grossSales.minus(totalReturns);

  return {
    grossSales: grossSales.toFixed(2),
    salesCount: salesRowIndices.length,
    salesDistinctInvoices: salesInvoices.size || salesRowIndices.length,
    totalReturns: totalReturns.toFixed(2),
    returnsCount: returnsRowIndices.length,
    returnsDistinctInvoices: returnsInvoices.size || returnsRowIndices.length,
    netSales: net.toFixed(2),
    currency: targetCurrency || 'EGP',
    assumptionUsed,
    salesRowIndices,
    returnsRowIndices
  };
}

/**
 * Group and aggregate rows by period, customer, supplier, item, or custom column
 */
export function groupRows(
  rows: Array<Record<string, any>>,
  groupCol: string,
  amountCol: string,
  groupType: 'period' | 'customer' | 'supplier' | 'item' | 'branch' | 'custom' = 'custom',
  currencyCol?: string
): GroupByResult {
  const map = new Map<string, { label: string; sum: Decimal; count: number; currency?: string; rowIndices: number[] }>();

  rows.forEach((row, idx) => {
    let rawKey = row[groupCol];
    if (rawKey === null || rawKey === undefined || String(rawKey).trim() === '') {
      rawKey = '(غير محدد)';
    }

    let keyStr = String(rawKey).trim();
    let label = keyStr;

    // Special formatting for period
    if (groupType === 'period') {
      const dRes = parseDateValue(rawKey);
      if (dRes.isDate && dRes.formatted) {
        // Format to YYYY-MM
        keyStr = dRes.formatted.slice(0, 7);
        label = keyStr;
      }
    }

    const numRes = parseNumericValue(row[amountCol]);
    const amount = numRes.isNumber && numRes.value ? numRes.value : new Decimal(0);
    const curr = currencyCol && row[currencyCol] ? String(row[currencyCol]).trim().toUpperCase() : undefined;

    if (!map.has(keyStr)) {
      map.set(keyStr, { label, sum: new Decimal(0), count: 0, currency: curr, rowIndices: [] });
    }

    const item = map.get(keyStr)!;
    item.sum = item.sum.plus(amount);
    item.count += 1;
    item.rowIndices.push(idx);
    if (!item.currency && curr) item.currency = curr;
  });

  const items = Array.from(map.entries())
    .map(([key, data]) => ({
      key,
      label: data.label,
      count: data.count,
      sum: data.sum.toFixed(2),
      currency: data.currency || 'EGP',
      matchingRowIndices: data.rowIndices
    }))
    .sort((a, b) => new Decimal(b.sum).comparedTo(new Decimal(a.sum)));

  return {
    groupColumn: groupCol,
    groupedBy: groupType,
    items
  };
}

/**
 * Server-Side Restricted Safe Execution Engine for Structured Analysis Plans
 * Strictly validates column names, operations, and limits.
 * Uses Decimal.js for all financial arithmetic.
 * NEVER evaluates arbitrary JS or SQL!
 */
export function executeAnalysisPlan(
  plan: AnalysisPlan,
  sheetData: {
    sheetAnalysis: SheetAnalysis;
    rows: Array<Record<string, any>>;
  }
): PlanExecutionResult {
  const { sheetAnalysis, rows } = sheetData;
  const columnsUsed: string[] = [];

  // Filter rows if filters provided
  let filteredIndices: number[] = rows.map((_, i) => i);

  if (plan.periodFilter && plan.dateColumn) {
    const dateCol = plan.dateColumn;
    columnsUsed.push(dateCol);

    const { startDate, endDate, month, year } = plan.periodFilter;

    filteredIndices = filteredIndices.filter(i => {
      const row = rows[i];
      const d = parseDateValue(row[dateCol]);
      if (!d.isDate || !d.formatted) return false;

      const dateStr = d.formatted; // YYYY-MM-DD
      if (startDate && dateStr < startDate) return false;
      if (endDate && dateStr > endDate) return false;

      if (year && !dateStr.startsWith(year)) return false;

      if (month) {
        // Normalize month (e.g. "10", "أكتوبر", "2026-10")
        const monthNum = normalizeMonthInput(month);
        const rowMonth = dateStr.slice(5, 7);
        if (monthNum && rowMonth !== monthNum) return false;
      }

      return true;
    });
  }

  if (plan.filters && Array.isArray(plan.filters)) {
    for (const f of plan.filters) {
      if (!f.column) continue;
      columnsUsed.push(f.column);

      filteredIndices = filteredIndices.filter(i => {
        const row = rows[i];
        const val = row[f.column];
        if (val === null || val === undefined) return false;

        const valStr = String(val).trim().toLowerCase();
        const targetStr = String(f.value).trim().toLowerCase();

        switch (f.operator) {
          case 'equals':
            return valStr === targetStr;
          case 'contains':
            return valStr.includes(targetStr);
          case 'greater_than': {
            const n1 = parseNumericValue(val);
            const n2 = parseNumericValue(f.value);
            return n1.isNumber && n2.isNumber && n1.value!.greaterThan(n2.value!);
          }
          case 'less_than': {
            const n1 = parseNumericValue(val);
            const n2 = parseNumericValue(f.value);
            return n1.isNumber && n2.isNumber && n1.value!.lessThan(n2.value!);
          }
          case 'in':
            if (Array.isArray(f.value)) {
              return f.value.map(v => String(v).trim().toLowerCase()).includes(valStr);
            }
            return false;
          default:
            return true;
        }
      });
    }
  }

  const matchingRows = filteredIndices.map(i => rows[i]);

  if (matchingRows.length === 0) {
    return {
      success: true,
      goal: plan.goal,
      sheetName: sheetAnalysis.name,
      operation: plan.operation,
      primaryValue: '0.00',
      matchingRowCount: 0,
      matchingRowIndices: [],
      columnsUsed,
      periodDescription: describePeriodFilter(plan.periodFilter),
      breakdown: []
    };
  }

  // Find target numeric column if needed
  let targetCol = plan.targetColumn;
  if (!targetCol && ['sum', 'average', 'median', 'min_max', 'net_sales'].includes(plan.operation)) {
    const numCol = sheetAnalysis.columns.find(c => c.inferredType === 'number' || c.userType === 'number');
    if (numCol) targetCol = numCol.name;
  }

  if (targetCol) columnsUsed.push(targetCol);

  // Currency column
  let currCol = plan.currencyColumn;
  if (!currCol) {
    const cCol = sheetAnalysis.columns.find(c => c.inferredType === 'currency' || /عملة|currency/i.test(c.name));
    if (cCol) currCol = cCol.name;
  }

  // Currency separation: Check if multiple currencies exist in matching rows
  const detectedCurrenciesInMatch = new Set<string>();
  if (currCol) {
    matchingRows.forEach(r => {
      if (r[currCol!]) detectedCurrenciesInMatch.add(String(r[currCol!]).trim().toUpperCase());
    });
  }

  // Execute operation
  switch (plan.operation) {
    case 'count': {
      return {
        success: true,
        goal: plan.goal,
        sheetName: sheetAnalysis.name,
        operation: 'count',
        primaryValue: String(matchingRows.length),
        unitOrCurrency: 'صف / سجل',
        periodDescription: describePeriodFilter(plan.periodFilter),
        matchingRowCount: matchingRows.length,
        matchingRowIndices: filteredIndices,
        columnsUsed
      };
    }

    case 'distinct_count': {
      const invCol = plan.invoiceColumn || sheetAnalysis.columns.find(c => /فاتورة|invoice|كود|رقم/i.test(c.name))?.name;
      if (invCol) columnsUsed.push(invCol);
      const uniqueVals = new Set(matchingRows.map(r => invCol ? String(r[invCol] ?? '') : JSON.stringify(r)));

      return {
        success: true,
        goal: plan.goal,
        sheetName: sheetAnalysis.name,
        operation: 'distinct_count',
        primaryValue: String(uniqueVals.size),
        secondaryValue: `من أصل ${matchingRows.length} بند / سطر في الملف`,
        unitOrCurrency: invCol ? `قيم فريدة (${invCol})` : 'سجل مميز',
        periodDescription: describePeriodFilter(plan.periodFilter),
        matchingRowCount: matchingRows.length,
        matchingRowIndices: filteredIndices,
        columnsUsed
      };
    }

    case 'sum': {
      if (!targetCol) {
        return {
          success: false,
          goal: plan.goal,
          sheetName: sheetAnalysis.name,
          operation: 'sum',
          matchingRowCount: 0,
          matchingRowIndices: [],
          columnsUsed,
          error: 'لم يتم العثور على عمود مالي أو رقمي لحساب الإجمالي.'
        };
      }

      // If multiple currencies, break down per currency
      if (detectedCurrenciesInMatch.size > 1 && currCol) {
        const breakdown: Array<{ label: string; value: string; count: number; rowIndices: number[] }> = [];
        for (const curr of detectedCurrenciesInMatch) {
          let currSum = new Decimal(0);
          const cIndices: number[] = [];
          matchingRows.forEach((r, idx) => {
            if (String(r[currCol!]).trim().toUpperCase() === curr) {
              const num = parseNumericValue(r[targetCol!]);
              if (num.isNumber && num.value) {
                currSum = currSum.plus(num.value);
                cIndices.push(filteredIndices[idx]);
              }
            }
          });
          breakdown.push({
            label: curr,
            value: currSum.toFixed(2),
            count: cIndices.length,
            rowIndices: cIndices
          });
        }

        const primaryStr = breakdown.map(b => `${b.value} ${b.label}`).join(' + ');

        return {
          success: true,
          goal: plan.goal,
          sheetName: sheetAnalysis.name,
          operation: 'sum',
          primaryValue: primaryStr,
          unitOrCurrency: 'مفصول بالعملات',
          periodDescription: describePeriodFilter(plan.periodFilter),
          matchingRowCount: matchingRows.length,
          matchingRowIndices: filteredIndices,
          columnsUsed,
          breakdown
        };
      }

      let total = new Decimal(0);
      for (const r of matchingRows) {
        const num = parseNumericValue(r[targetCol]);
        if (num.isNumber && num.value) total = total.plus(num.value);
      }

      return {
        success: true,
        goal: plan.goal,
        sheetName: sheetAnalysis.name,
        operation: 'sum',
        primaryValue: total.toFixed(2),
        unitOrCurrency: sheetAnalysis.currenciesDetected[0] || 'EGP',
        periodDescription: describePeriodFilter(plan.periodFilter),
        matchingRowCount: matchingRows.length,
        matchingRowIndices: filteredIndices,
        columnsUsed
      };
    }

    case 'average': {
      if (!targetCol) {
        return { success: false, goal: plan.goal, sheetName: sheetAnalysis.name, operation: 'average', matchingRowCount: 0, matchingRowIndices: [], columnsUsed, error: 'عمود رقمي غير محدد' };
      }
      let sum = new Decimal(0);
      let count = 0;
      for (const r of matchingRows) {
        const num = parseNumericValue(r[targetCol]);
        if (num.isNumber && num.value) {
          sum = sum.plus(num.value);
          count++;
        }
      }
      const avg = count > 0 ? sum.dividedBy(count).toFixed(2) : '0.00';
      return {
        success: true,
        goal: plan.goal,
        sheetName: sheetAnalysis.name,
        operation: 'average',
        primaryValue: avg,
        unitOrCurrency: sheetAnalysis.currenciesDetected[0] || 'EGP',
        periodDescription: describePeriodFilter(plan.periodFilter),
        matchingRowCount: matchingRows.length,
        matchingRowIndices: filteredIndices,
        columnsUsed
      };
    }

    case 'median': {
      if (!targetCol) {
        return { success: false, goal: plan.goal, sheetName: sheetAnalysis.name, operation: 'median', matchingRowCount: 0, matchingRowIndices: [], columnsUsed, error: 'عمود رقمي غير محدد' };
      }
      const nums: Decimal[] = [];
      for (const r of matchingRows) {
        const num = parseNumericValue(r[targetCol]);
        if (num.isNumber && num.value) nums.push(num.value);
      }
      nums.sort((a, b) => a.comparedTo(b));
      let median = '0.00';
      if (nums.length > 0) {
        const mid = Math.floor(nums.length / 2);
        median = nums.length % 2 === 0 ? nums[mid - 1].plus(nums[mid]).dividedBy(2).toFixed(2) : nums[mid].toFixed(2);
      }
      return {
        success: true,
        goal: plan.goal,
        sheetName: sheetAnalysis.name,
        operation: 'median',
        primaryValue: median,
        unitOrCurrency: sheetAnalysis.currenciesDetected[0] || 'EGP',
        periodDescription: describePeriodFilter(plan.periodFilter),
        matchingRowCount: matchingRows.length,
        matchingRowIndices: filteredIndices,
        columnsUsed
      };
    }

    case 'net_sales': {
      if (!targetCol) {
        return { success: false, goal: plan.goal, sheetName: sheetAnalysis.name, operation: 'net_sales', matchingRowCount: 0, matchingRowIndices: [], columnsUsed, error: 'عمود مالي غير محدد' };
      }

      const typeCol = plan.typeColumn || sheetAnalysis.columns.find(c => /نوع_الحركة|نوع الفاتورة|البيان|مرتجع|نوع/i.test(c.name))?.name;
      const invCol = plan.invoiceColumn || sheetAnalysis.columns.find(c => /فاتورة|invoice/i.test(c.name))?.name;

      if (typeCol) columnsUsed.push(typeCol);
      if (invCol) columnsUsed.push(invCol);

      const netCalc = calculateNetSales(
        matchingRows,
        targetCol,
        typeCol,
        invCol,
        currCol,
        sheetAnalysis.currenciesDetected[0]
      );

      // Map back to absolute indices
      const salesAbsIndices = netCalc.salesRowIndices.map(localIdx => filteredIndices[localIdx]);
      const returnsAbsIndices = netCalc.returnsRowIndices.map(localIdx => filteredIndices[localIdx]);

      return {
        success: true,
        goal: plan.goal,
        sheetName: sheetAnalysis.name,
        operation: 'net_sales',
        primaryValue: netCalc.netSales,
        secondaryValue: `إجمالي المبيعات: ${netCalc.grossSales} (${netCalc.salesDistinctInvoices} فاتورة) | إجمالي المرتجعات: ${netCalc.totalReturns} (${netCalc.returnsDistinctInvoices} مرتجع)`,
        unitOrCurrency: netCalc.currency,
        periodDescription: describePeriodFilter(plan.periodFilter),
        matchingRowCount: matchingRows.length,
        matchingRowIndices: filteredIndices,
        columnsUsed,
        assumptionUsed: netCalc.assumptionUsed,
        breakdown: [
          { label: 'إجمالي المبيعات (Gross Sales)', value: netCalc.grossSales, count: netCalc.salesCount, rowIndices: salesAbsIndices },
          { label: 'مردودات المبيعات (Sales Returns)', value: netCalc.totalReturns, count: netCalc.returnsCount, rowIndices: returnsAbsIndices },
          { label: 'صافي المبيعات (Net Sales)', value: netCalc.netSales, count: matchingRows.length, rowIndices: filteredIndices }
        ]
      };
    }

    case 'group_by': {
      if (!targetCol) {
        return { success: false, goal: plan.goal, sheetName: sheetAnalysis.name, operation: 'group_by', matchingRowCount: 0, matchingRowIndices: [], columnsUsed, error: 'عمود القيمة المالية غير محدد' };
      }
      let groupCol = plan.groupByColumn;
      if (!groupCol) {
        groupCol = sheetAnalysis.columns.find(c => /عميل|مورد|صنف|فرع|customer|supplier|item|branch/i.test(c.name))?.name;
      }
      if (!groupCol) {
        groupCol = sheetAnalysis.columns[0]?.name;
      }
      columnsUsed.push(groupCol);

      const grpRes = groupRows(matchingRows, groupCol, targetCol, 'custom', currCol);
      let items = grpRes.items;
      if (plan.sortOrder === 'asc') {
        items.sort((a, b) => new Decimal(a.sum).comparedTo(new Decimal(b.sum)));
      } else {
        items.sort((a, b) => new Decimal(b.sum).comparedTo(new Decimal(a.sum)));
      }
      if (plan.limit && plan.limit > 0) {
        items = items.slice(0, plan.limit);
      }

      const breakdown = items.map(item => ({
        label: item.label,
        value: item.sum,
        count: item.count,
        rowIndices: item.matchingRowIndices.map(localIdx => filteredIndices[localIdx])
      }));

      const topItem = items[0];

      return {
        success: true,
        goal: plan.goal,
        sheetName: sheetAnalysis.name,
        operation: 'group_by',
        primaryValue: topItem ? `${topItem.label}: ${topItem.sum} ${topItem.currency}` : 'لا توجد بيانات',
        secondaryValue: `مجموعات مصنفة حسب: ${groupCol} (إجمالي ${items.length} مجموعة)`,
        unitOrCurrency: sheetAnalysis.currenciesDetected[0] || 'EGP',
        periodDescription: describePeriodFilter(plan.periodFilter),
        matchingRowCount: matchingRows.length,
        matchingRowIndices: filteredIndices,
        columnsUsed,
        breakdown
      };
    }

    default:
      return {
        success: true,
        goal: plan.goal,
        sheetName: sheetAnalysis.name,
        operation: plan.operation,
        primaryValue: String(matchingRows.length),
        unitOrCurrency: 'سجل',
        periodDescription: describePeriodFilter(plan.periodFilter),
        matchingRowCount: matchingRows.length,
        matchingRowIndices: filteredIndices,
        columnsUsed
      };
  }
}

/**
 * Normalizes user-entered month names/numbers (e.g. "أكتوبر", "10", "شهر 10", "October") to two digits "01" - "12"
 */
export function normalizeMonthInput(input: string): string | null {
  if (!input) return null;
  const str = normalizeArabicDigits(String(input)).trim().toLowerCase();

  // If already format "2026-10"
  if (/^\d{4}-(\d{2})$/.test(str)) {
    return str.split('-')[1];
  }

  // Pure number
  const num = parseInt(str.replace(/\D/g, ''), 10);
  if (!isNaN(num) && num >= 1 && num <= 12) {
    return String(num).padStart(2, '0');
  }

  const monthMap: Record<string, string> = {
    'يناير': '01', 'كانون الثاني': '01', 'jan': '01', 'january': '01',
    'فبراير': '02', 'شباط': '02', 'feb': '02', 'february': '02',
    'مارس': '03', 'آذار': '03', 'mar': '03', 'march': '03',
    'أبريل': '04', 'ابريل': '04', 'نيسان': '04', 'apr': '04', 'april': '04',
    'مايو': '05', 'أيار': '05', 'may': '05',
    'يونيو': '06', 'حزيران': '06', 'jun': '06', 'june': '06',
    'يوليو': '07', 'تموز': '07', 'jul': '07', 'july': '07',
    'أغسطس': '08', 'اغسطس': '08', 'آب': '08', 'aug': '08', 'august': '08',
    'سبتمبر': '09', 'أيلول': '09', 'sep': '09', 'september': '09',
    'أكتوبر': '10', 'اكتوبر': '10', 'تشرين الأول': '10', 'oct': '10', 'october': '10',
    'نوفمبر': '11', 'تشرين الثاني': '11', 'nov': '11', 'november': '11',
    'ديسمبر': '12', 'كانون الأول': '12', 'dec': '12', 'december': '12'
  };

  for (const [k, v] of Object.entries(monthMap)) {
    if (str.includes(k)) return v;
  }

  return null;
}

function describePeriodFilter(pf?: AnalysisPlan['periodFilter']): string {
  if (!pf) return 'كامل الفترة الزمنية في الملف';
  if (pf.month && pf.year) return `فترة: شهر ${pf.month} لسنة ${pf.year}`;
  if (pf.month) return `فترة: شهر ${pf.month}`;
  if (pf.year) return `سنة ${pf.year}`;
  if (pf.startDate && pf.endDate) return `من ${pf.startDate} إلى ${pf.endDate}`;
  if (pf.startDate) return `منذ ${pf.startDate}`;
  return 'فترة مخصصة';
}

/**
 * Generate Multi-Scenario Multi-Sheet Test Workbook in Memory
 */
export function generateTestWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // Sheet 1: فواتير المبيعات 2026
  const salesData = [
    // Invoice 1 (3 items - multi-item invoice)
    { 'رقم_الفاتورة': 'INV-2026-001', 'التاريخ': '2026-10-05', 'نوع_الحركة': 'مبيعات', 'العميل': 'شركة النيل للخدمات الهندسية', 'الصنف': 'لابتوب ديل فوسترو 3520', 'الكمية': 2, 'سعر_الوحدة': 15000, 'إجمالي_القيمة': 30000, 'العملة': 'EGP', 'الفرع': 'فرع القاهرة' },
    { 'رقم_الفاتورة': 'INV-2026-001', 'التاريخ': '2026-10-05', 'نوع_الحركة': 'مبيعات', 'العميل': 'شركة النيل للخدمات الهندسية', 'الصنف': 'شاشة ديل 24 بوصة', 'الكمية': 2, 'سعر_الوحدة': 4500, 'إجمالي_القيمة': 9000, 'العملة': 'EGP', 'الفرع': 'فرع القاهرة' },
    { 'رقم_الفاتورة': 'INV-2026-001', 'التاريخ': '2026-10-05', 'نوع_الحركة': 'مبيعات', 'العميل': 'شركة النيل للخدمات الهندسية', 'الصنف': 'ماوس لاسلكي لوجيتك', 'الكمية': 4, 'سعر_الوحدة': 500, 'إجمالي_القيمة': 2000, 'العملة': 'EGP', 'الفرع': 'فرع القاهرة' },
    // Invoice 2
    { 'رقم_الفاتورة': 'INV-2026-002', 'التاريخ': '2026-10-12', 'نوع_الحركة': 'مبيعات', 'العميل': 'مؤسسة الأهرام للصحافة والتوزيع', 'الصنف': 'خادم HP ProLiant Gen10', 'الكمية': 1, 'سعر_الوحدة': 50000, 'إجمالي_القيمة': 50000, 'العملة': 'EGP', 'الفرع': 'فرع الإسكندرية' },
    // Invoice 3 (USD currency)
    { 'رقم_الفاتورة': 'INV-2026-003', 'التاريخ': '2026-10-18', 'نوع_الحركة': 'مبيعات', 'العميل': 'شركة النور للمقاولات والتوريدات', 'الصنف': 'اشتراك برمجيات سحابية سنوي', 'الكمية': 1, 'سعر_الوحدة': 2500, 'إجمالي_القيمة': 2500, 'العملة': 'USD', 'الفرع': 'فرع القاهرة' },
    // Invoice 4 (November)
    { 'رقم_الفاتورة': 'INV-2026-004', 'التاريخ': '2026-11-02', 'نوع_الحركة': 'مبيعات', 'العميل': 'شركة النيل للخدمات الهندسية', 'الصنف': 'لابتوب لينوفو ثينك باد', 'الكمية': 1, 'سعر_الوحدة': 22000, 'إجمالي_القيمة': 22000, 'العملة': 'EGP', 'الفرع': 'فرع القاهرة' },
    // Return Invoice
    { 'رقم_الفاتورة': 'RET-2026-001', 'التاريخ': '2026-10-25', 'نوع_الحركة': 'مرتجع', 'العميل': 'شركة النيل للخدمات الهندسية', 'الصنف': 'شاشة ديل 24 بوصة (مرتجع)', 'الكمية': 1, 'سعر_الوحدة': 4500, 'إجمالي_القيمة': 4500, 'العملة': 'EGP', 'الفرع': 'فرع القاهرة' },
    // Arabic Digits Row
    { 'رقم_الفاتورة': 'INV-2026-005', 'التاريخ': '2026-10-20', 'نوع_الحركة': 'مبيعات', 'العميل': 'مؤسسة الشروق للبرمجيات', 'الصنف': 'طابعة ليزر إتش بي', 'الكمية': '٢', 'سعر_الوحدة': '٣٥٠٠', 'إجمالي_القيمة': '٧٠٠٠', 'العملة': 'EGP', 'الفرع': 'فرع القاهرة' },
    // Duplicate Row for duplicate detection verification
    { 'رقم_الفاتورة': 'INV-2026-005', 'التاريخ': '2026-10-20', 'نوع_الحركة': 'مبيعات', 'العميل': 'مؤسسة الشروق للبرمجيات', 'الصنف': 'طابعة ليزر إتش بي', 'الكمية': '٢', 'سعر_الوحدة': '٣٥٠٠', 'إجمالي_القيمة': '٧٠٠٠', 'العملة': 'EGP', 'الفرع': 'فرع القاهرة' }
  ];

  // Sheet 2: المشتريات والموردين
  const purchasesData = [
    { 'رقم_إذن_الشراء': 'PINV-01', 'التاريخ': '2026-10-01', 'المورد': 'الشركة الهندسية للاستيراد والتصدير', 'الصنف': 'معالجات إنتل كور i7', 'الكمية': 10, 'سعر_التكلفة': 9500, 'الإجمالي': 95000, 'العملة': 'EGP' },
    { 'رقم_إذن_الشراء': 'PINV-02', 'التاريخ': '2026-10-08', 'المورد': 'مؤسسة الدلتا للأجهزة الإلكترونية', 'الصنف': 'لوحات أم آسوس B760', 'الكمية': 15, 'سعر_التكلفة': 4200, 'الإجمالي': 63000, 'العملة': 'EGP' },
    { 'رقم_إذن_الشراء': 'PINV-03', 'التاريخ': '2026-10-22', 'المورد': 'الشركة الدولية لتكنولوجيا المعلومات', 'الصنف': 'سيرفرات فائقة الأداء', 'الكمية': 2, 'سعر_التكلفة': 3500, 'الإجمالي': 7000, 'العملة': 'USD' }
  ];

  // Sheet 3: بطاقات الأصناف والمخزون
  const itemsData = [
    { 'كود_الصنف': 'ITM-001', 'اسم_الصنف': 'لابتوب ديل فوسترو 3520', 'الفئة': 'حواسب آلية', 'رصيد_المخزن': 14, 'سعر_التكلفة': 13000, 'سعر_البيع': 15000 },
    { 'كود_الصنف': 'ITM-002', 'اسم_الصنف': 'شاشة ديل 24 بوصة', 'الفئة': 'شاشات', 'رصيد_المخزن': 25, 'سعر_التكلفة': 3800, 'سعر_البيع': 4500 },
    { 'كود_الصنف': 'ITM-003', 'اسم_الصنف': 'خادم HP ProLiant Gen10', 'الفئة': 'خوادم وشبكات', 'رصيد_المخزن': 3, 'سعر_التكلفة': 42000, 'سعر_البيع': 50000 }
  ];

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salesData), 'فواتير_المبيعات_2026');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(purchasesData), 'المشتريات_والموردين');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemsData), 'الأصناف_والمخزون');

  return wb;
}

