import React, { useState, useEffect } from 'react';
import { FileSpreadsheet, Download, Printer, CheckCircle, AlertCircle, RefreshCw, Layers, ChevronDown, ChevronUp, Clock, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Language, translations } from '../translations';
import { apiClient } from '../services/apiClient';

interface FinancialReportsViewProps {
  token: string;
  lang: Language;
}

export const FinancialReportsView: React.FC<FinancialReportsViewProps> = ({ token, lang }) => {
  const t = translations[lang];
  const [activeReport, setActiveReport] = useState<'trial' | 'income' | 'balance' | 'vat' | 'cust_aging' | 'supp_aging'>('trial');
  const [fromDate, setFromDate] = useState('2026-01-01');
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [trialData, setTrialData] = useState<any>(null);
  const [incomeData, setIncomeData] = useState<any>(null);
  const [balanceData, setBalanceData] = useState<any>(null);
  const [vatData, setVatData] = useState<any>(null);
  const [custAgingData, setCustAgingData] = useState<any>(null);
  const [suppAgingData, setSuppAgingData] = useState<any>(null);
  const [expandedParties, setExpandedParties] = useState<Record<string, boolean>>({});

  const togglePartyExpand = (partyId: string) => {
    setExpandedParties(prev => ({ ...prev, [partyId]: !prev[partyId] }));
  };

  const formatEGP = (val: number) => {
    return (val || 0).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' ج.م';
  };

  const loadReportData = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      if (activeReport === 'trial') {
        const data = await apiClient.get(`/reports/trial-balance?fromDate=${fromDate}&toDate=${toDate}`);
        setTrialData(data);
      } else if (activeReport === 'income') {
        const data = await apiClient.get(`/reports/income-statement?fromDate=${fromDate}&toDate=${toDate}`);
        setIncomeData(data);
      } else if (activeReport === 'balance') {
        const data = await apiClient.get(`/reports/balance-sheet?toDate=${toDate}`);
        setBalanceData(data);
      } else if (activeReport === 'vat') {
        const data = await apiClient.get(`/reports/vat-return?fromDate=${fromDate}&toDate=${toDate}`);
        setVatData(data);
      } else if (activeReport === 'cust_aging') {
        const data = await apiClient.get(`/reports/aging/receivables?asOfDate=${toDate}`);
        setCustAgingData(data);
      } else if (activeReport === 'supp_aging') {
        const data = await apiClient.get(`/reports/aging/payables?asOfDate=${toDate}`);
        setSuppAgingData(data);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'فشل تحميل بيانات التقرير المالي');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReportData();
  }, [activeReport]);

  const handleExportExcel = () => {
    let wsData: any[][] = [];
    let filename = 'report.xlsx';

    if (activeReport === 'trial' && trialData) {
      filename = 'Trial_Balance_2026.xlsx';
      wsData = [
        ['ميزان المراجعة بالأرصدة والمجاميع - شركة الميزان للتجارة والتوريدات'],
        ['كود الحساب', 'اسم الحساب', 'النوع', 'مجموع المدين', 'مجموع الدائن', 'رصيد مدين', 'رصيد دائن'],
        ...trialData.rows.map((r: any) => [
          r.code,
          r.name_ar,
          r.account_type,
          r.period_debit,
          r.period_credit,
          r.balance_debit,
          r.balance_credit
        ]),
        [
          'الإجمالي',
          '',
          '',
          trialData.totals?.totalDebit,
          trialData.totals?.totalCredit,
          trialData.totals?.totalDebit,
          trialData.totals?.totalCredit
        ]
      ];
    } else if (activeReport === 'income' && incomeData) {
      filename = 'Income_Statement_2026.xlsx';
      wsData = [
        ['قائمة الدخل المعتمدة - شركة الميزان للتجارة والتوريدات'],
        ['البند المالي', 'المبلغ (ج.م)'],
        ['إجمالي الإيرادات التجارية', incomeData.totalRevenue],
        ['تكلفة البضاعة المباعة (COGS)', -incomeData.totalCogs],
        ['مجمل الربح التجاري', incomeData.grossProfit],
        ['إجمالي المصروفات التشغيلية والعمومية', -incomeData.totalExpenses],
        ['صافي الربح قبل الضرائب', incomeData.netIncome]
      ];
    } else if (activeReport === 'vat' && vatData) {
      filename = 'Egyptian_VAT_Return_14.xlsx';
      wsData = [
        ['نموذج إقرار ضريبة القيمة المضافة - مصلحة الضرائب المصرية'],
        ['البيان الضريبي', 'المبلغ بالجنيه المصري'],
        ['ضريبة القيمة المضافة على المبيعات (مخرجات 14%)', vatData.outputVat],
        ['ضريبة القيمة المضافة على المشتريات (مدخلات قابلة للخصم 14%)', -vatData.inputVat],
        ['صافي الضريبة المستحقة للسداد', vatData.netVatPayable],
        ['ضرائب الخصم والتحصيل المستقطعة (1%) أمانات', vatData.withholdingTaxCredit]
      ];
    } else if (activeReport === 'cust_aging' && custAgingData) {
      filename = `Customer_Aging_${toDate}.xlsx`;
      wsData = [
        [`تقرير أعمار ديون العملاء كما في تاريخ: ${toDate}`],
        ['كود العميل', 'اسم العميل', 'الهاتف', 'إجمالي الرصيد', 'غير مستحق (جاري)', '1-30 يوم', '31-60 يوم', '61-90 يوم', '+90 يوم', 'دفعات غير مخصصة'],
        ...custAgingData.rows.map((r: any) => [
          r.partyCode,
          r.partyName,
          r.partyPhone || '',
          r.currentBalance,
          r.notDue,
          r.bucket1_30,
          r.bucket31_60,
          r.bucket61_90,
          r.bucket90Plus,
          r.unallocatedAdvances
        ]),
        [
          'الإجمالي',
          '',
          '',
          custAgingData.totals?.totalOutstanding,
          custAgingData.totals?.totalNotDue,
          custAgingData.totals?.total1_30,
          custAgingData.totals?.total31_60,
          custAgingData.totals?.total61_90,
          custAgingData.totals?.total90Plus,
          custAgingData.totals?.totalUnallocatedAdvances
        ]
      ];
    } else if (activeReport === 'supp_aging' && suppAgingData) {
      filename = `Supplier_Aging_${toDate}.xlsx`;
      wsData = [
        [`تقرير أعمار مستحقات الموردين كما في تاريخ: ${toDate}`],
        ['كود المورد', 'اسم المورد', 'الهاتف', 'إجمالي المستحق', 'غير مستحق (جاري)', '1-30 يوم', '31-60 يوم', '61-90 يوم', '+90 يوم', 'دفعات غير مخصصة'],
        ...suppAgingData.rows.map((r: any) => [
          r.partyCode,
          r.partyName,
          r.partyPhone || '',
          r.currentBalance,
          r.notDue,
          r.bucket1_30,
          r.bucket31_60,
          r.bucket61_90,
          r.bucket90Plus,
          r.unallocatedAdvances
        ]),
        [
          'الإجمالي',
          '',
          '',
          suppAgingData.totals?.totalOutstanding,
          suppAgingData.totals?.totalNotDue,
          suppAgingData.totals?.total1_30,
          suppAgingData.totals?.total31_60,
          suppAgingData.totals?.total61_90,
          suppAgingData.totals?.total90Plus,
          suppAgingData.totals?.totalUnallocatedAdvances
        ]
      ];
    }
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, filename);
  };

  return (
    <div className="space-y-6">
      {/* Header & Sub-Tabs */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            {t.reports} والقوائم المحاسبية الختامية
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            تقارير خادم معتمدة تعتمد على جميع حركات الأستاذ العام وتطبق المعايير المحاسبية والضريبية المصرية.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
            <span className="text-slate-500 px-1">{lang === 'ar' ? 'من:' : 'From:'}</span>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-800"
            />
            <span className="text-slate-500 px-1">{lang === 'ar' ? 'إلى:' : 'To:'}</span>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-800"
            />
            <button
              onClick={loadReportData}
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium transition"
            >
              {lang === 'ar' ? 'تطبيق الفلتر' : 'Filter'}
            </button>
          </div>

          <button
            onClick={handleExportExcel}
            className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-4 h-4" />
            تصدير ملف Excel
          </button>
          <button
            onClick={() => window.print()}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors"
          >
            <Printer className="w-4 h-4" />
            طباعة
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Reports Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 text-xs font-semibold overflow-x-auto">
        <button
          onClick={() => setActiveReport('trial')}
          className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
            activeReport === 'trial'
              ? 'bg-emerald-600 text-white font-bold'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          {t.trialBalance} (بالمجاميع والأرصدة)
        </button>
        <button
          onClick={() => setActiveReport('income')}
          className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
            activeReport === 'income'
              ? 'bg-emerald-600 text-white font-bold'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          {t.incomeStatement} (الأرباح والخسائر)
        </button>
        <button
          onClick={() => setActiveReport('balance')}
          className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
            activeReport === 'balance'
              ? 'bg-emerald-600 text-white font-bold'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          {t.balanceSheet} (المركز المالي)
        </button>
        <button
          onClick={() => setActiveReport('vat')}
          className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
            activeReport === 'vat'
              ? 'bg-emerald-600 text-white font-bold'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          {t.vatReturn} (نموذج 10 ضرائب مصرية)
        </button>
        <button
          onClick={() => setActiveReport('cust_aging')}
          className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
            activeReport === 'cust_aging'
              ? 'bg-emerald-600 text-white font-bold'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          {lang === 'ar' ? 'أعمار ديون العملاء والتحصيل' : 'Customer Aging & Receivables'}
        </button>
        <button
          onClick={() => setActiveReport('supp_aging')}
          className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
            activeReport === 'supp_aging'
              ? 'bg-emerald-600 text-white font-bold'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          {lang === 'ar' ? 'أعمار مستحقات الموردين والسداد' : 'Supplier Aging & Payables'}
        </button>
      </div>

      {/* 1. Trial Balance Report */}
      {activeReport === 'trial' && trialData && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-bold text-slate-800 text-sm">ميزان المراجعة الشامل لجميع حسابات الأستاذ</h3>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                الميزان متزن: المدين = الدائن
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-2.5 text-start">كود الحساب</th>
                  <th className="p-2.5 text-start">اسم الحساب المالي</th>
                  <th className="p-2.5 text-end">مجموع المدين</th>
                  <th className="p-2.5 text-end">مجموع الدائن</th>
                  <th className="p-2.5 text-end">رصيد مدين</th>
                  <th className="p-2.5 text-end">رصيد دائن</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trialData.rows.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="p-2 font-mono font-bold text-emerald-800">{r.code}</td>
                    <td className="p-2 font-medium text-slate-900">{r.name_ar}</td>
                    <td className="p-2 text-end font-mono-numbers text-slate-600">
                      {r.period_debit > 0 ? formatEGP(r.period_debit) : '-'}
                    </td>
                    <td className="p-2 text-end font-mono-numbers text-slate-600">
                      {r.period_credit > 0 ? formatEGP(r.period_credit) : '-'}
                    </td>
                    <td className="p-2 text-end font-mono-numbers font-bold text-sky-800">
                      {r.balance_debit > 0 ? formatEGP(r.balance_debit) : '-'}
                    </td>
                    <td className="p-2 text-end font-mono-numbers font-bold text-emerald-800">
                      {r.balance_credit > 0 ? formatEGP(r.balance_credit) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-900 text-white font-bold border-t-2 border-slate-900">
                <tr>
                  <td colSpan={2} className="p-3 text-start">الإجمالي العام لميزان المراجعة</td>
                  <td className="p-3 text-end font-mono-numbers">{formatEGP(trialData.totals?.totalDebit)}</td>
                  <td className="p-3 text-end font-mono-numbers">{formatEGP(trialData.totals?.totalCredit)}</td>
                  <td className="p-3 text-end font-mono-numbers text-sky-300">{formatEGP(trialData.totals?.totalDebit)}</td>
                  <td className="p-3 text-end font-mono-numbers text-emerald-300">{formatEGP(trialData.totals?.totalCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* 2. Income Statement Report */}
      {activeReport === 'income' && incomeData && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 max-w-3xl mx-auto space-y-6">
          <div className="text-center pb-4 border-b border-slate-200">
            <h3 className="text-base font-bold text-slate-900">قائمة الدخل الشاملة عن الفترة المالية 2026</h3>
            <p className="text-xs text-slate-500 mt-1">وفقاً لمعايير المحاسبة المصرية (EAS)</p>
          </div>

          <div className="space-y-4 text-xs">
            {/* Revenues */}
            <div>
              <div className="flex justify-between font-bold text-sm text-slate-800 pb-1 border-b border-slate-200">
                <span>إيرادات النشاط الرئيسي:</span>
                <span className="font-mono-numbers text-emerald-700">{formatEGP(incomeData.totalRevenue)}</span>
              </div>
              <div className="ps-4 py-2 space-y-1">
                {incomeData.revenues?.map((r: any, idx: number) => (
                  <div key={idx} className="flex justify-between text-slate-600">
                    <span>{r.name_ar}</span>
                    <span className="font-mono-numbers">{formatEGP(r.amount)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Cost of Goods Sold */}
            <div>
              <div className="flex justify-between font-bold text-sm text-slate-800 pb-1 border-b border-slate-200">
                <span>تكلفة المبيعات (COGS):</span>
                <span className="font-mono-numbers text-rose-700">- {formatEGP(incomeData.totalCogs)}</span>
              </div>
              <div className="ps-4 py-2 space-y-1">
                {incomeData.cogs?.map((c: any, idx: number) => (
                  <div key={idx} className="flex justify-between text-slate-600">
                    <span>{c.name_ar}</span>
                    <span className="font-mono-numbers">{formatEGP(c.amount)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Gross Profit */}
            <div className="p-3 bg-slate-50 rounded-lg flex justify-between font-bold text-sm text-slate-900 border border-slate-200">
              <span>مجمل الربح التجاري:</span>
              <span className="font-mono-numbers text-emerald-800">{formatEGP(incomeData.grossProfit)}</span>
            </div>

            {/* Operating Expenses */}
            <div>
              <div className="flex justify-between font-bold text-sm text-slate-800 pb-1 border-b border-slate-200">
                <span>المصروفات التشغيلية والبيعية والعمومية:</span>
                <span className="font-mono-numbers text-rose-700">- {formatEGP(incomeData.totalExpenses)}</span>
              </div>
              <div className="ps-4 py-2 space-y-1">
                {incomeData.expenses?.map((e: any, idx: number) => (
                  <div key={idx} className="flex justify-between text-slate-600">
                    <span>{e.name_ar}</span>
                    <span className="font-mono-numbers">{formatEGP(e.amount)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Net Income */}
            <div className="p-4 bg-emerald-50 rounded-xl flex justify-between font-black text-base text-slate-900 border-2 border-emerald-500">
              <span>صافي أرباح النشاط عن العام الحالي:</span>
              <span className="font-mono-numbers text-emerald-900">{formatEGP(incomeData.netIncome)}</span>
            </div>
          </div>
        </div>
      )}

      {/* 3. Balance Sheet */}
      {activeReport === 'balance' && balanceData && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200">
            <div>
              <h3 className="text-base font-bold text-slate-900">قائمة المركز المالي (الميزانية العمومية)</h3>
              <p className="text-xs text-slate-500">الأصول = الالتزامات + حقوق الملكية</p>
            </div>
            <span className="px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-full">
              متوازنة محاسبياً
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-xs">
            {/* Assets */}
            <div className="space-y-4">
              <h4 className="font-bold text-sm text-emerald-800 pb-2 border-b border-emerald-200">
                الأصول (Assets)
              </h4>
              <div className="space-y-2">
                {balanceData.assets?.map((a: any, idx: number) => (
                  <div key={idx} className="flex justify-between p-2 bg-slate-50 rounded">
                    <span>{a.code} - {a.name_ar}</span>
                    <span className="font-mono-numbers font-semibold">{formatEGP(a.balance)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between p-3 bg-emerald-50 font-bold text-sm text-emerald-900 rounded-lg">
                <span>إجمالي الأصول:</span>
                <span className="font-mono-numbers">{formatEGP(balanceData.totalAssets)}</span>
              </div>
            </div>

            {/* Liabilities & Equity */}
            <div className="space-y-4">
              <h4 className="font-bold text-sm text-amber-800 pb-2 border-b border-amber-200">
                الالتزامات وحقوق الملكية
              </h4>
              <div className="space-y-2">
                <div className="font-semibold text-slate-700">الالتزامات المتداولة:</div>
                {balanceData.liabilities?.map((l: any, idx: number) => (
                  <div key={idx} className="flex justify-between p-2 bg-slate-50 rounded">
                    <span>{l.code} - {l.name_ar}</span>
                    <span className="font-mono-numbers font-semibold">{formatEGP(l.balance)}</span>
                  </div>
                ))}

                <div className="font-semibold text-slate-700 pt-2">حقوق الملكية ورأس المال:</div>
                {balanceData.equity?.map((e: any, idx: number) => (
                  <div key={idx} className="flex justify-between p-2 bg-slate-50 rounded">
                    <span>{e.code} - {e.name_ar}</span>
                    <span className="font-mono-numbers font-semibold">{formatEGP(e.balance)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between p-3 bg-amber-50 font-bold text-sm text-amber-900 rounded-lg">
                <span>إجمالي الالتزامات وحقوق الملكية:</span>
                <span className="font-mono-numbers">
                  {formatEGP(balanceData.totalLiabilities + balanceData.totalEquity)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Egyptian VAT Return */}
      {activeReport === 'vat' && vatData && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 max-w-2xl mx-auto space-y-6">
          <div className="text-center pb-4 border-b border-slate-200">
            <h3 className="text-base font-bold text-slate-900">
              ملخص إقرار ضريبة القيمة المضافة (نموذج 10)
            </h3>
            <p className="text-xs text-slate-500 mt-1">مصلحة الضرائب المصرية - قانون الإجراءات الضريبية الموحد</p>
          </div>

          <div className="space-y-4 text-xs">
            <div className="flex justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-slate-700 font-medium">ضريبة المبيعات المحصلة (مخرجات 14%):</span>
              <span className="font-mono-numbers font-bold text-emerald-800">{formatEGP(vatData.outputVat)}</span>
            </div>

            <div className="flex justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-slate-700 font-medium">ضريبة المشتريات القابلة للخصم (مدخلات 14%):</span>
              <span className="font-mono-numbers font-bold text-rose-800">- {formatEGP(vatData.inputVat)}</span>
            </div>

            <div className="flex justify-between p-4 bg-emerald-50 rounded-xl border-2 border-emerald-500 font-bold text-sm text-slate-900">
              <span>صافي ضريبة القيمة المضافة المستحقة للسداد:</span>
              <span className="font-mono-numbers text-emerald-900">{formatEGP(vatData.netVatPayable)}</span>
            </div>

            <div className="flex justify-between p-3 bg-sky-50 rounded-lg border border-sky-200 text-sky-900">
              <span>أرصدة الخصم والتحصيل أمانات المستقطعة (1%):</span>
              <span className="font-mono-numbers font-bold">{formatEGP(vatData.withholdingTaxCredit)}</span>
            </div>
          </div>
        </div>
      )}

      {/* 5. Customer Aging Report (أعمار ديون العملاء) */}
      {activeReport === 'cust_aging' && custAgingData && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-4">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-600" />
                تقرير أعمار ديون العملاء والتحصيل (Aging of Accounts Receivable)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                تاريخ الاستحقاق كما في تاريخ: <b className="font-mono text-slate-700">{toDate}</b> (محسوب بأثر رجعي دقيق لا يتأثر بأي سدادات تمت بعد هذا التاريخ).
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-full bg-sky-100 text-sky-800 border border-sky-200 font-medium">
                إجمالي المديونية: {formatEGP(custAgingData.totals?.totalOutstanding)}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-2.5 text-start w-8"></th>
                  <th className="p-2.5 text-start">كود العميل</th>
                  <th className="p-2.5 text-start">اسم العميل</th>
                  <th className="p-2.5 text-end font-semibold text-slate-800">إجمالي الرصيد</th>
                  <th className="p-2.5 text-end text-emerald-700">غير مستحق (جاري)</th>
                  <th className="p-2.5 text-end text-amber-700">1 - 30 يوم</th>
                  <th className="p-2.5 text-end text-orange-700">31 - 60 يوم</th>
                  <th className="p-2.5 text-end text-rose-700">61 - 90 يوم</th>
                  <th className="p-2.5 text-end text-purple-700">+90 يوم</th>
                  <th className="p-2.5 text-end text-blue-700">دفعات غير مخصصة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {custAgingData.rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-slate-400">
                      لا توجد فواتير أو أرصدة مستحقة على العملاء كما في {toDate}
                    </td>
                  </tr>
                ) : (
                  custAgingData.rows.map((r: any) => {
                    const isExpanded = !!expandedParties[r.partyId];
                    return (
                      <React.Fragment key={r.partyId}>
                        <tr
                          onClick={() => togglePartyExpand(r.partyId)}
                          className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                        >
                          <td className="p-2.5 text-center text-slate-400">
                            {r.invoices && r.invoices.length > 0 && (
                              isExpanded ? <ChevronUp className="w-4 h-4 text-slate-600 inline" /> : <ChevronDown className="w-4 h-4 text-slate-600 inline" />
                            )}
                          </td>
                          <td className="p-2.5 font-mono font-bold text-sky-800">{r.partyCode}</td>
                          <td className="p-2.5 font-semibold text-slate-800">
                            {r.partyName}
                            {r.partyPhone && <span className="text-[11px] text-slate-400 ms-2 font-mono">({r.partyPhone})</span>}
                          </td>
                          <td className="p-2.5 text-end font-mono-numbers font-bold text-slate-900">
                            {formatEGP(r.currentBalance)}
                          </td>
                          <td className="p-2.5 text-end font-mono-numbers text-emerald-700">
                            {r.notDue > 0 ? formatEGP(r.notDue) : '-'}
                          </td>
                          <td className="p-2.5 text-end font-mono-numbers text-amber-700">
                            {r.bucket1_30 > 0 ? formatEGP(r.bucket1_30) : '-'}
                          </td>
                          <td className="p-2.5 text-end font-mono-numbers text-orange-700">
                            {r.bucket31_60 > 0 ? formatEGP(r.bucket31_60) : '-'}
                          </td>
                          <td className="p-2.5 text-end font-mono-numbers text-rose-700">
                            {r.bucket61_90 > 0 ? formatEGP(r.bucket61_90) : '-'}
                          </td>
                          <td className="p-2.5 text-end font-mono-numbers text-purple-700">
                            {r.bucket90Plus > 0 ? formatEGP(r.bucket90Plus) : '-'}
                          </td>
                          <td className="p-2.5 text-end font-mono-numbers text-blue-700">
                            {r.unallocatedAdvances > 0 ? `(${formatEGP(r.unallocatedAdvances)})` : '-'}
                          </td>
                        </tr>

                        {isExpanded && r.invoices && r.invoices.length > 0 && (
                          <tr className="bg-slate-50/70 border-b border-slate-200">
                            <td colSpan={10} className="p-3 ps-10">
                              <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-inner">
                                <h4 className="text-[11px] font-bold text-slate-600 mb-2">تفاصيل الفواتير المعلقة للعميل {r.partyName}:</h4>
                                <table className="w-full text-[11px]">
                                  <thead>
                                    <tr className="text-slate-500 border-b border-slate-100">
                                      <th className="p-1.5 text-start">رقم الفاتورة</th>
                                      <th className="p-1.5 text-start">تاريخ الإصدار</th>
                                      <th className="p-1.5 text-start">تاريخ الاستحقاق</th>
                                      <th className="p-1.5 text-end">إجمالي الفاتورة</th>
                                      <th className="p-1.5 text-end">المسدد حتى {toDate}</th>
                                      <th className="p-1.5 text-end">المتبقي</th>
                                      <th className="p-1.5 text-center">أيام التأخير</th>
                                      <th className="p-1.5 text-center">الشريحة</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-50">
                                    {r.invoices.map((inv: any) => (
                                      <tr key={inv.id} className="hover:bg-slate-50">
                                        <td className="p-1.5 font-mono font-bold text-emerald-800">{inv.invoiceNumber}</td>
                                        <td className="p-1.5 font-mono text-slate-600">{inv.issueDate}</td>
                                        <td className="p-1.5 font-mono text-slate-600">{inv.dueDate}</td>
                                        <td className="p-1.5 text-end font-mono-numbers">{formatEGP(inv.totalAmount)}</td>
                                        <td className="p-1.5 text-end font-mono-numbers text-emerald-600">{formatEGP(inv.paidAmount)}</td>
                                        <td className="p-1.5 text-end font-mono-numbers font-bold text-rose-700">{formatEGP(inv.outstanding)}</td>
                                        <td className="p-1.5 text-center font-mono">
                                          {inv.daysOverdue <= 0 ? (
                                            <span className="text-emerald-600">غير متأخرة</span>
                                          ) : (
                                            <span className="text-rose-600 font-bold">{inv.daysOverdue} يوم</span>
                                          )}
                                        </td>
                                        <td className="p-1.5 text-center">
                                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">
                                            {inv.bucket === 'notDue' ? 'جاري' :
                                             inv.bucket === '1-30' ? '1-30 يوم' :
                                             inv.bucket === '31-60' ? '31-60 يوم' :
                                             inv.bucket === '61-90' ? '61-90 يوم' : '+90 يوم'}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
              <tfoot className="bg-slate-900 text-white font-bold border-t-2 border-slate-900">
                <tr>
                  <td colSpan={3} className="p-3 text-start">الإجمالي العام لأعمار ديون العملاء</td>
                  <td className="p-3 text-end font-mono-numbers text-amber-300">{formatEGP(custAgingData.totals?.totalOutstanding)}</td>
                  <td className="p-3 text-end font-mono-numbers text-emerald-300">{formatEGP(custAgingData.totals?.totalNotDue)}</td>
                  <td className="p-3 text-end font-mono-numbers text-amber-300">{formatEGP(custAgingData.totals?.total1_30)}</td>
                  <td className="p-3 text-end font-mono-numbers text-orange-300">{formatEGP(custAgingData.totals?.total31_60)}</td>
                  <td className="p-3 text-end font-mono-numbers text-rose-300">{formatEGP(custAgingData.totals?.total61_90)}</td>
                  <td className="p-3 text-end font-mono-numbers text-purple-300">{formatEGP(custAgingData.totals?.total90Plus)}</td>
                  <td className="p-3 text-end font-mono-numbers text-blue-300">({formatEGP(custAgingData.totals?.totalUnallocatedAdvances)})</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* 6. Supplier Aging Report (أعمار مستحقات الموردين) */}
      {activeReport === 'supp_aging' && suppAgingData && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-4">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600" />
                تقرير أعمار مستحقات الموردين والسداد (Aging of Accounts Payable)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                تاريخ الاستحقاق كما في تاريخ: <b className="font-mono text-slate-700">{toDate}</b> (محسوب بأثر رجعي دقيق لا يتأثر بأي سدادات تمت بعد هذا التاريخ).
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 font-medium">
                إجمالي المستحقات: {formatEGP(suppAgingData.totals?.totalOutstanding)}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-2.5 text-start w-8"></th>
                  <th className="p-2.5 text-start">كود المورد</th>
                  <th className="p-2.5 text-start">اسم المورد</th>
                  <th className="p-2.5 text-end font-semibold text-slate-800">إجمالي المستحق</th>
                  <th className="p-2.5 text-end text-emerald-700">غير مستحق (جاري)</th>
                  <th className="p-2.5 text-end text-amber-700">1 - 30 يوم</th>
                  <th className="p-2.5 text-end text-orange-700">31 - 60 يوم</th>
                  <th className="p-2.5 text-end text-rose-700">61 - 90 يوم</th>
                  <th className="p-2.5 text-end text-purple-700">+90 يوم</th>
                  <th className="p-2.5 text-end text-blue-700">دفعات غير مخصصة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suppAgingData.rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-slate-400">
                      لا توجد فواتير أو مستحقات للموردين كما في {toDate}
                    </td>
                  </tr>
                ) : (
                  suppAgingData.rows.map((r: any) => {
                    const isExpanded = !!expandedParties[r.partyId];
                    return (
                      <React.Fragment key={r.partyId}>
                        <tr
                          onClick={() => togglePartyExpand(r.partyId)}
                          className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                        >
                          <td className="p-2.5 text-center text-slate-400">
                            {r.invoices && r.invoices.length > 0 && (
                              isExpanded ? <ChevronUp className="w-4 h-4 text-slate-600 inline" /> : <ChevronDown className="w-4 h-4 text-slate-600 inline" />
                            )}
                          </td>
                          <td className="p-2.5 font-mono font-bold text-amber-800">{r.partyCode}</td>
                          <td className="p-2.5 font-semibold text-slate-800">
                            {r.partyName}
                            {r.partyPhone && <span className="text-[11px] text-slate-400 ms-2 font-mono">({r.partyPhone})</span>}
                          </td>
                          <td className="p-2.5 text-end font-mono-numbers font-bold text-slate-900">
                            {formatEGP(r.currentBalance)}
                          </td>
                          <td className="p-2.5 text-end font-mono-numbers text-emerald-700">
                            {r.notDue > 0 ? formatEGP(r.notDue) : '-'}
                          </td>
                          <td className="p-2.5 text-end font-mono-numbers text-amber-700">
                            {r.bucket1_30 > 0 ? formatEGP(r.bucket1_30) : '-'}
                          </td>
                          <td className="p-2.5 text-end font-mono-numbers text-orange-700">
                            {r.bucket31_60 > 0 ? formatEGP(r.bucket31_60) : '-'}
                          </td>
                          <td className="p-2.5 text-end font-mono-numbers text-rose-700">
                            {r.bucket61_90 > 0 ? formatEGP(r.bucket61_90) : '-'}
                          </td>
                          <td className="p-2.5 text-end font-mono-numbers text-purple-700">
                            {r.bucket90Plus > 0 ? formatEGP(r.bucket90Plus) : '-'}
                          </td>
                          <td className="p-2.5 text-end font-mono-numbers text-blue-700">
                            {r.unallocatedAdvances > 0 ? `(${formatEGP(r.unallocatedAdvances)})` : '-'}
                          </td>
                        </tr>

                        {isExpanded && r.invoices && r.invoices.length > 0 && (
                          <tr className="bg-slate-50/70 border-b border-slate-200">
                            <td colSpan={10} className="p-3 ps-10">
                              <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-inner">
                                <h4 className="text-[11px] font-bold text-slate-600 mb-2">تفاصيل الفواتير المستحقة للمورد {r.partyName}:</h4>
                                <table className="w-full text-[11px]">
                                  <thead>
                                    <tr className="text-slate-500 border-b border-slate-100">
                                      <th className="p-1.5 text-start">رقم الفاتورة</th>
                                      <th className="p-1.5 text-start">تاريخ الإصدار</th>
                                      <th className="p-1.5 text-start">تاريخ الاستحقاق</th>
                                      <th className="p-1.5 text-end">إجمالي الفاتورة</th>
                                      <th className="p-1.5 text-end">المسدد حتى {toDate}</th>
                                      <th className="p-1.5 text-end">المتبقي</th>
                                      <th className="p-1.5 text-center">أيام التأخير</th>
                                      <th className="p-1.5 text-center">الشريحة</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-50">
                                    {r.invoices.map((inv: any) => (
                                      <tr key={inv.id} className="hover:bg-slate-50">
                                        <td className="p-1.5 font-mono font-bold text-amber-800">{inv.invoiceNumber}</td>
                                        <td className="p-1.5 font-mono text-slate-600">{inv.issueDate}</td>
                                        <td className="p-1.5 font-mono text-slate-600">{inv.dueDate}</td>
                                        <td className="p-1.5 text-end font-mono-numbers">{formatEGP(inv.totalAmount)}</td>
                                        <td className="p-1.5 text-end font-mono-numbers text-emerald-600">{formatEGP(inv.paidAmount)}</td>
                                        <td className="p-1.5 text-end font-mono-numbers font-bold text-rose-700">{formatEGP(inv.outstanding)}</td>
                                        <td className="p-1.5 text-center font-mono">
                                          {inv.daysOverdue <= 0 ? (
                                            <span className="text-emerald-600">غير متأخرة</span>
                                          ) : (
                                            <span className="text-rose-600 font-bold">{inv.daysOverdue} يوم</span>
                                          )}
                                        </td>
                                        <td className="p-1.5 text-center">
                                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">
                                            {inv.bucket === 'notDue' ? 'جاري' :
                                             inv.bucket === '1-30' ? '1-30 يوم' :
                                             inv.bucket === '31-60' ? '31-60 يوم' :
                                             inv.bucket === '61-90' ? '61-90 يوم' : '+90 يوم'}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
              <tfoot className="bg-slate-900 text-white font-bold border-t-2 border-slate-900">
                <tr>
                  <td colSpan={3} className="p-3 text-start">الإجمالي العام لأعمار مستحقات الموردين</td>
                  <td className="p-3 text-end font-mono-numbers text-amber-300">{formatEGP(suppAgingData.totals?.totalOutstanding)}</td>
                  <td className="p-3 text-end font-mono-numbers text-emerald-300">{formatEGP(suppAgingData.totals?.totalNotDue)}</td>
                  <td className="p-3 text-end font-mono-numbers text-amber-300">{formatEGP(suppAgingData.totals?.total1_30)}</td>
                  <td className="p-3 text-end font-mono-numbers text-orange-300">{formatEGP(suppAgingData.totals?.total31_60)}</td>
                  <td className="p-3 text-end font-mono-numbers text-rose-300">{formatEGP(suppAgingData.totals?.total61_90)}</td>
                  <td className="p-3 text-end font-mono-numbers text-purple-300">{formatEGP(suppAgingData.totals?.total90Plus)}</td>
                  <td className="p-3 text-end font-mono-numbers text-blue-300">({formatEGP(suppAgingData.totals?.totalUnallocatedAdvances)})</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
