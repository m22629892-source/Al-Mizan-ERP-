import React, { useState, useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Header } from './components/Header';
import { Sidebar, NavTab } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { AccountsView } from './components/AccountsView';
import { JournalEntriesView } from './components/JournalEntriesView';
import { SalesInvoicesView } from './components/SalesInvoicesView';
import { PurchaseInvoicesView } from './components/PurchaseInvoicesView';
import { SalesReturnsView } from './components/SalesReturnsView';
import { PurchaseReturnsView } from './components/PurchaseReturnsView';
import { PartiesView } from './components/PartiesView';
import { InventoryView } from './components/InventoryView';
import { TreasuryView } from './components/TreasuryView';
import { FinancialReportsView } from './components/FinancialReportsView';
import { MonthCloseView } from './components/MonthCloseView';
import { BankReconciliationView } from './components/BankReconciliationView';
import { PhysicalInventoryView } from './components/PhysicalInventoryView';
import { ExcelImportView } from './components/ExcelImportView';
import { ExcelAnalyticsView } from './components/ExcelAnalyticsView';
import { BackupRestoreView } from './components/BackupRestoreView';
import { EtaComplianceView } from './components/EtaComplianceView';
import { TestRunnerView } from './components/TestRunnerView';
import { UsersAndAuditView } from './components/UsersAndAuditView';
import { LoginView } from './components/LoginView';
import { PrintInvoiceModal } from './components/PrintInvoiceModal';
import { AppearanceModal } from './components/AppearanceModal';
import { Language } from './translations';
import { apiClient } from './services/apiClient';
import { canAccessTab } from './utils/permissions';
import {
  ThemeId,
  UserThemeSettings,
  getUserThemeSettings,
  applyThemeToDocument
} from './types/theme';
import {
  Company,
  Branch,
  Warehouse,
  CashBox,
  BankAccount,
  Account,
  Party,
  Item,
  JournalEntry,
  SalesInvoice,
  PaymentVoucher,
  User
} from './types';

