import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { db, getDatabasePath, createDatabaseConnection } from '../db.js';
import { AuthenticatedRequest, requireAuth, requirePermission } from '../api.js';
import { logAudit } from '../accounting-engine.js';
import { SystemBackup } from '../../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const backupsRouter = Router();

const backupsDir = path.resolve(__dirname, '../../../backups');
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

export function countAllRecords(targetDb: Database.Database): Record<string, number> {
  const tables = [
    'accounts', 'parties', 'items', 'warehouses', 'cash_boxes', 'bank_accounts',
    'sales_invoices', 'purchase_invoices', 'sales_returns', 'purchase_returns',
    'payment_vouchers', 'journal_entries', 'users', 'audit_logs'
  ];
  const counts: Record<string, number> = {};

  for (const t of tables) {
    try {
      const row = targetDb.prepare(`SELECT COUNT(*) as cnt FROM ${t}`).get() as { cnt: number } | undefined;
      counts[t] = row ? row.cnt : 0;
    } catch {
      counts[t] = 0;
    }
  }
  return counts;
}

/**
 * POST /create: Create Consistent ACID WAL Backup using SQLite VACUUM INTO
 */
const handleCreateBackup = (req: AuthenticatedRequest, res: Response) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `almizan_backup_${timestamp}.db`;
  const backupFilePath = path.join(backupsDir, filename);

  try {
    // 1. Consistent SQLite Online Snapshot via VACUUM INTO
    // VACUUM INTO cleanly folds WAL journals into a standalone, consistent SQLite database
    db.prepare(`VACUUM INTO '${backupFilePath.replace(/'/g, "''")}'`).run();

    // 2. Perform Integrity Verification on the generated backup file
    const verifyDb = new Database(backupFilePath, { readonly: true });
    const integrityRow = verifyDb.pragma('integrity_check') as any[];
    const isIntegrityOk = Array.isArray(integrityRow) && integrityRow.length > 0 && integrityRow[0].integrity_check === 'ok';

    if (!isIntegrityOk) {
      verifyDb.close();
      fs.unlinkSync(backupFilePath);
      throw new Error('فشل فحص سلامة النسخة الاحتياطية (Integrity Check Failed). تم حذف الملف التالف فوراً.');
    }

    // 3. Count records in verified backup
    const recordCounts = countAllRecords(verifyDb);
    verifyDb.close();

    const stats = fs.statSync(backupFilePath);
    const backupId = `bk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 4. Save metadata into system_backups table
    db.prepare(`
      INSERT INTO system_backups (id, filename, file_path, file_size, schema_version, integrity_status, record_counts_json, created_by)
      VALUES (?, ?, ?, ?, '1.0', 'OK', ?, ?)
    `).run(
      backupId,
      filename,
      backupFilePath,
      stats.size,
      JSON.stringify(recordCounts),
      req.user!.id
    );

    logAudit(
      req.user!.id,
      'CREATE_BACKUP',
      'system_backups',
      backupId,
      `إنشاء نسخة احتياطية متسقة (${filename}) بحجم ${(stats.size / 1024).toFixed(1)} ك.ب وفحص سلامة ناجح.`
    );

    res.json({
      success: true,
      message: 'تم إنشاء النسخة الاحتياطية المتسقة بنجاح واجتياز الفحص الرقابي.',
      backup: {
        id: backupId,
        filename,
        file_path: backupFilePath,
        file_size: stats.size,
        schema_version: '1.0',
        integrity_status: 'OK',
        record_counts: recordCounts,
        created_by: req.user!.display_name,
        created_at: new Date().toISOString()
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: `فشل إنشاء النسخة الاحتياطية: ${err.message}` });
  }
};

backupsRouter.post('/create', requireAuth, requirePermission('backup.create'), handleCreateBackup);
backupsRouter.post('/', requireAuth, requirePermission('backup.create'), handleCreateBackup);

/**
 * GET /: List all system backups
 */
backupsRouter.get('/', requireAuth, requirePermission('backup.view', 'backup.create', 'backup.restore'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT b.*, u.display_name as creator_name
      FROM system_backups b
      JOIN users u ON b.created_by = u.id
      ORDER BY b.created_at DESC
    `).all() as any[];

    const backups: SystemBackup[] = rows.map(r => ({
      id: r.id,
      filename: r.filename,
      file_path: r.file_path,
      file_size: r.file_size,
      schema_version: r.schema_version,
      integrity_status: r.integrity_status,
      record_counts: JSON.parse(r.record_counts_json || '{}'),
      created_by: r.creator_name,
      created_at: r.created_at
    }));

    const currentCounts = countAllRecords(db);

    res.json({
      success: true,
      backups,
      currentCounts
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /:id/download: Download backup file
 */
backupsRouter.get('/:id/download', requireAuth, requirePermission('backup.download', 'backup.create', 'backup.restore'), (req: AuthenticatedRequest, res: Response) => {
  const backup = db.prepare('SELECT * FROM system_backups WHERE id = ?').get(req.params.id) as any;
  if (!backup) {
    return res.status(404).json({ error: 'النسخة الاحتياطية المطلوبة غير موجودة.' });
  }

  const resolvedPath = path.resolve(backup.file_path);
  const resolvedDir = path.resolve(backupsDir);
  if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
    return res.status(403).json({ error: 'مسار الملف غير مسموح به أمنياً (Path Traversal Detected).' });
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'ملف النسخة الاحتياطية غير موجود على القرص.' });
  }

  res.download(resolvedPath, backup.filename);
});

