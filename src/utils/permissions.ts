import { User } from '../types';
import { NavTab } from '../components/Sidebar';

export interface ActionPermission {
  key: string;
  label_ar: string;
  action: string;
  description_ar?: string;
}

export interface ScreenPermissionGroup {
  id: string;
  tabId: NavTab;
  title_ar: string;
  title_en: string;
  viewKey: string;
  description_ar: string;
  actions: ActionPermission[];
}

export const SCREEN_PERMISSIONS_CONFIG: ScreenPermissionGroup[] = [
  {
    id: 'dashboard',
    tabId: 'dashboard',
    title_ar: 'لوحة التحكم والتحليلات المالية',
    title_en: 'Executive Dashboard',
    viewKey: 'dashboard.view',
    description_ar: 'استعراض المؤشرات المالية والتشغيلية، رسوم المبيعات والمشتريات، السيولة النقدية ومتابعة المسودات.',
    actions: []
  },
  {
    id: 'accounts',
    tabId: 'accounts',
    title_ar: 'دليل وشجرة الحسابات',
    title_en: 'Chart of Accounts',
    viewKey: 'accounts.view',
    description_ar: 'استعراض الشجرة المحاسبية بطبيعة الحسابات والأرصدة ومستويات الدليل.',
    actions: [
      { key: 'accounts.create', label_ar: 'إضافة حساب فرعي جديد', action: 'create' },
      { key: 'accounts.edit', label_ar: 'تعديل بيانات الحساب والحالة', action: 'edit' },
      { key: 'accounts.delete', label_ar: 'حذف الحساب غير المستخدم', action: 'delete' },
      { key: 'accounts.manage', label_ar: 'إدارة الهيكل وشجرة الحسابات', action: 'manage' }
    ]
  },
  {
    id: 'journal',
    tabId: 'journal',
    title_ar: 'دفتر القيود اليومية والأستاذ',
    title_en: 'Journal Entries & General Ledger',
    viewKey: 'journal.view',
    description_ar: 'استعراض القيود اليومية وحركات الأستاذ العام المتزنة.',
    actions: [
      { key: 'journal.create', label_ar: 'إنشاء مسودة قيد يومية', action: 'create' },
      { key: 'journal.edit_draft', label_ar: 'تعديل مسودات القيود اليومية', action: 'edit_draft' },
      { key: 'journal.delete_draft', label_ar: 'حذف مسودات القيود اليومية', action: 'delete_draft' },
      { key: 'journal.post', label_ar: 'ترحيل واعتماد القيد للأستاذ العام', action: 'post' },
      { key: 'journal.reverse', label_ar: 'عكس وتصحيح القيد المرحل', action: 'reverse' },
      { key: 'journal.print', label_ar: 'طباعة سند القيد اليومي', action: 'print' },
      { key: 'journal.export', label_ar: 'تصدير القيود للأكسل', action: 'export' }
    ]
  },
  {
    id: 'sales',
    tabId: 'sales',
    title_ar: 'فواتير المبيعات التجارية',
    title_en: 'Sales Invoices',
    viewKey: 'sales.view',
    description_ar: 'استعراض فواتير المبيعات النقدية والآجلة وتفاصيل البنود والضرائب.',
    actions: [
      { key: 'sales.create', label_ar: 'إنشاء فاتورة مبيعات وحفظ مسودة', action: 'create' },
      { key: 'sales.edit_draft', label_ar: 'تعديل مسودة فاتورة مبيعات', action: 'edit_draft' },
      { key: 'sales.delete_draft', label_ar: 'حذف مسودة فاتورة مبيعات', action: 'delete_draft' },
      { key: 'sales.post', label_ar: 'اعتماد وترحيل الفاتورة للمخزن والأستاذ', action: 'post' },
      { key: 'sales.reverse', label_ar: 'إلغاء وعكس فاتورة مبيعات مرحلة', action: 'reverse' },
      { key: 'sales.print', label_ar: 'طباعة الفاتورة الضريبية الرسمية A4', action: 'print' },
      { key: 'sales.export', label_ar: 'تصدير سجل المبيعات للأكسل', action: 'export' }
    ]
  },
  {
    id: 'sales_returns',
    tabId: 'sales_returns',
    title_ar: 'مردودات المبيعات وإشعارات الخصم',
    title_en: 'Sales Returns',
    viewKey: 'sales_returns.view',
    description_ar: 'استعراض إشعارات الخصم ومردودات المبيعات وتأثيرها على المخزن.',
    actions: [
      { key: 'sales_returns.create', label_ar: 'إنشاء مسودة مردود مبيعات', action: 'create' },
      { key: 'sales_returns.edit_draft', label_ar: 'تعديل مسودة مردود مبيعات', action: 'edit_draft' },
      { key: 'sales_returns.delete_draft', label_ar: 'حذف مسودة مردود مبيعات', action: 'delete_draft' },
      { key: 'sales_returns.post', label_ar: 'اعتماد وترحيل مردود المبيعات', action: 'post' },
      { key: 'sales_returns.reverse', label_ar: 'عكس وتصحيح مردود مبيعات مرحل', action: 'reverse' },
      { key: 'sales_returns.print', label_ar: 'طباعة إشعار المردود / الخصم', action: 'print' }
    ]
  },
  {
    id: 'purchases',
    tabId: 'purchases',
    title_ar: 'فواتير المشتريات من الموردين',
    title_en: 'Purchase Invoices',
    viewKey: 'purchases.view',
    description_ar: 'استعراض فواتير المشتريات من الموردين وأذون الاستلام المخزنية.',
    actions: [
      { key: 'purchases.create', label_ar: 'إنشاء فاتورة مشتريات وحفظ مسودة', action: 'create' },
      { key: 'purchases.edit_draft', label_ar: 'تعديل مسودة فاتورة مشتريات', action: 'edit_draft' },
      { key: 'purchases.delete_draft', label_ar: 'حذف مسودة فاتورة مشتريات', action: 'delete_draft' },
      { key: 'purchases.post', label_ar: 'اعتماد وترحيل فاتورة مشتريات', action: 'post' },
      { key: 'purchases.reverse', label_ar: 'إلغاء وعكس فاتورة مشتريات مرحلة', action: 'reverse' },
      { key: 'purchases.print', label_ar: 'طباعة إذن استلام وفاتورة الشراء', action: 'print' },
      { key: 'purchases.export', label_ar: 'تصدير سجل المشتريات للأكسل', action: 'export' }
    ]
  },
  {
    id: 'purchase_returns',
    tabId: 'purchase_returns',
    title_ar: 'مردودات المشتريات للموردين',
    title_en: 'Purchase Returns',
    viewKey: 'purchase_returns.view',
    description_ar: 'استعراض إشعارات الإضافة ومردودات المشتريات للموردين.',
    actions: [
      { key: 'purchase_returns.create', label_ar: 'إنشاء مسودة مردود مشتريات', action: 'create' },
      { key: 'purchase_returns.edit_draft', label_ar: 'تعديل مسودة مردود مشتريات', action: 'edit_draft' },
      { key: 'purchase_returns.delete_draft', label_ar: 'حذف مسودة مردود مشتريات', action: 'delete_draft' },
      { key: 'purchase_returns.post', label_ar: 'اعتماد وترحيل مردود المشتريات', action: 'post' },
      { key: 'purchase_returns.reverse', label_ar: 'عكس وتصحيح مردود مشتريات مرحل', action: 'reverse' },
      { key: 'purchase_returns.print', label_ar: 'طباعة إشعار الإضافة / المرتجع', action: 'print' }
    ]
  },
  {
    id: 'parties',
    tabId: 'parties',
    title_ar: 'العملاء والموردون',
    title_en: 'Customers & Suppliers',
    viewKey: 'parties.view',
    description_ar: 'استعراض بطاقات العملاء والموردين والأرصدة والشروط الائتمانية.',
    actions: [
      { key: 'parties.create', label_ar: 'إضافة عميل أو مورد جديد', action: 'create' },
      { key: 'parties.edit', label_ar: 'تعديل بيانات الطرف والشروط الائتمانية', action: 'edit' },
      { key: 'parties.delete', label_ar: 'حذف الطرف غير المرتبط أو تعطيله', action: 'delete' },
      { key: 'parties.statement', label_ar: 'طباعة واستخراج كشف الحساب التفصيلي', action: 'statement' }
    ]
  },
  {
    id: 'inventory',
    tabId: 'inventory',
    title_ar: 'المخزون والأصناف والفئات',
    title_en: 'Inventory, Items & Categories',
    viewKey: 'inventory.view',
    description_ar: 'استعراض بطاقات الأصناف وأرصدة المستودعات والتصنيفات.',
    actions: [
      { key: 'items.create', label_ar: 'إضافة صنف أو فئة جديدة', action: 'create' },
      { key: 'items.edit', label_ar: 'تعديل بيانات وتصنيف الصنف والفئة', action: 'edit' },
      { key: 'items.delete', label_ar: 'حذف صنف أو فئة غير مرتبطة', action: 'delete' },
      { key: 'items.manage', label_ar: 'إدارة عامة للمخازن والتصنيفات', action: 'manage' }
    ]
  },
  {
    id: 'treasury',
    tabId: 'treasury',
    title_ar: 'الخزينة النقدية وسندات الصرف والقبض',
    title_en: 'Cash, Bank & Treasury',
    viewKey: 'treasury.view',
    description_ar: 'استعراض الخزائن النقدية والحسابات البنكية وسجل السندات المالية.',
    actions: [
      { key: 'treasury.receipt.create', label_ar: 'إصدار وترحيل سند قبض مالي', action: 'receipt' },
      { key: 'treasury.payment.create', label_ar: 'إصدار وترحيل سند دفع وصرف مالي', action: 'payment' },
      { key: 'treasury.reverse', label_ar: 'إلغاء وعكس سندات الخزينة', action: 'reverse' },
      { key: 'treasury.print', label_ar: 'طباعة إيصالات وسندات القبض والصرف', action: 'print' }
    ]
  },
  {
    id: 'reports',
    tabId: 'reports',
    title_ar: 'التقارير المالية والختامية',
    title_en: 'Financial Reports',
    viewKey: 'reports.view',
    description_ar: 'استعراض ميزان المراجعة، قائمة الدخل، المركز المالي، وإقرار القيمة المضافة.',
    actions: [
      { key: 'reports.print', label_ar: 'طباعة التقارير المالية', action: 'print' },
      { key: 'reports.export', label_ar: 'تصدير التقارير إلى Excel', action: 'export' }
    ]
  },
  {
    id: 'eta',
    tabId: 'eta',
    title_ar: 'الفاتورة الإلكترونية المصرية (ETA)',
    title_en: 'Egyptian Tax Authority (ETA)',
    viewKey: 'eta.view',
    description_ar: 'استعراض مطابقة الفواتير الإلكترونية والتوقيع الرقمي (Sandbox).',
    actions: [
      { key: 'eta.send', label_ar: 'محاكاة إرسال الفاتورة إلكترونياً', action: 'send' }
    ]
  },
  {
    id: 'tests',
    tabId: 'tests',
    title_ar: 'فحص النظام والاختبارات الآلية',
    title_en: 'System Diagnostics & Test Runner',
    viewKey: 'tests.view',
    description_ar: 'لوحة مراقبة سلامة المحرك المحاسبي وتشغيل الاختبارات المستقلة.',
    actions: [
      { key: 'tests.run', label_ar: 'تشغيل أجنحة الاختبارات الآلية المستقلة', action: 'run' }
    ]
  },
  {
    id: 'audit',
    tabId: 'audit',
    title_ar: 'إدارة المستخدمين والتدقيق الرقابي',
    title_en: 'User Management & Audit Trails',
    viewKey: 'users.view',
    description_ar: 'استعراض حسابات المستخدمين وسجل العمليات غير القابل للتعديل.',
    actions: [
      { key: 'users.manage', label_ar: 'إدارة الحسابات وتخصيص الصلاحيات الفردية', action: 'manage' }
    ]
  },
  {
    id: 'month_close',
    tabId: 'month_close',
    title_ar: 'مراجعة وإقفال الشهر',
    title_en: 'Month-End Closing & Diagnostics',
    viewKey: 'month_close.view',
    description_ar: 'مراجعة ومطابقة حسابات الرقابة، المخزون، الخزينة، وفحص الأخطاء المانعة وإقفال الفترات المالية.',
    actions: [
      { key: 'period.review', label_ar: 'تشغيل المراجعة والفحص المالي', action: 'review' },
      { key: 'period.close', label_ar: 'تنفيذ إقفال الفترة المالية', action: 'close' },
      { key: 'period.reopen', label_ar: 'إعادة فتح فترة مالية مغلقة بمسوغ رسمي', action: 'reopen' }
    ]
  },
  {
    id: 'bank_reconciliation',
    tabId: 'bank_reconciliation',
    title_ar: 'تسوية كشوف الحسابات البنكية',
    title_en: 'Bank Reconciliation',
    viewKey: 'bank_reconciliation.view',
    description_ar: 'استيراد ومطابقة كشوف الحسابات البنكية مع الدفاتر وتسوية الفروق والعمولات.',
    actions: [
      { key: 'bank.reconcile', label_ar: 'مطابقة واعتماد مذكرة التسوية البنكية', action: 'reconcile' },
      { key: 'bank.reconciliation.import', label_ar: 'استيراد كشف الحساب البنكي', action: 'import' },
      { key: 'bank.reconciliation.match', label_ar: 'مطابقة وإلغاء مطابقة الحركات', action: 'match' },
      { key: 'bank.reconciliation.fees', label_ar: 'تسجيل قيود الرسوم والفوائد البنكية', action: 'fees' }
    ]
  },
  {
    id: 'inventory_count',
    tabId: 'inventory_count',
    title_ar: 'جرد المخزون ومحاضر التسوية',
    title_en: 'Physical Inventory Counts',
    viewKey: 'inventory_count.view',
    description_ar: 'إجراء محاضر الجرد الفعلي للمخازن وحساب الفروق وتسوية العجز والزيادة بقيد معتمد.',
    actions: [
      { key: 'inventory.count', label_ar: 'تسجيل واعتماد محاضر الجرد الفعلي', action: 'count' }
    ]
  },
  {
    id: 'excel_import',
    tabId: 'excel_import',
    title_ar: 'استيراد Excel والأرصدة الافتتاحية',
    title_en: 'Excel Import & Opening Balances',
    viewKey: 'excel_import.view',
    description_ar: 'تحميل القوالب واستيراد الحسابات، الأطراف، الأصناف، والأرصدة الافتتاحية بدقة وتوازن.',
    actions: [
      { key: 'import.excel', label_ar: 'معاينة واعتماد ملفات الاستيراد', action: 'import' }
    ]
  },
  {
    id: 'excel_analytics',
    tabId: 'excel_analytics',
    title_ar: 'تحليل Excel ومساعد الميزان الذكي',
    title_en: 'Excel Analytics & Al-Mizan Assistant',
    viewKey: 'excel_analytics.view',
    description_ar: 'معاينة وتحليل ملفات Excel، استخراج الإحصائيات، التجميعات، الرسوم البيانية، ومحادثة «اسأل ملفك».',
    actions: [
      { key: 'excel_analytics.export', label_ar: 'تصدير الجداول والتحليل إلى Excel', action: 'export' },
      { key: 'excel_analytics.chat', label_ar: 'استخدام محادثة «اسأل ملفك» الذكية', action: 'chat' }
    ]
  },
  {
    id: 'backup',
    tabId: 'backup',
    title_ar: 'النسخ الاحتياطي والاستعادة',
    title_en: 'System Backup & Restore',
    viewKey: 'backup.view',
    description_ar: 'إنشاء واستعادة نسخ احتياطية متسقة لقاعدة البيانات وفحص سلامة السجلات.',
    actions: [
      { key: 'backup.create', label_ar: 'إنشاء نسخة احتياطية فورية', action: 'create' },
      { key: 'backup.download', label_ar: 'تنزيل ملف النسخة الاحتياطية', action: 'download' },
      { key: 'backup.verify', label_ar: 'التحقق من سلامة النسخة الاحتياطية', action: 'verify' },
      { key: 'backup.restore', label_ar: 'فحص واستعادة قاعدة البيانات', action: 'restore' }
    ]
  }
];

