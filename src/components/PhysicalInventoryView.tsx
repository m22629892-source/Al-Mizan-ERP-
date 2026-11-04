import React, { useState, useEffect } from 'react';
import {
  ClipboardCheck,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertOctagon,
  Printer,
  FileSpreadsheet,
  Boxes,
  Building,
  Check,
  Trash2,
  Edit,
  Eye,
  Calendar,
  Layers
} from 'lucide-react';
import { apiClient } from '../services/apiClient';
import { ConfirmModal } from './ConfirmModal';
import { InventoryCount, InventoryCountItem, Branch, Warehouse, User } from '../types';
import { hasPermission } from '../utils/permissions';

interface PhysicalInventoryViewProps {
  currentUser: User | null;
  branches: Branch[];
  warehouses: Warehouse[];
}

export const PhysicalInventoryView: React.FC<PhysicalInventoryViewProps> = ({ currentUser, branches, warehouses }) => {
  const [counts, setCounts] = useState<InventoryCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Selected Count for View / Edit / Print
  const [activeCount, setActiveCount] = useState<InventoryCount | null>(null);
  const [activeItems, setActiveItems] = useState<InventoryCountItem[]>([]);
  const [isViewingDetails, setIsViewingDetails] = useState(false);

  // New Count Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState<string>(branches[0]?.id || 'br_cairo');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(warehouses[0]?.id || 'wh_main');
  const [countDate, setCountDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [countNotes, setCountNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Post & Delete Modals
  const [countToPost, setCountToPost] = useState<InventoryCount | null>(null);
  const [countToDelete, setCountToDelete] = useState<InventoryCount | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const fetchCounts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get('/inventory-counts');
      if (data && data.counts) setCounts(data.counts);
    } catch (err: any) {
      setError(err.message || 'فشل تحميل محاضر الجرد.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCounts();
  }, []);

  const openCountDetails = async (count: InventoryCount) => {
    setActiveCount(count);
    setError(null);
    try {
      const data = await apiClient.get(`/inventory-counts/${count.id}`);
      if (data && data.items) {
        setActiveItems(data.items);
        setIsViewingDetails(true);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateCount = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await apiClient.post('/inventory-counts', {
        branchId: selectedBranchId,
        warehouseId: selectedWarehouseId,
        countDate,
        notes: countNotes
      });
      setSuccessMessage(res.message);
      setIsCreateModalOpen(false);
      fetchCounts();
      // Directly open created count for editing counted quantities
      if (res.countId) {
        const full = await apiClient.get(`/inventory-counts/${res.countId}`);
        setActiveCount(full.count);
        setActiveItems(full.items || []);
        setIsViewingDetails(true);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateItemQty = (itemId: string, countedQty: number) => {
    setActiveItems(prev => prev.map(it => {
      if (it.item_id === itemId) {
        const diff = countedQty - it.system_quantity;
        const totalDiff = diff * it.unit_cost;
        return {
          ...it,
          counted_quantity: countedQty,
          diff_quantity: diff,
          total_diff_cost: totalDiff
        };
      }
      return it;
    }));
  };

  const handleSaveDraftChanges = async () => {
    if (!activeCount) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await apiClient.put(`/inventory-counts/${activeCount.id}`, {
        items: activeItems.map(it => ({
          itemId: it.item_id,
          countedQuantity: it.counted_quantity,
          notes: it.notes
        }))
      });
      setSuccessMessage('تم حفظ كميات الجرد الفعلي بنجاح.');
      fetchCounts();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmPost = async () => {
    if (!countToPost) return;
    setIsActionLoading(true);
    setError(null);
    try {
      const res = await apiClient.post(`/inventory-counts/${countToPost.id}/post`, {});
      setSuccessMessage(res.message);
      setCountToPost(null);
      setIsViewingDetails(false);
      fetchCounts();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!countToDelete) return;
    setIsActionLoading(true);
    setError(null);
    try {
      const res = await apiClient.del(`/inventory-counts/${countToDelete.id}`);
      setSuccessMessage(res.message);
      setCountToDelete(null);
      if (activeCount?.id === countToDelete.id) setIsViewingDetails(false);
      fetchCounts();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsActionLoading(false);
    }
  };

  const canManageCounts = hasPermission(currentUser, ['inventory.count', 'manage_settings']);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shadow-xs">
            <ClipboardCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">جرد المخزون ومحاضر التسوية</h1>
            <p className="text-xs text-slate-500 mt-1">
              تسجيل لجان الجرد الفعلي للمستودعات، رصد فروق العجز والزيادة، وتوليد قيود التسوية التلقائية للمخزون.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchCounts}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>

          {canManageCounts && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إنشاء محضر جرد فعلي جديد</span>
            </button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center justify-between no-print">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-xs text-emerald-600 underline">إغلاق</button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-2 no-print">
          <AlertOctagon className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="whitespace-pre-line font-medium leading-relaxed">{error}</div>
        </div>
      )}

      {/* View Details / Live Count Workspace */}
      {isViewingDetails && activeCount ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-base font-bold text-slate-900 font-mono-numbers">
                  محضر جرد رقم: {activeCount.count_number}
                </h2>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  activeCount.status === 'posted'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {activeCount.status === 'posted' ? 'معتمد ومرحل للأستاذ' : 'مسودة جرد (قيد التحرير)'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                الفرع: {activeCount.branch_name} | المستودع: {activeCount.warehouse_name} | تاريخ الجرد: {activeCount.count_date}
                {activeCount.journal_number && ` | القيد: ${activeCount.journal_number}`}
              </p>
            </div>

            <div className="flex items-center gap-2 no-print">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>طباعة المحضر</span>
              </button>

              {activeCount.status === 'draft' && canManageCounts && (
                <>
                  <button
                    disabled={isSubmitting}
                    onClick={handleSaveDraftChanges}
                    className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    <span>حفظ التعديلات</span>
                  </button>

                  <button
                    onClick={() => setCountToPost(activeCount)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>اعتماد وترحيل التسوية للأستاذ</span>
                  </button>
                </>
              )}

              <button
                onClick={() => setIsViewingDetails(false)}
                className="px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition"
              >
                العودة للقائمة
              </button>
            </div>
          </div>

          {/* Items Count Table */}
          <div className="overflow-x-auto max-h-[500px] rounded-xl border border-slate-200">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-bold sticky top-0">
                <tr>
                  <th className="p-3">كود الصنف</th>
                  <th className="p-3">اسم الصنف</th>
                  <th className="p-3">الفئة</th>
                  <th className="p-3">الوحدة</th>
                  <th className="p-3 text-end">الكمية الدفترية</th>
                  <th className="p-3 text-end">الكمية الفعلية المجرودة</th>
                  <th className="p-3 text-end">فارق الكمية</th>
                  <th className="p-3 text-end">تكلفة الوحدة</th>
                  <th className="p-3 text-end">قيمة الفرق المالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono-numbers">
                {activeItems.map((it) => {
                  const isShortage = it.diff_quantity < 0;
                  const isSurplus = it.diff_quantity > 0;

                  return (
                    <tr key={it.id} className="hover:bg-slate-50">
                      <td className="p-3 font-bold text-slate-800">{it.item_code}</td>
                      <td className="p-3 font-sans text-slate-800 font-medium">{it.item_name}</td>
                      <td className="p-3 font-sans text-slate-500">{it.category}</td>
                      <td className="p-3 font-sans text-slate-500">{it.base_unit}</td>
                      <td className="p-3 text-end font-bold text-slate-700">{it.system_quantity}</td>
                      <td className="p-3 text-end">
                        {activeCount.status === 'draft' ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={it.counted_quantity}
                            onChange={(e) => handleUpdateItemQty(it.item_id, parseFloat(e.target.value) || 0)}
                            className="w-24 px-2 py-1 text-end font-bold text-xs rounded-lg border border-slate-300 focus:outline-amber-600 font-mono-numbers"
                          />
                        ) : (
                          <span className="font-bold text-slate-900">{it.counted_quantity}</span>
                        )}
                      </td>
                      <td className={`p-3 text-end font-bold ${
                        isShortage ? 'text-rose-600' : isSurplus ? 'text-emerald-600' : 'text-slate-400'
                      }`}>
                        {it.diff_quantity > 0 ? `+${it.diff_quantity}` : it.diff_quantity}
                      </td>
                      <td className="p-3 text-end text-slate-600">
                        {it.unit_cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className={`p-3 text-end font-bold ${
                        isShortage ? 'text-rose-600' : isSurplus ? 'text-emerald-600' : 'text-slate-400'
                      }`}>
                        {it.total_diff_cost.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Counts List Table */
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Boxes className="w-4 h-4 text-amber-600" />
              سجل محاضر الجرد الفعلي للمخازن ({counts.length})
            </h2>
          </div>

          {counts.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-bold">
                  <tr>
                    <th className="p-3">رقم المحضر</th>
                    <th className="p-3">الفرع والمستودع</th>
                    <th className="p-3">تاريخ الجرد</th>
                    <th className="p-3 text-end">قيمة العجز</th>
                    <th className="p-3 text-end">قيمة الزيادة</th>
                    <th className="p-3 text-end">صافي الفارق</th>
                    <th className="p-3">قيد التسوية</th>
                    <th className="p-3 text-center">الحالة</th>
                    <th className="p-3 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono-numbers">
                  {counts.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="p-3 font-bold text-slate-800">{c.count_number}</td>
                      <td className="p-3 font-sans text-slate-700">
                        <div className="font-bold">{c.warehouse_name}</div>
                        <div className="text-[10px] text-slate-400">{c.branch_name}</div>
                      </td>
                      <td className="p-3 text-slate-500">{c.count_date}</td>
                      <td className="p-3 text-end font-bold text-rose-700">
                        {c.total_shortage_cost > 0 ? `${c.total_shortage_cost.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م` : '-'}
                      </td>
                      <td className="p-3 text-end font-bold text-emerald-700">
                        {c.total_surplus_cost > 0 ? `${c.total_surplus_cost.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م` : '-'}
                      </td>
                      <td className="p-3 text-end font-bold text-slate-900">
                        {c.net_variance_cost.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م
                      </td>
                      <td className="p-3 font-bold text-blue-700">
                        {c.journal_number || '-'}
                      </td>
                      <td className="p-3 text-center">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          c.status === 'posted' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {c.status === 'posted' ? 'مرحل للأستاذ' : 'مسودة'}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => openCountDetails(c)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                            title="عرض وتعديل بنود الجرد"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {c.status === 'draft' && canManageCounts && (
                            <button
                              onClick={() => setCountToDelete(c)}
                              className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition"
                              title="حذف مسودة المحضر"
                            >
                              <Trash2 className="w-4 h-4" />
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
              لا توجد محاضر جرد سابقة. انقر على «إنشاء محضر جرد فعلي جديد» للبدء.
            </div>
          )}
        </div>
      )}

      {/* Create Count Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center gap-2 text-amber-700 pb-3 border-b border-slate-100">
              <ClipboardCheck className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-900">إنشاء محضر جرد فعلي جديد</h3>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">الفرع:</label>
                <select
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200"
                >
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name_ar}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">المستودع المراد جرده:</label>
                <select
                  value={selectedWarehouseId}
                  onChange={(e) => setSelectedWarehouseId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200"
                >
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name_ar}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">تاريخ الجرد المرجعي:</label>
                <input
                  type="date"
                  value={countDate}
                  onChange={(e) => setCountDate(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 font-mono-numbers"
                >
                </input>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">ملاحظات / أسماء أعضاء اللجنة:</label>
                <textarea
                  value={countNotes}
                  onChange={(e) => setCountNotes(e.target.value)}
                  rows={2}
                  placeholder="لجنة الجرد السنوي برئاسة..."
                  className="w-full p-2.5 rounded-xl border border-slate-200"
                />
              </div>
            </div>

            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 leading-relaxed">
              <strong>سياسة الجرد:</strong> سيقوم النظام بأخذ لقطة فورية متجمدة للرصيد الدفتري الحالي لجميع أصناف المخزن، ويمكنك بعد ذلك إدخال الكميات المجرودة فعلياً وتعديلها في أي وقت قبل الاعتماد النهائي.
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                disabled={isSubmitting}
                onClick={() => setIsCreateModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                إلغاء
              </button>
              <button
                disabled={isSubmitting}
                onClick={handleCreateCount}
                className="px-5 py-2.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-xs transition flex items-center gap-1.5"
              >
                {isSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>إنشاء مسودة المحضر</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post Count Confirmation Modal */}
      <ConfirmModal
        isOpen={!!countToPost}
        title="تأكيد اعتماد وترحيل محضر الجرد الفعلي"
        message={`هل أنت متأكد من رغبتك في اعتماد وترحيل محضر الجرد رقم (${countToPost?.count_number})؟`}
        warning="سيتم توليد قيد تسوية محاسبي متزن آلياً وتحديث أرصدة المخازن لتطابق الجرد الفعلي تماماً."
        confirmLabel="اعتماد وترحيل التسوية"
        confirmVariant="primary"
        isLoading={isActionLoading}
        onConfirm={handleConfirmPost}
        onCancel={() => setCountToPost(null)}
      />

      {/* Delete Draft Confirmation Modal */}
      <ConfirmModal
        isOpen={!!countToDelete}
        title="تأكيد حذف مسودة محضر الجرد"
        message={`هل أنت متأكد من حذف مسودة محضر الجرد (${countToDelete?.count_number})؟`}
        warning="لن يتم حذف أي بيانات من المخزن، ويبقى الرصيد الدفتري دون أي تغيير."
        confirmLabel="حذف المسودة"
        confirmVariant="danger"
        isLoading={isActionLoading}
        onConfirm={handleConfirmDelete}
        onCancel={() => setCountToDelete(null)}
      />
    </div>
  );
};
