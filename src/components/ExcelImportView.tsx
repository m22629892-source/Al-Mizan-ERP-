import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  Download,
  Upload,
  CheckCircle2,
  AlertOctagon,
  AlertTriangle,
  RotateCcw,
  RefreshCw,
  FolderTree,
  Users,
  Boxes,
  Layers,
  FileCheck,
  FileCode,
  ArrowRight,
  History,
  BarChart3
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { apiClient } from '../services/apiClient';
import { User } from '../types';

interface ExcelImportViewProps {
  currentUser: User | null;
  onRefreshMasterData?: () => void;
  onImportSuccess?: () => void;
  onNavigateToAnalytics?: (filename?: string, notice?: string) => void;
}

type ImportType = 'chart_of_accounts' | 'parties' | 'items' | 'opening_balances';

export const ExcelImportView: React.FC<ExcelImportViewProps> = ({ currentUser, onRefreshMasterData, onImportSuccess, onNavigateToAnalytics }) => {
  const [selectedType, setSelectedType] = useState<ImportType>('opening_balances');
  const [parsedPreview, setParsedPreview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeSheetTab, setActiveSheetTab] = useState<string>('');
  const [importHistory, setImportHistory] = useState<any[]>([]);

  const fetchHistory = async () => {
    try {
      const data = await apiClient.get('/import/history');
      if (data && data.history) setImportHistory(data.history);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleDownloadTemplate = (type: ImportType) => {
    const url = `/api/import/templates/${type}`;
    window.open(url, '_blank');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const binaryStr = event.target?.result as string;
        const base64 = btoa(
          new Uint8Array(event.target?.result as ArrayBuffer)
            .reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        const res = await apiClient.post('/import/preview', {
          importType: selectedType,
          base64Data: base64,
          filename: file.name
        });

        setParsedPreview({ ...res, filename: file.name });
        const sheetNames = Object.keys(res.parsedSheets || {});
        if (sheetNames.length > 0) setActiveSheetTab(sheetNames[0]);
      } catch (err: any) {
        setError(err.message || 'فشل فحص ومعاينة ملف Excel.');
      } finally {
        setLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const loadSampleDataset = async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      let sampleSheets: Record<string, any[]> = {};

      if (selectedType === 'chart_of_accounts') {
        sampleSheets['دليل الحسابات'] = [
          { 'كود الحساب': '1116', 'اسم الحساب بالعربي': 'خزينة فرع التجمع الخامس', 'اسم الحساب بالإنجليزي': 'New Cairo Cashbox', 'كود حساب الأب': '111', 'نوع الحساب': 'asset', 'طبيعة الحساب': 'debit', 'حساب رئيسي (1/0)': 0, 'المستوى': 4 },
          { 'كود الحساب': '6114', 'اسم الحساب بالعربي': 'مصاريف تدريب وتطوير', 'اسم الحساب بالإنجليزي': 'Training & Development', 'كود حساب الأب': '61', 'نوع الحساب': 'expense', 'طبيعة الحساب': 'debit', 'حساب رئيسي (1/0)': 0, 'المستوى': 3 }
        ];
      } else if (selectedType === 'parties') {
        sampleSheets['العملاء والموردون'] = [
          { 'النوع (customer/supplier)': 'customer', 'كود الطرف': 'CUST-088', 'الاسم بالعربي': 'شركة النور للمقاولات والتوريدات', 'الاسم بالإنجليزي': 'Al Noor Contracting', 'الرقم الضريبي': '491-002-381', 'السجل التجاري': '91024', 'الهاتف': '01029384756', 'العنوان': 'التجمع الخامس، القاهرة', 'حد الائتمان': 150000, 'فترة السداد بالأيام': 30 },
          { 'النوع (customer/supplier)': 'supplier', 'كود الطرف': 'SUPP-088', 'الاسم بالعربي': 'الشركة الدولية لتكنولوجيا المعلومات', 'الاسم بالإنجليزي': 'Global IT Solutions', 'الرقم الضريبي': '319-842-105', 'السجل التجاري': '62019', 'الهاتف': '01238475610', 'العنوان': 'المهندسين، الجيزة', 'حد الائتمان': 300000, 'فترة السداد بالأيام': 45 }
        ];
      } else if (selectedType === 'items') {
        sampleSheets['الأصناف والمخزون'] = [
          { 'كود الصنف': 'ITM-701', 'الباركود': '6228001122334', 'اسم الصنف بالعربي': 'سماعة رأس سلكية لوجيتك H390', 'اسم الصنف بالإنجليزي': 'Logitech Headset H390 USB', 'نوع الصنف (stock/service)': 'stock', 'الفئة': 'ملحقات وإكسسوارات', 'الوحدة الأساسية': 'قطعة', 'سعر التكلفة': 950, 'سعر البيع': 1400, 'نسبة الضريبة': 14, 'حد الطلب الأدنى': 10, 'كود الفاتورة الإلكترونية ETA': 'EG-458921364-ITM-701' },
          { 'كود الصنف': 'ITM-702', 'الباركود': '6228001122341', 'اسم الصنف بالعربي': 'كاميرا ويب عالية الدقة C920e', 'اسم الصنف بالإنجليزي': 'Logitech HD Webcam C920e', 'نوع الصنف (stock/service)': 'stock', 'الفئة': 'ملحقات وإكسسوارات', 'الوحدة الأساسية': 'قطعة', 'سعر التكلفة': 2200, 'سعر البيع': 3100, 'نسبة الضريبة': 14, 'حد الطلب الأدنى': 5, 'كود الفاتورة الإلكترونية ETA': 'EG-458921364-ITM-702' }
        ];
      } else if (selectedType === 'opening_balances') {
        sampleSheets['الأستاذ العام'] = [
          { 'كود الحساب': '1111', 'اسم الحساب': 'خزينة المركز الرئيسي - القاهرة', 'رصيد مدين': 50000, 'رصيد دائن': 0 },
          { 'كود الحساب': '1113', 'اسم الحساب': 'البنك الأهلي المصري', 'رصيد مدين': 250000, 'رصيد دائن': 0 },
          { 'كود الحساب': '1141', 'اسم الحساب': 'بضاعة بالمخازن - القاهرة', 'رصيد مدين': 45000, 'رصيد دائن': 0 },
          { 'كود الحساب': '3111', 'اسم الحساب': 'رأس المال المدفوع', 'رصيد مدين': 0, 'رصيد دائن': 345000 }
        ];
        sampleSheets['تفاصيل المخزون'] = [
          { 'كود الصنف': 'ITM-001', 'اسم الصنف': 'لابتوب ديل فوسترو 3520 كور i5', 'كود المخزن': 'WH-CAI-MAIN', 'الكمية': 3, 'تكلفة الوحدة': 15000, 'إجمالي القيمة': 45000 }
        ];
      }

      const res = await apiClient.post('/import/preview', {
        importType: selectedType,
        jsonRows: sampleSheets['default'] || sampleSheets[Object.keys(sampleSheets)[0]],
        filename: `sample_${selectedType}.xlsx`
      });

      setParsedPreview({ ...res, parsedSheets: sampleSheets, filename: `sample_${selectedType}.xlsx` });
      setActiveSheetTab(Object.keys(sampleSheets)[0]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!parsedPreview || !parsedPreview.canCommit) return;

    setCommitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await apiClient.post('/import/commit', {
        importType: selectedType,
        parsedSheets: parsedPreview.parsedSheets,
        filename: parsedPreview.filename,
        batchKey: `${selectedType}_${parsedPreview.filename}_${Date.now()}`
      });

      setSuccessMessage(res.message);
      setParsedPreview(null);
      fetchHistory();
      if (onRefreshMasterData) onRefreshMasterData();
      if (onImportSuccess) onImportSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCommitting(false);
    }
  };

  const typesConfig = [
    { id: 'opening_balances', title: 'الأرصدة الافتتاحية الشاملة', icon: Layers, desc: 'استيراد القيد الافتتاحي المتوازن مع تفاصيل العملاء والموردين والمخزون' },
    { id: 'chart_of_accounts', title: 'دليل الحسابات الهرمي', icon: FolderTree, desc: 'استيراد شجرة الحسابات بالأكواد والأنواع ومستويات الدليل' },
    { id: 'parties', title: 'العملاء والموردون', icon: Users, desc: 'استيراد بطاقات أطراف التعامل بالرقم الضريبي والحدود الائتمانية' },
    { id: 'items', title: 'الأصناف والمخزون', icon: Boxes, desc: 'استيراد بطاقات الأصناف بالباركود وأسعار التكلفة والبيع وكود ETA' }
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Banner */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shadow-xs">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">استيراد Excel والأرصدة الافتتاحية</h1>
            <p className="text-xs text-slate-500 mt-1">
              دورة الاستيراد الرقابية: رفع الملف ← معاينة وتدقيق الأخطاء بالأعمدة والصفوف ← اعتماد وترحيل قيد افتتاحي متوازن.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onNavigateToAnalytics && (
            <button
              onClick={() => onNavigateToAnalytics()}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer border border-slate-700"
            >
              <BarChart3 className="w-4 h-4 text-emerald-400" />
              <span>وحدة تحليل Excel ومساعد الميزان</span>
            </button>
          )}
          <button
            onClick={() => handleDownloadTemplate(selectedType)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>تحميل قالب Excel النموذجي</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-xs text-emerald-600 underline">إغلاق</button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-2">
          <AlertOctagon className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="whitespace-pre-line font-medium leading-relaxed">{error}</div>
        </div>
      )}

      {/* Module Selector Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {typesConfig.map(tc => {
          const Icon = tc.icon;
          const isSelected = selectedType === tc.id;
          return (
            <div
              key={tc.id}
              onClick={() => { setSelectedType(tc.id as ImportType); setParsedPreview(null); }}
              className={`p-5 rounded-2xl border cursor-pointer transition select-none flex flex-col justify-between ${
                isSelected
                  ? 'bg-emerald-50/60 border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isSelected ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  {isSelected && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">النشط</span>}
                </div>
                <h3 className="text-sm font-bold text-slate-800 mt-3">{tc.title}</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">{tc.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Step 1 & 2: Upload or Load Sample */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
          <Upload className="w-4 h-4 text-emerald-600" />
          رفع ملف البيانات المعبأ أو تحميل نموذج اختباري
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border-2 border-dashed border-slate-300 rounded-2xl p-6 text-center hover:border-emerald-500 hover:bg-emerald-50/20 transition flex flex-col items-center justify-center">
            <Upload className="w-8 h-8 text-slate-400 mb-2" />
            <label className="text-xs font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 px-4 py-2 rounded-xl cursor-pointer transition">
              اختر ملف Excel (.xlsx, .xls)
              <input type="file" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} className="hidden" />
            </label>
            <p className="text-[11px] text-slate-400 mt-2">يدعم ملفات الجداول المتعددة المصدرة من القالب الرسمي</p>
          </div>

          <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 flex flex-col justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-800">تجربة بيانات نموذجية جاهزة</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                يمكنك تحميل دفعة بيانات نموذجية صحيحة مسبقاً لاختبار آلية المعاينة وفحص التوازن والاعتماد دون الحاجة لتحضير ملف خارجي.
              </p>
            </div>
            <button
              onClick={loadSampleDataset}
              disabled={loading}
              className="mt-4 flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-700 transition"
            >
              <FileCheck className="w-4 h-4 text-emerald-600" />
              <span>تحميل ومعاينة نموذج تجريبي للوحدة</span>
            </button>
          </div>
        </div>
      </div>

      {/* Step 3: Preview & Errors Inspection Table */}
      {parsedPreview && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <span>معاينة وتدقيق البيانات المستوردة:</span>
                <span className="text-xs font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                  {parsedPreview.filename}
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                إجمالي السجلات: {parsedPreview.totalRowsCount} | السجلات السليمة: {parsedPreview.validRowsCount} | الأخطاء المكتشفة: {parsedPreview.errorsCount}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                disabled={!parsedPreview.canCommit || committing}
                onClick={handleCommit}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition shadow-xs ${
                  parsedPreview.canCommit
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-emerald-500/20'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                }`}
              >
                {committing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <CheckCircle2 className="w-4 h-4" />
                <span>اعتماد وترحيل الدفعة الآن</span>
              </button>
            </div>
          </div>

          {/* Validation Errors Table (If any) */}
          {parsedPreview.errors && parsedPreview.errors.length > 0 && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 space-y-2">
              <div className="flex items-center gap-2 font-bold text-rose-800 text-xs">
                <AlertOctagon className="w-4 h-4 text-rose-600" />
                <span>تم اكتشاف أخطاء تمنع الاعتماد ({parsedPreview.errors.length} خطأ):</span>
              </div>
              <div className="overflow-x-auto max-h-48 rounded-lg border border-rose-200/80 bg-white">
                <table className="w-full text-right text-xs">
                  <thead className="bg-rose-100/50 text-rose-900 border-b border-rose-200 font-bold sticky top-0">
                    <tr>
                      <th className="p-2">الجدول / الورقة</th>
                      <th className="p-2">رقم الصف</th>
                      <th className="p-2">العمود</th>
                      <th className="p-2">القيمة المدخلة</th>
                      <th className="p-2">سبب الخطأ المحاسبي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rose-100 font-mono-numbers">
                    {parsedPreview.errors.map((err: any, i: number) => (
                      <tr key={i} className="hover:bg-rose-50/50">
                        <td className="p-2 text-slate-600 font-sans">{err.sheetName || 'الرئيسية'}</td>
                        <td className="p-2 font-bold text-rose-700">صف {err.rowNumber}</td>
                        <td className="p-2 font-medium text-slate-800">{err.column}</td>
                        <td className="p-2 text-slate-500 max-w-xs truncate">{String(err.value)}</td>
                        <td className="p-2 font-bold text-rose-600 font-sans">{err.errorReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sheets Tabs (for multi-sheet Excel files) */}
          {parsedPreview.parsedSheets && Object.keys(parsedPreview.parsedSheets).length > 1 && (
            <div className="flex items-center gap-2 border-b border-slate-200">
              {Object.keys(parsedPreview.parsedSheets).map(sName => (
                <button
                  key={sName}
                  onClick={() => setActiveSheetTab(sName)}
                  className={`px-3 py-2 text-xs font-bold border-b-2 transition ${
                    activeSheetTab === sName ? 'border-emerald-600 text-emerald-800' : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {sName} ({parsedPreview.parsedSheets[sName]?.length || 0})
                </button>
              ))}
            </div>
          )}

          {/* Data Table Preview */}
          {activeSheetTab && parsedPreview.parsedSheets?.[activeSheetTab] && (
            <div className="overflow-x-auto max-h-96 rounded-xl border border-slate-200">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-bold sticky top-0">
                  <tr>
                    <th className="p-2.5">#</th>
                    {Object.keys(parsedPreview.parsedSheets[activeSheetTab][0] || {}).map((col, idx) => (
                      <th key={idx} className="p-2.5 whitespace-nowrap">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono-numbers">
                  {parsedPreview.parsedSheets[activeSheetTab].map((row: any, rIdx: number) => (
                    <tr key={rIdx} className="hover:bg-slate-50">
                      <td className="p-2.5 text-slate-400 font-sans">{rIdx + 1}</td>
                      {Object.keys(row).map((k, cIdx) => (
                        <td key={cIdx} className="p-2.5 whitespace-nowrap text-slate-800">
                          {String(row[k] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Audit History of Past Imports */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <History className="w-4 h-4 text-slate-600" />
          سجل عمليات الاستيراد السابقة والتدقيق الرقابي
        </h3>

        {importHistory.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
                <tr>
                  <th className="p-3">نوع الاستيراد</th>
                  <th className="p-3">اسم الملف / الدفعة</th>
                  <th className="p-3">عدد السجلات</th>
                  <th className="p-3">تاريخ الاستيراد</th>
                  <th className="p-3">المستخدم المنفذ</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3 text-center">إجراءات التحليل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {importHistory.map((h, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="p-3 font-bold text-slate-800 font-sans">
                      {h.import_type === 'opening_balances' ? 'أرصدة افتتاحية' : h.import_type === 'chart_of_accounts' ? 'دليل الحسابات' : h.import_type === 'parties' ? 'عملاء وموردين' : 'أصناف'}
                    </td>
                    <td className="p-3 font-mono text-slate-600 max-w-xs truncate">{h.filename}</td>
                    <td className="p-3 font-mono-numbers font-bold text-slate-700">{h.total_rows}</td>
                    <td className="p-3 font-mono-numbers text-slate-500">{new Date(h.imported_at).toLocaleString('ar-EG')}</td>
                    <td className="p-3 font-medium text-slate-700">{h.user_name}</td>
                    <td className="p-3">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        <CheckCircle2 className="w-3 h-3" />
                        تم الاعتماد
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <button
                        onClick={() => {
                          if (onNavigateToAnalytics) {
                            onNavigateToAnalytics(
                              h.filename,
                              'سجل الاستيراد يحفظ نتيجة وتفاصيل العملية المحاسبية المعتمدة فقط. لإجراء التحليل الشامل والرسوم البيانية ومحادثة «اسأل ملفك»، يرجى إعادة رفع الملف.'
                            );
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold transition cursor-pointer shadow-2xs"
                      >
                        <BarChart3 className="w-3.5 h-3.5" />
                        <span>تحليل الملف</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-slate-400 italic">لا توجد عمليات استيراد مسجلة حتى الآن.</p>
        )}
      </div>
    </div>
  );
};
