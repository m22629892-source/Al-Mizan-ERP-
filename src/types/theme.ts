export type ThemeId = 'classic' | 'emerald' | 'graphite' | 'accountant';
export type DensityMode = 'comfortable' | 'compact';

export interface UserThemeSettings {
  theme: ThemeId;
  followSystem: boolean;
  density: DensityMode;
}

export interface ThemeMetadata {
  id: ThemeId;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  isDark: boolean;
  previewColors: {
    sidebar: string;
    header: string;
    bg: string;
    card: string;
    primary: string;
    accent: string;
    text: string;
    border: string;
  };
}

export const THEMES_LIST: ThemeMetadata[] = [
  {
    id: 'classic',
    name_ar: 'الميزان الكلاسيكي',
    name_en: 'Classic Al-Mizan',
    description_ar: 'قائمة جانبية كحلية، مساحات عمل بيضاء، ولمسات ذهبية هادئة',
    description_en: 'Navy sidebar, crisp white workspaces, subtle warm golden accents',
    isDark: false,
    previewColors: {
      sidebar: '#0f172a',
      header: '#0f172a',
      bg: '#f8fafc',
      card: '#ffffff',
      primary: '#059669',
      accent: '#d97706',
      text: '#0f172a',
      border: '#e2e8f0'
    }
  },
  {
    id: 'emerald',
    name_ar: 'الزمرد',
    name_en: 'Emerald',
    description_ar: 'أخضر زمردي للعناصر الرئيسية، خلفية فاتحة، وبطاقات واضحة',
    description_en: 'Emerald green primary elements, fresh clean background, distinct cards',
    isDark: false,
    previewColors: {
      sidebar: '#064e3b',
      header: '#064e3b',
      bg: '#f0fdf4',
      card: '#ffffff',
      primary: '#059669',
      accent: '#10b981',
      text: '#064e3b',
      border: '#a7f3d0'
    }
  },
  {
    id: 'graphite',
    name_ar: 'الجرافيت الداكن',
    name_en: 'Dark Graphite',
    description_ar: 'خلفية فحمية، أسطح داكنة متدرجة، ولمسات فيروزية بتباين مريح',
    description_en: 'Charcoal background, stepped dark surfaces, comfortable turquoise accents',
    isDark: true,
    previewColors: {
      sidebar: '#12141a',
      header: '#12141a',
      bg: '#0c0e14',
      card: '#181b24',
      primary: '#06b6d4',
      accent: '#14b8a6',
      text: '#f8fafc',
      border: '#2a3142'
    }
  },
  {
    id: 'accountant',
    name_ar: 'المحاسب',
    name_en: 'Accountant',
    description_ar: 'خلفية فاتحة محايدة، أزرق للأزرار، وجداول واضحة تناسب العمل لساعات طويلة',
    description_en: 'Neutral light background, blue buttons, high-legibility grids for long hours',
    isDark: false,
    previewColors: {
      sidebar: '#1e293b',
      header: '#1e293b',
      bg: '#f1f5f9',
      card: '#ffffff',
      primary: '#2563eb',
      accent: '#3b82f6',
      text: '#0f172a',
      border: '#cbd5e1'
    }
  }
];

export const DEFAULT_THEME_SETTINGS: UserThemeSettings = {
  theme: 'classic',
  followSystem: false,
  density: 'comfortable'
};

export function getEffectiveTheme(settings: UserThemeSettings): ThemeId {
  if (settings.followSystem) {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'graphite';
    }
    // If system is light, use user's configured theme if not dark, else default to classic
    return settings.theme === 'graphite' ? 'classic' : settings.theme;
  }
  return settings.theme;
}

export function getUserThemeSettings(userId?: string | null): UserThemeSettings {
  if (typeof window === 'undefined') return DEFAULT_THEME_SETTINGS;

  const storageKey = userId ? `almizan_appearance_${userId}` : 'almizan_appearance_guest';
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        theme: ['classic', 'emerald', 'graphite', 'accountant'].includes(parsed.theme) ? parsed.theme : 'classic',
        followSystem: Boolean(parsed.followSystem),
        density: parsed.density === 'compact' ? 'compact' : 'comfortable'
      };
    }
    // Check fallback legacy keys if any
    const legacyTheme = localStorage.getItem('almizan_theme');
    if (legacyTheme && ['classic', 'emerald', 'graphite', 'accountant'].includes(legacyTheme)) {
      return {
        ...DEFAULT_THEME_SETTINGS,
        theme: legacyTheme as ThemeId
      };
    }
  } catch (err) {
    console.warn('Failed to load theme settings from localStorage:', err);
  }
  return DEFAULT_THEME_SETTINGS;
}

export function saveUserThemeSettings(userId: string | null | undefined, settings: UserThemeSettings): void {
  if (typeof window === 'undefined') return;

  const storageKey = userId ? `almizan_appearance_${userId}` : 'almizan_appearance_guest';
  try {
    localStorage.setItem(storageKey, JSON.stringify(settings));
    // Also save global active theme for quick pre-hydration in index.html
    const effective = getEffectiveTheme(settings);
    localStorage.setItem('almizan_active_theme', effective);
    localStorage.setItem('almizan_active_density', settings.density);
  } catch (err) {
    console.warn('Failed to save theme settings to localStorage:', err);
  }
}

export function applyThemeToDocument(settings: UserThemeSettings): void {
  if (typeof document === 'undefined') return;

  const effectiveTheme = getEffectiveTheme(settings);
  const root = document.documentElement;

  root.setAttribute('data-theme', effectiveTheme);
  root.setAttribute('data-density', settings.density);

  // Update theme-color meta tag if present
  let metaTheme = document.querySelector('meta[name="theme-color"]');
  if (!metaTheme) {
    metaTheme = document.createElement('meta');
    metaTheme.setAttribute('name', 'theme-color');
    document.head.appendChild(metaTheme);
  }
  const metaColor = effectiveTheme === 'graphite' ? '#0c0e14' : effectiveTheme === 'emerald' ? '#064e3b' : '#0f172a';
  metaTheme.setAttribute('content', metaColor);
}
