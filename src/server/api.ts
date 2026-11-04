import { Router, Request, Response, NextFunction } from 'express';
import Decimal from 'decimal.js';
import crypto from 'crypto';
import { db, effectivePermissions } from './db.js';
import {
  postJournalEntry,
  reverseJournalEntry,
  getFiscalPeriodForDate,
  getNextDocumentNumber,
  logAudit,
  validateAndDeductStock,
  isNegativeStockAllowed
} from './accounting-engine.js';
import { verifyPassword, hashPassword } from './seed.js';
import { runAllFinancialTests } from './tests.js';
import { periodClosingRouter } from './routes/period-closing.js';
import { importExcelRouter } from './routes/import-excel.js';
import { backupsRouter } from './routes/backups.js';
import { agingRouter } from './routes/aging-reports.js';
import { bankReconciliationRouter } from './routes/bank-reconciliation.js';
import { inventoryCountsRouter } from './routes/inventory-counts.js';
import { excelAnalyticsRouter } from './routes/excel-analytics.js';

export const apiRouter = Router();

// Extend Request type for authenticated session
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    display_name: string;
    role: string;
    permissions: string[];
    allowed_branch_ids: string;
    allowed_warehouse_ids: string;
    allowed_cashbox_ids: string;
  };
}

// ----------------------------------------------------
// Authentication Middleware
// ----------------------------------------------------
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.query.token && typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'غير مصرح: يجب تسجيل الدخول للوصول إلى هذا المورد' });
  }

  const session = db.prepare(`
    SELECT s.token, s.expires_at, u.id, u.username, u.display_name, u.role, u.is_active,
           u.allowed_branch_ids, u.allowed_warehouse_ids, u.allowed_cashbox_ids
    FROM user_sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ?
  `).get(token) as any;

  if (!session) {
    return res.status(401).json({ error: 'جلسة الدخول غير صالحة أو منتهية. يرجى تسجيل الدخول مجدداً.' });
  }

  if (new Date(session.expires_at) < new Date()) {
    db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
    return res.status(401).json({ error: 'انتهت مدة الجلسة. يرجى تسجيل الدخول مجدداً.' });
  }

  if (session.is_active === 0) {
    return res.status(403).json({ error: 'تم تعطيل هذا الحساب. يرجى مراجعة مسؤول النظام.' });
  }

  // Load user permissions dynamically (individual permissions take precedence, else role defaults)
  const permissions = effectivePermissions(session.id, session.role);
  
  req.user = {
    id: session.id,
    username: session.username,
    display_name: session.display_name,
    role: session.role,
    permissions,
    allowed_branch_ids: session.allowed_branch_ids || '*',
    allowed_warehouse_ids: session.allowed_warehouse_ids || '*',
    allowed_cashbox_ids: session.allowed_cashbox_ids || '*'
  };

  next();
}

// Middleware: Require specific permission (strictly respects fine-grained individual permissions)
export function requirePermission(permissionKey: string, ...alternateKeys: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'غير مصرح: يجب تسجيل الدخول' });
    }
    // Owner role always has full bypass
    if (req.user.role === 'owner') {
      return next();
    }
    const userPerms = req.user.permissions || [];
    const allKeys = [permissionKey, ...alternateKeys];

    // Check if the user explicitly possesses at least one of the specified required/alternate permissions
    const hasPerm = allKeys.some(key => userPerms.includes(key));

    if (!hasPerm) {
      return res.status(403).json({ error: `لا تملك الصلاحية اللازمة (${permissionKey}) لتنفيذ هذه العملية.` });
    }
    next();
  };
}

// Helper: Check scope limits strictly (Never allow all on corrupted or invalid scope JSON)
export function isBranchAllowed(user: AuthenticatedRequest['user'], branchId: string): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true;
  if (user.allowed_branch_ids === '*') return true;
  try {
    const list = JSON.parse(user.allowed_branch_ids);
    if (!Array.isArray(list)) return false;
    return list.includes(branchId);
  } catch {
    return false; // Reject access on corrupted or invalid JSON
  }
}

export function isWarehouseAllowed(user: AuthenticatedRequest['user'], warehouseId: string): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true;
  if (user.allowed_warehouse_ids === '*') return true;
  try {
    const list = JSON.parse(user.allowed_warehouse_ids);
    if (!Array.isArray(list)) return false;
    return list.includes(warehouseId);
  } catch {
    return false;
  }
}

export function isCashboxAllowed(user: AuthenticatedRequest['user'], cashboxId: string): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true;
  if (user.allowed_cashbox_ids === '*') return true;
  try {
    const list = JSON.parse(user.allowed_cashbox_ids);
    if (!Array.isArray(list)) return false;
    return list.includes(cashboxId);
  } catch {
    return false;
  }
}

// Helper: Handle Idempotency Key bound to User, Endpoint, and Request Hash
export function checkIdempotency(req: AuthenticatedRequest, res: Response): any | null {
  const key = (req.headers['idempotency-key'] || req.body?.idempotencyKey) as string | undefined;
  if (!key) return null;

  const requestHash = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
  const userId = req.user?.id || 'anonymous';

  const existing = db.prepare(`
    SELECT user_id, endpoint, request_hash, response_code, response_body 
    FROM idempotency_keys 
    WHERE key = ?
  `).get(key) as { user_id: string; endpoint: string; request_hash: string; response_code: number; response_body: string } | undefined;

  if (existing) {
    if (existing.user_id !== userId || existing.request_hash !== requestHash) {
      res.status(409).json({
        error: 'تعارض في مفتاح عدم التكرار (Idempotency Key Conflict): هذا المفتاح مسجل مسبقاً بمحتوى طلب أو مستخدم مختلف.'
      });
      return true;
    }

    try {
      res.status(existing.response_code).json(JSON.parse(existing.response_body));
      return true;
    } catch {
      return null;
    }
  }
  return null;
}

export function saveIdempotency(key: string | undefined, userId: string, endpoint: string, code: number, body: any, reqBody?: any) {
  if (!key) return;
  try {
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(reqBody || {})).digest('hex');
    db.prepare(`
      INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, response_code, response_body)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET response_code = ?, response_body = ?
    `).run(key, userId, endpoint, requestHash, code, JSON.stringify(body), code, JSON.stringify(body));
  } catch (err) {
    console.error('Failed to save idempotency key:', err);
  }
}

// ----------------------------------------------------
// 1. Auth Endpoints
// ----------------------------------------------------
apiRouter.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
  }

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const attemptKey = `${clientIp}_${username}`;

  // Check login rate limiting
  const attempt = db.prepare('SELECT attempts, locked_until FROM login_attempts WHERE ip_or_user = ?').get(attemptKey) as { attempts: number; locked_until: string | null } | undefined;
  if (attempt && attempt.locked_until && new Date(attempt.locked_until) > new Date()) {
    const remainingMins = Math.ceil((new Date(attempt.locked_until).getTime() - Date.now()) / 60000);
    return res.status(429).json({ error: `تم تجاوز الحد الأقصى لمحاولات الدخول. الحساب مؤمّن ومغلق لمدة ${remainingMins} دقيقة.` });
  }

  const user = db.prepare('SELECT id, username, password_hash, display_name, role, is_active, allowed_branch_ids, allowed_warehouse_ids, allowed_cashbox_ids FROM users WHERE username = ?').get(username) as any;

  if (!user) {
    // Increment failed attempt
    db.prepare(`
      INSERT INTO login_attempts (ip_or_user, attempts, last_attempt)
      VALUES (?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(ip_or_user) DO UPDATE SET attempts = attempts + 1, last_attempt = CURRENT_TIMESTAMP
    `).run(attemptKey);
    return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }

  if (user.is_active === 0) {
    return res.status(403).json({ error: 'هذا الحساب معطل. يرجى التواصل مع مسؤول النظام.' });
  }

  const verification = verifyPassword(password, user.password_hash);
  if (!verification.valid) {
    const currentAttempts = (attempt?.attempts || 0) + 1;
    let lockUntil: string | null = null;
    if (currentAttempts >= 5) {
      // Lock for 15 minutes
      lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    }

    db.prepare(`
      INSERT INTO login_attempts (ip_or_user, attempts, last_attempt, locked_until)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(ip_or_user) DO UPDATE SET attempts = ?, last_attempt = CURRENT_TIMESTAMP, locked_until = ?
    `).run(attemptKey, currentAttempts, lockUntil, currentAttempts, lockUntil);

    return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }

  // Clear failed login attempts on success
  db.prepare('DELETE FROM login_attempts WHERE ip_or_user = ?').run(attemptKey);

  // Upgrade legacy SHA-256 hash to bcrypt transparently
  if (verification.needsRehash) {
    const newBcryptHash = hashPassword(password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newBcryptHash, user.id);
  }

  // Generate secure 64-char hex session token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  db.prepare(`
    INSERT INTO user_sessions (token, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(token, user.id, expiresAt);

  // Fetch true effective permissions (individual if custom, else role)
  user.permissions = effectivePermissions(user.id, user.role);
  delete user.password_hash;

  logAudit(user.id, 'LOGIN', 'users', user.id, `تسجيل دخول ناجح للمستخدم ${user.display_name}`, null, null);

  res.json({ token, user });
});

apiRouter.post('/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
  }
  res.json({ success: true, message: 'تم تسجيل الخروج وإبطال الجلسة بنجاح.' });
});

apiRouter.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

// ----------------------------------------------------
// 2. User & Permission Management (Full Admin Management)
// ----------------------------------------------------
apiRouter.get('/users', requireAuth, requirePermission('users.view', 'users.manage', 'manage_settings'), (req: AuthenticatedRequest, res) => {
  const rawUsers = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.is_active, u.created_at,
           u.allowed_branch_ids, u.allowed_warehouse_ids, u.allowed_cashbox_ids,
           ip.permission_keys as custom_perm_json
    FROM users u
    LEFT JOIN individual_permissions ip ON u.id = ip.user_id
    ORDER BY u.created_at ASC
  `).all() as any[];

  const users = rawUsers.map(u => {
    const isCustom = u.custom_perm_json !== null && u.custom_perm_json !== undefined;
    const perms = effectivePermissions(u.id, u.role);
    delete u.custom_perm_json;
    return {
      ...u,
      is_custom: isCustom,
      permissions: perms,
      permissions_csv: perms.join(',')
    };
  });

  res.json({ users });
});

apiRouter.post('/users', requireAuth, requirePermission('manage_settings'), (req: AuthenticatedRequest, res) => {
  const { username, password, display_name, role, allowed_branch_ids, allowed_warehouse_ids, allowed_cashbox_ids } = req.body;
  if (!username || !password || !display_name || !role) {
    return res.status(400).json({ error: 'بيانات المستخدم الأساسية ناقصة.' });
  }

  // Prevent non-owner from creating an owner
  if (role === 'owner' && req.user?.role !== 'owner') {
    return res.status(403).json({ error: 'لا يمكن تعيين دور مالك النظام إلا من قبل المالك الحالي.' });
  }

  // Validate scope formats (must be '*' or valid JSON array)
  const validateScope = (val: any, fieldName: string) => {
    if (!val || val === '*') return '*';
    try {
      const parsed = JSON.parse(val);
      if (!Array.isArray(parsed)) throw new Error();
      return JSON.stringify(parsed);
    } catch {
      throw new Error(`قيمة نطاق الوصول (${fieldName}) غير صالحة. يجب أن تكون '*' أو مصفوفة JSON صالحة.`);
    }
  };

  try {
    const cleanBranchScope = validateScope(allowed_branch_ids, 'الفروع');
    const cleanWarehouseScope = validateScope(allowed_warehouse_ids, 'المستودعات');
    const cleanCashboxScope = validateScope(allowed_cashbox_ids, 'الخزائن والبنوك');

    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(400).json({ error: `اسم المستخدم "${username}" مسجل مسبقاً في النظام.` });
    }

    const userId = `usr_${username.toLowerCase().replace(/[^a-z0-9_]/g, '')}_${Date.now().toString().slice(-4)}`;
    const passHash = hashPassword(password);

    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, role, is_active, allowed_branch_ids, allowed_warehouse_ids, allowed_cashbox_ids)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      userId,
      username,
      passHash,
      display_name,
      role,
      cleanBranchScope,
      cleanWarehouseScope,
      cleanCashboxScope
    );

    logAudit(req.user!.id, 'CREATE_USER', 'users', userId, `إنشاء مستخدم جديد: ${username} بالدور: ${role}`);
    res.json({ success: true, userId, message: `تم إنشاء المستخدم "${display_name}" بنجاح.` });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.put('/users/:id', requireAuth, requirePermission('manage_settings'), (req: AuthenticatedRequest, res) => {
  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!targetUser) return res.status(404).json({ error: 'المستخدم غير موجود' });

  const { is_active, role, password, display_name, allowed_branch_ids, allowed_warehouse_ids, allowed_cashbox_ids } = req.body;

  // 1. Prevent non-owner from modifying an owner user
  if (targetUser.role === 'owner' && req.user?.role !== 'owner') {
    return res.status(403).json({ error: 'لا يمكن تعديل بيانات أو صلاحيات مالك النظام إلا بواسطة المالك نفسه.' });
  }

  // 2. Prevent self-elevation of role
  if (req.user?.id === targetUser.id && role && role !== targetUser.role) {
    return res.status(403).json({ error: 'لا يمكنك تغيير أو ترقية دورك الوظيفي بنفسك.' });
  }

  // 3. Prevent non-owner from elevating anyone to owner
  if (role === 'owner' && targetUser.role !== 'owner' && req.user?.role !== 'owner') {
    return res.status(403).json({ error: 'لا يمكن ترقية أي مستخدم لدور مالك النظام إلا من قبل المالك الحالي.' });
  }

  // 4. Protect the last active owner from being deactivated or changed
  if (targetUser.role === 'owner' && (is_active === 0 || (role && role !== 'owner'))) {
    const ownerCount = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'owner' AND is_active = 1").get() as { cnt: number };
    if (ownerCount.cnt <= 1) {
      return res.status(400).json({ error: 'لا يمكن تعطيل أو تغيير دور مالك النظام الوحيد النشط.' });
    }
  }

  // Validate scope formats
  const validateScope = (val: any, fieldName: string, defaultVal: string) => {
    if (val === undefined) return defaultVal;
    if (val === '*') return '*';
    try {
      const parsed = typeof val === 'string' ? JSON.parse(val) : val;
      if (!Array.isArray(parsed)) throw new Error();
      return JSON.stringify(parsed);
    } catch {
      throw new Error(`قيمة نطاق الوصول (${fieldName}) غير صالحة. يجب أن تكون '*' أو مصفوفة JSON صالحة.`);
    }
  };

  try {
    const cleanBranchScope = validateScope(allowed_branch_ids, 'الفروع', targetUser.allowed_branch_ids);
    const cleanWarehouseScope = validateScope(allowed_warehouse_ids, 'المستودعات', targetUser.allowed_warehouse_ids);
    const cleanCashboxScope = validateScope(allowed_cashbox_ids, 'الخزائن والبنوك', targetUser.allowed_cashbox_ids);

    if (password) {
      const newHash = hashPassword(password);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, targetUser.id);
      // Invalidate all existing sessions on password reset
      db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(targetUser.id);
    }

    db.prepare(`
      UPDATE users 
      SET is_active = COALESCE(?, is_active),
          role = COALESCE(?, role),
          display_name = COALESCE(?, display_name),
          allowed_branch_ids = ?,
          allowed_warehouse_ids = ?,
          allowed_cashbox_ids = ?
      WHERE id = ?
    `).run(
      is_active !== undefined ? is_active : null,
      role || null,
      display_name || null,
      cleanBranchScope,
      cleanWarehouseScope,
      cleanCashboxScope,
      targetUser.id
    );

    logAudit(req.user!.id, 'UPDATE_USER', 'users', targetUser.id, `تعديل بيانات وصلاحيات المستخدم: ${targetUser.username}`);
    res.json({ success: true, message: 'تم تحديث بيانات المستخدم وصلاحياته بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/users/:id', requireAuth, requirePermission('manage_settings'), (req: AuthenticatedRequest, res) => {
  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!targetUser) return res.status(404).json({ error: 'المستخدم غير موجود' });

  if (targetUser.id === req.user?.id) {
    return res.status(400).json({ error: 'لا يمكن حذف حساب المستخدم الحالي المسجل به الدخول.' });
  }

  if (targetUser.role === 'owner') {
    return res.status(403).json({ error: 'لا يمكن حذف حساب مالك النظام.' });
  }

  // Check if user is referenced in journal entries or invoices
  const jeCount = db.prepare('SELECT COUNT(*) as cnt FROM journal_entries WHERE created_by = ?').get(targetUser.id) as { cnt: number };
  const siCount = db.prepare('SELECT COUNT(*) as cnt FROM sales_invoices WHERE created_by = ?').get(targetUser.id) as { cnt: number };
  const piCount = db.prepare('SELECT COUNT(*) as cnt FROM purchase_invoices WHERE created_by = ?').get(targetUser.id) as { cnt: number };

  if (jeCount.cnt > 0 || siCount.cnt > 0 || piCount.cnt > 0) {
    return res.status(400).json({
      error: `لا يمكن حذف المستخدم لوجود مستندات وسجلات مالية منسوبة إليه (${jeCount.cnt + siCount.cnt + piCount.cnt} مستند). يمكنك تعطيل الحساب للحفاظ على سلامة سجل التدقيق.`
    });
  }

  try {
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(targetUser.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(targetUser.id);
    logAudit(req.user!.id, 'DELETE_USER', 'users', targetUser.id, `حذف المستخدم: ${targetUser.username}`);
    res.json({ success: true, message: 'تم حذف المستخدم بنجاح.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Comprehensive Unit & Action Permissions System
export const SYSTEM_AVAILABLE_PERMISSIONS = [
  // 1. لوحة التحكم والتحليلات (Dashboard)
  { key: 'dashboard.view', label_ar: 'لوحة التحكم: عرض الشاشة والمؤشرات المالية والتشغيلية', category: 'لوحة التحكم', unit: 'dashboard', action: 'view' },

  // 2. دليل الحسابات (Accounts)
  { key: 'accounts.view', label_ar: 'دليل الحسابات: استعراض الشجرة والأرصدة', category: 'دليل الحسابات', unit: 'accounts', action: 'view' },
  { key: 'accounts.create', label_ar: 'دليل الحسابات: إضافة حساب فرعي جديد', category: 'دليل الحسابات', unit: 'accounts', action: 'create' },
  { key: 'accounts.edit', label_ar: 'دليل الحسابات: تعديل بيانات الحساب والحالة', category: 'دليل الحسابات', unit: 'accounts', action: 'edit' },
  { key: 'accounts.delete', label_ar: 'دليل الحسابات: حذف الحساب غير المستخدم', category: 'دليل الحسابات', unit: 'accounts', action: 'delete' },
  { key: 'accounts.manage', label_ar: 'دليل الحسابات: إدارة الهيكل والشجرة', category: 'دليل الحسابات', unit: 'accounts', action: 'manage' },

  // 3. القيود اليومية (Journal Entries)
  { key: 'journal.view', label_ar: 'القيود اليومية: استعراض القيود اليومية والأستاذ', category: 'القيود اليومية', unit: 'journal', action: 'view' },
  { key: 'journal.create', label_ar: 'القيود اليومية: إنشاء مسودة قيد جديد', category: 'القيود اليومية', unit: 'journal', action: 'create' },
  { key: 'journal.edit_draft', label_ar: 'القيود اليومية: تعديل مسودات القيود', category: 'القيود اليومية', unit: 'journal', action: 'edit_draft' },
  { key: 'journal.delete_draft', label_ar: 'القيود اليومية: حذف مسودات القيود', category: 'القيود اليومية', unit: 'journal', action: 'delete_draft' },
  { key: 'journal.post', label_ar: 'القيود اليومية: ترحيل واعتماد القيد للأستاذ العام', category: 'القيود اليومية', unit: 'journal', action: 'post' },
  { key: 'journal.reverse', label_ar: 'القيود اليومية: عكس القيد اليومي المرحل', category: 'القيود اليومية', unit: 'journal', action: 'reverse' },
  { key: 'journal.print', label_ar: 'القيود اليومية: طباعة سند القيد اليومي', category: 'القيود اليومية', unit: 'journal', action: 'print' },
  { key: 'journal.export', label_ar: 'القيود اليومية: تصدير القيود اليومية للأكسل', category: 'القيود اليومية', unit: 'journal', action: 'export' },

  // 4. المبيعات (Sales Invoices)
  { key: 'sales.view', label_ar: 'المبيعات: استعراض فواتير المبيعات', category: 'المبيعات', unit: 'sales', action: 'view' },
  { key: 'sales.create', label_ar: 'المبيعات: إنشاء مسودة فاتورة مبيعات', category: 'المبيعات', unit: 'sales', action: 'create' },
  { key: 'sales.edit_draft', label_ar: 'المبيعات: تعديل مسودة فاتورة مبيعات', category: 'المبيعات', unit: 'sales', action: 'edit_draft' },
  { key: 'sales.delete_draft', label_ar: 'المبيعات: حذف مسودة فاتورة مبيعات', category: 'المبيعات', unit: 'sales', action: 'delete_draft' },
  { key: 'sales.post', label_ar: 'المبيعات: ترحيل واعتماد فاتورة المبيعات للمخزن والأستاذ', category: 'المبيعات', unit: 'sales', action: 'post' },
  { key: 'sales.reverse', label_ar: 'المبيعات: إلغاء وتصحيح فاتورة مبيعات مرحلة', category: 'المبيعات', unit: 'sales', action: 'reverse' },
  { key: 'sales.print', label_ar: 'المبيعات: طباعة الفاتورة الضريبية الرسمية', category: 'المبيعات', unit: 'sales', action: 'print' },
  { key: 'sales.export', label_ar: 'المبيعات: تصدير سجل فواتير المبيعات', category: 'المبيعات', unit: 'sales', action: 'export' },

  // 5. مردودات المبيعات (Sales Returns)
  { key: 'sales_returns.view', label_ar: 'مردودات المبيعات: استعراض مردودات المبيعات', category: 'مردودات البيع', unit: 'sales_returns', action: 'view' },
  { key: 'sales_returns.create', label_ar: 'مردودات المبيعات: إنشاء مسودة مردود مبيعات', category: 'مردودات البيع', unit: 'sales_returns', action: 'create' },
  { key: 'sales_returns.edit_draft', label_ar: 'مردودات المبيعات: تعديل مسودة مردود مبيعات', category: 'مردودات البيع', unit: 'sales_returns', action: 'edit_draft' },
  { key: 'sales_returns.delete_draft', label_ar: 'مردودات المبيعات: حذف مسودة مردود مبيعات', category: 'مردودات البيع', unit: 'sales_returns', action: 'delete_draft' },
  { key: 'sales_returns.post', label_ar: 'مردودات المبيعات: ترحيل واعتماد مردود المبيعات', category: 'مردودات البيع', unit: 'sales_returns', action: 'post' },
  { key: 'sales_returns.reverse', label_ar: 'مردودات المبيعات: عكس مردود مبيعات مرحل', category: 'مردودات البيع', unit: 'sales_returns', action: 'reverse' },
  { key: 'sales_returns.print', label_ar: 'مردودات المبيعات: طباعة إشعار الخصم/المرتجع', category: 'مردودات البيع', unit: 'sales_returns', action: 'print' },

  // 6. المشتريات (Purchase Invoices)
  { key: 'purchases.view', label_ar: 'المشتريات: استعراض فواتير المشتريات', category: 'المشتريات', unit: 'purchases', action: 'view' },
  { key: 'purchases.create', label_ar: 'المشتريات: إنشاء مسودة فاتورة مشتريات', category: 'المشتريات', unit: 'purchases', action: 'create' },
  { key: 'purchases.edit_draft', label_ar: 'المشتريات: تعديل مسودة فاتورة مشتريات', category: 'المشتريات', unit: 'purchases', action: 'edit_draft' },
  { key: 'purchases.delete_draft', label_ar: 'المشتريات: حذف مسودة فاتورة مشتريات', category: 'المشتريات', unit: 'purchases', action: 'delete_draft' },
  { key: 'purchases.post', label_ar: 'المشتريات: ترحيل واعتماد فاتورة مشتريات للمخزن والأستاذ', category: 'المشتريات', unit: 'purchases', action: 'post' },
  { key: 'purchases.reverse', label_ar: 'المشتريات: إلغاء وتصحيح فاتورة مشتريات مرحلة', category: 'المشتريات', unit: 'purchases', action: 'reverse' },
  { key: 'purchases.print', label_ar: 'المشتريات: طباعة إذن استلام وفاتورة مشتريات', category: 'المشتريات', unit: 'purchases', action: 'print' },
  { key: 'purchases.export', label_ar: 'المشتريات: تصدير سجل فواتير المشتريات', category: 'المشتريات', unit: 'purchases', action: 'export' },

  // 7. مردودات المشتريات (Purchase Returns)
  { key: 'purchase_returns.view', label_ar: 'مردودات المشتريات: استعراض مردودات المشتريات', category: 'مردودات الشراء', unit: 'purchase_returns', action: 'view' },
  { key: 'purchase_returns.create', label_ar: 'مردودات المشتريات: إنشاء مسودة مردود مشتريات', category: 'مردودات الشراء', unit: 'purchase_returns', action: 'create' },
  { key: 'purchase_returns.edit_draft', label_ar: 'مردودات المشتريات: تعديل مسودة مردود مشتريات', category: 'مردودات الشراء', unit: 'purchase_returns', action: 'edit_draft' },
  { key: 'purchase_returns.delete_draft', label_ar: 'مردودات المشتريات: حذف مسودة مردود مشتريات', category: 'مردودات الشراء', unit: 'purchase_returns', action: 'delete_draft' },
  { key: 'purchase_returns.post', label_ar: 'مردودات المشتريات: ترحيل واعتماد مردود المشتريات', category: 'مردودات الشراء', unit: 'purchase_returns', action: 'post' },
  { key: 'purchase_returns.reverse', label_ar: 'مردودات المشتريات: عكس مردود مشتريات مرحل', category: 'مردودات الشراء', unit: 'purchase_returns', action: 'reverse' },
  { key: 'purchase_returns.print', label_ar: 'مردودات المشتريات: طباعة إشعار الإضافة/مرتجع الشراء', category: 'مردودات الشراء', unit: 'purchase_returns', action: 'print' },

  // 8. العملاء والموردون (Parties)
  { key: 'parties.view', label_ar: 'العملاء والموردون: استعراض البيانات وكشف الحساب', category: 'العملاء والموردين', unit: 'parties', action: 'view' },
  { key: 'parties.create', label_ar: 'العملاء والموردون: إضافة عميل أو مورد جديد', category: 'العملاء والموردين', unit: 'parties', action: 'create' },
  { key: 'parties.edit', label_ar: 'العملاء والموردون: تعديل بيانات الطرف والشروط الائتمانية', category: 'العملاء والموردين', unit: 'parties', action: 'edit' },
  { key: 'parties.delete', label_ar: 'العملاء والموردون: حذف الطرف غير المرتبط أو تعطيله', category: 'العملاء والموردين', unit: 'parties', action: 'delete' },
  { key: 'parties.statement', label_ar: 'العملاء والموردون: طباعة واستخراج كشف الحساب التفصيلي', category: 'العملاء والموردين', unit: 'parties', action: 'statement' },

  // 9. الأصناف والفئات والمخزون (Inventory & Items)
  { key: 'inventory.view', label_ar: 'المخزون والأصناف: استعراض بطاقات الأصناف ورصيد المخزون', category: 'الأصناف والمخزون', unit: 'inventory', action: 'view' },
  { key: 'items.view', label_ar: 'الأصناف والفئات: استعراض بيانات الأصناف والفئات', category: 'الأصناف والمخزون', unit: 'inventory', action: 'view' },
  { key: 'items.create', label_ar: 'الأصناف والفئات: إضافة صنف أو فئة جديدة', category: 'الأصناف والمخزون', unit: 'inventory', action: 'create' },
  { key: 'items.edit', label_ar: 'الأصناف والفئات: تعديل بيانات وتصنيف الصنف أو الفئة', category: 'الأصناف والمخزون', unit: 'inventory', action: 'edit' },
  { key: 'items.delete', label_ar: 'الأصناف والفئات: حذف صنف أو فئة غير مرتبطة', category: 'الأصناف والمخزون', unit: 'inventory', action: 'delete' },
  { key: 'items.manage', label_ar: 'الأصناف والفئات: إدارة عامة للمخازن والفئات', category: 'الأصناف والمخزون', unit: 'inventory', action: 'manage' },

  // 10. الخزينة وسندات القبض والدفع (Treasury Vouchers - Strictly Separated)
  { key: 'treasury.view', label_ar: 'الخزينة: استعراض الخزائن النقدية وسجل السندات', category: 'الخزينة النقدية', unit: 'treasury', action: 'view' },
  { key: 'treasury.receipt.create', label_ar: 'الخزينة: إصدار وترحيل سند قبض مالي', category: 'الخزينة النقدية', unit: 'treasury', action: 'receipt' },
  { key: 'treasury.payment.create', label_ar: 'الخزينة: إصدار وترحيل سند دفع / صرف مالي', category: 'الخزينة النقدية', unit: 'treasury', action: 'payment' },
  { key: 'treasury.receipt', label_ar: 'الخزينة: سند قبض مالي (موروث)', category: 'الخزينة النقدية', unit: 'treasury', action: 'receipt' },
  { key: 'treasury.payment', label_ar: 'الخزينة: سند دفع مالي (موروث)', category: 'الخزينة النقدية', unit: 'treasury', action: 'payment' },
  { key: 'treasury.reverse', label_ar: 'الخزينة: إلغاء وعكس سندات الخزينة', category: 'الخزينة النقدية', unit: 'treasury', action: 'reverse' },
  { key: 'treasury.print', label_ar: 'الخزينة: طباعة إيصالات وسندات القبض والصرف', category: 'الخزينة النقدية', unit: 'treasury', action: 'print' },

  // 11. التقارير المالية (Financial Reports)
  { key: 'reports.view', label_ar: 'التقارير: استعراض ميزان المراجعة والأستاذ والقوائم', category: 'التقارير المالية', unit: 'reports', action: 'view' },
  { key: 'reports.print', label_ar: 'التقارير: طباعة التقارير المالية وكشوف الحساب', category: 'التقارير المالية', unit: 'reports', action: 'print' },
  { key: 'reports.export', label_ar: 'التقارير: تصدير التقارير إلى ملفات Excel', category: 'التقارير المالية', unit: 'reports', action: 'export' },

  // 12. الضرائب المصرية (ETA Compliance)
  { key: 'eta.view', label_ar: 'الضرائب المصرية: استعراض سجل الفواتير والمطابقة', category: 'الضرائب والمطابقة', unit: 'eta', action: 'view' },
  { key: 'eta.send', label_ar: 'الضرائب المصرية: محاكاة إرسال الفاتورة إلكترونياً', category: 'الضرائب والمطابقة', unit: 'eta', action: 'send' },

  // 13. مركز الاختبارات (Automated Tests)
  { key: 'tests.view', label_ar: 'مركز الاختبارات: استعراض لوحة فحوصات النظام', category: 'مركز الاختبارات', unit: 'tests', action: 'view' },
  { key: 'tests.run', label_ar: 'مركز الاختبارات: تشغيل أجنحة الاختبارات الآلية المستقلة', category: 'مركز الاختبارات', unit: 'tests', action: 'run' },

  // 14. إدارة المستخدمين والتدقيق (Users Management)
  { key: 'users.view', label_ar: 'المستخدمون: استعراض قائمة المستخدمين وسجل التدقيق', category: 'إدارة المستخدمين', unit: 'users', action: 'view' },
  { key: 'users.manage', label_ar: 'المستخدمون: إدارة الحسابات وضبط الصلاحيات الفردية', category: 'إدارة المستخدمين', unit: 'users', action: 'manage' },

  // 15. الأمان والسرية والرقابة المالية
  { key: 'view_cost', label_ar: 'أمان وسرية: الاطلاع على أسعار التكلفة وتقييم المخزون', category: 'الأمان والسرية', unit: 'security', action: 'view_cost' },
  { key: 'view_profit', label_ar: 'أمان وسرية: الاطلاع على هوامش الأرباح وقائمة الدخل', category: 'الأمان والسرية', unit: 'security', action: 'view_profit' },
  { key: 'reopen_period', label_ar: 'رقابة مالية: إعادة فتح الفترات المالية المقفلة', category: 'الرقابة المالية', unit: 'security', action: 'reopen_period' },
  { key: 'manage_settings', label_ar: 'إدارة عامة: ضبط إعدادات ومحددات النظام', category: 'الرقابة المالية', unit: 'security', action: 'manage_settings' },

  // توافق موروث عام
  { key: 'view', label_ar: 'عرض عام موروث', category: 'توافق عام', unit: 'general', action: 'view' },
  { key: 'add', label_ar: 'إضافة عامة موروثة', category: 'توافق عام', unit: 'general', action: 'add' },
  { key: 'edit_draft', label_ar: 'تعديل مسودات عام', category: 'توافق عام', unit: 'general', action: 'edit_draft' },
  { key: 'delete_draft', label_ar: 'حذف مسودات عام', category: 'توافق عام', unit: 'general', action: 'delete_draft' },
  { key: 'post', label_ar: 'ترحيل عام موروث', category: 'توافق عام', unit: 'general', action: 'post' },
  { key: 'reverse', label_ar: 'عكس عام موروث', category: 'توافق عام', unit: 'general', action: 'reverse' },
  { key: 'print', label_ar: 'طباعة عامة', category: 'توافق عام', unit: 'general', action: 'print' },
  { key: 'export', label_ar: 'تصدير عام', category: 'توافق عام', unit: 'general', action: 'export' },
  { key: 'treasury.post', label_ar: 'ترحيل خزينة عام', category: 'توافق عام', unit: 'treasury', action: 'post' }
];

apiRouter.get('/permissions-matrix', requireAuth, (req, res) => {
  const roles = [
    { id: 'owner', name: 'المالك / Super Admin' },
    { id: 'admin', name: 'مدير النظام' },
    { id: 'finance_manager', name: 'المدير المالي' },
    { id: 'accountant', name: 'محاسب عام' },
    { id: 'sales_officer', name: 'مسؤول مبيعات' },
    { id: 'purchase_officer', name: 'مسؤول مشتريات' },
    { id: 'storekeeper', name: 'أمين مخزن' },
    { id: 'cashier', name: 'أمين خزينة / كاشير' },
    { id: 'auditor_readonly', name: 'مراجع حسابات (قراءة فقط)' },
  ];

  const allPerms = db.prepare('SELECT role, permission_key FROM user_permissions').all() as { role: string; permission_key: string }[];
  const rolePermissions: Record<string, string[]> = {};
  roles.forEach(r => { rolePermissions[r.id] = []; });
  allPerms.forEach(p => {
    if (!rolePermissions[p.role]) rolePermissions[p.role] = [];
    rolePermissions[p.role].push(p.permission_key);
  });

  res.json({
    roles,
    availablePermissions: SYSTEM_AVAILABLE_PERMISSIONS,
    matrix: rolePermissions
  });
});

apiRouter.put('/roles/:role/permissions', requireAuth, requirePermission('manage_settings', 'users.manage'), (req: AuthenticatedRequest, res) => {
  const targetRole = req.params.role;
  const { permissions } = req.body;

  if (!Array.isArray(permissions)) {
    return res.status(400).json({ error: 'مصفوفة الصلاحيات مطلوبة.' });
  }

  // Prevent non-owner from altering owner permissions
  if (targetRole === 'owner' && req.user?.role !== 'owner') {
    return res.status(403).json({ error: 'صلاحيات المالك محمية ولا يمكن تعديلها إلا من المالك نفسه.' });
  }

  // Storekeeper strictly cannot have view_cost or view_profit assigned by non-owner
  if (targetRole === 'storekeeper' && (permissions.includes('view_cost') || permissions.includes('view_profit')) && req.user?.role !== 'owner') {
    return res.status(403).json({ error: 'لا يمكن منح صلاحية عرض التكلفة أو الأرباح لدور أمين المخزن.' });
  }

  try {
    db.transaction(() => {
      db.prepare('DELETE FROM user_permissions WHERE role = ?').run(targetRole);
      const insertStmt = db.prepare('INSERT INTO user_permissions (id, role, permission_key) VALUES (?, ?, ?)');
      for (const p of permissions) {
        insertStmt.run(`perm_${targetRole}_${p}`, targetRole, p);
      }
    })();

    logAudit(req.user!.id, 'UPDATE_ROLE_PERMISSIONS', 'roles', targetRole, `تحديث مصفوفة صلاحيات الدور: ${targetRole}`);
    res.json({ success: true, message: `تم تحديث صلاحيات الدور "${targetRole}" بنجاح.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Individual User Permissions Endpoints (Owner & users.manage)
apiRouter.get('/users/:id/permissions', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== 'owner' && !req.user!.permissions.includes('users.manage') && !req.user!.permissions.includes('manage_settings')) {
    return res.status(403).json({ error: 'غير مصرح: استعراض صلاحيات المستخدم مقتصر على المالك وإدارة المستخدمين.' });
  }

  const targetUser = db.prepare('SELECT id, username, display_name, role, is_active FROM users WHERE id = ?').get(req.params.id) as { id: string; username: string; display_name: string; role: string; is_active: number } | undefined;
  if (!targetUser) {
    return res.status(404).json({ error: 'المستخدم غير موجود.' });
  }

  // Check if an explicit custom record exists in individual_permissions
  const customRow = db.prepare('SELECT permission_keys FROM individual_permissions WHERE user_id = ?').get(targetUser.id) as { permission_keys: string } | undefined;
  const isCustom = customRow !== undefined && customRow.permission_keys !== null;

  let userPermissions: string[] = [];
  if (isCustom) {
    try {
      userPermissions = JSON.parse(customRow!.permission_keys);
    } catch {
      userPermissions = [];
    }
  } else {
    // Inherit from role
    const roleRows = db.prepare('SELECT permission_key FROM user_permissions WHERE role = ?').all(targetUser.role) as { permission_key: string }[];
    userPermissions = roleRows.map(r => r.permission_key);
  }

  const roleRows = db.prepare('SELECT permission_key FROM user_permissions WHERE role = ?').all(targetUser.role) as { permission_key: string }[];
  const rolePermissions = roleRows.map(r => r.permission_key);

  res.json({
    user: targetUser,
    custom: isCustom,
    permissions: userPermissions,
    rolePermissions,
    availablePermissions: SYSTEM_AVAILABLE_PERMISSIONS
  });
});

