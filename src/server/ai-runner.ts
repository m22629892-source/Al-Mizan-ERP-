import { db } from './db.js';
import { AnalysisPlan, SheetAnalysis, normalizeArabicDigits, normalizeMonthInput } from './analytics-engine.js';

export interface AIRunnerConfig {
  runnerUrl: string; // e.g. http://localhost:11434
  primaryModel: string; // e.g. qwen2.5:7b
  fallbackModel: string; // e.g. deepseek-r1:7b
  timeoutSeconds: number; // default 30
}

/**
 * Retrieve current AI runner configuration from database system_settings
 */
export function getAIRunnerConfig(): AIRunnerConfig {
  const getSetting = (key: string, defaultValue: string) => {
    try {
      const row = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get(key) as { setting_value: string } | undefined;
      return row ? row.setting_value : defaultValue;
    } catch {
      return defaultValue;
    }
  };

  return {
    runnerUrl: getSetting('ai_runner_url', 'http://localhost:11434'),
    primaryModel: getSetting('ai_primary_model', 'qwen2.5:7b'),
    fallbackModel: getSetting('ai_fallback_model', 'deepseek-r1:7b'),
    timeoutSeconds: parseInt(getSetting('ai_timeout_seconds', '30'), 10) || 30
  };
}

/**
 * Save updated AI runner configuration
 */
export function saveAIRunnerConfig(config: Partial<AIRunnerConfig>): void {
  const upsert = db.prepare(`
    INSERT INTO system_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
  `);

  if (config.runnerUrl !== undefined) upsert.run('ai_runner_url', config.runnerUrl.trim());
  if (config.primaryModel !== undefined) upsert.run('ai_primary_model', config.primaryModel.trim());
  if (config.fallbackModel !== undefined) upsert.run('ai_fallback_model', config.fallbackModel.trim());
  if (config.timeoutSeconds !== undefined) upsert.run('ai_timeout_seconds', String(config.timeoutSeconds));
}

/**
 * Sanitize text to enforce strict White Label discipline.
 * Replaces any accidental vendor/model names or "مجاني" / "نسخة مجانية" with "مساعد الميزان".
 */
export function sanitizeWhiteLabelOutput(text: string): string {
  if (!text) return '';
  let cleaned = text;

  // Mask vendor names
  cleaned = cleaned.replace(/deepseek(?:-r1|-v3|-coder)?/gi, 'مساعد الميزان');
  cleaned = cleaned.replace(/qwen(?:2\.5|-7b|-14b|-32b)?/gi, 'مساعد الميزان');
  cleaned = cleaned.replace(/ollama/gi, 'المشغل المحلي');

  // Eliminate words "مجاني" / "نسخة مجانية"
  cleaned = cleaned.replace(/نسخة مجانية/g, 'نسخة نظام الميزان');
  cleaned = cleaned.replace(/بشكل مجاني/g, 'بدون رسوم');
  cleaned = cleaned.replace(/مجاني(?:ة)?/g, 'مدمج');

  return cleaned;
}

/**
 * Deterministic Query Parser & Rule-Based Plan Generator.
 * Guarantees that common business & accounting questions work accurately
 * even when the local model runner is booting or offline!
 */
