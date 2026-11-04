import React, { useState, useEffect } from 'react';
import {
  RotateCcw, Plus, Search, Eye, Printer, CheckCircle2, AlertCircle, X,
  ArrowLeftRight, Edit, Trash2, Clock, FileCheck2
} from 'lucide-react';
import { SalesReturn, SalesInvoice, Warehouse } from '../types.ts';
import { apiClient } from '../services/apiClient';
import { ConfirmModal } from './ConfirmModal';

interface SalesReturnsViewProps {
  token?: string;
  lang: 'ar' | 'en';
  warehouses: Warehouse[];
  userPermissions: string[];
}

export const SalesReturnsView: React.FC<SalesReturnsViewProps> = ({
  token,
  lang,
  warehouses,
  userPermissions
}) => {
  const [returns, setReturns] = useState<SalesReturn[]>([]);
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusTab, setStatusTab] = useState<'all' | 'posted' | 'draft'>('all');

  // Create Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [selectedInvoiceDetails, setSelectedInvoiceDetails] = useState<any | null>(null);
  const [formWarehouseId, setFormWarehouseId] = useState(warehouses[0]?.id || 'wh_main');
  const [formRefundType, setFormRefundType] = useState<'credit_note' | 'cash'>('credit_note');
  const [formNotes, setFormNotes] = useState('');
  const [returnItems, setReturnItems] = useState<Array<{ itemId: string; name: string; soldQty: number; alreadyReturned: number; returnQty: number; unitPrice: number; costPrice: number }>>([]);

  // Edit Draft Modal State
  const [editingReturn, setEditingReturn] = useState<any | null>(null);
  const [editReturnItems, setEditReturnItems] = useState<Array<{ itemId: string; name: string; returnQty: number; unitPrice: number }>>([]);
  const [editNotes, setEditNotes] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Delete State
  const [deletingReturn, setDeletingReturn] = useState<SalesReturn | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // View Details Modal State
  const [viewingReturn, setViewingReturn] = useState<any | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Posting State
  const [postingId, setPostingId] = useState<string | null>(null);

  const canCreate = userPermissions.includes('create_sales_invoice') || userPermissions.includes('manage_settings') || userPermissions.includes('add');

  const fetchReturns = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get('/sales/returns');
      setReturns(data.returns || []);
    } catch (err: any) {
      setError(err.message || 'فشل تحميل مردودات المبيعات');
    } finally {
      setLoading(false);
    }
  };

  const fetchInvoices = async () => {
    try {
      const data = await apiClient.get('/sales/invoices');
      setInvoices(data.invoices || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchReturns();
    fetchInvoices();
  }, [token]);

  const handleSelectInvoice = async (invoiceId: string) => {
    setSelectedInvoiceId(invoiceId);
    if (!invoiceId) {
      setSelectedInvoiceDetails(null);
      setReturnItems([]);
      return;
    }

    try {
      const data = await apiClient.get(`/sales/invoices/${invoiceId}`);
      setSelectedInvoiceDetails(data.invoice);
      setFormWarehouseId(data.invoice.warehouse_id || warehouses[0]?.id || 'wh_main');

      const itemsList = (data.invoice.items || []).map((it: any) => ({
        itemId: it.item_id,
        name: it.item_name || it.item_code,
        soldQty: it.quantity,
        alreadyReturned: it.returned_quantity || 0,
        returnQty: 0,
        unitPrice: it.unit_price,
        costPrice: it.cost_price || 0
      }));
      setReturnItems(itemsList);
    } catch (err: any) {
      setError(err.message || 'فشل تحميل تفاصيل الفاتورة');
    }
  };

  const handleQtyChange = (index: number, val: number) => {
    const updated = [...returnItems];
    const maxAllowed = updated[index].soldQty - updated[index].alreadyReturned;
    const clamped = Math.max(0, Math.min(val, maxAllowed));
    updated[index].returnQty = clamped;
    setReturnItems(updated);
  };

  const handleCreateSubmit = async (status: 'draft' | 'posted') => {
    const activeItems = returnItems
      .filter(it => it.returnQty > 0)
      .map(it => ({
        itemId: it.itemId,
        quantity: it.returnQty
      }));

    if (activeItems.length === 0) {
      setError('يرجى تحديد كمية للإرجاع في صنف واحد على الأقل.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const payload = {
        originalInvoiceId: selectedInvoiceId,
        warehouseId: formWarehouseId,
        returnDate: new Date().toISOString().split('T')[0],
        refundType: formRefundType,
        items: activeItems,
        notes: formNotes || null,
        status
      };

      const res = await apiClient.post('/sales/returns', payload);
      setIsCreateOpen(false);
      setSelectedInvoiceId('');
      setSelectedInvoiceDetails(null);
      setReturnItems([]);
      setFormNotes('');
      setSuccessMsg(res.message || (status === 'draft' ? 'تم حفظ مسودة مردود المبيعات بنجاح.' : 'تم ترحيل واعتماد مردود المبيعات بنجاح.'));
      fetchReturns();
      fetchInvoices();
    } catch (err: any) {
      setError(err.message || 'فشل حفظ مردود المبيعات');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenEditDraft = async (ret: SalesReturn) => {
    try {
      setLoadingDetails(true);
      const data = await apiClient.get(`/sales/returns/${ret.id}`);
      setEditingReturn(data.returnDoc);
      setEditNotes(data.returnDoc.notes || '');
      setEditReturnItems(
        (data.returnDoc.items || []).map((it: any) => ({
          itemId: it.item_id,
          name: it.item_name || it.item_code,
          returnQty: it.quantity,
          unitPrice: it.unit_price
        }))
      );
    } catch (err: any) {
      setError(err.message || 'فشل تحميل بيانات المسودة للتعديل');
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleSaveEditDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingReturn) return;

    try {
      setIsEditing(true);
      setError(null);
      await apiClient.put(`/sales/returns/${editingReturn.id}`, {
        notes: editNotes,
        items: editReturnItems.map(it => ({
          itemId: it.itemId,
          quantity: it.returnQty
        }))
      });

      setEditingReturn(null);
      setSuccessMsg('تم تحديث مسودة مردود المبيعات بنجاح.');
      fetchReturns();
    } catch (err: any) {
      setError(err.message || 'فشل تحديث مسودة مردود المبيعات');
    } finally {
      setIsEditing(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingReturn) return;
    try {
      setIsDeleting(true);
      setError(null);
      await apiClient.del(`/sales/returns/${deletingReturn.id}`);
      setSuccessMsg(`تم حذف مسودة مردود المبيعات "${deletingReturn.return_number}" بنجاح.`);
      setDeletingReturn(null);
      fetchReturns();
    } catch (err: any) {
      setError(err.message || 'فشل حذف مسودة مردود المبيعات');
    } finally {
      setIsDeleting(false);
    }
  };

  const handlePostDraft = async (ret: SalesReturn) => {
    try {
      setPostingId(ret.id);
      setError(null);
      const res = await apiClient.post(`/sales/returns/${ret.id}/post`);
      setSuccessMsg(res.message || 'تم اعتماد وترحيل مردود المبيعات بنجاح.');
      fetchReturns();
      fetchInvoices();
    } catch (err: any) {
      setError(err.message || 'فشل ترحيل واعتماد مردود المبيعات');
    } finally {
      setPostingId(null);
    }
  };

  const handleOpenViewDetails = async (ret: SalesReturn) => {
    try {
      setLoadingDetails(true);
      const data = await apiClient.get(`/sales/returns/${ret.id}`);
      setViewingReturn(data.returnDoc);
    } catch (err: any) {
      setError(err.message || 'فشل تحميل تفاصيل المردود');
    } finally {
      setLoadingDetails(false);
    }
  };

  const filtered = returns.filter(r => {
    const matchesTab =
      statusTab === 'all' ||
      (statusTab === 'posted' && r.status === 'posted') ||
      (statusTab === 'draft' && r.status === 'draft');

    const matchesSearch =
      r.return_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.original_invoice_number && r.original_invoice_number.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (r.customer_name && r.customer_name.toLowerCase().includes(searchTerm.toLowerCase()));

    return matchesTab && matchesSearch;
  });

  return (
    <div className="space-y-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Alert Messages */}
      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-600 hover:text-emerald-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-600 hover:text-rose-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-800/60 p-5 rounded-2xl border border-slate-700/60">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <RotateCcw className="w-6 h-6 text-amber-400" />
            <span>{lang === 'ar' ? 'مردودات المبيعات وإشعارات الخصم' : 'Sales Returns & Credit Notes'}</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            دورة كاملة للمردودات: حفظ كمسودة، تعديل، حذف، واعتماد وترحيل تلقائي مع تحديث المخزون وقيد اليومية وتخفيض مديونية العميل.
          </p>
        </div>

        {canCreate && (
          <button
            onClick={() => {
              setIsCreateOpen(true);
              setError(null);
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-xl text-sm transition shadow-lg shadow-amber-950/40"
          >
            <Plus className="w-4 h-4" />
            <span>{lang === 'ar' ? 'إنشاء مردود مبيعات' : 'New Sales Return'}</span>
          </button>
        )}
      </div>

      {/* Tabs & Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-800/60 p-3 rounded-2xl border border-slate-700/60">
        <div className="flex bg-slate-900/60 p-1 rounded-xl w-full sm:w-auto">
          <button
            onClick={() => setStatusTab('all')}
            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${
              statusTab === 'all' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            الكل ({returns.length})
          </button>
          <button
            onClick={() => setStatusTab('posted')}
            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${
              statusTab === 'posted' ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            المرحلة ({returns.filter(r => r.status === 'posted').length})
          </button>
          <button
            onClick={() => setStatusTab('draft')}
            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${
              statusTab === 'draft' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            المسودات ({returns.filter(r => r.status === 'draft').length})
          </button>
        </div>

        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="بحث برقم المردود، رقم الفاتورة الأصلية، العميل..."
            className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pr-9 pl-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-amber-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-800/60 rounded-2xl border border-slate-700/60 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-900/60 text-slate-300 border-b border-slate-700/80">
              <tr>
                <th className="py-3 px-4">رقم المردود</th>
                <th className="py-3 px-4">الفاتورة الأصلية</th>
                <th className="py-3 px-4">العميل</th>
                <th className="py-3 px-4">التاريخ</th>
                <th className="py-3 px-4">الحالة</th>
                <th className="py-3 px-4">طريقة الرد</th>
                <th className="py-3 px-4 text-end">المبلغ المسترد</th>
                <th className="py-3 px-4 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40 text-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    <div className="inline-block w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mb-2" />
                    <p>جارٍ تحميل مردودات المبيعات...</p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    لا توجد مردودات مبيعات مسجلة في هذا القسم.
                  </td>
                </tr>
              ) : (
                filtered.map(ret => (
                  <tr key={ret.id} className="hover:bg-slate-700/30 transition">
                    <td className="py-3 px-4 font-mono font-bold text-amber-400">{ret.return_number}</td>
                    <td className="py-3 px-4 font-mono text-emerald-400">{ret.original_invoice_number || 'فاتورة مسجلة'}</td>
                    <td className="py-3 px-4 font-medium">{ret.customer_name}</td>
                    <td className="py-3 px-4 font-mono text-slate-300">{ret.return_date}</td>
                    <td className="py-3 px-4">
                      {ret.status === 'draft' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1 w-max">
                          <Clock className="w-3 h-3" />
                          <span>مسودة</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 w-max">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>مرحل ومعتمد</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        ret.refund_type === 'cash' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-blue-500/20 text-blue-300'
                      }`}>
                        {ret.refund_type === 'cash' ? 'رد نقدي' : 'إشعار دائن'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-end font-bold text-white font-mono">
                      {(ret.total_amount || 0).toLocaleString('ar-EG')} ج.م
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => handleOpenViewDetails(ret)}
                          className="p-1 text-slate-300 hover:text-white border border-slate-700 hover:bg-slate-700 rounded transition"
                          title="عرض التفاصيل"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>

                        {ret.status === 'draft' && (
                          <>
                            <button
                              onClick={() => handlePostDraft(ret)}
                              disabled={postingId === ret.id}
                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold flex items-center gap-1 transition"
                              title="اعتماد وترحيل المردود"
                            >
                              <FileCheck2 className="w-3.5 h-3.5" />
                              <span>{postingId === ret.id ? 'جارٍ...' : 'ترحيل'}</span>
                            </button>

                            <button
                              onClick={() => handleOpenEditDraft(ret)}
                              className="p-1 text-sky-300 hover:text-white border border-sky-700 hover:bg-sky-900/40 rounded transition"
                              title="تعديل المسودة"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => setDeletingReturn(ret)}
                              className="p-1 text-rose-400 hover:text-white border border-rose-800 hover:bg-rose-900/40 rounded transition"
                              title="حذف المسودة"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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

      {/* Create Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-2xl max-w-2xl w-full border border-slate-800 shadow-2xl p-6 text-slate-200 max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-amber-400" />
                <span>إصدار مردود مبيعات جديد</span>
              </h3>
              <button onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-4 pr-1 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">اختر فاتورة المبيعات الأصلية المراد ردها *</label>
                <select
                  value={selectedInvoiceId}
                  onChange={e => handleSelectInvoice(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-white"
                >
                  <option value="">-- اضغط لتحديد الفاتورة --</option>
                  {invoices.filter(i => i.status === 'posted' || i.status === 'paid').map(inv => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoice_number} - {inv.customer_name} ({inv.invoice_date}) - {inv.total_amount.toLocaleString()} ج.م
                    </option>
                  ))}
                </select>
              </div>

              {selectedInvoiceDetails && (
                <>
                  <div className="grid grid-cols-2 gap-3 p-3 bg-slate-800/60 rounded-xl border border-slate-700">
                    <div>
                      <span className="text-slate-400 block text-[11px]">العميل:</span>
                      <span className="font-bold text-white">{selectedInvoiceDetails.customer_name}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">المستودع المستلم:</span>
                      <span className="font-bold text-white">{selectedInvoiceDetails.warehouse_name}</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1.5">طريقة تسوية المردود:</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setFormRefundType('credit_note')}
                        className={`p-2.5 rounded-xl border text-center font-bold transition ${
                          formRefundType === 'credit_note'
                            ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                            : 'bg-slate-800 border-slate-700 text-slate-400'
                        }`}
                      >
                        إشعار دائن (تخفيض مديونية العميل)
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormRefundType('cash')}
                        className={`p-2.5 rounded-xl border text-center font-bold transition ${
                          formRefundType === 'cash'
                            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                            : 'bg-slate-800 border-slate-700 text-slate-400'
                        }`}
                      >
                        رد نقدي فوري للعميل
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-2">أصناف الفاتورة والكميات المراد ردها:</label>
                    <div className="border border-slate-700 rounded-xl overflow-hidden">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-800 text-slate-300">
                          <tr>
                            <th className="p-2.5">الصنف</th>
                            <th className="p-2.5 text-center">الكمية المباعة</th>
                            <th className="p-2.5 text-center">المُرجع سابقاً</th>
                            <th className="p-2.5 text-center">كمية المرتجع</th>
                            <th className="p-2.5 text-end">سعر الوحدة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {returnItems.map((it, idx) => {
                            const maxAllowed = it.soldQty - it.alreadyReturned;
                            return (
                              <tr key={idx} className="hover:bg-slate-800/40">
                                <td className="p-2.5 font-medium">{it.name}</td>
                                <td className="p-2.5 text-center font-mono">{it.soldQty}</td>
                                <td className="p-2.5 text-center font-mono text-amber-400">{it.alreadyReturned}</td>
                                <td className="p-2.5 text-center">
                                  <input
                                    type="number"
                                    min="0"
                                    max={maxAllowed}
                                    value={it.returnQty}
                                    onChange={e => handleQtyChange(idx, parseFloat(e.target.value) || 0)}
                                    className="w-20 bg-slate-900 border border-slate-700 rounded p-1 text-center font-bold text-amber-300"
                                  />
                                </td>
                                <td className="p-2.5 text-end font-mono">{it.unitPrice.toLocaleString()} ج.م</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">ملاحظات أو سبب الإرجاع:</label>
                    <input
                      type="text"
                      value={formNotes}
                      onChange={e => setFormNotes(e.target.value)}
                      placeholder="سبب المردود..."
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-white"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-800 mt-4">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="px-4 py-2 border border-slate-700 text-slate-300 rounded-xl hover:bg-slate-800 text-xs font-semibold"
              >
                إلغاء
              </button>
              {selectedInvoiceDetails && (
                <>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleCreateSubmit('draft')}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 transition disabled:opacity-60"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>حفظ كمسودة</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleCreateSubmit('posted')}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition disabled:opacity-60"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>اعتماد وترحيل فوري</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Draft Modal */}
      {editingReturn && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-2xl max-w-xl w-full border border-slate-800 shadow-2xl p-6 text-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit className="w-5 h-5 text-sky-400" />
                <span>تعديل مسودة مردود المبيعات: {editingReturn.return_number}</span>
              </h3>
              <button onClick={() => setEditingReturn(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditDraft} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-2">أصناف المردود:</label>
                <div className="border border-slate-700 rounded-xl overflow-hidden">
                  <table className="w-full text-right">
                    <thead className="bg-slate-800 text-slate-300">
                      <tr>
                        <th className="p-2.5">الصنف</th>
                        <th className="p-2.5 text-center">الكمية</th>
                        <th className="p-2.5 text-end">سعر الوحدة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {editReturnItems.map((it, idx) => (
                        <tr key={idx}>
                          <td className="p-2.5 font-medium">{it.name}</td>
                          <td className="p-2.5 text-center">
                            <input
                              type="number"
                              min="1"
                              value={it.returnQty}
                              onChange={e => {
                                const updated = [...editReturnItems];
                                updated[idx].returnQty = parseFloat(e.target.value) || 0;
                                setEditReturnItems(updated);
                              }}
                              className="w-20 bg-slate-900 border border-slate-700 rounded p-1 text-center font-bold text-amber-300"
                            />
                          </td>
                          <td className="p-2.5 text-end font-mono">{it.unitPrice.toLocaleString()} ج.م</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">ملاحظات المردود:</label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingReturn(null)}
                  className="px-4 py-2 border border-slate-700 text-slate-300 rounded-xl hover:bg-slate-800 font-semibold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isEditing}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl flex items-center gap-1.5"
                >
                  {isEditing ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Draft Confirm Modal */}
      <ConfirmModal
        isOpen={!!deletingReturn}
        title="تأكيد حذف مسودة مردود المبيعات"
        message={`هل تريد حذف مسودة مردود المبيعات رقم "${deletingReturn?.return_number}"؟`}
        warning="لا يؤثر حذف المسودة على المخزون أو قيود اليومية."
        confirmLabel="نعم، حذف المسودة"
        cancelLabel="إلغاء"
        confirmVariant="danger"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingReturn(null)}
      />

      {/* View Return Details Modal */}
      {viewingReturn && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-2xl max-w-2xl w-full border border-slate-800 shadow-2xl p-6 text-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Eye className="w-5 h-5 text-amber-400" />
                <span>تفاصيل مردود المبيعات: {viewingReturn.return_number}</span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة</span>
                </button>
                <button onClick={() => setViewingReturn(null)} className="text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-800/60 rounded-xl">
                <div>
                  <span className="text-slate-400 block">العميل:</span>
                  <span className="font-bold text-white">{viewingReturn.customer_name}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">الفاتورة الأصلية:</span>
                  <span className="font-mono text-emerald-400 font-bold">{viewingReturn.original_invoice_number}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">التاريخ:</span>
                  <span className="font-mono text-white">{viewingReturn.return_date}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">الحالة:</span>
                  <span className="font-bold text-amber-400">{viewingReturn.status === 'draft' ? 'مسودة' : 'مرحل'}</span>
                </div>
              </div>

              <div className="border border-slate-700 rounded-xl overflow-hidden">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-800 text-slate-300">
                    <tr>
                      <th className="p-2.5">الصنف</th>
                      <th className="p-2.5 text-center">الكمية</th>
                      <th className="p-2.5 text-end">سعر الوحدة</th>
                      <th className="p-2.5 text-end">ضريبة (14%)</th>
                      <th className="p-2.5 text-end">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {(viewingReturn.items || []).map((it: any, idx: number) => (
                      <tr key={idx}>
                        <td className="p-2.5">{it.item_name || it.item_code}</td>
                        <td className="p-2.5 text-center font-mono font-bold text-amber-300">{it.quantity}</td>
                        <td className="p-2.5 text-end font-mono">{(it.unit_price || 0).toLocaleString()} ج.م</td>
                        <td className="p-2.5 text-end font-mono">{(it.tax_amount || 0).toLocaleString()} ج.م</td>
                        <td className="p-2.5 text-end font-mono font-bold text-white">{(it.total_amount || 0).toLocaleString()} ج.م</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-3 bg-slate-800/80 rounded-xl flex justify-between items-center text-sm font-bold">
                <span>إجمالي قيمة المردود:</span>
                <span className="text-amber-400 font-mono">{(viewingReturn.total_amount || 0).toLocaleString()} ج.م</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
