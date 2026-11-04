import { Building2, Calendar, Globe, User, ShieldCheck, RefreshCw, LogOut, Palette } from 'lucide-react';
import { Company, Branch, User as UserType } from '../types';
import { Language, translations } from '../translations';

interface HeaderProps {
  company: Company | null;
  branches: Branch[];
  activeBranchId: string;
  onBranchChange: (id: string) => void;
  lang: Language;
  onLangToggle: () => void;
  currentUser: UserType | null;
  onSwitchUserModalOpen: () => void;
  onRefreshData: () => void;
  onLogout?: () => void;
  onOpenAppearanceModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  company,
  branches,
  activeBranchId,
  onBranchChange,
  lang,
  onLangToggle,
  currentUser,
  onSwitchUserModalOpen,
  onRefreshData,
  onLogout,
  onOpenAppearanceModal
}) => {
  const t = translations[lang];

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-md no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Company Branding & Tax IDs */}
          <div className="flex items-center space-x-3 rtl:space-x-reverse">
            <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center font-bold text-xl text-white shadow-inner">
              م
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-base sm:text-lg text-slate-100 tracking-tight">
                  {lang === 'ar' ? (company?.name_ar || 'شركة الميزان للتجارة والتوريدات') : (company?.name_en || 'Al-Mizan Trading S.A.E')}
                </h1>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-950 text-emerald-400 border border-emerald-800">
                  <ShieldCheck className="w-3 h-3 me-1" />
                  مصلحة الضرائب: {company?.tax_id || '458-921-364'}
                </span>
              </div>
              <div className="text-xs text-slate-400 flex items-center gap-3">
                <span>س.ت: {company?.commercial_registry || '189452'}</span>
                <span className="hidden md:inline">|</span>
                <span className="hidden md:inline">القاهرة - جمهورية مصر العربية</span>
              </div>
            </div>
          </div>

          {/* Quick Context Controls */}
          <div className="flex items-center space-x-2 sm:space-x-3 rtl:space-x-reverse">
            {/* Branch Selector */}
            <div className="hidden sm:flex items-center bg-slate-800 rounded-lg px-2.5 py-1 text-xs border border-slate-700">
              <Building2 className="w-3.5 h-3.5 text-slate-400 me-1.5" />
              <select
                aria-label="Active Branch"
                value={activeBranchId}
                onChange={(e) => onBranchChange(e.target.value)}
                className="bg-transparent text-slate-200 outline-none cursor-pointer font-medium"
              >
                <option value="all" className="bg-slate-800">{t.allBranches}</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id} className="bg-slate-800">
                    {lang === 'ar' ? b.name_ar : b.name_en}
                  </option>
                ))}
              </select>
            </div>

            {/* Fiscal Year badge */}
            <div className="hidden md:flex items-center bg-slate-800 rounded-lg px-2.5 py-1 text-xs border border-slate-700 text-slate-300">
              <Calendar className="w-3.5 h-3.5 text-emerald-400 me-1.5" />
              <span>2026 (مفتوحة)</span>
            </div>

            {/* Quick Theme Switcher Button */}
            {onOpenAppearanceModal && (
              <button
                onClick={onOpenAppearanceModal}
                title={t.appearance}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 hover:text-white rounded-lg border border-slate-700 transition-colors shadow-xs"
              >
                <Palette className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">{t.theme}</span>
              </button>
            )}

            {/* Refresh button */}
            <button
              onClick={onRefreshData}
              title={t.refresh}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            {/* Language toggle */}
            <button
              onClick={onLangToggle}
              className="flex items-center text-xs font-semibold px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200 border border-slate-700 transition-colors"
            >
              <Globe className="w-3.5 h-3.5 me-1.5 text-sky-400" />
              {lang === 'ar' ? 'English' : 'عربي'}
            </button>

            {/* Current user & Role badge */}
            <div className="flex items-center gap-1.5 bg-slate-800 rounded-lg px-2.5 py-1 text-xs border border-slate-700">
              <User className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-medium max-w-[130px] truncate">{currentUser?.display_name || 'مستخدم'}</span>
              <span className="px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 text-[10px] font-mono border border-amber-800">
                {currentUser?.role || 'user'}
              </span>
            </div>

            {/* Logout button */}
            {onLogout && (
              <button
                onClick={onLogout}
                title={lang === 'ar' ? 'تسجيل الخروج' : 'Logout'}
                className="p-1.5 text-rose-300 hover:text-white hover:bg-rose-900/40 rounded-lg transition-colors border border-rose-900/30"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

