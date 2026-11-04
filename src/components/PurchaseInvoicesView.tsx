import React, { useState, useEffect } from 'react';
import {
  ShoppingBag, Plus, Search, Eye, Printer, Filter,
  CheckCircle2, AlertCircle, Building2, Calendar, DollarSign, X, Trash2, Send, Edit, RotateCcw
} from 'lucide-react';
import { PurchaseInvoice, Party, Branch, Warehouse, Item, User } from '../types.ts';
import { apiClient } from '../services/apiClient';
import { ConfirmModal } from './ConfirmModal';

interface PurchaseInvoicesViewProps {
  token: string;
  lang: 'ar' | 'en';
  branches: Branch[];
  warehouses: Warehouse[];
  parties: Party[];
  items: Item[];
  userPermissions: string[];
  currentUser?: User | null;
}

export const PurchaseInvoicesView: React.FC<PurchaseInvoicesViewProps> = ({
  token,
  lang,
  branches,
  warehouses,
  parties,
  items,
  userPermissions,
  currentUser = null
}) => {
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [activeStatusTab, setActiveStatusTab] = useState<'all' | 'posted' | 'draft' | 'paid' | 'reversed'>('all');

  // Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<PurchaseInvoice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // New Invoice Form
  const [formBranchId, setFormBranchId] = useState(branches[0]?.id || 'br_cairo');
  const [formWarehouseId, setFormWarehouseId] = useState(warehouses[0]?.id || 'wh_main');
  const [formSupplierId, setFormSupplierId] = useState(parties.find(p => p.type === 'supplier' || p.type === 'both')?.id || '');
  const [formSupplierInvoiceNumber, setFormSupplierInvoiceNumber] = useState('');
  const [formInvoiceDate, setFormInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [formPaymentType, setFormPaymentType] = useState<'credit' | 'cash'>('credit');
  const [formCashboxId, setFormCashboxId] = useState('cash_cairo');
  const [formLines, setFormLines] = useState<Array<{ itemId: string; quantity: number; unitPrice: number; taxRate: number }>>([
    { itemId: items[0]?.id || '', quantity: 1, unitPrice: items[0]?.cost_price || 100, taxRate: 14 }
  ]);

  // Modular RBAC Permissions
  const isOwner = currentUser?.role === 'owner';
  const perms = userPermissions || currentUser?.permissions || [];
  const canCreate = isOwner || perms.includes('purchases.create') || perms.includes('purchases.edit_draft') || perms.includes('*');
  const canEditDraft = isOwner || perms.includes('purchases.edit_draft') || perms.includes('*');
  const canDeleteDraft = isOwner || perms.includes('purchases.delete_draft') || perms.includes('*');
  const canPost = isOwner || perms.includes('purchases.post') || perms.includes('*');
  const canReverse = isOwner || perms.includes('purchases.reverse') || perms.includes('*');

  const suppliers = parties.filter(p => p.type === 'supplier' || p.type === 'both');

  // Edit Draft Modal State
  const [editingDraft, setEditingDraft] = useState<PurchaseInvoice | null>(null);
  const [editBranchId, setEditBranchId] = useState('');
  const [editWarehouseId, setEditWarehouseId] = useState('');
  const [editSupplierId, setEditSupplierId] = useState('');
  const [editSupplierInvoiceNumber, setEditSupplierInvoiceNumber] = useState('');
  const [editInvoiceDate, setEditInvoiceDate] = useState('');
  const [editPaymentType, setEditPaymentType] = useState<'credit' | 'cash'>('credit');
  const [editLines, setEditLines] = useState<Array<{ itemId: string; quantity: number; unitPrice: number; discountAmount: number; taxRate: number }>>([]);
  const [editNotes, setEditNotes] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Reversal Modal State
  const [reversingInvoice, setReversingInvoice] = useState<PurchaseInvoice | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [reversalError, setReversalError] = useState<string | null>(null);

  // Confirm Modals State
  const [deletingDraft, setDeletingDraft] = useState<PurchaseInvoice | null>(null);
  const [deleteModalError, setDeleteModalError] = useState<string | null>(null);
  const [postingDraft, setPostingDraft] = useState<PurchaseInvoice | null>(null);
  const [postModalError, setPostModalError] = useState<string | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState('');

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get('/purchases/invoices');
      setInvoices(data.invoices || []);
    } catch (err: any) {
      setError(err.message || 'فشل تحميل فواتير المشتريات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, [token]);

  // Compute form totals
  const subtotal = formLines.reduce((acc, line) => acc + (line.quantity * line.unitPrice), 0);
  const vatAmount = subtotal * 0.14;
  const whtAmount = subtotal * 0.01;
  const grandTotal = subtotal + vatAmount - whtAmount;

  const handleAddItemLine = () => {
    const defaultItem = items[0];
    setFormLines([...formLines, { itemId: defaultItem ? defaultItem.id : '', quantity: 1, unitPrice: defaultItem ? (defaultItem.cost_price || defaultItem.sale_price) : 0, taxRate: 14 }]);
  };

  const handleRemoveLine = (idx: number) => {
    if (formLines.length === 1) return;
    setFormLines(formLines.filter((_, i) => i !== idx));
  };

  const handleLineChange = (index: number, field: string, value: any) => {
    const updated = [...formLines];
    if (field === 'itemId') {
      const it = items.find(i => i.id === value);
      updated[index].itemId = value;
      if (it) updated[index].unitPrice = it.cost_price || it.moving_avg_cost || it.sale_price || 0;
    } else {
      (updated[index] as any)[field] = Number(value);
    }
    setFormLines(updated);
  };

  const handleCreateSubmit = async (asDraft: boolean) => {
    setCreateError(null);
    if (formLines.length === 0) {
      setCreateError('يجب إضافة صنف واحد على الأقل');
      return;
    }
    if (!formSupplierId) {
      setCreateError('يرجى اختيار المورد');
      return;
    }

    try {
      setIsSubmitting(true);
      const payload = {
        branchId: formBranchId,
        warehouseId: formWarehouseId,
        supplierId: formSupplierId,
        supplierInvoiceNumber: formSupplierInvoiceNumber || undefined,
        invoiceDate: formInvoiceDate,
        paymentType: formPaymentType,
        status: asDraft ? 'draft' : 'posted',
        cashboxId: formPaymentType === 'cash' ? formCashboxId : undefined,
        items: formLines.map(l => ({
          itemId: l.itemId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate
        }))
      };

      await apiClient.post('/purchases/invoices', payload);
      setIsCreateOpen(false);
      setFormSupplierInvoiceNumber('');
      setFormLines([{ itemId: items[0]?.id || '', quantity: 1, unitPrice: items[0]?.cost_price || 100, taxRate: 14 }]);
      fetchInvoices();
    } catch (err: any) {
      setCreateError(err.message || 'فشل حفظ فاتورة المشتريات');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenEditDraft = async (inv: PurchaseInvoice) => {
    try {
      const data = await apiClient.get(`/purchases/invoices/${inv.id}`);
      const detailed = data.invoice;
      setEditingDraft(detailed);
      setEditBranchId(detailed.branch_id);
      setEditWarehouseId(detailed.warehouse_id);
      setEditSupplierId(detailed.supplier_id);
      setEditSupplierInvoiceNumber(detailed.supplier_invoice_number || '');
      setEditInvoiceDate(detailed.invoice_date);
      setEditPaymentType(detailed.payment_type || 'credit');
      setEditNotes(detailed.notes || '');
      setEditLines(
        (detailed.items || []).map((it: any) => ({
          itemId: it.item_id,
          quantity: it.quantity,
          unitPrice: it.unit_price,
          discountAmount: it.discount_amount || 0,
          taxRate: it.tax_rate !== undefined ? it.tax_rate : 14
        }))
      );
      setError(null);
    } catch (err: any) {
      setError(err.message || 'فشل جلب تفاصيل مسودة الفاتورة');
    }
  };

  const handleUpdateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDraft) return;

    if (editLines.length === 0) {
      setError('يجب إضافة بند واحد على الأقل بالفاتورة.');
      return;
    }

    setIsEditing(true);
    setError(null);

    try {
      await apiClient.put(`/purchases/invoices/${editingDraft.id}`, {
        branchId: editBranchId,
        warehouseId: editWarehouseId,
        supplierId: editSupplierId,
        supplierInvoiceNumber: editSupplierInvoiceNumber || null,
        invoiceDate: editInvoiceDate,
        paymentType: editPaymentType,
        items: editLines,
        notes: editNotes
      });

      setEditingDraft(null);
      setActionSuccessMsg('تم تحديث مسودة فاتورة المشتريات بنجاح.');
      fetchInvoices();
    } catch (err: any) {
      setError(err.message || 'فشل تحديث مسودة فاتورة المشتريات');
    } finally {
      setIsEditing(false);
    }
  };

  const handleConfirmDeleteDraft = async () => {
    if (!deletingDraft) return;
    setIsActionLoading(true);
    setDeleteModalError(null);

    try {
      await apiClient.del(`/purchases/invoices/${deletingDraft.id}`);
      setActionSuccessMsg(`تم حذف مسودة فاتورة المشتريات "${deletingDraft.invoice_number}" بنجاح.`);
      setDeletingDraft(null);
      setDeleteModalError(null);
      fetchInvoices();
    } catch (err: any) {
      setDeleteModalError(err.message || 'فشل حذف مسودة فاتورة المشتريات');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleConfirmPostDraft = async () => {
    if (!postingDraft) return;
    setIsActionLoading(true);
    setPostModalError(null);

    try {
      await apiClient.post(`/purchases/invoices/${postingDraft.id}/post`);
      setActionSuccessMsg(`تم ترحيل واعتماد فاتورة المشتريات "${postingDraft.invoice_number}" بنجاح.`);
      setPostingDraft(null);
      setPostModalError(null);
      fetchInvoices();
    } catch (err: any) {
      setPostModalError(err.message || 'فشل ترحيل فاتورة المشتريات');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleConfirmReverseInvoice = async () => {
    if (!reversingInvoice) return;
    if (!reversalReason.trim()) {
      setReversalError('يرجى توضيح سبب إلغاء وتصحيح فاتورة الشراء المرحّلة.');
      return;
    }
    setIsActionLoading(true);
    setReversalError(null);

    try {
      await apiClient.post(`/purchases/invoices/${reversingInvoice.id}/reverse`, {
        reason: reversalReason.trim()
      });
      setActionSuccessMsg(`تم إلغاء وعكس فاتورة المشتريات "${reversingInvoice.invoice_number}" بنجاح وخصم البضاعة من المخزن.`);
      setReversingInvoice(null);
      setReversalReason('');
      fetchInvoices();
    } catch (err: any) {
      setReversalError(err.message || 'فشل إلغاء وعكس فاتورة الشراء');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Filtered invoices
  const filtered = invoices.filter(inv => {
    const matchesStatus =
      activeStatusTab === 'all' ||
      (activeStatusTab === 'posted' && (inv.status === 'posted' || inv.status === 'partially_paid' || inv.status === 'paid')) ||
      (activeStatusTab === 'draft' && inv.status === 'draft') ||
      (activeStatusTab === 'paid' && inv.status === 'paid') ||
      (activeStatusTab === 'reversed' && inv.status === 'reversed');

    const matchesSearch = inv.invoice_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inv.supplier_name && inv.supplier_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (inv.supplier_invoice_number && inv.supplier_invoice_number.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesBranch = selectedBranch === 'all' || inv.branch_id === selectedBranch;
    return matchesStatus && matchesSearch && matchesBranch;
  });

  const totalPurchases = invoices.reduce((acc, i) => acc + (i.total_amount || 0), 0);
  const totalPaid = invoices.reduce((acc, i) => acc + (i.paid_amount || 0), 0);
  const totalRemaining = invoices.reduce((acc, i) => acc + (i.remaining_amount || 0), 0);

  return (
    <div className="space-y-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-800/60 p-5 rounded-2xl border border-slate-700/60">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-emerald-400" />
            <span>{lang === 'ar' ? 'فواتير المشتريات والتوريدات' : 'Purchase Invoices & Orders'}</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {lang === 'ar'
              ? 'إدارة مشتريات البضاعة، تحديث تكلفة المخزون بالمتوسط المرجح، دعم المسودات، وحساب ضريبة المدخلات 14% والخصم والتحصيل 1%'
              : 'Manage procurement bills, weighted-average costing updates, input VAT 14% and WHT 1%'}
          </p>
        </div>

        {canCreate && (
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl text-sm transition shadow-lg shadow-emerald-950/40"
          >
            <Plus className="w-4 h-4" />
            <span>{lang === 'ar' ? 'فاتورة مشتريات جديدة' : 'New Purchase Invoice'}</span>
          </button>
        )}
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
          <p className="text-xs text-slate-400 mb-1">{lang === 'ar' ? 'إجمالي المشتريات' : 'Total Purchases'}</p>
          <p className="text-lg font-bold text-white">{totalPurchases.toLocaleString('ar-EG')} ج.م</p>
        </div>
        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
          <p className="text-xs text-slate-400 mb-1">{lang === 'ar' ? 'المسدد للموردين' : 'Paid to Suppliers'}</p>
          <p className="text-lg font-bold text-emerald-400">{totalPaid.toLocaleString('ar-EG')} ج.م</p>
        </div>
        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
          <p className="text-xs text-slate-400 mb-1">{lang === 'ar' ? 'مستحقات آجلة للموردين' : 'Accounts Payable'}</p>
          <p className="text-lg font-bold text-amber-400">{totalRemaining.toLocaleString('ar-EG')} ج.م</p>
        </div>
        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
          <p className="text-xs text-slate-400 mb-1">{lang === 'ar' ? 'عدد الفواتير' : 'Invoices Count'}</p>
          <p className="text-lg font-bold text-blue-400">{invoices.length}</p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex bg-slate-800/70 p-1 rounded-xl border border-slate-700/60 w-full sm:w-auto overflow-x-auto">
          <button
            onClick={() => setActiveStatusTab('all')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
              activeStatusTab === 'all' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            الكل ({invoices.length})
          </button>
          <button
            onClick={() => setActiveStatusTab('posted')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
              activeStatusTab === 'posted' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            مرحلة ({invoices.filter(i => i.status === 'posted' || i.status === 'paid' || i.status === 'partially_paid').length})
          </button>
          <button
            onClick={() => setActiveStatusTab('draft')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
              activeStatusTab === 'draft' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            مسودات ({invoices.filter(i => i.status === 'draft').length})
          </button>
          <button
            onClick={() => setActiveStatusTab('paid')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
              activeStatusTab === 'paid' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            مسددة بالكامل ({invoices.filter(i => i.status === 'paid').length})
          </button>
          <button
            onClick={() => setActiveStatusTab('reversed')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
              activeStatusTab === 'reversed' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            معكوسة ({invoices.filter(i => i.status === 'reversed').length})
          </button>
        </div>

        <div className="relative flex-1 max-w-md w-full">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder={lang === 'ar' ? 'بحث برقم الفاتورة، اسم المورد، أو فاتورة المورد...' : 'Search invoice number, supplier...'}
            className="w-full bg-slate-800/70 border border-slate-700 rounded-xl px-9 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={selectedBranch}
            onChange={e => setSelectedBranch(e.target.value)}
            className="bg-slate-800/70 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value="all">{lang === 'ar' ? 'كافة الفروع' : 'All Branches'}</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name_ar}</option>
            ))}
          </select>
        </div>
      </div>

      {actionSuccessMsg && (
        <div className="p-3 bg-emerald-500/20 text-emerald-300 text-xs rounded-xl border border-emerald-500/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{actionSuccessMsg}</span>
          </div>
          <button onClick={() => setActionSuccessMsg('')} className="cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-500/20 text-rose-300 text-xs rounded-xl border border-rose-500/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Invoices Table */}
      <div className="bg-slate-800/60 rounded-2xl border border-slate-700/60 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-900/60 text-slate-300 border-b border-slate-700/80 text-xs">
              <tr>
                <th className="py-3 px-4">{lang === 'ar' ? 'رقم الفاتورة' : 'Invoice #'}</th>
                <th className="py-3 px-4">{lang === 'ar' ? 'المورد' : 'Supplier'}</th>
                <th className="py-3 px-4">{lang === 'ar' ? 'الفرع / المخزن' : 'Branch / WH'}</th>
                <th className="py-3 px-4">{lang === 'ar' ? 'التاريخ' : 'Date'}</th>
                <th className="py-3 px-4">{lang === 'ar' ? 'الدفع' : 'Payment'}</th>
                <th className="py-3 px-4">{lang === 'ar' ? 'الإجمالي' : 'Total'}</th>
                <th className="py-3 px-4">{lang === 'ar' ? 'المسدد' : 'Paid'}</th>
                <th className="py-3 px-4">{lang === 'ar' ? 'المتبقي' : 'Remaining'}</th>
                <th className="py-3 px-4">{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                <th className="py-3 px-4 text-center">{lang === 'ar' ? 'الإجراءات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40 text-slate-200 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-slate-400">
                    {lang === 'ar' ? 'جارٍ تحميل فواتير المشتريات...' : 'Loading purchase invoices...'}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-slate-400">
                    {lang === 'ar' ? 'لا توجد فواتير مشتريات مطابقة' : 'No purchase invoices found'}
                  </td>
                </tr>
              ) : (
                filtered.map(inv => (
                  <tr key={inv.id} className="hover:bg-slate-700/30 transition">
                    <td className="py-3 px-4 font-mono font-medium text-emerald-400">
                      <div>{inv.invoice_number}</div>
                      {inv.supplier_invoice_number && (
                        <span className="block text-xs text-slate-400">({inv.supplier_invoice_number})</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-medium">{inv.supplier_name}</td>
                    <td className="py-3 px-4 text-xs text-slate-300">
                      <div>{inv.branch_name}</div>
                      <div className="text-slate-400">{inv.warehouse_name}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-300">{inv.invoice_date}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        inv.payment_type === 'cash' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-blue-500/20 text-blue-300'
                      }`}>
                        {inv.payment_type === 'cash' ? (lang === 'ar' ? 'نقدي' : 'Cash') : (lang === 'ar' ? 'آجل' : 'Credit')}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-bold text-white">{inv.total_amount.toLocaleString('ar-EG')} ج.م</td>
                    <td className="py-3 px-4 text-emerald-400">{inv.paid_amount.toLocaleString('ar-EG')} ج.م</td>
                    <td className="py-3 px-4 text-amber-400 font-semibold">{inv.remaining_amount.toLocaleString('ar-EG')} ج.م</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1 w-fit ${
                        inv.status === 'draft'
                          ? 'bg-amber-500/20 text-amber-300'
                          : inv.status === 'paid'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : inv.status === 'partially_paid'
                          ? 'bg-sky-500/20 text-sky-300'
                          : inv.status === 'reversed'
                          ? 'bg-rose-500/20 text-rose-300 line-through'
                          : 'bg-blue-500/20 text-blue-300'
                      }`}>
                        <CheckCircle2 className="w-3 h-3" />
                        <span>
                          {inv.status === 'draft'
                            ? 'مسودة'
                            : inv.status === 'paid'
                            ? 'مسددة'
                            : inv.status === 'partially_paid'
                            ? 'مسددة جزئياً'
                            : inv.status === 'reversed'
                            ? 'معكوسة'
                            : 'مرحلة'}
                        </span>
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => setSelectedInvoice(inv)}
                          className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition cursor-pointer"
                          title="عرض تفاصيل الفاتورة"
                        >
                          <Eye className="w-4 h-4" />
                        </button>

                        {inv.status === 'draft' ? (
                          <>
                            {canEditDraft && (
                              <button
                                onClick={() => handleOpenEditDraft(inv)}
                                className="p-1.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition cursor-pointer"
                                title="تعديل المسودة"
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
                                className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition cursor-pointer"
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
                                className="p-1.5 rounded-lg bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 transition cursor-pointer"
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
                                className="p-1.5 rounded-lg bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 transition cursor-pointer"
                                title="إلغاء وعكس فاتورة الشراء المرحّلة (إجراء محاسبي مع قيد عكسي)"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: New Purchase Invoice */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-4xl p-6 shadow-2xl relative my-8">
            <button
              onClick={() => setIsCreateOpen(false)}
              className="absolute left-6 top-6 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-400" />
              <span>{lang === 'ar' ? 'إنشاء فاتورة مشتريات جديدة' : 'Create New Purchase Invoice'}</span>
            </h3>

            {createError && (
              <div className="p-3 mb-4 bg-rose-500/20 text-rose-300 text-xs rounded-xl border border-rose-500/30 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{createError}</span>
              </div>
            )}

            <div className="space-y-4 text-xs">
              {/* Top Row Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1">{lang === 'ar' ? 'المورد *' : 'Supplier *'}</label>
                  <select
                    required
                    value={formSupplierId}
                    onChange={e => setFormSupplierId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="">{lang === 'ar' ? '-- اختر المورد --' : '-- Select Supplier --'}</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name_ar}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 mb-1">{lang === 'ar' ? 'الفرع *' : 'Branch *'}</label>
                  <select
                    value={formBranchId}
                    onChange={e => setFormBranchId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  >
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name_ar}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 mb-1">{lang === 'ar' ? 'المستودع المستلم *' : 'Warehouse *'}</label>
                  <select
                    value={formWarehouseId}
                    onChange={e => setFormWarehouseId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  >
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name_ar}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Second Row Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1">{lang === 'ar' ? 'رقم فاتورة المورد (اختياري)' : 'Supplier Bill #'}</label>
                  <input
                    type="text"
                    value={formSupplierInvoiceNumber}
                    onChange={e => setFormSupplierInvoiceNumber(e.target.value)}
                    placeholder="e.g. SUP-INV-9988"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 mb-1">{lang === 'ar' ? 'تاريخ الفاتورة *' : 'Date *'}</label>
                  <input
                    type="date"
                    required
                    value={formInvoiceDate}
                    onChange={e => setFormInvoiceDate(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 mb-1">{lang === 'ar' ? 'طريقة السداد *' : 'Payment Type *'}</label>
                  <select
                    value={formPaymentType}
                    onChange={e => setFormPaymentType(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="credit">{lang === 'ar' ? 'آجل على الحساب' : 'Credit / Payable'}</option>
                    <option value="cash">{lang === 'ar' ? 'نقدي فوري من الخزينة' : 'Cash'}</option>
                  </select>
                </div>
              </div>

              {/* Line Items */}
              <div className="border border-slate-700 rounded-xl p-3 bg-slate-900/40 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-white">{lang === 'ar' ? 'بنود وأصناف الفاتورة' : 'Items Table'}</span>
                  <button
                    type="button"
                    onClick={handleAddItemLine}
                    className="text-xs bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 px-3 py-1.5 rounded-lg flex items-center gap-1 transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{lang === 'ar' ? 'إضافة سطر' : 'Add Item'}</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {formLines.map((line, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-slate-800/80 p-2.5 rounded-lg">
                      <div className="col-span-5">
                        <select
                          value={line.itemId}
                          onChange={e => handleLineChange(idx, 'itemId', e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white"
                        >
                          {items.map(it => (
                            <option key={it.id} value={it.id}>{it.name_ar} ({it.code})</option>
                          ))}
                        </select>
                      </div>

                      <div className="col-span-2">
                        <input
                          type="number"
                          min="1"
                          value={line.quantity}
                          onChange={e => handleLineChange(idx, 'quantity', e.target.value)}
                          placeholder="الكمية"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white text-center font-mono"
                        />
                      </div>

                      <div className="col-span-3">
                        <input
                          type="number"
                          step="0.01"
                          value={line.unitPrice}
                          onChange={e => handleLineChange(idx, 'unitPrice', e.target.value)}
                          placeholder="سعر الوحدة"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white text-center font-mono"
                        />
                      </div>

                      <div className="col-span-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveLine(idx)}
                          className="text-slate-400 hover:text-rose-400 p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-700 space-y-2">
                <div className="flex justify-between text-slate-300">
                  <span>الإجمالي قبل الضريبة:</span>
                  <span className="font-mono">{subtotal.toLocaleString('ar-EG')} ج.م</span>
                </div>
                <div className="flex justify-between text-emerald-400">
                  <span>ضريبة القيمة المضافة (14%):</span>
                  <span className="font-mono">+{vatAmount.toLocaleString('ar-EG')} ج.م</span>
                </div>
                <div className="flex justify-between text-amber-400">
                  <span>ضريبة الخصم والتحصيل من المنبع (1%):</span>
                  <span className="font-mono">-{whtAmount.toLocaleString('ar-EG')} ج.م</span>
                </div>
                <div className="flex justify-between text-white font-bold text-base border-t border-slate-700 pt-2">
                  <span>صافي المستحق للمورد:</span>
                  <span className="text-emerald-400 font-mono">{grandTotal.toLocaleString('ar-EG')} ج.م</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-700">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-300 hover:bg-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleCreateSubmit(true)}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold"
                >
                  {isSubmitting ? 'جارٍ الحفظ...' : 'حفظ كمسودة (Draft)'}
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleCreateSubmit(false)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold"
                >
                  {isSubmitting ? 'جارٍ الترحيل...' : 'ترحيل واعتماد فوري (Post)'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Edit Purchase Invoice Draft Modal */}
      {editingDraft && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-2xl max-w-4xl w-full border border-slate-800 shadow-2xl p-6 text-slate-200 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit className="w-5 h-5 text-amber-400" />
                <span>تعديل مسودة فاتورة المشتريات: {editingDraft.invoice_number}</span>
              </h3>
              <button onClick={() => setEditingDraft(null)} className="text-slate-400 hover:text-white cursor-pointer">✕</button>
            </div>

            {error && (
              <div className="p-3 my-4 bg-rose-500/20 border border-rose-500/40 text-rose-300 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleUpdateDraft} className="space-y-4 pt-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">الفرع *</label>
                  <select
                    value={editBranchId}
                    onChange={(e) => setEditBranchId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-white"
                    required
                  >
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name_ar}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">المستودع المستلم *</label>
                  <select
                    value={editWarehouseId}
                    onChange={(e) => setEditWarehouseId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-white"
                    required
                  >
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name_ar}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">المورد *</label>
                  <select
                    value={editSupplierId}
                    onChange={(e) => setEditSupplierId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-white"
                    required
                  >
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name_ar} ({s.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">رقم فاتورة المورد</label>
                  <input
                    type="text"
                    value={editSupplierInvoiceNumber}
                    onChange={(e) => setEditSupplierInvoiceNumber(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-white font-mono"
                    placeholder="INV-SUPP-..."
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">تاريخ الفاتورة</label>
                  <input
                    type="date"
                    value={editInvoiceDate}
                    onChange={(e) => setEditInvoiceDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-white font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">نوع السداد</label>
                  <select
                    value={editPaymentType}
                    onChange={(e) => setEditPaymentType(e.target.value as any)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-white"
                  >
                    <option value="credit">آجل (ذمم دائنة)</option>
                    <option value="cash">نقدي فوري</option>
                  </select>
                </div>
              </div>

              {/* Items Table */}
              <div className="border border-slate-800 rounded-xl overflow-hidden mt-4">
                <div className="bg-slate-800/80 p-2.5 flex justify-between items-center border-b border-slate-800">
                  <span className="font-bold text-white">بنود الفاتورة ({editLines.length})</span>
                  <button
                    type="button"
                    onClick={() => {
                      const def = items[0];
                      if (def) {
                        setEditLines([...editLines, { itemId: def.id, quantity: 1, unitPrice: def.cost_price || 100, discountAmount: 0, taxRate: 14 }]);
                      }
                    }}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    إضافة صنف
                  </button>
                </div>

                <table className="w-full text-xs">
                  <thead className="bg-slate-800 text-slate-400 font-bold border-b border-slate-700">
                    <tr>
                      <th className="p-2 text-start">الصنف</th>
                      <th className="p-2 text-center w-20">الكمية</th>
                      <th className="p-2 text-center w-28">سعر الشراء</th>
                      <th className="p-2 text-center w-24">الخصم</th>
                      <th className="p-2 text-end w-28">الإجمالي</th>
                      <th className="p-2 text-center w-12">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {editLines.map((l, idx) => {
                      const lineNet = (l.quantity || 0) * (l.unitPrice || 0) - (l.discountAmount || 0);
                      const lineTax = lineNet * ((l.taxRate || 14) / 100);
                      const lineTotal = lineNet + lineTax;
                      return (
                        <tr key={idx}>
                          <td className="p-2">
                            <select
                              value={l.itemId}
                              onChange={(e) => {
                                const matched = items.find(i => i.id === e.target.value);
                                const updated = [...editLines];
                                updated[idx].itemId = e.target.value;
                                if (matched) updated[idx].unitPrice = matched.cost_price || 0;
                                setEditLines(updated);
                              }}
                              className="w-full bg-slate-800 border border-slate-700 rounded p-1.5 text-white"
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
                              className="w-full bg-slate-800 border border-slate-700 rounded p-1.5 text-center font-mono text-white"
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
                              className="w-full bg-slate-800 border border-slate-700 rounded p-1.5 text-end font-mono text-white"
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
                              className="w-full bg-slate-800 border border-slate-700 rounded p-1.5 text-end font-mono text-white"
                            />
                          </td>
                          <td className="p-2 text-end font-mono font-bold text-emerald-400">
                            {lineTotal.toLocaleString('ar-EG')} ج.م
                          </td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => setEditLines(editLines.filter((_, i) => i !== idx))}
                              className="p-1 text-rose-400 hover:bg-rose-500/20 rounded cursor-pointer"
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
                <label className="block text-slate-300 font-medium mb-1">ملاحظات الفاتورة</label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-white"
                  placeholder="ملاحظات الاستلام والفحص..."
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingDraft(null)}
                  className="px-4 py-2 border border-slate-700 text-slate-300 rounded-xl hover:bg-slate-800 cursor-pointer font-semibold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isEditing || editLines.length === 0}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold disabled:opacity-50 cursor-pointer"
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
        title="تأكيد حذف مسودة فاتورة المشتريات"
        message={`هل أنت متأكد من حذف مسودة فاتورة المشتريات رقم "${deletingDraft?.invoice_number}" نهائياً؟`}
        warning="لن يؤثر حذف المسودة على المخزون أو الحسابات أو كشوف حساب الموردين."
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
        title="تأكيد ترحيل واعتماد فاتورة المشتريات"
        message={`هل أنت متأكد من اعتماد وترحيل مسودة فاتورة المشتريات رقم "${postingDraft?.invoice_number}"؟`}
        warning="سيتم إضافة كميات الأصناف للمستودع وإعادة حساب التكلفة المرجحة وإنشاء القيد المزدوج تلقائياً."
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

      {/* Reverse Posted Purchase Invoice Modal */}
      {reversingInvoice && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl max-w-lg w-full p-6 animate-in fade-in zoom-in-95 text-white">
            <div className="flex items-start justify-between pb-3 border-b border-slate-700">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-300 flex items-center justify-center">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">إلغاء وعكس فاتورة المشتريات المرحّلة</h3>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">{reversingInvoice.invoice_number}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setReversingInvoice(null);
                  setReversalReason('');
                  setReversalError(null);
                }}
                disabled={isActionLoading}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4 space-y-3">
              <div className="p-3 bg-slate-900/60 rounded-xl text-xs space-y-1.5 border border-slate-700/60">
                <div className="flex justify-between text-slate-400">
                  <span>المورد:</span>
                  <span className="font-semibold text-white">{reversingInvoice.supplier_name}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>تاريخ الفاتورة:</span>
                  <span className="font-mono text-white">{reversingInvoice.invoice_date}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>إجمالي القيمة:</span>
                  <span className="font-bold text-emerald-400 font-mono">{reversingInvoice.total_amount?.toLocaleString('ar-EG')} ج.م</span>
                </div>
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] text-amber-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong>الأثر المحاسبي والمخزني:</strong> سيتم إنشاء قيد يومية عكسي بالأستاذ العام لعكس استحقاق المورد وضريبة المدخلات، وسحب كميات البضاعة الواردة من المستودع، وتعديل رصيد المورد.
                </span>
              </div>

              {reversalError && (
                <div className="p-3 bg-rose-500/20 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span className="font-semibold">{reversalError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  سبب الإلغاء والعكس المحاسبي <span className="text-rose-400">* (إلزامي للرقابة)</span>
                </label>
                <textarea
                  rows={3}
                  value={reversalReason}
                  onChange={(e) => {
                    setReversalReason(e.target.value);
                    if (reversalError) setReversalError(null);
                  }}
                  placeholder="اكتب سبب إلغاء وتصحيح فاتورة الشراء (مثال: خطأ في تسعير المورد، بضاعة غير مطابقة، إلخ)..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-rose-500 placeholder-slate-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-700">
              <button
                type="button"
                onClick={() => {
                  setReversingInvoice(null);
                  setReversalReason('');
                  setReversalError(null);
                }}
                disabled={isActionLoading}
                className="px-4 py-2 border border-slate-700 text-slate-300 text-xs font-semibold rounded-xl hover:bg-slate-700 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmReverseInvoice}
                disabled={isActionLoading || !reversalReason.trim()}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl shadow-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
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
