import React, { useState, useEffect, useRef } from 'react';
import {
  FileSpreadsheet,
  Upload,
  BarChart3,
  Bot,
  Filter,
  Download,
  Search,
  Sparkles,
  ArrowRight,
  Layers,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  RefreshCw,
  Eye,
  Settings,
  HelpCircle,
  Coins,
  TrendingUp,
  Receipt,
  FileText,
  Calendar,
  Send,
  X,
  ChevronDown,
  Info,
  Server
} from 'lucide-react';
import { apiClient } from '../services/apiClient';
import { User, ColumnDataType, SheetAnalysis, ColumnMeta } from '../types';
import { Language } from '../translations';

interface ExcelAnalyticsViewProps {
  currentUser: User | null;
  lang: Language;
  initialNotice?: string | null;
  initialFilename?: string | null;
}

export const ExcelAnalyticsView: React.FC<ExcelAnalyticsViewProps> = ({
  currentUser,
  lang,
  initialNotice,
  initialFilename
}) => {
  // Session State
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>(initialFilename || '');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheetName, setActiveSheetName] = useState<string>('');
  const [sheetAnalysis, setSheetAnalysis] = useState<SheetAnalysis | null>(null);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [unreadableCount, setUnreadableCount] = useState<number>(0);
  const [headerRowIndex, setHeaderRowIndex] = useState<number>(0);

  // Loading & Alert State
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(initialNotice || null);

  // Filters State
  const [filters, setFilters] = useState<Array<{ column: string; operator: string; value: string }>>([]);
  const [filteredRowCount, setFilteredRowCount] = useState<number>(0);
  const [filteredRows, setFilteredRows] = useState<any[]>([]);
  const [matchingIndices, setMatchingIndices] = useState<number[]>([]);
  const [statsList, setStatsList] = useState<any[]>([]);
  const [groupResult, setGroupResult] = useState<any | null>(null);
  const [netSalesCalc, setNetSalesCalc] = useState<any | null>(null);
  const [selectedGroupCol, setSelectedGroupCol] = useState<string>('');
  const [selectedAmountCol, setSelectedAmountCol] = useState<string>('');

  // Chat "اسأل ملفك" State
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Matching Rows Modal State
  const [isMatchingModalOpen, setIsMatchingModalOpen] = useState<boolean>(false);
  const [matchingModalTitle, setMatchingModalTitle] = useState<string>('');
  const [matchingModalRows, setMatchingModalRows] = useState<any[]>([]);
  const [matchingModalLoading, setMatchingModalLoading] = useState<boolean>(false);
  const [matchingSearchQuery, setMatchingSearchQuery] = useState<string>('');

  // Admin / AI Runner Settings Modal State
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [aiSettings, setAiSettings] = useState<{
    runnerUrl: string;
    primaryModel: string;
    fallbackModel: string;
    timeoutSeconds: number;
  }>({
    runnerUrl: 'http://localhost:11434',
    primaryModel: 'qwen2.5:7b',
    fallbackModel: 'deepseek-r1:7b',
    timeoutSeconds: 30
  });
  const [testingConnection, setTestingConnection] = useState<boolean>(false);
  const [connectionResult, setConnectionResult] = useState<any | null>(null);

  // Auto-load sample dataset if no file is loaded initially
  useEffect(() => {
    if (!sessionId && !initialFilename) {
      loadSampleDataset();
    }
  }, []);

  // Fetch AI Settings on mount
  useEffect(() => {
    fetchAiSettings();
  }, []);

  const fetchAiSettings = async () => {
    try {
      const data = await apiClient.get('/analytics/ai-settings');
      if (data && data.config) {
        setAiSettings(data.config);
      }
    } catch {
      // Ignore
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    setNoticeMsg(null);
    setLoading(true);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const base64 = btoa(
          new Uint8Array(event.target?.result as ArrayBuffer)
            .reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        const res = await apiClient.post('/analytics/upload', {
          base64Data: base64,
          filename: file.name
        });

        applySessionResponse(res);
      } catch (err: any) {
        setErrorMsg(err.message || 'فشل قراءة الملف.');
      } finally {
        setLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const loadSampleDataset = async () => {
    setErrorMsg(null);
    setNoticeMsg(null);
    setLoading(true);

    try {
      const res = await apiClient.post('/analytics/sample', {});
      applySessionResponse(res);
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل تحميل ملف العينة.');
    } finally {
      setLoading(false);
    }
  };

  const applySessionResponse = (res: any) => {
    setSessionId(res.sessionId);
    setFilename(res.filename);
    setSheetNames(res.sheetNames || []);
    setActiveSheetName(res.activeSheetName || '');
    setSheetAnalysis(res.analysis);
    setPreviewRows(res.previewRows || []);
    setUnreadableCount(res.unreadableCellsCount || 0);
    setHeaderRowIndex(res.analysis?.headerRowIndex || 0);
    setFilters([]);
    setChatMessages([]);

    // Select default numeric & grouping columns
    if (res.analysis?.columns) {
      const numCol = res.analysis.columns.find((c: any) => c.inferredType === 'number' || c.userType === 'number')?.name || '';
      const grpCol = res.analysis.columns.find((c: any) => /عميل|مورد|صنف|فرع|customer|supplier|item/i.test(c.name))?.name || res.analysis.columns[0]?.name || '';
      setSelectedAmountCol(numCol);
      setSelectedGroupCol(grpCol);
      runFilter(res.sessionId, res.activeSheetName, [], grpCol, numCol);
    }
  };

  const switchSheet = async (newSheetName: string) => {
    if (!sessionId || newSheetName === activeSheetName) return;
    setLoading(true);
    try {
      const res = await apiClient.post(`/analytics/sessions/${sessionId}/sheet`, {
        sheetName: newSheetName,
        headerRowIndex: 0
      });
      setActiveSheetName(res.activeSheetName);
      setSheetAnalysis(res.analysis);
      setPreviewRows(res.previewRows || []);
      setHeaderRowIndex(0);
      setFilters([]);

      const numCol = res.analysis.columns.find((c: any) => c.inferredType === 'number' || c.userType === 'number')?.name || '';
      const grpCol = res.analysis.columns.find((c: any) => /عميل|مورد|صنف|فرع/i.test(c.name))?.name || res.analysis.columns[0]?.name || '';
      setSelectedAmountCol(numCol);
      setSelectedGroupCol(grpCol);
      runFilter(sessionId, newSheetName, [], grpCol, numCol);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleHeaderRowChange = async (newIndex: number) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await apiClient.post(`/analytics/sessions/${sessionId}/sheet`, {
        sheetName: activeSheetName,
        headerRowIndex: newIndex
      });
      setHeaderRowIndex(newIndex);
      setSheetAnalysis(res.analysis);
      setPreviewRows(res.previewRows || []);
      runFilter(sessionId, activeSheetName, filters, selectedGroupCol, selectedAmountCol);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleColumnTypeOverride = async (colName: string, newType: ColumnDataType) => {
    if (!sessionId) return;
    try {
      const res = await apiClient.post(`/analytics/sessions/${sessionId}/sheet`, {
        sheetName: activeSheetName,
        columnTypeOverrides: { [colName]: newType }
      });
      setSheetAnalysis(res.analysis);
      runFilter(sessionId, activeSheetName, filters, selectedGroupCol, selectedAmountCol);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const runFilter = async (
    sId = sessionId,
    sName = activeSheetName,
    currentFilters = filters,
    grpCol = selectedGroupCol,
    amtCol = selectedAmountCol
  ) => {
    if (!sId) return;
    try {
      const res = await apiClient.post(`/analytics/sessions/${sId}/filter`, {
        filters: currentFilters,
        groupByCol: grpCol,
        amountCol: amtCol
      });
      setFilteredRowCount(res.matchingRowCount);
      setFilteredRows(res.previewRows || []);
      setMatchingIndices(res.matchingRowIndices || []);
      setStatsList(res.statsList || []);
      setGroupResult(res.groupResult || null);
      setNetSalesCalc(res.netSalesCalc || null);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const addFilter = () => {
    if (!sheetAnalysis?.columns || sheetAnalysis.columns.length === 0) return;
    const firstCol = sheetAnalysis.columns[0].name;
    const updated = [...filters, { column: firstCol, operator: 'contains', value: '' }];
    setFilters(updated);
  };

  const updateFilter = (index: number, key: string, value: string) => {
    const updated = [...filters];
    (updated[index] as any)[key] = value;
    setFilters(updated);
    runFilter(sessionId, activeSheetName, updated, selectedGroupCol, selectedAmountCol);
  };

  const removeFilter = (index: number) => {
    const updated = filters.filter((_, i) => i !== index);
    setFilters(updated);
    runFilter(sessionId, activeSheetName, updated, selectedGroupCol, selectedAmountCol);
  };

  // Open Matching Rows Modal
  const openMatchingRows = async (title: string, indices?: number[]) => {
    if (!sessionId) return;
    const targetIndices = indices || matchingIndices;
    setMatchingModalTitle(title);
    setIsMatchingModalOpen(true);
    setMatchingModalLoading(true);
    setMatchingSearchQuery('');

    try {
      const res = await apiClient.post(`/analytics/sessions/${sessionId}/matching-rows`, {
        indices: targetIndices
      });
      setMatchingModalRows(res.rows || []);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setMatchingModalLoading(false);
    }
  };

  // Export to Excel
  const handleExport = async (indices?: number[]) => {
    if (!sessionId) return;
    try {
      const token = localStorage.getItem('almizan_token') || '';
      const response = await fetch(`/api/analytics/sessions/${sessionId}/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          indices: indices || matchingIndices,
          summaryTitle: `تحليل ${activeSheetName}`
        })
      });

      if (!response.ok) throw new Error('فشل تصدير الملف.');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `almizan_analysis_${activeSheetName}_${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  // Send Chat Message
  const handleSendMessage = async (textToSend?: string) => {
    const query = textToSend || chatInput;
    if (!query.trim() || !sessionId || chatLoading) return;

    setChatInput('');
    setChatLoading(true);

    const userMsg = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: new Date().toISOString()
    };
    setChatMessages(prev => [...prev, userMsg]);

    try {
      const res = await apiClient.post(`/analytics/sessions/${sessionId}/chat`, {
        question: query,
        activeFilters: filters
      });

      const assistantMsg = {
        id: `asst_${Date.now()}`,
        role: 'assistant',
        content: res.answerText,
        timestamp: new Date().toISOString(),
        plan: res.plan,
        executionResult: res.executionResult,
        matchingRowIndices: res.executionResult?.matchingRowIndices,
        modelUsed: res.modelUsed,
        isFailoverUsed: res.isFailoverUsed
      };

      setChatMessages(prev => [...prev, assistantMsg]);
      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err: any) {
      setChatMessages(prev => [
        ...prev,
        {
          id: `asst_err_${Date.now()}`,
          role: 'assistant',
          content: '«مساعد الميزان غير متاح حاليًا». يرجى مراجعة إعدادات المشغل المحلي أو استخدام الفلاتر والرسوم البيانية المباشرة.',
          timestamp: new Date().toISOString()
        }
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    try {
      const res = await apiClient.post('/analytics/ai-test-connection', {});
      setConnectionResult(res);
    } catch (err: any) {
      setConnectionResult({ success: false, error: err.message });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSaveAiSettings = async () => {
    try {
      await apiClient.post('/analytics/ai-settings', aiSettings);
      setIsSettingsOpen(false);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  // Filtered matching modal rows by search
  const visibleModalRows = matchingModalRows.filter(r => {
    if (!matchingSearchQuery.trim()) return true;
    return Object.values(r).some(v => String(v ?? '').toLowerCase().includes(matchingSearchQuery.toLowerCase()));
  });

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900">وحدة تحليل ملفات Excel والذكاء الاصطناعي</h1>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                مساعد الميزان
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              تحليل شامل للقراءة فقط: إحصائيات دقيقة بالـ Decimal، فلاتر ومقارنات، ومحادثة «اسأل ملفك» الذكية.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer">
            <Upload className="w-4 h-4" />
            <span>رفع ملف للتحليل فقط</span>
            <input type="file" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} className="hidden" />
          </label>

          <button
            onClick={loadSampleDataset}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition border border-slate-200 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>ملف الاختبار الشامل</span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 text-slate-500 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 transition cursor-pointer"
            title="إعدادات المشغل المحلي لمساعد الميزان"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Notifications */}
      {noticeMsg && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-2.5">
            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed font-medium">{noticeMsg}</div>
          </div>
          <button onClick={() => setNoticeMsg(null)} className="text-amber-700 hover:text-amber-900 font-bold text-xs shrink-0 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-2.5">
            <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed font-medium">{errorMsg}</div>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-rose-700 hover:text-rose-900 font-bold text-xs shrink-0 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Sheet Tabs & Header Row Selector */}
      {sheetNames.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
            <span className="text-xs font-bold text-slate-500 shrink-0 ms-1">الأوراق:</span>
            {sheetNames.map(s => (
              <button
                key={s}
                onClick={() => switchSheet(s)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
                  activeSheetName === s
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>{s}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 shrink-0 text-xs">
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
              <span className="text-slate-500 font-medium">صف العناوين:</span>
              <select
                value={headerRowIndex}
                onChange={e => handleHeaderRowChange(parseInt(e.target.value, 10))}
                className="bg-transparent font-bold text-slate-800 outline-none cursor-pointer"
              >
                <option value={0}>الصف الأول (افتراضي)</option>
                <option value={1}>الصف الثاني</option>
                <option value={2}>الصف الثالث</option>
                <option value={3}>الصف الرابع</option>
              </select>
            </div>

            {unreadableCount > 0 && (
              <span className="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-[11px] font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{unreadableCount} صيغة غير محسوبة</span>
              </span>
            )}

            <button
              onClick={() => handleExport()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تصدير Excel</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Grid: Statistics & Analysis (Left) + Ask Your File Chat (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Stats, Filters & Charts (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Key Metric Scorecards */}
          {sheetAnalysis && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
                <span className="text-[11px] font-bold text-slate-500">إجمالي الصفوف</span>
                <div className="text-xl font-black font-mono-numbers text-slate-800 mt-2">
                  {sheetAnalysis.totalRows}
                </div>
                <span className="text-[10px] text-slate-400 mt-1">سجل محاسبي</span>
              </div>

              <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
                <span className="text-[11px] font-bold text-slate-500">الصفوف المكررة</span>
                <div className={`text-xl font-black font-mono-numbers mt-2 ${sheetAnalysis.duplicateRowsCount > 0 ? 'text-amber-600' : 'text-slate-800'}`}>
                  {sheetAnalysis.duplicateRowsCount}
                </div>
                <span className="text-[10px] text-slate-400 mt-1">مطابقة تامة</span>
              </div>

              <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
                <span className="text-[11px] font-bold text-slate-500">العملات المكتشفة</span>
                <div className="text-base font-black font-mono text-emerald-700 mt-2">
                  {sheetAnalysis.currenciesDetected.join(', ')}
                </div>
                <span className="text-[10px] text-slate-400 mt-1">فصل الحسابات تلقائياً</span>
              </div>

              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 shadow-xs flex flex-col justify-between">
                <span className="text-[11px] font-bold text-emerald-800">الصفوف المطابقة</span>
                <div className="text-xl font-black font-mono-numbers text-emerald-900 mt-2">
                  {filteredRowCount}
                </div>
                <span className="text-[10px] text-emerald-700 mt-1">تخضع للحساب الكامل</span>
              </div>
            </div>
          )}

          {/* Net Sales & Financial Invariant Summary (if available) */}
          {netSalesCalc && (
            <div className="p-5 rounded-2xl bg-linear-to-r from-emerald-50 to-teal-50 border border-emerald-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-emerald-900 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-700" />
                  <span>احتساب صافي المبيعات والمرتجعات المتوازن</span>
                </h3>
                <button
                  onClick={() => openMatchingRows('صفوف صافي المبيعات والمرتجعات', matchingIndices)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:text-emerald-900 bg-white/80 px-2.5 py-1 rounded-lg border border-emerald-300 transition cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>عرض الصفوف المطابقة</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div className="p-3 bg-white/90 rounded-xl border border-emerald-100">
                  <span className="text-[10px] text-slate-500 font-bold">إجمالي المبيعات (Gross)</span>
                  <div className="text-base font-bold font-mono-numbers text-slate-800 mt-1">
                    {netSalesCalc.grossSales} <span className="text-xs font-normal">{netSalesCalc.currency}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {netSalesCalc.salesDistinctInvoices} فاتورة ({netSalesCalc.salesCount} بنداً)
                  </div>
                </div>

                <div className="p-3 bg-white/90 rounded-xl border border-rose-100">
                  <span className="text-[10px] text-rose-600 font-bold">مردودات المبيعات (Returns)</span>
                  <div className="text-base font-bold font-mono-numbers text-rose-700 mt-1">
                    -{netSalesCalc.totalReturns} <span className="text-xs font-normal">{netSalesCalc.currency}</span>
                  </div>
                  <div className="text-[10px] text-rose-500 mt-0.5">
                    {netSalesCalc.returnsDistinctInvoices} إشعار ({netSalesCalc.returnsCount} بنداً)
                  </div>
                </div>

                <div className="p-3 bg-emerald-600 text-white rounded-xl shadow-xs">
                  <span className="text-[10px] text-emerald-100 font-bold">صافي المبيعات (Net Sales)</span>
                  <div className="text-base font-bold font-mono-numbers text-white mt-1">
                    {netSalesCalc.netSales} <span className="text-xs font-normal">{netSalesCalc.currency}</span>
                  </div>
                  <div className="text-[10px] text-emerald-200 mt-0.5">
                    دقة عشرية كاملة (Decimal.js)
                  </div>
                </div>
              </div>

              {netSalesCalc.assumptionUsed && (
                <p className="text-[11px] text-emerald-800/90 bg-emerald-100/50 p-2 rounded-lg leading-relaxed">
                  <span className="font-bold">الافتراض المحاسبي: </span>
                  {netSalesCalc.assumptionUsed}
                </p>
              )}
            </div>
          )}

          {/* Numeric Column Statistics Cards */}
          {statsList.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                  <Coins className="w-4 h-4 text-emerald-600" />
                  <span>الإحصائيات المالية للأعمدة الرقمية (محسوبة على كل الصفوف المطابقة)</span>
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {statsList.map((stat, i) => (
                  <div key={i} className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-slate-800 truncate">{stat.column}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
                        {stat.currency}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                      <div>
                        <span className="text-slate-400 block">الإجمالي:</span>
                        <span className="font-bold font-mono-numbers text-slate-900">{stat.sum}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">المتوسط:</span>
                        <span className="font-bold font-mono-numbers text-slate-700">{stat.average}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">الوسيط:</span>
                        <span className="font-bold font-mono-numbers text-slate-700">{stat.median}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">الأدنى / الأقصى:</span>
                        <span className="font-bold font-mono-numbers text-slate-700">{stat.min} / {stat.max}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Interactive Filters Panel */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                <Filter className="w-4 h-4 text-emerald-600" />
                <span>الفلاتر والتصفية التفاعلية</span>
              </h3>
              <button
                onClick={addFilter}
                className="px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold transition cursor-pointer"
              >
                + إضافة شرط تصفية
              </button>
            </div>

            {filters.length === 0 ? (
              <p className="text-xs text-slate-400 italic">لا توجد فلاتر مطبقة حالياً. الحساب يتم على كامل صفوف الورقة.</p>
            ) : (
              <div className="space-y-2">
                {filters.map((f, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                    <select
                      value={f.column}
                      onChange={e => updateFilter(idx, 'column', e.target.value)}
                      className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-slate-800 font-bold"
                    >
                      {sheetAnalysis?.columns.map((c: ColumnMeta) => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>

                    <select
                      value={f.operator}
                      onChange={e => updateFilter(idx, 'operator', e.target.value)}
                      className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-slate-700"
                    >
                      <option value="contains">يحتوي على</option>
                      <option value="equals">يساوي تماماً</option>
                      <option value="greater_than">أكبر من</option>
                      <option value="less_than">أصغر من</option>
                    </select>

                    <input
                      type="text"
                      placeholder="القيمة المقارنة..."
                      value={f.value}
                      onChange={e => updateFilter(idx, 'value', e.target.value)}
                      className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-slate-800 flex-1 min-w-[120px]"
                    />

                    <button
                      onClick={() => removeFilter(idx)}
                      className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                      title="حذف هذا الشرط"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Grouping & Visual Breakdown Chart */}
          {groupResult && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-emerald-600" />
                  <span>التجميع والمقارنات المرئية (Top Groups)</span>
                </h3>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400">التجميع حسب:</span>
                  <select
                    value={selectedGroupCol}
                    onChange={e => {
                      setSelectedGroupCol(e.target.value);
                      runFilter(sessionId, activeSheetName, filters, e.target.value, selectedAmountCol);
                    }}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-800 font-bold cursor-pointer"
                  >
                    {sheetAnalysis?.columns.map((c: ColumnMeta) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Visual Bars */}
              <div className="space-y-2.5 pt-1">
                {groupResult.items.map((item: any, idx: number) => {
                  const maxVal = parseFloat(groupResult.items[0]?.sum || '1');
                  const currentVal = parseFloat(item.sum || '0');
                  const pct = maxVal > 0 ? Math.min(100, Math.max(5, (currentVal / maxVal) * 100)) : 10;

                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800 truncate max-w-[60%]">{item.label}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono-numbers font-bold text-slate-900">{item.sum} {item.currency}</span>
                          <button
                            onClick={() => openMatchingRows(`صفوف [${item.label}]`, item.matchingRowIndices)}
                            className="text-[10px] font-bold text-emerald-600 hover:text-emerald-800 underline cursor-pointer"
                          >
                            عرض الصفوف ({item.count})
                          </button>
                        </div>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Table Preview */}
          {filteredRows.length > 0 && sheetAnalysis && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-emerald-600" />
                  <span>معاينة بيانات الجدول (تظهر أول 50 صفاً من أصل {filteredRowCount} صفاً مطابقاً)</span>
                </h3>

                <button
                  onClick={() => openMatchingRows('كافة الصفوف المطابقة للتصفية', matchingIndices)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>عرض الكل ({filteredRowCount})</span>
                </button>
              </div>

              <div className="overflow-x-auto max-h-72 rounded-xl border border-slate-200">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-bold sticky top-0">
                    <tr>
                      <th className="p-2.5">#</th>
                      {sheetAnalysis.columns.map((c: ColumnMeta, i: number) => (
                        <th key={i} className="p-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <span>{c.name}</span>
                            <span className="text-[9px] font-normal px-1 py-0.5 rounded bg-slate-200/80 text-slate-600">
                              {c.userType || c.inferredType}
                            </span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono-numbers">
                    {filteredRows.map((r, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-50">
                        <td className="p-2.5 text-slate-400 font-sans">{rIdx + 1}</td>
                        {sheetAnalysis.columns.map((c: ColumnMeta, cIdx: number) => (
                          <td key={cIdx} className="p-2.5 whitespace-nowrap text-slate-800">
                            {String(r[c.name] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: "اسأل ملفك" AI Chat (5 cols) */}
        <div className="lg:col-span-5 flex flex-col h-[750px] bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          {/* Chat Header */}
          <div className="p-4 border-b border-slate-200/80 bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-900">محادثة «اسأل ملفك»</h3>
                <p className="text-[10px] text-slate-500">مساعد الميزان المحاسبي • قراءة آمنة بالـ Decimal</p>
              </div>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
              {activeSheetName}
            </span>
          </div>

          {/* Quick Suggested Questions based on columns */}
          <div className="p-3 bg-slate-100/60 border-b border-slate-200 flex flex-wrap gap-1.5 text-[11px]">
            <span className="text-[10px] font-bold text-slate-400 w-full mb-0.5">أسئلة مقترحة حسب أعمدة ملفك:</span>
            <button
              onClick={() => handleSendMessage('كم صافي المبيعات؟')}
              className="px-2.5 py-1 bg-white hover:bg-emerald-50 hover:text-emerald-800 border border-slate-200 rounded-lg text-slate-700 transition cursor-pointer"
            >
              كم صافي المبيعات؟
            </button>
            <button
              onClick={() => handleSendMessage('طب في أكتوبر فقط؟')}
              className="px-2.5 py-1 bg-white hover:bg-emerald-50 hover:text-emerald-800 border border-slate-200 rounded-lg text-slate-700 transition cursor-pointer"
            >
              طب في أكتوبر فقط؟
            </button>
            <button
              onClick={() => handleSendMessage('اعرض تفاصيل أكبر ثلاثة عملاء')}
              className="px-2.5 py-1 bg-white hover:bg-emerald-50 hover:text-emerald-800 border border-slate-200 rounded-lg text-slate-700 transition cursor-pointer"
            >
              أكبر ثلاثة عملاء
            </button>
            <button
              onClick={() => handleSendMessage('كم عدد الفواتير المنفذة؟')}
              className="px-2.5 py-1 bg-white hover:bg-emerald-50 hover:text-emerald-800 border border-slate-200 rounded-lg text-slate-700 transition cursor-pointer"
            >
              عدد الفواتير
            </button>
          </div>

          {/* Chat Messages Log */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 text-xs leading-relaxed">
            {chatMessages.length === 0 ? (
              <div className="text-center py-16 text-slate-400 space-y-2">
                <Sparkles className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="font-bold text-slate-600">اطرح أي سؤال محاسبي عن ملفك</p>
                <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                  يدعم «مساعد الميزان» الأسئلة بالعربية والإنجليزية، مع إمكانية متابعة الأسئلة وتتبع النتائج إلى الصفوف المحسوبة منها فوراً.
                </p>
              </div>
            ) : (
              chatMessages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`p-3.5 rounded-2xl max-w-[90%] space-y-2 ${
                      msg.role === 'user'
                        ? 'bg-emerald-600 text-white rounded-ee-xs'
                        : 'bg-slate-100 text-slate-900 rounded-es-xs border border-slate-200/80'
                    }`}
                  >
                    <div className="whitespace-pre-line font-medium leading-relaxed">
                      {msg.content}
                    </div>

                    {/* Structured Result Badge & Drilldown Button (For assistant messages with calculations) */}
                    {msg.role === 'assistant' && msg.executionResult && msg.executionResult.matchingRowCount > 0 && (
                      <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[10px]">
                        <div className="flex items-center gap-1.5 text-slate-500 font-mono">
                          <span>الصفوف: {msg.executionResult.matchingRowCount}</span>
                          <span>•</span>
                          <span>الورقة: {msg.plan?.sheetName}</span>
                        </div>

                        <button
                          onClick={() => openMatchingRows(`نتائج سؤال: ${msg.plan?.goal || 'التحليل'}`, msg.executionResult.matchingRowIndices)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-md font-bold transition cursor-pointer shadow-2xs"
                        >
                          <Eye className="w-3 h-3" />
                          <span>عرض الصفوف المطابقة</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <span className="text-[9px] text-slate-400 mt-1 px-1">
                    {new Date(msg.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))
            )}
            {chatLoading && (
              <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200 text-slate-500 text-xs animate-pulse">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                <span>«مساعد الميزان» يحلل الخطة ويحسب القيم بدقة...</span>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Chat Input */}
          <div className="p-3 border-t border-slate-200 bg-slate-50">
            <form
              onSubmit={e => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                placeholder="اسأل ملفك... (مثال: كم صافي المبيعات؟ أو ما هو أعلى صنف مبيعاً؟)"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                disabled={chatLoading}
                className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || chatLoading}
                className="p-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl transition cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Drilldown Modal: "عرض الصفوف المطابقة" */}
      {isMatchingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
                  <Eye className="w-4 h-4 text-emerald-600" />
                  <span>{matchingModalTitle}</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  تتبع الأرقام والنتائج المحاسبية إلى الصفوف الأصلية التي كوّنت النتيجة ({visibleModalRows.length} صفاً).
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExport(matchingIndices)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>تصدير هذه الصفوف</span>
                </button>
                <button
                  onClick={() => setIsMatchingModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Search Bar */}
            <div className="p-3 bg-slate-50 border-b border-slate-200">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                <input
                  type="text"
                  placeholder="بحث سريع داخل الصفوف المعروضة..."
                  value={matchingSearchQuery}
                  onChange={e => setMatchingSearchQuery(e.target.value)}
                  className="w-full pr-9 pl-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs outline-none"
                />
              </div>
            </div>

            {/* Modal Table Content */}
            <div className="flex-1 p-4 overflow-auto">
              {matchingModalLoading ? (
                <div className="text-center py-12 text-slate-500 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
                  <span>جارٍ جلب الصفوف المطابقة من الخادم...</span>
                </div>
              ) : visibleModalRows.length === 0 ? (
                <p className="text-center py-12 text-slate-400 text-xs italic">لا توجد صفوف مطابقة للبحث المحدد.</p>
              ) : (
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-bold sticky top-0">
                    <tr>
                      <th className="p-2">#</th>
                      {sheetAnalysis?.columns.map((c: ColumnMeta, i: number) => (
                        <th key={i} className="p-2 whitespace-nowrap">{c.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono-numbers">
                    {visibleModalRows.map((r, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-50">
                        <td className="p-2 text-slate-400 font-sans">{r.__rowIndex || rIdx + 1}</td>
                        {sheetAnalysis?.columns.map((c: ColumnMeta, cIdx: number) => (
                          <td key={cIdx} className="p-2 whitespace-nowrap text-slate-800">
                            {String(r[c.name] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
              <span>إجمالي السجلات المعروضة: {visibleModalRows.length} صفاً</span>
              <button
                onClick={() => setIsMatchingModalOpen(false)}
                className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg font-bold cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Settings Modal: Local Runner & Guide */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Server className="w-5 h-5 text-emerald-600" />
                  <span>إعدادات مشغل الذكاء الاصطناعي المحلي («مساعد الميزان»)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  ضبط الاتصال بمشغل النماذج مفتوحة المصدر دون رسوم API وبأمان تام على خوادم المؤسسة.
                </p>
              </div>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">رابط المشغل المحلي (Host URL):</label>
                <input
                  type="text"
                  value={aiSettings.runnerUrl}
                  onChange={e => setAiSettings({ ...aiSettings, runnerUrl: e.target.value })}
                  placeholder="http://localhost:11434"
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs"
                />
                <span className="text-[10px] text-slate-400">مثال: http://localhost:11434 أو عنوان IP لسيرفر الشركة الداخلي.</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">النموذج الأساسي:</label>
                  <input
                    type="text"
                    value={aiSettings.primaryModel}
                    onChange={e => setAiSettings({ ...aiSettings, primaryModel: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs"
                  />
                  <span className="text-[10px] text-slate-400">مثال: qwen2.5:7b أو qwen2.5:1.5b</span>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">النموذج البديل (Failover):</label>
                  <input
                    type="text"
                    value={aiSettings.fallbackModel}
                    onChange={e => setAiSettings({ ...aiSettings, fallbackModel: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs"
                  />
                  <span className="text-[10px] text-slate-400">مثال: deepseek-r1:7b أو deepseek-coder</span>
                </div>
              </div>

              {/* Test Connection Button & Result */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testingConnection}
                  className="w-full flex items-center justify-center gap-2 p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold transition cursor-pointer border border-slate-200"
                >
                  {testingConnection ? <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" /> : <Server className="w-4 h-4 text-emerald-600" />}
                  <span>اختبار الاتصال بالمشغل وفحص التحويل للبديل (Failover)</span>
                </button>
              </div>

              {connectionResult && (
                <div className={`p-3.5 rounded-xl text-xs space-y-1.5 border ${connectionResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
                  <div className="font-bold flex items-center gap-1.5">
                    {connectionResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertOctagon className="w-4 h-4 text-rose-600" />}
                    <span>{connectionResult.success ? 'تم الاتصال بالمشغل المحلي بنجاح' : 'تعذر الاتصال بالمشغل المحلي'}</span>
                  </div>
                  {connectionResult.primaryStatus && (
                    <div className="text-[11px] text-slate-600 font-mono">
                      الأساسي: {connectionResult.primaryStatus.connected ? `متصل (${connectionResult.primaryStatus.latencyMs}ms)` : `غير متاح (${connectionResult.primaryStatus.error})`}
                    </div>
                  )}
                  {connectionResult.fallbackStatus && (
                    <div className="text-[11px] text-slate-600 font-mono">
                      البديل: {connectionResult.fallbackStatus.connected ? `متصل (${connectionResult.fallbackStatus.latencyMs}ms)` : `غير متاح (${connectionResult.fallbackStatus.error})`}
                    </div>
                  )}
                </div>
              )}

              {/* Hardware Guide & License Specs */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5 text-[11px] text-slate-600 leading-relaxed">
                <span className="font-bold text-slate-800 block">دليل المدير ومواصفات التشغيل:</span>
                <p>• طرازات 7B: تتطلب 8GB - 16GB ذاكرة RAM أو كارت شاشة VRAM 6GB - 8GB.</p>
                <p>• طرازات 1.5B/3B: تعمل بخفة على أي جهاز مكتبي عادي (4GB RAM).</p>
                <p>• التراخيص: Qwen 2.5 (ترخيص Apache 2.0)، DeepSeek R1 (ترخيص MIT). كلاهما متاح للاستخدام التجاري والمحلي بالكامل.</p>
                <p>• عند تعذر الاتصال بالمشغل، يستمر عمل محرك الإحصائيات والفلاتر وتصدير الجداول دون أي توقف.</p>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveAiSettings}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition shadow-xs cursor-pointer"
              >
                حفظ الإعدادات
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
