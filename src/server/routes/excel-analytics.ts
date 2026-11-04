import { Router, Response } from 'express';
import * as XLSX from 'xlsx';
import Decimal from 'decimal.js';
import crypto from 'crypto';
import { AuthenticatedRequest, requireAuth, requirePermission } from '../api.js';
import {
  parseSheetData,
  computeNumericColumnStats,
  groupRows,
  calculateNetSales,
  executeAnalysisPlan,
  SheetAnalysis,
  ColumnDataType,
  AnalysisPlan,
  generateTestWorkbook
} from '../analytics-engine.js';
import {
  askAlMizanAssistant,
  getAIRunnerConfig,
  saveAIRunnerConfig,
  testAIRunnerConnection
} from '../ai-runner.js';

export const excelAnalyticsRouter = Router();

// Resource Limits & Policies
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_ROWS_PER_SHEET = 50000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 Hours

export interface AnalyticsSession {
  id: string;
  userId: string;
  filename: string;
  fileSizeBytes: number;
  createdAt: number;
  lastAccessedAt: number;
  sheetNames: string[];
  activeSheetName: string;
  headerRowIndices: Record<string, number>;
  columnTypeOverrides: Record<string, Record<string, ColumnDataType>>;
  // Cached parsed data per sheet
  sheetsData: Record<
    string,
    {
      sheetAnalysis: SheetAnalysis;
      rawHeaders: string[];
      rows: Array<Record<string, any>>;
      rawRows: any[][];
      unreadableCellsCount: number;
    }
  >;
  chatHistory: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    plan?: AnalysisPlan;
    executionResult?: any;
    matchingRowIndices?: number[];
  }>;
}

// In-Memory Secure Session Storage (Protected with fine-grained RBAC per user)
const sessionsMap = new Map<string, AnalyticsSession>();

// Cleanup expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessionsMap.entries()) {
    if (now - session.lastAccessedAt > SESSION_TTL_MS) {
      sessionsMap.delete(id);
    }
  }
}, 15 * 60 * 1000);

/**
 * Helper: Retrieve and validate session ownership
 */
function getValidSession(sessionId: string, req: AuthenticatedRequest, res: Response): AnalyticsSession | null {
  const session = sessionsMap.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'جلسة التحليل غير موجودة أو انتهت صلاحيتها. يرجى رفع الملف مجدداً.' });
    return null;
  }

  // Strict User Isolation Check
  if (req.user?.role !== 'owner' && session.userId !== req.user?.id) {
    res.status(403).json({ error: 'غير مصرح: لا يمكنك الوصول إلى جلسة تحليل تخص مستخدماً آخر.' });
    return null;
  }

  session.lastAccessedAt = Date.now();
  return session;
}

/**
 * POST /upload: Upload Excel or CSV file for analysis only (Read-Only)
 */