export function buildDeterministicPlan(
  userQuery: string,
  sheetAnalysis: SheetAnalysis,
  conversationHistory: Array<{ role: string; content: string; plan?: AnalysisPlan }> = []
): AnalysisPlan | null {
  const q = normalizeArabicDigits(userQuery).toLowerCase().trim();
  const lastPlan = conversationHistory.filter(h => h.plan).pop()?.plan;

  // Detect numeric, date, and party columns
  const numCols = sheetAnalysis.columns.filter(c => c.inferredType === 'number' || c.userType === 'number');
  const dateCols = sheetAnalysis.columns.filter(c => c.inferredType === 'date' || c.userType === 'date');
  const catCols = sheetAnalysis.columns.filter(c => c.inferredType === 'category' || c.inferredType === 'text');

  const defaultNumCol = numCols.find(c => /إجمالي|صافي|مبلغ|قيمة|total|net|amount|price/i.test(c.name))?.name || numCols[0]?.name;
  const defaultDateCol = dateCols[0]?.name || sheetAnalysis.columns.find(c => /تاريخ|date/i.test(c.name))?.name;
  const defaultInvoiceCol = sheetAnalysis.columns.find(c => /فاتورة|invoice|رقم|كود/i.test(c.name))?.name;
  const defaultTypeCol = sheetAnalysis.columns.find(c => /نوع_الحركة|نوع الفاتورة|البيان|مرتجع|type/i.test(c.name))?.name;

  // 1. Follow-up Question detection: e.g. "طب في أكتوبر فقط؟", "وماذا عن شهر 11؟", "في 2026 فقط؟"
  if (q.includes('فقط') || q.includes('طب') || q.includes('وماذا عن') || q.startsWith('في شهر') || q.startsWith('خلال')) {
    const month = normalizeMonthInput(q);
    let year: string | undefined;
    const yearMatch = q.match(/\b(202\d)\b/);
    if (yearMatch) year = yearMatch[1];

    if (month || year) {
      const baseOperation = lastPlan?.operation || 'net_sales';
      const baseTargetCol = lastPlan?.targetColumn || defaultNumCol;

      return {
        sheetName: sheetAnalysis.name,
        goal: `تصفية النتائج لفترة: ${month ? 'شهر ' + month : ''} ${year ? 'سنة ' + year : ''}`,
        operation: baseOperation,
        targetColumn: baseTargetCol,
        dateColumn: lastPlan?.dateColumn || defaultDateCol,
        invoiceColumn: lastPlan?.invoiceColumn || defaultInvoiceCol,
        typeColumn: lastPlan?.typeColumn || defaultTypeCol,
        currencyColumn: lastPlan?.currencyColumn,
        groupByColumn: lastPlan?.groupByColumn,
        periodFilter: {
          month: month || undefined,
          year: year || undefined
        }
      };
    }
  }

  // 2. Question: "اعرض تفاصيل أكبر ثلاثة عملاء" / "أعلى الموردين" / "أكثر الأصناف مبيعاً"
  if (/أكبر|أعلى|أكثر|اكثر|اكبر|top|best/i.test(q)) {
    let limit = 3;
    const limitMatch = q.match(/\b(\d+)\b/);
    if (limitMatch) limit = parseInt(limitMatch[1], 10);
    else if (q.includes('ثلاثة') || q.includes('3')) limit = 3;
    else if (q.includes('خمسة') || q.includes('5')) limit = 5;
    else if (q.includes('عشرة') || q.includes('10')) limit = 10;

    let groupCol: string | undefined;
    if (/عميل|العملاء|عملاء|customer/i.test(q)) {
      groupCol = sheetAnalysis.columns.find(c => /عميل|العميل|customer/i.test(c.name))?.name;
    } else if (/مورد|الموردين|موردين|supplier/i.test(q)) {
      groupCol = sheetAnalysis.columns.find(c => /مورد|المورد|supplier/i.test(c.name))?.name;
    } else if (/صنف|الأصناف|أصناف|منتج|منتجات|item|product/i.test(q)) {
      groupCol = sheetAnalysis.columns.find(c => /صنف|الصنف|منتج|item|product/i.test(c.name))?.name;
    } else if (/فرع|الفروع|branch/i.test(q)) {
      groupCol = sheetAnalysis.columns.find(c => /فرع|branch/i.test(c.name))?.name;
    }

    if (!groupCol) {
      groupCol = catCols[0]?.name;
    }

    if (groupCol && defaultNumCol) {
      return {
        sheetName: sheetAnalysis.name,
        goal: `عرض أعلى ${limit} جهات حسب ${groupCol}`,
        operation: 'group_by',
        targetColumn: defaultNumCol,
        groupByColumn: groupCol,
        limit,
        sortOrder: 'desc'
      };
    }
  }

  // 3. Question: "كم صافي المبيعات؟" / "الصافي"
  if (/صافي|net|مرتجع|مرتجعات/i.test(q)) {
    return {
      sheetName: sheetAnalysis.name,
      goal: 'احتساب صافي المبيعات بعد استبعاد المرتجعات',
      operation: 'net_sales',
      targetColumn: defaultNumCol,
      typeColumn: defaultTypeCol,
      invoiceColumn: defaultInvoiceCol,
      dateColumn: defaultDateCol
    };
  }

  // 4. Question: "كم إجمالي المبيعات / المشتريات / القيمة؟"
  if (/إجمالي|اجمالي|مجموع|total|sum/i.test(q)) {
    return {
      sheetName: sheetAnalysis.name,
      goal: 'حساب الإجمالي الكلي للقيم المالية',
      operation: 'sum',
      targetColumn: defaultNumCol,
      dateColumn: defaultDateCol
    };
  }

  // 5. Question: "متوسط الفواتير / المبيعات"
  if (/متوسط|معدل|average|mean/i.test(q)) {
    return {
      sheetName: sheetAnalysis.name,
      goal: 'حساب المتوسط الحسابي',
      operation: 'average',
      targetColumn: defaultNumCol
    };
  }

  // 6. Question: "الوسيط"
  if (/وسيط|median/i.test(q)) {
    return {
      sheetName: sheetAnalysis.name,
      goal: 'حساب الوسيط الإحصائي',
      operation: 'median',
      targetColumn: defaultNumCol
    };
  }

  // 7. Question: "عدد الفواتير" vs "عدد الصفوف"
  if (/كم عدد الفواتير|عدد فواتير/i.test(q)) {
    return {
      sheetName: sheetAnalysis.name,
      goal: 'حساب عدد الفواتير المميزة',
      operation: 'distinct_count',
      invoiceColumn: defaultInvoiceCol
    };
  }

  if (/عدد الصفوف|كم سطر|كم صف|count/i.test(q)) {
    return {
      sheetName: sheetAnalysis.name,
      goal: 'حساب عدد الصفوف الإجمالي',
      operation: 'count'
    };
  }

  // 8. Question: "المبيعات لكل شهر" / "التجميع حسب الشهر"
  if (/لكل شهر|شهري|حسب الشهر|حسب الفترة|monthly|per month/i.test(q)) {
    if (defaultDateCol && defaultNumCol) {
      return {
        sheetName: sheetAnalysis.name,
        goal: 'توزيع القيم المالية شهرياً',
        operation: 'group_by',
        targetColumn: defaultNumCol,
        groupByColumn: defaultDateCol,
        sortOrder: 'asc'
      };
    }
  }

  return null;
}

