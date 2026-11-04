import React, { useState } from 'react';
import { ShieldCheck, UserCheck, Lock, AlertCircle, Building2, KeyRound } from 'lucide-react';
import { apiClient } from '../services/apiClient';

interface LoginViewProps {
  onLoginSuccess: (user: any, token: string) => void;
  lang: 'ar' | 'en';
  setLang: (l: 'ar' | 'en') => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess, lang, setLang }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = {
    title: lang === 'ar' ? 'منظومة الميزان ERP للمحاسبة والتجارة' : 'Al-Mizan ERP Accounting System',
    subtitle: lang === 'ar' ? 'نظام مالي وإداري متكامل للشركات المصرية والامتثال الضريبي' : 'Comprehensive ERP & Financial Accounting for Egyptian Enterprises',
    loginBoxTitle: lang === 'ar' ? 'تسجيل الدخول للنظام' : 'Sign In to Your Workspace',
    usernameLabel: lang === 'ar' ? 'اسم المستخدم' : 'Username',
    passwordLabel: lang === 'ar' ? 'كلمة المرور' : 'Password',
    submitBtn: lang === 'ar' ? 'دخول آمن' : 'Secure Login',
    quickAccess: lang === 'ar' ? 'حسابات التجربة السريعة (اختر دوراً للبدء):' : 'Quick Demo Logins (Pick a Role):',
    roles: {
      owner: lang === 'ar' ? 'المالك / المدير العام (Super Admin)' : 'Owner / Super Admin',
      fin_mgr: lang === 'ar' ? 'المدير المالي (Financial Manager)' : 'Financial Manager',
      accountant: lang === 'ar' ? 'محاسب عام (Accountant)' : 'General Accountant',
      sales: lang === 'ar' ? 'مسؤول مبيعات (Sales Officer)' : 'Sales Representative',
      storekeeper: lang === 'ar' ? 'أمين مخزن (Storekeeper)' : 'Storekeeper',
      cashier: lang === 'ar' ? 'أمين خزينة / كاشير (Cashier)' : 'Cashier / Treasury'
    }
  };

  const handleLogin = async (e?: React.FormEvent, customUser?: string, customPass?: string) => {
    if (e) e.preventDefault();
    setError(null);
    setLoading(true);

    const u = customUser || username;
    const p = customPass || password;

    try {
      const data = await apiClient.post('/auth/login', { username: u, password: p });
      if (!data || !data.token) {
        throw new Error('فشل استلام رمز الجلسة');
      }

      localStorage.setItem('almizan_token', data.token);
      onLoginSuccess(data.user, data.token);
    } catch (err: any) {
      setError(err.message || 'فشل تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  const demoAccounts = [
    { label: t.roles.owner, user: 'owner', pass: 'admin123', color: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
    { label: t.roles.fin_mgr, user: 'fin_mgr', pass: 'admin123', color: 'bg-blue-600 hover:bg-blue-700 text-white' },
    { label: t.roles.accountant, user: 'accountant', pass: 'admin123', color: 'bg-indigo-600 hover:bg-indigo-700 text-white' },
    { label: t.roles.sales, user: 'sales_rep', pass: 'admin123', color: 'bg-amber-600 hover:bg-amber-700 text-white' },
    { label: t.roles.storekeeper, user: 'storekeeper', pass: 'admin123', color: 'bg-purple-600 hover:bg-purple-700 text-white' },
    { label: t.roles.cashier, user: 'cashier', pass: 'admin123', color: 'bg-slate-700 hover:bg-slate-800 text-white' }
  ];

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4 relative overflow-hidden" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Background Glow */}
      <div className="absolute top-0 -left-40 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -right-40 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Language Switch */}
      <div className="absolute top-6 right-6">
        <button
          onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
          className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition"
        >
          {lang === 'ar' ? 'English (LTR)' : 'عربي (RTL)'}
        </button>
      </div>

      <div className="max-w-md w-full bg-slate-800/90 backdrop-blur-md rounded-2xl border border-slate-700/80 shadow-2xl p-8 z-10">
        <div className="text-center mb-6">
          <div className="inline-flex p-3 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-lg mb-3">
            <Building2 className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-wide">{t.title}</h1>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">{t.subtitle}</p>
        </div>

        {error && (
          <div className="mb-5 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-2">
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">{t.usernameLabel}</label>
            <div className="relative">
              <input
                type="text"
                required
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="e.g. owner or accountant"
                className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
              />
              <UserCheck className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">{t.passwordLabel}</label>
            <div className="relative">
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
              />
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl shadow-lg shadow-emerald-900/30 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <KeyRound className="w-4 h-4" />
                <span>{t.submitBtn}</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-700/60">
          <p className="text-xs font-semibold text-slate-400 mb-3 text-center">{t.quickAccess}</p>
          <div className="grid grid-cols-2 gap-2">
            {demoAccounts.map(acc => (
              <button
                key={acc.user}
                type="button"
                onClick={() => {
                  setUsername(acc.user);
                  setPassword(acc.pass);
                  handleLogin(undefined, acc.user, acc.pass);
                }}
                className={`text-xs px-2.5 py-2 rounded-lg font-medium transition text-center shadow-sm flex items-center justify-center gap-1.5 ${acc.color}`}
              >
                <span>{acc.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 text-center text-xs text-slate-500 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-emerald-500" />
        <span>نظام محاسبي تجاري متكامل - مشفر ومؤمن وفق معايير المحاسبة والضرائب المصرية</span>
      </div>
    </div>
  );
};