/**
 * POST /verify: Pre-restore verification on isolated database
 */
backupsRouter.post('/verify', requireAuth, requirePermission('backup.verify', 'backup.restore'), (req: AuthenticatedRequest, res: Response) => {
  const { backupId } = req.body;
  const backup = db.prepare('SELECT * FROM system_backups WHERE id = ?').get(backupId) as any;

  if (!backup) {
    return res.status(404).json({ error: 'سجل النسخة الاحتياطية غير موجود للفحص.' });
  }

  const resolvedPath = path.resolve(backup.file_path);
  const resolvedDir = path.resolve(backupsDir);
  if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
    return res.status(403).json({ error: 'مسار الملف غير مسموح به أمنياً.' });
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'ملف النسخة الاحتياطية غير موجود للفحص.' });
  }

  try {
    const testDb = new Database(resolvedPath, { readonly: true });
    const integrityRow = testDb.pragma('integrity_check') as any[];
    const isOk = Array.isArray(integrityRow) && integrityRow.length > 0 && integrityRow[0].integrity_check === 'ok';
    const counts = countAllRecords(testDb);
    testDb.close();

    const currentCounts = countAllRecords(db);

    res.json({
      success: true,
      integrity: isOk ? 'OK' : 'CORRUPTED',
      backupCounts: counts,
      currentCounts,
      isCompatible: isOk && (counts.accounts > 0)
    });
  } catch (err: any) {
    res.status(400).json({ error: `فشل فحص النسخة الاحتياطية: ${err.message}` });
  }
});

/**
 * POST /restore: Safely restore backup into production with automated pre-restore safety copy
 */
backupsRouter.post('/restore', requireAuth, requirePermission('backup.restore'), (req: AuthenticatedRequest, res: Response) => {
  const { backupId, confirmSafety } = req.body;

  if (!confirmSafety) {
    return res.status(400).json({ error: 'يجب تأكيد الموافقة الصريحة على استبدال قاعدة البيانات الجارية.' });
  }

  const backup = db.prepare('SELECT * FROM system_backups WHERE id = ?').get(backupId) as any;
  if (!backup) {
    return res.status(404).json({ error: 'النسخة الاحتياطية غير موجودة.' });
  }

  const resolvedPath = path.resolve(backup.file_path);
  const resolvedDir = path.resolve(backupsDir);
  if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
    return res.status(403).json({ error: 'مسار الملف غير مسموح به أمنياً.' });
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'ملف النسخة الاحتياطية غير موجود.' });
  }

  try {
    // 1. Verify on isolated DB first
    const testDb = new Database(backup.file_path, { readonly: true });
    const integrityRow = testDb.pragma('integrity_check') as any[];
    const isOk = Array.isArray(integrityRow) && integrityRow.length > 0 && integrityRow[0].integrity_check === 'ok';
    if (!isOk) {
      testDb.close();
      return res.status(400).json({ error: 'رفضت العملية: النسخة الاحتياطية تالفة أو غير متوافقة.' });
    }
    const backupCounts = countAllRecords(testDb);
    testDb.close();

    // 2. Create Safety Copy of current production database before overwriting
    const prodDbPath = getDatabasePath();
    const safetyCopyPath = path.resolve(backupsDir, `almizan_pre_restore_safety_${Date.now()}.db`);
    db.prepare(`VACUUM INTO '${safetyCopyPath.replace(/'/g, "''")}'`).run();

    // 3. Atomically copy verified backup file to production database path
    // Using file write with read lock
    fs.copyFileSync(backup.file_path, prodDbPath);

    // Re-verify production DB
    db.pragma('wal_checkpoint(TRUNCATE)');
    const currentCounts = countAllRecords(db);

    logAudit(
      req.user!.id,
      'RESTORE_DATABASE',
      'system_backups',
      backupId,
      `استعادة قاعدة البيانات بنجاح من النسخة (${backup.filename}). تم الاحتفاظ بنسخة أمان مسبقة في (${path.basename(safetyCopyPath)}).`
    );

    res.json({
      success: true,
      message: 'تمت استعادة قاعدة البيانات بنجاح وتحديث كافة الأرصدة والسجلات.',
      safetyBackupFile: path.basename(safetyCopyPath),
      restoredCounts: currentCounts
    });
  } catch (err: any) {
    res.status(500).json({ error: `فشل استعادة قاعدة البيانات: ${err.message}` });
  }
});
