import React, { useState } from 'react';
import {
  Receipt,
  Plus,
  Search,
  Printer,
  Send,
  Eye,
  CheckCircle2,
  Clock,
  ScanBarcode,
  Building,
  AlertTriangle,
  FileCheck2,
  Trash2,
  X,
  FileText,
  Edit,
  RotateCcw
} from 'lucide-react';
import { SalesInvoice, Party, Item, Branch, Warehouse, User } from '../types';
import { Language, translations } from '../translations';
import { apiClient } from '../services/apiClient';
import { ConfirmModal } from './ConfirmModal';

interface SalesInvoicesViewProps {
  invoices: SalesInvoice[];
  customers: Party[];
  items: Item[];
  branches: Branch[];
  warehouses: Warehouse[];
  lang: Language;
  onRefresh: () => void;
  onOpenPrintModal: (inv: SalesInvoice) => void;
  userPermissions?: string[];
  currentUser?: User | null;
}

export const SalesInvoicesView: React.FC<SalesInvoicesViewProps> = ({
  invoices,
  customers,
  items,
  branches,
  warehouses,
  lang,
  onRefresh,
  onOpenPrintModal,
  userPermissions = [],
  currentUser = null
}) => {
  const t = translations[lang];
  const [searchTerm, setSearchTerm] = useState('');
  const [activeStatusTab, setActiveStatusTab] = useState<'all' | 'posted' | 'draft' | 'paid' | 'reversed'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState(customers[0]?.id || '');
  const [selectedBranchId, setSelectedBranchId] = useState(branches[0]?.id || 'br_cairo');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(warehouses[0]?.id || 'wh_main');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentType, setPaymentType] = useState<'credit' | 'cash'>('credit');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [etaSubmittingId, setEtaSubmittingId] = useState<string | null>(null);

  // Modular RBAC Permissions
  const perms = userPermissions || currentUser?.permissions || [];
  const isOwner = currentUser?.role === 'owner';
  const canCreate = isOwner || perms.includes('sales.create') || perms.includes('sales.edit_draft') || perms.includes('*');
  const canEditDraft = isOwner || perms.includes('sales.edit_draft') || perms.includes('*');
  const canDeleteDraft = isOwner || perms.includes('sales.delete_draft') || perms.includes('*');
  const canPost = isOwner || perms.includes('sales.post') || perms.includes('*');
  const canReverse = isOwner || perms.includes('sales.reverse') || perms.includes('*');

  // Edit Draft Modal State
  const [editingDraft, setEditingDraft] = useState<SalesInvoice | null>(null);
  const [editBranchId, setEditBranchId] = useState('');
  const [editWarehouseId, setEditWarehouseId] = useState('');
  const [editCustomerId, setEditCustomerId] = useState('');
  const [editInvoiceDate, setEditInvoiceDate] = useState('');
  const [editPaymentType, setEditPaymentType] = useState<'credit' | 'cash'>('credit');
  const [editLines, setEditLines] = useState<{ itemId: string; quantity: number; unitPrice: number; discountAmount: number }[]>([]);
  const [editNotes, setEditNotes] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Reversal Modal State
  const [reversingInvoice, setReversingInvoice] = useState<SalesInvoice | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [reversalError, setReversalError] = useState<string | null>(null);

  // Confirmation Modals State
  const [deletingDraft, setDeletingDraft] = useState<SalesInvoice | null>(null);
  const [deleteModalError, setDeleteModalError] = useState<string | null>(null);
  const [postingDraft, setPostingDraft] = useState<SalesInvoice | null>(null);
  const [postModalError, setPostModalError] = useState<string | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  // Invoice lines state
  const [invoiceLines, setInvoiceLines] = useState<{
    itemId: string;
    quantity: number;
    unitPrice: number;
    discountAmount: number;
  }[]>([]);

  const formatEGP = (val: number) => {
    return (val || 0).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' ج.م';
  };

  // Barcode scanning / fast entry handler
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    const matched = items.find(
      it => it.barcode === barcodeInput.trim() || it.code.toLowerCase() === barcodeInput.trim().toLowerCase()
    );

    if (matched) {
      const existingIdx = invoiceLines.findIndex(l => l.itemId === matched.id);
      if (existingIdx >= 0) {
        const updated = [...invoiceLines];
        updated[existingIdx].quantity += 1;
        setInvoiceLines(updated);
      } else {
        setInvoiceLines([
          ...invoiceLines,
          {
            itemId: matched.id,
            quantity: 1,
            unitPrice: matched.sale_price,
            discountAmount: 0
          }
        ]);
      }
      setBarcodeInput('');
    } else {
      setErrorMsg(`لم يتم العثور على صنف بالباركود أو الكود: ${barcodeInput}`);
    }
  };

  const handleAddLine = () => {
    const defaultItem = items[0];
    if (defaultItem) {
      setInvoiceLines([
        ...invoiceLines,
        {
          itemId: defaultItem.id,
          quantity: 1,
          unitPrice: defaultItem.sale_price,
          discountAmount: 0
        }
      ]);
    }
  };

  const handleRemoveLine = (idx: number) => {
    setInvoiceLines(invoiceLines.filter((_, i) => i !== idx));
  };

  const handleLineUpdate = (idx: number, field: string, val: any) => {
    const updated = [...invoiceLines];
    if (field === 'itemId') {
      const it = items.find(i => i.id === val);
      if (it) {
        updated[idx].itemId = val;
        updated[idx].unitPrice = it.sale_price;
      }
    } else {
      (updated[idx] as any)[field] = val;
    }
    setInvoiceLines(updated);
  };

  // Totals calculations
  let calculatedSubtotal = 0;
  let calculatedDiscount = 0;
  invoiceLines.forEach(l => {
    calculatedSubtotal += l.quantity * l.unitPrice;
    calculatedDiscount += l.discountAmount;
  });
  const calculatedTaxable = Math.max(calculatedSubtotal - calculatedDiscount, 0);
  const calculatedVat = Math.round(calculatedTaxable * 0.14 * 100) / 100; // 14%
  const calculatedWht = Math.round(calculatedTaxable * 0.01 * 100) / 100; // 1%
  const calculatedTotal = calculatedTaxable + calculatedVat - calculatedWht;

  const handleCreateInvoice = async (asDraft: boolean) => {
    if (invoiceLines.length === 0) {
      setErrorMsg('يجب إضافة صنف واحد على الأقل بالفاتورة.');
      return;
    }

    setCreating(true);
    setErrorMsg('');

    try {
      const res = await apiClient.post('/sales/invoices', {
        branchId: selectedBranchId,
        warehouseId: selectedWarehouseId,
        customerId: selectedCustomerId,
        invoiceDate,
        paymentType,
        status: asDraft ? 'draft' : 'posted',
        items: invoiceLines,
        notes
      });

      setShowCreateModal(false);
      setInvoiceLines([]);
      setNotes('');
      setSuccessMsg(asDraft ? 'تم حفظ مسودة الفاتورة بنجاح.' : 'تم إصدار وترحيل الفاتورة بنجاح.');
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل إصدار الفاتورة');
    } finally {
      setCreating(false);
    }
  };

  const handleOpenEditDraft = async (inv: SalesInvoice) => {
    try {
      const data = await apiClient.get(`/sales/invoices/${inv.id}`);
      const detailed = data.invoice;
      setEditingDraft(detailed);
      setEditBranchId(detailed.branch_id);
      setEditWarehouseId(detailed.warehouse_id);
      setEditCustomerId(detailed.customer_id);
      setEditInvoiceDate(detailed.invoice_date);
      setEditPaymentType(detailed.payment_type || 'credit');
      setEditNotes(detailed.notes || '');
      setEditLines(
        (detailed.items || []).map((it: any) => ({
          itemId: it.item_id,
          quantity: it.quantity,
          unitPrice: it.unit_price,
          discountAmount: it.discount_amount || 0
        }))
      );
      setErrorMsg('');
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل جلب تفاصيل مسودة الفاتورة');
    }
  };

  const handleUpdateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDraft) return;

    if (editLines.length === 0) {
      setErrorMsg('يجب إضافة صنف واحد على الأقل بالفاتورة.');
      return;
    }

    setIsEditing(true);
    setErrorMsg('');

    try {
      await apiClient.put(`/sales/invoices/${editingDraft.id}`, {
        branchId: editBranchId,
        warehouseId: editWarehouseId,
        customerId: editCustomerId,
        invoiceDate: editInvoiceDate,
        paymentType: editPaymentType,
        items: editLines,
        notes: editNotes
      });

      setEditingDraft(null);
      setSuccessMsg('تم تحديث مسودة فاتورة المبيعات بنجاح.');
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل تحديث مسودة الفاتورة');
    } finally {
      setIsEditing(false);
    }
  };

  const handleConfirmDeleteDraft = async () => {
    if (!deletingDraft) return;
    setIsActionLoading(true);
    setDeleteModalError(null);

    try {
      await apiClient.del(`/sales/invoices/${deletingDraft.id}`);
      setSuccessMsg(`تم حذف مسودة الفاتورة "${deletingDraft.invoice_number}" بنجاح.`);
      setDeletingDraft(null);
      setDeleteModalError(null);
      onRefresh();
    } catch (err: any) {
      setDeleteModalError(err.message || 'فشل حذف مسودة الفاتورة');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleConfirmPostDraft = async () => {
    if (!postingDraft) return;
    setIsActionLoading(true);
    setPostModalError(null);

    try {
      await apiClient.post(`/sales/invoices/${postingDraft.id}/post`);
      setSuccessMsg(`تم اعتماد وترحيل فاتورة المبيعات "${postingDraft.invoice_number}" بنجاح.`);
      setPostingDraft(null);
      setPostModalError(null);
      onRefresh();
    } catch (err: any) {
      setPostModalError(err.message || 'فشل ترحيل الفاتورة');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleConfirmReverseInvoice = async () => {
    if (!reversingInvoice) return;
    if (!reversalReason.trim()) {
      setReversalError('يرجى توضيح سبب إلغاء وتصحيح الفاتورة المرحّلة.');
      return;
    }
    setIsActionLoading(true);
    setReversalError(null);

    try {
      await apiClient.post(`/sales/invoices/${reversingInvoice.id}/reverse`, {
        reason: reversalReason.trim()
      });
      setSuccessMsg(`تم إلغاء وعكس فاتورة المبيعات "${reversingInvoice.invoice_number}" بنجاح وإعادة البضاعة للمخزن.`);
      setReversingInvoice(null);
      setReversalReason('');
      onRefresh();
    } catch (err: any) {
      setReversalError(err.message || 'فشل إلغاء وعكس الفاتورة المرحّلة');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleSubmitToEta = async (invId: string) => {
    setEtaSubmittingId(invId);
    try {
      await apiClient.post(`/eta/simulate-submission/${invId}`);
      setSuccessMsg('تمت محاكاة التحقق من الفاتورة إلكترونياً بنجاح.');
      onRefresh();
    } catch (err: any) {
      setErrorMsg(`خطأ في الإرسال: ${err.message}`);
    } finally {
      setEtaSubmittingId(null);
    }
  };

  const filteredInvoices = invoices.filter(inv => {
    const matchesStatus =
      activeStatusTab === 'all' ||
      (activeStatusTab === 'posted' && (inv.status === 'posted' || inv.status === 'partially_paid' || inv.status === 'paid')) ||
      (activeStatusTab === 'draft' && inv.status === 'draft') ||
      (activeStatusTab === 'paid' && inv.status === 'paid') ||
      (activeStatusTab === 'reversed' && inv.status === 'reversed');

    const matchesSearch =
      inv.invoice_number.includes(searchTerm) ||
      (inv.customer_name && inv.customer_name.includes(searchTerm));

    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-emerald-600" />
            {t.salesInvoices} والمبيعات التجارية
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            إصدار فواتير ضريبية متوافقة مع متطلبات مصلحة الضرائب المصرية (14% قيمة مضافة، 1% خصم وتحصيل، ودعم كامل لمسودات الفواتير والترحيل اللحظي).
          </p>
        </div>

        {canCreate && (
          <button
            onClick={() => {
              setShowCreateModal(true);
              setErrorMsg('');
            }}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm flex items-center gap-2 transition-colors self-start md:self-auto cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            إصدار فاتورة بيع جديدة
          </button>
        )}
      </div>

      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg('')} className="cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filter and Search */}
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex bg-slate-100 p-1 rounded-lg w-full sm:w-auto overflow-x-auto">
          <button
            onClick={() => setActiveStatusTab('all')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition cursor-pointer ${
              activeStatusTab === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            الكل ({invoices.length})
          </button>
          <button
            onClick={() => setActiveStatusTab('posted')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition cursor-pointer ${
              activeStatusTab === 'posted' ? 'bg-white text-emerald-800 shadow-xs' : 'text-slate-600'
            }`}
          >
            معتمدة ({invoices.filter(i => i.status === 'posted' || i.status === 'paid' || i.status === 'partially_paid').length})
          </button>
          <button
            onClick={() => setActiveStatusTab('draft')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition cursor-pointer ${
              activeStatusTab === 'draft' ? 'bg-white text-amber-800 shadow-xs' : 'text-slate-600'
            }`}
          >
            مسودات ({invoices.filter(i => i.status === 'draft').length})
          </button>
          <button
            onClick={() => setActiveStatusTab('paid')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition cursor-pointer ${
              activeStatusTab === 'paid' ? 'bg-white text-emerald-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            مسددة بالكامل ({invoices.filter(i => i.status === 'paid').length})
          </button>
          <button
            onClick={() => setActiveStatusTab('reversed')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition cursor-pointer ${
              activeStatusTab === 'reversed' ? 'bg-white text-rose-800 shadow-xs' : 'text-slate-600'
            }`}
          >
            معكوسة ({invoices.filter(i => i.status === 'reversed').length})
          </button>
        </div>

        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 absolute start-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="بحث برقم الفاتورة أو اسم العميل..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full ps-9 pe-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500 bg-slate-50"
          />
        </div>
      </div>

      {/* Invoices Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-xs text-start">
          <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-start">{t.invoiceNumber}</th>
              <th className="px-4 py-3 text-start">{t.date}</th>
              <th className="px-4 py-3 text-start">{t.customer}</th>
              <th className="px-4 py-3 text-start">الفرع / المخزن</th>
              <th className="px-4 py-3 text-start">طريقة الدفع</th>
              <th className="px-4 py-3 text-end">القيمة المضافة (14%)</th>
              <th className="px-4 py-3 text-end">صافي المستحق</th>
              <th className="px-4 py-3 text-center">الحالة</th>
              <th className="px-4 py-3 text-center">الضرائب (ETA)</th>
              <th className="px-4 py-3 text-center">{t.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredInvoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                <td className="px-4 py-2.5 font-mono font-bold text-emerald-800">{inv.invoice_number}</td>
                <td className="px-4 py-2.5 text-slate-600 font-mono">{inv.invoice_date}</td>
                <td className="px-4 py-2.5 font-medium text-slate-900">{inv.customer_name}</td>
                <td className="px-4 py-2.5 text-slate-600">
                  {inv.branch_name}
                  <span className="block text-[10px] text-slate-400">{inv.warehouse_name}</span>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    inv.payment_type === 'cash' ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'
                  }`}>
                    {inv.payment_type === 'cash' ? 'نقدي فوري' : 'آجل على الحساب'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-end font-mono-numbers text-slate-600">{formatEGP(inv.tax_amount)}</td>
                <td className="px-4 py-2.5 text-end font-mono-numbers font-bold text-slate-900">{formatEGP(inv.total_amount)}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    inv.status === 'draft'
                      ? 'bg-amber-100 text-amber-800 border border-amber-200'
                      : inv.status === 'paid'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : inv.status === 'partially_paid'
                      ? 'bg-sky-100 text-sky-800 border border-sky-200'
                      : inv.status === 'reversed'
                      ? 'bg-rose-100 text-rose-800 border border-rose-200 line-through'
                      : 'bg-blue-100 text-blue-800 border border-blue-200'
                  }`}>
                    {inv.status === 'draft' ? 'مسودة'
                     : inv.status === 'paid' ? 'مسددة'
                     : inv.status === 'partially_paid' ? 'مسددة جزئياً'
                     : inv.status === 'reversed' ? 'معكوسة'
                     : 'مرحلة'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold inline-flex items-center gap-1 ${
                    inv.eta_status === 'Valid' || inv.eta_status === 'SimulationAccepted'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : 'bg-amber-100 text-amber-800 border border-amber-200'
                  }`}>
                    {inv.eta_status === 'Valid' || inv.eta_status === 'SimulationAccepted' ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        مطابقة إلكترونياً
                      </>
                    ) : (
                      <>
                        <Clock className="w-3 h-3 text-amber-600" />
                        غير مرسلة
                      </>
                    )}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <button
                      onClick={() => onOpenPrintModal(inv)}
                      className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                      title="طباعة فاتورة ضريبية رسمية A4"
                    >
                      <Printer className="w-4 h-4" />
                    </button>

                    {inv.status === 'draft' ? (
                      <>
                        {canEditDraft && (
                          <button
                            onClick={() => handleOpenEditDraft(inv)}
                            className="p-1.5 text-amber-600 hover:bg-amber-50 rounded transition cursor-pointer"
                            title="تعديل مسودة الفاتورة"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                        )}
                        {canPost && (
                          <button
                            onClick={() => {
                              setPostModalError(null);
                              setPostingDraft(inv);
                            }}
                            className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded transition cursor-pointer"
                            title="اعتماد وترحيل الفاتورة"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        )}
                        {canDeleteDraft && (
                          <button
                            onClick={() => {
                              setDeleteModalError(null);
                              setDeletingDraft(inv);
                            }}
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded transition cursor-pointer"
                            title="حذف المسودة"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {(inv.status === 'posted' || inv.status === 'paid' || inv.status === 'partially_paid') && canReverse && (
                          <button
                            onClick={() => {
                              setReversingInvoice(inv);
                              setReversalReason('');
                              setReversalError(null);
                            }}
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded transition cursor-pointer"
                            title="إلغاء وعكس الفاتورة المرحّلة (إجراء محاسبي مع قيد عكسي)"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        {inv.eta_status !== 'Valid' && inv.eta_status !== 'SimulationAccepted' && (
                          <button
                            onClick={() => handleSubmitToEta(inv.id)}
                            disabled={etaSubmittingId === inv.id}
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded transition-colors cursor-pointer"
                            title="إرسال ومطابقة مع منظومة الفاتورة الإلكترونية المصرية"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Sales Invoice Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full p-6 border border-slate-200 max-h-[95vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Receipt className="w-4 h-4 text-emerald-600" />
                إصدار فاتورة بيع ضريبية جديدة
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {errorMsg && (
              <div className="p-3 my-3 bg-rose-50 text-rose-700 text-xs rounded-lg border border-rose-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="space-y-4 text-xs mt-4">
              {/* Header Info */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{t.customer} *</label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name_ar} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">الفرع الصادر منه *</label>
                  <select
                    value={selectedBranchId}
                    onChange={(e) => setSelectedBranchId(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name_ar}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">مستودع الصرف *</label>
                  <select
                    value={selectedWarehouseId}
                    onChange={(e) => setSelectedWarehouseId(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name_ar}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">{t.date} *</label>
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono"
                  />
                </div>
              </div>

              {/* Barcode scanner quick entry */}
              <form onSubmit={handleBarcodeSubmit} className="flex gap-2 items-center bg-emerald-50/60 p-3 rounded-lg border border-emerald-100">
                <ScanBarcode className="w-5 h-5 text-emerald-700 shrink-0" />
                <input
                  type="text"
                  placeholder="مسح الباركود الدولي أو إدخال كود الصنف السريع..."
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  className="flex-1 p-2 bg-white border border-emerald-300 rounded-lg text-xs font-mono focus:outline-none focus:border-emerald-600"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-semibold hover:bg-emerald-800"
                >
                  إضافة سريعة
                </button>
              </form>

              {/* Items Table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs text-start">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-2 text-start w-1/3">الصنف</th>
                      <th className="p-2 text-end w-20">الكمية</th>
                      <th className="p-2 text-end w-24">سعر الوحدة</th>
                      <th className="p-2 text-end w-24">خصم السطر</th>
                      <th className="p-2 text-end w-24">الضريبة (14%)</th>
                      <th className="p-2 text-end w-28">الإجمالي</th>
                      <th className="p-2 text-center w-10">-</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoiceLines.map((line, idx) => {
                      const lineNet = line.quantity * line.unitPrice - line.discountAmount;
                      const lineTax = Math.round(lineNet * 0.14 * 100) / 100;
                      const lineTot = lineNet + lineTax;

                      return (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2">
                            <select
                              value={line.itemId}
                              onChange={(e) => handleLineUpdate(idx, 'itemId', e.target.value)}
                              className="w-full p-1.5 border border-slate-300 rounded font-sans"
                            >
                              {items.map((it) => (
                                <option key={it.id} value={it.id}>
                                  {it.name_ar} ({it.code}) - {formatEGP(it.sale_price)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="1"
                              value={line.quantity}
                              onChange={(e) => handleLineUpdate(idx, 'quantity', parseInt(e.target.value, 10) || 1)}
                              className="w-full p-1.5 border border-slate-300 rounded font-mono text-end"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              step="0.01"
                              value={line.unitPrice}
                              onChange={(e) => handleLineUpdate(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                              className="w-full p-1.5 border border-slate-300 rounded font-mono text-end"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              step="0.01"
                              value={line.discountAmount}
                              onChange={(e) => handleLineUpdate(idx, 'discountAmount', parseFloat(e.target.value) || 0)}
                              className="w-full p-1.5 border border-slate-300 rounded font-mono text-end"
                            />
                          </td>
                          <td className="p-2 text-end font-mono text-slate-600">
                            {formatEGP(lineTax)}
                          </td>
                          <td className="p-2 text-end font-mono font-bold text-slate-800">
                            {formatEGP(lineTot)}
                          </td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveLine(idx)}
                              className="text-slate-400 hover:text-rose-600"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t border-slate-200">
                    <tr>
                      <td colSpan={7} className="p-2">
                        <button
                          type="button"
                          onClick={handleAddLine}
                          className="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded text-xs font-semibold"
                        >
                          + إضافة سطر صنف
                        </button>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Invoice Financial Summary Box (Egyptian Tax Standard) */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col md:flex-row justify-between gap-4">
                <div className="w-full md:w-1/2 space-y-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">طريقة التحصيل / السداد</label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                        <input
                          type="radio"
                          name="paymentType"
                          value="credit"
                          checked={paymentType === 'credit'}
                          onChange={() => setPaymentType('credit')}
                          className="text-emerald-600"
                        />
                        <span>آجل على حساب العميل</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                        <input
                          type="radio"
                          name="paymentType"
                          value="cash"
                          checked={paymentType === 'cash'}
                          onChange={() => setPaymentType('cash')}
                          className="text-emerald-600"
                        />
                        <span>نقدي فوري (سند قبض آلي بالخزينة)</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">ملاحظات وشروط الفاتورة</label>
                    <textarea
                      rows={2}
                      placeholder="ملاحظات التسليم، رقم أمر الشراء الخاص بالعميل..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full p-2 border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                </div>

                <div className="w-full md:w-80 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>الإجمالي قبل الضريبة:</span>
                    <span className="font-mono-numbers font-medium">{formatEGP(calculatedSubtotal)}</span>
                  </div>
                  <div className="flex justify-between text-rose-600">
                    <span>الخصومات التجارية:</span>
                    <span className="font-mono-numbers font-medium">- {formatEGP(calculatedDiscount)}</span>
                  </div>
                  <div className="flex justify-between text-slate-700 font-semibold border-t border-slate-200 pt-1">
                    <span>الوعاء الخاضع للضريبة:</span>
                    <span className="font-mono-numbers">{formatEGP(calculatedTaxable)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-700 font-medium">
                    <span>ضريبة القيمة المضافة (14%):</span>
                    <span className="font-mono-numbers">+ {formatEGP(calculatedVat)}</span>
                  </div>
                  <div className="flex justify-between text-sky-700 font-medium">
                    <span>خصم وتحصيل تحت الحساب (1%):</span>
                    <span className="font-mono-numbers">- {formatEGP(calculatedWht)}</span>
                  </div>
                  <div className="flex justify-between text-slate-900 font-bold text-sm border-t border-slate-300 pt-2">
                    <span>الصافي النهائي المستحق:</span>
                    <span className="font-mono-numbers text-emerald-800">{formatEGP(calculatedTotal)}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={creating || invoiceLines.length === 0}
                  onClick={() => handleCreateInvoice(true)}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {creating ? 'جارٍ الحفظ...' : 'حفظ كمسودة (Draft)'}
                </button>
                <button
                  type="button"
                  disabled={creating || invoiceLines.length === 0}
                  onClick={() => handleCreateInvoice(false)}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {creating ? 'جارٍ الترحيل...' : 'إصدار وترحيل فوري (Post)'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Edit Sales Invoice Draft Modal */}
      {editingDraft && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full p-6 border border-slate-200 max-h-[95vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Edit className="w-4 h-4 text-amber-600" />
                تعديل مسودة فاتورة المبيعات: {editingDraft.invoice_number}
              </h3>
              <button onClick={() => setEditingDraft(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">✕</button>
            </div>

            {errorMsg && (
              <div className="p-3 my-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleUpdateDraft} className="space-y-4 pt-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">الفرع *</label>
                  <select
                    value={editBranchId}
                    onChange={(e) => setEditBranchId(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg"
                    required
                  >
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name_ar}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">المستودع / المخزن *</label>
                  <select
                    value={editWarehouseId}
                    onChange={(e) => setEditWarehouseId(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg"
                    required
                  >
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name_ar}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">العميل *</label>
                  <select
                    value={editCustomerId}
                    onChange={(e) => setEditCustomerId(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg"
                    required
                  >
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name_ar} ({c.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">تاريخ الفاتورة</label>
                  <input
                    type="date"
                    value={editInvoiceDate}
                    onChange={(e) => setEditInvoiceDate(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono"
                    required
                  >
                  </input>
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">طريقة السداد</label>
                  <select
                    value={editPaymentType}
                    onChange={(e) => setEditPaymentType(e.target.value as any)}
                    className="w-full p-2 border border-slate-300 rounded-lg"
                  >
                    <option value="credit">آجل (ذمم مدينة)</option>
                    <option value="cash">نقدي (خزينة رئيسية)</option>
                  </select>
                </div>
              </div>

              {/* Items Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden mt-4">
                <div className="bg-slate-50 p-2.5 flex justify-between items-center border-b border-slate-200">
                  <span className="font-bold text-slate-700">بنود الفاتورة ({editLines.length})</span>
                  <button
                    type="button"
                    onClick={() => {
                      const def = items[0];
                      if (def) {
                        setEditLines([...editLines, { itemId: def.id, quantity: 1, unitPrice: def.sale_price, discountAmount: 0 }]);
                      }
                    }}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    إضافة بند
                  </button>
                </div>

                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-2 text-start">الصنف</th>
                      <th className="p-2 text-center w-20">الكمية</th>
                      <th className="p-2 text-center w-28">سعر الوحدة</th>
                      <th className="p-2 text-center w-24">خصم تجاري</th>
                      <th className="p-2 text-end w-28">الإجمالي قبل الضريبة</th>
                      <th className="p-2 text-center w-12">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {editLines.map((l, idx) => {
                      const lineNet = (l.quantity || 0) * (l.unitPrice || 0) - (l.discountAmount || 0);
                      return (
                        <tr key={idx}>
                          <td className="p-2">
                            <select
                              value={l.itemId}
                              onChange={(e) => {
                                const matched = items.find(i => i.id === e.target.value);
                                const updated = [...editLines];
                                updated[idx].itemId = e.target.value;
                                if (matched) updated[idx].unitPrice = matched.sale_price;
                                setEditLines(updated);
                              }}
                              className="w-full p-1.5 border border-slate-300 rounded"
                            >
                              {items.map(it => (
                                <option key={it.id} value={it.id}>{it.name_ar} ({it.code})</option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="1"
                              value={l.quantity}
                              onChange={(e) => {
                                const updated = [...editLines];
                                updated[idx].quantity = Math.max(parseFloat(e.target.value) || 1, 1);
                                setEditLines(updated);
                              }}
                              className="w-full p-1.5 border border-slate-300 rounded text-center font-mono"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={l.unitPrice}
                              onChange={(e) => {
                                const updated = [...editLines];
                                updated[idx].unitPrice = Math.max(parseFloat(e.target.value) || 0, 0);
                                setEditLines(updated);
                              }}
                              className="w-full p-1.5 border border-slate-300 rounded text-end font-mono"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={l.discountAmount}
                              onChange={(e) => {
                                const updated = [...editLines];
                                updated[idx].discountAmount = Math.max(parseFloat(e.target.value) || 0, 0);
                                setEditLines(updated);
                              }}
                              className="w-full p-1.5 border border-slate-300 rounded text-end font-mono"
                            />
                          </td>
                          <td className="p-2 text-end font-mono font-bold text-slate-800">
                            {formatEGP(lineNet)}
                          </td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => setEditLines(editLines.filter((_, i) => i !== idx))}
                              className="p-1 text-rose-600 hover:bg-rose-50 rounded cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">ملاحظات الفاتورة</label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg"
                  placeholder="ملاحظات أو شروط تسليم خاصة..."
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingDraft(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer font-semibold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isEditing || editLines.length === 0}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {isEditing ? 'جارٍ التحديث...' : 'حفظ تعديلات المسودة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Draft Confirm Modal */}
      <ConfirmModal
        isOpen={!!deletingDraft}
        title="تأكيد حذف مسودة فاتورة المبيعات"
        message={`هل أنت متأكد من حذف مسودة فاتورة المبيعات رقم "${deletingDraft?.invoice_number}" نهائياً؟`}
        warning="لن يؤثر حذف المسودة على المخزون أو الحسابات أو كشوف حساب العملاء."
        errorMessage={deleteModalError}
        confirmLabel="نعم، حذف المسودة"
        cancelLabel="إلغاء"
        confirmVariant="danger"
        isLoading={isActionLoading}
        onConfirm={handleConfirmDeleteDraft}
        onCancel={() => {
          setDeletingDraft(null);
          setDeleteModalError(null);
        }}
      />

      {/* Post Draft Confirm Modal */}
      <ConfirmModal
        isOpen={!!postingDraft}
        title="تأكيد ترحيل واعتماد فاتورة المبيعات"
        message={`هل أنت متأكد من ترحيل واعتماد مسودة فاتورة المبيعات رقم "${postingDraft?.invoice_number}"؟`}
        warning="سيتم خصم كميات الأصناف من المستودع تلقائياً وإنشاء القيد المحاسبي المزدوج وإدراجها بكشف حساب العميل."
        errorMessage={postModalError}
        confirmLabel="نعم، اعتماد وترحيل"
        cancelLabel="إلغاء"
        confirmVariant="primary"
        isLoading={isActionLoading}
        onConfirm={handleConfirmPostDraft}
        onCancel={() => {
          setPostingDraft(null);
          setPostModalError(null);
        }}
      />

      {/* Reverse Posted Invoice Modal */}
      {reversingInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">إلغاء وعكس فاتورة المبيعات المرحّلة</h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">{reversingInvoice.invoice_number}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setReversingInvoice(null);
                  setReversalReason('');
                  setReversalError(null);
                }}
                disabled={isActionLoading}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4 space-y-3">
              <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-1.5 border border-slate-200">
                <div className="flex justify-between text-slate-600">
                  <span>العميل:</span>
                  <span className="font-semibold text-slate-800">{reversingInvoice.customer_name}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>تاريخ الفاتورة:</span>
                  <span className="font-mono text-slate-800">{reversingInvoice.invoice_date}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>إجمالي القيمة:</span>
                  <span className="font-bold text-emerald-800 font-mono">{formatEGP(reversingInvoice.total_amount)}</span>
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong>الأثر المحاسبي والرقابي:</strong> سيتم إنشاء قيد يومية عكسي بالأستاذ العام لعكس إيرادات المبيعات وضريبة القيمة المضافة، وإعادة كميات البضاعة المسجلة إلى المستودع، وتعديل رصيد العميل.
                </span>
              </div>

              {reversalError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span className="font-semibold">{reversalError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  سبب الإلغاء والعكس المحاسبي <span className="text-rose-500">* (إلزامي للتدقيق)</span>
                </label>
                <textarea
                  rows={3}
                  value={reversalReason}
                  onChange={(e) => {
                    setReversalReason(e.target.value);
                    if (reversalError) setReversalError(null);
                  }}
                  placeholder="اكتب سبب إلغاء الفاتورة (مثال: خطأ في التسعير، إلغاء أمر التوريد، إلخ)..."
                  className="w-full p-2.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setReversingInvoice(null);
                  setReversalReason('');
                  setReversalError(null);
                }}
                disabled={isActionLoading}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmReverseInvoice}
                disabled={isActionLoading || !reversalReason.trim()}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isActionLoading ? 'جارٍ العكس بالقيد...' : 'تأكيد العكس المحاسبي'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
