import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  CreditCard,
  Building,
  Package,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  FileText,
  BadgeCheck,
  Receipt,
  ShoppingBag,
  RotateCcw,
  Users,
  AlertTriangle,
  Clock,
  Filter,
  RefreshCw,
  Lock,
  ChevronRight,
  Landmark,
  Boxes,
  ArrowRightLeft,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { Language, translations } from '../translations';
import { SalesInvoice, JournalEntry, Branch, Warehouse, User } from '../types';
import { apiClient } from '../services/apiClient';
import { canAccessTab } from '../utils/permissions';

interface DashboardProps {
  kpis?: {
    cashLiquidity: number;
    receivables: number;
    payables: number;
    inventoryValuation: number | null;
    netSales: number;
    grossProfit: number | null;
    profitMargin: number | null;
    operatingExpenses: number;
    netProfit: number | null;
  };
  monthlyTrend?: { month: string; revenue: number }[];
  recentInvoices?: SalesInvoice[];
  recentEntries?: JournalEntry[];
  branches?: Branch[];
  warehouses?: Warehouse[];
  lang: Language;
  currentUser?: User | null;
  onNavigateTab: (tab: any) => void;
  onSelectInvoice: (inv: SalesInvoice) => void;
  onRefresh?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  kpis: initialKpis,
  monthlyTrend: initialMonthlyTrend,
  recentInvoices: initialRecentInvoices,
  recentEntries: initialRecentEntries,
  branches = [],
  warehouses = [],
  lang,
  currentUser = null,
  onNavigateTab,
  onSelectInvoice,
  onRefresh
}) => {
  const t = translations[lang];

  // Filters State
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [selectedWarehouse, setSelectedWarehouse] = useState('all');
  const [activeShortcut, setActiveShortcut] = useState<'all' | 'today' | 'month' | 'year'>('all');

  // Async Data State
  const [statsData, setStatsData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Active Tab for Detailed Section Cards
  const [activeSection, setActiveSection] = useState<'sales' | 'purchases' | 'treasury' | 'aging' | 'inventory' | 'profitability' | 'monitoring'>('sales');
  const [selectedActionCategory, setSelectedActionCategory] = useState<'overdueSales' | 'overduePurchases' | 'unallocatedVouchers' | 'pendingDrafts' | 'lowStock' | null>(null);

  const formatEGP = (val: number | null | undefined) => {
    if (val === null || val === undefined) return 'محجوب أمنياً';
    return (val || 0).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' ج.م';
  };

  const fetchStats = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      if (selectedBranch && selectedBranch !== 'all') params.set('branchId', selectedBranch);
      if (selectedWarehouse && selectedWarehouse !== 'all') params.set('warehouseId', selectedWarehouse);

      const res = await apiClient.get(`/dashboard/stats?${params.toString()}`);
      setStatsData(res);
    } catch (err: any) {
      console.error('Error fetching dashboard stats:', err);
      setErrorMsg(err.message || 'تعذر تحميل إحصائيات لوحة التحكم.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [fromDate, toDate, selectedBranch, selectedWarehouse]);

  // Shortcut range helpers
  const handleShortcut = (shortcut: 'all' | 'today' | 'month' | 'year') => {
    setActiveShortcut(shortcut);
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    if (shortcut === 'today') {
      setFromDate(todayStr);
      setToDate(todayStr);
    } else if (shortcut === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      setFromDate(firstDay);
      setToDate(lastDay);
    } else if (shortcut === 'year') {
      const firstDay = `${now.getFullYear()}-01-01`;
      const lastDay = `${now.getFullYear()}-12-31`;
      setFromDate(firstDay);
      setToDate(lastDay);
    } else {
      setFromDate('');
      setToDate('');
    }
  };

  // Safe Fallback Resolution
  const kpis = statsData?.kpis || initialKpis || {
    cashLiquidity: 0,
    receivables: 0,
    payables: 0,
    inventoryValuation: 0,
    netSales: 0,
    grossProfit: 0,
    profitMargin: 0,
    operatingExpenses: 0,
    netProfit: 0
  };

  const sections = statsData?.sections || {};
  const comparison = statsData?.comparison;
  const metadata = statsData?.metadata || {
    currencyAr: 'جنيه مصري',
    lastUpdated: new Date().toISOString()
  };
  const monthlyTrend = statsData?.monthlyTrend || initialMonthlyTrend || [];
  const recentInvoices = statsData?.recentInvoices || initialRecentInvoices || [];
  const recentEntries = statsData?.recentEntries || initialRecentEntries || [];

  const hasCostPerm = metadata.hasViewCost !== undefined ? metadata.hasViewCost : true;
  const hasProfitPerm = metadata.hasViewProfit !== undefined ? metadata.hasViewProfit : true;

  // Safe Navigation with user permission check
  const navigateIfAllowed = (tabId: string) => {
    if (canAccessTab(tabId as any, currentUser)) {
      onNavigateTab(tabId);
    } else {
      setErrorMsg(`لا تملك الصلاحية اللازمة لفتح شاشة (${tabId}).`);
    }
  };

  const kpiCards = [
    {
      id: 'treasury',
      title: t.kpis.cashLiquidity,
      val: kpis.cashLiquidity,
      icon: CreditCard,
      color: 'emerald',
      sub: 'الخزائن النقدية وحسابات البنوك المعتمدة',
      targetTab: 'treasury'
    },
    {
      id: 'receivables',
      title: t.kpis.receivables,
      val: kpis.receivables,
      icon: ArrowUpRight,
      color: 'sky',
      sub: 'أرصدة العملاء المدينة (حساب رقابة 1121)',
      targetTab: 'parties'
    },
    {
      id: 'payables',
      title: t.kpis.payables,
      val: kpis.payables,
      icon: ArrowDownLeft,
      color: 'amber',
      sub: 'مستحقات الموردين الدائنة (حساب رقابة 2111)',
      targetTab: 'parties'
    },
    {
      id: 'inventory',
      title: t.kpis.inventoryValuation,
      val: hasCostPerm ? kpis.inventoryValuation : null,
      icon: Package,
      color: 'indigo',
      sub: hasCostPerm ? 'تقييم المخزون بالمتوسط المتحرك' : 'محجوب بضوابط السرية المالية',
      targetTab: 'inventory'
    },
    {
      id: 'sales',
      title: t.kpis.netSales,
      val: kpis.netSales,
      icon: TrendingUp,
      color: 'purple',
      sub: 'صافي إيرادات المبيعات بعد الخصم والمرتجع',
      targetTab: 'sales'
    },
    {
      id: 'grossProfit',
      title: t.kpis.grossProfit,
      val: hasProfitPerm ? kpis.grossProfit : null,
      icon: BadgeCheck,
      color: 'teal',
      sub: hasProfitPerm ? `هامش مجمل الربح: ${Math.round((kpis.profitMargin || 0) * 10) / 10}%` : 'محجوب بضوابط السرية المالية',
      targetTab: 'reports'
    },
    {
      id: 'expenses',
      title: t.kpis.operatingExpenses,
      val: kpis.operatingExpenses,
      icon: Building,
      color: 'rose',
      sub: 'المصروفات البيعية والعمومية المرحلة',
      targetTab: 'reports'
    },
    {
      id: 'netProfit',
      title: t.kpis.netProfit,
      val: hasProfitPerm ? kpis.netProfit : null,
      icon: TrendingUp,
      color: 'emerald',
      sub: hasProfitPerm ? 'صافي الربح التشغيلي المعتمد' : 'محجوب بضوابط السرية المالية',
      targetTab: 'reports'
    }
  ];

  return (
    <div className="space-y-6 select-none animate-in fade-in duration-150">
      {/* Top Banner & Filters Bar */}
      <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800 shadow-xl text-white space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono text-[11px] font-bold border border-emerald-500/30">
                LIVE ERP ANALYTICS ENGINE
              </span>
              <span className="text-slate-400 text-xs font-mono">
                {metadata.lastUpdated ? new Date(metadata.lastUpdated).toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-US') : ''}
              </span>
            </div>
            <h2 className="text-xl font-bold flex items-center gap-2 text-white">
              <TrendingUp className="w-6 h-6 text-emerald-400" />
              <span>{lang === 'ar' ? 'لوحة التحكم والتشغيل المالي والمحاسبي' : 'Executive Accounting Dashboard'}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
              مؤشرات أداء مالية ومخزنية حقيقية مستخرجة مباشرة من قيود اليومية ومحرك الأستاذ العام المتزن مع دعم التصفية الزمنية والمكانية.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start lg:self-auto">
            <button
              onClick={() => {
                fetchStats();
                if (onRefresh) onRefresh();
              }}
              disabled={loading}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 flex items-center gap-2 transition"
              title="تحديث البيانات لحظياً"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
              <span>{loading ? 'جارٍ التحديث...' : 'تحديث'}</span>
            </button>
            <button
              onClick={() => navigateIfAllowed('sales')}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-900/40 flex items-center gap-1.5 transition"
            >
              <Receipt className="w-4 h-4" />
              <span>فاتورة بيع</span>
            </button>
            <button
              onClick={() => navigateIfAllowed('reports')}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 flex items-center gap-1.5 transition"
            >
              <FileText className="w-4 h-4 text-sky-400" />
              <span>التقارير المالية</span>
            </button>
          </div>
        </div>

        {/* Filters Controls Strip */}
        <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Date range shortcuts */}
          <div className="flex items-center gap-1.5 bg-slate-950/60 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => handleShortcut('today')}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${activeShortcut === 'today' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
            >
              اليوم
            </button>
            <button
              onClick={() => handleShortcut('month')}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${activeShortcut === 'month' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
            >
              هذا الشهر
            </button>
            <button
              onClick={() => handleShortcut('year')}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${activeShortcut === 'year' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
            >
              هذا العام
            </button>
            <button
              onClick={() => handleShortcut('all')}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${activeShortcut === 'all' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
            >
              كافة الفترات
            </button>
          </div>

          {/* Date Pickers */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-950/60 px-3 py-1.5 rounded-xl border border-slate-800">
              <span className="text-slate-400 text-[11px]">من:</span>
              <input
                type="date"
                value={fromDate}
                onChange={e => {
                  setFromDate(e.target.value);
                  setActiveShortcut('all');
                }}
                className="bg-transparent text-white font-mono text-xs focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1.5 bg-slate-950/60 px-3 py-1.5 rounded-xl border border-slate-800">
              <span className="text-slate-400 text-[11px]">إلى:</span>
              <input
                type="date"
                value={toDate}
                onChange={e => {
                  setToDate(e.target.value);
                  setActiveShortcut('all');
                }}
                className="bg-transparent text-white font-mono text-xs focus:outline-none"
              />
            </div>
          </div>

          {/* Branch & Warehouse Selectors */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-950/60 px-3 py-1 rounded-xl border border-slate-800">
              <Building className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={selectedBranch}
                onChange={e => setSelectedBranch(e.target.value)}
                className="bg-transparent text-white text-xs focus:outline-none cursor-pointer"
              >
                <option value="all" className="bg-slate-900">كافة الفروع</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id} className="bg-slate-900">{b.name_ar}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 bg-slate-950/60 px-3 py-1 rounded-xl border border-slate-800">
              <Boxes className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={selectedWarehouse}
                onChange={e => setSelectedWarehouse(e.target.value)}
                className="bg-transparent text-white text-xs focus:outline-none cursor-pointer"
              >
                <option value="all" className="bg-slate-900">كافة المستودعات</option>
                {warehouses.map(w => (
                  <option key={w.id} value={w.id} className="bg-slate-900">{w.name_ar}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Comparative Trend Notice if Date Filtered */}
      {comparison && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-xs text-blue-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-400 shrink-0" />
            <span>
              مقارنة بالفترة السابقة المماثلة ({comparison.prevPeriod.fromDate} إلى {comparison.prevPeriod.toDate}):
            </span>
          </div>
          <div className="flex items-center gap-4 font-mono">
            <span>
              المبيعات: <b className={comparison.sales.diff >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {comparison.sales.diff >= 0 ? '+' : ''}{comparison.sales.percent}% ({formatEGP(comparison.sales.diff)})
              </b>
            </span>
            <span>
              المشتريات: <b className={comparison.purchases.diff >= 0 ? 'text-amber-400' : 'text-emerald-400'}>
                {comparison.purchases.diff >= 0 ? '+' : ''}{comparison.purchases.percent}% ({formatEGP(comparison.purchases.diff)})
              </b>
            </span>
          </div>
        </div>
      )}

      {/* KPI Cards Grid (8 Core Accounting Metrics) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.id}
              onClick={() => navigateIfAllowed(c.targetTab)}
              className="bg-slate-800/60 rounded-2xl p-5 border border-slate-700/60 shadow-xl hover:border-emerald-500/50 hover:bg-slate-800/80 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-300">{c.title}</span>
                <div className="p-2 rounded-xl bg-slate-900/60 text-slate-300 group-hover:text-emerald-400 transition">
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="text-xl font-bold font-mono text-white mb-1">
                {c.val === null ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-amber-400 font-sans font-normal">
                    <Lock className="w-3.5 h-3.5" />
                    <span>محجوب أمنياً</span>
                  </span>
                ) : (
                  formatEGP(c.val)
                )}
              </div>
              <div className="text-[11px] text-slate-400 flex items-center justify-between">
                <span>{c.sub}</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-400 transition rtl:rotate-180" />
              </div>
            </div>
          );
        })}
      </div>

      {/* ────────────────────────────────────────────────────────── */}
      {/* ⚠️ SECTION: يحتاج إجراء - Action Center (Phase 7) */}
      {/* ────────────────────────────────────────────────────────── */}
      {statsData?.actionRequired && (
        <div className="bg-slate-900/90 rounded-2xl p-5 border border-amber-500/30 shadow-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">مركز العمليات: يحتاج إجراء</h3>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    {(statsData.actionRequired.overdueSalesInvoices?.count || 0) +
                     (statsData.actionRequired.overduePurchaseInvoices?.count || 0) +
                     (statsData.actionRequired.unallocatedVouchers?.count || 0) +
                     (statsData.actionRequired.pendingDrafts?.count || 0) +
                     (statsData.actionRequired.lowStockItems?.count || 0)} تنبيه يتطلب المعالجة
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  رصد مباشر للمتأخرات المالية، الفواتير المستحقة، السندات غير المخصصة، المسودات المعلقة، والأصناف تحت حد الطلب.
                </p>
              </div>
            </div>
            {selectedActionCategory && (
              <button
                onClick={() => setSelectedActionCategory(null)}
                className="text-xs text-slate-400 hover:text-white px-3 py-1 rounded-lg bg-slate-800 border border-slate-700"
              >
                إغلاق قائمة التفاصيل ✕
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* 1. Overdue Sales Invoices */}
            {canAccessTab('sales', currentUser) && (
              <div
                onClick={() => setSelectedActionCategory(selectedActionCategory === 'overdueSales' ? null : 'overdueSales')}
                className={`p-4 rounded-xl border transition-all cursor-pointer ${
                  selectedActionCategory === 'overdueSales'
                    ? 'bg-rose-950/40 border-rose-500 text-white shadow-lg'
                    : 'bg-slate-800/60 border-slate-700/60 hover:border-rose-500/50 text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold mb-2">
                  <span className="text-rose-400">فواتير بيع مستحقة</span>
                  <Receipt className="w-4 h-4 text-rose-400" />
                </div>
                <div className="text-xl font-bold font-mono text-white">
                  {statsData.actionRequired.overdueSalesInvoices?.count || 0}
                </div>
                <div className="text-[11px] font-mono text-rose-300 mt-1">
                  {formatEGP(statsData.actionRequired.overdueSalesInvoices?.totalAmount || 0)}
                </div>
                <div className="mt-3 pt-2 border-t border-slate-700/50 flex items-center justify-between text-[10px] text-slate-400">
                  <span className="text-rose-400 hover:underline" onClick={(e) => { e.stopPropagation(); onNavigateTab('sales'); }}>
                    شاشة المبيعات ←
                  </span>
                  <span>{selectedActionCategory === 'overdueSales' ? 'إخفاء' : 'عرض'}</span>
                </div>
              </div>
            )}

            {/* 2. Overdue Purchase Invoices */}
            {canAccessTab('purchases', currentUser) && (
              <div
                onClick={() => setSelectedActionCategory(selectedActionCategory === 'overduePurchases' ? null : 'overduePurchases')}
                className={`p-4 rounded-xl border transition-all cursor-pointer ${
                  selectedActionCategory === 'overduePurchases'
                    ? 'bg-amber-950/40 border-amber-500 text-white shadow-lg'
                    : 'bg-slate-800/60 border-slate-700/60 hover:border-amber-500/50 text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold mb-2">
                  <span className="text-amber-400">فواتير شراء مستحقة</span>
                  <ShoppingBag className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-xl font-bold font-mono text-white">
                  {statsData.actionRequired.overduePurchaseInvoices?.count || 0}
                </div>
                <div className="text-[11px] font-mono text-amber-300 mt-1">
                  {formatEGP(statsData.actionRequired.overduePurchaseInvoices?.totalAmount || 0)}
                </div>
                <div className="mt-3 pt-2 border-t border-slate-700/50 flex items-center justify-between text-[10px] text-slate-400">
                  <span className="text-amber-400 hover:underline" onClick={(e) => { e.stopPropagation(); onNavigateTab('purchases'); }}>
                    شاشة المشتريات ←
                  </span>
                  <span>{selectedActionCategory === 'overduePurchases' ? 'إخفاء' : 'عرض'}</span>
                </div>
              </div>
            )}

            {/* 3. Unallocated Vouchers */}
            {canAccessTab('treasury', currentUser) && (
              <div
                onClick={() => setSelectedActionCategory(selectedActionCategory === 'unallocatedVouchers' ? null : 'unallocatedVouchers')}
                className={`p-4 rounded-xl border transition-all cursor-pointer ${
                  selectedActionCategory === 'unallocatedVouchers'
                    ? 'bg-sky-950/40 border-sky-500 text-white shadow-lg'
                    : 'bg-slate-800/60 border-slate-700/60 hover:border-sky-500/50 text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold mb-2">
                  <span className="text-sky-400">سندات غير مخصصة</span>
                  <CreditCard className="w-4 h-4 text-sky-400" />
                </div>
                <div className="text-xl font-bold font-mono text-white">
                  {statsData.actionRequired.unallocatedVouchers?.count || 0}
                </div>
                <div className="text-[11px] font-mono text-sky-300 mt-1">
                  {formatEGP(statsData.actionRequired.unallocatedVouchers?.totalAmount || 0)}
                </div>
                <div className="mt-3 pt-2 border-t border-slate-700/50 flex items-center justify-between text-[10px] text-slate-400">
                  <span className="text-sky-400 hover:underline" onClick={(e) => { e.stopPropagation(); onNavigateTab('treasury'); }}>
                    شاشة الخزينة ←
                  </span>
                  <span>{selectedActionCategory === 'unallocatedVouchers' ? 'إخفاء' : 'عرض'}</span>
                </div>
              </div>
            )}

            {/* 4. Pending Drafts */}
            <div
              onClick={() => setSelectedActionCategory(selectedActionCategory === 'pendingDrafts' ? null : 'pendingDrafts')}
              className={`p-4 rounded-xl border transition-all cursor-pointer ${
                selectedActionCategory === 'pendingDrafts'
                  ? 'bg-purple-950/40 border-purple-500 text-white shadow-lg'
                  : 'bg-slate-800/60 border-slate-700/60 hover:border-purple-500/50 text-slate-200'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-semibold mb-2">
                <span className="text-purple-400">مسودات معلقة</span>
                <Clock className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-xl font-bold font-mono text-white">
                {statsData.actionRequired.pendingDrafts?.count || 0}
              </div>
              <div className="text-[11px] font-mono text-purple-300 mt-1">
                {formatEGP(statsData.actionRequired.pendingDrafts?.totalAmount || 0)}
              </div>
              <div className="mt-3 pt-2 border-t border-slate-700/50 flex items-center justify-between text-[10px] text-slate-400">
                <span className="text-purple-400">تنتظر المراجعة</span>
                <span>{selectedActionCategory === 'pendingDrafts' ? 'إخفاء' : 'عرض'}</span>
              </div>
            </div>

            {/* 5. Low Stock Items */}
            {canAccessTab('inventory', currentUser) && (
              <div
                onClick={() => setSelectedActionCategory(selectedActionCategory === 'lowStock' ? null : 'lowStock')}
                className={`p-4 rounded-xl border transition-all cursor-pointer ${
                  selectedActionCategory === 'lowStock'
                    ? 'bg-emerald-950/40 border-emerald-500 text-white shadow-lg'
                    : 'bg-slate-800/60 border-slate-700/60 hover:border-emerald-500/50 text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold mb-2">
                  <span className="text-emerald-400">أصناف تحت حد الطلب</span>
                  <Package className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-xl font-bold font-mono text-white">
                  {statsData.actionRequired.lowStockItems?.count || 0}
                </div>
                <div className="text-[11px] text-emerald-300 mt-1">
                  أصناف بحاجة لأمر شراء
                </div>
                <div className="mt-3 pt-2 border-t border-slate-700/50 flex items-center justify-between text-[10px] text-slate-400">
                  <span className="text-emerald-400 hover:underline" onClick={(e) => { e.stopPropagation(); onNavigateTab('inventory'); }}>
                    شاشة المخازن ←
                  </span>
                  <span>{selectedActionCategory === 'lowStock' ? 'إخفاء' : 'عرض'}</span>
                </div>
              </div>
            )}
          </div>

          {/* Expanded Drawer for Selected Category */}
          {selectedActionCategory && (
            <div className="mt-3 bg-slate-950/70 rounded-xl p-4 border border-slate-800 space-y-3">
              {/* Category 1: Overdue Sales */}
              {selectedActionCategory === 'overdueSales' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold text-rose-300">قائمة فواتير البيع المستحقة السداد:</h4>
                    <button
                      onClick={() => onNavigateTab('sales')}
                      className="text-xs text-rose-400 hover:underline"
                    >
                      فتح شاشة المبيعات لمتابعة التحصيل ←
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1.5">
                    {statsData.actionRequired.overdueSalesInvoices?.invoices?.map((inv: any) => (
                      <div key={inv.id} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold text-emerald-400">{inv.invoice_number}</span>
                          <span className="text-slate-200">{inv.customer_name || 'عميل'}</span>
                          <span className="text-slate-500 text-[11px]">تاريخ الاستحقاق: {inv.due_date}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-mono font-bold text-rose-400">{formatEGP(inv.remaining_amount || inv.total_amount)}</span>
                          <button
                            onClick={() => onNavigateTab('treasury')}
                            className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold"
                          >
                            إصدار سند قبض
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Category 2: Overdue Purchases */}
              {selectedActionCategory === 'overduePurchases' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold text-amber-300">قائمة فواتير الشراء المستحقة للموردين:</h4>
                    <button
                      onClick={() => onNavigateTab('purchases')}
                      className="text-xs text-amber-400 hover:underline"
                    >
                      فتح شاشة المشتريات ←
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1.5">
                    {statsData.actionRequired.overduePurchaseInvoices?.invoices?.map((inv: any) => (
                      <div key={inv.id} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold text-amber-400">{inv.invoice_number}</span>
                          <span className="text-slate-200">{inv.supplier_name || 'مورد'}</span>
                          <span className="text-slate-500 text-[11px]">تاريخ الاستحقاق: {inv.due_date}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-mono font-bold text-amber-400">{formatEGP(inv.remaining_amount || inv.total_amount)}</span>
                          <button
                            onClick={() => onNavigateTab('treasury')}
                            className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-semibold"
                          >
                            إصدار سند دفع
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Category 3: Unallocated Vouchers */}
              {selectedActionCategory === 'unallocatedVouchers' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold text-sky-300">سندات قبض ودفع غير مخصصة لفواتير محددة:</h4>
                    <button
                      onClick={() => onNavigateTab('treasury')}
                      className="text-xs text-sky-400 hover:underline"
                    >
                      فتح شاشة الخزينة والمصارف ←
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1.5">
                    {statsData.actionRequired.unallocatedVouchers?.vouchers?.map((vch: any) => (
                      <div key={vch.id} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold text-sky-400">{vch.voucher_number}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300">
                            {vch.type === 'receipt' ? 'قبض' : 'دفع'}
                          </span>
                          <span className="text-slate-200">{vch.party_name || 'طرف تعامل'}</span>
                          <span className="text-slate-500 text-[11px]">{vch.date}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-mono font-bold text-white">{formatEGP(vch.amount)}</span>
                          <span className="text-sky-300 text-[11px]">دفعة مقدمة غير مخصصة</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Category 4: Pending Drafts */}
              {selectedActionCategory === 'pendingDrafts' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold text-purple-300">مسودات معلقة لم تُرحّل بعد:</h4>
                    <span className="text-xs text-slate-400">لا تؤثر على الأرصدة أو قيود الأستاذ العام حتى ترحيلها</span>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1.5">
                    {statsData.actionRequired.pendingDrafts?.drafts?.map((d: any) => (
                      <div key={d.id} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold text-purple-400">{d.number}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] bg-purple-950/80 text-purple-300 border border-purple-500/30">
                            {d.type === 'sales_invoice' ? 'فاتورة بيع' :
                             d.type === 'purchase_invoice' ? 'فاتورة شراء' :
                             d.type === 'sales_return' ? 'مردود بيع' :
                             d.type === 'purchase_return' ? 'مردود شراء' : 'قيد يومية'}
                          </span>
                          <span className="text-slate-400 text-[11px]">{d.date}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-mono font-bold text-white">{formatEGP(d.amount)}</span>
                          <button
                            onClick={() => {
                              if (d.type === 'sales_invoice') onNavigateTab('sales');
                              else if (d.type === 'purchase_invoice') onNavigateTab('purchases');
                              else if (d.type === 'sales_return') onNavigateTab('sales_returns');
                              else if (d.type === 'purchase_return') onNavigateTab('purchase_returns');
                              else onNavigateTab('journal');
                            }}
                            className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-semibold"
                          >
                            فتح المستند للترحيل
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Category 5: Low Stock */}
              {selectedActionCategory === 'lowStock' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold text-emerald-300">أصناف بالمخازن وصلت أو هبطت عن حد الطلب:</h4>
                    <button
                      onClick={() => onNavigateTab('inventory')}
                      className="text-xs text-emerald-400 hover:underline"
                    >
                      فتح شاشة المخازن ←
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1.5">
                    {statsData.actionRequired.lowStockItems?.items?.map((it: any) => (
                      <div key={it.id} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold text-emerald-400">{it.code}</span>
                          <span className="text-white font-medium">{it.name_ar}</span>
                          <span className="text-slate-500 text-[11px]">{it.warehouse_name}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-slate-400">الرصيد: <b className="text-rose-400 font-mono">{it.current_quantity}</b></span>
                          <span className="text-slate-500">حد الطلب: <b className="text-amber-400 font-mono">{it.reorder_level}</b></span>
                          <button
                            onClick={() => onNavigateTab('purchases')}
                            className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-[11px] font-semibold"
                          >
                            إنشاء أمر شراء
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Operational Sections Interactive Selector */}
      <div className="flex items-center gap-1 bg-slate-800/70 p-1.5 rounded-2xl border border-slate-700/60 overflow-x-auto text-xs">
        <button
          onClick={() => setActiveSection('sales')}
          className={`px-3 py-2 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
            activeSection === 'sales' ? 'bg-emerald-600 text-white shadow' : 'text-slate-300 hover:text-white'
          }`}
        >
          <Receipt className="w-3.5 h-3.5" />
          <span>المبيعات والعملاء</span>
        </button>

        <button
          onClick={() => setActiveSection('purchases')}
          className={`px-3 py-2 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
            activeSection === 'purchases' ? 'bg-emerald-600 text-white shadow' : 'text-slate-300 hover:text-white'
          }`}
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          <span>المشتريات والموردون</span>
        </button>

        <button
          onClick={() => setActiveSection('treasury')}
          className={`px-3 py-2 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
            activeSection === 'treasury' ? 'bg-emerald-600 text-white shadow' : 'text-slate-300 hover:text-white'
          }`}
        >
          <Landmark className="w-3.5 h-3.5" />
          <span>التحصيل والسداد والسيولة</span>
        </button>

        <button
          onClick={() => setActiveSection('aging')}
          className={`px-3 py-2 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
            activeSection === 'aging' ? 'bg-emerald-600 text-white shadow' : 'text-slate-300 hover:text-white'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>أعمار الديون والذمم</span>
        </button>

        <button
          onClick={() => setActiveSection('inventory')}
          className={`px-3 py-2 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
            activeSection === 'inventory' ? 'bg-emerald-600 text-white shadow' : 'text-slate-300 hover:text-white'
          }`}
        >
          <Boxes className="w-3.5 h-3.5" />
          <span>المخزون والمستودعات</span>
        </button>

        <button
          onClick={() => setActiveSection('profitability')}
          className={`px-3 py-2 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
            activeSection === 'profitability' ? 'bg-emerald-600 text-white shadow' : 'text-slate-300 hover:text-white'
          }`}
        >
          <BadgeCheck className="w-3.5 h-3.5" />
          <span>الربحية والتكاليف</span>
        </button>

        <button
          onClick={() => setActiveSection('monitoring')}
          className={`px-3 py-2 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
            activeSection === 'monitoring' ? 'bg-emerald-600 text-white shadow' : 'text-slate-300 hover:text-white'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>المتابعة والتنبيهات والمسودات</span>
          {sections.monitoring?.alerts?.length > 0 && (
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
          )}
        </button>
      </div>

      {/* SECTION CONTENT CONTAINER */}
      <div className="bg-slate-800/60 rounded-2xl border border-slate-700/60 p-6 shadow-xl space-y-6">
        {/* 1. SALES SECTION */}
        {activeSection === 'sales' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">فواتير المبيعات المرحلة</span>
                <span className="text-xl font-bold font-mono text-emerald-400">
                  {sections.sales?.invoiceCount || 0} فاتورة
                </span>
                <span className="text-xs text-slate-400 block mt-1">بإجمالي: {formatEGP(sections.sales?.grossTotal)}</span>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">مردودات المبيعات المرحلة</span>
                <span className="text-xl font-bold font-mono text-amber-400">
                  {sections.sales?.returnsCount || 0} مردود
                </span>
                <span className="text-xs text-slate-400 block mt-1">بقيمة: {formatEGP(sections.sales?.returnsTotal)}</span>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">صافي المبيعات الفعلي</span>
                <span className="text-xl font-bold font-mono text-white">
                  {formatEGP(sections.sales?.netSales)}
                </span>
                <span className="text-xs text-slate-400 block mt-1">بعد استبعاد المردودات والخصومات</span>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">متوسط قيمة الفاتورة</span>
                <span className="text-xl font-bold font-mono text-sky-400">
                  {formatEGP(sections.sales?.averageInvoiceValue)}
                </span>
                <span className="text-xs text-slate-400 block mt-1">معدل البيع لكل فاتورة</span>
              </div>
            </div>

            {/* Top Customers & Top Items */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-700/60">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                  <h4 className="font-bold text-white text-xs flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-400" />
                    <span>أعلى 5 عملاء شراءً خلال الفترة</span>
                  </h4>
                  <button
                    onClick={() => navigateIfAllowed('parties')}
                    className="text-[11px] text-emerald-400 hover:underline"
                  >
                    عرض العملاء
                  </button>
                </div>
                <div className="space-y-2">
                  {(sections.sales?.topCustomers || []).map((c: any, i: number) => (
                    <div key={c.id || i} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/40 text-xs">
                      <div>
                        <span className="font-bold text-white block">{c.name_ar}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{c.code} • {c.invoice_count} فواتير</span>
                      </div>
                      <span className="font-mono font-bold text-emerald-400">{formatEGP(c.total_sales)}</span>
                    </div>
                  ))}
                  {(!sections.sales?.topCustomers || sections.sales.topCustomers.length === 0) && (
                    <p className="text-slate-500 text-xs text-center py-4">لا توجد مبيعات في الفترة المحددة</p>
                  )}
                </div>
              </div>

              <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-700/60">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                  <h4 className="font-bold text-white text-xs flex items-center gap-2">
                    <Package className="w-4 h-4 text-sky-400" />
                    <span>أعلى 5 أصناف مبيعاً خلال الفترة</span>
                  </h4>
                  <button
                    onClick={() => navigateIfAllowed('inventory')}
                    className="text-[11px] text-sky-400 hover:underline"
                  >
                    عرض الأصناف
                  </button>
                </div>
                <div className="space-y-2">
                  {(sections.sales?.topItems || []).map((it: any, i: number) => (
                    <div key={it.id || i} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/40 text-xs">
                      <div>
                        <span className="font-bold text-white block">{it.name_ar}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{it.code} • المباع: {it.total_qty} قطعة</span>
                      </div>
                      <span className="font-mono font-bold text-sky-400">{formatEGP(it.total_amount)}</span>
                    </div>
                  ))}
                  {(!sections.sales?.topItems || sections.sales.topItems.length === 0) && (
                    <p className="text-slate-500 text-xs text-center py-4">لا توجد حركات أصناف في الفترة المحددة</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. PURCHASES SECTION */}
        {activeSection === 'purchases' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">فواتير المشتريات المرحلة</span>
                <span className="text-xl font-bold font-mono text-emerald-400">
                  {sections.purchases?.invoiceCount || 0} فاتورة
                </span>
                <span className="text-xs text-slate-400 block mt-1">بإجمالي: {formatEGP(sections.purchases?.grossTotal)}</span>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">مردودات المشتريات للموردين</span>
                <span className="text-xl font-bold font-mono text-amber-400">
                  {sections.purchases?.returnsCount || 0} مردود
                </span>
                <span className="text-xs text-slate-400 block mt-1">بقيمة: {formatEGP(sections.purchases?.returnsTotal)}</span>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">صافي المشتريات الفعلي</span>
                <span className="text-xl font-bold font-mono text-white">
                  {formatEGP(sections.purchases?.netPurchases)}
                </span>
                <span className="text-xs text-slate-400 block mt-1">بعد استبعاد المردودات للموردين</span>
              </div>
            </div>

            {/* Top Suppliers */}
            <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-700/60">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                <h4 className="font-bold text-white text-xs flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-emerald-400" />
                  <span>أعلى 5 موردين تم الشراء منهم خلال الفترة</span>
                </h4>
                <button
                  onClick={() => navigateIfAllowed('purchases')}
                  className="text-[11px] text-emerald-400 hover:underline"
                >
                  فواتير المشتريات
                </button>
              </div>
              <div className="space-y-2">
                {(sections.purchases?.topSuppliers || []).map((s: any, i: number) => (
                  <div key={s.id || i} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/40 text-xs">
                    <div>
                      <span className="font-bold text-white block">{s.name_ar}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{s.code} • {s.invoice_count} فواتير توريد</span>
                    </div>
                    <span className="font-mono font-bold text-amber-400">{formatEGP(s.total_purchases)}</span>
                  </div>
                ))}
                {(!sections.purchases?.topSuppliers || sections.purchases.topSuppliers.length === 0) && (
                  <p className="text-slate-500 text-xs text-center py-4">لا توجد مشتريات في الفترة المحددة</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 3. TREASURY & CASH FLOW SECTION */}
        {activeSection === 'treasury' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">إجمالي المقبوضات النقدية والبنكية</span>
                <span className="text-xl font-bold font-mono text-emerald-400">
                  {formatEGP(sections.treasury?.receiptsTotal)}
                </span>
                <span className="text-xs text-slate-400 block mt-1">عدد ({sections.treasury?.receiptsCount || 0}) سند قبض</span>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">إجمالي المدفوعات والمصروفات</span>
                <span className="text-xl font-bold font-mono text-rose-400">
                  {formatEGP(sections.treasury?.paymentsTotal)}
                </span>
                <span className="text-xs text-slate-400 block mt-1">عدد ({sections.treasury?.paymentsCount || 0}) سند صرف</span>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">صافي حركة السيولة للفترة</span>
                <span className={`text-xl font-bold font-mono ${
                  (sections.treasury?.netCashMovement || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {formatEGP(sections.treasury?.netCashMovement)}
                </span>
                <span className="text-xs text-slate-400 block mt-1">الفارق بين المقبوضات والمدفوعات</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-rose-500/10 p-4 rounded-xl border border-rose-500/20">
                <div className="flex items-center gap-2 mb-2 text-rose-300 font-bold text-xs">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  <span>متأخرات التحصيل من العملاء (تجاوزت تاريخ الاستحقاق)</span>
                </div>
                <div className="text-xl font-bold font-mono text-rose-400 mb-1">
                  {formatEGP(sections.treasury?.overdueReceivablesTotal)}
                </div>
                <span className="text-xs text-slate-300">
                  عدد ({sections.treasury?.overdueReceivablesCount || 0}) فاتورة بيع متأخرة
                </span>
              </div>

              <div className="bg-amber-500/10 p-4 rounded-xl border border-amber-500/20">
                <div className="flex items-center gap-2 mb-2 text-amber-300 font-bold text-xs">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span>فواتير مبيعات مستحقة خلال الأيام السبعة القادمة</span>
                </div>
                <div className="text-xl font-bold font-mono text-amber-400 mb-1">
                  {formatEGP(sections.treasury?.dueSoonReceivablesTotal)}
                </div>
                <span className="text-xs text-slate-300">
                  عدد ({sections.treasury?.dueSoonReceivablesCount || 0}) فاتورة تستحق قريباً
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 4. PARTIES & AGING SECTION */}
        {activeSection === 'aging' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">إجمالي الذمم المدينة (العملاء 1121) كما في التاريخ</span>
                <span className="text-2xl font-bold font-mono text-sky-400">
                  {formatEGP(sections.partiesAging?.receivablesBalance)}
                </span>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">إجمالي الذمم الدائنة (الموردون 2111) كما في التاريخ</span>
                <span className="text-2xl font-bold font-mono text-amber-400">
                  {formatEGP(sections.partiesAging?.payablesBalance)}
                </span>
              </div>
            </div>

            {/* Aging Tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-700/60">
                <h4 className="font-bold text-white text-xs mb-3 pb-2 border-b border-slate-800 flex items-center gap-2">
                  <ArrowUpRight className="w-4 h-4 text-sky-400" />
                  <span>تحليل أعمار ديون العملاء (حسب تاريخ الفاتورة)</span>
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-2 rounded bg-slate-800/40">
                    <span className="text-slate-300">أقل من 30 يوماً (جاري):</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {formatEGP(sections.partiesAging?.receivablesAging?.bucket_0_30)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-800/40">
                    <span className="text-slate-300">من 31 إلى 60 يوماً:</span>
                    <span className="font-mono font-bold text-blue-400">
                      {formatEGP(sections.partiesAging?.receivablesAging?.bucket_31_60)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-800/40">
                    <span className="text-slate-300">من 61 إلى 90 يوماً:</span>
                    <span className="font-mono font-bold text-amber-400">
                      {formatEGP(sections.partiesAging?.receivablesAging?.bucket_61_90)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-800/40">
                    <span className="text-slate-300">أكثر من 90 يوماً (متعثر/حرج):</span>
                    <span className="font-mono font-bold text-rose-400">
                      {formatEGP(sections.partiesAging?.receivablesAging?.bucket_90_plus)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-700/60">
                <h4 className="font-bold text-white text-xs mb-3 pb-2 border-b border-slate-800 flex items-center gap-2">
                  <ArrowDownLeft className="w-4 h-4 text-amber-400" />
                  <span>تحليل أعمار مستحقات الموردين (حسب تاريخ الفاتورة)</span>
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-2 rounded bg-slate-800/40">
                    <span className="text-slate-300">أقل من 30 يوماً (جاري):</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {formatEGP(sections.partiesAging?.payablesAging?.bucket_0_30)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-800/40">
                    <span className="text-slate-300">من 31 إلى 60 يوماً:</span>
                    <span className="font-mono font-bold text-blue-400">
                      {formatEGP(sections.partiesAging?.payablesAging?.bucket_31_60)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-800/40">
                    <span className="text-slate-300">من 61 إلى 90 يوماً:</span>
                    <span className="font-mono font-bold text-amber-400">
                      {formatEGP(sections.partiesAging?.payablesAging?.bucket_61_90)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-800/40">
                    <span className="text-slate-300">أكثر من 90 يوماً:</span>
                    <span className="font-mono font-bold text-rose-400">
                      {formatEGP(sections.partiesAging?.payablesAging?.bucket_90_plus)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 5. INVENTORY & WAREHOUSES SECTION */}
        {activeSection === 'inventory' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">إجمالي تقييم المخزون المالي</span>
                <span className="text-xl font-bold font-mono text-indigo-400">
                  {hasCostPerm ? formatEGP(sections.inventory?.valuation) : (
                    <span className="text-xs text-amber-400 inline-flex items-center gap-1 font-sans">
                      <Lock className="w-3.5 h-3.5" />
                      محجوب أمنياً
                    </span>
                  )}
                </span>
                <span className="text-xs text-slate-400 block mt-1">بالتكلفة المتوسطة المتحركة</span>
              </div>

              <div className="bg-rose-500/10 p-4 rounded-xl border border-rose-500/20">
                <span className="text-rose-300 text-xs block mb-1">أصناف نفدت تماماً من المستودعات</span>
                <span className="text-xl font-bold font-mono text-rose-400">
                  {sections.inventory?.outOfStockCount || 0} صنف
                </span>
                <span className="text-xs text-slate-300 block mt-1">تتطلب أمر شراء توريد فوري</span>
              </div>

              <div className="bg-amber-500/10 p-4 rounded-xl border border-amber-500/20">
                <span className="text-amber-300 text-xs block mb-1">أصناف تحت أو عند حد الطلب</span>
                <span className="text-xl font-bold font-mono text-amber-400">
                  {sections.inventory?.lowStockCount || 0} صنف
                </span>
                <span className="text-xs text-slate-300 block mt-1">تتطلب التجديد المخزني</span>
              </div>
            </div>

            {/* Warehouse Stock Distribution */}
            <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-700/60">
              <h4 className="font-bold text-white text-xs mb-3 pb-2 border-b border-slate-800 flex items-center gap-2">
                <Boxes className="w-4 h-4 text-indigo-400" />
                <span>توزيع المخزون والأرصدة حسب المستودع والفرع</span>
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-950/60 text-slate-300 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">المستودع</th>
                      <th className="py-2.5 px-3">الفرع</th>
                      <th className="py-2.5 px-3 text-center">عدد الأصناف المتوفرة</th>
                      <th className="py-2.5 px-3 text-center">إجمالي الكمية (قطع)</th>
                      {hasCostPerm && <th className="py-2.5 px-3 text-end">القيمة التقديرية</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300">
                    {(sections.inventory?.warehouseDistribution || []).map((w: any) => (
                      <tr key={w.id} className="hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-semibold text-white">{w.name_ar}</td>
                        <td className="py-2.5 px-3 text-slate-400">{w.branch_name}</td>
                        <td className="py-2.5 px-3 text-center font-mono">{w.items_count}</td>
                        <td className="py-2.5 px-3 text-center font-mono font-bold text-emerald-400">{w.total_quantity}</td>
                        {hasCostPerm && (
                          <td className="py-2.5 px-3 text-end font-mono font-bold text-white">
                            {formatEGP(w.valuation)}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 6. PROFITABILITY SECTION */}
        {activeSection === 'profitability' && (
          <div className="space-y-6">
            {!hasProfitPerm && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex items-center gap-2">
                <Lock className="w-5 h-5 text-amber-400 shrink-0" />
                <span>
                  تم حجب مؤشرات قائمة الدخل وهوامش الربحية عن هذا الحساب وفقاً للضوابط الأمنية المحددة من مسؤول النظام.
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">صافي الإيرادات التشغيلية</span>
                <span className="text-xl font-bold font-mono text-purple-400">
                  {formatEGP(sections.profitability?.netSales)}
                </span>
                <span className="text-xs text-slate-400 block mt-1">حسابات الإيراد (4111)</span>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">تكلفة البضاعة المباعة (COGS)</span>
                <span className="text-xl font-bold font-mono text-amber-400">
                  {hasCostPerm ? formatEGP(sections.profitability?.cogs) : 'محجوب أمنياً'}
                </span>
                <span className="text-xs text-slate-400 block mt-1">حسابات التكلفة (5111)</span>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">مجمل الربح التجاري</span>
                <span className="text-xl font-bold font-mono text-teal-400">
                  {hasProfitPerm ? formatEGP(sections.profitability?.grossProfit) : 'محجوب أمنياً'}
                </span>
                <span className="text-xs text-slate-400 block mt-1">
                  الهامش: {hasProfitPerm ? `${Math.round((sections.profitability?.profitMargin || 0) * 10) / 10}%` : '-'}
                </span>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                <span className="text-slate-400 text-xs block mb-1">صافي الربح التشغيلي</span>
                <span className={`text-xl font-bold font-mono ${
                  (sections.profitability?.netProfit || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {hasProfitPerm ? formatEGP(sections.profitability?.netProfit) : 'محجوب أمنياً'}
                </span>
                <span className="text-xs text-slate-400 block mt-1">بعد استبعاد المصروفات التشغيلية</span>
              </div>
            </div>
          </div>
        )}

        {/* 7. MONITORING, DRAFTS & ALERTS SECTION */}
        {activeSection === 'monitoring' && (
          <div className="space-y-6">
            {/* Actionable Alerts */}
            <div className="space-y-3">
              <h4 className="font-bold text-white text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>التنبيهات التشغيلية والرقابية اللحظية</span>
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(sections.monitoring?.alerts || []).map((alert: any) => (
                  <div
                    key={alert.id}
                    className={`p-4 rounded-xl border flex flex-col justify-between gap-3 text-xs ${
                      alert.type === 'danger'
                        ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                        : alert.type === 'warning'
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                        : 'bg-blue-500/10 border-blue-500/30 text-blue-200'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-white text-sm mb-1">{alert.title}</div>
                      <p className="text-slate-300 text-xs leading-relaxed">{alert.message}</p>
                    </div>

                    <button
                      onClick={() => navigateIfAllowed(alert.targetTab)}
                      className="self-end px-3 py-1.5 bg-slate-900/60 hover:bg-slate-900 text-white font-bold rounded-lg border border-slate-700 flex items-center gap-1.5 transition"
                    >
                      <span>فتح شاشة المعالجة</span>
                      <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
                    </button>
                  </div>
                ))}
                {(!sections.monitoring?.alerts || sections.monitoring.alerts.length === 0) && (
                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>كافة مؤشرات النظام والسيولة والمخزون في الحدود الآمنة والطبيعية.</span>
                  </div>
                )}
              </div>
            </div>

            {/* Pending Drafts Breakdown */}
            <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-700/60">
              <h4 className="font-bold text-white text-xs mb-3 pb-2 border-b border-slate-800 flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-400" />
                <span>المسودات المعلقة بانتظار المراجعة والاعتماد المحاسبي</span>
              </h4>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
                <div
                  onClick={() => navigateIfAllowed('sales')}
                  className="bg-slate-800/40 p-3 rounded-xl border border-slate-700/50 cursor-pointer hover:bg-slate-800/70 transition"
                >
                  <span className="text-slate-400 block text-[11px] mb-1">مسودات فواتير مبيعات</span>
                  <span className="font-mono text-lg font-bold text-emerald-400 block">
                    {sections.monitoring?.pendingDrafts?.salesInvoices?.count || 0}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    {formatEGP(sections.monitoring?.pendingDrafts?.salesInvoices?.total)}
                  </span>
                </div>

                <div
                  onClick={() => navigateIfAllowed('purchases')}
                  className="bg-slate-800/40 p-3 rounded-xl border border-slate-700/50 cursor-pointer hover:bg-slate-800/70 transition"
                >
                  <span className="text-slate-400 block text-[11px] mb-1">مسودات فواتير مشتريات</span>
                  <span className="font-mono text-lg font-bold text-amber-400 block">
                    {sections.monitoring?.pendingDrafts?.purchaseInvoices?.count || 0}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    {formatEGP(sections.monitoring?.pendingDrafts?.purchaseInvoices?.total)}
                  </span>
                </div>

                <div
                  onClick={() => navigateIfAllowed('sales_returns')}
                  className="bg-slate-800/40 p-3 rounded-xl border border-slate-700/50 cursor-pointer hover:bg-slate-800/70 transition"
                >
                  <span className="text-slate-400 block text-[11px] mb-1">مسودات مردودات مبيعات</span>
                  <span className="font-mono text-lg font-bold text-rose-400 block">
                    {sections.monitoring?.pendingDrafts?.salesReturns?.count || 0}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    {formatEGP(sections.monitoring?.pendingDrafts?.salesReturns?.total)}
                  </span>
                </div>

                <div
                  onClick={() => navigateIfAllowed('purchase_returns')}
                  className="bg-slate-800/40 p-3 rounded-xl border border-slate-700/50 cursor-pointer hover:bg-slate-800/70 transition"
                >
                  <span className="text-slate-400 block text-[11px] mb-1">مسودات مردودات مشتريات</span>
                  <span className="font-mono text-lg font-bold text-purple-400 block">
                    {sections.monitoring?.pendingDrafts?.purchaseReturns?.count || 0}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    {formatEGP(sections.monitoring?.pendingDrafts?.purchaseReturns?.total)}
                  </span>
                </div>

                <div
                  onClick={() => navigateIfAllowed('journal')}
                  className="bg-slate-800/40 p-3 rounded-xl border border-slate-700/50 cursor-pointer hover:bg-slate-800/70 transition"
                >
                  <span className="text-slate-400 block text-[11px] mb-1">مسودات قيود يومية</span>
                  <span className="font-mono text-lg font-bold text-sky-400 block">
                    {sections.monitoring?.pendingDrafts?.journalEntries?.count || 0}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">قيود قيد الإعداد</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Monthly Revenue Trend & Tax ETA Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Revenue Trend */}
        <div className="lg:col-span-2 bg-slate-800/60 rounded-2xl p-6 border border-slate-700/60 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-white text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-400" />
              <span>{t.salesChartTitle} - إيرادات النشاط الشهرية المتزنة</span>
            </h3>
            <span className="text-xs font-mono text-slate-400">السنة المالية 2026</span>
          </div>

          <div className="h-56 flex items-end gap-3 pt-6 pb-2 border-b border-slate-700/60">
            {monthlyTrend && monthlyTrend.length > 0 ? (
              monthlyTrend.map((m: any, idx: number) => {
                const max = Math.max(...monthlyTrend.map((t: any) => t.revenue || 1), 100000);
                const heightPercent = Math.max(Math.round(((m.revenue || 0) / max) * 100), 10);
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                    <span className="text-[10px] font-mono font-semibold text-emerald-400">
                      {Math.round((m.revenue || 0) / 1000)}k
                    </span>
                    <div
                      style={{ height: `${heightPercent}%` }}
                      className="w-full max-w-[48px] bg-emerald-500 hover:bg-emerald-400 rounded-t-lg transition-all shadow-md shadow-emerald-900/30"
                      title={`${m.month}: ${formatEGP(m.revenue)}`}
                    ></div>
                    <span className="text-[11px] font-medium text-slate-400">{m.month}</span>
                  </div>
                );
              })
            ) : (
              <div className="w-full text-center text-slate-400 text-xs py-10">لا توجد حركات شهرية مسجلة بعد</div>
            )}
          </div>
        </div>

        {/* Quick Tax & ETA Summary Card */}
        <div className="bg-slate-800/60 rounded-2xl p-6 border border-slate-700/60 shadow-xl flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-white text-sm mb-2 flex items-center gap-2">
              <BadgeCheck className="w-4 h-4 text-emerald-400" />
              <span>الامتثال الضريبي المصري (ETA)</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              مصلحة الضرائب المصرية - منظومة الفاتورة والإيصال الإلكتروني V1.0 مع دعم التوقيع الرقمي والربط اللحظي.
            </p>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between p-2.5 bg-slate-900/60 rounded-xl border border-slate-700/50">
                <span className="text-slate-300 font-medium">ضريبة القيمة المضافة:</span>
                <span className="font-bold font-mono text-emerald-400">14% القياسية (T1)</span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-slate-900/60 rounded-xl border border-slate-700/50">
                <span className="text-slate-300 font-medium">الخصم والتحصيل أمانات:</span>
                <span className="font-bold font-mono text-sky-400">1% توريدات (W01)</span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-slate-900/60 rounded-xl border border-slate-700/50">
                <span className="text-slate-300 font-medium">معيار التكويد الضريبي:</span>
                <span className="font-bold font-mono text-slate-300">GS1 / EGS</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => navigateIfAllowed('eta')}
            className="w-full mt-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs font-bold rounded-xl border border-emerald-500/30 transition"
          >
            فتح بوابة مطابقة الفاتورة الإلكترونية
          </button>
        </div>
      </div>

      {/* Recent Tables (Invoices & Journal Entries) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Invoices */}
        <div className="bg-slate-800/60 rounded-2xl border border-slate-700/60 shadow-xl overflow-hidden">
          <div className="p-4 border-b border-slate-700/60 flex items-center justify-between">
            <h3 className="font-bold text-white text-xs">{t.recentInvoices}</h3>
            <button
              onClick={() => navigateIfAllowed('sales')}
              className="text-xs text-emerald-400 hover:underline flex items-center gap-1 font-semibold"
            >
              <span>{lang === 'ar' ? 'عرض الكل' : 'View All'}</span>
              <ChevronRight className="w-3 h-3 rtl:rotate-180" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-700/60">
                <tr>
                  <th className="py-2.5 px-3">رقم الفاتورة</th>
                  <th className="py-2.5 px-3">العميل</th>
                  <th className="py-2.5 px-3 text-end">القيمة</th>
                  <th className="py-2.5 px-3 text-center">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/40 text-slate-200">
                {recentInvoices.map((inv: any) => (
                  <tr
                    key={inv.id}
                    onClick={() => onSelectInvoice(inv)}
                    className="hover:bg-slate-700/30 cursor-pointer transition"
                  >
                    <td className="py-2.5 px-3 font-mono font-medium text-emerald-400">{inv.invoice_number}</td>
                    <td className="py-2.5 px-3 text-slate-300">{inv.customer_name}</td>
                    <td className="py-2.5 px-3 text-end font-mono font-bold text-white">{formatEGP(inv.total_amount)}</td>
                    <td className="py-2.5 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        inv.status === 'draft' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
                      }`}>
                        {inv.status === 'draft' ? 'مسودة' : 'مرحلة'}
                      </span>
                    </td>
                  </tr>
                ))}
                {recentInvoices.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-6 text-slate-500">لا توجد فواتير حديثة</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Journal Entries */}
        <div className="bg-slate-800/60 rounded-2xl border border-slate-700/60 shadow-xl overflow-hidden">
          <div className="p-4 border-b border-slate-700/60 flex items-center justify-between">
            <h3 className="font-bold text-white text-xs">{lang === 'ar' ? 'أحدث قيود اليومية' : 'Recent Journal Entries'}</h3>
            <button
              onClick={() => navigateIfAllowed('journal')}
              className="text-xs text-emerald-400 hover:underline flex items-center gap-1 font-semibold"
            >
              <span>{lang === 'ar' ? 'عرض الكل' : 'View All'}</span>
              <ChevronRight className="w-3 h-3 rtl:rotate-180" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-700/60">
                <tr>
                  <th className="py-2.5 px-3">رقم القيد</th>
                  <th className="py-2.5 px-3">البيان</th>
                  <th className="py-2.5 px-3 text-end">مدين = دائن</th>
                  <th className="py-2.5 px-3 text-center">الفرع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/40 text-slate-200">
                {recentEntries.map((je: any) => (
                  <tr
                    key={je.id}
                    onClick={() => navigateIfAllowed('journal')}
                    className="hover:bg-slate-700/30 cursor-pointer transition"
                  >
                    <td className="py-2.5 px-3 font-mono font-medium text-sky-400">{je.entry_number}</td>
                    <td className="py-2.5 px-3 text-slate-300 max-w-[180px] truncate">{je.narration}</td>
                    <td className="py-2.5 px-3 text-end font-mono font-bold text-emerald-400">{formatEGP(je.total_debit)}</td>
                    <td className="py-2.5 px-3 text-center text-slate-400">{je.branch_name}</td>
                  </tr>
                ))}
                {recentEntries.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-6 text-slate-500">لا توجد قيود حديثة</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
