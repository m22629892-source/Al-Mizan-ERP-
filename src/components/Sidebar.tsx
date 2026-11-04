import {
  LayoutDashboard,
  FolderTree,
  BookOpenCheck,
  Receipt,
  RotateCcw,
  ShoppingBag,
  Undo2,
  Users,
  Boxes,
  Landmark,
  FileSpreadsheet,
  FileCheck2,
  TestTube2,
  ShieldCheck,
  CalendarCheck,
  Building2,
  ClipboardCheck,
  FileUp,
  BarChart3,
  Database,
  Palette
} from 'lucide-react';
import { Language, translations } from '../translations';
import { User } from '../types';
import { canAccessTab } from '../utils/permissions';

export type NavTab = 
  | 'dashboard'
  | 'accounts'
  | 'journal'
  | 'sales'
  | 'sales_returns'
  | 'purchases'
  | 'purchase_returns'
  | 'parties'
  | 'inventory'
  | 'treasury'
  | 'bank_reconciliation'
  | 'inventory_count'
  | 'month_close'
  | 'reports'
  | 'excel_import'
  | 'excel_analytics'
  | 'backup'
  | 'eta'
  | 'tests'
  | 'audit';

interface SidebarProps {
  currentTab: NavTab;
  onTabSelect: (tab: NavTab) => void;
  lang: Language;
  currentUser?: User | null;
  onOpenAppearanceModal?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onTabSelect, lang, currentUser = null, onOpenAppearanceModal }) => {
  const t = translations[lang];

  const navItems: { id: NavTab; label: string; icon: React.FC<{ className?: string }>; badge?: string }[] = [
    { id: 'dashboard', label: t.dashboard, icon: LayoutDashboard },
    { id: 'month_close', label: t.monthClose, icon: CalendarCheck, badge: 'إقفال' },
    { id: 'sales', label: t.salesInvoices, icon: Receipt },
    { id: 'sales_returns', label: t.salesReturns, icon: RotateCcw },
    { id: 'purchases', label: t.purchases, icon: ShoppingBag },
    { id: 'purchase_returns', label: t.purchaseReturns, icon: Undo2 },
    { id: 'parties', label: t.parties, icon: Users },
    { id: 'treasury', label: t.treasury, icon: Landmark },
    { id: 'bank_reconciliation', label: t.bankReconciliation, icon: Building2 },
    { id: 'inventory', label: t.inventory, icon: Boxes },
    { id: 'inventory_count', label: t.inventoryCount, icon: ClipboardCheck },
    { id: 'accounts', label: t.chartOfAccounts, icon: FolderTree },
    { id: 'journal', label: t.journalEntries, icon: BookOpenCheck },
    { id: 'reports', label: t.reports, icon: FileSpreadsheet },
    { id: 'excel_import', label: t.excelImport, icon: FileUp },
    { id: 'excel_analytics', label: t.excelAnalytics, icon: BarChart3, badge: 'مساعد الميزان' },
    { id: 'backup', label: t.backupRestore, icon: Database },
    { id: 'eta', label: t.etaCompliance, icon: FileCheck2, badge: 'ETA' },
    { id: 'tests', label: t.testRunner, icon: TestTube2, badge: '30+ فحصاً' },
    { id: 'audit', label: t.auditAndUsers, icon: ShieldCheck }
  ];

  const visibleItems = navItems.filter(item => canAccessTab(item.id, currentUser));

  return (
    <aside className="w-64 bg-slate-900 border-e border-slate-800 flex flex-col shrink-0 no-print select-none min-h-[calc(100vh-4rem)]">
      <div className="p-4 flex-1 py-4 space-y-1">
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 mb-2 flex items-center justify-between">
          <span>{lang === 'ar' ? 'الوحدات المسموحة' : 'Permitted Modules'}</span>
          <span className="text-[10px] text-emerald-400 font-mono">({visibleItems.length}/{navItems.length})</span>
        </div>

        {visibleItems.length === 0 ? (
          <div className="p-4 text-center text-xs text-amber-400/80 bg-amber-500/10 rounded-xl border border-amber-500/20">
            {lang === 'ar' ? 'لا توجد شاشات مصرح لك بعرضها حالياً. يرجى التواصل مع مسؤول النظام.' : 'No modules permitted.'}
          </div>
        ) : (
          visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onTabSelect(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-sm font-semibold'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-3 rtl:space-x-reverse">
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold ${
                    isActive
                      ? 'bg-emerald-800 text-emerald-100'
                      : 'bg-slate-800 text-emerald-400 border border-slate-700'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })
        )}
      </div>

      {/* Settings / Appearance Quick Access */}
      {onOpenAppearanceModal && (
        <div className="px-3 py-2 border-t border-slate-800/80">
          <button
            type="button"
            onClick={onOpenAppearanceModal}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800/80 transition-all border border-slate-800"
          >
            <div className="flex items-center gap-2.5">
              <Palette className="w-4 h-4 text-amber-400" />
              <span>{t.appearance}</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60">
              {t.theme}
            </span>
          </button>
        </div>
      )}

      {/* System Status Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/40 text-xs text-slate-400">
        <div className="flex items-center justify-between mb-1">
          <span className="text-slate-300 font-medium">المحرك المحاسبي:</span>
          <span className="inline-flex items-center text-emerald-400 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse me-1.5"></span>
            متزن وفعّال (ACID)
          </span>
        </div>
        <div className="text-[11px] text-slate-400">
          دقة الأرقام: Decimal 20 Precision
        </div>
      </div>
    </aside>
  );
};