export const SECURITY_CONTROLS_CONFIG = [
  {
    key: 'view_cost',
    label_ar: 'الاطلاع على أسعار التكلفة وتقييم المخزون',
    description_ar: 'يسمح للمستخدم برؤية أسعار الشراء، التكلفة المتوسطة المتحركة، وقيمة المخزون في بطاقات الأصناف والتقارير ولوحة التحكم.'
  },
  {
    key: 'view_profit',
    label_ar: 'الاطلاع على هوامش الأرباح وقائمة الدخل',
    description_ar: 'يسمح للمستخدم باستعراض مجمل وصافي الربح في لوحة التحكم وقائمة الدخل والتقارير المالية الحساسة.'
  },
  {
    key: 'manage_settings',
    label_ar: 'إدارة إعدادات النظام ومحددات المنشأة',
    description_ar: 'يسمح بضبط سياسات البيع بالسالب، إعدادات الشركات، والفروع.'
  },
  {
    key: 'reopen_period',
    label_ar: 'إعادة فتح الفترات المالية المقفلة',
    description_ar: 'صلاحية استثنائية لترحيل أو تعديل قيود في فترات مالية تم إغلاقها سابقاً.'
  }
];

export function hasPermission(user: User | null, permKey: string | string[]): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true;

  const userPerms = user.permissions || [];
  if (userPerms.includes('*')) return true;

  if (Array.isArray(permKey)) {
    return permKey.some(k => userPerms.includes(k));
  }
  return userPerms.includes(permKey);
}

