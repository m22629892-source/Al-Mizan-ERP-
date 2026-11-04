import React, { useState } from 'react';
import {
  Users, Plus, Search, FileText, Phone, MapPin, Building,
  ShieldCheck, AlertCircle, Calendar, Printer, Download, Filter, X,
  Edit, Trash2, Power, CheckCircle2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Party } from '../types';
import { Language, translations } from '../translations';
import { apiClient } from '../services/apiClient';
import { ConfirmModal } from './ConfirmModal';

interface PartiesViewProps {
  parties: Party[];
  lang: Language;
  onRefresh: () => void;
}

export const PartiesView: React.FC<PartiesViewProps> = ({ parties, lang, onRefresh }) => {
  const t = translations[lang];
  const [activeTab, setActiveTab] = useState<'customer' | 'supplier'>('customer');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Statement State
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);
  const [statementData, setStatementData] = useState<any>(null);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [stmtFromDate, setStmtFromDate] = useState('2026-01-01');
  const [stmtToDate, setStmtToDate] = useState('2026-12-31');
  const [stmtBranchId, setStmtBranchId] = useState('all');

  // Add Party Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [partyTypeSelection, setPartyTypeSelection] = useState<'customer' | 'supplier'>(activeTab);
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [taxId, setTaxId] = useState('');
  const [regNo, setRegNo] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('القاهرة');
  const [creditLimit, setCreditLimit] = useState('100000');
  const [termsDays, setTermsDays] = useState('30');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Edit Party Modal State
  const [editingParty, setEditingParty] = useState<Party | null>(null);
  const [editType, setEditType] = useState<'customer' | 'supplier'>('customer');
  const [editNameAr, setEditNameAr] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [editTaxId, setEditTaxId] = useState('');
  const [editRegNo, setEditRegNo] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editCity, setEditCity] = useState('القاهرة');
  const [editCreditLimit, setEditCreditLimit] = useState('0');
  const [editTermsDays, setEditTermsDays] = useState('0');
  const [editIsActive, setEditIsActive] = useState(true);

  // Tab switch suggestion banner
  const [pendingTabSwitch, setPendingTabSwitch] = useState<{ targetTab: 'customer' | 'supplier'; label: string } | null>(null);

  // Delete State
  const [deletingParty, setDeletingParty] = useState<Party | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<Party | null>(null);

  const formatEGP = (val: number) => {
    return (val || 0).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' ج.م';
  };

  const filteredParties = parties.filter(p => {
    const isMatchingType = p.type === activeTab || p.type === 'both';
    const matchesSearch =
      p.name_ar.includes(searchTerm) ||
      p.code.includes(searchTerm) ||
      (p.tax_id && p.tax_id.includes(searchTerm)) ||
      (p.phone && p.phone.includes(searchTerm));
    return isMatchingType && matchesSearch;
  });

  const handleOpenAddModal = () => {
    setPartyTypeSelection(activeTab);
    setNameAr('');
    setNameEn('');
    setTaxId('');
    setRegNo('');
    setPhone('');
    setAddress('');
    setCity('القاهرة');
    setCreditLimit('100000');
    setTermsDays('30');
    setErrorMsg('');
    setShowAddModal(true);
  };

  const handleOpenEdit = (p: Party) => {
    setEditingParty(p);
    setEditType(p.type === 'supplier' ? 'supplier' : 'customer');
    setEditNameAr(p.name_ar);
    setEditNameEn(p.name_en || '');
    setEditTaxId(p.tax_id || '');
    setEditRegNo(p.commercial_registry || '');
    setEditPhone(p.phone || '');
    setEditAddress(p.address || '');
    setEditCity(p.city || 'القاهرة');
    setEditCreditLimit(String(p.credit_limit || 0));
    setEditTermsDays(String(p.payment_terms_days || 0));
    setEditIsActive(p.is_active !== 0);
    setErrorMsg('');
  };

  const handleCreateParty = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');

    try {
      const createdType = partyTypeSelection;
      const targetTabLabel = createdType === 'supplier' ? 'الموردين' : 'العملاء';

      const res = await apiClient.post('/parties', {
        type: createdType,
        name_ar: nameAr,
        name_en: nameEn || nameAr,
        tax_id: taxId || null,
        commercial_registry: regNo || null,
        phone: phone || null,
        address: address || null,
        city: city || 'القاهرة',
        credit_limit: parseFloat(creditLimit) || 0,
        payment_terms_days: parseInt(termsDays, 10) || 0
      });

      setShowAddModal(false);

      if (createdType !== activeTab) {
        setSuccessMsg(`${res.message || 'تمت إضافة الطرف التجاري بنجاح.'} (تم الحفظ كـ ${createdType === 'supplier' ? 'مورد' : 'عميل'})`);
        setPendingTabSwitch({
          targetTab: createdType,
          label: `الانتقال إلى تبويب ${targetTabLabel}`
        });
      } else {
        setSuccessMsg(res.message || 'تمت إضافة الطرف التجاري بنجاح.');
        setPendingTabSwitch(null);
      }

      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل حفظ الطرف التجاري');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateParty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingParty) return;

    setSaving(true);
    setErrorMsg('');

    try {
      await apiClient.put(`/parties/${editingParty.id}`, {
        type: editType,
        name_ar: editNameAr,
        name_en: editNameEn || null,
        tax_id: editTaxId || null,
        commercial_registry: editRegNo || null,
        phone: editPhone || null,
        address: editAddress || null,
        city: editCity || 'القاهرة',
        credit_limit: parseFloat(editCreditLimit) || 0,
        payment_terms_days: parseInt(editTermsDays, 10) || 0,
        is_active: editIsActive
      });

      setEditingParty(null);
      setSuccessMsg(`تم تحديث بيانات الطرف "${editNameAr}" بنجاح.`);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل تحديث بيانات الطرف التجاري');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingParty) return;
    setIsDeleting(true);
    setErrorMsg('');

    try {
      await apiClient.del(`/parties/${deletingParty.id}`);
      setSuccessMsg(`تم حذف الطرف "${deletingParty.name_ar}" بنجاح.`);
      setDeletingParty(null);
      onRefresh();
    } catch (err: any) {
      // If linked records exist, offer deactivation
      setDeactivateTarget(deletingParty);
      setDeletingParty(null);
      setErrorMsg(err.message || 'تعذر حذف الطرف التجاري لوجود مستندات مرتبطة به.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeactivateParty = async (party: Party) => {
    try {
      await apiClient.put(`/parties/${party.id}`, { is_active: false });
      setSuccessMsg(`تم تعطيل الطرف التجاري "${party.name_ar}" بنجاح.`);
      setDeactivateTarget(null);
      setErrorMsg('');
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل تعطيل الطرف التجاري.');
    }
  };

  const handleOpenStatement = async (party: Party, fromDate = stmtFromDate, toDate = stmtToDate, branch = stmtBranchId) => {
    setSelectedParty(party);
    setLoadingStatement(true);
    try {
      const queryParams = new URLSearchParams();
      if (fromDate) queryParams.set('fromDate', fromDate);
      if (toDate) queryParams.set('toDate', toDate);
      if (branch && branch !== 'all') queryParams.set('branchId', branch);

      const data = await apiClient.get(`/parties/${party.id}/statement?${queryParams.toString()}`);
      setStatementData(data);
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل تحميل كشف الحساب.');
    } finally {
      setLoadingStatement(false);
    }
  };

  const handleFilterStatement = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedParty) {
      handleOpenStatement(selectedParty, stmtFromDate, stmtToDate, stmtBranchId);
    }
  };

  const handleExportStatementExcel = () => {
    if (!selectedParty || !statementData) return;

    const exportRows: any[] = [];
    exportRows.push({
      'التاريخ': 'قبل الفترة',
      'رقم الحركة': '-',
      'النوع': 'رصيد افتتاحي',
      'البيان': 'رصيد سابق منقول للفترة المحددة',
      'مدين': statementData.openingBalance > 0 ? statementData.openingBalance : 0,
      'دائن': statementData.openingBalance < 0 ? Math.abs(statementData.openingBalance) : 0,
      'الرصيد التراكمي': statementData.openingBalance
    });

    (statementData.rows || []).forEach((r: any) => {
      exportRows.push({
        'التاريخ': r.entry_date,
        'رقم الحركة': r.entry_number,
        'النوع': r.doc_type || 'قيد',
        'البيان': r.description,
        'مدين': r.debit || 0,
        'دائن': r.credit || 0,
        'الرصيد التراكمي': r.runningBalance
      });
    });

    exportRows.push({
      'التاريخ': 'الإجمالي',
      'رقم الحركة': '-',
      'النوع': '-',
      'البيان': 'إجمالي حركات الفترة والرصيد الختامي',
      'مدين': statementData.periodDebit || 0,
      'دائن': statementData.periodCredit || 0,
      'الرصيد التراكمي': statementData.closingBalance
    });

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'كشف الحساب');
    XLSX.writeFile(wb, `كشف_حساب_${selectedParty.name_ar}_${stmtFromDate}_${stmtToDate}.xlsx`);
  };

  const handlePrintStatement = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Alert Messages */}
      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <div className="flex items-center gap-2">
            {pendingTabSwitch && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab(pendingTabSwitch.targetTab);
                  setPendingTabSwitch(null);
                }}
                className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded text-[11px] font-bold transition-colors cursor-pointer"
              >
                {pendingTabSwitch.label}
              </button>
            )}
            <button
              onClick={() => {
                setSuccessMsg('');
                setPendingTabSwitch(null);
              }}
              className="text-emerald-600 hover:text-emerald-800 p-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs space-y-2">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg('')} className="text-rose-600 hover:text-rose-800 p-1">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {deactivateTarget && (
            <div className="pt-2 border-t border-rose-200 flex items-center gap-2">
              <button
                onClick={() => handleDeactivateParty(deactivateTarget)}
                className="px-3 py-1.5 bg-rose-700 hover:bg-rose-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Power className="w-3.5 h-3.5" />
                <span>تعطيل الطرف التجاري ({deactivateTarget.name_ar}) بدلاً من الحذف</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-600" />
            {t.customers} و{t.suppliers}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            إدارة شاملة لبطاقات العملاء والموردين، حدود الائتمان، فترات السداد، واستخراج كشف الحساب التراكمي المعتمد.
          </p>
        </div>

        <button
          onClick={handleOpenAddModal}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm flex items-center gap-2 transition-colors self-start md:self-auto"
        >
          <Plus className="w-4 h-4" />
          إضافة طرف تجاري جديد
        </button>
      </div>

      {/* Tabs & Search */}
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex bg-slate-100 p-1 rounded-lg w-full sm:w-auto">
          <button
            onClick={() => setActiveTab('customer')}
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 ${
              activeTab === 'customer'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>{t.customers}</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-mono">
              {parties.filter(p => p.type === 'customer' || p.type === 'both').length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('supplier')}
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 ${
              activeTab === 'supplier'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>{t.suppliers}</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-mono">
              {parties.filter(p => p.type === 'supplier' || p.type === 'both').length}
            </span>
          </button>
        </div>

        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute start-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="بحث بالاسم، الكود، الرقم الضريبي، أو الهاتف..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full ps-9 pe-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500 bg-slate-50"
          />
        </div>
      </div>

      {/* Parties Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-start">كود الطرف</th>
                <th className="px-4 py-3 text-start">الاسم التجاري</th>
                <th className="px-4 py-3 text-start">النوع والحالة</th>
                <th className="px-4 py-3 text-start">الرقم الضريبي والسجل</th>
                <th className="px-4 py-3 text-start">بيانات الاتصال والمدينة</th>
                <th className="px-4 py-3 text-end">الحد الائتماني</th>
                <th className="px-4 py-3 text-end">الرصيد القائم</th>
                <th className="px-4 py-3 text-center">{t.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredParties.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-emerald-800">{p.code}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{p.name_ar}</div>
                    {p.name_en && (
                      <div className="text-[10px] text-slate-400 font-mono">{p.name_en}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        p.type === 'customer' ? 'bg-sky-50 text-sky-700 border border-sky-200' :
                        p.type === 'supplier' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                        'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}>
                        {p.type === 'customer' ? 'عميل' : p.type === 'supplier' ? 'مورد' : 'عميل/مورد'}
                      </span>
                      {p.is_active === 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[10px]">
                          معطل
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 font-mono">
                    <div>ضريبياً: {p.tax_id || 'غير مسجل'}</div>
                    {p.commercial_registry && <div className="text-[10px] text-slate-400">سجل: {p.commercial_registry}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div className="flex items-center gap-1">
                      <Phone className="w-3 h-3 text-slate-400" />
                      <span className="font-mono">{p.phone || '-'}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-0.5">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      <span>{p.city || 'القاهرة'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-end font-mono text-slate-700">
                    {formatEGP(p.credit_limit)}
                  </td>
                  <td className={`px-4 py-3 text-end font-mono font-bold ${
                    (p.current_balance || 0) > 0 ? 'text-rose-600' : 'text-emerald-700'
                  }`}>
                    {formatEGP(p.current_balance)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => handleOpenStatement(p)}
                        className="px-2 py-1 text-emerald-700 hover:text-white hover:bg-emerald-600 border border-emerald-300 rounded transition-colors inline-flex items-center gap-1"
                        title="عرض كشف الحساب التفصيلي المعتمد"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span className="text-[11px] font-bold">كشف حساب</span>
                      </button>

                      <button
                        onClick={() => handleOpenEdit(p)}
                        className="p-1 text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-100 rounded transition-colors"
                        title="تعديل بيانات الطرف"
                      >
                        <Edit className="w-3.5 h-3.5 text-sky-600" />
                      </button>

                      <button
                        onClick={() => setDeletingParty(p)}
                        className="p-1 text-rose-600 hover:text-rose-800 border border-rose-200 hover:bg-rose-50 rounded transition-colors"
                        title="حذف الطرف التجاري"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredParties.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    لا توجد أطراف تجارية مطابقة للبحث
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Party Modal with Explicit Type Selection Toggle */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-200 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-600" />
                إضافة طرف تجاري جديد
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-2.5 mb-3 bg-rose-50 text-rose-700 text-xs rounded-lg border border-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleCreateParty} className="space-y-3 text-xs">
              {/* Type Toggle */}
              <div>
                <label className="block font-bold text-slate-800 mb-1.5">نوع الطرف التجاري *</label>
                <div className="grid grid-cols-2 gap-3 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setPartyTypeSelection('customer')}
                    className={`py-2 text-xs font-bold rounded-md flex items-center justify-center gap-1.5 transition-all ${
                      partyTypeSelection === 'customer'
                        ? 'bg-white text-emerald-700 shadow-xs border border-emerald-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>عميل (Customer)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPartyTypeSelection('supplier')}
                    className={`py-2 text-xs font-bold rounded-md flex items-center justify-center gap-1.5 transition-all ${
                      partyTypeSelection === 'supplier'
                        ? 'bg-white text-purple-700 shadow-xs border border-purple-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>مورد (Supplier)</span>
                  </button>
                </div>
                {partyTypeSelection !== activeTab && (
                  <p className="text-[11px] text-amber-700 mt-1 bg-amber-50 p-1.5 rounded border border-amber-200">
                    ملاحظة: سيتم حفظ الطرف كـ ({partyTypeSelection === 'supplier' ? 'مورد' : 'عميل'}) ونقلك تلقائياً إلى تبويب {partyTypeSelection === 'supplier' ? 'الموردين' : 'العملاء'}.
                  </p>
                )}
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">الاسم التجاري الكامل *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: شركة النيل للتوريدات العامة"
                  value={nameAr}
                  onChange={(e) => setNameAr(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">الاسم بالإنجليزية (اختياري)</label>
                <input
                  type="text"
                  placeholder="Al Nile General Supplies Co."
                  value={nameEn}
                  onChange={(e) => setNameEn(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">الرقم الضريبي (9 أرقام)</label>
                  <input
                    type="text"
                    placeholder="123-456-789"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">رقم السجل التجاري</label>
                  <input
                    type="text"
                    placeholder="98765"
                    value={regNo}
                    onChange={(e) => setRegNo(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">المدينة والمحافظة</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">رقم الهاتف أو الموبايل</label>
                  <input
                    type="text"
                    placeholder="+20 10 0000 0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">الحد الائتماني (ج.م)</label>
                  <input
                    type="number"
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono text-end"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">فترة السداد (أيام)</label>
                  <input
                    type="number"
                    value={termsDays}
                    onChange={(e) => setTermsDays(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono text-end"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">العنوان التفصيلي</label>
                <input
                  type="text"
                  placeholder="شارع الجمهورية - وسط البلد - القاهرة"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-semibold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold flex items-center gap-1.5"
                >
                  {saving ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>جارٍ الحفظ...</span>
                    </>
                  ) : (
                    <span>حفظ الطرف</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Party Modal */}
      {editingParty && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-200 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Edit className="w-4 h-4 text-sky-600" />
                تعديل الطرف التجاري: {editingParty.code}
              </h3>
              <button onClick={() => setEditingParty(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-2.5 mb-3 bg-rose-50 text-rose-700 text-xs rounded-lg border border-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleUpdateParty} className="space-y-3 text-xs">
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <label className="block font-bold text-slate-800 mb-1.5">نوع الطرف التجاري:</label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
                    <input
                      type="radio"
                      name="editPartyType"
                      value="customer"
                      checked={editType === 'customer'}
                      onChange={() => setEditType('customer')}
                      className="text-sky-600 focus:ring-sky-500"
                    />
                    <span>عميل (Customer)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
                    <input
                      type="radio"
                      name="editPartyType"
                      value="supplier"
                      checked={editType === 'supplier'}
                      onChange={() => setEditType('supplier')}
                      className="text-sky-600 focus:ring-sky-500"
                    />
                    <span>مورد (Supplier)</span>
                  </label>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  * يُسمح بتعديل النوع فقط إذا لم تكن هناك مستندات أو حركات أو فواتير مرتبطة بالطرف.
                </p>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">الاسم التجاري الكامل *</label>
                <input
                  type="text"
                  required
                  value={editNameAr}
                  onChange={(e) => setEditNameAr(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">الاسم بالإنجليزية</label>
                <input
                  type="text"
                  value={editNameEn}
                  onChange={(e) => setEditNameEn(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">الرقم الضريبي</label>
                  <input
                    type="text"
                    value={editTaxId}
                    onChange={(e) => setEditTaxId(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">السجل التجاري</label>
                  <input
                    type="text"
                    value={editRegNo}
                    onChange={(e) => setEditRegNo(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">المدينة</label>
                  <input
                    type="text"
                    value={editCity}
                    onChange={(e) => setEditCity(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">الهاتف</label>
                  <input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">الحد الائتماني (ج.م)</label>
                  <input
                    type="number"
                    value={editCreditLimit}
                    onChange={(e) => setEditCreditLimit(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono text-end"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">فترة السداد (أيام)</label>
                  <input
                    type="number"
                    value={editTermsDays}
                    onChange={(e) => setEditTermsDays(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono text-end"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">العنوان التفصيلي</label>
                <input
                  type="text"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-800">حالة الطرف التجاري:</span>
                  <span className={`me-2 px-2 py-0.5 rounded text-[10px] font-bold ${editIsActive ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                    {editIsActive ? 'نشط ومفعل' : 'معطل'}
                  </span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editIsActive}
                    onChange={(e) => setEditIsActive(e.target.checked)}
                    className="rounded text-sky-600 focus:ring-sky-500 h-4 w-4"
                  />
                  <span className="text-xs text-slate-700 font-medium">نشط للتعامل</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingParty(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-semibold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-semibold flex items-center gap-1.5"
                >
                  {saving ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>جارٍ التحديث...</span>
                    </>
                  ) : (
                    <span>تحديث البيانات</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deletingParty}
        title="تأكيد حذف الطرف التجاري"
        message={`هل تريد حذف الطرف التجاري "${deletingParty?.name_ar}" (كود: ${deletingParty?.code}) نهائياً؟`}
        warning="سيمنع النظام الحذف تلقائياً إذا كانت هناك فواتير أو قيود أو حركات مالية مسجلة عليه، وسيتيح لك خيار التعطيل بدلاً من الحذف."
        confirmLabel="نعم، حذف نهائي"
        cancelLabel="إلغاء"
        confirmVariant="danger"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingParty(null)}
      />

      {/* Enhanced Statement of Account Modal */}
      {selectedParty && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full p-6 border border-slate-200 max-h-[92vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 font-bold">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] font-mono text-emerald-600 font-bold uppercase tracking-wider">
                    {selectedParty.type === 'supplier' ? 'SUPPLIER STATEMENT OF ACCOUNT' : 'CUSTOMER STATEMENT OF ACCOUNT'}
                  </span>
                  <h3 className="text-base font-bold text-slate-900">
                    كشف حساب تفصيلي: {selectedParty.name_ar} ({selectedParty.code})
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportStatementExcel}
                  disabled={!statementData}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-600" />
                  <span>تصدير Excel</span>
                </button>

                <button
                  onClick={handlePrintStatement}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Printer className="w-3.5 h-3.5 text-sky-600" />
                  <span>طباعة</span>
                </button>

                <button
                  onClick={() => { setSelectedParty(null); setStatementData(null); }}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Date Range & Branch Filter Toolbar */}
            <form onSubmit={handleFilterStatement} className="py-3 px-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs shrink-0">
              <div>
                <label className="block text-slate-500 font-medium mb-1">من تاريخ:</label>
                <input
                  type="date"
                  value={stmtFromDate}
                  onChange={e => setStmtFromDate(e.target.value)}
                  className="w-full p-1.5 bg-white border border-slate-300 rounded font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-medium mb-1">إلى تاريخ:</label>
                <input
                  type="date"
                  value={stmtToDate}
                  onChange={e => setStmtToDate(e.target.value)}
                  className="w-full p-1.5 bg-white border border-slate-300 rounded font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-medium mb-1">تصفية الفرع:</label>
                <select
                  value={stmtBranchId}
                  onChange={e => setStmtBranchId(e.target.value)}
                  className="w-full p-1.5 bg-white border border-slate-300 rounded"
                >
                  <option value="all">كافة الفروع</option>
                  <option value="br_cairo">فرع القاهرة الرئيسي</option>
                  <option value="br_alex">فرع الإسكندرية</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={loadingStatement}
                  className="w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded shadow-xs flex items-center justify-center gap-1.5"
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>تحديث الكشف</span>
                </button>
              </div>
            </form>

            {/* KPI Summary Cards */}
            {statementData && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 bg-slate-50 border-b border-slate-200 text-xs shrink-0">
                <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 font-medium block">رصيد ما قبل الفترة</span>
                  <span className="text-sm font-bold font-mono text-slate-800">
                    {formatEGP(statementData.openingBalance)}
                  </span>
                </div>

                <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 font-medium block">إجمالي حركات المدين</span>
                  <span className="text-sm font-bold font-mono text-emerald-600">
                    {formatEGP(statementData.periodDebit)}
                  </span>
                </div>

                <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 font-medium block">إجمالي حركات الدائن</span>
                  <span className="text-sm font-bold font-mono text-purple-600">
                    {formatEGP(statementData.periodCredit)}
                  </span>
                </div>

                <div className="p-2.5 bg-white rounded-lg border border-slate-200 col-span-2">
                  <span className="text-[10px] text-slate-500 font-medium block">الرصيد الختامي التراكمي</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold font-mono ${
                      statementData.closingBalance > 0 ? 'text-rose-600' : 'text-emerald-700'
                    }`}>
                      {formatEGP(statementData.closingBalance)}
                    </span>
                    <span className="text-[10px] text-slate-500 font-medium">({statementData.balanceNature})</span>
                  </div>
                </div>
              </div>
            )}

            {/* Statement Rows Table */}
            <div className="overflow-y-auto flex-1 p-4">
              {loadingStatement ? (
                <div className="py-12 text-center text-slate-400">
                  <div className="inline-block w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-2" />
                  <p>جارٍ احتساب قيود وكشف الحساب...</p>
                </div>
              ) : statementData ? (
                <table className="w-full text-xs text-start">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-start">التاريخ</th>
                      <th className="px-3 py-2 text-start">رقم المستند / القيد</th>
                      <th className="px-3 py-2 text-start">نوع الحركة</th>
                      <th className="px-3 py-2 text-start">البيان والشرح المحاسبي</th>
                      <th className="px-3 py-2 text-end">مدين (+)</th>
                      <th className="px-3 py-2 text-end">دائن (-)</th>
                      <th className="px-3 py-2 text-end">الرصيد التراكمي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {/* Opening Balance Row */}
                    <tr className="bg-amber-50/50 font-medium">
                      <td className="px-3 py-2 font-mono text-slate-500">قبل {stmtFromDate}</td>
                      <td className="px-3 py-2 font-mono text-slate-400">-</td>
                      <td className="px-3 py-2 font-bold text-amber-800">رصيد افتتاحي</td>
                      <td className="px-3 py-2 text-slate-600">رصيد سابق منقول للفترة المحددة</td>
                      <td className="px-3 py-2 text-end font-mono">
                        {statementData.openingBalance > 0 ? formatEGP(statementData.openingBalance) : '-'}
                      </td>
                      <td className="px-3 py-2 text-end font-mono">
                        {statementData.openingBalance < 0 ? formatEGP(Math.abs(statementData.openingBalance)) : '-'}
                      </td>
                      <td className="px-3 py-2 text-end font-mono font-bold text-slate-800">
                        {formatEGP(statementData.openingBalance)}
                      </td>
                    </tr>

                    {/* Transaction Rows */}
                    {(statementData.rows || []).map((r: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-3 py-2 font-mono text-slate-700">{r.entry_date}</td>
                        <td className="px-3 py-2 font-mono font-bold text-emerald-800">{r.entry_number}</td>
                        <td className="px-3 py-2 font-medium text-slate-600">{r.doc_type || 'قيد'}</td>
                        <td className="px-3 py-2 text-slate-800">{r.description}</td>
                        <td className="px-3 py-2 text-end font-mono text-emerald-700 font-semibold">
                          {r.debit > 0 ? formatEGP(r.debit) : '-'}
                        </td>
                        <td className="px-3 py-2 text-end font-mono text-purple-700 font-semibold">
                          {r.credit > 0 ? formatEGP(r.credit) : '-'}
                        </td>
                        <td className="px-3 py-2 text-end font-mono font-bold text-slate-900">
                          {formatEGP(r.runningBalance)}
                        </td>
                      </tr>
                    ))}

                    {(!statementData.rows || statementData.rows.length === 0) && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                          لا توجد حركات مسجلة خلال الفترة الزمنية المحددة.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