apiRouter.put('/users/:id/permissions', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== 'owner' && !req.user!.permissions.includes('users.manage')) {
    return res.status(403).json({ error: 'غير مصرح: تعديل الصلاحيات الفردية مقتصر على مالك النظام ومدير الصلاحيات.' });
  }

  const targetUser = db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?').get(req.params.id) as { id: string; username: string; display_name: string; role: string } | undefined;
  if (!targetUser) {
    return res.status(404).json({ error: 'المستخدم غير موجود.' });
  }

  // Prevent modifying owner permissions
  if (targetUser.role === 'owner') {
    return res.status(403).json({ error: 'صلاحيات حساب المالك (Owner) كاملة وثابتة ولا يمكن تخصيصها أو تقييدها.' });
  }

  // Prevent non-owner from elevating self
  if (targetUser.id === req.user!.id && req.user!.role !== 'owner') {
    return res.status(403).json({ error: 'لا يمكنك تعديل صلاحيات حسابك بنفسك.' });
  }

  const { custom, permissions } = req.body;

  try {
    db.transaction(() => {
      if (!custom || permissions === null) {
        // Mode 1: Inherit from role (Delete individual permissions record)
        db.prepare('DELETE FROM individual_permissions WHERE user_id = ?').run(targetUser.id);
        logAudit(req.user!.id, 'RESET_USER_PERMISSIONS', 'users', targetUser.id, `إلغاء التخصيص والعودة لصلاحيات الدور (${targetUser.role}) للمستخدم ${targetUser.display_name}`);
      } else {
        // Mode 2: Explicit custom permissions list (even if empty array [])
        if (!Array.isArray(permissions)) {
          throw new Error('مصفوفة الصلاحيات المخصصة غير صحيحة.');
        }
        const cleaned = permissions.filter(k => typeof k === 'string');
        db.prepare(`
          INSERT INTO individual_permissions (user_id, permission_keys, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET permission_keys = excluded.permission_keys, updated_at = CURRENT_TIMESTAMP
        `).run(targetUser.id, JSON.stringify(cleaned));

        logAudit(req.user!.id, 'UPDATE_USER_PERMISSIONS', 'users', targetUser.id, `تخصيص (${cleaned.length}) صلاحية للمستخدم ${targetUser.display_name}`);
      }
    })();

    const effective = effectivePermissions(targetUser.id, targetUser.role);

    res.json({
      success: true,
      effectivePermissions: effective,
      custom: Boolean(custom),
      message: custom
        ? `تم حفظ وتطبيق (${effective.length}) صلاحية مخصصة للمستخدم بنجاح وسريانها فوراً على الجلسة الحالية.`
        : `تم إلغاء التخصيص واستعادة صلاحيات الدور الوظيفي (${effective.length} صلاحية) بنجاح.`
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 3. Company & Org Structure
// ----------------------------------------------------
apiRouter.get('/company', requireAuth, (req, res) => {
  const company = db.prepare('SELECT * FROM companies LIMIT 1').get();
  const branches = db.prepare('SELECT * FROM branches ORDER BY code').all();
  const warehouses = db.prepare('SELECT w.*, b.name_ar as branch_name FROM warehouses w JOIN branches b ON w.branch_id = b.id ORDER BY w.code').all();
  const cashBoxes = db.prepare('SELECT c.*, b.name_ar as branch_name, a.name_ar as account_name FROM cash_boxes c JOIN branches b ON c.branch_id = b.id JOIN accounts a ON c.account_id = a.id').all();
  const bankAccounts = db.prepare('SELECT b.*, a.name_ar as account_name FROM bank_accounts b JOIN accounts a ON b.account_id = a.id').all();
  const fiscalYears = db.prepare('SELECT * FROM fiscal_years ORDER BY code DESC').all();
  const fiscalPeriods = db.prepare('SELECT * FROM fiscal_periods ORDER BY start_date').all();
  const costCenters = db.prepare('SELECT * FROM cost_centers ORDER BY code').all();
  const currencies = db.prepare('SELECT * FROM currencies').all();

  res.json({
    company,
    branches,
    warehouses,
    cashBoxes,
    bankAccounts,
    fiscalYears,
    fiscalPeriods,
    costCenters,
    currencies
  });
});

// ----------------------------------------------------
// 4. Dashboard KPIs with Permission-Based Cost Redaction & Period Filtering
// ----------------------------------------------------
apiRouter.get('/dashboard/stats', requireAuth, requirePermission('dashboard.view'), (req: AuthenticatedRequest, res) => {
  const fromDate = typeof req.query.fromDate === 'string' && req.query.fromDate ? req.query.fromDate : null;
  const toDate = typeof req.query.toDate === 'string' && req.query.toDate ? req.query.toDate : null;
  const branchId = typeof req.query.branchId === 'string' && req.query.branchId !== 'all' ? req.query.branchId : null;
  const warehouseId = typeof req.query.warehouseId === 'string' && req.query.warehouseId !== 'all' ? req.query.warehouseId : null;

  const hasViewCost = req.user?.role === 'owner' || req.user?.permissions.includes('view_cost');
  const hasViewProfit = req.user?.role === 'owner' || req.user?.permissions.includes('view_profit');
  const canViewTreasury = req.user?.role === 'owner' || req.user?.permissions.includes('treasury.view');
  const canViewParties = req.user?.role === 'owner' || req.user?.permissions.includes('parties.view') || req.user?.permissions.includes('reports.view');
  const canViewSales = req.user?.role === 'owner' || req.user?.permissions.includes('sales.view');
  const canViewPurchases = req.user?.role === 'owner' || req.user?.permissions.includes('purchases.view');

  // Compute Previous Period for Comparative Trend Analysis
  let prevFromDate: string | null = null;
  let prevToDate: string | null = null;
  if (fromDate && toDate) {
    const dStart = new Date(fromDate);
    const dEnd = new Date(toDate);
    const diffTime = Math.max(86400000, dEnd.getTime() - dStart.getTime());
    const prevEnd = new Date(dStart.getTime() - 86400000);
    const prevStart = new Date(prevEnd.getTime() - diffTime);
    prevFromDate = prevStart.toISOString().split('T')[0];
    prevToDate = prevEnd.toISOString().split('T')[0];
  }

  // 1. Current Balances (Cash, Receivables, Payables)
  const cashTotal = db.prepare(`
    SELECT COALESCE(SUM(debit - credit), 0) as balance 
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    WHERE jel.account_id IN ('acc_1111', 'acc_1112', 'acc_1113', 'acc_1114') AND je.status = 'posted'
    ${branchId ? 'AND je.branch_id = ?' : ''}
  `).get(...(branchId ? [branchId] : [])) as { balance: number };

  const receivables = db.prepare(`
    SELECT COALESCE(SUM(debit - credit), 0) as balance 
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    WHERE jel.account_id = 'acc_1121' AND je.status = 'posted'
    ${toDate ? 'AND je.entry_date <= ?' : ''}
    ${branchId ? 'AND je.branch_id = ?' : ''}
  `).get(...[...(toDate ? [toDate] : []), ...(branchId ? [branchId] : [])]) as { balance: number };

  const payables = db.prepare(`
    SELECT COALESCE(SUM(credit - debit), 0) as balance 
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    WHERE jel.account_id = 'acc_2111' AND je.status = 'posted'
    ${toDate ? 'AND je.entry_date <= ?' : ''}
    ${branchId ? 'AND je.branch_id = ?' : ''}
  `).get(...[...(toDate ? [toDate] : []), ...(branchId ? [branchId] : [])]) as { balance: number };

  // 2. Section 1: Sales (المبيعات)
  let salesFilter = "WHERE si.status != 'draft' AND si.status != 'reversed'";
  const salesParams: any[] = [];
  if (fromDate) { salesFilter += ' AND si.invoice_date >= ?'; salesParams.push(fromDate); }
  if (toDate) { salesFilter += ' AND si.invoice_date <= ?'; salesParams.push(toDate); }
  if (branchId) { salesFilter += ' AND si.branch_id = ?'; salesParams.push(branchId); }
  if (warehouseId) { salesFilter += ' AND si.warehouse_id = ?'; salesParams.push(warehouseId); }

  const salesStats = db.prepare(`
    SELECT COUNT(*) as invoice_count,
           COALESCE(SUM(si.total_amount), 0) as total_gross,
           COALESCE(SUM(si.taxable_amount), 0) as taxable_total,
           COALESCE(SUM(si.paid_amount), 0) as paid_total,
           COALESCE(SUM(si.remaining_amount), 0) as remaining_total
    FROM sales_invoices si
    ${salesFilter}
  `).get(...salesParams) as any;

  let retFilter = "WHERE sr.status = 'posted'";
  const retParams: any[] = [];
  if (fromDate) { retFilter += ' AND sr.return_date >= ?'; retParams.push(fromDate); }
  if (toDate) { retFilter += ' AND sr.return_date <= ?'; retParams.push(toDate); }
  if (branchId) { retFilter += ' AND sr.branch_id = ?'; retParams.push(branchId); }
  if (warehouseId) { retFilter += ' AND sr.warehouse_id = ?'; retParams.push(warehouseId); }

  const returnsStats = db.prepare(`
    SELECT COUNT(*) as return_count,
           COALESCE(SUM(sr.total_amount), 0) as total_returns
    FROM sales_returns sr
    ${retFilter}
  `).get(...retParams) as any;

  const netSalesAmount = (salesStats?.total_gross || 0) - (returnsStats?.total_returns || 0);
  const avgInvoiceValue = (salesStats?.invoice_count || 0) > 0 ? (salesStats.total_gross / salesStats.invoice_count) : 0;

  // Top 5 Customers
  const topCustomers = db.prepare(`
    SELECT p.id, p.name_ar, p.code,
           COUNT(si.id) as invoice_count,
           COALESCE(SUM(si.total_amount), 0) as total_sales
    FROM sales_invoices si
    JOIN parties p ON si.customer_id = p.id
    ${salesFilter}
    GROUP BY p.id
    ORDER BY total_sales DESC
    LIMIT 5
  `).all(...salesParams);

  // Top 5 Items
  let itemSalesFilter = "WHERE si.status != 'draft' AND si.status != 'reversed'";
  const itemSalesParams: any[] = [];
  if (fromDate) { itemSalesFilter += ' AND si.invoice_date >= ?'; itemSalesParams.push(fromDate); }
  if (toDate) { itemSalesFilter += ' AND si.invoice_date <= ?'; itemSalesParams.push(toDate); }
  if (branchId) { itemSalesFilter += ' AND si.branch_id = ?'; itemSalesParams.push(branchId); }
  if (warehouseId) { itemSalesFilter += ' AND si.warehouse_id = ?'; itemSalesParams.push(warehouseId); }

  const topItems = db.prepare(`
    SELECT i.id, i.name_ar, i.code,
           COALESCE(SUM(sii.quantity), 0) as total_qty,
           COALESCE(SUM(sii.total_amount), 0) as total_amount
    FROM sales_invoice_items sii
    JOIN sales_invoices si ON sii.invoice_id = si.id
    JOIN items i ON sii.item_id = i.id
    ${itemSalesFilter}
    GROUP BY i.id
    ORDER BY total_amount DESC
    LIMIT 5
  `).all(...itemSalesParams);

  // 3. Section 2: Purchases (المشتريات)
  let purFilter = "WHERE pi.status != 'draft' AND pi.status != 'reversed'";
  const purParams: any[] = [];
  if (fromDate) { purFilter += ' AND pi.invoice_date >= ?'; purParams.push(fromDate); }
  if (toDate) { purFilter += ' AND pi.invoice_date <= ?'; purParams.push(toDate); }
  if (branchId) { purFilter += ' AND pi.branch_id = ?'; purParams.push(branchId); }
  if (warehouseId) { purFilter += ' AND pi.warehouse_id = ?'; purParams.push(warehouseId); }

  const purStats = db.prepare(`
    SELECT COUNT(*) as invoice_count,
           COALESCE(SUM(pi.total_amount), 0) as total_gross,
           COALESCE(SUM(pi.paid_amount), 0) as paid_total,
           COALESCE(SUM(pi.remaining_amount), 0) as remaining_total
    FROM purchase_invoices pi
    ${purFilter}
  `).get(...purParams) as any;

  let pretFilter = "WHERE pr.status = 'posted'";
  const pretParams: any[] = [];
  if (fromDate) { pretFilter += ' AND pr.return_date >= ?'; pretParams.push(fromDate); }
  if (toDate) { pretFilter += ' AND pr.return_date <= ?'; pretParams.push(toDate); }
  if (branchId) { pretFilter += ' AND pr.branch_id = ?'; pretParams.push(branchId); }
  if (warehouseId) { pretFilter += ' AND pr.warehouse_id = ?'; pretParams.push(warehouseId); }

  const purReturnsStats = db.prepare(`
    SELECT COUNT(*) as return_count,
           COALESCE(SUM(pr.total_amount), 0) as total_returns
    FROM purchase_returns pr
    ${pretFilter}
  `).get(...pretParams) as any;

  const netPurchasesAmount = (purStats?.total_gross || 0) - (purReturnsStats?.total_returns || 0);

  // Top 5 Suppliers
  const topSuppliers = db.prepare(`
    SELECT p.id, p.name_ar, p.code,
           COUNT(pi.id) as invoice_count,
           COALESCE(SUM(pi.total_amount), 0) as total_purchases
    FROM purchase_invoices pi
    JOIN parties p ON pi.supplier_id = p.id
    ${purFilter}
    GROUP BY p.id
    ORDER BY total_purchases DESC
    LIMIT 5
  `).all(...purParams);

  // 4. Section 3: Treasury & Cash Flow (التحصيل والسداد)
  let tvFilter = "WHERE pv.status != 'reversed'";
  const tvParams: any[] = [];
  if (fromDate) { tvFilter += ' AND pv.voucher_date >= ?'; tvParams.push(fromDate); }
  if (toDate) { tvFilter += ' AND pv.voucher_date <= ?'; tvParams.push(toDate); }
  if (branchId) { tvFilter += ' AND pv.branch_id = ?'; tvParams.push(branchId); }

  const treasuryStats = db.prepare(`
    SELECT 
      COALESCE(SUM(CASE WHEN pv.voucher_type = 'receipt' THEN pv.amount ELSE 0 END), 0) as total_receipts,
      COALESCE(SUM(CASE WHEN pv.voucher_type = 'payment' THEN pv.amount ELSE 0 END), 0) as total_payments,
      COUNT(CASE WHEN pv.voucher_type = 'receipt' THEN 1 END) as receipt_count,
      COUNT(CASE WHEN pv.voucher_type = 'payment' THEN 1 END) as payment_count
    FROM payment_vouchers pv
    ${tvFilter}
  `).get(...tvParams) as any;

  const netCashMovement = (treasuryStats?.total_receipts || 0) - (treasuryStats?.total_payments || 0);

  // Overdue Receivables
  const overdueReceivables = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(remaining_amount), 0) as total
    FROM sales_invoices
    WHERE status != 'draft' AND status != 'reversed' AND remaining_amount > 0 AND due_date < CURRENT_DATE
    ${branchId ? 'AND branch_id = ?' : ''}
  `).get(...(branchId ? [branchId] : [])) as any;

  // Invoices Due in Next 7 Days
  const dueSoonReceivables = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(remaining_amount), 0) as total
    FROM sales_invoices
    WHERE status != 'draft' AND status != 'reversed' AND remaining_amount > 0
      AND due_date >= CURRENT_DATE AND due_date <= date('now', '+7 days')
    ${branchId ? 'AND branch_id = ?' : ''}
  `).get(...(branchId ? [branchId] : [])) as any;

  // 5. Section 4: Aging Breakdown (أعمار الديون)
  const agingReceivables = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN (julianday('now') - julianday(invoice_date)) <= 30 THEN remaining_amount ELSE 0 END), 0) as bucket_0_30,
      COALESCE(SUM(CASE WHEN (julianday('now') - julianday(invoice_date)) > 30 AND (julianday('now') - julianday(invoice_date)) <= 60 THEN remaining_amount ELSE 0 END), 0) as bucket_31_60,
      COALESCE(SUM(CASE WHEN (julianday('now') - julianday(invoice_date)) > 60 AND (julianday('now') - julianday(invoice_date)) <= 90 THEN remaining_amount ELSE 0 END), 0) as bucket_61_90,
      COALESCE(SUM(CASE WHEN (julianday('now') - julianday(invoice_date)) > 90 THEN remaining_amount ELSE 0 END), 0) as bucket_90_plus
    FROM sales_invoices
    WHERE status != 'draft' AND status != 'reversed' AND remaining_amount > 0
    ${branchId ? 'AND branch_id = ?' : ''}
  `).get(...(branchId ? [branchId] : [])) as any;

  const agingPayables = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN (julianday('now') - julianday(invoice_date)) <= 30 THEN remaining_amount ELSE 0 END), 0) as bucket_0_30,
      COALESCE(SUM(CASE WHEN (julianday('now') - julianday(invoice_date)) > 30 AND (julianday('now') - julianday(invoice_date)) <= 60 THEN remaining_amount ELSE 0 END), 0) as bucket_31_60,
      COALESCE(SUM(CASE WHEN (julianday('now') - julianday(invoice_date)) > 60 AND (julianday('now') - julianday(invoice_date)) <= 90 THEN remaining_amount ELSE 0 END), 0) as bucket_61_90,
      COALESCE(SUM(CASE WHEN (julianday('now') - julianday(invoice_date)) > 90 THEN remaining_amount ELSE 0 END), 0) as bucket_90_plus
    FROM purchase_invoices
    WHERE status != 'draft' AND status != 'reversed' AND remaining_amount > 0
    ${branchId ? 'AND branch_id = ?' : ''}
  `).get(...(branchId ? [branchId] : [])) as any;

  // 6. Section 5: Inventory Valuation & Stock Distribution (المخزون)
  let invValuation: number | null = null;
  if (hasViewCost) {
    let invValSql = `
      SELECT COALESCE(SUM(ws.quantity * i.moving_avg_cost), 0) as total_value
      FROM warehouse_stock ws
      JOIN items i ON ws.item_id = i.id
      JOIN warehouses w ON ws.warehouse_id = w.id
      WHERE 1=1
    `;
    const invParams: any[] = [];
    if (warehouseId) { invValSql += ' AND ws.warehouse_id = ?'; invParams.push(warehouseId); }
    if (branchId) { invValSql += ' AND w.branch_id = ?'; invParams.push(branchId); }

    const invRow = db.prepare(invValSql).get(...invParams) as { total_value: number };
    invValuation = invRow?.total_value || 0;
  }

  // Stock status counts
  const stockCounts = db.prepare(`
    SELECT 
      COUNT(DISTINCT CASE WHEN ws.quantity <= 0 THEN ws.item_id END) as out_of_stock,
      COUNT(DISTINCT CASE WHEN ws.quantity > 0 AND ws.quantity <= i.min_stock_level THEN ws.item_id END) as low_stock,
      COUNT(DISTINCT ws.item_id) as total_tracked_items
    FROM warehouse_stock ws
    JOIN items i ON ws.item_id = i.id
    JOIN warehouses w ON ws.warehouse_id = w.id
    WHERE 1=1
    ${warehouseId ? 'AND ws.warehouse_id = ?' : ''}
    ${branchId ? 'AND w.branch_id = ?' : ''}
  `).get(...[...(warehouseId ? [warehouseId] : []), ...(branchId ? [branchId] : [])]) as any;

  // Warehouses stock breakdown
  const warehouseStockDistribution = db.prepare(`
    SELECT w.id, w.name_ar, b.name_ar as branch_name,
           COUNT(DISTINCT ws.item_id) as items_count,
           COALESCE(SUM(ws.quantity), 0) as total_quantity
           ${hasViewCost ? ', COALESCE(SUM(ws.quantity * i.moving_avg_cost), 0) as valuation' : ''}
    FROM warehouses w
    JOIN branches b ON w.branch_id = b.id
    LEFT JOIN warehouse_stock ws ON w.id = ws.warehouse_id
    LEFT JOIN items i ON ws.item_id = i.id
    ${branchId ? 'WHERE w.branch_id = ?' : ''}
    GROUP BY w.id
    ORDER BY w.code ASC
  `).all(...(branchId ? [branchId] : []));

  // 7. Section 6: Profitability (الربحية والتكاليف)
  let cogsAmount: number | null = null;
  let grossProfit: number | null = null;
  let profitMargin: number | null = null;
  let netProfit: number | null = null;

  let opexFilter = "WHERE jel.account_id IN ('acc_6111', 'acc_6211', 'acc_6311', 'acc_6411', 'acc_6412', 'acc_6511', 'acc_6611') AND je.status = 'posted'";
  const opexParams: any[] = [];
  if (fromDate) { opexFilter += ' AND je.entry_date >= ?'; opexParams.push(fromDate); }
  if (toDate) { opexFilter += ' AND je.entry_date <= ?'; opexParams.push(toDate); }
  if (branchId) { opexFilter += ' AND je.branch_id = ?'; opexParams.push(branchId); }

  const opexRow = db.prepare(`
    SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as total
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    ${opexFilter}
  `).get(...opexParams) as { total: number };
  const operatingExpenses = opexRow?.total || 0;

  if (hasViewCost) {
    let cogsFilter = "WHERE jel.account_id IN ('acc_5111', 'acc_5112', 'acc_5211') AND je.status = 'posted'";
    const cogsParams: any[] = [];
    if (fromDate) { cogsFilter += ' AND je.entry_date >= ?'; cogsParams.push(fromDate); }
    if (toDate) { cogsFilter += ' AND je.entry_date <= ?'; cogsParams.push(toDate); }
    if (branchId) { cogsFilter += ' AND je.branch_id = ?'; cogsParams.push(branchId); }

    const cogsRow = db.prepare(`
      SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.entry_id = je.id
      ${cogsFilter}
    `).get(...cogsParams) as { total: number };
    cogsAmount = cogsRow?.total || 0;

    if (hasViewProfit) {
      grossProfit = netSalesAmount - cogsAmount;
      profitMargin = netSalesAmount > 0 ? (grossProfit / netSalesAmount) * 100 : 0;
      netProfit = grossProfit - operatingExpenses;
    }
  }

  // 8. Section 7: Monitoring & Pending Drafts (المتابعة والمسودات)
  const pendingDrafts = {
    salesInvoices: db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total 
      FROM sales_invoices WHERE status = 'draft' ${branchId ? 'AND branch_id = ?' : ''}
    `).get(...(branchId ? [branchId] : [])) as { count: number; total: number },

    purchaseInvoices: db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total 
      FROM purchase_invoices WHERE status = 'draft' ${branchId ? 'AND branch_id = ?' : ''}
    `).get(...(branchId ? [branchId] : [])) as { count: number; total: number },

    salesReturns: db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total 
      FROM sales_returns WHERE status = 'draft' ${branchId ? 'AND branch_id = ?' : ''}
    `).get(...(branchId ? [branchId] : [])) as { count: number; total: number },

    purchaseReturns: db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total 
      FROM purchase_returns WHERE status = 'draft' ${branchId ? 'AND branch_id = ?' : ''}
    `).get(...(branchId ? [branchId] : [])) as { count: number; total: number },

    journalEntries: db.prepare(`
      SELECT COUNT(*) as count 
      FROM journal_entries WHERE status = 'draft' ${branchId ? 'AND branch_id = ?' : ''}
    `).get(...(branchId ? [branchId] : [])) as { count: number }
  };

  // Operational Actionable Alerts
  const alerts: { id: string; type: 'warning' | 'danger' | 'info'; title: string; count: number; message: string; targetTab: string }[] = [];
  if (stockCounts?.out_of_stock > 0) {
    alerts.push({
      id: 'out_of_stock',
      type: 'danger',
      title: 'أصناف نفدت تماماً من المخزون',
      count: stockCounts.out_of_stock,
      message: `يوجد (${stockCounts.out_of_stock}) صنف رصيده صفر ويحتاج إلى إصدار أمر شراء توريد فوري.`,
      targetTab: 'inventory'
    });
  }
  if (stockCounts?.low_stock > 0) {
    alerts.push({
      id: 'low_stock',
      type: 'warning',
      title: 'أصناف بلغت حد إعادة الطلب الأدنى',
      count: stockCounts.low_stock,
      message: `يوجد (${stockCounts.low_stock}) صنف اقترب من النفاد ويجب تجديد كمياته بالمخازن.`,
      targetTab: 'inventory'
    });
  }
  if (overdueReceivables?.count > 0) {
    alerts.push({
      id: 'overdue_invoices',
      type: 'danger',
      title: 'فواتير مبيعات تجاوزت تاريخ الاستحقاق',
      count: overdueReceivables.count,
      message: `يوجد (${overdueReceivables.count}) فاتورة مستحقة للتحصيل بإجمالي ${overdueReceivables.total.toLocaleString()} ج.م متأخرة السداد.`,
      targetTab: 'sales'
    });
  }
  const totalPendingDraftCount = (pendingDrafts.salesInvoices.count + pendingDrafts.purchaseInvoices.count + pendingDrafts.salesReturns.count + pendingDrafts.purchaseReturns.count + pendingDrafts.journalEntries.count);
  if (totalPendingDraftCount > 0) {
    alerts.push({
      id: 'pending_drafts',
      type: 'info',
      title: 'مسودات قيد المراجعة والاعتماد',
      count: totalPendingDraftCount,
      message: `يوجد (${totalPendingDraftCount}) مستند في وضع المسودة بانتظار المراجعة والترحيل للأستاذ العام والمخازن.`,
      targetTab: 'journal'
    });
  }

  // 9. Comparative Previous Period Metrics
  let comparison: any = null;
  if (prevFromDate && prevToDate) {
    const prevSales = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as total FROM sales_invoices
      WHERE status != 'draft' AND status != 'reversed' AND invoice_date >= ? AND invoice_date <= ?
      ${branchId ? 'AND branch_id = ?' : ''}
    `).get(...[prevFromDate, prevToDate, ...(branchId ? [branchId] : [])]) as any;

    const prevPur = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as total FROM purchase_invoices
      WHERE status != 'draft' AND status != 'reversed' AND invoice_date >= ? AND invoice_date <= ?
      ${branchId ? 'AND branch_id = ?' : ''}
    `).get(...[prevFromDate, prevToDate, ...(branchId ? [branchId] : [])]) as any;

    const prevSalesTotal = prevSales?.total || 0;
    const prevPurTotal = prevPur?.total || 0;

    const calcDelta = (curr: number, prev: number) => {
      const diff = curr - prev;
      const pct = prev > 0 ? ((diff / prev) * 100) : (curr > 0 ? 100 : 0);
      return { current: curr, previous: prev, diff, percent: Math.round(pct * 10) / 10 };
    };

    comparison = {
      prevPeriod: { fromDate: prevFromDate, toDate: prevToDate },
      sales: calcDelta(salesStats?.total_gross || 0, prevSalesTotal),
      purchases: calcDelta(purStats?.total_gross || 0, prevPurTotal)
    };
  }

  // 10. Monthly Trend Chart
  const monthlyTrend = db.prepare(`
    SELECT strftime('%Y-%m', entry_date) as month,
           ROUND(SUM(credit - debit), 2) as revenue
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    WHERE jel.account_id IN ('acc_4111', 'acc_4112') AND je.status = 'posted'
    ${branchId ? 'AND je.branch_id = ?' : ''}
    GROUP BY month
    ORDER BY month ASC
    LIMIT 12
  `).all(...(branchId ? [branchId] : []));

  // Recent Invoices & Entries
  const recentInvoices = db.prepare(`
    SELECT si.*, p.name_ar as customer_name, b.name_ar as branch_name
    FROM sales_invoices si
    JOIN parties p ON si.customer_id = p.id
    JOIN branches b ON si.branch_id = b.id
    ${branchId ? 'WHERE si.branch_id = ?' : ''}
    ORDER BY si.created_at DESC
    LIMIT 6
  `).all(...(branchId ? [branchId] : []));

  const recentEntries = db.prepare(`
    SELECT je.*, b.name_ar as branch_name
    FROM journal_entries je
    JOIN branches b ON je.branch_id = b.id
    ${branchId ? 'WHERE je.branch_id = ?' : ''}
    ORDER BY je.created_at DESC
    LIMIT 6
  `).all(...(branchId ? [branchId] : []));

  // Full Composite Response Payload
  res.json({
    metadata: {
      currency: 'EGP',
      currencyAr: 'جنيه مصري',
      lastUpdated: new Date().toISOString(),
      filters: {
        fromDate,
        toDate,
        branchId: branchId || 'all',
        warehouseId: warehouseId || 'all'
      },
      hasViewCost,
      hasViewProfit
    },
    kpis: {
      cashLiquidity: canViewTreasury ? cashTotal.balance : null,
      receivables: canViewParties ? receivables.balance : null,
      payables: canViewParties ? payables.balance : null,
      inventoryValuation: invValuation,
      netSales: canViewSales ? netSalesAmount : null,
      grossProfit,
      profitMargin,
      operatingExpenses: hasViewCost ? operatingExpenses : null,
      netProfit
    },
    sections: {
      sales: canViewSales ? {
        invoiceCount: salesStats?.invoice_count || 0,
        grossTotal: salesStats?.total_gross || 0,
        returnsCount: returnsStats?.return_count || 0,
        returnsTotal: returnsStats?.total_returns || 0,
        netSales: netSalesAmount,
        averageInvoiceValue: avgInvoiceValue,
        paidTotal: salesStats?.paid_total || 0,
        remainingTotal: salesStats?.remaining_total || 0,
        topCustomers,
        topItems
      } : null,
      purchases: canViewPurchases ? {
        invoiceCount: purStats?.invoice_count || 0,
        grossTotal: purStats?.total_gross || 0,
        returnsCount: purReturnsStats?.return_count || 0,
        returnsTotal: purReturnsStats?.total_returns || 0,
        netPurchases: netPurchasesAmount,
        paidTotal: purStats?.paid_total || 0,
        remainingTotal: purStats?.remaining_total || 0,
        topSuppliers
      } : null,
      treasury: canViewTreasury ? {
        receiptsCount: treasuryStats?.receipt_count || 0,
        receiptsTotal: treasuryStats?.total_receipts || 0,
        paymentsCount: treasuryStats?.payment_count || 0,
        paymentsTotal: treasuryStats?.total_payments || 0,
        netCashMovement,
        overdueReceivablesCount: overdueReceivables?.count || 0,
        overdueReceivablesTotal: overdueReceivables?.total || 0,
        dueSoonReceivablesCount: dueSoonReceivables?.count || 0,
        dueSoonReceivablesTotal: dueSoonReceivables?.total || 0
      } : null,
      partiesAging: canViewParties ? {
        receivablesBalance: receivables.balance,
        payablesBalance: payables.balance,
        receivablesAging: agingReceivables,
        payablesAging: agingPayables
      } : null,
      inventory: {
        valuation: invValuation,
        outOfStockCount: stockCounts?.out_of_stock || 0,
        lowStockCount: stockCounts?.low_stock || 0,
        totalTrackedItems: stockCounts?.total_tracked_items || 0,
        warehouseDistribution: warehouseStockDistribution
      },
      profitability: hasViewProfit ? {
        netSales: canViewSales ? netSalesAmount : null,
        cogs: cogsAmount,
        grossProfit,
        profitMargin,
        operatingExpenses,
        netProfit
      } : null,
      monitoring: {
        pendingDrafts,
        alerts
      },
      actionRequired: (() => {
        const todayStr = new Date().toISOString().split('T')[0];
        const overdueSales = db.prepare(`
          SELECT COUNT(*) as count, COALESCE(SUM(remaining_amount), 0) as total
          FROM sales_invoices
          WHERE status != 'draft' AND status != 'cancelled' AND remaining_amount > 0.01 AND due_date < ?
          ${branchId ? 'AND branch_id = ?' : ''}
        `).get(...[todayStr, ...(branchId ? [branchId] : [])]) as any;

        const overduePurchases = db.prepare(`
          SELECT COUNT(*) as count, COALESCE(SUM(remaining_amount), 0) as total
          FROM purchase_invoices
          WHERE status != 'draft' AND status != 'cancelled' AND remaining_amount > 0.01 AND due_date < ?
          ${branchId ? 'AND branch_id = ?' : ''}
        `).get(...[todayStr, ...(branchId ? [branchId] : [])]) as any;

        const unallocVouchers = db.prepare(`
          SELECT COUNT(*) as count, COALESCE(SUM(unallocated_amount), 0) as total
          FROM payment_vouchers
          WHERE status = 'posted' AND unallocated_amount > 0.01
          ${branchId ? 'AND branch_id = ?' : ''}
        `).get(...(branchId ? [branchId] : [])) as any;

        const dSales = db.prepare(`SELECT COUNT(*) as cnt FROM sales_invoices WHERE status = 'draft' ${branchId ? 'AND branch_id = ?' : ''}`).get(...(branchId ? [branchId] : [])) as any;
        const dPur = db.prepare(`SELECT COUNT(*) as cnt FROM purchase_invoices WHERE status = 'draft' ${branchId ? 'AND branch_id = ?' : ''}`).get(...(branchId ? [branchId] : [])) as any;
        const dSRet = db.prepare(`SELECT COUNT(*) as cnt FROM sales_returns WHERE status = 'draft' ${branchId ? 'AND branch_id = ?' : ''}`).get(...(branchId ? [branchId] : [])) as any;
        const dPRet = db.prepare(`SELECT COUNT(*) as cnt FROM purchase_returns WHERE status = 'draft' ${branchId ? 'AND branch_id = ?' : ''}`).get(...(branchId ? [branchId] : [])) as any;
        const dJe = db.prepare(`SELECT COUNT(*) as cnt FROM journal_entries WHERE status = 'draft' ${branchId ? 'AND branch_id = ?' : ''}`).get(...(branchId ? [branchId] : [])) as any;

        const lowStockRows = db.prepare(`
          SELECT i.id
          FROM items i
          JOIN warehouse_stock ws ON i.id = ws.item_id
          WHERE i.item_type = 'stock' AND i.is_active = 1
            ${warehouseId ? 'AND ws.warehouse_id = ?' : ''}
          GROUP BY i.id
          HAVING SUM(ws.quantity) <= i.min_stock_level
        `).all(...(warehouseId ? [warehouseId] : []));

        const draftSalesCnt = dSales?.cnt || 0;
        const draftPurCnt = dPur?.cnt || 0;
        const draftRetCnt = (dSRet?.cnt || 0) + (dPRet?.cnt || 0);
        const draftJeCnt = dJe?.cnt || 0;

        return {
          overdueSalesCount: overdueSales?.count || 0,
          overdueSalesTotal: overdueSales?.total || 0,
          overduePurchasesCount: overduePurchases?.count || 0,
          overduePurchasesTotal: overduePurchases?.total || 0,
          unallocatedVouchersCount: unallocVouchers?.count || 0,
          unallocatedVouchersTotal: unallocVouchers?.total || 0,
          draftsTotalCount: draftSalesCnt + draftPurCnt + draftRetCnt + draftJeCnt,
          draftSalesCount: draftSalesCnt,
          draftPurchasesCount: draftPurCnt,
          draftReturnsCount: draftRetCnt,
          draftJournalsCount: draftJeCnt,
          lowStockItemsCount: lowStockRows.length
        };
      })()
    },
    comparison,
    monthlyTrend,
    recentInvoices,
    recentEntries
  });
});

