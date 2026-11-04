import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';

async function runSecurityAudit() {
  console.log('====================================================');
  console.log('🔒 Starting Al-Mizan ERP Comprehensive Security & RBAC Audit');
  console.log('====================================================');

  const prodDbFile = path.resolve(process.cwd(), 'almizan.db');
  const prodDbInitialMtime = fs.existsSync(prodDbFile) ? fs.statSync(prodDbFile).mtimeMs : 0;

  const testDbFile = path.resolve(process.cwd(), `almizan_audit_${Date.now()}.db`);
  process.env.ALMIZAN_DB_PATH = testDbFile;

  const { createDatabaseConnection, initDb } = await import('./db.js');
  const { seedInitialData } = await import('./seed.js');
  const { apiRouter } = await import('./api.js');

  const db = createDatabaseConnection(testDbFile);
  initDb(db);
  seedInitialData(db);

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);

  const results: { test: string; status: 'PASSED' | 'FAILED'; detail: string }[] = [];

  function record(test: string, passed: boolean, detail: string) {
    results.push({ test, status: passed ? 'PASSED' : 'FAILED', detail });
    console.log(`${passed ? '✅' : '❌'} ${test}: ${passed ? 'PASSED' : 'FAILED'} - ${detail}`);
  }

  try {
    // 1. Unauthenticated checks (Must return 401)
    const unauthAccounts = await request(app).get('/api/accounts');
    record(
      'Unauthenticated request to /api/accounts',
      unauthAccounts.status === 401,
      `Status: ${unauthAccounts.status} (expected 401)`
    );

    const unauthBackup = await request(app).get('/api/backups');
    record(
      'Unauthenticated request to /api/backups',
      unauthBackup.status === 401,
      `Status: ${unauthBackup.status} (expected 401)`
    );

    const unauthPeriod = await request(app).get('/api/period-closing/status');
    record(
      'Unauthenticated request to /api/period-closing/status',
      unauthPeriod.status === 401,
      `Status: ${unauthPeriod.status} (expected 401)`
    );

    // 2. Login as storekeeper
    const storekeeperLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'storekeeper', password: 'admin123' });
    
    const storekeeperToken = storekeeperLogin.body.token;
    record(
      'Storekeeper authentication',
      storekeeperLogin.status === 200 && !!storekeeperToken,
      `Storekeeper logged in successfully`
    );

    // 3. Storekeeper restricted access checks (Must return 403 Forbidden)
    const skAccounts = await request(app)
      .get('/api/accounts')
      .set('Authorization', `Bearer ${storekeeperToken}`);
    record(
      'Storekeeper blocked from Chart of Accounts (/api/accounts)',
      skAccounts.status === 403,
      `Status: ${skAccounts.status} (expected 403)`
    );

    const skJournals = await request(app)
      .get('/api/journal-entries')
      .set('Authorization', `Bearer ${storekeeperToken}`);
    record(
      'Storekeeper blocked from Journal Entries (/api/journal-entries)',
      skJournals.status === 403,
      `Status: ${skJournals.status} (expected 403)`
    );

    const skBackup = await request(app)
      .get('/api/backups')
      .set('Authorization', `Bearer ${storekeeperToken}`);
    record(
      'Storekeeper blocked from Backups list (/api/backups)',
      skBackup.status === 403,
      `Status: ${skBackup.status} (expected 403)`
    );

    const skPeriodStatus = await request(app)
      .get('/api/period-closing/status')
      .set('Authorization', `Bearer ${storekeeperToken}`);
    record(
      'Storekeeper blocked from Period Closing (/api/period-closing/status)',
      skPeriodStatus.status === 403,
      `Status: ${skPeriodStatus.status} (expected 403)`
    );

    const skExcelImport = await request(app)
      .get('/api/import/history')
      .set('Authorization', `Bearer ${storekeeperToken}`);
    record(
      'Storekeeper blocked from Excel Import history (/api/import/history)',
      skExcelImport.status === 403,
      `Status: ${skExcelImport.status} (expected 403)`
    );

    const skAgingRec = await request(app)
      .get('/api/reports/aging/receivables')
      .set('Authorization', `Bearer ${storekeeperToken}`);
    record(
      'Storekeeper blocked from Receivables Aging (/api/reports/aging/receivables)',
      skAgingRec.status === 403,
      `Status: ${skAgingRec.status} (expected 403)`
    );

    const skAgingPay = await request(app)
      .get('/api/reports/aging/payables')
      .set('Authorization', `Bearer ${storekeeperToken}`);
    record(
      'Storekeeper blocked from Payables Aging (/api/reports/aging/payables)',
      skAgingPay.status === 403,
      `Status: ${skAgingPay.status} (expected 403)`
    );

    const skBankRec = await request(app)
      .get('/api/bank-reconciliation/data')
      .set('Authorization', `Bearer ${storekeeperToken}`);
    record(
      'Storekeeper blocked from Bank Reconciliation (/api/bank-reconciliation/data)',
      skBankRec.status === 403,
      `Status: ${skBankRec.status} (expected 403)`
    );

    // 4. Storekeeper Dashboard access (Blocked with 403)
    const skDashboard = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${storekeeperToken}`);
    record(
      'Storekeeper blocked with 403 from /api/dashboard/stats (no dashboard.view)',
      skDashboard.status === 403,
      `Status: ${skDashboard.status} (expected 403)`
    );

    // 4.a Storekeeper authorized to view inventory counts (inventory_count.view)
    const skInventoryCounts = await request(app)
      .get('/api/inventory-counts')
      .set('Authorization', `Bearer ${storekeeperToken}`);
    record(
      'Storekeeper authorized to view inventory counts (/api/inventory-counts)',
      skInventoryCounts.status === 200 && Array.isArray(skInventoryCounts.body.counts),
      `Status: ${skInventoryCounts.status} (expected 200, count list size: ${skInventoryCounts.body?.counts?.length ?? 0})`
    );

    // 4.b Create a restricted user who has ONLY dashboard.view (to verify redaction of profit/cost/treasury)
    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, role, is_active, allowed_branch_ids, allowed_warehouse_ids, allowed_cashbox_ids)
      VALUES ('user_viewer', 'viewer', '$2b$10$wE9mHlXG948F8ZqE/h1Z9.z2VwJ3L3vXkX7hX9mHlXG948F8ZqE/h', 'مشاهد فقط', 'accountant', 1, '*', '*', '*')
    `).run();
    db.prepare(`
      INSERT INTO individual_permissions (user_id, permission_keys)
      VALUES ('user_viewer', '["dashboard.view"]')
    `).run();
    const viewerToken = 'session_token_viewer_test';
    db.prepare(`
      INSERT INTO user_sessions (token, user_id, expires_at)
      VALUES (?, 'user_viewer', datetime('now', '+1 day'))
    `).run(viewerToken);

    const viewerDashboard = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${viewerToken}`);
    const vKpis = viewerDashboard.body?.kpis || {};
    const vSections = viewerDashboard.body?.sections || {};
    const isRedacted =
      vKpis.cashLiquidity === null &&
      vKpis.receivables === null &&
      vKpis.payables === null &&
      vKpis.netProfit === null &&
      vKpis.operatingExpenses === null &&
      vSections.sales === null &&
      vSections.purchases === null &&
      vSections.treasury === null &&
      vSections.partiesAging === null;
    record(
      'Restricted user financial KPI & sensitive sections redaction on /api/dashboard/stats',
      viewerDashboard.status === 200 && isRedacted,
      `Liquidity: ${vKpis.cashLiquidity}, NetProfit: ${vKpis.netProfit}, SalesSection: ${vSections.sales}`
    );

    // 5. Admin / Owner permissions checks
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    const adminToken = adminLogin.body.token;

    const adminDashboard = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${adminToken}`);
    const adminKpis = adminDashboard.body?.kpis || {};
    record(
      'Admin full financial KPI visibility on /api/dashboard/stats',
      adminDashboard.status === 200 && typeof adminKpis.netProfit === 'number' && typeof adminKpis.cashLiquidity === 'number',
      `NetProfit: ${adminKpis.netProfit}, CashLiquidity: ${adminKpis.cashLiquidity}`
    );

    // 6. Backup security: No productionDbPath leak and path containment check
    const adminBackup = await request(app)
      .get('/api/backups')
      .set('Authorization', `Bearer ${adminToken}`);
    record(
      'Backup response does NOT leak productionDbPath',
      adminBackup.status === 200 && adminBackup.body.productionDbPath === undefined,
      `productionDbPath is undefined: ${adminBackup.body.productionDbPath === undefined}`
    );

    // Create a backup
    const createBackupRes = await request(app)
      .post('/api/backups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'Security Audit Test Backup' });
    record(
      'Admin create backup',
      createBackupRes.status === 200 && !!createBackupRes.body.backup?.id,
      `Created backup ID: ${createBackupRes.body?.backup?.id}`
    );

    const backupId = createBackupRes.body?.backup?.id;
    if (backupId) {
      // Storekeeper forbidden from download
      const skDownload = await request(app)
        .get(`/api/backups/${backupId}/download`)
        .set('Authorization', `Bearer ${storekeeperToken}`);
      record(
        'Storekeeper blocked from downloading backup file',
        skDownload.status === 403,
        `Status: ${skDownload.status} (expected 403)`
      );

      // Admin authorized to download
      const adminDownload = await request(app)
        .get(`/api/backups/${backupId}/download`)
        .set('Authorization', `Bearer ${adminToken}`);
      record(
        'Admin authorized to download backup file',
        adminDownload.status === 200,
        `Content-Type: ${adminDownload.headers['content-type']}`
      );
    }

    // 7. Period closing: close and reopen with documented audit reason
    const periodStatusRes = await request(app)
      .get('/api/period-closing/status')
      .set('Authorization', `Bearer ${adminToken}`);
    const activePeriodId = periodStatusRes.body.currentPeriod?.id;

    if (activePeriodId) {
      const closeRes = await request(app)
        .post('/api/period-closing/close')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          periodId: activePeriodId,
          notes: 'Monthly closing after complete audit'
        });
      record(
        'Admin monthly period close',
        closeRes.status === 200 && closeRes.body.success === true,
        `Period close response: ${closeRes.body?.message || closeRes.body?.error}`
      );

      const reopenRes = await request(app)
        .post('/api/period-closing/reopen')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          periodId: activePeriodId,
          reason: 'Authorized tax adjustment audit requirement'
        });
      
      const historyRes = await request(app)
        .get('/api/period-closing/history')
        .set('Authorization', `Bearer ${adminToken}`);
      const latestReopen = historyRes.body.reopenings?.[0];

      record(
        'Admin reopen period records operator ID and documented reason',
        reopenRes.status === 200 && latestReopen?.reason === 'Authorized tax adjustment audit requirement',
        `Reopened by: ${latestReopen?.reopened_by_name || latestReopen?.reopened_by}, Reason: ${latestReopen?.reason}`
      );
    }

    // 8. Physical inventory draft deletion vs posted deletion refusal
    const countDraftRes = await request(app)
      .post('/api/inventory-counts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        branchId: 'br_cairo',
        warehouseId: 'wh_main',
        countDate: '2026-03-31',
        notes: 'Draft count for deletion testing',
        items: [{ itemId: 'item_raw_01', countedQuantity: 10 }]
      });
    const draftCountId = countDraftRes.body.countId;

    // Delete draft count
    const deleteDraftRes = await request(app)
      .delete(`/api/inventory-counts/${draftCountId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    record(
      'Deleting draft inventory count succeeds',
      deleteDraftRes.status === 200,
      `Draft delete status: ${deleteDraftRes.status}`
    );

    // Create another and post it
    const countPostedRes = await request(app)
      .post('/api/inventory-counts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        branchId: 'br_cairo',
        warehouseId: 'wh_main',
        countDate: '2026-03-31',
        notes: 'Posted count for refusal testing',
        items: [{ itemId: 'item_raw_01', countedQuantity: 12 }]
      });
    const postedCountId = countPostedRes.body.countId;
    await request(app)
      .post(`/api/inventory-counts/${postedCountId}/post`)
      .set('Authorization', `Bearer ${adminToken}`);

    // Try deleting posted count -> must be rejected
    const deletePostedRes = await request(app)
      .delete(`/api/inventory-counts/${postedCountId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    record(
      'Deleting posted inventory count is strictly refused (400)',
      deletePostedRes.status === 400,
      `Delete posted status: ${deletePostedRes.status} - Message: ${deletePostedRes.body?.error}`
    );

    // 9. Verify audit ran in isolated temporary SQLite file and did not touch production database
    const prodDbFinalMtime = fs.existsSync(prodDbFile) ? fs.statSync(prodDbFile).mtimeMs : 0;
    record(
      'Audit runs on isolated temporary SQLite database and does NOT touch production database',
      prodDbInitialMtime === prodDbFinalMtime,
      `Isolated temporary DB: ${path.basename(testDbFile)}, Production DB unchanged (mtime: ${prodDbFinalMtime})`
    );

    console.log('====================================================');
    const total = results.length;
    const passed = results.filter(r => r.status === 'PASSED').length;
    console.log(`📊 Audit Summary: Total: ${total} | Passed: ${passed} | Failed: ${total - passed}`);
    console.log('====================================================');

    if (total !== passed) {
      process.exit(1);
    }
  } finally {
    try {
      db.close();
      if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
      const wal = `${testDbFile}-wal`;
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      const shm = `${testDbFile}-shm`;
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch (e) {}
  }
}

runSecurityAudit().catch(err => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