export default function App() {
  const [lang, setLang] = useState<Language>('ar');
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [activeBranchId, setActiveBranchId] = useState('all');

  // Appearance & Theme State
  const [themeSettings, setThemeSettings] = useState<UserThemeSettings>(() => getUserThemeSettings());
  const [isAppearanceModalOpen, setIsAppearanceModalOpen] = useState(false);

  // Analytics Transition State
  const [analyticsInitialFilename, setAnalyticsInitialFilename] = useState<string | null>(null);
  const [analyticsInitialNotice, setAnalyticsInitialNotice] = useState<string | null>(null);

  // Auth State
  const [token, setToken] = useState<string | null>(localStorage.getItem('almizan_token'));
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Master Data State
  const [company, setCompany] = useState<Company | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [salesInvoices, setSalesInvoices] = useState<SalesInvoice[]>([]);
  const [paymentVouchers, setPaymentVouchers] = useState<PaymentVoucher[]>([]);
  const [dashboardStats, setDashboardStats] = useState<any>(null);

  // Print Invoice Modal State
  const [selectedInvoiceForPrint, setSelectedInvoiceForPrint] = useState<SalesInvoice | null>(null);

  const [loading, setLoading] = useState(false);

  // Verify Auth Session
  const checkAuth = async () => {
    const savedToken = localStorage.getItem('almizan_token');
    if (!savedToken) {
      setToken(null);
      setCurrentUser(null);
      setIsCheckingAuth(false);
      return;
    }

    try {
      const data = await apiClient.get('/auth/me');
      if (data && data.user) {
        setToken(savedToken);
        setCurrentUser(data.user);
        fetchAllData();
      } else {
        localStorage.removeItem('almizan_token');
        setToken(null);
        setCurrentUser(null);
      }
    } catch (err) {
      console.error('Auth verification error:', err);
      localStorage.removeItem('almizan_token');
      setToken(null);
      setCurrentUser(null);
    } finally {
      setIsCheckingAuth(false);
    }
  };

  useEffect(() => {
    checkAuth();

    const handleUnauthorized = () => {
      localStorage.removeItem('almizan_token');
      setToken(null);
      setCurrentUser(null);
    };

    window.addEventListener('almizan:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('almizan:unauthorized', handleUnauthorized);
  }, []);

  // Live session sync (updates active permissions if modified in another tab or by admin)
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(async () => {
      try {
        const data = await apiClient.get('/auth/me');
        if (data && data.user) {
          setCurrentUser(data.user);
        }
      } catch (err) {
        // ignore background poll errors
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [token]);

  // Load per-user theme preferences whenever currentUser changes
  useEffect(() => {
    const userSettings = getUserThemeSettings(currentUser?.id);
    setThemeSettings(userSettings);
    applyThemeToDocument(userSettings);
  }, [currentUser?.id]);

  // Dynamic system appearance listener when followSystem is enabled
  useEffect(() => {
    if (!themeSettings.followSystem) return;
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      applyThemeToDocument(themeSettings);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [themeSettings]);

  // Auto-redirect if current tab is not accessible
  useEffect(() => {
    if (currentUser) {
      if (!canAccessTab(currentTab, currentUser)) {
        const tabsOrder: NavTab[] = [
          'dashboard', 'sales', 'sales_returns', 'purchases', 'purchase_returns',
          'treasury', 'parties', 'inventory', 'accounts', 'journal',
          'reports', 'month_close', 'bank_reconciliation', 'inventory_count', 'excel_import', 'excel_analytics', 'backup',
          'eta', 'tests', 'audit'
        ];
        const allowed = tabsOrder.find(t => canAccessTab(t, currentUser));
        if (allowed) {
          setCurrentTab(allowed);
        }
      }
    }
  }, [currentUser, currentTab]);

  // Fetch all primary datasets with individual try/catch blocks for resilience
  const fetchAllData = async () => {
    const activeToken = localStorage.getItem('almizan_token');
    if (!activeToken) return;

    setLoading(true);

    // 1. Company & org structure
    try {
      const compData = await apiClient.get('/company');
      if (compData.company) setCompany(compData.company);
      if (compData.branches) setBranches(compData.branches);
      if (compData.warehouses) setWarehouses(compData.warehouses);
      if (compData.cashBoxes) setCashBoxes(compData.cashBoxes);
      if (compData.bankAccounts) setBankAccounts(compData.bankAccounts);
    } catch (e) {
      console.warn('Company structure not loaded:', e);
    }

    // 2. Accounts
    try {
      const accData = await apiClient.get('/accounts');
      if (accData.accounts) setAccounts(accData.accounts);
    } catch (e) {
      console.warn('Accounts not accessible or not loaded:', e);
    }

    // 3. Parties
    try {
      const partiesData = await apiClient.get('/parties');
      if (partiesData.parties) setParties(partiesData.parties);
    } catch (e) {
      console.warn('Parties not accessible or not loaded:', e);
    }

    // 4. Items
    try {
      const itemsData = await apiClient.get('/items');
      if (itemsData.items) setItems(itemsData.items);
    } catch (e) {
      console.warn('Items not accessible or not loaded:', e);
    }

    // 5. Journal Entries
    try {
      const jeData = await apiClient.get('/journal-entries');
      if (jeData.entries) setJournalEntries(jeData.entries);
    } catch (e) {
      console.warn('Journal entries not accessible or not loaded:', e);
    }

    // 6. Sales Invoices
    try {
      const siData = await apiClient.get('/sales/invoices');
      if (siData.invoices) setSalesInvoices(siData.invoices);
    } catch (e) {
      console.warn('Sales invoices not accessible or not loaded:', e);
    }

    // 7. Treasury Vouchers
    try {
      const tvData = await apiClient.get('/treasury/vouchers');
      if (tvData.vouchers) setPaymentVouchers(tvData.vouchers);
    } catch (e) {
      console.warn('Treasury vouchers not accessible or not loaded:', e);
    }

    // 8. Dashboard KPIs
    try {
      const dashData = await apiClient.get('/dashboard/stats');
      if (dashData) setDashboardStats(dashData);
    } catch (e) {
      console.warn('Dashboard stats not accessible or not loaded:', e);
    }

    setLoading(false);
  };

  const handleLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch (e) {
      console.error(e);
    }
    localStorage.removeItem('almizan_token');
    setToken(null);
    setCurrentUser(null);
  };

  const handleLoginSuccess = (user: User, tok: string) => {
    setToken(tok);
    setCurrentUser(user);
    fetchAllData();
  };

  const handleLangToggle = () => {
    setLang(prev => (prev === 'ar' ? 'en' : 'ar'));
  };

  const handleSelectInvoiceForPrint = async (inv: SalesInvoice) => {
    try {
      const data = await apiClient.get(`/sales/invoices/${inv.id}`);
      if (data && data.invoice) {
        setSelectedInvoiceForPrint(data.invoice);
      } else {
        setSelectedInvoiceForPrint(inv);
      }
    } catch (err) {
      setSelectedInvoiceForPrint(inv);
    }
  };

  // Checking initial session
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm text-slate-400 font-semibold">جارٍ التحقق من جلسة الدخول المشفرة...</p>
        </div>
      </div>
    );
  }

  // If not logged in, show Login Screen
  if (!token || !currentUser) {
    return <LoginView onLoginSuccess={handleLoginSuccess} lang={lang} setLang={setLang} />;
  }

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-100 flex flex-col text-slate-800">
      {/* Executive Header */}
      <Header
        company={company}
        branches={branches}
        activeBranchId={activeBranchId}
        onBranchChange={setActiveBranchId}
        lang={lang}
        onLangToggle={handleLangToggle}
        currentUser={currentUser}
        onSwitchUserModalOpen={() => {}}
        onRefreshData={() => fetchAllData()}
        onLogout={handleLogout}
        onOpenAppearanceModal={() => setIsAppearanceModalOpen(true)}
      />

      <div className="flex flex-1">
        {/* Navigation Sidebar */}
        <Sidebar
          currentTab={currentTab}
          onTabSelect={setCurrentTab}
          lang={lang}
          currentUser={currentUser}
          onOpenAppearanceModal={() => setIsAppearanceModalOpen(true)}
        />

        {/* Main Workspace Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
          {loading ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
                <div className="text-sm font-semibold text-slate-600">
                  {lang === 'ar' ? 'جارٍ تحميل السجلات المحاسبية وقواعد البيانات...' : 'Loading General Ledger & Financial Records...'}
                </div>
              </div>
            </div>
          ) : !canAccessTab(currentTab, currentUser) ? (
            <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm text-center max-w-md mx-auto my-12 animate-in fade-in">
              <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-rose-100">
                <ShieldAlert className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-slate-800 mb-2">
                {lang === 'ar' ? 'غير مصرح بالوصول إلى هذه الشاشة' : 'Access Restricted'}
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed mb-6">
                {lang === 'ar'
                  ? `تم تقييد صلاحية الوصول لشاشة (${currentTab}) من قِبل مسؤول النظام أو أن حسابك لا يملك تصريح عرض الشاشة المخصص.`
                  : 'You do not have sufficient permissions to view this screen.'}
              </p>
              <button
                onClick={() => {
                  const tabsOrder: NavTab[] = [
                    'dashboard', 'sales', 'sales_returns', 'purchases', 'purchase_returns',
                    'treasury', 'parties', 'inventory', 'accounts', 'journal',
                    'reports', 'eta', 'tests', 'audit'
                  ];
                  const allowed = tabsOrder.find(t => canAccessTab(t, currentUser));
                  if (allowed) setCurrentTab(allowed);
                }}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition"
              >
                {lang === 'ar' ? 'الذهاب إلى الشاشة المسموحة' : 'Go to permitted screen'}
              </button>
            </div>
          ) : (
            <>
              {currentTab === 'dashboard' && (
                <Dashboard
                  kpis={dashboardStats?.kpis}
                  monthlyTrend={dashboardStats?.monthlyTrend}
                  recentInvoices={dashboardStats?.recentInvoices}
                  recentEntries={dashboardStats?.recentEntries}
                  branches={branches}
                  warehouses={warehouses}
                  lang={lang}
                  currentUser={currentUser}
                  onNavigateTab={setCurrentTab}
                  onSelectInvoice={handleSelectInvoiceForPrint}
                  onRefresh={() => fetchAllData()}
                />
              )}

              {currentTab === 'accounts' && (
                <AccountsView
                  accounts={accounts}
                  lang={lang}
                  onRefresh={() => fetchAllData()}
                />
              )}

              {currentTab === 'journal' && (
                <JournalEntriesView
                  entries={journalEntries}
                  accounts={accounts}
                  branches={branches}
                  lang={lang}
                  onRefresh={() => fetchAllData()}
                />
              )}

              {currentTab === 'sales' && (
                <SalesInvoicesView
                  invoices={salesInvoices}
                  customers={parties.filter(p => p.type === 'customer' || p.type === 'both')}
                  items={items}
                  branches={branches}
                  warehouses={warehouses}
                  lang={lang}
                  userPermissions={currentUser.permissions || []}
                  currentUser={currentUser}
                  onRefresh={() => fetchAllData()}
                  onOpenPrintModal={handleSelectInvoiceForPrint}
                />
              )}

              {currentTab === 'sales_returns' && (
                <SalesReturnsView
                  token={token}
                  lang={lang}
                  warehouses={warehouses}
                  userPermissions={currentUser.permissions || []}
                />
              )}

              {currentTab === 'purchases' && (
                <PurchaseInvoicesView
                  token={token}
                  lang={lang}
                  branches={branches}
                  warehouses={warehouses}
                  parties={parties}
                  items={items}
                  userPermissions={currentUser.permissions || []}
                  currentUser={currentUser}
                />
              )}

              {currentTab === 'purchase_returns' && (
                <PurchaseReturnsView
                  token={token}
                  lang={lang}
                  warehouses={warehouses}
                  userPermissions={currentUser.permissions || []}
                />
              )}

              {currentTab === 'parties' && (
                <PartiesView
                  parties={parties}
                  lang={lang}
                  onRefresh={() => fetchAllData()}
                />
              )}

              {currentTab === 'inventory' && (
                <InventoryView
                  items={items}
                  warehouses={warehouses}
                  lang={lang}
                  onRefresh={() => fetchAllData()}
                />
              )}

              {currentTab === 'treasury' && (
                <TreasuryView
                  cashBoxes={cashBoxes}
                  bankAccounts={bankAccounts}
                  vouchers={paymentVouchers}
                  branches={branches}
                  parties={parties}
                  accounts={accounts}
                  lang={lang}
                  onRefresh={() => fetchAllData()}
                />
              )}

              {currentTab === 'reports' && (
                <FinancialReportsView token={token} lang={lang} />
              )}

              {currentTab === 'month_close' && (
                <MonthCloseView
                  currentUser={currentUser}
                  onNavigateToTab={(tab) => setCurrentTab(tab as NavTab)}
                />
              )}

              {currentTab === 'bank_reconciliation' && (
                <BankReconciliationView
                  currentUser={currentUser}
                  bankAccounts={bankAccounts}
                />
              )}

              {currentTab === 'inventory_count' && (
                <PhysicalInventoryView
                  currentUser={currentUser}
                  branches={branches}
                  warehouses={warehouses}
                />
              )}

              {currentTab === 'excel_import' && (
                <ExcelImportView
                  currentUser={currentUser}
                  onImportSuccess={() => fetchAllData()}
                  onNavigateToAnalytics={(fname, notice) => {
                    setAnalyticsInitialFilename(fname || null);
                    setAnalyticsInitialNotice(notice || null);
                    setCurrentTab('excel_analytics');
                  }}
                />
              )}

              {currentTab === 'excel_analytics' && (
                <ExcelAnalyticsView
                  currentUser={currentUser}
                  lang={lang}
                  initialFilename={analyticsInitialFilename}
                  initialNotice={analyticsInitialNotice}
                />
              )}

              {currentTab === 'backup' && (
                <BackupRestoreView
                  currentUser={currentUser}
                  onRefreshSession={() => fetchAllData()}
                />
              )}

              {currentTab === 'eta' && (
                <EtaComplianceView
                  invoices={salesInvoices}
                  lang={lang}
                  onRefresh={() => fetchAllData()}
                />
              )}

              {currentTab === 'tests' && (
                <TestRunnerView token={token} lang={lang} />
              )}

              {currentTab === 'audit' && (
                <UsersAndAuditView
                  token={token}
                  currentUser={currentUser}
                  lang={lang}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Official Tax Invoice Print Modal */}
      {selectedInvoiceForPrint && (
        <PrintInvoiceModal
          invoice={selectedInvoiceForPrint}
          company={company}
          lang={lang}
          onClose={() => setSelectedInvoiceForPrint(null)}
        />
      )}

      {/* Appearance & Themes Settings Modal */}
      <AppearanceModal
        isOpen={isAppearanceModalOpen}
        onClose={() => setIsAppearanceModalOpen(false)}
        currentUser={currentUser}
        savedSettings={themeSettings}
        onSettingsSaved={(newSettings) => setThemeSettings(newSettings)}
        lang={lang}
      />
    </div>
  );
}