// ----------------------------------------------------
// 5. Chart of Accounts & GL Entries
// ----------------------------------------------------
apiRouter.get('/accounts', requireAuth, requirePermission('accounts.view'), (req, res) => {
  const accounts = db.prepare(`
    SELECT a.*,
      COALESCE((
        SELECT ROUND(SUM(
          CASE 
            WHEN a.nature = 'debit' THEN (jel.debit - jel.credit)
            ELSE (jel.credit - jel.debit)
          END
        ), 2)
        FROM journal_entry_lines jel
        JOIN journal_entries je ON jel.entry_id = je.id
        WHERE jel.account_id = a.id AND je.status = 'posted'
      ), 0) as current_balance
    FROM accounts a
    ORDER BY a.code ASC
  `).all();

  res.json({ accounts });
});

// Helper: Prevent cyclic hierarchy in Chart of Accounts tree
function isAccountDescendant(childCandidateId: string, ancestorId: string): boolean {
  let currentId: string | null = childCandidateId;
  const visited = new Set<string>();
  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    if (currentId === ancestorId) return true;
    const parentRow = db.prepare('SELECT parent_id FROM accounts WHERE id = ?').get(currentId) as { parent_id: string | null } | undefined;
    currentId = parentRow ? parentRow.parent_id : null;
  }
  return false;
}