excelAnalyticsRouter.post(
  '/upload',
  requireAuth,
  requirePermission('excel_analytics.view', 'import.excel', 'excel_import.view'),
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const { base64Data, filename } = req.body;
      if (!base64Data) {
        return res.status(400).json({ error: 'لم يتم استلام محتوى ملف Excel للتحليل.' });
      }

      const buffer = Buffer.from(base64Data, 'base64');

      // 1. File size limit check
      if (buffer.length > MAX_FILE_SIZE_BYTES) {
        return res.status(400).json({
          error: `حجم الملف (${(buffer.length / 1024 / 1024).toFixed(1)} MB) يتجاوز الحد الأقصى المسموح به (${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB).`
        });
      }

      // 2. Parse Workbook with formula cell support
      const wb = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: true,
        cellNF: true,
        cellStyles: true,
        sheetStubs: true
      });

      if (!wb.SheetNames || wb.SheetNames.length === 0) {
        return res.status(400).json({ error: 'الملف المرفوع لا يحتوي على أي أوراق عمل صالحة.' });
      }

      const sessionId = `ansess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const safeFilename = filename || 'uploaded_analysis.xlsx';

      const session: AnalyticsSession = {
        id: sessionId,
        userId: req.user!.id,
        filename: safeFilename,
        fileSizeBytes: buffer.length,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        sheetNames: wb.SheetNames,
        activeSheetName: wb.SheetNames[0],
        headerRowIndices: {},
        columnTypeOverrides: {},
        sheetsData: {},
        chatHistory: []
      };

      // Parse sheets with row limit check
      for (const sName of wb.SheetNames) {
        const ws = wb.Sheets[sName];
        const parsed = parseSheetData(ws, sName, 0);

        if (parsed.rows.length > MAX_ROWS_PER_SHEET) {
          return res.status(400).json({
            error: `الورقة [${sName}] تحتوي على أكثر من ${MAX_ROWS_PER_SHEET} صف. يرجى تجزئة الملف لضمان استقرار التحليل.`
          });
        }

        session.headerRowIndices[sName] = 0;
        session.sheetsData[sName] = parsed;
      }

      sessionsMap.set(sessionId, session);

      const activeParsed = session.sheetsData[session.activeSheetName];

      res.json({
        success: true,
        sessionId,
        filename: safeFilename,
        sheetNames: session.sheetNames,
        activeSheetName: session.activeSheetName,
        analysis: activeParsed.sheetAnalysis,
        previewRows: activeParsed.rows.slice(0, 50),
        unreadableCellsCount: activeParsed.unreadableCellsCount
      });
    } catch (err: any) {
      res.status(400).json({ error: `فشل قراءة وتحليل ملف Excel: ${err.message}` });
    }
  }
);

/**
 * POST /sample: Load Multi-Scenario Test Spreadsheet for instant 1-click test & verification
 */
excelAnalyticsRouter.post(
  '/sample',
  requireAuth,
  requirePermission('excel_analytics.view', 'import.excel', 'excel_import.view'),
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const wb = generateTestWorkbook();
      const sessionId = `ansess_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const filename = 'نموذج_اختبار_الميزان_الشامل_2026.xlsx';

      const session: AnalyticsSession = {
        id: sessionId,
        userId: req.user!.id,
        filename,
        fileSizeBytes: 35000,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        sheetNames: wb.SheetNames,
        activeSheetName: wb.SheetNames[0],
        headerRowIndices: {},
        columnTypeOverrides: {},
        sheetsData: {},
        chatHistory: []
      };

      for (const sName of wb.SheetNames) {
        const ws = wb.Sheets[sName];
        session.headerRowIndices[sName] = 0;
        session.sheetsData[sName] = parseSheetData(ws, sName, 0);
      }

      sessionsMap.set(sessionId, session);

      const activeParsed = session.sheetsData[session.activeSheetName];

      res.json({
        success: true,
        sessionId,
        filename,
        sheetNames: session.sheetNames,
        activeSheetName: session.activeSheetName,
        analysis: activeParsed.sheetAnalysis,
        previewRows: activeParsed.rows.slice(0, 50),
        unreadableCellsCount: activeParsed.unreadableCellsCount
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET /sessions/:sessionId: Retrieve current analysis state
 */
excelAnalyticsRouter.get(
  '/sessions/:sessionId',
  requireAuth,
  requirePermission('excel_analytics.view', 'import.excel', 'excel_import.view'),
  (req: AuthenticatedRequest, res: Response) => {
    const session = getValidSession(req.params.sessionId, req, res);
    if (!session) return;

    const activeParsed = session.sheetsData[session.activeSheetName];

    res.json({
      success: true,
      sessionId: session.id,
      filename: session.filename,
      sheetNames: session.sheetNames,
      activeSheetName: session.activeSheetName,
      analysis: activeParsed.sheetAnalysis,
      previewRows: activeParsed.rows.slice(0, 50),
      chatHistory: session.chatHistory
    });
  }
);

/**
 * POST /sessions/:sessionId/sheet: Switch active sheet, change header row, or override column data types
 */
excelAnalyticsRouter.post(
  '/sessions/:sessionId/sheet',
  requireAuth,
  requirePermission('excel_analytics.view', 'import.excel', 'excel_import.view'),
  (req: AuthenticatedRequest, res: Response) => {
    const session = getValidSession(req.params.sessionId, req, res);
    if (!session) return;

    const { sheetName, headerRowIndex, columnTypeOverrides } = req.body;

    const targetSheet = sheetName || session.activeSheetName;
    if (!session.sheetNames.includes(targetSheet)) {
      return res.status(400).json({ error: `ورقة العمل [${targetSheet}] غير موجودة بالملف.` });
    }

    session.activeSheetName = targetSheet;

    if (headerRowIndex !== undefined) {
      session.headerRowIndices[targetSheet] = Math.max(0, parseInt(headerRowIndex, 10));
    }

    if (columnTypeOverrides) {
      session.columnTypeOverrides[targetSheet] = {
        ...(session.columnTypeOverrides[targetSheet] || {}),
        ...columnTypeOverrides
      };
    }

    // Re-parse sheet with updated header row and type overrides
    const rawGrid = session.sheetsData[targetSheet].rawRows;
    const ws = XLSX.utils.aoa_to_sheet(rawGrid);
    const parsed = parseSheetData(
      ws,
      targetSheet,
      session.headerRowIndices[targetSheet] || 0,
      session.columnTypeOverrides[targetSheet]
    );

    session.sheetsData[targetSheet] = parsed;

    res.json({
      success: true,
      activeSheetName: targetSheet,
      headerRowIndex: session.headerRowIndices[targetSheet] || 0,
      analysis: parsed.sheetAnalysis,
      previewRows: parsed.rows.slice(0, 50)
    });
  }
);

/**
 * POST /sessions/:sessionId/filter: Apply interactive filters, compute stats across ALL matching rows
 */
excelAnalyticsRouter.post(
  '/sessions/:sessionId/filter',
  requireAuth,
  requirePermission('excel_analytics.view', 'import.excel', 'excel_import.view'),
  (req: AuthenticatedRequest, res: Response) => {
    const session = getValidSession(req.params.sessionId, req, res);
    if (!session) return;

    const { filters, groupByCol, amountCol, periodFilter, targetCurrency } = req.body;
    const activeParsed = session.sheetsData[session.activeSheetName];

    const plan: AnalysisPlan = {
      sheetName: session.activeSheetName,
      goal: 'تطبيق الفلاتر والتحليل الإحصائي التفاعلي',
      operation: 'sum',
      targetColumn: amountCol,
      groupByColumn: groupByCol,
      filters: filters || [],
      periodFilter
    };

    // Filter rows
    let matchingIndices: number[] = activeParsed.rows.map((_, i) => i);

    if (filters && Array.isArray(filters) && filters.length > 0) {
      matchingIndices = matchingIndices.filter(i => {
        const row = activeParsed.rows[i];
        return filters.every((f: any) => {
          if (!f.column || f.value === undefined || f.value === '') return true;
          const cellVal = row[f.column];
          if (cellVal === null || cellVal === undefined) return false;

          const cellStr = String(cellVal).trim().toLowerCase();
          const targetStr = String(f.value).trim().toLowerCase();

          if (f.operator === 'equals') return cellStr === targetStr;
          if (f.operator === 'contains') return cellStr.includes(targetStr);
          if (f.operator === 'greater_than') {
            const n1 = parseFloat(cellStr);
            const n2 = parseFloat(targetStr);
            return !isNaN(n1) && !isNaN(n2) && n1 > n2;
          }
          if (f.operator === 'less_than') {
            const n1 = parseFloat(cellStr);
            const n2 = parseFloat(targetStr);
            return !isNaN(n1) && !isNaN(n2) && n1 < n2;
          }
          return true;
        });
      });
    }

    const matchingRows = matchingIndices.map(i => activeParsed.rows[i]);

    // Financial columns statistics
    const numericColumns = activeParsed.sheetAnalysis.columns.filter(
      c => c.inferredType === 'number' || c.userType === 'number'
    );

    const statsList = numericColumns
      .map(c => computeNumericColumnStats(matchingRows, c.name, targetCurrency || activeParsed.sheetAnalysis.currenciesDetected[0]))
      .filter(Boolean);

    // Group By breakdown
    let groupResult = null;
    const effectiveAmountCol = amountCol || numericColumns[0]?.name;
    const effectiveGroupCol = groupByCol || activeParsed.sheetAnalysis.columns.find(c => /عميل|مورد|صنف|فرع|customer|supplier|item|branch/i.test(c.name))?.name;

    if (effectiveAmountCol && effectiveGroupCol) {
      groupResult = groupRows(matchingRows, effectiveGroupCol, effectiveAmountCol, 'custom');
      // Limit top groups to 10
      groupResult.items = groupResult.items.slice(0, 10);
    }

    // Net Sales vs Returns calculation (if applicable)
    let netSalesCalc = null;
    if (activeParsed.sheetAnalysis.hasSalesAndReturns && effectiveAmountCol) {
      const typeCol = activeParsed.sheetAnalysis.columns.find(c => /نوع_الحركة|نوع الفاتورة|البيان|مرتجع/i.test(c.name))?.name;
      const invCol = activeParsed.sheetAnalysis.columns.find(c => /فاتورة|invoice/i.test(c.name))?.name;
      const currCol = activeParsed.sheetAnalysis.columns.find(c => /عملة|currency/i.test(c.name))?.name;

      netSalesCalc = calculateNetSales(
        matchingRows,
        effectiveAmountCol,
        typeCol,
        invCol,
        currCol,
        targetCurrency || activeParsed.sheetAnalysis.currenciesDetected[0]
      );
    }

    res.json({
      success: true,
      matchingRowCount: matchingRows.length,
      matchingRowIndices: matchingIndices,
      previewRows: matchingRows.slice(0, 50),
      statsList,
      groupResult,
      netSalesCalc
    });
  }
);

/**
 * POST /sessions/:sessionId/chat: "اسأل ملفك" - Ask Your File in Arabic or English
 */
excelAnalyticsRouter.post(
  '/sessions/:sessionId/chat',
  requireAuth,
  requirePermission('excel_analytics.chat', 'excel_analytics.view', 'import.excel'),
  async (req: AuthenticatedRequest, res: Response) => {
    const session = getValidSession(req.params.sessionId, req, res);
    if (!session) return;

    const { question, activeFilters } = req.body;
    if (!question || !String(question).trim()) {
      return res.status(400).json({ error: 'يرجى كتابة السؤال المطلوب.' });
    }

    const activeParsed = session.sheetsData[session.activeSheetName];

    try {
      const assistantResult = await askAlMizanAssistant(
        question,
        activeParsed.sheetAnalysis,
        session.chatHistory,
        (plan: AnalysisPlan) => {
          // If active UI filters are present, merge them with the plan
          if (activeFilters && Array.isArray(activeFilters) && activeFilters.length > 0) {
            plan.filters = [...(plan.filters || []), ...activeFilters];
          }
          return executeAnalysisPlan(plan, {
            sheetAnalysis: activeParsed.sheetAnalysis,
            rows: activeParsed.rows
          });
        }
      );

      // Save to chat history
      const userMsgId = `msg_${Date.now()}_u`;
      const assistantMsgId = `msg_${Date.now()}_a`;

      session.chatHistory.push({
        id: userMsgId,
        role: 'user',
        content: question,
        timestamp: new Date().toISOString()
      });

      session.chatHistory.push({
        id: assistantMsgId,
        role: 'assistant',
        content: assistantResult.answerText,
        timestamp: new Date().toISOString(),
        plan: assistantResult.plan,
        executionResult: assistantResult.executionResult,
        matchingRowIndices: assistantResult.executionResult.matchingRowIndices
      });

      res.json({
        success: true,
        answerText: assistantResult.answerText,
        plan: assistantResult.plan,
        executionResult: assistantResult.executionResult,
        modelUsed: assistantResult.modelUsed,
        isFailoverUsed: assistantResult.isFailoverUsed,
        chatHistory: session.chatHistory
      });
    } catch (err: any) {
      res.status(500).json({ error: `فشل معالجة السؤال: ${err.message}` });
    }
  }
);

/**
 * POST /sessions/:sessionId/matching-rows: Fetch full rows for drilldown modal
 */
excelAnalyticsRouter.post(
  '/sessions/:sessionId/matching-rows',
  requireAuth,
  requirePermission('excel_analytics.view', 'import.excel', 'excel_import.view'),
  (req: AuthenticatedRequest, res: Response) => {
    const session = getValidSession(req.params.sessionId, req, res);
    if (!session) return;

    const { indices } = req.body;
    if (!Array.isArray(indices)) {
      return res.status(400).json({ error: 'قائمة المؤشرات غير صالحة.' });
    }

    const activeParsed = session.sheetsData[session.activeSheetName];
    const rows = indices
      .filter((idx: number) => idx >= 0 && idx < activeParsed.rows.length)
      .map((idx: number) => activeParsed.rows[idx]);

    res.json({
      success: true,
      totalCount: rows.length,
      columns: activeParsed.sheetAnalysis.columns,
      rows
    });
  }
);

/**
 * POST /sessions/:sessionId/export: Export filtered data and statistical summary to Excel
 */
excelAnalyticsRouter.post(
  '/sessions/:sessionId/export',
  requireAuth,
  requirePermission('excel_analytics.export', 'excel_analytics.view', 'import.excel'),
  (req: AuthenticatedRequest, res: Response) => {
    const session = getValidSession(req.params.sessionId, req, res);
    if (!session) return;

    const { indices, summaryTitle } = req.body;
    const activeParsed = session.sheetsData[session.activeSheetName];

    let exportRows = activeParsed.rows;
    if (Array.isArray(indices) && indices.length > 0) {
      exportRows = indices.map((idx: number) => activeParsed.rows[idx]).filter(Boolean);
    }

    // Clean internal properties before Excel conversion
    const cleanRows = exportRows.map(r => {
      const copy = { ...r };
      delete copy.__rowIndex;
      return copy;
    });

    const wb = XLSX.utils.book_new();

    // Sheet 1: Filtered Data
    const wsData = XLSX.utils.json_to_sheet(cleanRows);
    XLSX.utils.book_append_sheet(wb, wsData, `بيانات_${session.activeSheetName}`.slice(0, 31));

    // Sheet 2: Analysis Summary
    const summaryData = [
      { 'البند': 'اسم ملف المصدر', 'القيمة': session.filename },
      { 'البند': 'ورقة العمل المحللة', 'القيمة': session.activeSheetName },
      { 'البند': 'إجمالي صفوف الملف', 'القيمة': activeParsed.rows.length },
      { 'البند': 'الصفوف المطابقة للتصفية', 'القيمة': exportRows.length },
      { 'البند': 'تاريخ ووقت التحليل', 'القيمة': new Date().toLocaleString('ar-EG') },
      { 'البند': 'المستخدم المنفذ', 'القيمة': req.user!.display_name }
    ];

    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'ملخص_التحليل');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename="almizan_analysis_${Date.now()}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  }
);

/**
 * DELETE /sessions/:sessionId: Close & purge analysis session
 */
excelAnalyticsRouter.delete('/sessions/:sessionId', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const session = sessionsMap.get(req.params.sessionId);
  if (session && (req.user?.role === 'owner' || session.userId === req.user?.id)) {
    sessionsMap.delete(req.params.sessionId);
  }
  res.json({ success: true, message: 'تم إغلاق وحذف جلسة التحليل بنجاح.' });
});

/**
 * GET /ai-settings: Retrieve local runner config
 */
excelAnalyticsRouter.get(
  '/ai-settings',
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const config = getAIRunnerConfig();
    res.json({
      success: true,
      config,
      hardwareRequirements: {
        recommendedRAM: '8GB - 16GB RAM للموديلات 7B',
        lightweightRAM: '4GB - 8GB للموديلات 1.5B / 3B',
        licenses: 'Qwen 2.5 (Apache 2.0) | DeepSeek R1 (MIT)'
      }
    });
  }
);

/**
 * POST /ai-settings: Update local runner config (requires admin / manage_settings)
 */
excelAnalyticsRouter.post(
  '/ai-settings',
  requireAuth,
  requirePermission('manage_settings', 'users.manage'),
  (req: AuthenticatedRequest, res: Response) => {
    const { runnerUrl, primaryModel, fallbackModel, timeoutSeconds } = req.body;
    saveAIRunnerConfig({
      runnerUrl,
      primaryModel,
      fallbackModel,
      timeoutSeconds
    });

    res.json({
      success: true,
      message: 'تم حفظ إعدادات مشغل الذكاء الاصطناعي المحلي بنجاح.',
      config: getAIRunnerConfig()
    });
  }
);

/**
 * POST /ai-test-connection: Test connection to local runner, verify failover, measure latency
 */
excelAnalyticsRouter.post(
  '/ai-test-connection',
  requireAuth,
  requirePermission('manage_settings', 'users.manage'),
  async (req: AuthenticatedRequest, res: Response) => {
    const config = getAIRunnerConfig();
    const result = await testAIRunnerConnection(config);
    res.json(result);
  }
);
