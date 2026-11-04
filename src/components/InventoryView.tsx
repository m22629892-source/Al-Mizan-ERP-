import React, { useState, useEffect } from 'react';
import {
  Boxes, Search, AlertTriangle, Layers, Tag, Barcode, Warehouse as WhIcon,
  Plus, Edit, Trash2, ArrowLeftRight, CheckCircle2, Power, X, ShieldCheck
} from 'lucide-react';
import { Item, Warehouse } from '../types';
import { Language, translations } from '../translations';
import { apiClient } from '../services/apiClient';
import { ConfirmModal } from './ConfirmModal';

interface InventoryViewProps {
  items: Item[];
  warehouses: Warehouse[];
  lang: Language;
  onRefresh: () => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({ items, warehouses, lang, onRefresh }) => {
  const t = translations[lang];
  const [activeMainTab, setActiveMainTab] = useState<'items' | 'categories'>('items');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCat, setSelectedCat] = useState('all');

  // Categories State
  const [categoriesList, setCategoriesList] = useState<any[]>([]);
  const [loadingCats, setLoadingCats] = useState(false);

  // Modals: Items
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [deletingItem, setDeletingItem] = useState<Item | null>(null);
  const [itemCode, setItemCode] = useState('');
  const [itemBarcode, setItemBarcode] = useState('');
  const [itemNameAr, setItemNameAr] = useState('');
  const [itemNameEn, setItemNameEn] = useState('');
  const [itemCategoryId, setItemCategoryId] = useState('');
  const [itemSalePrice, setItemSalePrice] = useState('100');
  const [itemTaxRate, setItemTaxRate] = useState('14');
  const [itemMinStock, setItemMinStock] = useState('5');
  const [itemIsActive, setItemIsActive] = useState(true);

  // Modals: Categories
  const [showAddCatModal, setShowAddCatModal] = useState(false);
  const [editingCat, setEditingCat] = useState<any | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<any | null>(null);
  const [catCode, setCatCode] = useState('');
  const [catNameAr, setCatNameAr] = useState('');
  const [catNameEn, setCatNameEn] = useState('');
  const [catParentId, setCatParentId] = useState('');
  
  // Transfer Items Modal
  const [transferSourceCat, setTransferSourceCat] = useState<any | null>(null);
  const [transferTargetCatId, setTransferTargetCatId] = useState('');

  // Stock breakdown modal
  const [selectedItemForStock, setSelectedItemForStock] = useState<Item | null>(null);
  const [stockBreakdown, setStockBreakdown] = useState<any[]>([]);