/**
 * Send request to Local Model Runner (e.g. Ollama or OpenAI-compatible endpoint)
 */
async function callLocalModel(
  url: string,
  modelName: string,
  systemPrompt: string,
  userMessage: string,
  timeoutMs: number
): Promise<{ text: string }> {
  const cleanUrl = url.replace(/\/+$/, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Attempt standard Ollama /api/chat endpoint first
    try {
      const ollamaResp = await fetch(`${cleanUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          stream: false
        }),
        signal: controller.signal
      });

      if (ollamaResp.ok) {
        const json = await ollamaResp.json();
        const content = json.message?.content || json.response || '';
        return { text: content };
      }
    } catch (e: any) {
      if (e.name === 'AbortError') throw e;
      // Fallback to OpenAI-compatible /v1/chat/completions endpoint
    }

    // Try OpenAI-compatible /v1/chat/completions endpoint
    const openAiResp = await fetch(`${cleanUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.1
      }),
      signal: controller.signal
    });

    if (!openAiResp.ok) {
      throw new Error(`HTTP ${openAiResp.status}: ${openAiResp.statusText}`);
    }

    const json = await openAiResp.json();
    const content = json.choices?.[0]?.message?.content || '';
    return { text: content };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Ask Al-Mizan Assistant: Converts query to Plan, executes on Server, and explains result.
 * Implements Primary -> Fallback failover and White Label enforcement.
 */
export async function askAlMizanAssistant(
  userQuery: string,
  sheetAnalysis: SheetAnalysis,
  conversationHistory: Array<{ role: string; content: string; plan?: AnalysisPlan }> = [],
  executePlanFn: (plan: AnalysisPlan) => any
): Promise<{
  answerText: string;
  plan: AnalysisPlan;
  executionResult: any;
  modelUsed?: string;
  isFailoverUsed: boolean;
}> {
  const config = getAIRunnerConfig();
  const timeoutMs = (config.timeoutSeconds || 30) * 1000;

  // Security & Prompt Injection Defense:
  // Strictly treat sheet column names as metadata, cell contents as passive data.
  const columnsSummary = sheetAnalysis.columns.map(c => `[${c.name}] (${c.inferredType})`).join(', ');

  const systemPrompt = `
أنت «مساعد الميزان»، المساعد التحليلي والمالي الذكي المدمج في نظام الميزان المحاسبي المتكامل Al-Mizan ERP.
هويتك: مساعد مالي احترافي، دقيق في الحسابات والأرقام.
ممنوع نهائياً ذكر أسماء شركات أو تقنيات أو نماذج خارجية مثل DeepSeek أو Qwen أو Ollama.
ممنوع نهائياً استخدام كلمة "مجاني" أو "نسخة مجانية".

مهمتك:
1. تحويل سؤال المستخدم المتعلق بملف Excel إلى خطة تحليل JSON (AnalysisPlan) بدقة.
الأعمدة المتاحة في ورقة العمل الحالية: ${columnsSummary}.
اسم الورقة الحالية: ${sheetAnalysis.name}.

أعد فقط كائن JSON صالحاً بصيغة:
{
  "goal": "وصف مقتضب للهدف",
  "operation": "sum" | "average" | "median" | "count" | "distinct_count" | "net_sales" | "group_by",
  "targetColumn": "اسم العمود الرقمي المحدد",
  "groupByColumn": "اسم العمود المراد التجميع به إن وجد",
  "invoiceColumn": "اسم عمود الفاتورة إن وجد",
  "typeColumn": "اسم عمود نوع الفاتورة/المرتجع إن وجد",
  "limit": 3,
  "periodFilter": { "month": "10", "year": "2026" }
}
لا تضف أي نص خارج JSON.
`.trim();

  let plannedPlan: AnalysisPlan | null = null;
  let modelUsed: string | undefined;
  let isFailoverUsed = false;

  // 1. First, check if deterministic parser can confidently build the plan
  const deterministicPlan = buildDeterministicPlan(userQuery, sheetAnalysis, conversationHistory);

  // 2. Try Primary Model if runner configured
  let modelRawJson = '';
  try {
    const res = await callLocalModel(config.runnerUrl, config.primaryModel, systemPrompt, userQuery, timeoutMs);
    modelRawJson = res.text;
    modelUsed = config.primaryModel;
  } catch (primaryErr: any) {
    console.warn(`[AI RUNNER] Primary model (${config.primaryModel}) failed: ${primaryErr.message}. Attempting fallback model...`);

    // Try Fallback Model
    try {
      const res = await callLocalModel(config.runnerUrl, config.fallbackModel, systemPrompt, userQuery, timeoutMs);
      modelRawJson = res.text;
      modelUsed = config.fallbackModel;
      isFailoverUsed = true;
    } catch (fallbackErr: any) {
      console.warn(`[AI RUNNER] Fallback model (${config.fallbackModel}) also failed: ${fallbackErr.message}.`);
      // Both models failed!
    }
  }

  // Parse JSON from model output if available
  if (modelRawJson) {
    try {
      const jsonMatch = modelRawJson.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        plannedPlan = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // JSON parse error, ignore and fall back
    }
  }

  // If model didn't yield a valid plan, use deterministic plan
  if (!plannedPlan || !plannedPlan.operation) {
    plannedPlan = deterministicPlan;
  }

  // If still no plan can be resolved (e.g. models offline and query totally ambiguous)
  if (!plannedPlan) {
    // Check if models are truly offline
    const isOffline = !modelUsed;
    if (isOffline) {
      return {
        answerText: '«مساعد الميزان غير متاح حاليًا». يمكنك الاستمرار في استخدام الفلاتر التفاعلية، بطاقات الإحصائيات، ومقارنات الرسوم البيانية، وتصدير الجداول دون انقطاع.',
        plan: {
          sheetName: sheetAnalysis.name,
          goal: 'تعذر الاتصال بالمساعد الذكي',
          operation: 'count'
        },
        executionResult: { success: false, matchingRowCount: 0, matchingRowIndices: [], columnsUsed: [] },
        isFailoverUsed: false
      };
    }

    return {
      answerText: 'يرجى تحديد العمود المطلوب أو الفترة الزمنية بدقة أكبر لإتمام الحساب المحاسبي بدقة.',
      plan: {
        sheetName: sheetAnalysis.name,
        goal: 'استفسار بحاجة لتوضيح',
        operation: 'count'
      },
      executionResult: { success: false, matchingRowCount: 0, matchingRowIndices: [], columnsUsed: [] },
      modelUsed,
      isFailoverUsed
    };
  }

  // 3. Execute the validated plan strictly on the server engine!
  plannedPlan.sheetName = sheetAnalysis.name;
  const executionResult = executePlanFn(plannedPlan);

  // 4. Generate user-friendly accounting explanation based on execution output
  let explanation = '';
  if (executionResult.success) {
    const val = executionResult.primaryValue || '0.00';
    const unit = executionResult.unitOrCurrency || 'ج.م';
    const period = executionResult.periodDescription || '';
    const rowCount = executionResult.matchingRowCount;

    if (plannedPlan.operation === 'net_sales') {
      explanation = `بناءً على تحليل بيانات ورقة [${sheetAnalysis.name}]، بلغ **صافي المبيعات** ${val} ${unit} (${period}). ` +
        `تم حسابه من واقع ${rowCount} حركة مسجلة.\n\n` +
        `• ${executionResult.secondaryValue || ''}\n` +
        (executionResult.assumptionUsed ? `• *${executionResult.assumptionUsed}*` : '');
    } else if (plannedPlan.operation === 'group_by' && executionResult.breakdown) {
      explanation = `نتائج التحليل والتجميع حسب [${plannedPlan.groupByColumn || 'البيان'}] (${period}) من إجمالي ${rowCount} صف مطابقة:\n\n`;
      executionResult.breakdown.forEach((b: any, idx: number) => {
        explanation += `${idx + 1}. **${b.label}**: ${b.value} ${unit} (${b.count} حركة)\n`;
      });
    } else if (plannedPlan.operation === 'sum') {
      explanation = `إجمالي [${plannedPlan.targetColumn || 'المبالغ'}] يبلغ **${val} ${unit}** (${period})، محسوباً على جميع الصفوف المطابقة البالغ عددها **${rowCount} صفاً**.`;
    } else if (plannedPlan.operation === 'average') {
      explanation = `المتوسط الحسابي لـ [${plannedPlan.targetColumn || 'القيم'}] يبلغ **${val} ${unit}** من أصل ${rowCount} صف مطابقة.`;
    } else if (plannedPlan.operation === 'median') {
      explanation = `الوسيط الإحصائي لـ [${plannedPlan.targetColumn || 'القيم'}] يبلغ **${val} ${unit}** بعد ترتيب كافة الصفوف المطابقة (${rowCount} صفاً).`;
    } else if (plannedPlan.operation === 'distinct_count') {
      explanation = `عدد السجلات الفريدة يبلغ **${val}** (${executionResult.secondaryValue || ''}).`;
    } else {
      explanation = `نتيجة الحساب: **${val} ${unit}** على إجمالي ${rowCount} صفاً.`;
    }
  } else {
    explanation = executionResult.error || 'تعذر إتمام العملية على الأعمدة المحددة. يرجى التأكد من احتواء الملف على الأعمدة المناسبة.';
  }

  // 5. Strictly apply White Label sanitization
  const sanitizedAnswer = sanitizeWhiteLabelOutput(explanation);

  return {
    answerText: sanitizedAnswer,
    plan: plannedPlan,
    executionResult,
    modelUsed,
    isFailoverUsed
  };
}

/**
 * Diagnostic tool: Test connection to Local Model Runner and check failover
 */
export async function testAIRunnerConnection(config: AIRunnerConfig): Promise<{
  success: boolean;
  primaryStatus: { connected: boolean; latencyMs?: number; error?: string };
  fallbackStatus: { connected: boolean; latencyMs?: number; error?: string };
  hardwareRecommendations: string;
}> {
  const primaryStatus: { connected: boolean; latencyMs?: number; error?: string } = { connected: false };
  const fallbackStatus: { connected: boolean; latencyMs?: number; error?: string } = { connected: false };

  // Test Primary
  const pStart = Date.now();
  try {
    await callLocalModel(config.runnerUrl, config.primaryModel, 'Respond with OK', 'ping', 8000);
    primaryStatus.connected = true;
    primaryStatus.latencyMs = Date.now() - pStart;
  } catch (err: any) {
    primaryStatus.error = err.message;
  }

  // Test Fallback
  const fStart = Date.now();
  try {
    await callLocalModel(config.runnerUrl, config.fallbackModel, 'Respond with OK', 'ping', 8000);
    fallbackStatus.connected = true;
    fallbackStatus.latencyMs = Date.now() - fStart;
  } catch (err: any) {
    fallbackStatus.error = err.message;
  }

  const hardwareRecommendations = `
- طراز 7B (مثل Qwen 2.5 7B أو DeepSeek R1 7B): يتطلب ذاكرة عشوائية 8GB - 16GB RAM أو كارت شاشة VRAM 6GB - 8GB.
- طراز خفيف 1.5B أو 3B: يعمل بكفاءة على الحواسيب المكتبية العادية (4GB - 8GB RAM).
- الترخيص: Qwen 2.5 مرخص بموجب Apache 2.0، وDeepSeek R1 مرخص بموجب MIT. كلاهما مفتوح المصدر ومتاح للاستخدام التجاري والمحلي.
  `.trim();

  return {
    success: primaryStatus.connected || fallbackStatus.connected,
    primaryStatus,
    fallbackStatus,
    hardwareRecommendations
  };
}
