import React, { useState, useEffect } from 'react';
import {
  Building2,
  RefreshCw,
  CheckCircle2,
  AlertOctagon,
  AlertTriangle,
  Upload,
  Link2,
  Unlink,
  PlusCircle,
  FileSpreadsheet,
  Check,
  Calendar,
  Sparkles,
  ArrowRight,
  Printer
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { apiClient } from '../services/apiClient';
import { User, BankAccount, BankStatementLine } from '../types';
import { hasPermission } from '../utils/permissions';

interface BankReconciliationViewProps {
  currentUser: User | null;
  bankAccounts: BankAccount[];
}

export const BankReconciliationView: React.FC<BankReconciliationViewProps> = ({ currentUser, bankAccounts }) => {
  const [selectedBankId, setSelectedBankId] = useState<string>(bankAccounts[0]?.id || '');
  const [fromDate, setFromDate] = useState<string>('2026-01-01');
  const [toDate, setToDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const [statementLines, setStatementLines] = useState<BankStatementLine[]>([]);
  const [bookTransactions, setBookTransactions] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [bankInfo, setBankInfo] = useState<any>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const canImport = hasPermission(currentUser, 'bank.reconciliation.import');
  const canMatch = hasPermission(currentUser, 'bank.reconciliation.match');
  const canRecordFees = hasPermission(currentUser, 'bank.reconciliation.fees');

  useEffect(() => {
    if (bankAccounts && bankAccounts.length > 0) {
      if (!selectedBankId || !bankAccounts.some(b => b.id === selectedBankId)) {
        setSelectedBankId(bankAccounts[0].id);
      }
    } else {
      setSelectedBankId('');
    }
  }, [bankAccounts, selectedBankId]);

  // Manual Selection state
  const [selectedStatementLineId, setSelectedStatementLineId] = useState<string | null>(null);
  const [selectedBookTxId, setSelectedBookTxId] = useState<string | null>(null);

  // Bank Fee Modal state
  const [isFeeModalOpen, setIsFeeModalOpen] = useState(false);
  const [feeLine, setFeeLine] = useState<BankStatementLine | null>(null);
  const [feeDesc, setFeeDesc] = useState('');
  const [isPostingFee, setIsPostingFee] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get(`/bank-reconciliation/data?bankAccountId=${selectedBankId}&fromDate=${fromDate}&toDate=${toDate}`);
      if (data) {
        setStatementLines(data.statementLines || []);
        setBookTransactions(data.bookTransactions || []);
        setSuggestions(data.suggestions || []);
        setMetrics(data.reconciliationMetrics || null);
        setBankInfo(data.bank || null);
      }
    } catch (err: any) {
      setError(err.message || 'فشل تحميل بيانات التسوية البنكية.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedBankId) fetchData();
  }, [selectedBankId, fromDate, toDate]);

  const handleApplyMatch = async (sLineId: string, bTxId: string) => {
    setError(null);
    try {
      const targetTx = bookTransactions.find(b => b.id === bTxId);
      await apiClient.post('/bank-reconciliation/match', {
        statementLineId: sLineId,
        bookTxId: bTxId,
        bookTxType: targetTx?.type || 'voucher'
      });
      setSuccessMessage('تمت مطابقة الحركة البنكية بنجاح.');
      setSelectedStatementLineId(null);
      setSelectedBookTxId(null);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUnmatch = async (sLineId: string) => {
    setError(null);
    try {
      await apiClient.post('/bank-reconciliation/unmatch', { statementLineId: sLineId });
      setSuccessMessage('تم إلغاء المطابقة.');
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleApplyAllSuggestions = async () => {
    if (!suggestions || suggestions.length === 0) return;
    setError(null);
    try {
      for (const s of suggestions) {
        const targetTx = bookTransactions.find(b => b.id === s.bookTxId);
        await apiClient.post('/bank-reconciliation/match', {
          statementLineId: s.statementLineId,
          bookTxId: s.bookTxId,
          bookTxType: targetTx?.type || 'voucher'
        });
      }
      setSuccessMessage(`تم تطبيق (${suggestions.length}) مطابقة ذكية بنجاح.`);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleStatementUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(sheet);

        const lines = rows.map(r => ({
          lineDate: r['التاريخ'] || r.date || new Date().toISOString().split('T')[0],
          reference: r['المرجع'] || r['رقم الحركة'] || r.ref || '',
          description: r['الوصف'] || r['البيان'] || r.description || 'حركة بنكية',
          debit: Number(r['مدين'] || r['سحب'] || r.debit || 0),
          credit: Number(r['دائن'] || r['إيداع'] || r.credit || 0)
        }));

        const res = await apiClient.post('/bank-reconciliation/import-statement', {
          bankAccountId: selectedBankId,
          statementDate: toDate,
          lines,
          filename: file.name
        });

        setSuccessMessage(res.message);
        fetchData();
      } catch (err: any) {
        setError(`فشل استيراد كشف الحساب: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const loadSampleStatement = async () => {
    setLoading(true);
    setError(null);

    try {
      const sampleLines = [
        { lineDate: '2026-03-05', reference: 'TRF-001', description: 'تحويل وارد من شركة الأهرام', debit: 0, credit: 8000 },
        { lineDate: '2026-03-08', reference: 'CHQ-501', description: 'صرف شيك للمورد شركة الأمل', debit: 4000, credit: 0 },
        { lineDate: '2026-03-15', reference: 'FEE-991', description: 'عمولة تحويل وسحب إلكتروني', debit: 150, credit: 0 },
        { lineDate: '2026-03-20', reference: 'INT-102', description: 'عائد فوائد الحساب الجاري الدائن', debit: 0, credit: 650 }
      ];

      const res = await apiClient.post('/bank-reconciliation/import-statement', {
        bankAccountId: selectedBankId,
        statementDate: toDate,
        lines: sampleLines,
        filename: 'sample_bank_statement.xlsx'
      });

      setSuccessMessage(res.message);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openFeeModal = (line: BankStatementLine) => {
    setFeeLine(line);
    setFeeDesc(line.debit > 0 ? `مصاريف وعمولات بنكية - مرجع ${line.reference || line.id}` : `فوائد وعوائد بنكية دائنة - مرجع ${line.reference || line.id}`);
    setIsFeeModalOpen(true);
  };

  const handlePostFee = async () => {
    if (!feeLine) return;
    setIsPostingFee(true);
    setError(null);
    try {
      const res = await apiClient.post('/bank-reconciliation/record-fee', {
        statementLineId: feeLine.id,
        description: feeDesc
      });
      setSuccessMessage(res.message);
      setIsFeeModalOpen(false);
      setFeeLine(null);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsPostingFee(false);
    }
  };

  if (!bankAccounts || bankAccounts.length === 0) {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-xs">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-bold text-slate-800 mb-2">لا توجد حسابات بنكية مسموحة للمستخدم الحالي</h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            لم يتم العثور على حسابات بنكية مرتبطة بصلاحياتك أو مسجلة في شجرة الحسابات. يرجى التواصل مع المدير لمنح الصلاحية أو تعريف الحسابات البنكية.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-cyan-50 text-cyan-700 flex items-center justify-center shadow-xs">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">تسوية كشوف الحسابات البنكية</h1>
            <p className="text-xs text-slate-500 mt-1">
              مطابقة كشوف الحسابات المستوردة مع دفاتر اليومية، رصد الإيداعات بالطريق، وتسجيل القيود الآلية للمصروفات البنكية.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Bank Selector */}
          <select
            value={selectedBankId}
            onChange={(e) => setSelectedBankId(e.target.value)}
            className="px-3 py-2 text-xs font-bold bg-slate-50 text-slate-800 rounded-xl border border-slate-200 focus:outline-hidden cursor-pointer"
          >
            {bankAccounts.map(b => (
              <option key={b.id} value={b.id}>
                {b.bank_name} ({b.account_number}) - {b.currency_code}
              </option>
            ))}
          </select>

          {canImport && (
            <>
              <label className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>استيراد كشف Excel</span>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleStatementUpload} className="hidden" />
              </label>

              <button
                onClick={loadSampleStatement}
                className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold transition shadow-xs"
              >
                <span>حركات كشف نموذجية</span>
              </button>
            </>
          )}

          <button
            onClick={fetchData}
            className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition"
            title="تحديث البيانات"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
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

      {/* Reconciliation Summary Bar */}
      {metrics && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs grid grid-cols-1 md:grid-cols-4 gap-4 font-mono-numbers">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
            <span className="text-xs font-medium text-slate-500 font-sans block mb-1">الرصيد الدفتري المسجل</span>
            <span className="text-lg font-bold text-slate-800">{metrics.bookBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م</span>
            <p className="text-[11px] text-slate-400 font-sans mt-1">حساب الأستاذ {bankInfo?.account_code}</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
            <span className="text-xs font-medium text-slate-500 font-sans block mb-1">رصيد كشف الحساب البنكي</span>
            <span className="text-lg font-bold text-cyan-800">{metrics.statementBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م</span>
            <p className="text-[11px] text-slate-400 font-sans mt-1">حسب آخر كشف مستورد</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
            <span className="text-xs font-medium text-slate-500 font-sans block mb-1">الرصيدان المعدلان</span>
            <div className="text-xs font-bold text-slate-700">بنك: {metrics.adjustedBankBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م</div>
            <div className="text-xs font-bold text-slate-700">دفتر: {metrics.adjustedBookBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م</div>
          </div>

          <div className={`p-4 rounded-xl border flex flex-col justify-between ${
            metrics.isReconciled ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}>
            <span className="text-xs font-medium font-sans">فارق التسوية النهائي</span>
            <span className="text-2xl font-black">{metrics.variance.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م</span>
            <span className="text-[11px] font-sans font-bold">
              {metrics.isReconciled ? '✓ متطابق تماماً (مكتملة)' : 'يوجد فرق تسوية يحتاج مطابقة'}
            </span>
          </div>
        </div>
      )}

      {/* Auto-match suggestions banner */}
      {suggestions.length > 0 && canMatch && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-blue-900">
                يقترح النظام ({suggestions.length}) مطابقة ذكية استناداً لتطابق المبالغ والمراجع وتواريخ الحركات
              </h4>
              <p className="text-[11px] text-blue-700 mt-0.5">يمكنك اعتماد جميع المطابقات المتطابقة تلقائياً بنقرة واحدة</p>
            </div>
          </div>

          <button
            onClick={handleApplyAllSuggestions}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>تطبيق جميع المطابقات المقترحة</span>
          </button>
        </div>
      )}

      {/* Manual Matching Action Bar (When one item from each side is selected) */}
      {selectedStatementLineId && selectedBookTxId && canMatch && (
        <div className="p-3.5 rounded-xl bg-purple-600 text-white shadow-lg flex items-center justify-between animate-in fade-in">
          <div className="text-xs font-bold flex items-center gap-2">
            <Link2 className="w-4 h-4" />
            <span>تم تحديد حركة من كشف الحساب وحركة من الدفاتر:</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setSelectedStatementLineId(null); setSelectedBookTxId(null); }}
              className="px-3 py-1 text-xs text-purple-200 hover:text-white"
            >
              إلغاء التحديد
            </button>
            <button
              onClick={() => handleApplyMatch(selectedStatementLineId, selectedBookTxId)}
              className="px-4 py-1.5 bg-white text-purple-900 rounded-lg text-xs font-bold hover:bg-purple-50 transition cursor-pointer"
            >
              ربط ومطابقة الحركتين الآن
            </button>
          </div>
        </div>
      )}

      {/* Side-by-Side Matching Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Bank Statement Lines */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-500"></span>
              حركات كشف الحساب البنكي ({statementLines.length})
            </h3>
            <span className="text-[11px] text-slate-400">
              غير المطابق: {statementLines.filter(s => !s.is_matched).length}
            </span>
          </div>

          <div className="overflow-x-auto max-h-[500px] rounded-xl border border-slate-200">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-bold sticky top-0">
                <tr>
                  <th className="p-2">التاريخ</th>
                  <th className="p-2">البيان / المرجع</th>
                  <th className="p-2 text-end">سحب (مدين)</th>
                  <th className="p-2 text-end">إيداع (دائن)</th>
                  <th className="p-2 text-center">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono-numbers">
                {statementLines.map(s => {
                  const isSelected = selectedStatementLineId === s.id;
                  return (
                    <tr
                      key={s.id}
                      onClick={() => !s.is_matched && canMatch && setSelectedStatementLineId(isSelected ? null : s.id)}
                      className={`transition ${
                        s.is_matched
                          ? 'bg-slate-50/60 opacity-70'
                          : isSelected
                          ? 'bg-purple-50 ring-1 ring-purple-400 cursor-pointer'
                          : canMatch ? 'hover:bg-cyan-50/30 cursor-pointer' : ''
                      }`}
                    >
                      <td className="p-2 text-slate-500 whitespace-nowrap">{s.line_date}</td>
                      <td className="p-2 font-sans text-slate-800">
                        <div className="font-bold text-xs truncate max-w-[180px]">{s.description}</div>
                        {s.reference && <div className="text-[10px] text-slate-400 font-mono">مرجع: {s.reference}</div>}
                      </td>
                      <td className="p-2 text-end font-bold text-rose-700">
                        {s.debit > 0 ? s.debit.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-'}
                      </td>
                      <td className="p-2 text-end font-bold text-emerald-700">
                        {s.credit > 0 ? s.credit.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-'}
                      </td>
                      <td className="p-2 text-center whitespace-nowrap">
                        {s.is_matched ? (
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">مطابق</span>
                            {canMatch && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleUnmatch(s.id); }}
                                className="text-slate-400 hover:text-rose-600 p-1"
                                title="إلغاء المطابقة"
                              >
                                <Unlink className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            {canRecordFees && (
                              <button
                                onClick={(e) => { e.stopPropagation(); openFeeModal(s); }}
                                className="text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 px-1.5 py-0.5 rounded-md border border-blue-200"
                                title="تسجيل قيد مصروفات/عوائد بنكية"
                              >
                                قيد مباشر
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Book Bank Transactions */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              حركات البنك المسجلة بالدفاتر ({bookTransactions.length})
            </h3>
            <span className="text-[11px] text-slate-400">
              غير المطابق: {bookTransactions.filter(b => !b.isMatched).length}
            </span>
          </div>

          <div className="overflow-x-auto max-h-[500px] rounded-xl border border-slate-200">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-bold sticky top-0">
                <tr>
                  <th className="p-2">التاريخ</th>
                  <th className="p-2">المستند / البيان</th>
                  <th className="p-2 text-end">إيداع (مدين)</th>
                  <th className="p-2 text-end">صرف (دائن)</th>
                  <th className="p-2 text-center">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono-numbers">
                {bookTransactions.map(b => {
                  const isSelected = selectedBookTxId === b.id;
                  return (
                    <tr
                      key={b.id}
                      onClick={() => !b.isMatched && setSelectedBookTxId(isSelected ? null : b.id)}
                      className={`transition ${
                        b.isMatched
                          ? 'bg-slate-50/60 opacity-70'
                          : isSelected
                          ? 'bg-purple-50 ring-1 ring-purple-400 cursor-pointer'
                          : 'hover:bg-emerald-50/30 cursor-pointer'
                      }`}
                    >
                      <td className="p-2 text-slate-500 whitespace-nowrap">{b.docDate}</td>
                      <td className="p-2 font-sans text-slate-800">
                        <div className="font-bold text-xs truncate max-w-[180px]">{b.docNumber}</div>
                        <div className="text-[10px] text-slate-500 truncate max-w-[180px]">{b.description}</div>
                      </td>
                      <td className="p-2 text-end font-bold text-emerald-700">
                        {b.debit > 0 ? b.debit.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-'}
                      </td>
                      <td className="p-2 text-end font-bold text-rose-700">
                        {b.credit > 0 ? b.credit.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-'}
                      </td>
                      <td className="p-2 text-center whitespace-nowrap">
                        {b.isMatched ? (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">مطابق</span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">معلق</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Record Bank Fee/Interest Modal */}
      {isFeeModalOpen && feeLine && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center gap-2 text-blue-700 pb-3 border-b border-slate-100">
              <PlusCircle className="w-5 h-5" />
              <h3 className="text-sm font-bold text-slate-900">
                تسجيل قيد تسوية بنكية للحركة ({feeLine.reference || feeLine.id})
              </h3>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1 font-mono-numbers">
              <div>المبلغ: <span className="font-bold text-slate-900">{feeLine.debit > 0 ? feeLine.debit : feeLine.credit} ج.م</span></div>
              <div>النوع: <span className="font-sans font-bold">{feeLine.debit > 0 ? 'مصروف / عمولة بنكية (سحب)' : 'عائد / إيراد فوائد (إيداع)'}</span></div>
              <div>التاريخ: <span>{feeLine.line_date}</span></div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">بيان وشرح القيد:</label>
              <input
                type="text"
                value={feeDesc}
                onChange={(e) => setFeeDesc(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-blue-600"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                disabled={isPostingFee}
                onClick={() => setIsFeeModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                إلغاء
              </button>
              <button
                disabled={isPostingFee}
                onClick={handlePostFee}
                className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition flex items-center gap-1.5"
              >
                {isPostingFee && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>ترحيل القيد ومطابقته آلياً</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