export function canAccessTab(tab: NavTab, user: User | null): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true;

  const found = SCREEN_PERMISSIONS_CONFIG.find(g => g.tabId === tab);
  if (!found) return false;

  // Primary check: screen view permission
  if (hasPermission(user, found.viewKey)) return true;

  // Alternate specific keys for tabs
  if (tab === 'inventory' && hasPermission(user, 'items.view')) return true;
  if (tab === 'audit' && (hasPermission(user, 'users.manage') || hasPermission(user, 'users.view'))) return true;
  if (tab === 'tests' && hasPermission(user, 'tests.run')) return true;
  if (tab === 'month_close' && (hasPermission(user, 'period.view') || hasPermission(user, 'period.review') || hasPermission(user, 'period.close'))) return true;
  if (tab === 'bank_reconciliation' && (hasPermission(user, 'bank.reconcile') || hasPermission(user, 'bank.reconciliation.view') || hasPermission(user, 'treasury.view'))) return true;
  if (tab === 'inventory_count' && (hasPermission(user, 'inventory.count') || hasPermission(user, 'inventory_count.view'))) return true;
  if (tab === 'excel_import' && (hasPermission(user, 'import.excel') || hasPermission(user, 'excel_import.view'))) return true;
  if (tab === 'excel_analytics' && (hasPermission(user, 'excel_analytics.view') || hasPermission(user, 'import.excel') || hasPermission(user, 'excel_import.view'))) return true;
  if (tab === 'backup' && (hasPermission(user, 'backup.view') || hasPermission(user, 'backup.create') || hasPermission(user, 'backup.restore'))) return true;

  return false;
}


