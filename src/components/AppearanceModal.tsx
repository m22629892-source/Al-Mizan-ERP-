import React, { useState, useEffect } from 'react';
import { 
  Palette, 
  Check, 
  RotateCcw, 
  SunMoon, 
  Rows3, 
  SlidersHorizontal,
  X,
  Sparkles,
  TrendingUp,
  FileSpreadsheet
} from 'lucide-react';
import { 
  ThemeId, 
  DensityMode, 
  UserThemeSettings, 
  THEMES_LIST, 
  DEFAULT_THEME_SETTINGS,
  getEffectiveTheme,
  applyThemeToDocument,
  saveUserThemeSettings
} from '../types/theme';
import { Language, translations } from '../translations';
import { User } from '../types';

interface AppearanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  savedSettings: UserThemeSettings;
  onSettingsSaved: (newSettings: UserThemeSettings) => void;
  lang: Language;
}

export const AppearanceModal: React.FC<AppearanceModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  savedSettings,
  onSettingsSaved,
  lang
}) => {
  const t = translations[lang];

  // Working state during modal interaction (supports live preview)
  const [workingSettings, setWorkingSettings] = useState<UserThemeSettings>(savedSettings);
  const [savedSuccessNotice, setSavedSuccessNotice] = useState(false);

  // Sync state when modal opens
  useEffect(() => {
    if (isOpen) {
      setWorkingSettings(savedSettings);
      setSavedSuccessNotice(false);
      applyThemeToDocument(savedSettings);
    }
  }, [isOpen, savedSettings]);

  if (!isOpen) return null;

  // Handle immediate live preview of theme
  const handleSelectTheme = (themeId: ThemeId) => {
    const updated: UserThemeSettings = {
      ...workingSettings,
      theme: themeId
    };
    setWorkingSettings(updated);
    applyThemeToDocument(updated);
  };

  // Handle follow system toggle
  const handleToggleFollowSystem = (enabled: boolean) => {
    const updated: UserThemeSettings = {
      ...workingSettings,
      followSystem: enabled
    };
    setWorkingSettings(updated);
    applyThemeToDocument(updated);
  };

  // Handle density selection
  const handleSelectDensity = (density: DensityMode) => {
    const updated: UserThemeSettings = {
      ...workingSettings,
      density
    };
    setWorkingSettings(updated);
    applyThemeToDocument(updated);
  };

  // Restore Default settings
  const handleRestoreDefault = () => {
    setWorkingSettings(DEFAULT_THEME_SETTINGS);
    applyThemeToDocument(DEFAULT_THEME_SETTINGS);
  };

  // Cancel and rollback live preview to previously saved settings
  const handleCancel = () => {
    applyThemeToDocument(savedSettings);
    onClose();
  };

  // Save settings permanently for current user
  const handleSave = () => {
    saveUserThemeSettings(currentUser?.id, workingSettings);
    applyThemeToDocument(workingSettings);
    onSettingsSaved(workingSettings);
    setSavedSuccessNotice(true);
    setTimeout(() => {
      onClose();
    }, 400);
  };

  const effectivePreviewTheme = getEffectiveTheme(workingSettings);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden text-slate-800"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/10 text-emerald-600 flex items-center justify-center border border-emerald-600/20">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                {t.themeSettings}
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  {t.previewLive}
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                {t.previewNotice}
              </p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors"
            title={t.cancel}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body - Scrollable */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Section 1: Themes Selection with miniature mockups */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-500" />
                {lang === 'ar' ? 'اختر الهوية البصرية (الثيم)' : 'Choose Theme & Visual Identity'}
              </label>
              <span className="text-xs text-slate-500">
                {lang === 'ar' ? `المستخدم الحالي: ${currentUser?.display_name || 'عام'}` : `Active user: ${currentUser?.display_name || 'Global'}`}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {THEMES_LIST.map((theme) => {
                const isSelected = workingSettings.theme === theme.id;
                const isCurrentlySaved = savedSettings.theme === theme.id;
                const p = theme.previewColors;

                return (
                  <div
                    key={theme.id}
                    onClick={() => handleSelectTheme(theme.id)}
                    className={`relative rounded-xl border-2 p-3.5 cursor-pointer transition-all duration-200 text-start flex flex-col justify-between ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50/20 ring-2 ring-emerald-500/20 shadow-md scale-[1.01]'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60 bg-white shadow-sm'
                    }`}
                  >
                    {/* Header of the Theme Card */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">
                          {lang === 'ar' ? theme.name_ar : theme.name_en}
                        </span>
                        {isCurrentlySaved && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-700 border border-slate-300">
                            {t.currentActiveTheme}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isSelected ? (
                          <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-300">
                            <Check className="w-3.5 h-3.5" />
                            {lang === 'ar' ? 'محدد' : 'Active'}
                          </span>
                        ) : (
                          <span className="w-4 h-4 rounded-full border border-slate-300 inline-block"></span>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                      {lang === 'ar' ? theme.description_ar : theme.description_en}
                    </p>

                    {/* Miniature UI Mockup */}
                    <div 
                      className="rounded-lg border p-2.5 overflow-hidden transition-all select-none shadow-inner"
                      style={{ 
                        backgroundColor: p.bg, 
                        borderColor: p.border 
                      }}
                    >
                      <div className="flex gap-2 h-28">
                        {/* Mini Sidebar */}
                        <div 
                          className="w-16 rounded p-1.5 flex flex-col justify-between shrink-0"
                          style={{ backgroundColor: p.sidebar }}
                        >
                          <div className="space-y-1">
                            {/* Logo */}
                            <div className="w-4 h-4 rounded bg-white/20 flex items-center justify-center text-[8px] text-white font-bold mb-1.5">
                              م
                            </div>
                            {/* Nav items */}
                            <div 
                              className="h-2.5 rounded text-[7px] text-white flex items-center px-1 font-bold"
                              style={{ backgroundColor: p.primary }}
                            >
                              الرئيسية
                            </div>
                            <div className="h-2 rounded bg-white/10"></div>
                            <div className="h-2 rounded bg-white/10"></div>
                          </div>
                          <div className="h-1.5 rounded bg-white/15 w-8"></div>
                        </div>

                        {/* Mini Workspace */}
                        <div className="flex-1 flex flex-col justify-between overflow-hidden">
                          {/* Mini Header / Top row */}
                          <div className="flex items-center justify-between pb-1">
                            <div 
                              className="h-2 w-14 rounded font-bold text-[8px] truncate"
                              style={{ color: p.text }}
                            >
                              {lang === 'ar' ? 'الميزان ERP' : 'Al-Mizan ERP'}
                            </div>
                            <div 
                              className="px-1.5 py-0.5 rounded text-[8px] font-bold text-white shadow-xs"
                              style={{ backgroundColor: p.primary }}
                            >
                              + فاتورة
                            </div>
                          </div>

                          {/* Mini Metric Card */}
                          <div 
                            className="rounded p-1.5 border shadow-xs"
                            style={{ 
                              backgroundColor: p.card, 
                              borderColor: p.border 
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[8px] font-medium" style={{ color: p.text }}>
                                صافي المبيعات
                              </span>
                              <span className="text-[7px] text-emerald-600 font-bold flex items-center">
                                <TrendingUp className="w-2 h-2 me-0.5" /> +14%
                              </span>
                            </div>
                            <div className="text-[10px] font-bold font-mono" style={{ color: p.text }}>
                              124,500 ج.م
                            </div>
                          </div>

                          {/* Mini Table Row */}
                          <div 
                            className="rounded border overflow-hidden text-[7px] font-mono mt-1"
                            style={{ 
                              backgroundColor: p.card, 
                              borderColor: p.border 
                            }}
                          >
                            <div 
                              className="flex items-center justify-between px-1 py-0.5 border-b"
                              style={{ 
                                backgroundColor: theme.id === 'graphite' ? '#1c202d' : '#f1f5f9',
                                borderColor: p.border,
                                color: p.text
                              }}
                            >
                              <span>#1042</span>
                              <span>شركة النيل</span>
                              <span className="font-bold">24,500 ج.م</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: Follow System Appearance Toggle */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center border border-sky-100">
                <SunMoon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-800">
                  {t.followSystem}
                </div>
                <div className="text-xs text-slate-500">
                  {t.followSystemDesc}
                </div>
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                checked={workingSettings.followSystem}
                onChange={(e) => handleToggleFollowSystem(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          {/* Section 3: Table Display Density (Comfortable vs Compact) */}
          <div>
            <div className="mb-3">
              <label className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <Rows3 className="w-4 h-4 text-indigo-500" />
                {t.displayDensity}
              </label>
              <p className="text-xs text-slate-500">
                {lang === 'ar' ? 'اختر كثافة المسافات وحجم الصفوف لجداول الفواتير وقيود اليومية والتقارير' : 'Adjust row spacing and density for tables and ledgers'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Comfortable Density */}
              <div
                onClick={() => handleSelectDensity('comfortable')}
                className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-start gap-3 ${
                  workingSettings.density === 'comfortable'
                    ? 'border-indigo-600 bg-indigo-50/20 ring-2 ring-indigo-500/20'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="mt-0.5">
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                    workingSettings.density === 'comfortable' ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300'
                  }`}>
                    {workingSettings.density === 'comfortable' && <Check className="w-3 h-3" />}
                  </div>
                </div>
                <div>
                  <div className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                    {t.densityComfortable}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {t.densityComfortableDesc}
                  </div>
                  {/* Visual mockup bars */}
                  <div className="mt-2.5 space-y-1.5 bg-slate-100 p-2 rounded border border-slate-200">
                    <div className="h-2.5 bg-slate-300 rounded w-full"></div>
                    <div className="h-2.5 bg-slate-200 rounded w-5/6"></div>
                    <div className="h-2.5 bg-slate-200 rounded w-4/6"></div>
                  </div>
                </div>
              </div>

              {/* Compact Density */}
              <div
                onClick={() => handleSelectDensity('compact')}
                className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-start gap-3 ${
                  workingSettings.density === 'compact'
                    ? 'border-indigo-600 bg-indigo-50/20 ring-2 ring-indigo-500/20'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="mt-0.5">
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                    workingSettings.density === 'compact' ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300'
                  }`}>
                    {workingSettings.density === 'compact' && <Check className="w-3 h-3" />}
                  </div>
                </div>
                <div>
                  <div className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                    {t.densityCompact}
                    <span className="text-[10px] font-bold px-1.5 py-0.2 bg-indigo-100 text-indigo-700 rounded">
                      +40% صفوف
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {t.densityCompactDesc}
                  </div>
                  {/* Visual mockup bars */}
                  <div className="mt-2.5 space-y-1 bg-slate-100 p-2 rounded border border-slate-200">
                    <div className="h-1.5 bg-slate-300 rounded w-full"></div>
                    <div className="h-1.5 bg-slate-200 rounded w-11/12"></div>
                    <div className="h-1.5 bg-slate-200 rounded w-5/6"></div>
                    <div className="h-1.5 bg-slate-200 rounded w-4/6"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer with Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          {/* Restore Default */}
          <button
            type="button"
            onClick={handleRestoreDefault}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors border border-slate-300"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t.restoreDefaultTheme}
          </button>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 rounded-xl transition-colors border border-slate-300"
            >
              {t.cancelPreview}
            </button>

            <button
              type="button"
              onClick={handleSave}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition-all"
            >
              <Check className="w-4 h-4" />
              {savedSuccessNotice ? (lang === 'ar' ? 'تم الحفظ!' : 'Saved!') : t.saveTheme}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
