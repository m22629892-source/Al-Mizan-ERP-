import React, { useState, useEffect } from 'react';
import {
  BookOpenCheck, Plus, Search, RotateCcw, Eye, AlertCircle, CheckCircle,
  FileText, ArrowRightLeft, Edit, Trash2, Send, X, AlertTriangle
} from 'lucide-react';
import { JournalEntry, Account, Branch } from '../types';
import { Language, translations } from '../translations';
import { apiClient } from '../services/apiClient';
import { ConfirmModal } from './ConfirmModal';

interface JournalEntriesViewProps {
  entries: JournalEntry[];
  accounts: Account[];
  branches: Branch[];
  lang: Language;
  onRefresh: () => void;
}

export const JournalEntriesView: React.FC<JournalEntriesViewProps> = ({
  entries,
  accounts,
  branches,
  lang,
  onRefresh
}) => {
  const t = translations[lang];
  const [searchTerm, setSearchTerm] = useState('');
  const [activeStatusTab, setActiveStatusTab] = useState<'all' | 'posted' | 'draft' | 'reversed'>('all');
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);

  // New Journal Entry Modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0]);
  const [branchId, setBranchId] = useState(branches[0]?.id || 'br_cairo');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState([
    { accountId: '', debit: '', credit: '', description: '' },
    { accountId: '', debit: '', credit: '', description: '' }
  ]);

  // Edit Draft Modal
  const [editingDraft, setEditingDraft] = useState<JournalEntry | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editBranchId, setEditBranchId] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editLines, setEditLines] = useState<any[]>([]);

  // Reverse Modal
  const [showReverseModal, setShowReverseModal] = useState(false);
  const [reverseReason, setReverseReason] = useState('');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Confirmation Modals State
  const [deletingDraft, setDeletingDraft] = useState<JournalEntry | null>(null);
  const [postingDraft, setPostingDraft] = useState<JournalEntry | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const nonGroupAccounts = accounts.filter(a => a.is_group === 0 && a.is_active !== 0);

  const formatEGP = (val: number) => {
    return (val || 0).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' ج.م';
  };

  const calculateDebitSum = (targetLines: any[]) => {
    return targetLines.reduce((acc, l) => acc + (parseFloat(l.debit) || 0), 0);
  };
  const calculateCreditSum = (targetLines: any[]) => {
    return targetLines.reduce((acc, l) => acc + (parseFloat(l.credit) || 0), 0);
  };

  const newDebitSum = calculateDebitSum(lines);
  const newCreditSum = calculateCreditSum(lines);
  const newDiff = Math.abs(newDebitSum - newCreditSum);
  const isNewBalanced = newDiff < 0.001 && newDebitSum > 0;

  const handleAddLine = () => {
    setLines([...lines, { accountId: '', debit: '', credit: '', description: '' }]);
  };

  const handleRemoveLine = (idx: number) => {
    if (lines.length <= 2) return;
    setLines(lines.filter((_, i) => i !== idx));
  };

  const handleLineChange = (index: number, field: string, value: string) => {
    const updated = [...lines];
    (updated[index] as any)[field] = value;
    if (field === 'debit' && value) {
      updated[index].credit = '';
    } else if (field === 'credit' && value) {
      updated[index].debit = '';
    }
    setLines(updated);
  };

  // Create Entry (Draft or Post)
  const handleSaveEntry = async (asDraft: boolean) => {
    if (!asDraft && !isNewBalanced) {
      setErrorMsg('لا يمكن ترحيل قيد غير متوازن!');
      return;
    }

    setSaving(true);
    setErrorMsg('');

    try {
      await apiClient.post('/journal-entries', {
        docType: 'MANUAL',
        entryDate,
        postingDate: entryDate,
        branchId,
        description,
        status: asDraft ? 'draft' : 'posted',
        lines: lines.map(l => ({
          accountId: l.accountId,
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
          description: l.description || description
        }))
      });

      setShowNewModal(false);
      setDescription('');
      setLines([
        { accountId: '', debit: '', credit: '', description: '' },
        { accountId: '', debit: '', credit: '', description: '' }
      ]);
      setSuccessMsg(asDraft ? 'تم حفظ مسودة القيد بنجاح.' : 'تم ترحيل واعتماد القيد بنجاح.');
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل حفظ القيد');
    } finally {
      setSaving(false);
    }
  };

  // Open Edit Draft
  const handleOpenEditDraft = async (entry: JournalEntry) => {
    try {
      const data = await apiClient.get(`/journal-entries/${entry.id}`);
      const ent = data.entry;
      setEditingDraft(ent);
      setEditDate(ent.entry_date);
      setEditBranchId(ent.branch_id);
      setEditDescription(ent.description);
      setEditLines(
        (ent.lines || []).map((l: any) => ({
          accountId: l.account_id,
          debit: l.debit ? l.debit.toString() : '',
          credit: l.credit ? l.credit.toString() : '',
          description: l.description || ''
        }))
      );
      setErrorMsg('');
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل جلب تفاصيل المسودة');
    }
  };

  // Update Draft Submit
  const handleUpdateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDraft) return;

    setSaving(true);
    setErrorMsg('');

    try {
      await apiClient.put(`/journal-entries/${editingDraft.id}`, {
        entryDate: editDate,
        branchId: editBranchId,
        description: editDescription,
        lines: editLines.map(l => ({
          accountId: l.accountId,
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
          description: l.description || editDescription
        }))
      });

      setEditingDraft(null);
      setSuccessMsg('تم تحديث مسودة القيد بنجاح.');
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل تحديث المسودة');
    } finally {
      setSaving(false);
    }
  };

  // Delete Draft
  const handleConfirmDeleteDraft = async () => {
    if (!deletingDraft) return;
    setIsActionLoading(true);
    setErrorMsg('');

    try {
      await apiClient.del(`/journal-entries/${deletingDraft.id}`);
      setSuccessMsg(`تم حذف مسودة القيد "${deletingDraft.entry_number}" بنجاح.`);
      setDeletingDraft(null);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل حذف المسودة');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Post Draft
  const handleConfirmPostDraft = async () => {
    if (!postingDraft) return;
    setIsActionLoading(true);
    setErrorMsg('');

    try {
      await apiClient.post(`/journal-entries/${postingDraft.id}/post`);
      setSuccessMsg(`تم ترحيل واعتماد القيد "${postingDraft.entry_number}" بنجاح.`);
      setPostingDraft(null);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل ترحيل القيد');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Reverse Entry
  const handleReverseEntry = async () => {
    if (!selectedEntry || !reverseReason) return;
    setSaving(true);
    setErrorMsg('');

    try {
      await apiClient.post(`/journal-entries/${selectedEntry.id}/reverse`, {
        reason: reverseReason
      });

      setShowReverseModal(false);
      setReverseReason('');
      setSelectedEntry(null);
      setSuccessMsg('تم إنشاء القيد العكسي التصحيحي بنجاح.');
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل عكس القيد');
    } finally {
      setSaving(false);
    }
  };

  const loadEntryDetails = async (entry: JournalEntry) => {
    try {
      const data = await apiClient.get(`/journal-entries/${entry.id}`);
      if (data.entry) {
        setSelectedEntry(data.entry);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل جلب تفاصيل القيد');
    }
  };

  const filteredEntries = entries.filter(e => {
    const matchesStatus =
      activeStatusTab === 'all' ||
      (activeStatusTab === 'posted' && e.status === 'posted') ||
      (activeStatusTab === 'draft' && e.status === 'draft') ||
      (activeStatusTab === 'reversed' && e.status === 'reversed');

    const matchesSearch =
      e.entry_number.includes(searchTerm) ||
      e.description.includes(searchTerm) ||
      (e.doc_type && e.doc_type.includes(searchTerm));

    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <BookOpenCheck className="w-5 h-5 text-emerald-600" />
            {t.journalEntries} ومحرك القيود المركزية
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            دورة حياة القيود: مسودة (Draft) قابلة للتعديل والحذف ← قيد مرحل معتمد (Posted) غير قابل للتعديل المباشر ← عكس القيد (Reversal) بأثر محاسبي وتدقيقي كامل.
          </p>
        </div>

        <button
          onClick={() => {
            setShowNewModal(true);
            setErrorMsg('');
          }}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm flex items-center gap-2 transition-colors self-start md:self-auto"
        >
          <Plus className="w-4 h-4" />
          قيد يومية يدوي جديد
        </button>
      </div>

      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filter and Status Tabs */}
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex bg-slate-100 p-1 rounded-lg w-full sm:w-auto">
          <button
            onClick={() => setActiveStatusTab('all')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${
              activeStatusTab === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            الكل ({entries.length})
          </button>
          <button
            onClick={() => setActiveStatusTab('posted')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${
              activeStatusTab === 'posted' ? 'bg-white text-emerald-800 shadow-xs' : 'text-slate-600'
            }`}
          >
            مرحلة ({entries.filter(e => e.status === 'posted').length})
          </button>
          <button
            onClick={() => setActiveStatusTab('draft')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${
              activeStatusTab === 'draft' ? 'bg-white text-amber-800 shadow-xs' : 'text-slate-600'
            }`}
          >
            مسودات ({entries.filter(e => e.status === 'draft').length})
          </button>
          <button
            onClick={() => setActiveStatusTab('reversed')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${
              activeStatusTab === 'reversed' ? 'bg-white text-rose-800 shadow-xs' : 'text-slate-600'
            }`}
          >
            معكوسة ({entries.filter(e => e.status === 'reversed').length})
          </button>
        </div>

        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute start-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="بحث برقم القيد أو البيان..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full ps-9 pe-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500 bg-slate-50"
          />
        </div>
      </div>

      {/* Journal Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-xs text-start">
          <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-start">رقم القيد</th>
              <th className="px-4 py-3 text-start">تاريخ القيد</th>
              <th className="px-4 py-3 text-start">نوع المستند</th>
              <th className="px-4 py-3 text-start">البيان والشرح</th>
              <th className="px-4 py-3 text-start">الفرع</th>
              <th className="px-4 py-3 text-end">إجمالي المدين</th>
              <th className="px-4 py-3 text-end">إجمالي الدائن</th>
              <th className="px-4 py-3 text-center">الحالة</th>
              <th className="px-4 py-3 text-center">{t.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredEntries.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50/80 transition-colors">
                <td className="px-4 py-2.5 font-mono font-bold text-emerald-800">{e.entry_number}</td>
                <td className="px-4 py-2.5 text-slate-600 font-mono">{e.entry_date}</td>
                <td className="px-4 py-2.5">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-100 text-slate-700">
                    {e.doc_type}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-slate-800 font-medium max-w-[240px] truncate" title={e.description}>
                  {e.description}
                </td>
                <td className="px-4 py-2.5 text-slate-600">{e.branch_name}</td>
                <td className="px-4 py-2.5 text-end font-mono-numbers font-semibold text-slate-900">{formatEGP(e.total_debit)}</td>
                <td className="px-4 py-2.5 text-end font-mono-numbers font-semibold text-slate-900">{formatEGP(e.total_credit)}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    e.status === 'draft'
                      ? 'bg-amber-100 text-amber-800 border border-amber-200'
                      : e.status === 'reversed'
                      ? 'bg-rose-100 text-rose-800 border border-rose-200'
                      : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                  }`}>
                    {e.status === 'draft' ? 'مسودة' : e.status === 'reversed' ? 'معكوس' : 'مرحل'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <button
                      onClick={() => loadEntryDetails(e)}
                      className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-slate-100 rounded transition"
                      title="عرض أطراف وبنود القيد"
                    >
                      <Eye className="w-4 h-4" />
                    </button>

                    {e.status === 'draft' && (
                      <>
                        <button
                          onClick={() => handleOpenEditDraft(e)}
                          className="p-1.5 text-amber-700 hover:bg-amber-50 rounded transition"
                          title="تعديل المسودة"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setPostingDraft(e)}
                          className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded transition"
                          title="اعتماد وترحيل المسودة"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeletingDraft(e)}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded transition"
                          title="حذف المسودة"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}

                    {e.status === 'posted' && (
                      <button
                        onClick={() => {
                          setSelectedEntry(e);
                          setShowReverseModal(true);
                          setReverseReason('');
                          setErrorMsg('');
                        }}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                        title="عكس القيد محاسبياً"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New Journal Entry Modal (Allows Draft or Immediate Post) */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full p-6 border border-slate-200 max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4 shrink-0">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-600" />
                إنشاء قيد يومية يدوي جديد
              </h3>
              <button onClick={() => setShowNewModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs shrink-0 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="space-y-4 flex-1 overflow-y-auto text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">تاريخ القيد *</label>
                  <input
                    type="date"
                    required
                    value={entryDate}
                    onChange={e => setEntryDate(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">الفرع *</label>
                  <select
                    value={branchId}
                    onChange={e => setBranchId(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded"
                  >
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name_ar}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">البيان والشرح العام للقيد *</label>
                  <input
                    type="text"
                    required
                    placeholder="مثال: قيد تسوية مصاريف استضافة وصيانة برمجية"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
              </div>

              {/* Lines Table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs text-start">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5 text-start w-1/3">الحساب المحاسبي (حساب ترحيل غير تجميعي)</th>
                      <th className="p-2.5 text-end w-28">مدين (ج.م)</th>
                      <th className="p-2.5 text-end w-28">دائن (ج.م)</th>
                      <th className="p-2.5 text-start">بيان السطر (اختياري)</th>
                      <th className="p-2.5 text-center w-12">-</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((line, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="p-2">
                          <select
                            required
                            value={line.accountId}
                            onChange={e => handleLineChange(idx, 'accountId', e.target.value)}
                            className="w-full p-1.5 border border-slate-300 rounded font-sans"
                          >
                            <option value="">اختر الحساب من الدليل...</option>
                            {nonGroupAccounts.map(a => (
                              <option key={a.id} value={a.id}>{a.code} - {a.name_ar}</option>
                            ))}
                          </select>
                        </td>

                        <td className="p-2">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={line.debit}
                            onChange={e => handleLineChange(idx, 'debit', e.target.value)}
                            className="w-full p-1.5 border border-slate-300 rounded font-mono text-end"
                          />
                        </td>

                        <td className="p-2">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={line.credit}
                            onChange={e => handleLineChange(idx, 'credit', e.target.value)}
                            className="w-full p-1.5 border border-slate-300 rounded font-mono text-end"
                          />
                        </td>

                        <td className="p-2">
                          <input
                            type="text"
                            placeholder="بيان خاص بالسطر..."
                            value={line.description}
                            onChange={e => handleLineChange(idx, 'description', e.target.value)}
                            className="w-full p-1.5 border border-slate-300 rounded"
                          />
                        </td>

                        <td className="p-2 text-center">
                          {lines.length > 2 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveLine(idx)}
                              className="text-slate-400 hover:text-rose-600 p-1"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleAddLine}
                  className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-100 flex items-center gap-1 font-semibold"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-600" />
                  <span>إضافة سطر قيد</span>
                </button>

                {/* Balance validation badges */}
                <div className="flex items-center gap-4 p-2 bg-slate-50 border border-slate-200 rounded font-mono">
                  <span>إجمالي المدين: <b className="text-slate-800">{formatEGP(newDebitSum)}</b></span>
                  <span>إجمالي الدائن: <b className="text-slate-800">{formatEGP(newCreditSum)}</b></span>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    isNewBalanced ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                  }`}>
                    {isNewBalanced ? 'متوازن (موافق)' : `فارق: ${formatEGP(newDiff)}`}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-200 mt-4 shrink-0">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-xs"
              >
                إلغاء
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={() => handleSaveEntry(true)}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-xs transition"
              >
                {saving ? 'جارٍ الحفظ...' : 'حفظ كمسودة (Draft)'}
              </button>

              <button
                type="button"
                disabled={saving || !isNewBalanced}
                onClick={() => handleSaveEntry(false)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs transition disabled:opacity-50"
              >
                {saving ? 'جارٍ الترحيل...' : 'ترحيل واعتماد فوري (Post)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reverse Modal */}
      {showReverseModal && selectedEntry && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-2 flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-rose-600" />
              عكس القيد اليومي: {selectedEntry.entry_number}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              بموجب المعايير المحاسبية، يتم عكس أطراف القيد آلياً بقيد تصحيحي جديد، وتثبيت حالة القيد الأصلي إلى (معكوس) مع الحفاظ على الأثر التاريخي.
            </p>

            {errorMsg && (
              <div className="p-3 mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {errorMsg}
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">سبب العكس المحاسبي *</label>
                <textarea
                  required
                  rows={3}
                  placeholder="مثال: تصحيح خطأ في توجيه مركز التكلفة أو تسوية حساب خاطئ"
                  value={reverseReason}
                  onChange={e => setReverseReason(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded focus:outline-none focus:border-emerald-500"
                ></textarea>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowReverseModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={saving || !reverseReason.trim()}
                  onClick={handleReverseEntry}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold"
                >
                  {saving ? 'جارٍ العكس...' : 'تأكيد عكس القيد'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Entry Details Modal */}
      {selectedEntry && !showReverseModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <div>
                <span className="text-[10px] font-mono text-emerald-600 font-bold uppercase">JOURNAL ENTRY DETAILS</span>
                <h3 className="text-base font-bold text-slate-900">
                  قيد يومية رقم: {selectedEntry.entry_number}
                </h3>
              </div>
              <button onClick={() => setSelectedEntry(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs mb-4">
              <div>
                <span className="text-slate-400 block">التاريخ:</span>
                <span className="font-semibold font-mono text-slate-800">{selectedEntry.entry_date}</span>
              </div>
              <div>
                <span className="text-slate-400 block">نوع المستند:</span>
                <span className="font-semibold font-mono text-slate-800">{selectedEntry.doc_type}</span>
              </div>
              <div>
                <span className="text-slate-400 block">الفرع:</span>
                <span className="font-semibold text-slate-800">{selectedEntry.branch_name}</span>
              </div>
              <div>
                <span className="text-slate-400 block">الحالة:</span>
                <span className="font-bold text-emerald-700">{selectedEntry.status}</span>
              </div>
              <div className="col-span-2 sm:col-span-4">
                <span className="text-slate-400 block">البيان والشرح:</span>
                <span className="text-slate-800">{selectedEntry.description}</span>
              </div>
            </div>

            {/* Lines */}
            <table className="w-full text-xs text-start border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-2.5 text-start">الحساب المحاسبي</th>
                  <th className="p-2.5 text-start">الطرف التجاري</th>
                  <th className="p-2.5 text-start">البيان</th>
                  <th className="p-2.5 text-end">مدين (ج.م)</th>
                  <th className="p-2.5 text-end">دائن (ج.م)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(selectedEntry.lines || []).map((l: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="p-2 font-mono font-medium text-slate-900">
                      {l.account_code} - {l.account_name}
                    </td>
                    <td className="p-2 text-slate-600">{l.party_name || '-'}</td>
                    <td className="p-2 text-slate-700">{l.description || selectedEntry.description}</td>
                    <td className="p-2 text-end font-mono text-slate-900">
                      {l.debit > 0 ? formatEGP(l.debit) : '-'}
                    </td>
                    <td className="p-2 text-end font-mono text-slate-900">
                      {l.credit > 0 ? formatEGP(l.credit) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-bold border-t border-slate-200">
                <tr>
                  <td colSpan={3} className="p-2.5 text-start text-slate-700">المجموع المتوازن</td>
                  <td className="p-2.5 text-end font-mono text-emerald-800">{formatEGP(selectedEntry.total_debit)}</td>
                  <td className="p-2.5 text-end font-mono text-emerald-800">{formatEGP(selectedEntry.total_credit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Delete Draft Confirm Modal */}
      <ConfirmModal
        isOpen={!!deletingDraft}
        title="تأكيد حذف مسودة القيد اليومي"
        message={`هل أنت متأكد من حذف مسودة القيد اليومي رقم "${deletingDraft?.entry_number}"؟`}
        warning="لا تؤثر مسودة القيد المحذوفة على أي أرصدة في دفتر الأستاذ أو كشوف الحسابات."
        confirmLabel="نعم، حذف المسودة"
        cancelLabel="إلغاء"
        confirmVariant="danger"
        isLoading={isActionLoading}
        onConfirm={handleConfirmDeleteDraft}
        onCancel={() => setDeletingDraft(null)}
      />

      {/* Post Draft Confirm Modal */}
      <ConfirmModal
        isOpen={!!postingDraft}
        title="تأكيد اعتماد وترحيل القيد اليومي"
        message={`هل تريد ترحيل واعتماد مسودة القيد رقم "${postingDraft?.entry_number}" إلى دفتر الأستاذ العام؟`}
        warning="الترحيل نهائي وسيتم تحديث أرصدة الحسابات وميزان المراجعة ولا يمكن حذف القيد بعد ترحيله إلا بقيد عكسي."
        confirmLabel="نعم، اعتماد وترحيل"
        cancelLabel="إلغاء"
        confirmVariant="primary"
        isLoading={isActionLoading}
        onConfirm={handleConfirmPostDraft}
        onCancel={() => setPostingDraft(null)}
      />
    </div>
  );
};
