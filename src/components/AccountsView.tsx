import React, { useState } from 'react';
import {
  FolderTree, Plus, Search, ChevronRight, ChevronDown, CheckCircle2,
  AlertTriangle, ShieldCheck, Edit, Trash2, Power, X
} from 'lucide-react';
import { Account } from '../types';
import { Language, translations } from '../translations';
import { apiClient } from '../services/apiClient';
import { ConfirmModal } from './ConfirmModal';

interface AccountsViewProps {
  accounts: Account[];
  lang: Language;
  onRefresh: () => void;
}

export const AccountsView: React.FC<AccountsViewProps> = ({ accounts, lang, onRefresh }) => {
  const t = translations[lang];
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({
    acc_1: true,
    acc_11: true,
    acc_2: true,
    acc_3: true,
    acc_4: true,
    acc_5: true,
    acc_6: true
  });

  // Add Account Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAccCode, setNewAccCode] = useState('');
  const [newAccNameAr, setNewAccNameAr] = useState('');
  const [newAccNameEn, setNewAccNameEn] = useState('');
  const [newAccParentId, setNewAccParentId] = useState('');
  const [newAccType, setNewAccType] = useState<'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'cogs'>('expense');
  const [newAccNature, setNewAccNature] = useState<'debit' | 'credit'>('debit');
  const [isGroup, setIsGroup] = useState(false);

  // Edit Account Modal
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editNameAr, setEditNameAr] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [editParentId, setEditParentId] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);

  // Delete State
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<Account | null>(null);

  // General Action State
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const toggleExpand = (id: string) => {
    setExpandedNodes(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredAccounts = accounts.filter(acc => {
    const matchesSearch =
      acc.name_ar.includes(searchTerm) ||
      acc.code.includes(searchTerm) ||
      (acc.name_en && acc.name_en.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesType = selectedType === 'all' || acc.account_type === selectedType;
    return matchesSearch && matchesType;
  });

  const formatEGP = (val: number) => {
    return (val || 0).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' ج.م';
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const parentToExpand = newAccParentId;
      const res = await apiClient.post('/accounts', {
        code: newAccCode.trim() || undefined,
        name_ar: newAccNameAr,
        name_en: newAccNameEn || null,
        parent_id: newAccParentId || null,
        account_type: newAccType,
        nature: newAccNature,
        is_group: isGroup ? 1 : 0
      });

      if (parentToExpand) {
        setExpandedNodes(prev => ({ ...prev, [parentToExpand]: true }));
      }

      setShowAddModal(false);
      setNewAccCode('');
      setNewAccNameAr('');
      setNewAccNameEn('');
      setNewAccParentId('');
      setSuccessMsg(res.message || (res.code ? `تمت إضافة الحساب "${newAccNameAr}" برقم (${res.code}) بنجاح.` : 'تمت إضافة الحساب بنجاح.'));
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'حدث خطأ أثناء حفظ الحساب');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenEdit = (acc: Account) => {
    setEditingAccount(acc);
    setEditNameAr(acc.name_ar);
    setEditNameEn(acc.name_en || '');
    setEditParentId(acc.parent_id || '');
    setEditIsActive(acc.is_active !== 0);
    setErrorMsg('');
  };

  const handleUpdateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;

    setSaving(true);
    setErrorMsg('');

    try {
      await apiClient.put(`/accounts/${editingAccount.id}`, {
        name_ar: editNameAr,
        name_en: editNameEn || null,
        parent_id: editParentId || null,
        is_active: editIsActive
      });

      setEditingAccount(null);
      setSuccessMsg(`تم تحديث الحساب "${editNameAr}" بنجاح.`);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل تحديث بيانات الحساب');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingAccount) return;
    setIsDeleting(true);
    setErrorMsg('');

    try {
      await apiClient.del(`/accounts/${deletingAccount.id}`);
      setSuccessMsg(`تم حذف الحساب "${deletingAccount.name_ar}" بنجاح.`);
      setDeletingAccount(null);
      onRefresh();
    } catch (err: any) {
      setDeactivateTarget(deletingAccount);
      setDeletingAccount(null);
      setErrorMsg(err.message || 'تعذر حذف الحساب لوجود قيود مرحلة أو حسابات فرعية مرتبطة به.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeactivateAccount = async (acc: Account) => {
    try {
      await apiClient.put(`/accounts/${acc.id}`, { is_active: false });
      setSuccessMsg(`تم تعطيل الحساب "${acc.name_ar}" بنجاح.`);
      setDeactivateTarget(null);
      setErrorMsg('');
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل تعطيل الحساب.');
    }
  };

  const handleToggleActive = async (acc: Account) => {
    try {
      const nextActive = acc.is_active === 0;
      await apiClient.put(`/accounts/${acc.id}`, { is_active: nextActive });
      setSuccessMsg(`تم ${nextActive ? 'تفعيل' : 'تعطيل'} الحساب "${acc.name_ar}" بنجاح.`);
      setErrorMsg('');
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل تغيير حالة تفعيل الحساب.');
    }
  };

  const getAccountTypeBadge = (type: string) => {
    switch (type) {
      case 'asset': return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">أصل</span>;
      case 'liability': return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">التزام</span>;
      case 'equity': return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-800">حقوق ملكية</span>;
      case 'revenue': return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-800">إيراد</span>;
      case 'cogs': return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-800">تكلفة مبيعات</span>;
      case 'expense': return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800">مصروف</span>;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <FolderTree className="w-5 h-5 text-emerald-600" />
            {t.chartOfAccounts} (شجرة الحسابات المصرية الموحدة)
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            دليل محاسبي هرمي متعدد المستويات (أصول، التزامات، حقوق ملكية، إيرادات، تكاليف، مصروفات) مع حظر الترحيل على الحسابات التجميعية.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm flex items-center gap-2 transition-colors self-start md:self-auto"
        >
          <Plus className="w-4 h-4" />
          إضافة حساب جديد
        </button>
      </div>

      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs space-y-2">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg('')} className="text-rose-600 hover:text-rose-800 p-1">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {deactivateTarget && (
            <div className="pt-2 border-t border-rose-200 flex items-center gap-2">
              <button
                onClick={() => handleDeactivateAccount(deactivateTarget)}
                className="px-3 py-1.5 bg-rose-700 hover:bg-rose-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Power className="w-3.5 h-3.5" />
                <span>تعطيل الحساب ({deactivateTarget.code} - {deactivateTarget.name_ar}) بدلاً من الحذف</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Filter and Search */}
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute start-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="بحث برقم الحساب أو الاسم بالعربية/الإنجليزية..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full ps-9 pe-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500 bg-slate-50"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 text-xs">
          <button
            onClick={() => setSelectedType('all')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition-colors ${
              selectedType === 'all'
                ? 'bg-slate-900 text-white font-semibold'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            الكل ({accounts.length})
          </button>
          <button
            onClick={() => setSelectedType('asset')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition-colors ${
              selectedType === 'asset'
                ? 'bg-emerald-700 text-white font-semibold'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            الأصول
          </button>
          <button
            onClick={() => setSelectedType('liability')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition-colors ${
              selectedType === 'liability'
                ? 'bg-amber-700 text-white font-semibold'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            الالتزامات
          </button>
          <button
            onClick={() => setSelectedType('equity')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition-colors ${
              selectedType === 'equity'
                ? 'bg-indigo-700 text-white font-semibold'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            حقوق الملكية
          </button>
          <button
            onClick={() => setSelectedType('revenue')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition-colors ${
              selectedType === 'revenue'
                ? 'bg-sky-700 text-white font-semibold'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            الإيرادات
          </button>
          <button
            onClick={() => setSelectedType('cogs')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition-colors ${
              selectedType === 'cogs'
                ? 'bg-purple-700 text-white font-semibold'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            تكلفة المبيعات
          </button>
          <button
            onClick={() => setSelectedType('expense')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition-colors ${
              selectedType === 'expense'
                ? 'bg-rose-700 text-white font-semibold'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            المصروفات
          </button>
        </div>
      </div>

      {/* Accounts Tree Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-xs text-start">
          <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-start">رقم الحساب (الكود)</th>
              <th className="px-4 py-3 text-start">اسم الحساب</th>
              <th className="px-4 py-3 text-center">التصنيف</th>
              <th className="px-4 py-3 text-center">طبيعة الحساب</th>
              <th className="px-4 py-3 text-center">نوع الاستخدام</th>
              <th className="px-4 py-3 text-center">الحالة</th>
              <th className="px-4 py-3 text-end">الرصيد المحاسبي</th>
              <th className="px-4 py-3 text-center">{t.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredAccounts.map((acc) => {
              const hasChildren = accounts.some(a => a.parent_id === acc.id);
              const isParent = acc.is_group === 1 || hasChildren;
              const indentLevel = Math.max((acc.level || 1) - 1, 0);

              return (
                <tr key={acc.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-slate-800">
                    <span
                      style={{ marginInlineStart: `${indentLevel * 18}px` }}
                      className="inline-flex items-center gap-1.5 font-bold"
                    >
                      {hasChildren ? (
                        <button
                          onClick={() => toggleExpand(acc.id)}
                          className="p-0.5 hover:bg-slate-200 rounded text-slate-500"
                        >
                          {expandedNodes[acc.id] ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </button>
                      ) : (
                        <span className="w-3.5 h-3.5 inline-block text-slate-300">↳</span>
                      )}
                      <span className={acc.is_active === 0 ? 'text-slate-400 line-through' : ''}>{acc.code}</span>
                    </span>
                  </td>

                  <td className="px-4 py-2.5 text-slate-900">
                    <div className={`font-medium ${acc.is_active === 0 ? 'text-slate-400' : 'text-slate-900'}`}>{acc.name_ar}</div>
                    {acc.name_en && (
                      <div className="text-[10px] text-slate-400 font-sans">{acc.name_en}</div>
                    )}
                  </td>

                  <td className="px-4 py-2.5 text-center">
                    {getAccountTypeBadge(acc.account_type)}
                  </td>

                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                      acc.nature === 'debit' ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {acc.nature === 'debit' ? 'مدين' : 'دائن'}
                    </span>
                  </td>

                  <td className="px-4 py-2.5 text-center">
                    {isParent ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-200 text-slate-700" title="ممنوع الترحيل للحسابات التجميعية">
                        حساب رئيسي (تجميعي)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center gap-1 mx-auto max-w-[110px]">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        حساب ترحيل
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => handleToggleActive(acc)}
                      title={acc.is_active === 0 ? 'الحساب معطل - انقر للتفعيل' : 'الحساب نشط - انقر للتعطيل'}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center justify-center gap-1 mx-auto transition ${
                        acc.is_active === 0 ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                      }`}
                    >
                      <Power className="w-3 h-3" />
                      <span>{acc.is_active === 0 ? 'معطل' : 'نشط'}</span>
                    </button>
                  </td>

                  <td className="px-4 py-2.5 text-end font-mono-numbers font-bold text-slate-900">
                    {formatEGP(acc.current_balance)}
                  </td>

                  <td className="px-4 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => handleOpenEdit(acc)}
                        className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-slate-100 rounded transition"
                        title="تعديل بيانات الحساب"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => setDeletingAccount(acc)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                        title="حذف الحساب"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add Sub-Account Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-600" />
                إضافة حساب جديد إلى دليل الحسابات
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleCreateAccount} className="space-y-3 text-xs">
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <div className="flex items-center justify-between mb-1">
                  <label className="font-medium text-slate-700">كود الحساب (اختياري)</label>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    «يُولّد الكود تلقائيًا عند الحفظ»
                  </span>
                </div>
                <input
                  type="text"
                  value={newAccCode}
                  onChange={(e) => setNewAccCode(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500 font-mono bg-white"
                  placeholder="اتركه فارغاً للتوليد التلقائي الهرمي الذكي، أو أدخل كوداً مخصصاً"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">اسم الحساب بالعربية *</label>
                <input
                  type="text"
                  required
                  value={newAccNameAr}
                  onChange={(e) => setNewAccNameAr(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                  placeholder="مصروفات اشتراكات برمجيات وسحابة"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">اسم الحساب بالإنجليزية (اختياري)</label>
                <input
                  type="text"
                  value={newAccNameEn}
                  onChange={(e) => setNewAccNameEn(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                  placeholder="Software & Cloud Subscriptions Expense"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">الحساب الرئيسي (الأصل التجميعي)</label>
                <select
                  value={newAccParentId}
                  onChange={(e) => {
                    setNewAccParentId(e.target.value);
                    const p = accounts.find(a => a.id === e.target.value);
                    if (p) {
                      setNewAccType(p.account_type as any);
                      setNewAccNature(p.nature as any);
                    }
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                >
                  <option value="">بدون حساب رئيسي (حساب مستوى أول)</option>
                  {accounts.filter(a => a.is_group === 1).map(p => (
                    <option key={p.id} value={p.id}>{p.code} - {p.name_ar}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">نوع الحساب</label>
                  <select
                    value={newAccType}
                    onChange={(e) => setNewAccType(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                  >
                    <option value="asset">أصل (Asset)</option>
                    <option value="liability">التزام (Liability)</option>
                    <option value="equity">حقوق ملكية (Equity)</option>
                    <option value="revenue">إيراد (Revenue)</option>
                    <option value="cogs">تكلفة مبيعات (COGS)</option>
                    <option value="expense">مصروف (Expense)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">طبيعة الحساب</label>
                  <select
                    value={newAccNature}
                    onChange={(e) => setNewAccNature(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                  >
                    <option value="debit">مدين بطبيعته (Debit)</option>
                    <option value="credit">دائن بطبيعته (Credit)</option>
                  </select>
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isGroup}
                    onChange={(e) => setIsGroup(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded"
                  />
                  <span className="font-semibold text-slate-700">حساب تجميعي رئيسي (لا يقبل الترحيل المباشر)</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100 mt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold"
                >
                  {saving ? 'جارٍ الحفظ...' : 'حفظ الحساب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Account Modal */}
      {editingAccount && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Edit className="w-4 h-4 text-emerald-600" />
                تعديل الحساب: {editingAccount.code}
              </h3>
              <button onClick={() => setEditingAccount(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleUpdateAccount} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">اسم الحساب بالعربية *</label>
                <input
                  type="text"
                  required
                  value={editNameAr}
                  onChange={(e) => setEditNameAr(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">اسم الحساب بالإنجليزية</label>
                <input
                  type="text"
                  value={editNameEn}
                  onChange={(e) => setEditNameEn(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">الحساب الرئيسي التابع له</label>
                <select
                  value={editParentId}
                  onChange={(e) => setEditParentId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                >
                  <option value="">بدون حساب رئيسي</option>
                  {accounts.filter(a => a.is_group === 1 && a.id !== editingAccount.id).map(p => (
                    <option key={p.id} value={p.id}>{p.code} - {p.name_ar}</option>
                  ))}
                </select>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editIsActive}
                    onChange={(e) => setEditIsActive(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded"
                  />
                  <span className="font-semibold text-slate-700">الحساب نشط ويقبل العمليات المحاسبية</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100 mt-4">
                <button
                  type="button"
                  onClick={() => setEditingAccount(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold"
                >
                  {saving ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deletingAccount}
        title="تأكيد حذف الحساب من شجرة الحسابات"
        message={`هل تريد حذف الحساب "${deletingAccount?.code} - ${deletingAccount?.name_ar}" نهائياً من دليل الحسابات؟`}
        warning="سيمنع النظام الحذف تلقائياً إذا كانت هناك قيود مرحلة أو حسابات فرعية منبثقة منه، مع إمكانية التعطيل بدلاً من الحذف."
        confirmLabel="نعم، حذف نهائي"
        cancelLabel="إلغاء"
        confirmVariant="danger"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingAccount(null)}
      />
    </div>
  );
};
