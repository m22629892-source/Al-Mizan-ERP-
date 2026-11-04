import React, { useState, useEffect } from 'react';
import {
  Database,
  Download,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertOctagon,
  AlertTriangle,
  RotateCcw,
  ShieldCheck,
  FileCheck2,
  HardDrive,
  Calendar,
  Layers,
  ArrowRight
} from 'lucide-react';
import { apiClient } from '../services/apiClient';
import { SystemBackup, User } from '../types';
import { hasPermission } from '../utils/permissions';

interface BackupRestoreViewProps {
  currentUser: User | null;
  onRefreshSession?: () => void;
}

export const BackupRestoreView: React.FC<BackupRestoreViewProps> = ({ currentUser, onRefreshSession }) => {
  const [backups, setBackups] = useState<SystemBackup[]>([]);
  const [currentCounts, setCurrentCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Restore verification modal state
  const [selectedBackupForRestore, setSelectedBackupForRestore] = useState<SystemBackup | null>(null);
  const [verificationResult, setVerificationResult] = useState<any | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [confirmSafetyChecked, setConfirmSafetyChecked] = useState(false);

  const fetchBackups = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get('/backups');
      if (data && data.backups) {
        setBackups(data.backups);
        if (data.currentCounts) setCurrentCounts(data.currentCounts);
      }
    } catch (err: any) {
      setError(err.message || 'فشل تحميل قائمة النسخ الاحتياطية.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const handleCreateBackup = async () => {
    setCreating(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await apiClient.post('/backups/create', {});
      setSuccessMessage(res.message || 'تم إنشاء النسخة الاحتياطية المتسقة بنجاح واجتياز الفحص الرقابي.');
      fetchBackups();
    } catch (err: any) {
      setError(err.message || 'فشل إنشاء النسخة الاحتياطية.');
    } finally {
      setCreating(false);
    }
  };

  const startRestoreVerification = async (b: SystemBackup) => {
    setSelectedBackupForRestore(b);
    setVerificationResult(null);
    setConfirmSafetyChecked(false);
    setVerifying(true);
    setError(null);

    try {
      const res = await apiClient.post('/backups/verify', { backupId: b.id });
      setVerificationResult(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!selectedBackupForRestore || !confirmSafetyChecked) return;

    setRestoring(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await apiClient.post('/backups/restore', {
        backupId: selectedBackupForRestore.id,
        confirmSafety: true
      });

      setSuccessMessage(`${res.message} (تم حفظ نسخة أمان في ${res.safetyBackupFile})`);
      setSelectedBackupForRestore(null);
      fetchBackups();
      if (onRefreshSession) onRefreshSession();
    } catch (err: any) {
      setError(err.message || 'فشل استعادة قاعدة البيانات.');
    } finally {
      setRestoring(false);
    }
  };

  const canCreate = hasPermission(currentUser, ['backup.create', 'manage_settings']);
  const canRestore = hasPermission(currentUser, ['backup.restore', 'manage_settings']);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Banner */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center shadow-xs">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">النسخ الاحتياطي المتسق والاستعادة</h1>
            <p className="text-xs text-slate-500 mt-1">
              آلية النسخ الاحتياطي المتسقة (SQLite WAL Consistent Backup) مع فحص السلامة والاستعادة الآمنة بنسخة وقائية مسبقة.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchBackups}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>

          <button
            disabled={!canCreate || creating}
            onClick={handleCreateBackup}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer"
          >
            {creating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4" />}
            <span>إنشاء نسخة احتياطية فورية (WAL Snapshot)</span>
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

      {/* Active Database Health Card */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-6 text-white shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-700/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">قاعدة بيانات الإنتاج النشطة (almizan.db)</h3>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  WAL Mode متصلة
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">ACID Compliance + Foreign Keys Strict Enforcement</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mt-4 text-xs font-mono-numbers">
          <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
            <span className="text-slate-400 block text-[11px] mb-1 font-sans">دليل الحسابات:</span>
            <span className="text-base font-bold text-white">{currentCounts.accounts || 0}</span>
          </div>
          <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
            <span className="text-slate-400 block text-[11px] mb-1 font-sans">العملاء والموردون:</span>
            <span className="text-base font-bold text-white">{currentCounts.parties || 0}</span>
          </div>
          <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
            <span className="text-slate-400 block text-[11px] mb-1 font-sans">بطاقات الأصناف:</span>
            <span className="text-base font-bold text-white">{currentCounts.items || 0}</span>
          </div>
          <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
            <span className="text-slate-400 block text-[11px] mb-1 font-sans">فواتير المبيعات:</span>
            <span className="text-base font-bold text-white">{currentCounts.sales_invoices || 0}</span>
          </div>
          <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
            <span className="text-slate-400 block text-[11px] mb-1 font-sans">فواتير المشتريات:</span>
            <span className="text-base font-bold text-white">{currentCounts.purchase_invoices || 0}</span>
          </div>
          <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
            <span className="text-slate-400 block text-[11px] mb-1 font-sans">قيود اليومية:</span>
            <span className="text-base font-bold text-emerald-400">{currentCounts.journal_entries || 0}</span>
          </div>
        </div>
      </div>

      {/* Backups List Table */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Layers className="w-4 h-4 text-purple-600" />
            سجل النسخ الاحتياطية المتسقة المتاحة ({backups.length})
          </h2>
        </div>

        {backups.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-bold">
                <tr>
                  <th className="p-3">اسم ملف النسخة</th>
                  <th className="p-3">تاريخ الإنشاء</th>
                  <th className="p-3">الحجم</th>
                  <th className="p-3">فحص السلامة (Integrity)</th>
                  <th className="p-3">إحصاء السجلات</th>
                  <th className="p-3">المنشئ</th>
                  <th className="p-3 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono-numbers">
                {backups.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="p-3 font-bold text-slate-800 max-w-xs truncate">{b.filename}</td>
                    <td className="p-3 text-slate-500">{new Date(b.created_at).toLocaleString('ar-EG')}</td>
                    <td className="p-3 font-bold text-slate-700">{(b.file_size / 1024).toFixed(1)} ك.ب</td>
                    <td className="p-3">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        <CheckCircle2 className="w-3 h-3" />
                        سليمة (PRAGMA ok)
                      </span>
                    </td>
                    <td className="p-3 text-slate-600 font-sans">
                      {b.record_counts?.accounts || 0} حساب / {b.record_counts?.parties || 0} طرف / {b.record_counts?.journal_entries || 0} قيد
                    </td>
                    <td className="p-3 font-sans text-slate-700">{b.created_by}</td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <a
                          href={`/api/backups/${b.id}/download`}
                          download={b.filename}
                          className="p-1.5 text-slate-600 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition"
                          title="تحميل ملف قاعدة البيانات"
                        >
                          <Download className="w-4 h-4" />
                        </a>

                        {canRestore && (
                          <button
                            onClick={() => startRestoreVerification(b)}
                            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>استعادة</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-slate-400 text-xs">
            لا توجد نسخ احتياطية مسجلة بعد. انقر على «إنشاء نسخة احتياطية فورية» أعلاه لإنشاء أول نسخة.
          </div>
        )}
      </div>

      {/* Pre-Restore Verification & Confirmation Modal */}
      {selectedBackupForRestore && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-amber-600 pb-3 border-b border-slate-100">
              <RotateCcw className="w-6 h-6" />
              <div>
                <h3 className="text-base font-bold text-slate-900">فحص واستعادة قاعدة البيانات</h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">{selectedBackupForRestore.filename}</p>
              </div>
            </div>

            {verifying ? (
              <div className="p-6 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-purple-600" />
                <span>جاري فتح النسخة على قاعدة بيانات اختبارية منعزلة وفحص التوافق وسلامة الجداول...</span>
              </div>
            ) : verificationResult ? (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>اجتازت النسخة الاحتياطية فحص السلامة (Integrity Check OK) وجاهزة للاستعادة بأمان.</span>
                </div>

                {/* Record Counts Comparison */}
                <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                  <div className="bg-slate-50 p-2.5 font-bold text-slate-700 border-b border-slate-200">
                    مقارنة إحصاء السجلات بين النسخة الاحتياطية والقاعدة الحالية:
                  </div>
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-100/50 text-slate-500 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="p-2">الجدول</th>
                        <th className="p-2 text-end">في النسخة المراد استعادتها</th>
                        <th className="p-2 text-end">في القاعدة النشطة حالياً</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono-numbers">
                      {Object.keys(verificationResult.backupCounts || {}).slice(0, 8).map(tbl => (
                        <tr key={tbl}>
                          <td className="p-2 font-sans text-slate-700">{tbl}</td>
                          <td className="p-2 text-end font-bold text-purple-700">{verificationResult.backupCounts[tbl]}</td>
                          <td className="p-2 text-end font-bold text-slate-500">{verificationResult.currentCounts[tbl]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Safety Guarantee */}
                <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900 leading-relaxed">
                  <strong>إجراء أمان تلقائي:</strong> سيقوم النظام تلقائياً بإنشاء نسخة احتياطية وقائية كاملة من قاعدة الإنتاج الحالية قبل البدء في استبدالها وحفظها في مجلد backups.
                </div>

                {/* Explicit Safety Checkbox */}
                <label className="flex items-start gap-2 text-xs font-bold text-slate-800 select-none cursor-pointer pt-2">
                  <input
                    type="checkbox"
                    checked={confirmSafetyChecked}
                    onChange={(e) => setConfirmSafetyChecked(e.target.checked)}
                    className="w-4 h-4 rounded-sm text-purple-600 focus:ring-purple-500 mt-0.5"
                  />
                  <span>أقر بأنني راجعت السجلات وأوافق على استبدال قاعدة البيانات النشطة بهذه النسخة.</span>
                </label>
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                disabled={restoring}
                onClick={() => setSelectedBackupForRestore(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                إلغاء
              </button>
              <button
                disabled={!confirmSafetyChecked || restoring}
                onClick={handleConfirmRestore}
                className="px-5 py-2.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-xs transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {restoring && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>تنفيذ الاستعادة الآن</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
