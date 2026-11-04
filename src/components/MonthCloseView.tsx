import React, { useState, useEffect } from 'react';
import {
  CalendarCheck,
  CheckCircle2,
  AlertOctagon,
  AlertTriangle,
  RotateCcw,
  Printer,
  RefreshCw,
  FileSpreadsheet,
  Lock,
  Unlock,
  Building,
  ArrowRight,
  ShieldCheck,
  Calendar,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  History
} from 'lucide-react';
import { apiClient } from '../services/apiClient';
import { ConfirmModal } from './ConfirmModal';
import { PeriodClosingStatus, PeriodClosingDiagnostic, User } from '../types';
import { hasPermission } from '../utils/permissions';

interface MonthCloseViewProps {
  currentUser: User | null;
  onNavigateToTab?: (tab: string, filter?: any) => void;
}

export const MonthCloseView: React.FC<MonthCloseViewProps> = ({ currentUser, onNavigateToTab }) => {
  const [periods, setPeriods] = useState<any[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('fp_2026_03');
  const [status, setStatus] = useState<PeriodClosingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Modals state
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [closeNotes, setCloseNotes] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  const [isReopenModalOpen, setIsReopenModalOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [isReopening, setIsReopening] = useState(false);

  const [expandedDiagnostics, setExpandedDiagnostics] = useState<Record<string, boolean>>({
    unbalanced_je: true,
    unposted_drafts: true,
    customers_reconciliation: true,
    suppliers_reconciliation: true,
    inventory_reconciliation: true
  });

  const [historyTab, setHistoryTab] = useState(false);
  const [historyData, setHistoryData] = useState<{ closings: any[]; reopenings: any[] } | null>(null);

  const fetchStatus = async (pId = selectedPeriodId) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get(`/period-closing/status?periodId=${pId}`);
      if (data && data.status) {
        setStatus(data.status);
        if (data.periods) setPeriods(data.periods);
      }
    } catch (err: any) {
      setError(err.message || 'فشل تحميل بيانات مراجعة وإقفال الشهر.');
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const data = await apiClient.get('/period-closing/history');
      if (data) setHistoryData(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchStatus(selectedPeriodId);
    fetchHistory();
  }, [selectedPeriodId]);

  const handleClosePeriod = async () => {
    setIsClosing(true);
    setError(null);
    try {
      const res = await apiClient.post('/period-closing/close', {
        periodId: selectedPeriodId,
        notes: closeNotes
      });
      setActionSuccess(res.message || 'تم إقفال الفترة المالية بنجاح.');
      setIsCloseModalOpen(false);
      setCloseNotes('');
      fetchStatus(selectedPeriodId);
      fetchHistory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsClosing(false);
    }
  };

  const handleReopenPeriod = async () => {
    if (!reopenReason.trim() || reopenReason.trim().length < 5) {
      setError('يرجى كتابة سبب رسمي مبرر لا يقل عن 5 أحرف لإعادة فتح الفترة.');
      return;
    }
    setIsReopening(true);
    setError(null);
    try {
      const res = await apiClient.post('/period-closing/reopen', {
        periodId: selectedPeriodId,
        reason: reopenReason
      });
      setActionSuccess(res.message || 'تم إعادة فتح الفترة المالية بنجاح.');
      setIsReopenModalOpen(false);
      setReopenReason('');
      fetchStatus(selectedPeriodId);
      fetchHistory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsReopening(false);
    }
  };

  const toggleDiagnostic = (key: string) => {
    setExpandedDiagnostics(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const canClose = hasPermission(currentUser, ['period.close', 'manage_settings']);
  const canReopen = hasPermission(currentUser, ['reopen_period', 'period.reopen', 'manage_settings']);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shadow-xs">
            <CalendarCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">مراجعة وإقفال الشهر المالي</h1>
            <p className="text-xs text-slate-500 mt-1">
              محرك التحقق والرقابة المحاسبية: مطابقة حسابات الرقابة، تقييم المخزون، والتحقق من سلامة القيود قبل الإقفال الرسمي.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Period Selector */}
          <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200">
            <Calendar className="w-4 h-4 text-slate-500 ms-2" />
            <select
              value={selectedPeriodId}
              onChange={(e) => setSelectedPeriodId(e.target.value)}
              className="bg-transparent text-sm font-semibold text-slate-800 focus:outline-hidden pe-4 cursor-pointer"
            >
              {periods.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name_ar} {p.is_closed ? '(مقـفـلة 🔒)' : '(مفتوحة 🟢)'}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => fetchStatus()}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>إعادة الفحص المالي</span>
          </button>

          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition shadow-xs no-print"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>طباعة محضر الإقفال</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {actionSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-xs text-emerald-600 underline">إغلاق</button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-2">
          <AlertOctagon className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="whitespace-pre-line font-medium leading-relaxed">{error}</div>
        </div>
      )}

      {/* Status Highlights Card */}
      {status && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
            <span className="text-xs font-medium text-slate-500">حالة الفترة المالية</span>
            <div className="mt-2 flex items-center gap-2">
              {status.period.is_closed === 1 ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
                  <Lock className="w-3.5 h-3.5" />
                  مقفلة رسمياً
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  <Unlock className="w-3.5 h-3.5" />
                  مفتوحة للعمليات
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              من {status.period.start_date} إلى {status.period.end_date}
            </p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
            <span className="text-xs font-medium text-slate-500">أخطاء مانعة للإقفال</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={`text-2xl font-black font-mono-numbers ${status.blockingCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {status.blockingCount}
              </span>
              <span className="text-xs text-slate-500 font-medium">بند غير مطابق</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">يجب معالجتها جميعاً لتمكين الإقفال</p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
            <span className="text-xs font-medium text-slate-500">تنبيهات استرشادية</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={`text-2xl font-black font-mono-numbers ${status.warningCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {status.warningCount}
              </span>
              <span className="text-xs text-slate-500 font-medium">تنبيه يحتاج مراجعة</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">مثل الدفعات المقدمة غير المخصصة</p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
            <span className="text-xs font-medium text-slate-500">إجراء الإقفال / إعادة الفتح</span>
            <div className="mt-2">
              {status.period.is_closed === 1 ? (
                canReopen ? (
                  <button
                    onClick={() => setIsReopenModalOpen(true)}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>طلب إعادة فتح الفترة</span>
                  </button>
                ) : (
                  <div className="text-[11px] text-slate-400 text-center py-2">مقفلة (يتطلب صلاحية استثنائية لإعادة الفتح)</div>
                )
              ) : (
                <button
                  disabled={!status.canClose || !canClose}
                  onClick={() => setIsCloseModalOpen(true)}
                  className={`w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition shadow-xs ${
                    status.canClose && canClose
                      ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer shadow-blue-500/20'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                  }`}
                >
                  <Lock className="w-4 h-4" />
                  <span>{status.canClose ? 'إقفال الفترة المالية الآن' : 'غير مؤهلة للإقفال حالياً'}</span>
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-400 mt-2 text-center">
              آخر فحص: {new Date(status.lastReviewDate).toLocaleTimeString('ar-EG')}
            </p>
          </div>
        </div>
      )}

      {/* Tabs: Diagnostics vs History */}
      <div className="flex items-center gap-2 border-b border-slate-200 no-print">
        <button
          onClick={() => setHistoryTab(false)}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition ${
            !historyTab ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          فحوصات المطابقة والرقابة المحاسبية ({status?.diagnostics.length || 0})
        </button>
        <button
          onClick={() => setHistoryTab(true)}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
            historyTab ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>سجل الإقفال وإعادة الفتح التاريخي</span>
        </button>
      </div>

      {!historyTab ? (
        /* Diagnostics List */
        <div className="space-y-4">
          {status?.diagnostics.map((diag) => {
            const isExpanded = !!expandedDiagnostics[diag.key];
            const isBlocking = diag.severity === 'blocking';

            return (
              <div
                key={diag.key}
                className={`bg-white rounded-2xl border transition shadow-xs overflow-hidden ${
                  !diag.isPassed
                    ? isBlocking ? 'border-rose-300 ring-1 ring-rose-200' : 'border-amber-300 ring-1 ring-amber-200'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div
                  onClick={() => toggleDiagnostic(diag.key)}
                  className="p-5 flex items-center justify-between gap-4 cursor-pointer select-none bg-gradient-to-r from-transparent to-slate-50/50"
                >
                  <div className="flex items-center gap-3.5">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      diag.isPassed
                        ? 'bg-emerald-50 text-emerald-600'
                        : isBlocking
                        ? 'bg-rose-50 text-rose-600'
                        : 'bg-amber-50 text-amber-600'
                    }`}>
                      {diag.isPassed ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : isBlocking ? (
                        <AlertOctagon className="w-5 h-5" />
                      ) : (
                        <AlertTriangle className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-800">{diag.title_ar}</h3>
                        {isBlocking ? (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-rose-100 text-rose-700">
                            مانع للإقفال
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-amber-100 text-amber-700">
                            تنبيه استرشادي
                          </span>
                        )}
                      </div>
                      <p className={`text-xs mt-1 ${diag.isPassed ? 'text-slate-500' : isBlocking ? 'text-rose-700 font-medium' : 'text-amber-700 font-medium'}`}>
                        {diag.message_ar}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-end font-mono-numbers">
                      <div className="text-xs text-slate-400">الفارق:</div>
                      <div className={`text-sm font-bold ${diag.variance > 0 ? (isBlocking ? 'text-rose-600' : 'text-amber-600') : 'text-emerald-600'}`}>
                        {typeof diag.actualValue === 'number' && typeof diag.expectedValue === 'number'
                          ? `${diag.variance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`
                          : diag.variance}
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>
                </div>

                {/* Expanded Details / Subledger Breakdown */}
                {isExpanded && (
                  <div className="p-5 border-t border-slate-100 bg-slate-50/50 space-y-3">
                    {typeof diag.actualValue === 'number' && typeof diag.expectedValue === 'number' && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-white rounded-xl border border-slate-200/80 text-xs font-mono-numbers">
                        <div>
                          <span className="text-slate-400 block mb-1">القيمة المحتسبة / الدفترية:</span>
                          <span className="font-bold text-slate-800">{diag.actualValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block mb-1">رصيد حساب الرقابة بالأستاذ:</span>
                          <span className="font-bold text-slate-800">{diag.expectedValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block mb-1">فرق المطابقة الصافي:</span>
                          <span className={`font-bold ${diag.variance > 0.01 ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {diag.variance.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Linked Documents / Pending Drafts */}
                    {diag.documents && diag.documents.length > 0 && (
                      <div className="mt-3">
                        <div className="text-xs font-bold text-slate-700 mb-2">المستندات المرتبطة التي تتطلب معالجة ({diag.documents.length}):</div>
                        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                          <table className="w-full text-right text-xs">
                            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
                              <tr>
                                <th className="p-2.5">رقم المستند</th>
                                <th className="p-2.5">نوع المستند</th>
                                <th className="p-2.5">التاريخ</th>
                                <th className="p-2.5 text-end">المبلغ</th>
                                <th className="p-2.5 text-center">إجراء</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-mono-numbers">
                              {diag.documents.map((doc, i) => (
                                <tr key={i} className="hover:bg-slate-50/80">
                                  <td className="p-2.5 font-bold text-slate-800">{doc.number}</td>
                                  <td className="p-2.5 text-slate-600 font-sans">{doc.type}</td>
                                  <td className="p-2.5 text-slate-500">{doc.date}</td>
                                  <td className="p-2.5 text-end font-bold text-slate-800">
                                    {doc.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م
                                  </td>
                                  <td className="p-2.5 text-center">
                                    <button
                                      onClick={() => {
                                        if (doc.type.includes('مبيعات')) onNavigateToTab?.('sales');
                                        else if (doc.type.includes('مشتريات')) onNavigateToTab?.('purchases');
                                        else if (doc.type.includes('مردود')) onNavigateToTab?.('sales_returns');
                                        else if (doc.type.includes('قبض') || doc.type.includes('صرف')) onNavigateToTab?.('treasury');
                                        else onNavigateToTab?.('journal');
                                      }}
                                      className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-sans font-bold"
                                    >
                                      <span>معالجة من المصدر</span>
                                      <ArrowRight className="w-3 h-3" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Historical Logs */
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
          <div>
            <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
              <Lock className="w-4 h-4 text-slate-600" />
              سجل عمليات الإقفال المالي المعتمدة
            </h3>
            {historyData?.closings && historyData.closings.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
                    <tr>
                      <th className="p-3">الفترة المالية</th>
                      <th className="p-3">تاريخ الإقفال</th>
                      <th className="p-3">المسؤول المنفذ</th>
                      <th className="p-3">الملاحظات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {historyData.closings.map((c, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="p-3 font-bold text-slate-800">{c.period_name}</td>
                        <td className="p-3 text-slate-500 font-mono-numbers">{new Date(c.closed_at).toLocaleString('ar-EG')}</td>
                        <td className="p-3 font-medium text-slate-700">{c.closed_by_name}</td>
                        <td className="p-3 text-slate-600">{c.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">لا توجد عمليات إقفال مسجلة حتى الآن.</p>
            )}
          </div>

          <div className="pt-4 border-t border-slate-100">
            <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2 text-amber-700">
              <RotateCcw className="w-4 h-4" />
              سجل إعادة فتح الفترات المالية والمسوغات الرسمية
            </h3>
            {historyData?.reopenings && historyData.reopenings.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
                    <tr>
                      <th className="p-3">الفترة المالية</th>
                      <th className="p-3">تاريخ إعادة الفتح</th>
                      <th className="p-3">المستخدم المنفذ</th>
                      <th className="p-3">المسوغ والسبب الرسمي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {historyData.reopenings.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="p-3 font-bold text-slate-800">{r.period_name}</td>
                        <td className="p-3 text-slate-500 font-mono-numbers">{new Date(r.reopened_at).toLocaleString('ar-EG')}</td>
                        <td className="p-3 font-medium text-slate-700">{r.reopened_by_name}</td>
                        <td className="p-3 text-amber-900 font-medium">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">لا توجد عمليات إعادة فتح سابقة.</p>
            )}
          </div>
        </div>
      )}

      {/* Close Period Confirmation Modal */}
      {isCloseModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-blue-700 pb-3 border-b border-slate-100">
              <Lock className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-900">تأكيد إقفال الفترة المالية ({status?.period.name_ar})</h3>
            </div>

            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-800 leading-relaxed">
              <strong>تنبيه محاسبي مهم:</strong> إقفال الشهر سيمنع نهائياً ترحيل أي فواتير أو قيود أو سندات بتاريخ يقع ضمن هذه الفترة عبر كافة مسارات النظام، ولن يمكن تعديلها إلا عبر إعادة فتح استثنائية موثقة.
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات محضر الإقفال:</label>
              <textarea
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                placeholder="اكتب أي ملاحظات أو نتائج مراجعة ختامية..."
                rows={3}
                className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:outline-blue-600 focus:ring-1 focus:ring-blue-600"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                disabled={isClosing}
                onClick={() => setIsCloseModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                إلغاء
              </button>
              <button
                disabled={isClosing}
                onClick={handleClosePeriod}
                className="px-5 py-2.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition flex items-center gap-1.5"
              >
                {isClosing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>اعتماد وإقفال الفترة رسمياً</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reopen Period Modal */}
      {isReopenModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-amber-600 pb-3 border-b border-slate-100">
              <RotateCcw className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-900">إعادة فتح فترة مالية مقفلة ({status?.period.name_ar})</h3>
            </div>

            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 leading-relaxed">
              <strong>إجراء رقابي حساس:</strong> إعادة الفتح يتطلب مسوغاً رسمياً معتمداً من الإدارة المالية، وسيتم تسجيل هويتك والتاريخ والسبب وتفاصيل العملية بسجل التدقيق الرقابي غير القابل للتعديل.
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                سبب ومسوغ إعادة الفتح (إجباري): <span className="text-rose-600">*</span>
              </label>
              <textarea
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="اذكر بوضوح سبب إعادة الفتح والمستندات المراد تصحيحها..."
                rows={3}
                className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:outline-amber-600 focus:ring-1 focus:ring-amber-600"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                disabled={isReopening}
                onClick={() => setIsReopenModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                إلغاء
              </button>
              <button
                disabled={isReopening || reopenReason.trim().length < 5}
                onClick={handleReopenPeriod}
                className="px-5 py-2.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-xs transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {isReopening && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>تأكيد إعادة الفتح</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