  const [saving, setSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const formatEGP = (val: number) => {
    return (val || 0).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' ج.م';
  };

  const fetchCategories = async () => {
    setLoadingCats(true);
    try {
      const data = await apiClient.get('/categories');
      setCategoriesList(data.categories || []);
    } catch (err: any) {
      console.error('Error fetching categories:', err);
    } finally {
      setLoadingCats(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const hasCostPermission = items.some(i => i.cost_price !== undefined || i.moving_avg_cost !== undefined);
  const categoryNames = ['all', ...Array.from(new Set(items.map(i => i.category || 'عام')))];

  const filteredItems = items.filter(it => {
    const matchesCat = selectedCat === 'all' || it.category === selectedCat;
    const matchesSearch =
      it.name_ar.includes(searchTerm) ||
      it.code.includes(searchTerm) ||
      (it.barcode && it.barcode.includes(searchTerm));
    return matchesCat && matchesSearch;
  });

  const handleInspectStock = async (item: Item) => {
    setSelectedItemForStock(item);
    try {
      const data = await apiClient.get(`/items/${item.id}/stock-by-warehouse`);
      setStockBreakdown(data.stock || []);
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل جلب أرصدة المخازن');
    }
  };

  // Item CRUD
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');

    try {
      if (editingItem) {
        await apiClient.put(`/items/${editingItem.id}`, {
          barcode: itemBarcode || null,
          name_ar: itemNameAr,
          name_en: itemNameEn || null,
          category_id: itemCategoryId || null,
          sale_price: parseFloat(itemSalePrice) || 0,
          tax_rate: parseFloat(itemTaxRate) || 14,
          min_stock_level: parseFloat(itemMinStock) || 5,
          is_active: itemIsActive
        });
        setEditingItem(null);
        setSuccessMsg(`تم تحديث بيانات الصنف "${itemNameAr}" بنجاح.`);
      } else {
        await apiClient.post('/items', {
          code: itemCode,
          barcode: itemBarcode || null,
          name_ar: itemNameAr,
          name_en: itemNameEn || null,
          category_id: itemCategoryId || null,
          sale_price: parseFloat(itemSalePrice) || 0,
          tax_rate: parseFloat(itemTaxRate) || 14,
          min_stock_level: parseFloat(itemMinStock) || 5,
          is_active: itemIsActive
        });
        setShowAddItemModal(false);
        setSuccessMsg(`تمت إضافة الصنف "${itemNameAr}" بنجاح.`);
      }

      onRefresh();
      fetchCategories();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل حفظ الصنف');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenEditItem = (it: Item) => {
    setEditingItem(it);
    setItemCode(it.code);
    setItemBarcode(it.barcode || '');
    setItemNameAr(it.name_ar);
    setItemNameEn(it.name_en || '');
    setItemCategoryId(it.category_id || '');
    setItemSalePrice(it.sale_price.toString());
    setItemTaxRate(it.tax_rate !== undefined ? it.tax_rate.toString() : '14');
    setItemMinStock(it.min_stock_level !== undefined ? it.min_stock_level.toString() : '5');
    setItemIsActive(it.is_active !== 0);
    setErrorMsg('');
  };

  const handleDeleteItem = (it: Item) => {
    setDeletingItem(it);
  };

  const handleConfirmDeleteItem = async () => {
    if (!deletingItem) return;
    setIsDeleting(true);
    setErrorMsg('');
    try {
      await apiClient.del(`/items/${deletingItem.id}`);
      setSuccessMsg(`تم حذف الصنف "${deletingItem.name_ar}" بنجاح.`);
      setDeletingItem(null);
      onRefresh();
      fetchCategories();
    } catch (err: any) {
      setErrorMsg(`تعذر حذف الصنف: ${err.message}`);
      setDeletingItem(null);
    } finally {
      setIsDeleting(false);
    }
  };

  // Category CRUD
  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');

    try {
      if (editingCat) {
        await apiClient.put(`/categories/${editingCat.id}`, {
          name_ar: catNameAr,
          name_en: catNameEn || null,
          parent_id: catParentId || null
        });
        setEditingCat(null);
        setSuccessMsg(`تم تحديث فئة الأصناف "${catNameAr}" بنجاح.`);
      } else {
        await apiClient.post('/categories', {
          code: catCode,
          name_ar: catNameAr,
          name_en: catNameEn || null,
          parent_id: catParentId || null
        });
        setShowAddCatModal(false);
        setSuccessMsg(`تمت إضافة الفئة "${catNameAr}" بنجاح.`);
      }

      fetchCategories();
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل حفظ الفئة');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCategory = (cat: any) => {
    setDeletingCategory(cat);
  };

  const handleConfirmDeleteCategory = async () => {
    if (!deletingCategory) return;
    setIsDeleting(true);
    setErrorMsg('');
    try {
      await apiClient.del(`/categories/${deletingCategory.id}`);
      setSuccessMsg(`تم حذف الفئة "${deletingCategory.name_ar}" بنجاح.`);
      setDeletingCategory(null);
      fetchCategories();
    } catch (err: any) {
      setErrorMsg(`تعذر حذف الفئة: ${err.message}`);
      setDeletingCategory(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleTransferItemsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferSourceCat || !transferTargetCatId) return;

    setSaving(true);
    setErrorMsg('');

    try {
      const res = await apiClient.post(`/categories/${transferSourceCat.id}/transfer-items`, {
        targetCategoryId: transferTargetCatId
      });

      setSuccessMsg(res.message || 'تم نقل الأصناف بنجاح.');
      setTransferSourceCat(null);
      setTransferTargetCatId('');
      fetchCategories();
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل نقل الأصناف');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Boxes className="w-5 h-5 text-emerald-600" />
            {t.inventory} وسجل الأصناف وفئات المنتجات
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            إدارة متكاملة للأصناف، الباركود الدولي، الفئات الهرمية، تقييم المخزون بالمتوسط المرجح، وتتبع الأرصدة بالمخازن المتعددة.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          {activeMainTab === 'items' ? (
            <button
              onClick={() => {
                setShowAddItemModal(true);
                setItemCode(`ITM-${(items.length + 1).toString().padStart(4, '0')}`);
                setItemBarcode('');
                setItemNameAr('');
                setItemNameEn('');
                setItemSalePrice('100');
                setErrorMsg('');
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              إضافة صنف تجاري جديد
            </button>
          ) : (
            <button
              onClick={() => {
                setShowAddCatModal(true);
                setCatCode(`CAT-${(categoriesList.length + 1).toString().padStart(3, '0')}`);
                setCatNameAr('');
                setCatNameEn('');
                setCatParentId('');
                setErrorMsg('');
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              إضافة فئة أصناف جديدة
            </button>
          )}
        </div>
      </div>

      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Main Tab Switcher */}
      <div className="flex bg-slate-100 p-1 rounded-xl w-full sm:w-auto self-start">
        <button
          onClick={() => setActiveMainTab('items')}
          className={`px-5 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 ${
            activeMainTab === 'items'
              ? 'bg-white text-emerald-800 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Boxes className="w-4 h-4" />
          <span>سجل الأصناف والمخزون ({items.length})</span>
        </button>

        <button
          onClick={() => setActiveMainTab('categories')}
          className={`px-5 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 ${
            activeMainTab === 'categories'
              ? 'bg-white text-emerald-800 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>إدارة فئات الأصناف ({categoriesList.length})</span>
        </button>
      </div>

      {activeMainTab === 'items' ? (
        <>
          {/* Filter and Categories Bar */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute start-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="بحث بالاسم، الكود، أو الباركود الدولي..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full ps-9 pe-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500 bg-slate-50"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 text-xs">
              {categoryNames.map((c) => (
                <button
                  key={c}
                  onClick={() => setSelectedCat(c)}
                  className={`px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition-colors ${
                    selectedCat === c
                      ? 'bg-slate-900 text-white font-semibold'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {c === 'all' ? 'جميع الفئات' : c}
                </button>
              ))}
            </div>
          </div>

          {/* Items Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-start">كود الصنف</th>
                  <th className="px-4 py-3 text-start">اسم الصنف التجاري</th>
                  <th className="px-4 py-3 text-start">الباركود والفئة</th>
                  <th className="px-4 py-3 text-end">سعر البيع</th>
                  {hasCostPermission && (
                    <th className="px-4 py-3 text-end">متوسط التكلفة</th>
                  )}
                  <th className="px-4 py-3 text-center">الرصيد الكلي</th>
                  <th className="px-4 py-3 text-center">الحالة</th>
                  <th className="px-4 py-3 text-center">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.map((it) => {
                  const isLowStock = it.total_quantity <= (it.min_stock_level || 5);

                  return (
                    <tr key={it.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-emerald-800">{it.code}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{it.name_ar}</div>
                        {it.name_en && (
                          <div className="text-[10px] text-slate-400 font-mono">{it.name_en}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <div className="flex items-center gap-1 font-mono text-[11px]">
                          <Barcode className="w-3.5 h-3.5 text-slate-400" />
                          <span>{it.barcode || 'بدون باركود'}</span>
                        </div>
                        <div className="text-[10px] text-emerald-700 font-medium mt-0.5">
                          {it.category || 'عام'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-end font-mono-numbers font-semibold text-slate-900">
                        {formatEGP(it.sale_price)}
                      </td>

                      {hasCostPermission && (
                        <td className="px-4 py-3 text-end font-mono-numbers text-slate-700">
                          {it.moving_avg_cost !== undefined ? formatEGP(it.moving_avg_cost) : '-'}
                        </td>
                      )}

                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleInspectStock(it)}
                          className={`px-2.5 py-1 rounded-full font-mono-numbers font-bold text-xs inline-flex items-center gap-1 hover:opacity-80 transition ${
                            isLowStock
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}
                          title="عرض توزيع الأرصدة بالمخازن"
                        >
                          <WhIcon className="w-3 h-3" />
                          <span>{it.total_quantity} {it.base_unit || 'قطعة'}</span>
                        </button>
                      </td>

                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          it.is_active === 0 ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {it.is_active === 0 ? 'معطل' : 'نشط'}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleOpenEditItem(it)}
                            className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-slate-100 rounded transition"
                            title="تعديل بيانات الصنف"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleDeleteItem(it)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                            title="حذف الصنف"
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
        </>
      ) : (
        /* Categories Table */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-start">كود الفئة</th>
                <th className="px-4 py-3 text-start">اسم الفئة بالعربية</th>
                <th className="px-4 py-3 text-start">الاسم بالإنجليزية</th>
                <th className="px-4 py-3 text-start">الفئة الرئيسية التابعة لها</th>
                <th className="px-4 py-3 text-center">عدد الأصناف المرتبطة</th>
                <th className="px-4 py-3 text-center">الحالة</th>
                <th className="px-4 py-3 text-center">{t.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categoriesList.map((cat) => (
                <tr key={cat.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-emerald-800">{cat.code}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{cat.name_ar}</td>
                  <td className="px-4 py-3 font-mono text-slate-500">{cat.name_en || '-'}</td>
                  <td className="px-4 py-3 text-slate-600">{cat.parent_name_ar || 'فئة رئيسية'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-0.5 rounded-full font-mono font-bold bg-slate-100 text-slate-800">
                      {cat.item_count || 0} صنف
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                      cat.is_active === 0 ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {cat.is_active === 0 ? 'معطل' : 'نشط'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => {
                          setEditingCat(cat);
                          setCatCode(cat.code);
                          setCatNameAr(cat.name_ar);
                          setCatNameEn(cat.name_en || '');
                          setCatParentId(cat.parent_id || '');
                          setErrorMsg('');
                        }}
                        className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-slate-100 rounded transition"
                        title="تعديل الفئة"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>

                      {cat.item_count > 0 && (
                        <button
                          onClick={() => {
                            setTransferSourceCat(cat);
                            setTransferTargetCatId('');
                            setErrorMsg('');
                          }}
                          className="p-1.5 text-sky-600 hover:bg-sky-50 rounded transition"
                          title="نقل أصناف هذه الفئة إلى فئة أخرى قبل الحذف"
                        >
                          <ArrowLeftRight className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        onClick={() => handleDeleteCategory(cat)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                        title="حذف الفئة"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Stock Breakdown Modal */}
      {selectedItemForStock && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <WhIcon className="w-5 h-5 text-emerald-600" />
                رصيد الصنف: {selectedItemForStock.name_ar}
              </h3>
              <button onClick={() => setSelectedItemForStock(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              {stockBreakdown.map((s, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                  <div>
                    <span className="font-semibold text-slate-800 block">{s.warehouse_name}</span>
                    <span className="text-[10px] text-slate-400">{s.branch_name}</span>
                  </div>
                  <div className="text-end">
                    <span className="font-black text-sm font-mono text-emerald-700">{s.quantity}</span>
                    <span className="text-[10px] text-slate-400 block">{selectedItemForStock.base_unit || 'قطعة'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Item Modal */}
      {(showAddItemModal || editingItem) && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Boxes className="w-5 h-5 text-emerald-600" />
                {editingItem ? `تعديل الصنف: ${editingItem.code}` : 'إضافة صنف تجاري جديد'}
              </h3>
              <button onClick={() => { setShowAddItemModal(false); setEditingItem(null); }} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSaveItem} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">كود الصنف *</label>
                  <input
                    type="text"
                    required
                    disabled={!!editingItem}
                    value={itemCode}
                    onChange={e => setItemCode(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">الباركود الدولي (EAN-13)</label>
                  <input
                    type="text"
                    placeholder="6220000000000"
                    value={itemBarcode}
                    onChange={e => setItemBarcode(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">اسم الصنف بالعربية *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: لابتوب ديل 15 بوصة كور i7"
                  value={itemNameAr}
                  onChange={e => setItemNameAr(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">اسم الصنف بالإنجليزية (اختياري)</label>
                <input
                  type="text"
                  placeholder="Dell Laptop 15 Core i7"
                  value={itemNameEn}
                  onChange={e => setItemNameEn(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">فئة الصنف</label>
                <select
                  value={itemCategoryId}
                  onChange={e => setItemCategoryId(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                >
                  <option value="">بدون فئة محددة</option>
                  {categoriesList.map(c => (
                    <option key={c.id} value={c.id}>{c.code} - {c.name_ar}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">سعر البيع (ج.م) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={itemSalePrice}
                    onChange={e => setItemSalePrice(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono text-end"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">نسبة الضريبة %</label>
                  <input
                    type="number"
                    step="0.01"
                    value={itemTaxRate}
                    onChange={e => setItemTaxRate(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono text-end"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">حد إعادة الطلب</label>
                  <input
                    type="number"
                    value={itemMinStock}
                    onChange={e => setItemMinStock(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono text-end"
                  />
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={itemIsActive}
                    onChange={e => setItemIsActive(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded"
                  />
                  <span className="font-semibold text-slate-700">الصنف نشط ومتاح في فواتير المبيعات والمشتريات</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100 mt-4">
                <button
                  type="button"
                  onClick={() => { setShowAddItemModal(false); setEditingItem(null); }}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold"
                >
                  {saving ? 'جارٍ الحفظ...' : 'حفظ الصنف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Category Modal */}
      {(showAddCatModal || editingCat) && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Layers className="w-5 h-5 text-emerald-600" />
                {editingCat ? `تعديل فئة: ${editingCat.code}` : 'إضافة فئة أصناف جديدة'}
              </h3>
              <button onClick={() => { setShowAddCatModal(false); setEditingCat(null); }} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSaveCategory} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">كود الفئة *</label>
                <input
                  type="text"
                  required
                  disabled={!!editingCat}
                  value={catCode}
                  onChange={e => setCatCode(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded font-mono disabled:bg-slate-100"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">اسم الفئة بالعربية *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: أجهزة حاسوب وشاشات"
                  value={catNameAr}
                  onChange={e => setCatNameAr(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">اسم الفئة بالإنجليزية</label>
                <input
                  type="text"
                  placeholder="Computers & Monitors"
                  value={catNameEn}
                  onChange={e => setCatNameEn(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">الفئة الرئيسية (الأصل الهرمي)</label>
                <select
                  value={catParentId}
                  onChange={e => setCatParentId(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                >
                  <option value="">بدون أصل (فئة رئيسية من الدرجة الأولى)</option>
                  {categoriesList.filter(c => !editingCat || c.id !== editingCat.id).map(c => (
                    <option key={c.id} value={c.id}>{c.code} - {c.name_ar}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100 mt-4">
                <button
                  type="button"
                  onClick={() => { setShowAddCatModal(false); setEditingCat(null); }}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold"
                >
                  {saving ? 'جارٍ الحفظ...' : 'حفظ الفئة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer Category Items Modal */}
      {transferSourceCat && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-sky-600" />
                نقل أصناف الفئة: {transferSourceCat.name_ar}
              </h3>
              <button onClick={() => setTransferSourceCat(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-3">
              تحتوي هذه الفئة على ({transferSourceCat.item_count}) صنف. يرجى اختيار الفئة البديلة لنقل كافة الأصناف إليها بأمان:
            </p>

            {errorMsg && (
              <div className="p-3 mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleTransferItemsSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">الفئة المستهدفة البديلة *</label>
                <select
                  required
                  value={transferTargetCatId}
                  onChange={e => setTransferTargetCatId(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                >
                  <option value="">اختر الفئة البديلة...</option>
                  {categoriesList.filter(c => c.id !== transferSourceCat.id).map(c => (
                    <option key={c.id} value={c.id}>{c.code} - {c.name_ar}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100 mt-4">
                <button
                  type="button"
                  onClick={() => setTransferSourceCat(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving || !transferTargetCatId}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-semibold"
                >
                  {saving ? 'جارٍ النقل...' : 'تأكيد نقل الأصناف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Item Deletion Modal */}
      <ConfirmModal
        isOpen={!!deletingItem}
        title="حذف صنف من المخزون"
        message={`هل أنت متأكد من حذف الصنف "${deletingItem?.code} - ${deletingItem?.name_ar}"؟`}
        warning="ملاحظة: سيتم رفض الحذف وحماية البيانات إذا كانت هناك فواتير أو حركات مخزنية مرتبطة بهذا الصنف."
        confirmLabel="تأكيد حذف الصنف"
        confirmVariant="danger"
        isLoading={isDeleting}
        onConfirm={handleConfirmDeleteItem}
        onCancel={() => setDeletingItem(null)}
      />

      {/* Confirm Category Deletion Modal */}
      <ConfirmModal
        isOpen={!!deletingCategory}
        title="حذف فئة أصناف"
        message={`هل أنت متأكد من حذف فئة الأصناف "${deletingCategory?.code} - ${deletingCategory?.name_ar}"؟`}
        warning="سيتم رفض الحذف في حال وجود أصناف أو فئات فرعية تابعة لهذه الفئة."
        confirmLabel="تأكيد حذف الفئة"
        confirmVariant="danger"
        isLoading={isDeleting}
        onConfirm={handleConfirmDeleteCategory}
        onCancel={() => setDeletingCategory(null)}
      />
    </div>
  );
};