apiRouter.post('/accounts', requireAuth, requirePermission('accounts.create', 'manage_settings'), (req: AuthenticatedRequest, res) => {
  let { code, name_ar, name_en, parent_id, account_type, nature, is_group, notes } = req.body;
  if (!name_ar || typeof name_ar !== 'string' || !name_ar.trim()) {
    return res.status(400).json({ error: 'اسم الحساب باللغة العربية مطلوب.' });
  }

  let calculatedLevel = 1;
  let effectiveType = account_type;
  let effectiveNature = nature;

  try {
    let finalCode = '';
    let id = '';

    db.transaction(() => {
      if (parent_id) {
        const parent = db.prepare('SELECT id, code, level, is_group, account_type, nature FROM accounts WHERE id = ?').get(parent_id) as any;
        if (!parent) {
          throw new Error('الحساب الرئيسي المحدد غير موجود.');
        }
        if (parent.is_group === 0) {
          throw new Error('لا يمكن إضافة حساب فرعي إلا تحت حساب رئيسي (مجموعة).');
        }
        calculatedLevel = (parent.level || 1) + 1;
        if (!effectiveType) effectiveType = parent.account_type;
        if (!effectiveNature) effectiveNature = parent.nature;

        // Auto-generate code using account_sequences (monotonic, avoids reusing deleted codes)
        if (!code || typeof code !== 'string' || !code.trim()) {
          const seqKey = `parent_${parent.id}`;
          let digitsCount = parent.level >= 3 ? 2 : 1;

          const siblings = db.prepare('SELECT code FROM accounts WHERE parent_id = ?').all(parent_id) as { code: string }[];
          for (const s of siblings) {
            if (s.code.startsWith(parent.code)) {
              const suf = s.code.slice(parent.code.length);
              if (suf.length > digitsCount) digitsCount = suf.length;
            }
          }

          let seqRow = db.prepare('SELECT last_number FROM account_sequences WHERE sequence_key = ?').get(seqKey) as { last_number: number } | undefined;
          let nextNum = 1;

          if (!seqRow) {
            let maxFound = 0;
            for (const s of siblings) {
              if (s.code.startsWith(parent.code)) {
                const n = parseInt(s.code.slice(parent.code.length), 10);
                if (!isNaN(n) && n > maxFound) maxFound = n;
              }
            }
            nextNum = maxFound + 1;
            db.prepare('INSERT INTO account_sequences (sequence_key, last_number) VALUES (?, ?)').run(seqKey, nextNum);
          } else {
            nextNum = seqRow.last_number + 1;
            db.prepare('UPDATE account_sequences SET last_number = ? WHERE sequence_key = ?').run(nextNum, seqKey);
          }

          let candidate = `${parent.code}${nextNum.toString().padStart(digitsCount, '0')}`;
          while (db.prepare('SELECT id FROM accounts WHERE code = ?').get(candidate)) {
            nextNum++;
            db.prepare('UPDATE account_sequences SET last_number = ? WHERE sequence_key = ?').run(nextNum, seqKey);
            candidate = `${parent.code}${nextNum.toString().padStart(digitsCount, '0')}`;
          }
          finalCode = candidate;
        } else {
          finalCode = code.trim();
        }
      } else {
        // Root Account Level 1
        if (!effectiveType) effectiveType = 'expense';
        if (!effectiveNature) {
          effectiveNature = ['asset', 'expense', 'cogs'].includes(effectiveType) ? 'debit' : 'credit';
        }

        if (!code || typeof code !== 'string' || !code.trim()) {
          const rootMap: Record<string, string> = {
            asset: '1',
            liability: '2',
            equity: '3',
            revenue: '4',
            cogs: '5',
            expense: '6'
          };
          const rootDigit = rootMap[effectiveType] || '1';
          const seqKey = `root_${effectiveType}`;

          let seqRow = db.prepare('SELECT last_number FROM account_sequences WHERE sequence_key = ?').get(seqKey) as { last_number: number } | undefined;
          let nextNum = 1;

          if (!seqRow) {
            const roots = db.prepare("SELECT code FROM accounts WHERE parent_id IS NULL AND code LIKE ?").all(`${rootDigit}%`) as { code: string }[];
            let maxRoot = parseInt(rootDigit, 10);
            for (const r of roots) {
              const n = parseInt(r.code, 10);
              if (!isNaN(n) && n > maxRoot) maxRoot = n;
            }
            nextNum = maxRoot + 1;
            db.prepare('INSERT INTO account_sequences (sequence_key, last_number) VALUES (?, ?)').run(seqKey, nextNum);
          } else {
            nextNum = seqRow.last_number + 1;
            db.prepare('UPDATE account_sequences SET last_number = ? WHERE sequence_key = ?').run(nextNum, seqKey);
          }

          let candidate = nextNum.toString();
          while (db.prepare('SELECT id FROM accounts WHERE code = ?').get(candidate)) {
            nextNum++;
            db.prepare('UPDATE account_sequences SET last_number = ? WHERE sequence_key = ?').run(nextNum, seqKey);
            candidate = nextNum.toString();
          }
          finalCode = candidate;
        } else {
          finalCode = code.trim();
        }
      }

      // Check code uniqueness
      const existing = db.prepare('SELECT id FROM accounts WHERE code = ?').get(finalCode);
      if (existing) {
        throw new Error(`كود الحساب "${finalCode}" مسجل مسبقاً في دليل الحسابات.`);
      }

      id = `acc_${finalCode.replace(/[^0-9a-zA-Z_]/g, '')}_${Date.now().toString(36).slice(-4)}`;
      db.prepare(`
        INSERT INTO accounts (id, code, name_ar, name_en, parent_id, account_type, nature, is_group, level, is_active, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(id, finalCode, name_ar.trim(), name_en ? name_en.trim() : name_ar.trim(), parent_id || null, effectiveType, effectiveNature, is_group ? 1 : 0, calculatedLevel, notes || null);
    })();

    logAudit(req.user!.id, 'CREATE_ACCOUNT', 'accounts', id, `إضافة حساب جديد: ${finalCode} - ${name_ar}`);
    res.json({ success: true, id, code: finalCode, message: `تمت إضافة الحساب "${name_ar}" برقم (${finalCode}) بنجاح.` });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.put('/accounts/:id', requireAuth, requirePermission('accounts.edit', 'manage_settings'), (req: AuthenticatedRequest, res) => {
  const targetId = req.params.id;
  const target = db.prepare('SELECT * FROM accounts WHERE id = ?').get(targetId) as any;
  if (!target) return res.status(404).json({ error: 'الحساب غير موجود' });

  const { name_ar, name_en, parent_id, is_group, is_active, notes } = req.body;

  // Validate Parent Cycle
  if (parent_id !== undefined && parent_id !== target.parent_id) {
    if (parent_id === targetId) {
      return res.status(400).json({ error: 'لا يمكن للحساب أن يكون أصلاً لنفسه في شجرة الحسابات.' });
    }
    if (parent_id && isAccountDescendant(parent_id, targetId)) {
      return res.status(400).json({ error: 'تنبيه دورة حلقية: لا يمكن نقل هذا الحساب ليصبح تابعاً لأحد الحسابات الفرعية المنبثقة منه.' });
    }
  }

  // Validate Group status change
  if (is_group !== undefined && is_group !== target.is_group) {
    if (is_group === 0) {
      const childCount = db.prepare('SELECT COUNT(*) as cnt FROM accounts WHERE parent_id = ?').get(targetId) as { cnt: number };
      if (childCount.cnt > 0) {
        return res.status(400).json({ error: `لا يمكن تحويل الحساب التجميعي إلى فرعي لوجود (${childCount.cnt}) حسابات فرعية منبثقة منه.` });
      }
    } else {
      const txCount = db.prepare('SELECT COUNT(*) as cnt FROM journal_entry_lines WHERE account_id = ?').get(targetId) as { cnt: number };
      if (txCount.cnt > 0) {
        return res.status(400).json({ error: `لا يمكن تحويل حساب مسجل عليه حركات مالية (${txCount.cnt} حركة) إلى حساب تجميعي.` });
      }
    }
  }

  try {
    let newLevel = target.level;
    if (parent_id !== undefined && parent_id !== target.parent_id) {
      if (parent_id) {
        const p = db.prepare('SELECT level FROM accounts WHERE id = ?').get(parent_id) as any;
        newLevel = p ? p.level + 1 : 2;
      } else {
        newLevel = 1;
      }
    }

    db.prepare(`
      UPDATE accounts
      SET name_ar = COALESCE(?, name_ar),
          name_en = COALESCE(?, name_en),
          parent_id = CASE WHEN ? IS NOT NULL THEN ? ELSE parent_id END,
          is_group = COALESCE(?, is_group),
          level = ?,
          is_active = COALESCE(?, is_active),
          notes = COALESCE(?, notes)
      WHERE id = ?
    `).run(
      name_ar || null,
      name_en || null,
      parent_id !== undefined ? 1 : null,
      parent_id || null,
      is_group !== undefined ? (is_group ? 1 : 0) : null,
      newLevel,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      notes || null,
      targetId
    );

    logAudit(req.user!.id, 'UPDATE_ACCOUNT', 'accounts', targetId, `تعديل الحساب: ${target.code} - ${name_ar || target.name_ar}`);
    res.json({ success: true, message: 'تم تحديث بيانات الحساب بنجاح.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/accounts/:id', requireAuth, requirePermission('accounts.delete', 'manage_settings'), (req: AuthenticatedRequest, res) => {
  const targetId = req.params.id;
  const target = db.prepare('SELECT * FROM accounts WHERE id = ?').get(targetId) as any;
  if (!target) return res.status(404).json({ error: 'الحساب غير موجود' });

  // 1. Check child accounts
  const childCount = db.prepare('SELECT COUNT(*) as cnt FROM accounts WHERE parent_id = ?').get(targetId) as { cnt: number };
  if (childCount.cnt > 0) {
    return res.status(400).json({ error: `لا يمكن حذف هذا الحساب لأنه حساب رئيسي تتبعه (${childCount.cnt}) حسابات فرعية. قم بحذف أو نقل الحسابات الفرعية أولاً.` });
  }

  // 2. Check journal entry transactions
  const txCount = db.prepare('SELECT COUNT(*) as cnt FROM journal_entry_lines WHERE account_id = ?').get(targetId) as { cnt: number };
  if (txCount.cnt > 0) {
    return res.status(400).json({ error: `لا يمكن حذف هذا الحساب نهائياً لوجود (${txCount.cnt}) قيود وحركات مالية مرحلة عليه. يمكنك تعطيل الحساب بدلاً من حذفه للحفاظ على التوازن والأثر التاريخي.` });
  }

  // 3. Check system configuration references
  const cashboxCheck = db.prepare('SELECT COUNT(*) as cnt FROM cash_boxes WHERE account_id = ?').get(targetId) as { cnt: number };
  const bankCheck = db.prepare('SELECT COUNT(*) as cnt FROM bank_accounts WHERE account_id = ?').get(targetId) as { cnt: number };
  const partyCheck = db.prepare('SELECT COUNT(*) as cnt FROM parties WHERE account_id = ?').get(targetId) as { cnt: number };
  const assetCheck = db.prepare('SELECT COUNT(*) as cnt FROM fixed_assets WHERE asset_account_id = ? OR depreciation_expense_account_id = ? OR accumulated_depreciation_account_id = ?').get(targetId, targetId, targetId) as { cnt: number };

  if (cashboxCheck.cnt > 0 || bankCheck.cnt > 0 || partyCheck.cnt > 0 || assetCheck.cnt > 0 || target.is_reconciliation === 1) {
    return res.status(400).json({ error: 'لا يمكن حذف هذا الحساب لأنه مربوط بالخزائن، البنوك، أطراف التعامل، الأصول الثابتة، أو معرف كحساب رقابة أساسي.' });
  }

  try {
    db.prepare('DELETE FROM accounts WHERE id = ?').run(targetId);
    logAudit(req.user!.id, 'DELETE_ACCOUNT', 'accounts', targetId, `حذف الحساب: ${target.code} - ${target.name_ar}`);
    res.json({ success: true, message: `تم حذف الحساب "${target.name_ar}" بنجاح.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/journal-entries', requireAuth, requirePermission('journal.view'), (req: AuthenticatedRequest, res) => {
  const { status, docType, fromDate, toDate, branchId } = req.query;

  let query = `
    SELECT je.*, b.name_ar as branch_name, fp.name_ar as period_name
    FROM journal_entries je
    JOIN branches b ON je.branch_id = b.id
    JOIN fiscal_periods fp ON je.fiscal_period_id = fp.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (status) {
    query += ' AND je.status = ?';
    params.push(status);
  }
  if (docType) {
    query += ' AND je.doc_type = ?';
    params.push(docType);
  }
  if (fromDate) {
    query += ' AND je.entry_date >= ?';
    params.push(fromDate);
  }
  if (toDate) {
    query += ' AND je.entry_date <= ?';
    params.push(toDate);
  }
  if (branchId && branchId !== 'all') {
    query += ' AND je.branch_id = ?';
    params.push(branchId);
  }

  query += ' ORDER BY je.entry_date DESC, je.entry_number DESC LIMIT 200';

  const entries = db.prepare(query).all(...params);
  res.json({ entries });
});

apiRouter.get('/journal-entries/:id', requireAuth, requirePermission('journal.view'), (req: AuthenticatedRequest, res) => {
  const entry = db.prepare(`
    SELECT je.*, b.name_ar as branch_name, fp.name_ar as period_name
    FROM journal_entries je
    JOIN branches b ON je.branch_id = b.id
    JOIN fiscal_periods fp ON je.fiscal_period_id = fp.id
    WHERE je.id = ?
  `).get(req.params.id) as any;

  if (!entry) {
    return res.status(404).json({ error: 'القيد المحاسبي غير موجود.' });
  }

  const lines = db.prepare(`
    SELECT jel.*, a.code as account_code, a.name_ar as account_name,
           p.name_ar as party_name, cc.name_ar as cost_center_name
    FROM journal_entry_lines jel
    JOIN accounts a ON jel.account_id = a.id
    LEFT JOIN parties p ON jel.party_id = p.id
    LEFT JOIN cost_centers cc ON jel.cost_center_id = cc.id
    WHERE jel.entry_id = ?
    ORDER BY jel.line_number ASC
  `).all(req.params.id);

  entry.lines = lines;
  res.json({ entry });
});

apiRouter.post('/journal-entries', requireAuth, (req: AuthenticatedRequest, res) => {
  if (checkIdempotency(req, res)) return;

  try {
    const { docType, entryDate, postingDate, branchId, description, lines, status } = req.body;
    if (!branchId || !isBranchAllowed(req.user, branchId)) {
      return res.status(403).json({ error: 'غير مصرح لك بالعمل على قيود في هذا الفرع.' });
    }

    const isDraft = status === 'draft';
    if (!isDraft) {
      if (!req.user?.role || (req.user.role !== 'owner' && !req.user.permissions.includes('post') && !req.user.permissions.includes('journal.post'))) {
        return res.status(403).json({ error: 'لا تملك صلاحية ترحيل القيود اليومية (post).' });
      }
    } else {
      if (!req.user?.role || (req.user.role !== 'owner' && !req.user.permissions.includes('edit_draft') && !req.user.permissions.includes('add') && !req.user.permissions.includes('journal.create'))) {
        return res.status(403).json({ error: 'لا تملك صلاحية إنشاء مسودات القيود اليومية.' });
      }
    }

    if (isDraft) {
      // Save as draft without ledger balance impact
      const effDate = entryDate || new Date().toISOString().split('T')[0];
      const period = getFiscalPeriodForDate(effDate);
      const entryId = `je_draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const entryNumber = getNextDocumentNumber('JV-DFT', branchId, period.fiscal_year_id);

      let totalDebit = new Decimal(0);
      let totalCredit = new Decimal(0);
      if (Array.isArray(lines)) {
        for (const l of lines) {
          totalDebit = totalDebit.plus(new Decimal(l.debit || 0));
          totalCredit = totalCredit.plus(new Decimal(l.credit || 0));
        }
      }

      db.transaction(() => {
        db.prepare(`
          INSERT INTO journal_entries (
            id, entry_number, doc_type, doc_id, doc_number, entry_date, posting_date,
            fiscal_period_id, branch_id, status, description, total_debit, total_credit,
            currency_code, exchange_rate, created_by, is_system_generated
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, 'EGP', 1.0, ?, 0)
        `).run(
          entryId, entryNumber, docType || 'MANUAL', null, null, effDate, effDate,
          period.id, branchId, description || 'مسودة قيد يومية',
          totalDebit.toNumber(), totalCredit.toNumber(), req.user!.id
        );

        if (Array.isArray(lines)) {
          const insertLine = db.prepare(`
            INSERT INTO journal_entry_lines (
              id, entry_id, line_number, account_id, party_id, cost_center_id,
              debit, credit, description, currency_code, exchange_rate, amount_currency
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EGP', 1.0, ?)
          `);
          let lineNo = 1;
          for (const l of lines) {
            const d = new Decimal(l.debit || 0).toNumber();
            const c = new Decimal(l.credit || 0).toNumber();
            insertLine.run(
              `jel_dft_${Date.now()}_${lineNo}`, entryId, lineNo++, l.accountId || null,
              l.partyId || null, l.costCenterId || null, d, c, l.description || description || '', d > 0 ? d : c
            );
          }
        }
      })();

      logAudit(req.user!.id, 'CREATE_DRAFT_JOURNAL', 'journal_entries', entryId, `إنشاء مسودة قيد يومية برقم ${entryNumber}`);
      const responseData = { success: true, entryId, entryNumber, status: 'draft', message: 'تم حفظ مسودة القيد بنجاح دون أي أثر على الأستاذ.' };
      saveIdempotency(req.headers['idempotency-key'] as string, req.user!.id, '/journal-entries', 200, responseData, req.body);
      return res.json(responseData);
    }

    // Direct Post
    const result = postJournalEntry({
      docType: docType || 'MANUAL',
      entryDate: entryDate || new Date().toISOString().split('T')[0],
      postingDate: postingDate || entryDate || new Date().toISOString().split('T')[0],
      branchId,
      description,
      createdBy: req.user!.id,
      lines
    });

    const responseData = { success: true, ...result, status: 'posted' };
    saveIdempotency(req.headers['idempotency-key'] as string, req.user!.id, '/journal-entries', 200, responseData, req.body);
    res.json(responseData);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.put('/journal-entries/:id', requireAuth, requirePermission('journal.edit_draft'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'القيد غير موجود.' });

  if (target.status !== 'draft') {
    return res.status(400).json({ error: 'لا يمكن تعديل القيود بعد ترحيلها مباشرة. التعديل متاح للمسودات فقط.' });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له مسودة القيد خارج نطاق الفروع المصرح لك بها.' });
  }

  const { entryDate, description, branchId, lines } = req.body;
  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'يجب إدخال بنود القيد.' });
  }

  if (branchId && !isBranchAllowed(req.user, branchId)) {
    return res.status(403).json({ error: 'الفرع المحدد خارج نطاق الفروع المصرح لك بها.' });
  }

  try {
    let totalDebit = new Decimal(0);
    let totalCredit = new Decimal(0);
    for (const l of lines) {
      totalDebit = totalDebit.plus(new Decimal(l.debit || 0));
      totalCredit = totalCredit.plus(new Decimal(l.credit || 0));
    }

    db.transaction(() => {
      db.prepare(`
        UPDATE journal_entries
        SET entry_date = COALESCE(?, entry_date),
            posting_date = COALESCE(?, posting_date),
            description = COALESCE(?, description),
            branch_id = COALESCE(?, branch_id),
            total_debit = ?,
            total_credit = ?
        WHERE id = ?
      `).run(entryDate || null, entryDate || null, description || null, branchId || null, totalDebit.toNumber(), totalCredit.toNumber(), target.id);

      db.prepare('DELETE FROM journal_entry_lines WHERE entry_id = ?').run(target.id);
      const insertLine = db.prepare(`
        INSERT INTO journal_entry_lines (
          id, entry_id, line_number, account_id, party_id, cost_center_id,
          debit, credit, description, currency_code, exchange_rate, amount_currency
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EGP', 1.0, ?)
      `);

      let lineNo = 1;
      for (const l of lines) {
        const d = new Decimal(l.debit || 0).toNumber();
        const c = new Decimal(l.credit || 0).toNumber();
        insertLine.run(
          `jel_${Date.now()}_${lineNo}`, target.id, lineNo++, l.accountId || null,
          l.partyId || null, l.costCenterId || null, d, c, l.description || description || '', d > 0 ? d : c
        );
      }
    })();

    logAudit(req.user!.id, 'UPDATE_DRAFT_JOURNAL', 'journal_entries', target.id, `تعديل مسودة القيد ${target.entry_number}`);
    res.json({ success: true, message: 'تم تحديث مسودة القيد بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/journal-entries/:id', requireAuth, requirePermission('journal.delete_draft'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'القيد غير موجود.' });

  if (target.status !== 'draft') {
    return res.status(400).json({ error: 'لا يمكن حذف القيد بعد ترحيله مباشرة. التصحيح يتم بالقيد العكسي.' });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له مسودة القيد خارج نطاق الفروع المصرح لك بها.' });
  }

  try {
    db.transaction(() => {
      db.prepare('DELETE FROM journal_entry_lines WHERE entry_id = ?').run(target.id);
      db.prepare('DELETE FROM journal_entries WHERE id = ?').run(target.id);
    })();

    logAudit(req.user!.id, 'DELETE_DRAFT_JOURNAL', 'journal_entries', target.id, `حذف مسودة القيد ${target.entry_number}`);
    res.json({ success: true, message: `تم حذف مسودة القيد "${target.entry_number}" بنجاح.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/journal-entries/:id/post', requireAuth, requirePermission('journal.post'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'القيد غير موجود.' });

  if (target.status !== 'draft') {
    return res.status(400).json({ error: `القيد حالته الحالية (${target.status}) ولا يمكن إعادة ترحيله.` });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له القيد خارج نطاق الفروع المصرح لك بها.' });
  }

  const lines = db.prepare('SELECT * FROM journal_entry_lines WHERE entry_id = ?').all(target.id) as any[];
  if (!lines || lines.length < 2) {
    return res.status(400).json({ error: 'يجب أن يحتوي القيد على طرفين على الأقل للترحيل.' });
  }

  try {
    // Validate balance and accounts
    let totalDebit = new Decimal(0);
    let totalCredit = new Decimal(0);
    for (const l of lines) {
      const d = new Decimal(l.debit || 0);
      const c = new Decimal(l.credit || 0);
      totalDebit = totalDebit.plus(d);
      totalCredit = totalCredit.plus(c);

      const acc = db.prepare('SELECT id, name_ar, is_group, is_active FROM accounts WHERE id = ?').get(l.account_id) as any;
      if (!acc) throw new Error(`الحساب ${l.account_id} غير موجود بدليل الحسابات.`);
      if (acc.is_group === 1) throw new Error(`الحساب "${acc.name_ar}" حساب تجميعي ويحظر الترحيل إليه.`);
      if (acc.is_active === 0) throw new Error(`الحساب "${acc.name_ar}" معطل.`);
    }

    const diff = totalDebit.minus(totalCredit).abs();
    if (diff.greaterThan(0.001)) {
      throw new Error(`القيد غير متوازن: المدين (${totalDebit}) لا يساوي الدائن (${totalCredit}).`);
    }

    const period = getFiscalPeriodForDate(target.posting_date || target.entry_date);
    const postedEntryNumber = getNextDocumentNumber('JV', target.branch_id, period.fiscal_year_id);

    db.prepare(`
      UPDATE journal_entries
      SET status = 'posted',
          entry_number = ?,
          posted_by = ?,
          posted_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(postedEntryNumber, req.user!.id, target.id);

    logAudit(req.user!.id, 'POST_JOURNAL', 'journal_entries', target.id, `اعتماد وترحيل مسودة القيد برقم ${postedEntryNumber}`);
    res.json({ success: true, entryId: target.id, entryNumber: postedEntryNumber, message: 'تم اعتماد وترحيل القيد بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/journal-entries/:id/reverse', requireAuth, requirePermission('journal.reverse', 'reverse'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT branch_id FROM journal_entries WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'القيد غير موجود.' });

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له القيد خارج نطاق الفروع المصرح لك بها.' });
  }

  try {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ error: 'يجب ذكر سبب عكس القيد.' });
    }

    const result = reverseJournalEntry(req.params.id, reason, req.user!.id);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 6. Customers & Suppliers & Statement of Account
// ----------------------------------------------------
apiRouter.get('/parties', requireAuth, requirePermission('parties.view'), (req, res) => {
  const { type } = req.query;
  let q = `
    SELECT p.*,
      COALESCE((
        SELECT ROUND(SUM(
          CASE 
            WHEN p.type = 'supplier' THEN (jel.credit - jel.debit)
            ELSE (jel.debit - jel.credit)
          END
        ), 2)
        FROM journal_entry_lines jel
        JOIN journal_entries je ON jel.entry_id = je.id
        WHERE jel.party_id = p.id AND je.status = 'posted'
      ), 0) as current_balance
    FROM parties p
    WHERE 1=1
  `;
  const params: any[] = [];
  if (type) {
    q += ' AND (p.type = ? OR p.type = "both")';
    params.push(type);
  }
  q += ' ORDER BY p.name_ar ASC';

  const parties = db.prepare(q).all(...params);
  res.json({ parties });
});

// Full Server-Side Statement of Account with Date and Branch Scoping
apiRouter.get('/parties/:id/statement', requireAuth, requirePermission('parties.statement', 'parties.view'), (req, res) => {
  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(req.params.id) as any;
  if (!party) return res.status(404).json({ error: 'الطرف التجاري غير موجود' });

  const fromDate = typeof req.query.fromDate === 'string' && req.query.fromDate ? req.query.fromDate : null;
  const toDate = typeof req.query.toDate === 'string' && req.query.toDate ? req.query.toDate : null;
  const branchId = typeof req.query.branchId === 'string' && req.query.branchId !== 'all' ? req.query.branchId : null;

  // 1. Calculate Opening Balance before fromDate
  let openingDebit = new Decimal(0);
  let openingCredit = new Decimal(0);

  if (fromDate) {
    let openSql = `
      SELECT COALESCE(SUM(jel.debit), 0) as total_debit, COALESCE(SUM(jel.credit), 0) as total_credit
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.entry_id = je.id
      WHERE jel.party_id = ? AND je.status = 'posted' AND je.entry_date < ?
    `;
    const openParams: any[] = [party.id, fromDate];
    if (branchId) {
      openSql += ' AND je.branch_id = ?';
      openParams.push(branchId);
    }
    const openRow = db.prepare(openSql).get(...openParams) as any;
    openingDebit = new Decimal(openRow.total_debit || 0);
    openingCredit = new Decimal(openRow.total_credit || 0);
  }

  // Net opening: if customer, debit - credit; if supplier, credit - debit
  const openingBalance = party.type === 'supplier'
    ? openingCredit.minus(openingDebit).toNumber()
    : openingDebit.minus(openingCredit).toNumber();

  // 2. Fetch Period Movements
  let periodSql = `
    SELECT je.id as entry_id, je.entry_number, je.entry_date, je.doc_type, je.doc_number, je.doc_id,
           jel.description, jel.debit, jel.credit, b.name_ar as branch_name
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    JOIN branches b ON je.branch_id = b.id
    WHERE jel.party_id = ? AND je.status = 'posted'
  `;
  const periodParams: any[] = [party.id];
  if (fromDate) {
    periodSql += ' AND je.entry_date >= ?';
    periodParams.push(fromDate);
  }
  if (toDate) {
    periodSql += ' AND je.entry_date <= ?';
    periodParams.push(toDate);
  }
  if (branchId) {
    periodSql += ' AND je.branch_id = ?';
    periodParams.push(branchId);
  }
  periodSql += ' ORDER BY je.entry_date ASC, je.entry_number ASC';

  const transactions = db.prepare(periodSql).all(...periodParams);

  let runningBalance = new Decimal(openingBalance);
  let periodDebitTotal = new Decimal(0);
  let periodCreditTotal = new Decimal(0);

  const rows = transactions.map((t: any) => {
    const d = new Decimal(t.debit || 0);
    const c = new Decimal(t.credit || 0);
    periodDebitTotal = periodDebitTotal.plus(d);
    periodCreditTotal = periodCreditTotal.plus(c);

    if (party.type === 'supplier') {
      runningBalance = runningBalance.plus(c).minus(d);
    } else {
      runningBalance = runningBalance.plus(d).minus(c);
    }

    return {
      ...t,
      debit: d.toNumber(),
      credit: c.toNumber(),
      runningBalance: runningBalance.toNumber()
    };
  });

  const closingBalance = runningBalance.toNumber();
  const isNetDebit = party.type === 'supplier' ? closingBalance < 0 : closingBalance > 0;

  res.json({
    party,
    filters: { fromDate, toDate, branchId },
    openingBalance,
    periodDebit: periodDebitTotal.toNumber(),
    periodCredit: periodCreditTotal.toNumber(),
    closingBalance,
    currencyCode: party.currency_code || 'EGP',
    balanceNature: party.type === 'supplier'
      ? (closingBalance >= 0 ? 'مستحق للمورد (دائن)' : 'مدفوع زيادة للمورد (مدين)')
      : (closingBalance >= 0 ? 'مستحق على العميل (مدين)' : 'رصيد دائن لصالح العميل'),
    rows
  });
});

apiRouter.post('/parties', requireAuth, requirePermission('parties.create', 'add'), (req: AuthenticatedRequest, res) => {
  try {
    const { name_ar, name_en, type, tax_id, commercial_registry, phone, address, city, credit_limit, payment_terms_days } = req.body;
    if (!name_ar || typeof name_ar !== 'string' || !name_ar.trim()) {
      return res.status(400).json({ error: 'اسم الطرف التجاري مطلوب.' });
    }

    if (!type || (type !== 'customer' && type !== 'supplier')) {
      return res.status(400).json({ error: 'نوع الطرف غير مدعوم. الأنواع المسموحة هي عميل (customer) أو مورد (supplier).' });
    }

    let code = '';
    const id = `party_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    db.transaction(() => {
      const prefix = type === 'supplier' ? 'SUPP' : 'CUST';
      const seqRow = db.prepare('SELECT last_number FROM party_sequences WHERE type = ?').get(type) as { last_number: number } | undefined;
      let nextNum = 1;

      if (!seqRow) {
        const existing = db.prepare("SELECT code FROM parties WHERE code LIKE ?").all(`${prefix}-%`) as { code: string }[];
        let maxNum = 0;
        for (const p of existing) {
          const parts = p.code.split('-');
          const n = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(n) && n > maxNum) maxNum = n;
        }
        nextNum = maxNum + 1;
        db.prepare('INSERT INTO party_sequences (type, last_number) VALUES (?, ?)').run(type, nextNum);
      } else {
        nextNum = seqRow.last_number + 1;
        db.prepare('UPDATE party_sequences SET last_number = ? WHERE type = ?').run(nextNum, type);
      }

      code = `${prefix}-${nextNum.toString().padStart(4, '0')}`;
      while (db.prepare('SELECT id FROM parties WHERE code = ?').get(code)) {
        nextNum++;
        db.prepare('UPDATE party_sequences SET last_number = ? WHERE type = ?').run(nextNum, type);
        code = `${prefix}-${nextNum.toString().padStart(4, '0')}`;
      }

      db.prepare(`
        INSERT INTO parties (
          id, code, type, name_ar, name_en, tax_id, commercial_registry, phone, address, city, credit_limit, payment_terms_days
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, code, type, name_ar.trim(), name_en ? name_en.trim() : name_ar.trim(),
        tax_id || null, commercial_registry || null, phone || null, address || null,
        city || 'القاهرة', credit_limit ? parseFloat(credit_limit) : 0,
        payment_terms_days ? parseInt(payment_terms_days, 10) : 0
      );
    })();

    logAudit(req.user!.id, 'CREATE_PARTY', 'parties', id, `إضافة طرف تجاري: ${code} - ${name_ar}`);
    res.json({ success: true, id, code, message: `تمت إضافة ${type === 'supplier' ? 'المورد' : 'العميل'} "${name_ar}" برقم (${code}) بنجاح.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.put('/parties/:id', requireAuth, requirePermission('parties.edit', 'manage_settings'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM parties WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'الطرف التجاري غير موجود.' });

  const { name_ar, name_en, type, tax_id, commercial_registry, phone, address, city, credit_limit, payment_terms_days, is_active } = req.body;

  if (type && type !== target.type) {
    if (type !== 'customer' && type !== 'supplier') {
      return res.status(400).json({ error: 'نوع الطرف غير مدعوم. يرجى اختيار عميل (customer) أو مورد (supplier).' });
    }
    // Check if transactions exist before allowing party type change
    const sCount = db.prepare('SELECT COUNT(*) as cnt FROM sales_invoices WHERE customer_id = ?').get(target.id) as { cnt: number };
    const pCount = db.prepare('SELECT COUNT(*) as cnt FROM purchase_invoices WHERE supplier_id = ?').get(target.id) as { cnt: number };
    const srCount = db.prepare('SELECT COUNT(*) as cnt FROM sales_returns WHERE customer_id = ?').get(target.id) as { cnt: number };
    const prCount = db.prepare('SELECT COUNT(*) as cnt FROM purchase_returns WHERE supplier_id = ?').get(target.id) as { cnt: number };
    const jeCount = db.prepare('SELECT COUNT(*) as cnt FROM journal_entry_lines WHERE party_id = ?').get(target.id) as { cnt: number };
    const totalTx = sCount.cnt + pCount.cnt + srCount.cnt + prCount.cnt + jeCount.cnt;
    if (totalTx > 0) {
      return res.status(400).json({ error: `لا يمكن تغيير نوع الطرف لوجود معاملات مالية (${totalTx} حركة) مسجلة عليه.` });
    }
  }

  try {
    db.prepare(`
      UPDATE parties
      SET name_ar = COALESCE(?, name_ar),
          name_en = COALESCE(?, name_en),
          type = COALESCE(?, type),
          tax_id = CASE WHEN ? IS NOT NULL THEN ? ELSE tax_id END,
          commercial_registry = CASE WHEN ? IS NOT NULL THEN ? ELSE commercial_registry END,
          phone = CASE WHEN ? IS NOT NULL THEN ? ELSE phone END,
          address = CASE WHEN ? IS NOT NULL THEN ? ELSE address END,
          city = COALESCE(?, city),
          credit_limit = COALESCE(?, credit_limit),
          payment_terms_days = COALESCE(?, payment_terms_days),
          is_active = COALESCE(?, is_active)
      WHERE id = ?
    `).run(
      name_ar || null,
      name_en || null,
      type || null,
      tax_id !== undefined ? 1 : null,
      tax_id || null,
      commercial_registry !== undefined ? 1 : null,
      commercial_registry || null,
      phone !== undefined ? 1 : null,
      phone || null,
      address !== undefined ? 1 : null,
      address || null,
      city || null,
      credit_limit !== undefined ? parseFloat(credit_limit) : null,
      payment_terms_days !== undefined ? parseInt(payment_terms_days, 10) : null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      target.id
    );

    logAudit(req.user!.id, 'UPDATE_PARTY', 'parties', target.id, `تعديل الطرف التجاري: ${target.code} - ${name_ar || target.name_ar}`);
    res.json({ success: true, message: 'تم تحديث بيانات الطرف التجاري بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/parties/:id', requireAuth, requirePermission('parties.delete', 'manage_settings'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM parties WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'الطرف التجاري غير موجود.' });

  // Check all linked financial documents
  const sCount = db.prepare('SELECT COUNT(*) as cnt FROM sales_invoices WHERE customer_id = ?').get(target.id) as { cnt: number };
  const pCount = db.prepare('SELECT COUNT(*) as cnt FROM purchase_invoices WHERE supplier_id = ?').get(target.id) as { cnt: number };
  const srCount = db.prepare('SELECT COUNT(*) as cnt FROM sales_returns WHERE customer_id = ?').get(target.id) as { cnt: number };
  const prCount = db.prepare('SELECT COUNT(*) as cnt FROM purchase_returns WHERE supplier_id = ?').get(target.id) as { cnt: number };
  const jeCount = db.prepare('SELECT COUNT(*) as cnt FROM journal_entry_lines WHERE party_id = ?').get(target.id) as { cnt: number };
  const pvCount = db.prepare('SELECT COUNT(*) as cnt FROM payment_vouchers WHERE party_id = ?').get(target.id) as { cnt: number };

  const totalTx = sCount.cnt + pCount.cnt + srCount.cnt + prCount.cnt + jeCount.cnt + pvCount.cnt;
  if (totalTx > 0) {
    return res.status(400).json({
      error: `لا يمكن حذف هذا الطرف التجاري لوجود مستندات وحركات مالية وفواتير مرتبطة به (${totalTx} حركة). يمكنك تعطيل الطرف بدلاً من حذفه للحفاظ على الأثر المحاسبي.`
    });
  }

  try {
    db.transaction(() => {
      db.prepare('DELETE FROM party_contacts WHERE party_id = ?').run(target.id);
      db.prepare('DELETE FROM parties WHERE id = ?').run(target.id);
    })();

    logAudit(req.user!.id, 'DELETE_PARTY', 'parties', target.id, `حذف الطرف التجاري: ${target.code} - ${target.name_ar}`);
    res.json({ success: true, message: `تم حذف الطرف "${target.name_ar}" بنجاح.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 7. Item Categories Management (إدارة فئات الأصناف)
// ----------------------------------------------------
apiRouter.get('/categories', requireAuth, (req, res) => {
  const categories = db.prepare(`
    SELECT c.*, p.name_ar as parent_name_ar,
           (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id OR i.category = c.name_ar) as item_count
    FROM item_categories c
    LEFT JOIN item_categories p ON c.parent_id = p.id
    ORDER BY c.code ASC
  `).all();
  res.json({ categories });
});

apiRouter.post('/categories', requireAuth, requirePermission('manage_settings'), (req: AuthenticatedRequest, res) => {
  const { code, name_ar, name_en, parent_id, is_active } = req.body;
  if (!code || !name_ar) {
    return res.status(400).json({ error: 'كود الفئة والاسم العربي مطلوبان.' });
  }

  const existing = db.prepare('SELECT id FROM item_categories WHERE code = ?').get(code);
  if (existing) {
    return res.status(400).json({ error: `كود الفئة "${code}" مسجل مسبقاً.` });
  }

  try {
    const id = `cat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    db.prepare(`
      INSERT INTO item_categories (id, code, name_ar, name_en, parent_id, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, code, name_ar, name_en || null, parent_id || null, is_active !== undefined ? (is_active ? 1 : 0) : 1);

    logAudit(req.user!.id, 'CREATE_CATEGORY', 'item_categories', id, `إضافة فئة أصناف: ${code} - ${name_ar}`);
    res.json({ success: true, id, message: `تمت إضافة الفئة "${name_ar}" بنجاح.` });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.put('/categories/:id', requireAuth, requirePermission('manage_settings'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM item_categories WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'الفئة غير موجودة' });

  const { name_ar, name_en, parent_id, is_active } = req.body;

  // Prevent cycle
  if (parent_id && parent_id === target.id) {
    return res.status(400).json({ error: 'لا يمكن للفئة أن تكون أصلاً لنفسها.' });
  }

  try {
    db.prepare(`
      UPDATE item_categories
      SET name_ar = COALESCE(?, name_ar),
          name_en = COALESCE(?, name_en),
          parent_id = CASE WHEN ? IS NOT NULL THEN ? ELSE parent_id END,
          is_active = COALESCE(?, is_active)
      WHERE id = ?
    `).run(
      name_ar || null,
      name_en || null,
      parent_id !== undefined ? 1 : null,
      parent_id || null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      target.id
    );

    logAudit(req.user!.id, 'UPDATE_CATEGORY', 'item_categories', target.id, `تعديل فئة الأصناف: ${target.code} - ${name_ar || target.name_ar}`);
    res.json({ success: true, message: 'تم تحديث بيانات الفئة بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/categories/:id', requireAuth, requirePermission('manage_settings'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM item_categories WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'الفئة غير موجودة' });

  // 1. Check child categories
  const childCount = db.prepare('SELECT COUNT(*) as cnt FROM item_categories WHERE parent_id = ?').get(target.id) as { cnt: number };
  if (childCount.cnt > 0) {
    return res.status(400).json({ error: `لا يمكن حذف الفئة لأنها فئة رئيسية تتبعها (${childCount.cnt}) فئات فرعية.` });
  }

  // 2. Check linked items
  const itemsCount = db.prepare('SELECT COUNT(*) as cnt FROM items WHERE category_id = ? OR category = ?').get(target.id, target.name_ar) as { cnt: number };
  if (itemsCount.cnt > 0) {
    return res.status(400).json({
      error: `لا يمكن حذف الفئة لوجود (${itemsCount.cnt}) أصناف مرتبطة بها. يرجى نقل الأصناف إلى فئة أخرى أولاً أو تعطيل الفئة.`
    });
  }

  try {
    db.prepare('DELETE FROM item_categories WHERE id = ?').run(target.id);
    logAudit(req.user!.id, 'DELETE_CATEGORY', 'item_categories', target.id, `حذف فئة الأصناف: ${target.code} - ${target.name_ar}`);
    res.json({ success: true, message: `تم حذف الفئة "${target.name_ar}" بنجاح.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/categories/:id/transfer-items', requireAuth, requirePermission('manage_settings'), (req: AuthenticatedRequest, res) => {
  const sourceCatId = req.params.id;
  const { targetCategoryId } = req.body;
  if (!targetCategoryId) return res.status(400).json({ error: 'الفئة البديلة المستهدفة مطلوبة.' });

  const targetCat = db.prepare('SELECT * FROM item_categories WHERE id = ?').get(targetCategoryId) as any;
  if (!targetCat) return res.status(404).json({ error: 'الفئة المستهدفة غير موجودة' });

  const sourceCat = db.prepare('SELECT * FROM item_categories WHERE id = ?').get(sourceCatId) as any;
  if (!sourceCat) return res.status(404).json({ error: 'الفئة المصدر غير موجودة' });

  try {
    const updated = db.prepare(`
      UPDATE items 
      SET category_id = ?, category = ? 
      WHERE category_id = ? OR category = ?
    `).run(targetCat.id, targetCat.name_ar, sourceCat.id, sourceCat.name_ar);

    logAudit(req.user!.id, 'TRANSFER_CATEGORY_ITEMS', 'item_categories', sourceCatId, `نقل ${updated.changes} صنف من "${sourceCat.name_ar}" إلى "${targetCat.name_ar}"`);
    res.json({ success: true, movedCount: updated.changes, message: `تم نقل ${updated.changes} صنف بنجاح إلى "${targetCat.name_ar}".` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 8. Items & Stock (Cost Redacted if unauthorized)
// ----------------------------------------------------
apiRouter.get('/items', requireAuth, requirePermission('inventory.view', 'items.view'), (req: AuthenticatedRequest, res) => {
  const hasViewCost = req.user?.role === 'owner' || req.user?.permissions.includes('view_cost');

  const items = db.prepare(`
    SELECT i.*, c.name_ar as category_name_ar, c.code as category_code,
           COALESCE(SUM(ws.quantity), 0) as total_quantity
    FROM items i
    LEFT JOIN item_categories c ON i.category_id = c.id
    LEFT JOIN warehouse_stock ws ON i.id = ws.item_id
    GROUP BY i.id
    ORDER BY i.name_ar ASC
  `).all() as any[];

  // Redact cost strictly if not permitted
  if (!hasViewCost) {
    for (const it of items) {
      delete it.cost_price;
      delete it.moving_avg_cost;
    }
  }

  res.json({ items });
});

apiRouter.get('/items/:id', requireAuth, requirePermission('inventory.view', 'items.view'), (req: AuthenticatedRequest, res) => {
  const hasViewCost = req.user?.role === 'owner' || req.user?.permissions.includes('view_cost');
  const item = db.prepare(`
    SELECT i.*, c.name_ar as category_name_ar,
           COALESCE((SELECT SUM(quantity) FROM warehouse_stock WHERE item_id = i.id), 0) as total_quantity
    FROM items i
    LEFT JOIN item_categories c ON i.category_id = c.id
    WHERE i.id = ?
  `).get(req.params.id) as any;

  if (!item) return res.status(404).json({ error: 'الصنف غير موجود' });

  if (!hasViewCost) {
    delete item.cost_price;
    delete item.moving_avg_cost;
  }

  res.json({ item });
});

apiRouter.post('/items', requireAuth, requirePermission('items.create', 'inventory.create_item', 'manage_settings'), (req: AuthenticatedRequest, res) => {
  const { code, barcode, name_ar, name_en, category_id, category, item_type, unit_name, sale_price, tax_rate, min_stock_level, is_active, description } = req.body;

  if (!code || !name_ar || sale_price === undefined) {
    return res.status(400).json({ error: 'كود الصنف والاسم وسعر البيع حقول إلزامية.' });
  }

  // Check unique code
  const codeCheck = db.prepare('SELECT id FROM items WHERE code = ?').get(code);
  if (codeCheck) {
    return res.status(400).json({ error: `كود الصنف "${code}" مسجل مسبقاً.` });
  }

  // Check unique barcode if provided
  if (barcode) {
    const barCheck = db.prepare('SELECT id, name_ar FROM items WHERE barcode = ?').get(barcode) as any;
    if (barCheck) {
      return res.status(400).json({ error: `الباركود الدولي "${barcode}" مسجل مسبقاً للصنف "${barCheck.name_ar}".` });
    }
  }

  // Resolve category name
  let catName = category || 'أجهزة ومعدات';
  if (category_id) {
    const cat = db.prepare('SELECT name_ar FROM item_categories WHERE id = ?').get(category_id) as any;
    if (cat) catName = cat.name_ar;
  }

  try {
    const itemId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const parsedPrice = parseFloat(sale_price) || 0;
    const parsedTax = tax_rate !== undefined ? parseFloat(tax_rate) : 14.0;
    const parsedMinStock = min_stock_level !== undefined ? parseFloat(min_stock_level) : 5;

    db.transaction(() => {
      db.prepare(`
        INSERT INTO items (
          id, code, barcode, name_ar, name_en, category_id, category, item_type,
          base_unit, sale_price, cost_price, moving_avg_cost, tax_rate, min_stock_level, is_active, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
      `).run(
        itemId, code, barcode || null, name_ar, name_en || null,
        category_id || null, catName, item_type || 'stock', unit_name || 'قطعة',
        parsedPrice, parsedTax, parsedMinStock,
        is_active !== undefined ? (is_active ? 1 : 0) : 1, description || null
      );

      // Initialize 0 stock across all warehouses for this stock item
      if ((item_type || 'stock') === 'stock') {
        const warehouses = db.prepare('SELECT id FROM warehouses').all() as { id: string }[];
        const insStock = db.prepare('INSERT OR IGNORE INTO warehouse_stock (warehouse_id, item_id, quantity) VALUES (?, ?, 0)');
        for (const wh of warehouses) {
          insStock.run(wh.id, itemId);
        }
      }
    })();

    logAudit(req.user!.id, 'CREATE_ITEM', 'items', itemId, `إضافة صنف جديد: ${code} - ${name_ar}`);
    res.json({ success: true, id: itemId, message: `تمت إضافة الصنف "${name_ar}" بنجاح.` });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.put('/items/:id', requireAuth, requirePermission('items.edit', 'inventory.edit_item', 'manage_settings'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'الصنف غير موجود.' });

  const { barcode, name_ar, name_en, category_id, category, item_type, unit_name, sale_price, tax_rate, min_stock_level, is_active, description } = req.body;

  // Check if transactions exist before allowing item_type change
  if (item_type && item_type !== target.item_type) {
    const txSales = db.prepare('SELECT COUNT(*) as cnt FROM sales_invoice_items WHERE item_id = ?').get(target.id) as { cnt: number };
    const txPurchases = db.prepare('SELECT COUNT(*) as cnt FROM purchase_invoice_items WHERE item_id = ?').get(target.id) as { cnt: number };
    if (txSales.cnt > 0 || txPurchases.cnt > 0) {
      return res.status(400).json({ error: 'لا يمكن تغيير نوع الصنف بعد وجود فواتير أو حركات مخزنية مسجلة عليه.' });
    }
  }

  // Check unique barcode if changed
  if (barcode && barcode !== target.barcode) {
    const barCheck = db.prepare('SELECT id, name_ar FROM items WHERE barcode = ? AND id != ?').get(barcode, target.id) as any;
    if (barCheck) {
      return res.status(400).json({ error: `الباركود الدولي "${barcode}" مسجل مسبقاً لصنف آخر (${barCheck.name_ar}).` });
    }
  }

  let catName = target.category;
  if (category_id) {
    const cat = db.prepare('SELECT name_ar FROM item_categories WHERE id = ?').get(category_id) as any;
    if (cat) catName = cat.name_ar;
  } else if (category) {
    catName = category;
  }

  try {
    db.prepare(`
      UPDATE items
      SET name_ar = COALESCE(?, name_ar),
          name_en = COALESCE(?, name_en),
          barcode = CASE WHEN ? IS NOT NULL THEN ? ELSE barcode END,
          category_id = COALESCE(?, category_id),
          category = COALESCE(?, category),
          item_type = COALESCE(?, item_type),
          base_unit = COALESCE(?, base_unit),
          sale_price = COALESCE(?, sale_price),
          tax_rate = COALESCE(?, tax_rate),
          min_stock_level = COALESCE(?, min_stock_level),
          is_active = COALESCE(?, is_active),
          description = COALESCE(?, description)
      WHERE id = ?
    `).run(
      name_ar || null,
      name_en || null,
      barcode !== undefined ? 1 : null,
      barcode || null,
      category_id || null,
      catName,
      item_type || null,
      unit_name || null,
      sale_price !== undefined ? parseFloat(sale_price) : null,
      tax_rate !== undefined ? parseFloat(tax_rate) : null,
      min_stock_level !== undefined ? parseFloat(min_stock_level) : null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      description || null,
      target.id
    );

    logAudit(req.user!.id, 'UPDATE_ITEM', 'items', target.id, `تعديل الصنف: ${target.code} - ${name_ar || target.name_ar}`);
    res.json({ success: true, message: 'تم تحديث بيانات الصنف بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/items/:id', requireAuth, requirePermission('items.delete', 'inventory.delete_item', 'manage_settings'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'الصنف غير موجود.' });

  // 1. Check transactions
  const sCount = db.prepare('SELECT COUNT(*) as cnt FROM sales_invoice_items WHERE item_id = ?').get(target.id) as { cnt: number };
  const pCount = db.prepare('SELECT COUNT(*) as cnt FROM purchase_invoice_items WHERE item_id = ?').get(target.id) as { cnt: number };
  const srCount = db.prepare('SELECT COUNT(*) as cnt FROM sales_return_items WHERE item_id = ?').get(target.id) as { cnt: number };
  const prCount = db.prepare('SELECT COUNT(*) as cnt FROM purchase_return_items WHERE item_id = ?').get(target.id) as { cnt: number };
  const stCount = db.prepare('SELECT COUNT(*) as cnt FROM stock_transaction_items WHERE item_id = ?').get(target.id) as { cnt: number };

  const totalTx = sCount.cnt + pCount.cnt + srCount.cnt + prCount.cnt + stCount.cnt;
  if (totalTx > 0) {
    return res.status(400).json({
      error: `لا يمكن حذف هذا الصنف لوجود (${totalTx}) حركات ومستندات مسجلة عليه تاريخياً. يمكنك تعطيل الصنف بدلاً من الحذف لمنع اختلال التقارير والقيود السابقة.`
    });
  }

  // 2. Check stock balance
  const stockRow = db.prepare('SELECT COALESCE(SUM(quantity), 0) as total_qty FROM warehouse_stock WHERE item_id = ?').get(target.id) as { total_qty: number };
  if (stockRow.total_qty > 0) {
    return res.status(400).json({
      error: `لا يمكن حذف الصنف لأن لديه رصيد مخزني حالي (${stockRow.total_qty} قطعة). يجب صرف أو تسوية الرصيد أولاً.`
    });
  }

  try {
    db.transaction(() => {
      db.prepare('DELETE FROM warehouse_stock WHERE item_id = ?').run(target.id);
      db.prepare('DELETE FROM items WHERE id = ?').run(target.id);
    })();

    logAudit(req.user!.id, 'DELETE_ITEM', 'items', target.id, `حذف الصنف: ${target.code} - ${target.name_ar}`);
    res.json({ success: true, message: `تم حذف الصنف "${target.name_ar}" بنجاح.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/items/:id/stock-by-warehouse', requireAuth, (req, res) => {
  const stock = db.prepare(`
    SELECT ws.*, w.name_ar as warehouse_name, b.name_ar as branch_name
    FROM warehouse_stock ws
    JOIN warehouses w ON ws.warehouse_id = w.id
    JOIN branches b ON w.branch_id = b.id
    WHERE ws.item_id = ?
  `).all(req.params.id);

  res.json({ stock });
});

// ----------------------------------------------------
// 8. Sales Invoices (Fixed multi-line aggregation & cash receipt)
// ----------------------------------------------------
apiRouter.get('/sales/invoices', requireAuth, requirePermission('sales.view'), (req: AuthenticatedRequest, res) => {
  const hasViewCost = req.user?.role === 'owner' || req.user?.permissions.includes('view_cost');

  let branchFilter = '';
  const params: any[] = [];
  if (req.user?.role !== 'owner' && req.user?.allowed_branch_ids !== '*') {
    try {
      const branches: string[] = JSON.parse(req.user?.allowed_branch_ids || '[]');
      if (branches.length > 0) {
        branchFilter = `WHERE si.branch_id IN (${branches.map(() => '?').join(',')})`;
        params.push(...branches);
      } else {
        branchFilter = 'WHERE 1=0';
      }
    } catch {
      branchFilter = 'WHERE 1=0';
    }
  }

  const invoices = db.prepare(`
    SELECT si.*, p.name_ar as customer_name, b.name_ar as branch_name, w.name_ar as warehouse_name
    FROM sales_invoices si
    JOIN parties p ON si.customer_id = p.id
    JOIN branches b ON si.branch_id = b.id
    JOIN warehouses w ON si.warehouse_id = w.id
    ${branchFilter}
    ORDER BY si.invoice_date DESC, si.invoice_number DESC
  `).all(...params) as any[];

  if (!hasViewCost) {
    invoices.forEach(inv => {
      delete inv.cogs_amount;
    });
  }

  res.json({ invoices });
});

apiRouter.get('/sales/invoices/:id', requireAuth, requirePermission('sales.view'), (req: AuthenticatedRequest, res) => {
  const invoice = db.prepare(`
    SELECT si.*, p.name_ar as customer_name, p.tax_id as customer_tax_id, p.address as customer_address,
           b.name_ar as branch_name, w.name_ar as warehouse_name, je.entry_number as journal_number
    FROM sales_invoices si
    JOIN parties p ON si.customer_id = p.id
    JOIN branches b ON si.branch_id = b.id
    JOIN warehouses w ON si.warehouse_id = w.id
    LEFT JOIN journal_entries je ON si.journal_entry_id = je.id
    WHERE si.id = ?
  `).get(req.params.id) as any;

  if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });

  if (!isBranchAllowed(req.user, invoice.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له الفاتورة خارج نطاق الفروع المصرح لك بها.' });
  }

  const hasViewCost = req.user?.role === 'owner' || req.user?.permissions.includes('view_cost');
  if (!hasViewCost) {
    delete invoice.cogs_amount;
  }

  const items = db.prepare(`
    SELECT sii.*, i.name_ar as item_name, i.code as item_code, i.barcode, i.eta_item_code
    FROM sales_invoice_items sii
    JOIN items i ON sii.item_id = i.id
    WHERE sii.invoice_id = ?
  `).all(req.params.id) as any[];

  if (!hasViewCost) {
    items.forEach(it => {
      delete it.cost_price;
    });
  }

  invoice.items = items;
  res.json({ invoice });
});

apiRouter.post('/sales/invoices', requireAuth, (req: AuthenticatedRequest, res) => {
  if (checkIdempotency(req, res)) return;

  const { branchId, warehouseId, customerId, invoiceDate, paymentType, items, notes, cashBoxId, bankAccountId, status } = req.body;

  if (!branchId || !warehouseId || !customerId || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'بيانات الفاتورة غير مكتملة.' });
  }

  if (!isBranchAllowed(req.user, branchId)) {
    return res.status(403).json({ error: 'غير مصرح لك بإصدار فواتير في هذا الفرع.' });
  }

  const isDraft = status === 'draft';
  if (!isDraft) {
    if (req.user?.role !== 'owner' && !req.user?.permissions.includes('sales.post') && !req.user?.permissions.includes('*')) {
      return res.status(403).json({ error: 'لا تملك صلاحية ترحيل واعتماد فواتير المبيعات (sales.post).' });
    }
  } else {
    if (req.user?.role !== 'owner' && !req.user?.permissions.includes('sales.create') && !req.user?.permissions.includes('sales.edit_draft') && !req.user?.permissions.includes('*')) {
      return res.status(403).json({ error: 'لا تملك صلاحية إنشاء وحفظ مسودات فواتير المبيعات (sales.create).' });
    }
  }

  try {
    const invId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const effectiveDate = invoiceDate || new Date().toISOString().split('T')[0];
    const period = getFiscalPeriodForDate(effectiveDate);
    const invNumber = getNextDocumentNumber(isDraft ? 'INV-DFT' : 'INV', branchId, period.fiscal_year_id);

    // Validate party
    const party = db.prepare('SELECT id, name_ar, credit_limit FROM parties WHERE id = ?').get(customerId) as any;
    if (!party) throw new Error('العميل المحدد غير موجود.');

    // 1. Validate inputs and calculate totals
    let subtotal = new Decimal(0);
    let totalDiscount = new Decimal(0);
    let totalVat = new Decimal(0);
    let totalCogs = new Decimal(0);
    const calculatedItems: any[] = [];

    for (const it of items) {
      const qty = new Decimal(it.quantity);
      const price = new Decimal(it.unitPrice);
      const discount = new Decimal(it.discountAmount || 0);

      if (!qty.isFinite() || qty.isNegative() || qty.isZero()) {
        throw new Error('الكمية يجب أن تكون رقماً موجباً غير صفري.');
      }
      if (!price.isFinite() || price.isNegative()) {
        throw new Error('سعر الوحدة لا يمكن أن يكون سالباً.');
      }
      if (!discount.isFinite() || discount.isNegative() || discount.greaterThan(qty.times(price))) {
        throw new Error('قيمة الخصم غير صحيحة.');
      }

      const itemRow = db.prepare('SELECT id, name_ar, moving_avg_cost, sale_price, item_type FROM items WHERE id = ?').get(it.itemId) as any;
      if (!itemRow) throw new Error(`الصنف ${it.itemId} غير موجود`);

      const lineNet = qty.times(price).minus(discount);
      const lineTaxRate = it.taxRate !== undefined ? new Decimal(it.taxRate) : new Decimal(14);
      const lineVat = lineNet.times(lineTaxRate.dividedBy(100));

      subtotal = subtotal.plus(qty.times(price));
      totalDiscount = totalDiscount.plus(discount);
      totalVat = totalVat.plus(lineVat);

      if (itemRow.item_type === 'stock') {
        totalCogs = totalCogs.plus(qty.times(itemRow.moving_avg_cost || 0));
      }

      calculatedItems.push({
        itemId: it.itemId,
        quantity: qty.toNumber(),
        unitPrice: price.toNumber(),
        costPrice: itemRow.moving_avg_cost || 0,
        discountAmount: discount.toNumber(),
        taxRate: lineTaxRate.toNumber(),
        taxAmount: lineVat.toNumber(),
        totalAmount: lineNet.plus(lineVat).toNumber()
      });
    }

    const taxableTotal = subtotal.minus(totalDiscount);
    const totalWht = taxableTotal.times(0.01); // 1% Egyptian commercial standard
    const netTotalAmount = taxableTotal.plus(totalVat).minus(totalWht);

    if (isDraft) {
      // Save Draft without inventory deduction or GL entry
      db.transaction(() => {
        db.prepare(`
          INSERT INTO sales_invoices (
            id, invoice_number, branch_id, warehouse_id, customer_id, invoice_date, due_date,
            payment_type, subtotal, discount_amount, taxable_amount, tax_amount, withholding_tax_amount,
            total_amount, paid_amount, remaining_amount, cogs_amount, status, journal_entry_id, eta_status, created_by, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'draft', NULL, 'NotSubmitted', ?, ?)
        `).run(
          invId, invNumber, branchId, warehouseId, customerId, effectiveDate, effectiveDate,
          paymentType || 'credit', subtotal.toNumber(), totalDiscount.toNumber(), taxableTotal.toNumber(),
          totalVat.toNumber(), totalWht.toNumber(), netTotalAmount.toNumber(), netTotalAmount.toNumber(),
          totalCogs.toNumber(), req.user!.id, notes || null
        );

        const insertItemStmt = db.prepare(`
          INSERT INTO sales_invoice_items (
            id, invoice_id, item_id, unit_name, unit_factor, quantity, unit_price, cost_price, discount_amount, tax_rate, tax_amount, total_amount
          ) VALUES (?, ?, ?, 'قطعة', 1.0, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const it of calculatedItems) {
          insertItemStmt.run(
            `sii_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            invId, it.itemId, it.quantity, it.unitPrice, it.costPrice, it.discountAmount, it.taxRate, it.taxAmount, it.totalAmount
          );
        }
      })();

      logAudit(req.user!.id, 'CREATE_DRAFT_SALES_INVOICE', 'sales_invoices', invId, `إنشاء مسودة فاتورة مبيعات ${invNumber}`);
      const responseData = { success: true, invoiceId: invId, invoiceNumber: invNumber, status: 'draft', message: 'تم حفظ مسودة فاتورة المبيعات بنجاح.' };
      saveIdempotency(req.headers['idempotency-key'] as string, req.user!.id, '/sales/invoices', 200, responseData);
      return res.json(responseData);
    }

    const isCash = paymentType === 'cash';
    let chosenCashAccountId = 'acc_1111';
    let chosenCashboxOrBankId = cashBoxId || null;

    if (isCash) {
      if (cashBoxId) {
        const cb = db.prepare('SELECT account_id FROM cash_boxes WHERE id = ?').get(cashBoxId) as any;
        if (cb) chosenCashAccountId = cb.account_id;
      } else if (bankAccountId) {
        const ba = db.prepare('SELECT account_id FROM bank_accounts WHERE id = ?').get(bankAccountId) as any;
        if (ba) chosenCashAccountId = ba.account_id;
        chosenCashboxOrBankId = bankAccountId;
      }
    }

    // ATOMIC TRANSACTION: Check aggregate stock, deduct, insert invoice & GL, and post cash receipt if cash
    db.transaction(() => {
      // 1. Multi-line Stock Check and Deduction
      validateAndDeductStock(warehouseId, calculatedItems);

      const isAlex = branchId === 'br_alex';
      const inventoryAccount = isAlex ? 'acc_1142' : 'acc_1141';

      // 2. Journal Entry
      const glLines = [
        // Debit customer or cash
        {
          accountId: isCash ? chosenCashAccountId : 'acc_1121',
          partyId: isCash ? null : customerId,
          debit: netTotalAmount.toNumber(),
          credit: 0,
          description: `استحقاق فاتورة مبيعات ${invNumber}`
        },
        // Debit Withholding Tax Asset (1%)
        {
          accountId: 'acc_1152',
          debit: totalWht.toNumber(),
          credit: 0,
          description: `خصم وتحصيل 1% فاتورة ${invNumber}`
        },
        // Credit Sales Revenue
        {
          accountId: 'acc_4111',
          debit: 0,
          credit: taxableTotal.toNumber(),
          description: `إيرادات مبيعات فاتورة ${invNumber}`
        },
        // Credit Output VAT
        {
          accountId: 'acc_2131',
          debit: 0,
          credit: totalVat.toNumber(),
          description: `ضريبة القيمة المضافة 14% فاتورة ${invNumber}`
        }
      ];

      if (totalCogs.greaterThan(0)) {
        glLines.push(
          { accountId: 'acc_5111', debit: totalCogs.toNumber(), credit: 0, description: `تكلفة مبيعات فاتورة ${invNumber}` },
          { accountId: inventoryAccount, debit: 0, credit: totalCogs.toNumber(), description: `صرف مخزون فاتورة ${invNumber}` }
        );
      }

      const journalResult = postJournalEntry({
        docType: 'SALES_INV',
        docId: invId,
        docNumber: invNumber,
        entryDate: effectiveDate,
        postingDate: effectiveDate,
        branchId,
        fiscalPeriodId: period.id,
        description: `فاتورة مبيعات رقم ${invNumber} للعميل ${party.name_ar}`,
        createdBy: req.user!.id,
        lines: glLines
      });

      // 3. Insert Sales Invoice
      const paidAmt = isCash ? netTotalAmount.toNumber() : 0;
      const remAmt = isCash ? 0 : netTotalAmount.toNumber();

      db.prepare(`
        INSERT INTO sales_invoices (
          id, invoice_number, branch_id, warehouse_id, customer_id, invoice_date, due_date,
          payment_type, subtotal, discount_amount, taxable_amount, tax_amount, withholding_tax_amount,
          total_amount, paid_amount, remaining_amount, cogs_amount, status, journal_entry_id, eta_status, created_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NotSubmitted', ?, ?)
      `).run(
        invId, invNumber, branchId, warehouseId, customerId, effectiveDate, effectiveDate,
        paymentType || 'credit', subtotal.toNumber(), totalDiscount.toNumber(), taxableTotal.toNumber(),
        totalVat.toNumber(), totalWht.toNumber(), netTotalAmount.toNumber(), paidAmt, remAmt,
        totalCogs.toNumber(), isCash ? 'paid' : 'posted', journalResult.entryId, req.user!.id, notes || null
      );

      // 4. Insert Items
      const insertItemStmt = db.prepare(`
        INSERT INTO sales_invoice_items (
          id, invoice_id, item_id, unit_name, unit_factor, quantity, unit_price, cost_price, discount_amount, tax_rate, tax_amount, total_amount
        ) VALUES (?, ?, ?, 'قطعة', 1.0, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const it of calculatedItems) {
        insertItemStmt.run(
          `sii_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          invId, it.itemId, it.quantity, it.unitPrice, it.costPrice, it.discountAmount, it.taxRate, it.taxAmount, it.totalAmount
        );
      }

      // 5. Automatic Receipt Voucher & Allocation for Cash Invoices
      if (isCash) {
        const rcptNumber = getNextDocumentNumber('RV', branchId, period.fiscal_year_id);
        const pvId = `pv_cash_${invId}`;
        
        db.prepare(`
          INSERT INTO payment_vouchers (
            id, voucher_number, voucher_type, branch_id, payment_method, cash_box_id, bank_account_id,
            party_id, voucher_date, amount, allocated_amount, unallocated_amount,
            description, journal_entry_id, status, created_by
          ) VALUES (?, ?, 'receipt', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'posted', ?)
        `).run(
          pvId, rcptNumber, branchId, bankAccountId ? 'bank_transfer' : 'cash',
          cashBoxId || null, bankAccountId || null, customerId, effectiveDate,
          netTotalAmount.toNumber(), netTotalAmount.toNumber(),
          `تحصيل فوري عن فاتورة المبيعات ${invNumber}`, journalResult.entryId, req.user!.id
        );

        db.prepare(`
          INSERT INTO voucher_allocations (id, voucher_id, invoice_type, invoice_id, allocated_amount)
          VALUES (?, ?, 'sales_invoice', ?, ?)
        `).run(`va_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, pvId, invId, netTotalAmount.toNumber());
      }
    })();

    logAudit(req.user!.id, 'CREATE_SALES_INVOICE', 'sales_invoices', invId, `إصدار فاتورة مبيعات ${invNumber}`);

    const responseData = { success: true, invoiceId: invId, invoiceNumber: invNumber, status: isCash ? 'paid' : 'posted' };
    saveIdempotency(req.headers['idempotency-key'] as string, req.user!.id, '/sales/invoices', 200, responseData);
    res.json(responseData);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Edit Draft Sales Invoice
apiRouter.put('/sales/invoices/:id', requireAuth, requirePermission('sales.edit_draft'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM sales_invoices WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'الفاتورة غير موجودة.' });

  if (target.status !== 'draft') {
    return res.status(400).json({ error: 'لا يمكن تعديل الفاتورة بعد اعتمادها وترحيلها. التعديل متاح للمسودات فقط.' });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'غير مصرح لك بتعديل فواتير مسودة في هذا الفرع.' });
  }

  const { branchId, warehouseId, customerId, invoiceDate, paymentType, items, notes } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'يجب إدخال بنود الفاتورة.' });
  }

  if (branchId && !isBranchAllowed(req.user, branchId)) {
    return res.status(403).json({ error: 'غير مصرح لك بنقل الفاتورة إلى هذا الفرع.' });
  }

  try {
    let subtotal = new Decimal(0);
    let totalDiscount = new Decimal(0);
    let totalVat = new Decimal(0);
    let totalCogs = new Decimal(0);
    const calculatedItems: any[] = [];

    for (const it of items) {
      const qty = new Decimal(it.quantity);
      const price = new Decimal(it.unitPrice);
      const discount = new Decimal(it.discountAmount || 0);

      if (!qty.isFinite() || qty.isNegative() || qty.isZero()) throw new Error('الكمية يجب أن تكون رقماً موجباً.');
      if (!price.isFinite() || price.isNegative()) throw new Error('سعر الوحدة لا يمكن أن يكون سالباً.');

      const itemRow = db.prepare('SELECT id, moving_avg_cost, item_type FROM items WHERE id = ?').get(it.itemId) as any;
      if (!itemRow) throw new Error(`الصنف ${it.itemId} غير موجود.`);

      const lineNet = qty.times(price).minus(discount);
      const lineTaxRate = it.taxRate !== undefined ? new Decimal(it.taxRate) : new Decimal(14);
      const lineVat = lineNet.times(lineTaxRate.dividedBy(100));

      subtotal = subtotal.plus(qty.times(price));
      totalDiscount = totalDiscount.plus(discount);
      totalVat = totalVat.plus(lineVat);

      if (itemRow.item_type === 'stock') {
        totalCogs = totalCogs.plus(qty.times(itemRow.moving_avg_cost || 0));
      }

      calculatedItems.push({
        itemId: it.itemId,
        quantity: qty.toNumber(),
        unitPrice: price.toNumber(),
        costPrice: itemRow.moving_avg_cost || 0,
        discountAmount: discount.toNumber(),
        taxRate: lineTaxRate.toNumber(),
        taxAmount: lineVat.toNumber(),
        totalAmount: lineNet.plus(lineVat).toNumber()
      });
    }

    const taxableTotal = subtotal.minus(totalDiscount);
    const totalWht = taxableTotal.times(0.01);
    const netTotalAmount = taxableTotal.plus(totalVat).minus(totalWht);

    db.transaction(() => {
      db.prepare(`
        UPDATE sales_invoices
        SET branch_id = COALESCE(?, branch_id),
            warehouse_id = COALESCE(?, warehouse_id),
            customer_id = COALESCE(?, customer_id),
            invoice_date = COALESCE(?, invoice_date),
            payment_type = COALESCE(?, payment_type),
            subtotal = ?,
            discount_amount = ?,
            taxable_amount = ?,
            tax_amount = ?,
            withholding_tax_amount = ?,
            total_amount = ?,
            remaining_amount = ?,
            cogs_amount = ?,
            notes = COALESCE(?, notes)
        WHERE id = ?
      `).run(
        branchId || null, warehouseId || null, customerId || null, invoiceDate || null, paymentType || null,
        subtotal.toNumber(), totalDiscount.toNumber(), taxableTotal.toNumber(), totalVat.toNumber(),
        totalWht.toNumber(), netTotalAmount.toNumber(), netTotalAmount.toNumber(), totalCogs.toNumber(),
        notes || null, target.id
      );

      db.prepare('DELETE FROM sales_invoice_items WHERE invoice_id = ?').run(target.id);
      const insertItemStmt = db.prepare(`
        INSERT INTO sales_invoice_items (
          id, invoice_id, item_id, unit_name, unit_factor, quantity, unit_price, cost_price, discount_amount, tax_rate, tax_amount, total_amount
        ) VALUES (?, ?, ?, 'قطعة', 1.0, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const it of calculatedItems) {
        insertItemStmt.run(
          `sii_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          target.id, it.itemId, it.quantity, it.unitPrice, it.costPrice, it.discountAmount, it.taxRate, it.taxAmount, it.totalAmount
        );
      }
    })();

    logAudit(req.user!.id, 'UPDATE_DRAFT_SALES_INVOICE', 'sales_invoices', target.id, `تعديل مسودة فاتورة المبيعات ${target.invoice_number}`);
    res.json({ success: true, message: 'تم تحديث مسودة فاتورة المبيعات بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Delete Draft Sales Invoice
apiRouter.delete('/sales/invoices/:id', requireAuth, requirePermission('sales.delete_draft'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM sales_invoices WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'الفاتورة غير موجودة.' });

  if (target.status !== 'draft') {
    return res.status(400).json({ error: 'لا يمكن حذف الفاتورة بعد اعتمادها وترحيلها. التصحيح يتم بإلغاء وعكس الفاتورة أو إصدار مردود مبيعات.' });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'غير مصرح لك بحذف فواتير مسودة في هذا الفرع.' });
  }

  try {
    db.transaction(() => {
      db.prepare('DELETE FROM sales_invoice_items WHERE invoice_id = ?').run(target.id);
      db.prepare('DELETE FROM sales_invoices WHERE id = ?').run(target.id);
    })();

    logAudit(req.user!.id, 'DELETE_DRAFT_SALES_INVOICE', 'sales_invoices', target.id, `حذف مسودة فاتورة المبيعات ${target.invoice_number}`);
    res.json({ success: true, message: `تم حذف مسودة الفاتورة "${target.invoice_number}" بنجاح.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Post Draft Sales Invoice
apiRouter.post('/sales/invoices/:id/post', requireAuth, requirePermission('sales.post'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM sales_invoices WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'الفاتورة غير موجودة.' });

  if (target.status !== 'draft') {
    return res.status(400).json({ error: `الفاتورة حالتها الحالية (${target.status}) ولا يمكن ترحيلها مجدداً.` });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'غير مصرح لك بترحيل فواتير في هذا الفرع.' });
  }

  const items = db.prepare('SELECT * FROM sales_invoice_items WHERE invoice_id = ?').all(target.id) as any[];
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'لا يمكن ترحيل فاتورة بدون بنود.' });
  }

  try {
    const period = getFiscalPeriodForDate(target.invoice_date);
    const postedInvNumber = getNextDocumentNumber('INV', target.branch_id, period.fiscal_year_id);
    const party = db.prepare('SELECT id, name_ar FROM parties WHERE id = ?').get(target.customer_id) as any;

    const formattedItems = items.map(it => ({
      itemId: it.item_id,
      quantity: it.quantity,
      unitPrice: it.unit_price,
      costPrice: it.cost_price,
      taxAmount: it.tax_amount,
      totalAmount: it.total_amount
    }));

    db.transaction(() => {
      validateAndDeductStock(target.warehouse_id, formattedItems);

      const isAlex = target.branch_id === 'br_alex';
      const inventoryAccount = isAlex ? 'acc_1142' : 'acc_1141';
      const isCash = target.payment_type === 'cash';

      const glLines = [
        {
          accountId: isCash ? 'acc_1111' : 'acc_1121',
          partyId: isCash ? null : target.customer_id,
          debit: target.total_amount,
          credit: 0,
          description: `استحقاق فاتورة مبيعات ${postedInvNumber}`
        },
        {
          accountId: 'acc_1152',
          debit: target.withholding_tax_amount,
          credit: 0,
          description: `خصم وتحصيل 1% فاتورة ${postedInvNumber}`
        },
        {
          accountId: 'acc_4111',
          debit: 0,
          credit: target.taxable_amount,
          description: `إيرادات مبيعات فاتورة ${postedInvNumber}`
        },
        {
          accountId: 'acc_2131',
          debit: 0,
          credit: target.tax_amount,
          description: `ضريبة القيمة المضافة 14% فاتورة ${postedInvNumber}`
        }
      ];

      if (target.cogs_amount > 0) {
        glLines.push(
          { accountId: 'acc_5111', debit: target.cogs_amount, credit: 0, description: `تكلفة مبيعات فاتورة ${postedInvNumber}` },
          { accountId: inventoryAccount, debit: 0, credit: target.cogs_amount, description: `صرف مخزون فاتورة ${postedInvNumber}` }
        );
      }

      const journalResult = postJournalEntry({
        docType: 'SALES_INV',
        docId: target.id,
        docNumber: postedInvNumber,
        entryDate: target.invoice_date,
        postingDate: target.invoice_date,
        branchId: target.branch_id,
        fiscalPeriodId: period.id,
        description: `فاتورة مبيعات رقم ${postedInvNumber} للعميل ${party?.name_ar || ''}`,
        createdBy: req.user!.id,
        lines: glLines
      });

      db.prepare(`
        UPDATE sales_invoices
        SET invoice_number = ?,
            status = ?,
            paid_amount = ?,
            remaining_amount = ?,
            journal_entry_id = ?
        WHERE id = ?
      `).run(
        postedInvNumber,
        isCash ? 'paid' : 'posted',
        isCash ? target.total_amount : 0,
        isCash ? 0 : target.total_amount,
        journalResult.entryId,
        target.id
      );
    })();

    logAudit(req.user!.id, 'POST_SALES_INVOICE', 'sales_invoices', target.id, `اعتماد وترحيل فاتورة المبيعات برقم ${postedInvNumber}`);
    res.json({ success: true, invoiceId: target.id, invoiceNumber: postedInvNumber, message: 'تم ترحيل واعتماد فاتورة المبيعات بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Reversal / Cancellation of Posted Sales Invoice
apiRouter.post('/sales/invoices/:id/reverse', requireAuth, requirePermission('sales.reverse'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM sales_invoices WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'فاتورة المبيعات غير موجودة.' });

  if (target.status !== 'posted' && target.status !== 'paid') {
    return res.status(400).json({ error: `لا يمكن إلغاء وعكس الفاتورة لأن حالتها الحالية هي (${target.status === 'draft' ? 'مسودة' : target.status === 'reversed' ? 'معكوسة بالفعل' : target.status}).` });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له الفاتورة خارج نطاق الفروع المصرح لك بها.' });
  }

  const reason = (req.body?.reason || '').trim();
  if (!reason) {
    return res.status(400).json({ error: 'يرجى توضيح سبب إلغاء وتصحيح الفاتورة المرحّلة.' });
  }

  // 1. Check if invoice has active sales returns
  const returnCheck = db.prepare("SELECT COUNT(*) as cnt FROM sales_returns WHERE original_invoice_id = ? AND status != 'reversed'").get(target.id) as { cnt: number };
  if (returnCheck && returnCheck.cnt > 0) {
    return res.status(400).json({ error: `لا يمكن إلغاء الفاتورة لوجود (${returnCheck.cnt}) مردود مبيعات مسجل عليها مسبقاً. يرجى إلغاء المردود أولاً أو معالجة الفارق بمردود إضافي.` });
  }

  // 2. Check if credit invoice and has allocations from receipt vouchers
  const allocCheck = db.prepare(`
    SELECT va.allocated_amount, pv.voucher_number
    FROM voucher_allocations va
    JOIN payment_vouchers pv ON va.voucher_id = pv.id
    WHERE va.invoice_id = ? AND va.invoice_type = 'sales_invoice' AND pv.status != 'reversed'
  `).all(target.id) as any[];

  if (target.payment_type !== 'cash' && allocCheck.length > 0) {
    return res.status(400).json({
      error: `لا يمكن إلغاء الفاتورة لوجود سندات قبض مخصصة عليها (مثل السند ${allocCheck[0].voucher_number} بمبلغ ${allocCheck[0].allocated_amount} ج.م). يجب إلغاء سندات القبض أولاً.`
    });
  }

  try {
    const items = db.prepare('SELECT * FROM sales_invoice_items WHERE invoice_id = ?').all(target.id) as any[];

    db.transaction(() => {
      // 1. Reverse the associated journal entry
      let reversalJeNumber = '';
      if (target.journal_entry_id) {
        const revJe = reverseJournalEntry(target.journal_entry_id, `إلغاء وعكس فاتورة المبيعات ${target.invoice_number}: ${reason}`, req.user!.id, db, true);
        reversalJeNumber = revJe.reverseNumber;
      }

      // 2. Restore warehouse inventory for stock items
      for (const it of items) {
        const itemInfo = db.prepare('SELECT item_type FROM items WHERE id = ?').get(it.item_id) as any;
        if (itemInfo && itemInfo.item_type === 'stock') {
          db.prepare(`
            INSERT INTO warehouse_stock (warehouse_id, item_id, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(warehouse_id, item_id) DO UPDATE SET quantity = quantity + ?
          `).run(target.warehouse_id, it.item_id, it.quantity, it.quantity);
        }
      }

      // 3. If instant cash invoice, reverse the associated payment voucher and refund cashbox
      if (target.payment_type === 'cash') {
        const linkedVoucher = db.prepare(`
          SELECT pv.* FROM payment_vouchers pv
          JOIN voucher_allocations va ON pv.id = va.voucher_id
          WHERE va.invoice_id = ? AND va.invoice_type = 'sales_invoice' AND pv.status != 'reversed'
        `).get(target.id) as any;

        if (linkedVoucher) {
          if (linkedVoucher.journal_entry_id) {
            reverseJournalEntry(linkedVoucher.journal_entry_id, `عكس سند قبض النقدية المرتبط بالفاتورة الملغاة ${target.invoice_number}`, req.user!.id);
          }
          if (linkedVoucher.cash_box_id) {
            db.prepare('UPDATE cash_boxes SET current_balance = current_balance - ? WHERE id = ?').run(linkedVoucher.amount, linkedVoucher.cash_box_id);
          }
          db.prepare("UPDATE payment_vouchers SET status = 'reversed', notes = COALESCE(notes || ' | ', '') || 'تم الإلغاء لعكس الفاتورة ' || ? WHERE id = ?").run(target.invoice_number, linkedVoucher.id);
        }
      }

      // 4. Update sales invoice status to 'reversed'
      const noteAppend = ` | تم الإلغاء والعكس بالقيد (${reversalJeNumber || 'N/A'}) بسبب: ${reason}`;
      db.prepare(`
        UPDATE sales_invoices
        SET status = 'reversed',
            remaining_amount = 0,
            notes = COALESCE(notes || '', '') || ?
        WHERE id = ?
      `).run(noteAppend, target.id);
    })();

    logAudit(req.user!.id, 'REVERSE_SALES_INVOICE', 'sales_invoices', target.id, `إلغاء وعكس فاتورة المبيعات ${target.invoice_number} - السبب: ${reason}`);
    res.json({
      success: true,
      message: `تم إلغاء وعكس فاتورة المبيعات "${target.invoice_number}" بنجاح وإعادة البضاعة للمخزن وعكس الأثر المالي في الأستاذ العام.`
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 9. Purchase Invoices (Full Implementation)
// ----------------------------------------------------
apiRouter.get('/purchases/invoices', requireAuth, requirePermission('purchases.view'), (req: AuthenticatedRequest, res) => {
  let branchFilter = '';
  const params: any[] = [];
  if (req.user?.role !== 'owner' && req.user?.allowed_branch_ids !== '*') {
    try {
      const branches: string[] = JSON.parse(req.user?.allowed_branch_ids || '[]');
      if (branches.length > 0) {
        branchFilter = `WHERE pi.branch_id IN (${branches.map(() => '?').join(',')})`;
        params.push(...branches);
      } else {
        branchFilter = 'WHERE 1=0';
      }
    } catch {
      branchFilter = 'WHERE 1=0';
    }
  }

  const invoices = db.prepare(`
    SELECT pi.*, p.name_ar as supplier_name, b.name_ar as branch_name, w.name_ar as warehouse_name
    FROM purchase_invoices pi
    JOIN parties p ON pi.supplier_id = p.id
    JOIN branches b ON pi.branch_id = b.id
    JOIN warehouses w ON pi.warehouse_id = w.id
    ${branchFilter}
    ORDER BY pi.invoice_date DESC, pi.invoice_number DESC
  `).all(...params);
  res.json({ invoices });
});

apiRouter.get('/purchases/invoices/:id', requireAuth, requirePermission('purchases.view'), (req: AuthenticatedRequest, res) => {
  const invoice = db.prepare(`
    SELECT pi.*, p.name_ar as supplier_name, p.tax_id as supplier_tax_id, p.address as supplier_address,
           b.name_ar as branch_name, w.name_ar as warehouse_name, je.entry_number as journal_number
    FROM purchase_invoices pi
    JOIN parties p ON pi.supplier_id = p.id
    JOIN branches b ON pi.branch_id = b.id
    JOIN warehouses w ON pi.warehouse_id = w.id
    LEFT JOIN journal_entries je ON pi.journal_entry_id = je.id
    WHERE pi.id = ?
  `).get(req.params.id) as any;

  if (!invoice) return res.status(404).json({ error: 'فاتورة المشتريات غير موجودة' });

  if (!isBranchAllowed(req.user, invoice.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له الفاتورة خارج نطاق الفروع المصرح لك بها.' });
  }

  const items = db.prepare(`
    SELECT pii.*, i.name_ar as item_name, i.code as item_code, i.barcode
    FROM purchase_invoice_items pii
    JOIN items i ON pii.item_id = i.id
    WHERE pii.invoice_id = ?
  `).all(req.params.id);

  invoice.items = items;
  res.json({ invoice });
});

apiRouter.post('/purchases/invoices', requireAuth, (req: AuthenticatedRequest, res) => {
  if (checkIdempotency(req, res)) return;

  const { branchId, warehouseId, supplierId, supplierInvoiceNumber, invoiceDate, paymentType, items, notes, cashBoxId, bankAccountId, status } = req.body;

  if (!branchId || !warehouseId || !supplierId || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'بيانات فاتورة الشراء غير مكتملة.' });
  }

  if (!isBranchAllowed(req.user, branchId)) {
    return res.status(403).json({ error: 'الفرع المحدد خارج نطاق الفروع المصرح لك بها.' });
  }

  if (!isWarehouseAllowed(req.user, warehouseId)) {
    return res.status(403).json({ error: 'المستودع المحدد خارج نطاق المستودعات المصرح لك بها.' });
  }

  const isDraft = status === 'draft';
  if (!isDraft) {
    if (!req.user?.role || (req.user.role !== 'owner' && !req.user.permissions.includes('purchases.post') && !req.user.permissions.includes('*'))) {
      return res.status(403).json({ error: 'لا تملك صلاحية اعتماد وترحيل فواتير المشتريات (purchases.post).' });
    }
  } else {
    if (!req.user?.role || (req.user.role !== 'owner' && !req.user.permissions.includes('purchases.create') && !req.user.permissions.includes('purchases.edit_draft') && !req.user.permissions.includes('*'))) {
      return res.status(403).json({ error: 'لا تملك صلاحية إنشاء أو حفظ مسودات فواتير المشتريات (purchases.create).' });
    }
  }

  // Prevent duplicate supplier invoice number
  if (supplierInvoiceNumber) {
    const dup = db.prepare('SELECT id, invoice_number FROM purchase_invoices WHERE supplier_id = ? AND supplier_invoice_number = ?').get(supplierId, supplierInvoiceNumber) as any;
    if (dup) {
      return res.status(400).json({ error: `رقم فاتورة المورد "${supplierInvoiceNumber}" مسجل مسبقاً في النظام برقم (${dup.invoice_number}). يمنع تكرار فاتورة المورد لنفس المورد.` });
    }
  }

  try {
    const pId = `pur_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const effectiveDate = invoiceDate || new Date().toISOString().split('T')[0];
    const period = getFiscalPeriodForDate(effectiveDate);
    const pNumber = getNextDocumentNumber(isDraft ? 'PINV-DFT' : 'PINV', branchId, period.fiscal_year_id);

    const supplier = db.prepare('SELECT id, name_ar FROM parties WHERE id = ?').get(supplierId) as any;
    if (!supplier) throw new Error('المورد المحدد غير موجود.');

    let subtotal = new Decimal(0);
    let totalDiscount = new Decimal(0);
    let totalVat = new Decimal(0);
    const calculatedItems: any[] = [];

    for (const it of items) {
      const qty = new Decimal(it.quantity);
      const price = new Decimal(it.unitPrice);
      const discount = new Decimal(it.discountAmount || 0);

      if (!qty.isFinite() || qty.isNegative() || qty.isZero()) throw new Error('الكمية يجب أن تكون رقماً موجباً.');
      if (!price.isFinite() || price.isNegative()) throw new Error('سعر الشراء يجب أن يكون رقماً غير سالب.');

      const lineNet = qty.times(price).minus(discount);
      const lineTaxRate = it.taxRate !== undefined ? new Decimal(it.taxRate) : new Decimal(14);
      const lineVat = lineNet.times(lineTaxRate.dividedBy(100));

      subtotal = subtotal.plus(qty.times(price));
      totalDiscount = totalDiscount.plus(discount);
      totalVat = totalVat.plus(lineVat);

      calculatedItems.push({
        itemId: it.itemId,
        quantity: qty.toNumber(),
        unitPrice: price.toNumber(),
        discountAmount: discount.toNumber(),
        taxRate: lineTaxRate.toNumber(),
        taxAmount: lineVat.toNumber(),
        totalAmount: lineNet.plus(lineVat).toNumber()
      });
    }

    const taxableTotal = subtotal.minus(totalDiscount);
    const totalWht = taxableTotal.times(0.01); // 1% Withholding tax deducted from supplier
    const netTotalAmount = taxableTotal.plus(totalVat).minus(totalWht);

    if (isDraft) {
      db.transaction(() => {
        db.prepare(`
          INSERT INTO purchase_invoices (
            id, invoice_number, supplier_invoice_number, branch_id, warehouse_id, supplier_id,
            invoice_date, due_date, payment_type, subtotal, discount_amount, taxable_amount,
            tax_amount, withholding_tax_amount, total_amount, paid_amount, remaining_amount,
            status, journal_entry_id, created_by, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'draft', NULL, ?, ?)
        `).run(
          pId, pNumber, supplierInvoiceNumber || null, branchId, warehouseId, supplierId,
          effectiveDate, effectiveDate, paymentType || 'credit', subtotal.toNumber(), totalDiscount.toNumber(),
          taxableTotal.toNumber(), totalVat.toNumber(), totalWht.toNumber(), netTotalAmount.toNumber(),
          netTotalAmount.toNumber(), req.user!.id, notes || null
        );

        const insertLineStmt = db.prepare(`
          INSERT INTO purchase_invoice_items (
            id, invoice_id, item_id, unit_name, unit_factor, quantity, unit_price, discount_amount, tax_rate, tax_amount, total_amount
          ) VALUES (?, ?, ?, 'قطعة', 1.0, ?, ?, ?, ?, ?, ?)
        `);

        for (const it of calculatedItems) {
          insertLineStmt.run(
            `pii_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            pId, it.itemId, it.quantity, it.unitPrice, it.discountAmount, it.taxRate, it.taxAmount, it.totalAmount
          );
        }
      })();

      logAudit(req.user!.id, 'CREATE_DRAFT_PURCHASE_INVOICE', 'purchase_invoices', pId, `حفظ مسودة فاتورة مشتريات ${pNumber}`);
      const responseData = { success: true, invoiceId: pId, invoiceNumber: pNumber, status: 'draft', message: 'تم حفظ مسودة فاتورة المشتريات بنجاح.' };
      saveIdempotency(req.headers['idempotency-key'] as string, req.user!.id, '/purchases/invoices', 200, responseData);
      return res.json(responseData);
    }

    const isCash = paymentType === 'cash';
    let chosenCashAccountId = 'acc_1111';
    if (isCash) {
      if (cashBoxId) {
        const cb = db.prepare('SELECT account_id FROM cash_boxes WHERE id = ?').get(cashBoxId) as any;
        if (cb) chosenCashAccountId = cb.account_id;
      } else if (bankAccountId) {
        const ba = db.prepare('SELECT account_id FROM bank_accounts WHERE id = ?').get(bankAccountId) as any;
        if (ba) chosenCashAccountId = ba.account_id;
      }
    }

    db.transaction(() => {
      // 1. Post GL Journal Entry
      const isAlex = branchId === 'br_alex';
      const inventoryAccount = isAlex ? 'acc_1142' : 'acc_1141';

      const journalResult = postJournalEntry({
        docType: 'PUR_INV',
        docId: pId,
        docNumber: pNumber,
        entryDate: effectiveDate,
        postingDate: effectiveDate,
        branchId,
        fiscalPeriodId: period.id,
        description: `فاتورة مشتريات رقم ${pNumber} من المورد ${supplier.name_ar}`,
        createdBy: req.user!.id,
        lines: [
          // Debit Inventory
          { accountId: inventoryAccount, debit: taxableTotal.toNumber(), credit: 0, description: `إضافة مخزون مشتريات ${pNumber}` },
          // Debit Input VAT
          { accountId: 'acc_1151', debit: totalVat.toNumber(), credit: 0, description: `ضريبة مدخلات 14% مشتريات ${pNumber}` },
          // Credit Supplier or Cash
          { accountId: isCash ? chosenCashAccountId : 'acc_2111', partyId: isCash ? null : supplierId, debit: 0, credit: netTotalAmount.toNumber(), description: `استحقاق فاتورة مشتريات ${pNumber}` },
          // Credit Withholding Tax Payable (1%)
          { accountId: 'acc_2132', debit: 0, credit: totalWht.toNumber(), description: `أمانات ضريبة الخصم والتحصيل 1% فاتورة ${pNumber}` }
        ]
      });

      // 2. Insert Purchase Invoice Record
      const paidAmt = isCash ? netTotalAmount.toNumber() : 0;
      const remAmt = isCash ? 0 : netTotalAmount.toNumber();

      db.prepare(`
        INSERT INTO purchase_invoices (
          id, invoice_number, supplier_invoice_number, branch_id, warehouse_id, supplier_id,
          invoice_date, due_date, payment_type, subtotal, discount_amount, taxable_amount,
          tax_amount, withholding_tax_amount, total_amount, paid_amount, remaining_amount,
          status, journal_entry_id, created_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?)
      `).run(
        pId, pNumber, supplierInvoiceNumber || null, branchId, warehouseId, supplierId,
        effectiveDate, effectiveDate, paymentType || 'credit', subtotal.toNumber(), totalDiscount.toNumber(),
        taxableTotal.toNumber(), totalVat.toNumber(), totalWht.toNumber(), netTotalAmount.toNumber(),
        paidAmt, remAmt, journalResult.entryId, req.user!.id, notes || null
      );

      // 3. Update Inventory & Weighted Moving Average Cost
      const insertLineStmt = db.prepare(`
        INSERT INTO purchase_invoice_items (
          id, invoice_id, item_id, unit_name, unit_factor, quantity, unit_price, discount_amount, tax_rate, tax_amount, total_amount
        ) VALUES (?, ?, ?, 'قطعة', 1.0, ?, ?, ?, ?, ?, ?)
      `);

      for (const it of calculatedItems) {
        insertLineStmt.run(
          `pii_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          pId, it.itemId, it.quantity, it.unitPrice, it.discountAmount, it.taxRate, it.taxAmount, it.totalAmount
        );

        // Recalculate moving average cost:
        const currentItem = db.prepare('SELECT moving_avg_cost FROM items WHERE id = ?').get(it.itemId) as any;
        const currentStockRow = db.prepare('SELECT SUM(quantity) as total_qty FROM warehouse_stock WHERE item_id = ?').get(it.itemId) as any;
        const curQty = currentStockRow?.total_qty || 0;
        const curCost = currentItem?.moving_avg_cost || it.unitPrice;

        const newTotalQty = curQty + it.quantity;
        const newAvgCost = newTotalQty > 0
          ? Math.round((((curQty * curCost) + (it.quantity * it.unitPrice)) / newTotalQty) * 100) / 100
          : it.unitPrice;

        db.prepare('UPDATE items SET moving_avg_cost = ? WHERE id = ?').run(newAvgCost, it.itemId);

        // Safe increment of warehouse stock (upsert)
        db.prepare(`
          INSERT INTO warehouse_stock (warehouse_id, item_id, quantity)
          VALUES (?, ?, ?)
          ON CONFLICT(warehouse_id, item_id) DO UPDATE SET quantity = quantity + ?
        `).run(warehouseId, it.itemId, it.quantity, it.quantity);
      }
    })();

    logAudit(req.user!.id, 'CREATE_PURCHASE_INVOICE', 'purchase_invoices', pId, `تسجيل فاتورة مشتريات ${pNumber}`);

    const responseData = { success: true, invoiceId: pId, invoiceNumber: pNumber, status: 'posted' };
    saveIdempotency(req.headers['idempotency-key'] as string, req.user!.id, '/purchases/invoices', 200, responseData);
    res.json(responseData);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Edit Draft Purchase Invoice
apiRouter.put('/purchases/invoices/:id', requireAuth, requirePermission('purchases.edit_draft'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'فاتورة المشتريات غير موجودة.' });

  if (target.status !== 'draft') {
    return res.status(400).json({ error: 'لا يمكن تعديل فاتورة الشراء بعد ترحيلها واعتمادها. التعديل متاح للمسودات فقط.' });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له مسودة الفاتورة خارج نطاق الفروع المصرح لك بها.' });
  }

  const { branchId, warehouseId, supplierId, supplierInvoiceNumber, invoiceDate, paymentType, items, notes } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'يجب إدخال بنود الفاتورة.' });
  }

  if (branchId && !isBranchAllowed(req.user, branchId)) {
    return res.status(403).json({ error: 'الفرع المحدد خارج نطاق الفروع المصرح لك بها.' });
  }

  try {
    let subtotal = new Decimal(0);
    let totalDiscount = new Decimal(0);
    let totalVat = new Decimal(0);
    const calculatedItems: any[] = [];

    for (const it of items) {
      const qty = new Decimal(it.quantity);
      const price = new Decimal(it.unitPrice);
      const discount = new Decimal(it.discountAmount || 0);

      if (!qty.isFinite() || qty.isNegative() || qty.isZero()) throw new Error('الكمية يجب أن تكون رقماً موجباً.');
      if (!price.isFinite() || price.isNegative()) throw new Error('سعر الشراء يجب أن يكون رقماً غير سالب.');

      const lineNet = qty.times(price).minus(discount);
      const lineTaxRate = it.taxRate !== undefined ? new Decimal(it.taxRate) : new Decimal(14);
      const lineVat = lineNet.times(lineTaxRate.dividedBy(100));

      subtotal = subtotal.plus(qty.times(price));
      totalDiscount = totalDiscount.plus(discount);
      totalVat = totalVat.plus(lineVat);

      calculatedItems.push({
        itemId: it.itemId,
        quantity: qty.toNumber(),
        unitPrice: price.toNumber(),
        discountAmount: discount.toNumber(),
        taxRate: lineTaxRate.toNumber(),
        taxAmount: lineVat.toNumber(),
        totalAmount: lineNet.plus(lineVat).toNumber()
      });
    }

    const taxableTotal = subtotal.minus(totalDiscount);
    const totalWht = taxableTotal.times(0.01);
    const netTotalAmount = taxableTotal.plus(totalVat).minus(totalWht);

    db.transaction(() => {
      db.prepare(`
        UPDATE purchase_invoices
        SET branch_id = COALESCE(?, branch_id),
            warehouse_id = COALESCE(?, warehouse_id),
            supplier_id = COALESCE(?, supplier_id),
            supplier_invoice_number = COALESCE(?, supplier_invoice_number),
            invoice_date = COALESCE(?, invoice_date),
            payment_type = COALESCE(?, payment_type),
            subtotal = ?,
            discount_amount = ?,
            taxable_amount = ?,
            tax_amount = ?,
            withholding_tax_amount = ?,
            total_amount = ?,
            remaining_amount = ?,
            notes = COALESCE(?, notes)
        WHERE id = ?
      `).run(
        branchId || null, warehouseId || null, supplierId || null, supplierInvoiceNumber || null,
        invoiceDate || null, paymentType || null, subtotal.toNumber(), totalDiscount.toNumber(),
        taxableTotal.toNumber(), totalVat.toNumber(), totalWht.toNumber(), netTotalAmount.toNumber(),
        netTotalAmount.toNumber(), notes || null, target.id
      );

      db.prepare('DELETE FROM purchase_invoice_items WHERE invoice_id = ?').run(target.id);
      const insertLineStmt = db.prepare(`
        INSERT INTO purchase_invoice_items (
          id, invoice_id, item_id, unit_name, unit_factor, quantity, unit_price, discount_amount, tax_rate, tax_amount, total_amount
        ) VALUES (?, ?, ?, 'قطعة', 1.0, ?, ?, ?, ?, ?, ?)
      `);

      for (const it of calculatedItems) {
        insertLineStmt.run(
          `pii_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          target.id, it.itemId, it.quantity, it.unitPrice, it.discountAmount, it.taxRate, it.taxAmount, it.totalAmount
        );
      }
    })();

    logAudit(req.user!.id, 'UPDATE_DRAFT_PURCHASE_INVOICE', 'purchase_invoices', target.id, `تعديل مسودة فاتورة المشتريات ${target.invoice_number}`);
    res.json({ success: true, message: 'تم تحديث مسودة فاتورة المشتريات بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Delete Draft Purchase Invoice
apiRouter.delete('/purchases/invoices/:id', requireAuth, requirePermission('purchases.delete_draft'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'فاتورة المشتريات غير موجودة.' });

  if (target.status !== 'draft') {
    return res.status(400).json({ error: 'لا يمكن حذف فاتورة الشراء بعد ترحيلها واعتمادها.' });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له مسودة الفاتورة خارج نطاق الفروع المصرح لك بها.' });
  }

  try {
    db.transaction(() => {
      db.prepare('DELETE FROM purchase_invoice_items WHERE invoice_id = ?').run(target.id);
      db.prepare('DELETE FROM purchase_invoices WHERE id = ?').run(target.id);
    })();

    logAudit(req.user!.id, 'DELETE_DRAFT_PURCHASE_INVOICE', 'purchase_invoices', target.id, `حذف مسودة فاتورة المشتريات ${target.invoice_number}`);
    res.json({ success: true, message: `تم حذف مسودة فاتورة الشراء "${target.invoice_number}" بنجاح.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Post Draft Purchase Invoice
apiRouter.post('/purchases/invoices/:id/post', requireAuth, requirePermission('purchases.post'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'فاتورة المشتريات غير موجودة.' });

  if (target.status !== 'draft') {
    return res.status(400).json({ error: `فاتورة الشراء حالتها الحالية (${target.status}) ولا يمكن إعادة ترحيلها.` });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له الفاتورة خارج نطاق الفروع المصرح لك بها.' });
  }

  const items = db.prepare('SELECT * FROM purchase_invoice_items WHERE invoice_id = ?').all(target.id) as any[];
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'لا يمكن ترحيل فاتورة مشتريات بدون بنود.' });
  }

  try {
    const period = getFiscalPeriodForDate(target.invoice_date);
    const postedNumber = getNextDocumentNumber('PINV', target.branch_id, period.fiscal_year_id);
    const supplier = db.prepare('SELECT id, name_ar FROM parties WHERE id = ?').get(target.supplier_id) as any;

    db.transaction(() => {
      const isAlex = target.branch_id === 'br_alex';
      const inventoryAccount = isAlex ? 'acc_1142' : 'acc_1141';
      const isCash = target.payment_type === 'cash';

      const journalResult = postJournalEntry({
        docType: 'PUR_INV',
        docId: target.id,
        docNumber: postedNumber,
        entryDate: target.invoice_date,
        postingDate: target.invoice_date,
        branchId: target.branch_id,
        fiscalPeriodId: period.id,
        description: `فاتورة مشتريات رقم ${postedNumber} من المورد ${supplier?.name_ar || ''}`,
        createdBy: req.user!.id,
        lines: [
          { accountId: inventoryAccount, debit: target.taxable_amount, credit: 0, description: `إضافة مخزون مشتريات ${postedNumber}` },
          { accountId: 'acc_1151', debit: target.tax_amount, credit: 0, description: `ضريبة مدخلات 14% مشتريات ${postedNumber}` },
          { accountId: isCash ? 'acc_1111' : 'acc_2111', partyId: isCash ? null : target.supplier_id, debit: 0, credit: target.total_amount, description: `استحقاق فاتورة مشتريات ${postedNumber}` },
          { accountId: 'acc_2132', debit: 0, credit: target.withholding_tax_amount, description: `أمانات ضريبة الخصم والتحصيل 1% فاتورة ${postedNumber}` }
        ]
      });

      for (const it of items) {
        const currentItem = db.prepare('SELECT moving_avg_cost FROM items WHERE id = ?').get(it.item_id) as any;
        const currentStockRow = db.prepare('SELECT SUM(quantity) as total_qty FROM warehouse_stock WHERE item_id = ?').get(it.item_id) as any;
        const curQty = currentStockRow?.total_qty || 0;
        const curCost = currentItem?.moving_avg_cost || it.unit_price;

        const newTotalQty = curQty + it.quantity;
        const newAvgCost = newTotalQty > 0
          ? Math.round((((curQty * curCost) + (it.quantity * it.unit_price)) / newTotalQty) * 100) / 100
          : it.unit_price;

        db.prepare('UPDATE items SET moving_avg_cost = ? WHERE id = ?').run(newAvgCost, it.item_id);

        db.prepare(`
          INSERT INTO warehouse_stock (warehouse_id, item_id, quantity)
          VALUES (?, ?, ?)
          ON CONFLICT(warehouse_id, item_id) DO UPDATE SET quantity = quantity + ?
        `).run(target.warehouse_id, it.item_id, it.quantity, it.quantity);
      }

      db.prepare(`
        UPDATE purchase_invoices
        SET invoice_number = ?,
            status = 'posted',
            paid_amount = ?,
            remaining_amount = ?,
            journal_entry_id = ?
        WHERE id = ?
      `).run(
        postedNumber,
        isCash ? target.total_amount : 0,
        isCash ? 0 : target.total_amount,
        journalResult.entryId,
        target.id
      );
    })();

    logAudit(req.user!.id, 'POST_PURCHASE_INVOICE', 'purchase_invoices', target.id, `اعتماد وترحيل فاتورة المشتريات برقم ${postedNumber}`);
    res.json({ success: true, invoiceId: target.id, invoiceNumber: postedNumber, message: 'تم ترحيل واعتماد فاتورة المشتريات بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Reversal / Cancellation of Posted Purchase Invoice
apiRouter.post('/purchases/invoices/:id/reverse', requireAuth, requirePermission('purchases.reverse'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'فاتورة المشتريات غير موجودة.' });

  if (target.status !== 'posted' && target.status !== 'paid' && target.status !== 'partially_paid') {
    return res.status(400).json({ error: `لا يمكن إلغاء وعكس الفاتورة لأن حالتها الحالية هي (${target.status === 'draft' ? 'مسودة' : target.status === 'reversed' ? 'معكوسة بالفعل' : target.status}).` });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له الفاتورة خارج نطاق الفروع المصرح لك بها.' });
  }

  const reason = (req.body?.reason || '').trim();
  if (!reason) {
    return res.status(400).json({ error: 'يرجى توضيح سبب إلغاء وتصحيح فاتورة الشراء المرحّلة.' });
  }

  // 1. Check if invoice has active purchase returns
  const returnCheck = db.prepare("SELECT COUNT(*) as cnt FROM purchase_returns WHERE original_invoice_id = ? AND status != 'reversed'").get(target.id) as { cnt: number };
  if (returnCheck && returnCheck.cnt > 0) {
    return res.status(400).json({ error: `لا يمكن إلغاء الفاتورة لوجود (${returnCheck.cnt}) مردود مشتريات مسجل عليها مسبقاً. يرجى إلغاء المردود أولاً.` });
  }

  // 2. Check if credit invoice has payment voucher allocations
  const allocCheck = db.prepare(`
    SELECT va.allocated_amount, pv.voucher_number
    FROM voucher_allocations va
    JOIN payment_vouchers pv ON va.voucher_id = pv.id
    WHERE va.invoice_id = ? AND va.invoice_type = 'purchase_invoice' AND pv.status != 'reversed'
  `).all(target.id) as any[];

  if (target.payment_type !== 'cash' && allocCheck.length > 0) {
    return res.status(400).json({
      error: `لا يمكن إلغاء الفاتورة لوجود سندات صرف مخصصة عليها (مثل السند ${allocCheck[0].voucher_number} بمبلغ ${allocCheck[0].allocated_amount} ج.م). يجب إلغاء سندات الصرف أولاً.`
    });
  }

  // 3. Check stock balance for items before deduction
  const items = db.prepare('SELECT * FROM purchase_invoice_items WHERE invoice_id = ?').all(target.id) as any[];
  if (!isNegativeStockAllowed()) {
    for (const it of items) {
      const stockRow = db.prepare('SELECT quantity FROM warehouse_stock WHERE warehouse_id = ? AND item_id = ?').get(target.warehouse_id, it.item_id) as any;
      const currentQty = stockRow ? stockRow.quantity : 0;
      if (currentQty < it.quantity) {
        return res.status(400).json({
          error: `رصيد المستودع الحالي (${currentQty}) غير كافٍ لسحب كمية الصنف (${it.quantity}) لإلغاء الفاتورة.`
        });
      }
    }
  }

  try {
    db.transaction(() => {
      // 1. Reverse the associated journal entry
      let reversalJeNumber = '';
      if (target.journal_entry_id) {
        const revJe = reverseJournalEntry(target.journal_entry_id, `إلغاء وعكس فاتورة المشتريات ${target.invoice_number}: ${reason}`, req.user!.id, db, true);
        reversalJeNumber = revJe.reverseNumber;
      }

      // 2. Deduct warehouse inventory for items
      for (const it of items) {
        db.prepare(`
          UPDATE warehouse_stock
          SET quantity = quantity - ?
          WHERE warehouse_id = ? AND item_id = ?
        `).run(it.quantity, target.warehouse_id, it.item_id);
      }

      // 3. If cash invoice, reverse associated payment voucher
      if (target.payment_type === 'cash') {
        const linkedVoucher = db.prepare(`
          SELECT pv.* FROM payment_vouchers pv
          JOIN voucher_allocations va ON pv.id = va.voucher_id
          WHERE va.invoice_id = ? AND va.invoice_type = 'purchase_invoice' AND pv.status != 'reversed'
        `).get(target.id) as any;

        if (linkedVoucher) {
          if (linkedVoucher.journal_entry_id) {
            reverseJournalEntry(linkedVoucher.journal_entry_id, `عكس سند صرف النقدية المرتبط بالفاتورة الملغاة ${target.invoice_number}`, req.user!.id);
          }
          if (linkedVoucher.cash_box_id) {
            db.prepare('UPDATE cash_boxes SET current_balance = current_balance + ? WHERE id = ?').run(linkedVoucher.amount, linkedVoucher.cash_box_id);
          }
          db.prepare("UPDATE payment_vouchers SET status = 'reversed', notes = COALESCE(notes || ' | ', '') || 'تم الإلغاء لعكس الفاتورة ' || ? WHERE id = ?").run(target.invoice_number, linkedVoucher.id);
        }
      }

      // 4. Update purchase invoice status to 'reversed'
      const noteAppend = ` | تم الإلغاء والعكس بالقيد (${reversalJeNumber || 'N/A'}) بسبب: ${reason}`;
      db.prepare(`
        UPDATE purchase_invoices
        SET status = 'reversed',
            remaining_amount = 0,
            notes = COALESCE(notes || '', '') || ?
        WHERE id = ?
      `).run(noteAppend, target.id);
    })();

    logAudit(req.user!.id, 'REVERSE_PURCHASE_INVOICE', 'purchase_invoices', target.id, `إلغاء وعكس فاتورة المشتريات ${target.invoice_number} - السبب: ${reason}`);
    res.json({
      success: true,
      message: `تم إلغاء وعكس فاتورة المشتريات "${target.invoice_number}" بنجاح وخصم البضاعة من المخزن وعكس الأثر المالي في الأستاذ العام.`
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 10. Sales Returns (مردودات المبيعات - دورة المسودة والترحيل الكاملة)
// ----------------------------------------------------
apiRouter.get('/sales/returns', requireAuth, requirePermission('sales_returns.view'), (req: AuthenticatedRequest, res) => {
  let branchFilter = '';
  const params: any[] = [];
  if (req.user?.role !== 'owner' && req.user?.allowed_branch_ids !== '*') {
    try {
      const branches: string[] = JSON.parse(req.user?.allowed_branch_ids || '[]');
      if (branches.length > 0) {
        branchFilter = `WHERE sr.branch_id IN (${branches.map(() => '?').join(',')})`;
        params.push(...branches);
      } else {
        branchFilter = 'WHERE 1=0';
      }
    } catch {
      branchFilter = 'WHERE 1=0';
    }
  }

  const returns = db.prepare(`
    SELECT sr.*, p.name_ar as customer_name, b.name_ar as branch_name, w.name_ar as warehouse_name,
           si.invoice_number as original_invoice_number
    FROM sales_returns sr
    JOIN parties p ON sr.customer_id = p.id
    JOIN branches b ON sr.branch_id = b.id
    JOIN warehouses w ON sr.warehouse_id = w.id
    LEFT JOIN sales_invoices si ON sr.original_invoice_id = si.id
    ${branchFilter}
    ORDER BY sr.return_date DESC, sr.return_number DESC
  `).all(...params);
  res.json({ returns });
});

apiRouter.get('/sales/returns/:id', requireAuth, requirePermission('sales_returns.view'), (req: AuthenticatedRequest, res) => {
  const returnDoc = db.prepare(`
    SELECT sr.*, p.name_ar as customer_name, b.name_ar as branch_name, w.name_ar as warehouse_name,
           si.invoice_number as original_invoice_number, je.entry_number as journal_number
    FROM sales_returns sr
    JOIN parties p ON sr.customer_id = p.id
    JOIN branches b ON sr.branch_id = b.id
    JOIN warehouses w ON sr.warehouse_id = w.id
    LEFT JOIN sales_invoices si ON sr.original_invoice_id = si.id
    LEFT JOIN journal_entries je ON sr.journal_entry_id = je.id
    WHERE sr.id = ?
  `).get(req.params.id) as any;

  if (!returnDoc) return res.status(404).json({ error: 'مردود المبيعات غير موجود.' });

  if (!isBranchAllowed(req.user, returnDoc.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له مردود المبيعات خارج نطاق الفروع المصرح لك بها.' });
  }

  const items = db.prepare(`
    SELECT sri.*, i.name_ar as item_name, i.code as item_code, i.barcode
    FROM sales_return_items sri
    JOIN items i ON sri.item_id = i.id
    WHERE sri.return_id = ?
  `).all(req.params.id);

  returnDoc.items = items;
  res.json({ returnDoc });
});

apiRouter.post('/sales/returns', requireAuth, (req: AuthenticatedRequest, res) => {
  const { originalInvoiceId, warehouseId, returnDate, refundType, items, notes, status } = req.body;

  if (!originalInvoiceId || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'بيانات مردود المبيعات غير مكتملة.' });
  }

  const origInv = db.prepare('SELECT * FROM sales_invoices WHERE id = ?').get(originalInvoiceId) as any;
  if (!origInv) return res.status(404).json({ error: 'الفاتورة الأصلية غير موجودة.' });

  if (!isBranchAllowed(req.user, origInv.branch_id)) {
    return res.status(403).json({ error: 'غير مصرح لك بإصدار مردودات في هذا الفرع.' });
  }

  const isDraft = status === 'draft';
  if (!isDraft) {
    if (!req.user?.role || (req.user.role !== 'owner' && !req.user.permissions.includes('sales_returns.post') && !req.user.permissions.includes('*'))) {
      return res.status(403).json({ error: 'لا تملك صلاحية اعتماد وترحيل مردودات المبيعات (sales_returns.post).' });
    }
  } else {
    if (!req.user?.role || (req.user.role !== 'owner' && !req.user.permissions.includes('sales_returns.create') && !req.user.permissions.includes('sales_returns.edit_draft') && !req.user.permissions.includes('*'))) {
      return res.status(403).json({ error: 'لا تملك صلاحية إنشاء مسودات مردودات المبيعات (sales_returns.create).' });
    }
  }

  try {
    const retId = `ret_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const effectiveDate = returnDate || new Date().toISOString().split('T')[0];
    const period = getFiscalPeriodForDate(effectiveDate);
    const retNumber = getNextDocumentNumber(isDraft ? 'SR-DFT' : 'SR', origInv.branch_id, period.fiscal_year_id);

    // Aggregate requested quantities by item to prevent duplicate line bypass
    const appliedReturnsByLine: Record<string, number> = {};
    let subtotal = new Decimal(0);
    let totalVat = new Decimal(0);
    let totalCogsReversed = new Decimal(0);
    const validatedItems: any[] = [];

    for (const it of items) {
      let origLine: any = null;
      if (it.originalInvoiceItemId || it.origLineId) {
        origLine = db.prepare(`
          SELECT sii.*, i.moving_avg_cost, i.name_ar as item_name, i.item_type
          FROM sales_invoice_items sii
          JOIN items i ON sii.item_id = i.id
          WHERE sii.id = ? AND sii.invoice_id = ?
        `).get(it.originalInvoiceItemId || it.origLineId, originalInvoiceId);
      }
      if (!origLine) {
        origLine = db.prepare(`
          SELECT sii.*, i.moving_avg_cost, i.name_ar as item_name, i.item_type
          FROM sales_invoice_items sii
          JOIN items i ON sii.item_id = i.id
          WHERE sii.invoice_id = ? AND sii.item_id = ?
          LIMIT 1
        `).get(originalInvoiceId, it.itemId);
      }

      if (!origLine) throw new Error(`الصنف ${it.itemId} غير مسجل بالفاتورة الأصلية.`);

      const returnQty = new Decimal(it.quantity);
      if (!returnQty.isFinite() || returnQty.isNegative() || returnQty.isZero()) {
        throw new Error('كمية المرتجع يجب أن تكون رقماً موجباً غير صفري.');
      }

      const previousReturnsOnLine = origLine.returned_quantity || 0;
      const alreadyAppliedThisReq = appliedReturnsByLine[origLine.id] || 0;
      const totalRequestedForLine = alreadyAppliedThisReq + returnQty.toNumber();

      if (previousReturnsOnLine + totalRequestedForLine > origLine.quantity) {
        const availableToReturn = Math.max(0, origLine.quantity - previousReturnsOnLine - alreadyAppliedThisReq);
        throw new Error(`الكمية المراد إرجاعها من الصنف "${origLine.item_name}" تتجاوز صافي الكمية المتاحة للإرجاع (${availableToReturn}). تم منع الإرجاع الزائد.`);
      }

      appliedReturnsByLine[origLine.id] = totalRequestedForLine;

      const origDiscountPerUnit = (origLine.discount_amount && origLine.quantity > 0)
        ? new Decimal(origLine.discount_amount).dividedBy(origLine.quantity)
        : new Decimal(0);
      const unitPriceAfterDiscount = new Decimal(origLine.unit_price).minus(origDiscountPerUnit);
      const lineNet = returnQty.times(unitPriceAfterDiscount);
      const lineVat = lineNet.times(new Decimal(origLine.tax_rate).dividedBy(100));
      const lineCost = origLine.item_type === 'stock'
        ? returnQty.times(origLine.cost_price || 0)
        : new Decimal(0);

      subtotal = subtotal.plus(lineNet);
      totalVat = totalVat.plus(lineVat);
      totalCogsReversed = totalCogsReversed.plus(lineCost);

      validatedItems.push({
        origLineId: origLine.id,
        itemId: origLine.item_id,
        itemType: origLine.item_type,
        quantity: returnQty.toNumber(),
        unitPrice: origLine.unit_price,
        unitCost: origLine.cost_price || 0,
        taxRate: origLine.tax_rate,
        taxAmount: lineVat.toNumber(),
        totalAmount: lineNet.plus(lineVat).toNumber()
      });
    }

    const totalWht = subtotal.times(0.01);
    const netReturnAmount = subtotal.plus(totalVat).minus(totalWht);
    const isCashRefund = refundType === 'cash';

    if (isDraft) {
      // Save Draft without GL or stock changes
      db.transaction(() => {
        db.prepare(`
          INSERT INTO sales_returns (
            id, return_number, original_invoice_id, branch_id, warehouse_id, customer_id,
            return_date, refund_type, subtotal, tax_amount, withholding_tax_amount,
            total_amount, refunded_cash_amount, cogs_reversed_amount, journal_entry_id, status, created_by, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'draft', ?, ?)
        `).run(
          retId, retNumber, originalInvoiceId, origInv.branch_id, warehouseId || origInv.warehouse_id, origInv.customer_id,
          effectiveDate, refundType || 'credit_note', subtotal.toNumber(), totalVat.toNumber(), totalWht.toNumber(),
          netReturnAmount.toNumber(), isCashRefund ? netReturnAmount.toNumber() : 0, totalCogsReversed.toNumber(),
          req.user!.id, notes || null
        );

        for (const it of validatedItems) {
          db.prepare(`
            INSERT INTO sales_return_items (
              id, return_id, original_invoice_item_id, item_id, unit_name, unit_factor,
              quantity, unit_price, unit_cost, tax_rate, tax_amount, total_amount
            ) VALUES (?, ?, ?, ?, 'قطعة', 1.0, ?, ?, ?, ?, ?, ?)
          `).run(
            `sri_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            retId, it.origLineId, it.itemId, it.quantity, it.unitPrice, it.unitCost, it.taxRate, it.taxAmount, it.totalAmount
          );
        }
      })();

      logAudit(req.user!.id, 'CREATE_DRAFT_SALES_RETURN', 'sales_returns', retId, `إنشاء مسودة مردود مبيعات ${retNumber}`);
      return res.json({ success: true, returnId: retId, returnNumber: retNumber, status: 'draft', message: 'تم حفظ مسودة مردود المبيعات بنجاح دون أي أثر مالي أو مخزني.' });
    }

    // Direct Post
    db.transaction(() => {
      const isAlex = origInv.branch_id === 'br_alex';
      const inventoryAccount = isAlex ? 'acc_1142' : 'acc_1141';

      const journalResult = postJournalEntry({
        docType: 'SALES_RET',
        docId: retId,
        docNumber: retNumber,
        entryDate: effectiveDate,
        postingDate: effectiveDate,
        branchId: origInv.branch_id,
        fiscalPeriodId: period.id,
        description: `مردود مبيعات رقم ${retNumber} للفاتورة ${origInv.invoice_number}`,
        createdBy: req.user!.id,
        lines: [
          { accountId: 'acc_4211', debit: subtotal.toNumber(), credit: 0, description: `مردودات مبيعات ${retNumber}` },
          { accountId: 'acc_2131', debit: totalVat.toNumber(), credit: 0, description: `عكس ضريبة مبيعات ${retNumber}` },
          { accountId: isCashRefund ? 'acc_1111' : 'acc_1121', partyId: isCashRefund ? null : origInv.customer_id, debit: 0, credit: netReturnAmount.toNumber(), description: `تسوية مردود مبيعات ${retNumber}` },
          { accountId: 'acc_1152', debit: 0, credit: totalWht.toNumber(), description: `عكس خصم وتحصيل ${retNumber}` },
          { accountId: inventoryAccount, debit: totalCogsReversed.toNumber(), credit: 0, description: `إعادة مخزون مرتجع مبيعات ${retNumber}` },
          { accountId: 'acc_5111', debit: 0, credit: totalCogsReversed.toNumber(), description: `عكس تكلفة مبيعات مرتجع ${retNumber}` }
        ]
      });

      db.prepare(`
        INSERT INTO sales_returns (
          id, return_number, original_invoice_id, branch_id, warehouse_id, customer_id,
          return_date, refund_type, subtotal, tax_amount, withholding_tax_amount,
          total_amount, refunded_cash_amount, cogs_reversed_amount, journal_entry_id, status, created_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?)
      `).run(
        retId, retNumber, originalInvoiceId, origInv.branch_id, warehouseId || origInv.warehouse_id, origInv.customer_id,
        effectiveDate, refundType || 'credit_note', subtotal.toNumber(), totalVat.toNumber(), totalWht.toNumber(),
        netReturnAmount.toNumber(), isCashRefund ? netReturnAmount.toNumber() : 0, totalCogsReversed.toNumber(),
        journalResult.entryId, req.user!.id, notes || null
      );

      if (!isCashRefund) {
        db.prepare(`
          UPDATE sales_invoices
          SET remaining_amount = MAX(0, remaining_amount - ?)
          WHERE id = ?
        `).run(netReturnAmount.toNumber(), originalInvoiceId);
      }

      for (const it of validatedItems) {
        db.prepare(`
          INSERT INTO sales_return_items (
            id, return_id, original_invoice_item_id, item_id, unit_name, unit_factor,
            quantity, unit_price, unit_cost, tax_rate, tax_amount, total_amount
          ) VALUES (?, ?, ?, ?, 'قطعة', 1.0, ?, ?, ?, ?, ?, ?)
        `).run(
          `sri_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          retId, it.origLineId, it.itemId, it.quantity, it.unitPrice, it.unitCost, it.taxRate, it.taxAmount, it.totalAmount
        );

        db.prepare(`
          UPDATE sales_invoice_items 
          SET returned_quantity = returned_quantity + ? 
          WHERE id = ?
        `).run(it.quantity, it.origLineId);

        db.prepare(`
          INSERT INTO warehouse_stock (warehouse_id, item_id, quantity)
          VALUES (?, ?, ?)
          ON CONFLICT(warehouse_id, item_id) DO UPDATE SET quantity = quantity + ?
        `).run(warehouseId || origInv.warehouse_id, it.itemId, it.quantity, it.quantity);
      }
    })();

    logAudit(req.user!.id, 'CREATE_SALES_RETURN', 'sales_returns', retId, `تسجيل مردود مبيعات ${retNumber}`);
    res.json({ success: true, returnId: retId, returnNumber: retNumber, status: 'posted', message: 'تم ترحيل واعتماد مردود المبيعات بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Edit Draft Sales Return
apiRouter.put('/sales/returns/:id', requireAuth, requirePermission('sales_returns.edit_draft'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM sales_returns WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'مردود المبيعات غير موجود.' });

  if (target.status !== 'draft') {
    return res.status(400).json({ error: 'لا يمكن تعديل مردود المبيعات بعد اعتماده وترحيله. التعديل متاح للمسودات فقط.' });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له مردود المبيعات خارج نطاق الفروع المصرح لك بها.' });
  }

  const { items, notes, returnDate, refundType } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'يجب إدخال بنود المردود.' });
  }

  try {
    const appliedReturnsByLine: Record<string, number> = {};
    let subtotal = new Decimal(0);
    let totalVat = new Decimal(0);
    let totalCogsReversed = new Decimal(0);
    const validatedItems: any[] = [];

    for (const it of items) {
      let origLine: any = null;
      if (it.originalInvoiceItemId || it.origLineId) {
        origLine = db.prepare(`
          SELECT sii.*, i.moving_avg_cost, i.name_ar as item_name, i.item_type
          FROM sales_invoice_items sii
          JOIN items i ON sii.item_id = i.id
          WHERE sii.id = ? AND sii.invoice_id = ?
        `).get(it.originalInvoiceItemId || it.origLineId, target.original_invoice_id);
      }
      if (!origLine) {
        origLine = db.prepare(`
          SELECT sii.*, i.moving_avg_cost, i.name_ar as item_name, i.item_type
          FROM sales_invoice_items sii
          JOIN items i ON sii.item_id = i.id
          WHERE sii.invoice_id = ? AND sii.item_id = ?
          LIMIT 1
        `).get(target.original_invoice_id, it.itemId);
      }

      if (!origLine) throw new Error(`الصنف ${it.itemId} غير مسجل بالفاتورة الأصلية.`);

      const returnQty = new Decimal(it.quantity);
      if (!returnQty.isFinite() || returnQty.isNegative() || returnQty.isZero()) {
        throw new Error('كمية المرتجع يجب أن تكون رقماً موجباً غير صفري.');
      }

      const previousReturnsOnLine = origLine.returned_quantity || 0;
      const alreadyAppliedThisReq = appliedReturnsByLine[origLine.id] || 0;
      const totalRequestedForLine = alreadyAppliedThisReq + returnQty.toNumber();

      if (previousReturnsOnLine + totalRequestedForLine > origLine.quantity) {
        const availableToReturn = Math.max(0, origLine.quantity - previousReturnsOnLine - alreadyAppliedThisReq);
        throw new Error(`الكمية المراد إرجاعها من الصنف "${origLine.item_name}" تتجاوز صافي الكمية المتاحة (${availableToReturn}).`);
      }

      appliedReturnsByLine[origLine.id] = totalRequestedForLine;

      const origDiscountPerUnit = (origLine.discount_amount && origLine.quantity > 0)
        ? new Decimal(origLine.discount_amount).dividedBy(origLine.quantity)
        : new Decimal(0);
      const unitPriceAfterDiscount = new Decimal(origLine.unit_price).minus(origDiscountPerUnit);
      const lineNet = returnQty.times(unitPriceAfterDiscount);
      const lineVat = lineNet.times(new Decimal(origLine.tax_rate).dividedBy(100));
      const lineCost = origLine.item_type === 'stock'
        ? returnQty.times(origLine.cost_price || 0)
        : new Decimal(0);

      subtotal = subtotal.plus(lineNet);
      totalVat = totalVat.plus(lineVat);
      totalCogsReversed = totalCogsReversed.plus(lineCost);

      validatedItems.push({
        origLineId: origLine.id,
        itemId: origLine.item_id,
        itemType: origLine.item_type,
        quantity: returnQty.toNumber(),
        unitPrice: origLine.unit_price,
        unitCost: origLine.cost_price || 0,
        taxRate: origLine.tax_rate,
        taxAmount: lineVat.toNumber(),
        totalAmount: lineNet.plus(lineVat).toNumber()
      });
    }

    const totalWht = subtotal.times(0.01);
    const netReturnAmount = subtotal.plus(totalVat).minus(totalWht);
    const effRefundType = refundType || target.refund_type;
    const isCashRefund = effRefundType === 'cash';

    db.transaction(() => {
      db.prepare(`
        UPDATE sales_returns
        SET return_date = COALESCE(?, return_date),
            refund_type = COALESCE(?, refund_type),
            subtotal = ?,
            tax_amount = ?,
            withholding_tax_amount = ?,
            total_amount = ?,
            refunded_cash_amount = ?,
            cogs_reversed_amount = ?,
            notes = COALESCE(?, notes)
        WHERE id = ?
      `).run(
        returnDate || null, effRefundType || null, subtotal.toNumber(), totalVat.toNumber(),
        totalWht.toNumber(), netReturnAmount.toNumber(), isCashRefund ? netReturnAmount.toNumber() : 0,
        totalCogsReversed.toNumber(), notes || null, target.id
      );

      db.prepare('DELETE FROM sales_return_items WHERE return_id = ?').run(target.id);
      for (const it of validatedItems) {
        db.prepare(`
          INSERT INTO sales_return_items (
            id, return_id, original_invoice_item_id, item_id, unit_name, unit_factor,
            quantity, unit_price, unit_cost, tax_rate, tax_amount, total_amount
          ) VALUES (?, ?, ?, ?, 'قطعة', 1.0, ?, ?, ?, ?, ?, ?)
        `).run(
          `sri_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          target.id, it.origLineId, it.itemId, it.quantity, it.unitPrice, it.unitCost, it.taxRate, it.taxAmount, it.totalAmount
        );
      }
    })();

    logAudit(req.user!.id, 'UPDATE_DRAFT_SALES_RETURN', 'sales_returns', target.id, `تعديل مسودة مردود مبيعات ${target.return_number}`);
    res.json({ success: true, message: 'تم تحديث مسودة مردود المبيعات بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Delete Draft Sales Return
apiRouter.delete('/sales/returns/:id', requireAuth, requirePermission('sales_returns.delete_draft'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM sales_returns WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'مردود المبيعات غير موجود.' });

  if (target.status !== 'draft') {
    return res.status(400).json({ error: 'لا يمكن حذف مردود المبيعات بعد اعتماده وترحيله.' });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له مردود المبيعات خارج نطاق الفروع المصرح لك بها.' });
  }

  try {
    db.transaction(() => {
      db.prepare('DELETE FROM sales_return_items WHERE return_id = ?').run(target.id);
      db.prepare('DELETE FROM sales_returns WHERE id = ?').run(target.id);
    })();

    logAudit(req.user!.id, 'DELETE_DRAFT_SALES_RETURN', 'sales_returns', target.id, `حذف مسودة مردود مبيعات ${target.return_number}`);
    res.json({ success: true, message: `تم حذف مسودة مردود المبيعات "${target.return_number}" بنجاح.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Post Draft Sales Return
apiRouter.post('/sales/returns/:id/post', requireAuth, requirePermission('sales_returns.post'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM sales_returns WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'مردود المبيعات غير موجود.' });

  if (target.status !== 'draft') {
    return res.status(400).json({ error: `المردود حالته الحالية (${target.status}) ولا يمكن إعادة ترحيله.` });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له مردود المبيعات خارج نطاق الفروع المصرح لك بها.' });
  }

  const items = db.prepare(`
    SELECT sri.*, i.item_type
    FROM sales_return_items sri
    JOIN items i ON sri.item_id = i.id
    WHERE sri.return_id = ?
  `).all(target.id) as any[];

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'لا يمكن ترحيل مردود مبيعات بدون بنود.' });
  }

  const origInv = db.prepare('SELECT * FROM sales_invoices WHERE id = ?').get(target.original_invoice_id) as any;
  if (!origInv) return res.status(404).json({ error: 'الفاتورة الأصلية غير موجودة.' });

  try {
    const period = getFiscalPeriodForDate(target.return_date);
    const postedNumber = getNextDocumentNumber('SR', target.branch_id, period.fiscal_year_id);
    const isCashRefund = target.refund_type === 'cash';

    // Verify current available return quantities
    for (const it of items) {
      const origLine = db.prepare('SELECT quantity, returned_quantity, item_id FROM sales_invoice_items WHERE id = ?').get(it.original_invoice_item_id) as any;
      if (!origLine) throw new Error(`سطر الفاتورة ${it.original_invoice_item_id} غير موجود.`);
      const remainingQty = origLine.quantity - (origLine.returned_quantity || 0);
      if (it.quantity > remainingQty) {
        throw new Error(`الكمية المتبقية المتاحة للإرجاع للصنف (${remainingQty}) أقل من كمية المرتجع (${it.quantity}).`);
      }
    }

    db.transaction(() => {
      const isAlex = target.branch_id === 'br_alex';
      const inventoryAccount = isAlex ? 'acc_1142' : 'acc_1141';

      const journalResult = postJournalEntry({
        docType: 'SALES_RET',
        docId: target.id,
        docNumber: postedNumber,
        entryDate: target.return_date,
        postingDate: target.return_date,
        branchId: target.branch_id,
        fiscalPeriodId: period.id,
        description: `مردود مبيعات رقم ${postedNumber} للفاتورة ${origInv.invoice_number}`,
        createdBy: req.user!.id,
        lines: [
          { accountId: 'acc_4211', debit: target.subtotal, credit: 0, description: `مردودات مبيعات ${postedNumber}` },
          { accountId: 'acc_2131', debit: target.tax_amount, credit: 0, description: `عكس ضريبة مبيعات ${postedNumber}` },
          { accountId: isCashRefund ? 'acc_1111' : 'acc_1121', partyId: isCashRefund ? null : target.customer_id, debit: 0, credit: target.total_amount, description: `تسوية مردود مبيعات ${postedNumber}` },
          { accountId: 'acc_1152', debit: 0, credit: target.withholding_tax_amount, description: `عكس خصم وتحصيل ${postedNumber}` },
          { accountId: inventoryAccount, debit: target.cogs_reversed_amount, credit: 0, description: `إعادة مخزون مرتجع مبيعات ${postedNumber}` },
          { accountId: 'acc_5111', debit: 0, credit: target.cogs_reversed_amount, description: `عكس تكلفة مبيعات مرتجع ${postedNumber}` }
        ]
      });

      db.prepare(`
        UPDATE sales_returns
        SET return_number = ?,
            status = 'posted',
            journal_entry_id = ?
        WHERE id = ?
      `).run(postedNumber, journalResult.entryId, target.id);

      if (!isCashRefund) {
        db.prepare(`
          UPDATE sales_invoices
          SET remaining_amount = MAX(0, remaining_amount - ?)
          WHERE id = ?
        `).run(target.total_amount, target.original_invoice_id);
      }

      for (const it of items) {
        db.prepare(`
          UPDATE sales_invoice_items 
          SET returned_quantity = returned_quantity + ? 
          WHERE id = ?
        `).run(it.quantity, it.original_invoice_item_id);

        if (it.item_type === 'stock') {
          db.prepare(`
            INSERT INTO warehouse_stock (warehouse_id, item_id, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(warehouse_id, item_id) DO UPDATE SET quantity = quantity + ?
          `).run(target.warehouse_id, it.item_id, it.quantity, it.quantity);
        }
      }
    })();

    logAudit(req.user!.id, 'POST_SALES_RETURN', 'sales_returns', target.id, `اعتماد وترحيل مردود المبيعات برقم ${postedNumber}`);
    res.json({ success: true, returnId: target.id, returnNumber: postedNumber, message: 'تم ترحيل واعتماد مردود المبيعات بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Reversal for Posted Sales Return
apiRouter.post('/sales/returns/:id/reverse', requireAuth, requirePermission('sales_returns.reverse'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM sales_returns WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'مردود المبيعات غير موجود.' });

  if (target.status !== 'posted') {
    return res.status(400).json({ error: 'يمكن إلغاء وعكس المردودات المرحلة فقط.' });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له مردود المبيعات خارج نطاق الفروع المصرح لك بها.' });
  }

  const items = db.prepare(`
    SELECT sri.*, i.item_type
    FROM sales_return_items sri
    JOIN items i ON sri.item_id = i.id
    WHERE sri.return_id = ?
  `).all(target.id) as any[];

  try {
    const period = getFiscalPeriodForDate(target.return_date);
    const reversalNumber = getNextDocumentNumber('REV-SR', target.branch_id, period.fiscal_year_id);
    const isAlex = target.branch_id === 'br_alex';
    const inventoryAccount = isAlex ? 'acc_1142' : 'acc_1141';
    const isCashRefund = target.refund_type === 'cash';

    db.transaction(() => {
      // Create reversal journal entry
      const journalResult = postJournalEntry({
        docType: 'REV_SR',
        docId: target.id,
        docNumber: reversalNumber,
        entryDate: new Date().toISOString().split('T')[0],
        postingDate: new Date().toISOString().split('T')[0],
        branchId: target.branch_id,
        fiscalPeriodId: period.id,
        description: `قيد عكسي لمردود المبيعات ${target.return_number}`,
        createdBy: req.user!.id,
        lines: [
          { accountId: 'acc_4211', debit: 0, credit: target.subtotal, description: `عكس مردودات مبيعات ${target.return_number}` },
          { accountId: 'acc_2131', debit: 0, credit: target.tax_amount, description: `إعادة إثبات ضريبة مبيعات ${target.return_number}` },
          { accountId: isCashRefund ? 'acc_1111' : 'acc_1121', partyId: isCashRefund ? null : target.customer_id, debit: target.total_amount, credit: 0, description: `عكس تسوية مردود ${target.return_number}` },
          { accountId: 'acc_1152', debit: target.withholding_tax_amount, credit: 0, description: `إعادة إثبات خصم وتحصيل ${target.return_number}` },
          { accountId: inventoryAccount, debit: 0, credit: target.cogs_reversed_amount, description: `عكس إعادة مخزون مرتجع ${target.return_number}` },
          { accountId: 'acc_5111', debit: target.cogs_reversed_amount, credit: 0, description: `إعادة إثبات تكلفة مبيعات ${target.return_number}` }
        ]
      });

      db.prepare(`
        UPDATE sales_returns
        SET status = 'reversed',
            notes = COALESCE(notes || ' | ', '') || 'تم العكس بالقيد ' || ?
        WHERE id = ?
      `).run(journalResult.entryNumber, target.id);

      if (!isCashRefund) {
        db.prepare(`
          UPDATE sales_invoices
          SET remaining_amount = remaining_amount + ?
          WHERE id = ?
        `).run(target.total_amount, target.original_invoice_id);
      }

      for (const it of items) {
        if (it.original_invoice_item_id) {
          db.prepare(`
            UPDATE sales_invoice_items
            SET returned_quantity = MAX(0, returned_quantity - ?)
            WHERE id = ?
          `).run(it.quantity, it.original_invoice_item_id);
        }

        if (it.item_type === 'stock') {
          db.prepare(`
            UPDATE warehouse_stock
            SET quantity = MAX(0, quantity - ?)
            WHERE warehouse_id = ? AND item_id = ?
          `).run(it.quantity, target.warehouse_id, it.item_id);
        }
      }
    })();

    logAudit(req.user!.id, 'REVERSE_SALES_RETURN', 'sales_returns', target.id, `عكس مردود المبيعات ${target.return_number}`);
    res.json({ success: true, message: `تم عكس مردود المبيعات "${target.return_number}" بنجاح.` });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 11. Purchase Returns (مردودات المشتريات - دورة المسودة والترحيل الكاملة)
// ----------------------------------------------------
apiRouter.get('/purchases/returns', requireAuth, requirePermission('purchase_returns.view'), (req: AuthenticatedRequest, res) => {
  let branchFilter = '';
  const params: any[] = [];
  if (req.user?.role !== 'owner' && req.user?.allowed_branch_ids !== '*') {
    try {
      const branches: string[] = JSON.parse(req.user?.allowed_branch_ids || '[]');
      if (branches.length > 0) {
        branchFilter = `WHERE pr.branch_id IN (${branches.map(() => '?').join(',')})`;
        params.push(...branches);
      } else {
        branchFilter = 'WHERE 1=0';
      }
    } catch {
      branchFilter = 'WHERE 1=0';
    }
  }

  const returns = db.prepare(`
    SELECT pr.*, p.name_ar as supplier_name, b.name_ar as branch_name, w.name_ar as warehouse_name,
           pi.invoice_number as original_invoice_number
    FROM purchase_returns pr
    JOIN parties p ON pr.supplier_id = p.id
    JOIN branches b ON pr.branch_id = b.id
    JOIN warehouses w ON pr.warehouse_id = w.id
    LEFT JOIN purchase_invoices pi ON pr.original_invoice_id = pi.id
    ${branchFilter}
    ORDER BY pr.return_date DESC, pr.return_number DESC
  `).all(...params);
  res.json({ returns });
});

apiRouter.get('/purchases/returns/:id', requireAuth, requirePermission('purchase_returns.view'), (req: AuthenticatedRequest, res) => {
  const returnDoc = db.prepare(`
    SELECT pr.*, p.name_ar as supplier_name, b.name_ar as branch_name, w.name_ar as warehouse_name,
           pi.invoice_number as original_invoice_number, je.entry_number as journal_number
    FROM purchase_returns pr
    JOIN parties p ON pr.supplier_id = p.id
    JOIN branches b ON pr.branch_id = b.id
    JOIN warehouses w ON pr.warehouse_id = w.id
    LEFT JOIN purchase_invoices pi ON pr.original_invoice_id = pi.id
    LEFT JOIN journal_entries je ON pr.journal_entry_id = je.id
    WHERE pr.id = ?
  `).get(req.params.id) as any;

  if (!returnDoc) return res.status(404).json({ error: 'مردود المشتريات غير موجود.' });

  if (!isBranchAllowed(req.user, returnDoc.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له مردود المشتريات خارج نطاق الفروع المصرح لك بها.' });
  }

  const items = db.prepare(`
    SELECT pri.*, i.name_ar as item_name, i.code as item_code, i.barcode, i.item_type
    FROM purchase_return_items pri
    JOIN items i ON pri.item_id = i.id
    WHERE pri.return_id = ?
  `).all(req.params.id);

  returnDoc.items = items;
  res.json({ returnDoc });
});

apiRouter.post('/purchases/returns', requireAuth, (req: AuthenticatedRequest, res) => {
  const { originalInvoiceId, warehouseId, returnDate, items, notes, status } = req.body;

  if (!originalInvoiceId || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'بيانات مردود المشتريات غير مكتملة.' });
  }

  const origInv = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(originalInvoiceId) as any;
  if (!origInv) return res.status(404).json({ error: 'فاتورة الشراء الأصلية غير موجودة.' });

  if (!isBranchAllowed(req.user, origInv.branch_id)) {
    return res.status(403).json({ error: 'غير مصرح لك بإصدار مردودات في هذا الفرع.' });
  }

  const isDraft = status === 'draft';
  if (!isDraft) {
    if (!req.user?.role || (req.user.role !== 'owner' && !req.user.permissions.includes('purchase_returns.post') && !req.user.permissions.includes('*'))) {
      return res.status(403).json({ error: 'لا تملك صلاحية اعتماد وترحيل مردودات المشتريات (purchase_returns.post).' });
    }
  } else {
    if (!req.user?.role || (req.user.role !== 'owner' && !req.user.permissions.includes('purchase_returns.create') && !req.user.permissions.includes('purchase_returns.edit_draft') && !req.user.permissions.includes('*'))) {
      return res.status(403).json({ error: 'لا تملك صلاحية إنشاء مسودات مردودات المشتريات (purchase_returns.create).' });
    }
  }

  try {
    const retId = `pret_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const effectiveDate = returnDate || new Date().toISOString().split('T')[0];
    const period = getFiscalPeriodForDate(effectiveDate);
    const retNumber = getNextDocumentNumber(isDraft ? 'PR-DFT' : 'PR', origInv.branch_id, period.fiscal_year_id);

    let subtotal = new Decimal(0);
    let totalVat = new Decimal(0);
    const validatedItems: any[] = [];
    const appliedReturnsByLine: Record<string, number> = {};

    for (const it of items) {
      let origLine: any = null;
      if (it.originalInvoiceItemId || it.origLineId) {
        origLine = db.prepare(`
          SELECT pii.*, i.name_ar as item_name, i.item_type
          FROM purchase_invoice_items pii
          JOIN items i ON pii.item_id = i.id
          WHERE pii.id = ? AND pii.invoice_id = ?
        `).get(it.originalInvoiceItemId || it.origLineId, originalInvoiceId);
      }
      if (!origLine) {
        origLine = db.prepare(`
          SELECT pii.*, i.name_ar as item_name, i.item_type
          FROM purchase_invoice_items pii
          JOIN items i ON pii.item_id = i.id
          WHERE pii.invoice_id = ? AND pii.item_id = ?
          LIMIT 1
        `).get(originalInvoiceId, it.itemId);
      }

      if (!origLine) throw new Error(`الصنف ${it.itemId} غير مسجل بالفاتورة الأصلية.`);

      const returnQty = new Decimal(it.quantity);
      if (!returnQty.isFinite() || returnQty.isNegative() || returnQty.isZero()) {
        throw new Error('الكمية المراد إرجاعها يجب أن تكون رقماً موجباً.');
      }

      const previousReturnsOnLine = origLine.returned_quantity || 0;
      const alreadyAppliedThisReq = appliedReturnsByLine[origLine.id] || 0;
      const totalRequestedForLine = alreadyAppliedThisReq + returnQty.toNumber();

      if (previousReturnsOnLine + totalRequestedForLine > origLine.quantity) {
        const availableToReturn = Math.max(0, origLine.quantity - previousReturnsOnLine - alreadyAppliedThisReq);
        throw new Error(`الكمية المراد إرجاعها من الصنف "${origLine.item_name}" تتجاوز صافي الكمية المشتراة المتاحة (${availableToReturn}).`);
      }

      appliedReturnsByLine[origLine.id] = totalRequestedForLine;

      if (!isDraft && origLine.item_type === 'stock') {
        // Stock check only when posting stock items
        const stockRow = db.prepare('SELECT quantity FROM warehouse_stock WHERE warehouse_id = ? AND item_id = ?').get(warehouseId || origInv.warehouse_id, it.itemId) as any;
        const currentStock = stockRow ? stockRow.quantity : 0;
        if (currentStock < returnQty.toNumber()) {
          throw new Error(`رصيد المخزن الحالي (${currentStock}) غير كافٍ لإرجاع كمية (${returnQty.toNumber()}) من الصنف "${origLine.item_name}".`);
        }
      }

      const unitPrice = new Decimal(origLine.unit_price);
      const lineNet = returnQty.times(unitPrice);
      const lineVat = lineNet.times(new Decimal(origLine.tax_rate).dividedBy(100));

      subtotal = subtotal.plus(lineNet);
      totalVat = totalVat.plus(lineVat);

      validatedItems.push({
        origLineId: origLine.id,
        itemId: it.itemId,
        itemType: origLine.item_type,
        quantity: returnQty.toNumber(),
        unitPrice: origLine.unit_price,
        taxRate: origLine.tax_rate,
        taxAmount: lineVat.toNumber(),
        totalAmount: lineNet.plus(lineVat).toNumber()
      });
    }

    const totalWht = subtotal.times(0.01);
    const netReturnAmount = subtotal.plus(totalVat).minus(totalWht);

    if (isDraft) {
      // Save Draft without GL or stock changes
      db.transaction(() => {
        db.prepare(`
          INSERT INTO purchase_returns (
            id, return_number, original_invoice_id, branch_id, warehouse_id, supplier_id,
            return_date, subtotal, tax_amount, withholding_tax_amount, total_amount,
            journal_entry_id, status, created_by, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'draft', ?, ?)
        `).run(
          retId, retNumber, originalInvoiceId, origInv.branch_id, warehouseId || origInv.warehouse_id, origInv.supplier_id,
          effectiveDate, subtotal.toNumber(), totalVat.toNumber(), totalWht.toNumber(), netReturnAmount.toNumber(),
          req.user!.id, notes || null
        );

        for (const it of validatedItems) {
          db.prepare(`
            INSERT INTO purchase_return_items (
              id, return_id, original_invoice_item_id, item_id, quantity, unit_price, tax_rate, tax_amount, total_amount
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            `pri_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            retId, it.origLineId, it.itemId, it.quantity, it.unitPrice, it.taxRate, it.taxAmount, it.totalAmount
          );
        }
      })();

      logAudit(req.user!.id, 'CREATE_DRAFT_PURCHASE_RETURN', 'purchase_returns', retId, `إنشاء مسودة مردود مشتريات ${retNumber}`);
      return res.json({ success: true, returnId: retId, returnNumber: retNumber, status: 'draft', message: 'تم حفظ مسودة مردود المشتريات بنجاح دون أي أثر على المخزون أو الحسابات.' });
    }

    // Direct Post
    db.transaction(() => {
      const isAlex = origInv.branch_id === 'br_alex';
      const inventoryAccount = isAlex ? 'acc_1142' : 'acc_1141';

      const journalResult = postJournalEntry({
        docType: 'PUR_RET',
        docId: retId,
        docNumber: retNumber,
        entryDate: effectiveDate,
        postingDate: effectiveDate,
        branchId: origInv.branch_id,
        fiscalPeriodId: period.id,
        description: `مردود مشتريات رقم ${retNumber} لفاتورة الشراء ${origInv.invoice_number}`,
        createdBy: req.user!.id,
        lines: [
          { accountId: 'acc_2111', partyId: origInv.supplier_id, debit: netReturnAmount.toNumber(), credit: 0, description: `تخفيض مديونية المورد بموجب مردود ${retNumber}` },
          { accountId: 'acc_2132', debit: totalWht.toNumber(), credit: 0, description: `عكس خصم وتحصيل مشتريات ${retNumber}` },
          { accountId: inventoryAccount, debit: 0, credit: subtotal.toNumber(), description: `خصم مخزون بضاعة مرتجعة للمورد ${retNumber}` },
          { accountId: 'acc_1151', debit: 0, credit: totalVat.toNumber(), description: `عكس ضريبة مدخلات مشتريات ${retNumber}` }
        ]
      });

      db.prepare(`
        INSERT INTO purchase_returns (
          id, return_number, original_invoice_id, branch_id, warehouse_id, supplier_id,
          return_date, subtotal, tax_amount, withholding_tax_amount, total_amount,
          journal_entry_id, status, created_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?)
      `).run(
        retId, retNumber, originalInvoiceId, origInv.branch_id, warehouseId || origInv.warehouse_id, origInv.supplier_id,
        effectiveDate, subtotal.toNumber(), totalVat.toNumber(), totalWht.toNumber(), netReturnAmount.toNumber(),
        journalResult.entryId, req.user!.id, notes || null
      );

      db.prepare(`
        UPDATE purchase_invoices
        SET remaining_amount = MAX(0, remaining_amount - ?)
        WHERE id = ?
      `).run(netReturnAmount.toNumber(), originalInvoiceId);

      for (const it of validatedItems) {
        db.prepare(`
          INSERT INTO purchase_return_items (
            id, return_id, original_invoice_item_id, item_id, quantity, unit_price, tax_rate, tax_amount, total_amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `pri_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          retId, it.origLineId, it.itemId, it.quantity, it.unitPrice, it.taxRate, it.taxAmount, it.totalAmount
        );

        db.prepare(`
          UPDATE purchase_invoice_items 
          SET returned_quantity = returned_quantity + ? 
          WHERE id = ?
        `).run(it.quantity, it.origLineId);

        if (it.itemType === 'stock') {
          db.prepare(`
            UPDATE warehouse_stock 
            SET quantity = quantity - ? 
            WHERE warehouse_id = ? AND item_id = ?
          `).run(it.quantity, warehouseId || origInv.warehouse_id, it.itemId);
        }
      }
    })();

    logAudit(req.user!.id, 'CREATE_PURCHASE_RETURN', 'purchase_returns', retId, `تسجيل مردود مشتريات ${retNumber}`);
    res.json({ success: true, returnId: retId, returnNumber: retNumber, status: 'posted', message: 'تم ترحيل واعتماد مردود المشتريات بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Edit Draft Purchase Return
apiRouter.put('/purchases/returns/:id', requireAuth, requirePermission('purchase_returns.edit_draft'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM purchase_returns WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'مردود المشتريات غير موجود.' });

  if (target.status !== 'draft') {
    return res.status(400).json({ error: 'لا يمكن تعديل مردود المشتريات بعد اعتماده وترحيله. التعديل متاح للمسودات فقط.' });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له مسودة مردود المشتريات خارج نطاق الفروع المصرح لك بها.' });
  }

  const { items, notes, returnDate } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'يجب إدخال بنود المردود.' });
  }

  try {
    let subtotal = new Decimal(0);
    let totalVat = new Decimal(0);
    const validatedItems: any[] = [];
    const appliedReturnsByLine: Record<string, number> = {};

    for (const it of items) {
      let origLine: any = null;
      if (it.originalInvoiceItemId || it.origLineId) {
        origLine = db.prepare(`
          SELECT pii.*, i.name_ar as item_name, i.item_type
          FROM purchase_invoice_items pii
          JOIN items i ON pii.item_id = i.id
          WHERE pii.id = ? AND pii.invoice_id = ?
        `).get(it.originalInvoiceItemId || it.origLineId, target.original_invoice_id);
      }
      if (!origLine) {
        origLine = db.prepare(`
          SELECT pii.*, i.name_ar as item_name, i.item_type
          FROM purchase_invoice_items pii
          JOIN items i ON pii.item_id = i.id
          WHERE pii.invoice_id = ? AND pii.item_id = ?
          LIMIT 1
        `).get(target.original_invoice_id, it.itemId);
      }

      if (!origLine) throw new Error(`الصنف ${it.itemId} غير مسجل بالفاتورة الأصلية.`);

      const returnQty = new Decimal(it.quantity);
      if (!returnQty.isFinite() || returnQty.isNegative() || returnQty.isZero()) {
        throw new Error('الكمية المراد إرجاعها يجب أن تكون رقماً موجباً.');
      }

      const previousReturnsOnLine = origLine.returned_quantity || 0;
      const alreadyAppliedThisReq = appliedReturnsByLine[origLine.id] || 0;
      const totalRequestedForLine = alreadyAppliedThisReq + returnQty.toNumber();

      if (previousReturnsOnLine + totalRequestedForLine > origLine.quantity) {
        const availableToReturn = Math.max(0, origLine.quantity - previousReturnsOnLine - alreadyAppliedThisReq);
        throw new Error(`الكمية المراد إرجاعها من الصنف "${origLine.item_name}" تتجاوز صافي الكمية المتاحة (${availableToReturn}).`);
      }

      appliedReturnsByLine[origLine.id] = totalRequestedForLine;

      const unitPrice = new Decimal(origLine.unit_price);
      const lineNet = returnQty.times(unitPrice);
      const lineVat = lineNet.times(new Decimal(origLine.tax_rate).dividedBy(100));

      subtotal = subtotal.plus(lineNet);
      totalVat = totalVat.plus(lineVat);

      validatedItems.push({
        origLineId: origLine.id,
        itemId: it.itemId,
        itemType: origLine.item_type,
        quantity: returnQty.toNumber(),
        unitPrice: origLine.unit_price,
        taxRate: origLine.tax_rate,
        taxAmount: lineVat.toNumber(),
        totalAmount: lineNet.plus(lineVat).toNumber()
      });
    }

    const totalWht = subtotal.times(0.01);
    const netReturnAmount = subtotal.plus(totalVat).minus(totalWht);

    db.transaction(() => {
      db.prepare(`
        UPDATE purchase_returns
        SET return_date = COALESCE(?, return_date),
            subtotal = ?,
            tax_amount = ?,
            withholding_tax_amount = ?,
            total_amount = ?,
            notes = COALESCE(?, notes)
        WHERE id = ?
      `).run(
        returnDate || null, subtotal.toNumber(), totalVat.toNumber(),
        totalWht.toNumber(), netReturnAmount.toNumber(), notes || null, target.id
      );

      db.prepare('DELETE FROM purchase_return_items WHERE return_id = ?').run(target.id);
      for (const it of validatedItems) {
        db.prepare(`
          INSERT INTO purchase_return_items (
            id, return_id, original_invoice_item_id, item_id, quantity, unit_price, tax_rate, tax_amount, total_amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `pri_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          target.id, it.origLineId, it.itemId, it.quantity, it.unitPrice, it.taxRate, it.taxAmount, it.totalAmount
        );
      }
    })();

    logAudit(req.user!.id, 'UPDATE_DRAFT_PURCHASE_RETURN', 'purchase_returns', target.id, `تعديل مسودة مردود مشتريات ${target.return_number}`);
    res.json({ success: true, message: 'تم تحديث مسودة مردود المشتريات بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Delete Draft Purchase Return
apiRouter.delete('/purchases/returns/:id', requireAuth, requirePermission('purchase_returns.delete_draft'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM purchase_returns WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'مردود المشتريات غير موجود.' });

  if (target.status !== 'draft') {
    return res.status(400).json({ error: 'لا يمكن حذف مردود المشتريات بعد اعتماده وترحيله.' });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له مسودة مردود المشتريات خارج نطاق الفروع المصرح لك بها.' });
  }

  try {
    db.transaction(() => {
      db.prepare('DELETE FROM purchase_return_items WHERE return_id = ?').run(target.id);
      db.prepare('DELETE FROM purchase_returns WHERE id = ?').run(target.id);
    })();

    logAudit(req.user!.id, 'DELETE_DRAFT_PURCHASE_RETURN', 'purchase_returns', target.id, `حذف مسودة مردود مشتريات ${target.return_number}`);
    res.json({ success: true, message: `تم حذف مسودة مردود المشتريات "${target.return_number}" بنجاح.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Post Draft Purchase Return
apiRouter.post('/purchases/returns/:id/post', requireAuth, requirePermission('purchase_returns.post'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM purchase_returns WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'مردود المشتريات غير موجود.' });

  if (target.status !== 'draft') {
    return res.status(400).json({ error: `المردود حالته الحالية (${target.status}) ولا يمكن إعادة ترحيله.` });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له مردود المشتريات خارج نطاق الفروع المصرح لك بها.' });
  }

  const items = db.prepare(`
    SELECT pri.*, i.item_type
    FROM purchase_return_items pri
    JOIN items i ON pri.item_id = i.id
    WHERE pri.return_id = ?
  `).all(target.id) as any[];

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'لا يمكن ترحيل مردود مشتريات بدون بنود.' });
  }

  const origInv = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(target.original_invoice_id) as any;
  if (!origInv) return res.status(404).json({ error: 'فاتورة الشراء الأصلية غير موجودة.' });

  try {
    const period = getFiscalPeriodForDate(target.return_date);
    const postedNumber = getNextDocumentNumber('PR', target.branch_id, period.fiscal_year_id);

    // Verify stock and remaining returnable quantity per line
    for (const it of items) {
      let origLine: any = null;
      if (it.original_invoice_item_id) {
        origLine = db.prepare('SELECT id, quantity, returned_quantity FROM purchase_invoice_items WHERE id = ?').get(it.original_invoice_item_id) as any;
      }
      if (!origLine) {
        origLine = db.prepare('SELECT id, quantity, returned_quantity FROM purchase_invoice_items WHERE invoice_id = ? AND item_id = ? LIMIT 1').get(target.original_invoice_id, it.item_id) as any;
      }
      if (!origLine) throw new Error(`الصنف ${it.item_id} غير موجود بالفاتورة الأصلية.`);

      const remainingQty = origLine.quantity - (origLine.returned_quantity || 0);
      if (it.quantity > remainingQty) {
        throw new Error(`الكمية المتبقية المتاحة للإرجاع للصنف (${remainingQty}) أقل من كمية المرتجع (${it.quantity}).`);
      }

      if (it.item_type === 'stock') {
        const stockRow = db.prepare('SELECT quantity FROM warehouse_stock WHERE warehouse_id = ? AND item_id = ?').get(target.warehouse_id, it.item_id) as any;
        const currentStock = stockRow ? stockRow.quantity : 0;
        if (currentStock < it.quantity) {
          throw new Error(`رصيد المخزن الحالي (${currentStock}) غير كافٍ لإرجاع كمية (${it.quantity}) للمورد.`);
        }
      }
    }

    db.transaction(() => {
      const isAlex = target.branch_id === 'br_alex';
      const inventoryAccount = isAlex ? 'acc_1142' : 'acc_1141';

      const journalResult = postJournalEntry({
        docType: 'PUR_RET',
        docId: target.id,
        docNumber: postedNumber,
        entryDate: target.return_date,
        postingDate: target.return_date,
        branchId: target.branch_id,
        fiscalPeriodId: period.id,
        description: `مردود مشتريات رقم ${postedNumber} لفاتورة الشراء ${origInv.invoice_number}`,
        createdBy: req.user!.id,
        lines: [
          { accountId: 'acc_2111', partyId: target.supplier_id, debit: target.total_amount, credit: 0, description: `تخفيض مديونية المورد بموجب مردود ${postedNumber}` },
          { accountId: 'acc_2132', debit: target.withholding_tax_amount, credit: 0, description: `عكس خصم وتحصيل مشتريات ${postedNumber}` },
          { accountId: inventoryAccount, debit: 0, credit: target.subtotal, description: `خصم مخزون بضاعة مرتجعة للمورد ${postedNumber}` },
          { accountId: 'acc_1151', debit: 0, credit: target.tax_amount, description: `عكس ضريبة مدخلات مشتريات ${postedNumber}` }
        ]
      });

      db.prepare(`
        UPDATE purchase_returns
        SET return_number = ?,
            status = 'posted',
            journal_entry_id = ?
        WHERE id = ?
      `).run(postedNumber, journalResult.entryId, target.id);

      db.prepare(`
        UPDATE purchase_invoices
        SET remaining_amount = MAX(0, remaining_amount - ?)
        WHERE id = ?
      `).run(target.total_amount, target.original_invoice_id);

      for (const it of items) {
        if (it.original_invoice_item_id) {
          db.prepare(`
            UPDATE purchase_invoice_items 
            SET returned_quantity = returned_quantity + ? 
            WHERE id = ?
          `).run(it.quantity, it.original_invoice_item_id);
        } else {
          db.prepare(`
            UPDATE purchase_invoice_items 
            SET returned_quantity = returned_quantity + ? 
            WHERE invoice_id = ? AND item_id = ?
          `).run(it.quantity, target.original_invoice_id, it.item_id);
        }

        if (it.item_type === 'stock') {
          db.prepare(`
            UPDATE warehouse_stock 
            SET quantity = quantity - ? 
            WHERE warehouse_id = ? AND item_id = ?
          `).run(it.quantity, target.warehouse_id, it.item_id);
        }
      }
    })();

    logAudit(req.user!.id, 'POST_PURCHASE_RETURN', 'purchase_returns', target.id, `اعتماد وترحيل مردود المشتريات برقم ${postedNumber}`);
    res.json({ success: true, returnId: target.id, returnNumber: postedNumber, message: 'تم ترحيل واعتماد مردود المشتريات بنجاح.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Reversal for Posted Purchase Return
apiRouter.post('/purchases/returns/:id/reverse', requireAuth, requirePermission('purchase_returns.reverse'), (req: AuthenticatedRequest, res) => {
  const target = db.prepare('SELECT * FROM purchase_returns WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'مردود المشتريات غير موجود.' });

  if (target.status !== 'posted') {
    return res.status(400).json({ error: 'يمكن إلغاء وعكس المردودات المرحلة فقط.' });
  }

  if (!isBranchAllowed(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'الفرع التابع له مردود المشتريات خارج نطاق الفروع المصرح لك بها.' });
  }

  const items = db.prepare(`
    SELECT pri.*, i.item_type
    FROM purchase_return_items pri
    JOIN items i ON pri.item_id = i.id
    WHERE pri.return_id = ?
  `).all(target.id) as any[];

  try {
    const period = getFiscalPeriodForDate(target.return_date);
    const reversalNumber = getNextDocumentNumber('REV-PR', target.branch_id, period.fiscal_year_id);
    const isAlex = target.branch_id === 'br_alex';
    const inventoryAccount = isAlex ? 'acc_1142' : 'acc_1141';

    db.transaction(() => {
      // Create reversal journal entry
      const journalResult = postJournalEntry({
        docType: 'REV_PR',
        docId: target.id,
        docNumber: reversalNumber,
        entryDate: new Date().toISOString().split('T')[0],
        postingDate: new Date().toISOString().split('T')[0],
        branchId: target.branch_id,
        fiscalPeriodId: period.id,
        description: `قيد عكسي لمردود المشتريات ${target.return_number}`,
        createdBy: req.user!.id,
        lines: [
          { accountId: 'acc_2111', partyId: target.supplier_id, debit: 0, credit: target.total_amount, description: `إعادة مديونية المورد بموجب عكس مردود ${target.return_number}` },
          { accountId: 'acc_2132', debit: 0, credit: target.withholding_tax_amount, description: `إعادة خصم وتحصيل ${target.return_number}` },
          { accountId: inventoryAccount, debit: target.subtotal, credit: 0, description: `إعادة مخزون بضاعة مشتريات ${target.return_number}` },
          { accountId: 'acc_1151', debit: target.tax_amount, credit: 0, description: `إعادة ضريبة مدخلات ${target.return_number}` }
        ]
      });

      db.prepare(`
        UPDATE purchase_returns
        SET status = 'reversed',
            notes = COALESCE(notes || ' | ', '') || 'تم العكس بالقيد ' || ?
        WHERE id = ?
      `).run(journalResult.entryNumber, target.id);

      db.prepare(`
        UPDATE purchase_invoices
        SET remaining_amount = remaining_amount + ?
        WHERE id = ?
      `).run(target.total_amount, target.original_invoice_id);

      for (const it of items) {
        if (it.original_invoice_item_id) {
          db.prepare(`
            UPDATE purchase_invoice_items 
            SET returned_quantity = MAX(0, returned_quantity - ?) 
            WHERE id = ?
          `).run(it.quantity, it.original_invoice_item_id);
        } else {
          db.prepare(`
            UPDATE purchase_invoice_items 
            SET returned_quantity = MAX(0, returned_quantity - ?) 
            WHERE invoice_id = ? AND item_id = ?
          `).run(it.quantity, target.original_invoice_id, it.item_id);
        }

        if (it.item_type === 'stock') {
          db.prepare(`
            INSERT INTO warehouse_stock (warehouse_id, item_id, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(warehouse_id, item_id) DO UPDATE SET quantity = quantity + ?
          `).run(target.warehouse_id, it.item_id, it.quantity, it.quantity);
        }
      }
    })();

    logAudit(req.user!.id, 'REVERSE_PURCHASE_RETURN', 'purchase_returns', target.id, `عكس مردود المشتريات ${target.return_number}`);
    res.json({ success: true, message: `تم عكس مردود المشتريات "${target.return_number}" بنجاح.` });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 12. Treasury & Vouchers with Real Allocations
// ----------------------------------------------------
apiRouter.get('/treasury/vouchers', requireAuth, requirePermission('treasury.view'), (req, res) => {
  const vouchers = db.prepare(`
    SELECT pv.*, b.name_ar as branch_name, p.name_ar as party_name,
           cb.name_ar as cashbox_name, ba.bank_name, je.entry_number as journal_number
    FROM payment_vouchers pv
    JOIN branches b ON pv.branch_id = b.id
    LEFT JOIN parties p ON pv.party_id = p.id
    LEFT JOIN cash_boxes cb ON pv.cash_box_id = cb.id
    LEFT JOIN bank_accounts ba ON pv.bank_account_id = ba.id
    LEFT JOIN journal_entries je ON pv.journal_entry_id = je.id
    ORDER BY pv.voucher_date DESC, pv.voucher_number DESC
  `).all();

  res.json({ vouchers });
});

apiRouter.get('/treasury/vouchers/:id', requireAuth, requirePermission('treasury.view'), (req, res) => {
  const voucher = db.prepare(`
    SELECT pv.*, b.name_ar as branch_name, p.name_ar as party_name, p.code as party_code,
           cb.name_ar as cashbox_name, ba.bank_name, je.entry_number as journal_number
    FROM payment_vouchers pv
    JOIN branches b ON pv.branch_id = b.id
    LEFT JOIN parties p ON pv.party_id = p.id
    LEFT JOIN cash_boxes cb ON pv.cash_box_id = cb.id
    LEFT JOIN bank_accounts ba ON pv.bank_account_id = ba.id
    LEFT JOIN journal_entries je ON pv.journal_entry_id = je.id
    WHERE pv.id = ?
  `).get(req.params.id) as any;

  if (!voucher) return res.status(404).json({ error: 'السند غير موجود.' });

  const allocations = db.prepare(`
    SELECT va.*,
      CASE 
        WHEN va.invoice_type = 'sales_invoice' THEN (SELECT invoice_number FROM sales_invoices WHERE id = va.invoice_id)
        ELSE (SELECT invoice_number FROM purchase_invoices WHERE id = va.invoice_id)
      END as invoice_number
    FROM voucher_allocations va
    WHERE va.voucher_id = ?
  `).all(voucher.id);

  res.json({ voucher, allocations });
});

apiRouter.post('/treasury/vouchers', requireAuth, (req: AuthenticatedRequest, res) => {
  const { voucherType, branchId, paymentMethod, cashBoxId, bankAccountId, partyId, directAccountId, voucherDate, amount, description, allocations } = req.body;

  if (!voucherType || !['receipt', 'payment'].includes(voucherType)) {
    return res.status(400).json({ error: 'نوع السند غير صحيح (يجب أن يكون قبض أو دفع).' });
  }

  // Strict independent permission check for receipt vs payment
  if (req.user!.role !== 'owner') {
    const userPerms = req.user!.permissions || [];
    if (voucherType === 'receipt') {
      const canReceipt = userPerms.includes('treasury.receipt.create') || userPerms.includes('treasury.receipt') || userPerms.includes('*');
      if (!canReceipt) {
        return res.status(403).json({ error: 'لا تملك صلاحية إصدار سندات القبض (treasury.receipt.create).' });
      }
    } else if (voucherType === 'payment') {
      const canPayment = userPerms.includes('treasury.payment.create') || userPerms.includes('treasury.payment') || userPerms.includes('*');
      if (!canPayment) {
        return res.status(403).json({ error: 'لا تملك صلاحية إصدار سندات الدفع والصرف (treasury.payment.create).' });
      }
    }
  }

  const numAmount = Number(amount);
  if (!branchId || !Number.isFinite(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'البيانات الأساسية للسند غير مكتملة أو المبلغ غير صحيح (يجب أن يكون المبلغ موجباً).' });
  }

  if (!isBranchAllowed(req.user, branchId)) {
    return res.status(403).json({ error: 'الفرع المحدد خارج نطاق الفروع المصرح لك بها.' });
  }

  const effectiveDate = voucherDate || new Date().toISOString().split('T')[0];
  const period = getFiscalPeriodForDate(effectiveDate);
  if (period.is_closed === 1) {
    return res.status(400).json({ error: `الفترة المالية المقابلة لتاريخ السند (${effectiveDate}) مقفلة ولا يمكن الترحيل فيها.` });
  }

  // Validate cashbox or bank account strictly
  let treasuryAccount = '';
  if (paymentMethod === 'bank_transfer' || (!cashBoxId && bankAccountId)) {
    if (!bankAccountId) {
      return res.status(400).json({ error: 'يرجى اختيار الحساب البنكي عند التحويل البنكي.' });
    }
    const bank = db.prepare('SELECT id, account_id FROM bank_accounts WHERE id = ?').get(bankAccountId) as any;
    if (!bank) return res.status(400).json({ error: 'الحساب البنكي المحدد غير موجود.' });
    treasuryAccount = bank.account_id;
  } else {
    if (!cashBoxId) return res.status(400).json({ error: 'يرجى اختيار الخزينة النقدية للسند.' });
    if (!isCashboxAllowed(req.user, cashBoxId)) {
      return res.status(403).json({ error: 'الخزينة المحددة خارج نطاق الخزائن المصرح لك بها.' });
    }
    const cashBox = db.prepare('SELECT id, account_id, branch_id FROM cash_boxes WHERE id = ?').get(cashBoxId) as any;
    if (!cashBox) return res.status(400).json({ error: 'الخزينة النقدية غير موجودة.' });
    if (cashBox.branch_id !== branchId) {
      return res.status(400).json({ error: 'الخزينة المحددة لا تتبع الفرع المختار للسند.' });
    }
    treasuryAccount = cashBox.account_id;
  }

  let opposingAccount = directAccountId;
  if (partyId) {
    const party = db.prepare('SELECT id, type, name_ar FROM parties WHERE id = ?').get(partyId) as any;
    if (!party) return res.status(400).json({ error: 'الطرف المحدد غير موجود.' });
    if (party.type === 'supplier') {
      opposingAccount = 'acc_2111'; // موردون
    } else {
      opposingAccount = 'acc_1121'; // عملاء
    }
  }

  if (!opposingAccount) {
    return res.status(400).json({ error: 'يرجى تحديد الطرف (عميل/مورد) أو حساب المقابل المباشر.' });
  }

  const voucherAmount = new Decimal(numAmount);
  let totalAllocated = new Decimal(0);
  const validatedAllocations: { invoiceType: string; invoiceId: string; amount: number }[] = [];

  if (allocations && Array.isArray(allocations)) {
    for (const alloc of allocations) {
      const allocAmt = new Decimal(alloc.amount || 0);
      if (allocAmt.greaterThan(0)) {
        const invType = alloc.invoiceType || (voucherType === 'receipt' ? 'sales_invoice' : 'purchase_invoice');
        if (voucherType === 'receipt') {
          if (invType !== 'sales_invoice') {
            return res.status(400).json({ error: 'سند القبض يخصص فقط لفواتير المبيعات.' });
          }
          const inv = db.prepare('SELECT id, invoice_number, customer_id, status, remaining_amount FROM sales_invoices WHERE id = ?').get(alloc.invoiceId) as any;
          if (!inv) return res.status(400).json({ error: `فاتورة المبيعات (${alloc.invoiceId}) غير موجودة.` });
          if (inv.status === 'draft') return res.status(400).json({ error: `لا يمكن تخصيص السند لفاتورة مسودة (${inv.invoice_number}) غير مرحلة.` });
          if (partyId && inv.customer_id !== partyId) {
            return res.status(400).json({ error: `الفاتورة (${inv.invoice_number}) لا تعود للعميل المحدد في السند.` });
          }
          if (allocAmt.greaterThan(inv.remaining_amount)) {
            return res.status(400).json({ error: `مبلغ التخصيص (${allocAmt.toNumber()}) يتجاوز المتبقي على الفاتورة ${inv.invoice_number} وهو (${inv.remaining_amount}).` });
          }
        } else {
          // payment
          if (invType !== 'purchase_invoice') {
            return res.status(400).json({ error: 'سند الصرف يخصص فقط لفواتير المشتريات.' });
          }
          const inv = db.prepare('SELECT id, invoice_number, supplier_id, status, remaining_amount FROM purchase_invoices WHERE id = ?').get(alloc.invoiceId) as any;
          if (!inv) return res.status(400).json({ error: `فاتورة المشتريات (${alloc.invoiceId}) غير موجودة.` });
          if (inv.status === 'draft') return res.status(400).json({ error: `لا يمكن تخصيص السند لفاتورة مسودة (${inv.invoice_number}) غير مرحلة.` });
          if (partyId && inv.supplier_id !== partyId) {
            return res.status(400).json({ error: `الفاتورة (${inv.invoice_number}) لا تعود للمورد المحدد في السند.` });
          }
          if (allocAmt.greaterThan(inv.remaining_amount)) {
            return res.status(400).json({ error: `مبلغ التخصيص (${allocAmt.toNumber()}) يتجاوز المتبقي على الفاتورة ${inv.invoice_number} وهو (${inv.remaining_amount}).` });
          }
        }

        totalAllocated = totalAllocated.plus(allocAmt);
        validatedAllocations.push({
          invoiceType: invType,
          invoiceId: alloc.invoiceId,
          amount: allocAmt.toNumber()
        });
      }
    }
  }

  if (totalAllocated.greaterThan(voucherAmount)) {
    return res.status(400).json({ error: `مجموع التخصيصات على الفواتير (${totalAllocated.toNumber()}) يتجاوز مبلغ السند (${voucherAmount.toNumber()}).` });
  }

  const unallocatedAmount = voucherAmount.minus(totalAllocated).toNumber();
  const vId = `pv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const prefix = voucherType === 'receipt' ? 'RV' : 'PV';
  const vNumber = getNextDocumentNumber(prefix, branchId, period.fiscal_year_id);

  try {
    db.transaction(() => {
      // 1. Post GL Journal Entry
      const lines = voucherType === 'receipt'
        ? [
            { accountId: treasuryAccount, debit: voucherAmount.toNumber(), credit: 0, description: `قبض بالخزينة/البنك: ${description || ''}` },
            { accountId: opposingAccount, partyId: partyId || null, debit: 0, credit: voucherAmount.toNumber(), description: `تحصيل من: ${description || ''}` }
          ]
        : [
            { accountId: opposingAccount, partyId: partyId || null, debit: voucherAmount.toNumber(), credit: 0, description: `سداد إلى: ${description || ''}` },
            { accountId: treasuryAccount, debit: 0, credit: voucherAmount.toNumber(), description: `صرف من الخزينة/البنك: ${description || ''}` }
          ];

      const journalResult = postJournalEntry({
        docType: voucherType === 'receipt' ? 'RCPT' : 'PYMT',
        docId: vId,
        docNumber: vNumber,
        entryDate: effectiveDate,
        postingDate: effectiveDate,
        branchId,
        fiscalPeriodId: period.id,
        description: `${voucherType === 'receipt' ? 'سند قبض' : 'سند صرف'} رقم ${vNumber}: ${description || ''}`,
        createdBy: req.user!.id,
        lines
      });

      // 2. Insert Payment Voucher Record
      db.prepare(`
        INSERT INTO payment_vouchers (
          id, voucher_number, voucher_type, branch_id, payment_method, cash_box_id, bank_account_id,
          party_id, direct_account_id, voucher_date, amount, allocated_amount, unallocated_amount,
          description, journal_entry_id, status, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?)
      `).run(
        vId, vNumber, voucherType, branchId, paymentMethod || 'cash', cashBoxId || null, bankAccountId || null,
        partyId || null, directAccountId || null, effectiveDate, voucherAmount.toNumber(), totalAllocated.toNumber(), unallocatedAmount,
        description || '', journalResult.entryId, req.user!.id
      );

      // 3. Update Cash Box or Bank Account Balance
      if (cashBoxId) {
        const delta = voucherType === 'receipt' ? voucherAmount.toNumber() : -voucherAmount.toNumber();
        db.prepare('UPDATE cash_boxes SET current_balance = current_balance + ? WHERE id = ?').run(delta, cashBoxId);
      } else if (bankAccountId) {
        const delta = voucherType === 'receipt' ? voucherAmount.toNumber() : -voucherAmount.toNumber();
        db.prepare('UPDATE bank_accounts SET current_balance = current_balance + ? WHERE id = ?').run(delta, bankAccountId);
      }

      // 4. Party Sub-ledger is updated via GL journal entry lines above with partyId

      // 5. Insert Allocations & Update Invoices
      for (const alloc of validatedAllocations) {
        db.prepare(`
          INSERT INTO voucher_allocations (id, voucher_id, invoice_type, invoice_id, allocated_amount)
          VALUES (?, ?, ?, ?, ?)
        `).run(`va_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, vId, alloc.invoiceType, alloc.invoiceId, alloc.amount);

        if (alloc.invoiceType === 'sales_invoice') {
          db.prepare(`
            UPDATE sales_invoices 
            SET paid_amount = paid_amount + ?,
                remaining_amount = MAX(remaining_amount - ?, 0),
                status = CASE WHEN remaining_amount - ? <= 0 THEN 'paid' ELSE 'partially_paid' END
            WHERE id = ?
          `).run(alloc.amount, alloc.amount, alloc.amount, alloc.invoiceId);
        } else if (alloc.invoiceType === 'purchase_invoice') {
          db.prepare(`
            UPDATE purchase_invoices 
            SET paid_amount = paid_amount + ?,
                remaining_amount = MAX(remaining_amount - ?, 0),
                status = CASE WHEN remaining_amount - ? <= 0 THEN 'paid' ELSE 'partially_paid' END
            WHERE id = ?
          `).run(alloc.amount, alloc.amount, alloc.amount, alloc.invoiceId);
        }
      }
    })();

    logAudit(req.user!.id, 'CREATE_VOUCHER', 'payment_vouchers', vId, `إصدار ${voucherType === 'receipt' ? 'سند قبض' : 'سند صرف'} رقم ${vNumber}`);
    res.json({ success: true, voucherId: vId, voucherNumber: vNumber, message: `تم إصدار وتوثيق ${voucherType === 'receipt' ? 'سند القبض' : 'سند الصرف'} رقم ${vNumber} بنجاح.` });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/treasury/vouchers/:id/reverse', requireAuth, requirePermission('treasury.reverse', 'reverse'), (req: AuthenticatedRequest, res) => {
  const voucher = db.prepare('SELECT * FROM payment_vouchers WHERE id = ?').get(req.params.id) as any;
  if (!voucher) return res.status(404).json({ error: 'السند غير موجود.' });
  if (voucher.status === 'reversed') return res.status(400).json({ error: 'السند ملغى ومعكوس بالفعل.' });

  const period = getFiscalPeriodForDate(new Date().toISOString().split('T')[0]);
  if (period.is_closed === 1) {
    return res.status(400).json({ error: 'الفترة المالية الحالية مقفلة ولا يمكن عكس السند فيها.' });
  }

  try {
    db.transaction(() => {
      // 1. Reverse GL entry
      if (voucher.journal_entry_id) {
        reverseJournalEntry(voucher.journal_entry_id, `إلغاء وعكس سند الخزينة ${voucher.voucher_number}`, req.user!.id);
      }

      // 2. Reverse Cashbox/Bank balance
      const vAmount = voucher.amount;
      if (voucher.cash_box_id) {
        const delta = voucher.voucher_type === 'receipt' ? -vAmount : vAmount;
        db.prepare('UPDATE cash_boxes SET current_balance = current_balance + ? WHERE id = ?').run(delta, voucher.cash_box_id);
      } else if (voucher.bank_account_id) {
        const delta = voucher.voucher_type === 'receipt' ? -vAmount : vAmount;
        db.prepare('UPDATE bank_accounts SET current_balance = current_balance + ? WHERE id = ?').run(delta, voucher.bank_account_id);
      }

      // 3. Party Sub-ledger is reversed via reverseJournalEntry above with partyId

      // 4. Reverse Allocations on invoices
      const allocs = db.prepare('SELECT * FROM voucher_allocations WHERE voucher_id = ?').all(voucher.id) as any[];
      for (const a of allocs) {
        if (a.invoice_type === 'sales_invoice') {
          db.prepare(`
            UPDATE sales_invoices
            SET paid_amount = MAX(paid_amount - ?, 0),
                remaining_amount = remaining_amount + ?,
                status = CASE WHEN paid_amount - ? <= 0 THEN 'posted' ELSE 'partially_paid' END
            WHERE id = ?
          `).run(a.allocated_amount, a.allocated_amount, a.allocated_amount, a.invoice_id);
        } else if (a.invoice_type === 'purchase_invoice') {
          db.prepare(`
            UPDATE purchase_invoices
            SET paid_amount = MAX(paid_amount - ?, 0),
                remaining_amount = remaining_amount + ?,
                status = CASE WHEN paid_amount - ? <= 0 THEN 'posted' ELSE 'partially_paid' END
            WHERE id = ?
          `).run(a.allocated_amount, a.allocated_amount, a.allocated_amount, a.invoice_id);
        }
      }

      // 5. Mark voucher as reversed
      db.prepare('UPDATE payment_vouchers SET status = "reversed" WHERE id = ?').run(voucher.id);

      logAudit(req.user!.id, 'REVERSE_VOUCHER', 'payment_vouchers', voucher.id, `عكس وإلغاء ${voucher.voucher_type === 'receipt' ? 'سند قبض' : 'سند صرف'} رقم ${voucher.voucher_number}`);
    })();

    res.json({ success: true, message: `تم عكس وإلغاء السند رقم "${voucher.voucher_number}" وتحديث الأرصدة بنجاح.` });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 13. Financial Reports (Fixed Date Filters & SQL Parameters)
// ----------------------------------------------------

// 1. Trial Balance (Fixed Join & Status Filtering)
apiRouter.get('/reports/trial-balance', requireAuth, requirePermission('reports.view'), (req, res) => {
  const fromDate = typeof req.query.fromDate === 'string' ? req.query.fromDate : null;
  const toDate = typeof req.query.toDate === 'string' ? req.query.toDate : null;
  const branchId = typeof req.query.branchId === 'string' && req.query.branchId !== 'all' ? req.query.branchId : null;

  // Fetch opening movements (before fromDate) and period movements (between fromDate and toDate)
  // Strictly only considering je.status = 'posted'
  let query = `
    SELECT 
      a.id, a.code, a.name_ar, a.name_en, a.account_type, a.nature, a.is_group, a.level,
      
      -- Opening movements (strictly before fromDate)
      COALESCE((
        SELECT SUM(jel.debit) 
        FROM journal_entry_lines jel 
        JOIN journal_entries je ON jel.entry_id = je.id 
        WHERE jel.account_id = a.id AND je.status = 'posted'
          ${fromDate ? 'AND je.entry_date < ?' : 'AND 1=0'}
          ${branchId ? 'AND je.branch_id = ?' : ''}
      ), 0) as opening_debit,

      COALESCE((
        SELECT SUM(jel.credit) 
        FROM journal_entry_lines jel 
        JOIN journal_entries je ON jel.entry_id = je.id 
        WHERE jel.account_id = a.id AND je.status = 'posted'
          ${fromDate ? 'AND je.entry_date < ?' : 'AND 1=0'}
          ${branchId ? 'AND je.branch_id = ?' : ''}
      ), 0) as opening_credit,

      -- Period movements (between fromDate and toDate)
      COALESCE((
        SELECT SUM(jel.debit) 
        FROM journal_entry_lines jel 
        JOIN journal_entries je ON jel.entry_id = je.id 
        WHERE jel.account_id = a.id AND je.status = 'posted'
          ${fromDate ? 'AND je.entry_date >= ?' : ''}
          ${toDate ? 'AND je.entry_date <= ?' : ''}
          ${branchId ? 'AND je.branch_id = ?' : ''}
      ), 0) as period_debit,

      COALESCE((
        SELECT SUM(jel.credit) 
        FROM journal_entry_lines jel 
        JOIN journal_entries je ON jel.entry_id = je.id 
        WHERE jel.account_id = a.id AND je.status = 'posted'
          ${fromDate ? 'AND je.entry_date >= ?' : ''}
          ${toDate ? 'AND je.entry_date <= ?' : ''}
          ${branchId ? 'AND je.branch_id = ?' : ''}
      ), 0) as period_credit

    FROM accounts a
    ORDER BY a.code ASC
  `;

  const params: any[] = [];
  if (fromDate) params.push(fromDate);
  if (branchId) params.push(branchId);
  if (fromDate) params.push(fromDate);
  if (branchId) params.push(branchId);
  if (fromDate) params.push(fromDate);
  if (toDate) params.push(toDate);
  if (branchId) params.push(branchId);
  if (fromDate) params.push(fromDate);
  if (toDate) params.push(toDate);
  if (branchId) params.push(branchId);

  const accounts = db.prepare(query).all(...params) as any[];

  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);

  const rows = accounts.map(acc => {
    const pD = new Decimal(acc.period_debit || 0);
    const pC = new Decimal(acc.period_credit || 0);
    const oD = new Decimal(acc.opening_debit || 0);
    const oC = new Decimal(acc.opening_credit || 0);

    totalDebit = totalDebit.plus(pD);
    totalCredit = totalCredit.plus(pC);

    const netClosing = oD.minus(oC).plus(pD).minus(pC);
    let closingDebit = 0;
    let closingCredit = 0;

    if (netClosing.isPositive()) {
      closingDebit = netClosing.toNumber();
    } else {
      closingCredit = netClosing.abs().toNumber();
    }

    return {
      ...acc,
      opening_debit: oD.toNumber(),
      opening_credit: oC.toNumber(),
      period_debit: pD.toNumber(),
      period_credit: pC.toNumber(),
      balance_debit: closingDebit,
      balance_credit: closingCredit
    };
  });

  res.json({
    rows,
    totals: {
      totalDebit: totalDebit.toNumber(),
      totalCredit: totalCredit.toNumber(),
      isBalanced: totalDebit.equals(totalCredit)
    }
  });
});

// 2. Income Statement (Protected: requires view_profit permission)
apiRouter.get('/reports/income-statement', requireAuth, requirePermission('reports.view'), (req: AuthenticatedRequest, res) => {
  if (req.user?.role !== 'owner' && !req.user?.permissions.includes('view_profit')) {
    return res.status(403).json({ error: 'غير مصرح لك بالاطلاع على قائمة الدخل وأرباح المنشأة.' });
  }

  const fromDate = typeof req.query.fromDate === 'string' ? req.query.fromDate : null;
  const toDate = typeof req.query.toDate === 'string' ? req.query.toDate : null;

  let filterSql = "WHERE je.status = 'posted'";
  const params: any[] = [];
  if (fromDate) { filterSql += ' AND je.entry_date >= ?'; params.push(fromDate); }
  if (toDate) { filterSql += ' AND je.entry_date <= ?'; params.push(toDate); }

  const revenues = db.prepare(`
    SELECT a.code, a.name_ar, ROUND(SUM(jel.credit - jel.debit), 2) as amount
    FROM accounts a
    JOIN journal_entry_lines jel ON a.id = jel.account_id
    JOIN journal_entries je ON jel.entry_id = je.id
    ${filterSql} AND a.account_type = 'revenue'
    GROUP BY a.id
  `).all(...params) as any[];

  const cogs = db.prepare(`
    SELECT a.code, a.name_ar, ROUND(SUM(jel.debit - jel.credit), 2) as amount
    FROM accounts a
    JOIN journal_entry_lines jel ON a.id = jel.account_id
    JOIN journal_entries je ON jel.entry_id = je.id
    ${filterSql} AND a.account_type = 'cogs'
    GROUP BY a.id
  `).all(...params) as any[];

  const expenses = db.prepare(`
    SELECT a.code, a.name_ar, ROUND(SUM(jel.debit - jel.credit), 2) as amount
    FROM accounts a
    JOIN journal_entry_lines jel ON a.id = jel.account_id
    JOIN journal_entries je ON jel.entry_id = je.id
    ${filterSql} AND a.account_type = 'expense'
    GROUP BY a.id
  `).all(...params) as any[];

  const totalRevenue = revenues.reduce((s, r) => s + (r.amount || 0), 0);
  const totalCogs = cogs.reduce((s, c) => s + (c.amount || 0), 0);
  const grossProfit = totalRevenue - totalCogs;
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const netIncome = grossProfit - totalExpenses;

  res.json({
    revenues,
    cogs,
    expenses,
    totalRevenue,
    totalCogs,
    grossProfit,
    totalExpenses,
    netIncome
  });
});

// 3. Balance Sheet
apiRouter.get('/reports/balance-sheet', requireAuth, requirePermission('reports.view'), (req, res) => {
  const asOfDate = typeof req.query.asOfDate === 'string' ? req.query.asOfDate : null;
  let dateFilter = "WHERE je.status = 'posted'";
  const params: any[] = [];
  if (asOfDate) {
    dateFilter += ' AND je.entry_date <= ?';
    params.push(asOfDate);
  }

  const assets = db.prepare(`
    SELECT a.code, a.name_ar, a.nature,
           ROUND(SUM(CASE WHEN a.nature = 'debit' THEN (jel.debit - jel.credit) ELSE (jel.credit - jel.debit) END), 2) as balance
    FROM accounts a
    JOIN journal_entry_lines jel ON a.id = jel.account_id
    JOIN journal_entries je ON jel.entry_id = je.id
    ${dateFilter} AND a.account_type = 'asset'
    GROUP BY a.id
    HAVING balance != 0
  `).all(...params) as any[];

  const liabilities = db.prepare(`
    SELECT a.code, a.name_ar,
           ROUND(SUM(jel.credit - jel.debit), 2) as balance
    FROM accounts a
    JOIN journal_entry_lines jel ON a.id = jel.account_id
    JOIN journal_entries je ON jel.entry_id = je.id
    ${dateFilter} AND a.account_type = 'liability'
    GROUP BY a.id
    HAVING balance != 0
  `).all(...params) as any[];

  const equity = db.prepare(`
    SELECT a.code, a.name_ar,
           ROUND(SUM(jel.credit - jel.debit), 2) as balance
    FROM accounts a
    JOIN journal_entry_lines jel ON a.id = jel.account_id
    JOIN journal_entries je ON jel.entry_id = je.id
    ${dateFilter} AND a.account_type = 'equity'
    GROUP BY a.id
    HAVING balance != 0
  `).all(...params) as any[];

  const totalAssets = assets.reduce((s, a) => s + (a.nature === 'credit' ? -a.balance : a.balance), 0);
  const totalLiabilities = liabilities.reduce((s, l) => s + l.balance, 0);
  const totalEquity = equity.reduce((s, e) => s + e.balance, 0);

  res.json({
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 1.0
  });
});

// 4. Egyptian VAT Return
apiRouter.get('/reports/vat-return', requireAuth, requirePermission('reports.view'), (req, res) => {
  const fromDate = typeof req.query.fromDate === 'string' ? req.query.fromDate : null;
  const toDate = typeof req.query.toDate === 'string' ? req.query.toDate : null;

  let filter = "WHERE je.status = 'posted'";
  const params: any[] = [];
  if (fromDate) { filter += ' AND je.entry_date >= ?'; params.push(fromDate); }
  if (toDate) { filter += ' AND je.entry_date <= ?'; params.push(toDate); }

  const outputVat = db.prepare(`
    SELECT COALESCE(SUM(jel.credit - jel.debit), 0) as vat_amount
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    ${filter} AND jel.account_id = 'acc_2131'
  `).get(...params) as any;

  const inputVat = db.prepare(`
    SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as vat_amount
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    ${filter} AND jel.account_id = 'acc_1151'
  `).get(...params) as any;

  const wht = db.prepare(`
    SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as wht_amount
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    ${filter} AND jel.account_id = 'acc_1152'
  `).get(...params) as any;

  const netVatPayable = (outputVat.vat_amount || 0) - (inputVat.vat_amount || 0);

  res.json({
    outputVat: outputVat.vat_amount || 0,
    inputVat: inputVat.vat_amount || 0,
    netVatPayable,
    withholdingTaxCredit: wht.wht_amount || 0,
    standardRate: '14%',
    withholdingRate: '1%'
  });
});

// ----------------------------------------------------
// 14. Egyptian Tax Authority (ETA) Sandbox Simulation
// ----------------------------------------------------
apiRouter.post('/eta/simulate-submission/:invoiceId', requireAuth, (req: AuthenticatedRequest, res) => {
  const inv = db.prepare(`
    SELECT si.*, p.name_ar as customer_name, p.tax_id as customer_tax, p.commercial_registry,
           c.tax_id as issuer_tax, c.legal_name as issuer_name
    FROM sales_invoices si
    JOIN parties p ON si.customer_id = p.id
    JOIN companies c ON 1=1
    WHERE si.id = ?
  `).get(req.params.invoiceId) as any;

  if (!inv) return res.status(404).json({ error: 'الفاتورة غير موجودة' });

  const docPayload = JSON.stringify({
    issuer: { id: inv.issuer_tax, name: inv.issuer_name },
    receiver: { id: inv.customer_tax || '000000000', name: inv.customer_name },
    documentType: 'I',
    documentTypeVersion: '1.0',
    dateTimeIssued: inv.invoice_date + 'T12:00:00Z',
    taxpayerActivityCode: '4690',
    internalId: inv.invoice_number,
    totalSalesAmount: inv.subtotal,
    netAmount: inv.taxable_amount,
    taxAmount: inv.tax_amount,
    totalAmount: inv.total_amount
  });

  const submissionUuid = crypto.randomUUID();
  const hash = crypto.createHash('sha256').update(docPayload).digest('hex');

  // Clearly mark as Simulated Acceptance (not real production approval)
  db.prepare(`
    UPDATE sales_invoices 
    SET eta_status = 'SimulationAccepted', eta_uuid = ?, eta_submission_id = ?
    WHERE id = ?
  `).run(submissionUuid, submissionUuid, inv.id);

  db.prepare(`
    INSERT INTO eta_submissions (
      id, invoice_id, submission_uuid, eta_document_id, status, eta_code, hash_signature, json_payload
    ) VALUES (?, ?, ?, ?, 'SimulationAccepted', 'SIM_200_VALID', ?, ?)
  `).run(`eta_${Date.now()}`, inv.id, submissionUuid, `ETA-SIM-${inv.invoice_number}`, hash, docPayload);

  logAudit(req.user!.id, 'ETA_SIMULATION', 'sales_invoices', inv.id, `محاكاة التحقق من الفاتورة إلكترونياً بنجاح: ${inv.invoice_number}`);

  res.json({
    success: true,
    status: 'SimulationAccepted',
    uuid: submissionUuid,
    hashSignature: hash,
    message: 'تمت محاكاة الفحص والتحقق الهيكلي للفاتورة محلياً بنجاح (وضع التجربة Sandbox - لا يعتبر اعتماداً رسمياً من مصلحة الضرائب).'
  });
});

// ----------------------------------------------------
// 15. Automated Acceptance Test Runner (Isolated Test DB Only!)
// ----------------------------------------------------
apiRouter.post('/tests/run', requireAuth, requirePermission('manage_settings'), (req: AuthenticatedRequest, res) => {
  try {
    // Run tests exclusively in an isolated database environment!
    const testResults = runAllFinancialTests();
    res.json(testResults);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 16. Immutable Audit Logs
// ----------------------------------------------------
apiRouter.get('/audit-logs', requireAuth, (req, res) => {
  const logs = db.prepare(`
    SELECT al.*, u.display_name, u.username
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    ORDER BY al.created_at DESC
    LIMIT 100
  `).all();

  res.json({ logs });
});

// ----------------------------------------------------
// 17. Modular Extended ERP Sub-Routers
// ----------------------------------------------------
apiRouter.use('/period-closing', periodClosingRouter);
apiRouter.use('/import', importExcelRouter);
apiRouter.use('/backups', backupsRouter);
apiRouter.use('/reports/aging', agingRouter);
apiRouter.use('/bank-reconciliation', bankReconciliationRouter);
apiRouter.use('/inventory-counts', inventoryCountsRouter);
apiRouter.use('/analytics', excelAnalyticsRouter);

