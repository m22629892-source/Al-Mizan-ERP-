import React, { useState, useEffect } from 'react';
import { TestTube2, Play, CheckCircle2, XCircle, Clock, ShieldCheck, RefreshCw, Layers } from 'lucide-react';
import { Language } from '../translations';
import { apiClient } from '../services/apiClient';

interface TestResult {
  suiteNumber: number;
  name: string;
  passed: boolean;
  message: string;
  details?: any;
  durationMs: number;
}

interface TestRunnerViewProps {
  token?: string;
  lang: Language;
}

export const TestRunnerView: React.FC<TestRunnerViewProps> = ({ token, lang }) => {
  const [running, setRunning] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [summary, setSummary] = useState<{ total: number; passed: number; failed: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const runTests = async () => {
    setRunning(true);
    setErrorMsg('');
    try {
      const data = await apiClient.post('/tests/run');
      setTestResults(data.results || []);
      setSummary(data.summary || null);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'فشل تشغيل الاختبارات');
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    runTests();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <TestTube2 className="w-5 h-5 text-emerald-600" />
            <span>{lang === 'ar' ? 'مركز الاختبارات ومعايير القبول المحاسبي (18 دورة وسيناريو مالي حرج)' : 'Financial Acceptance Test Center (18 Critical Scenarios)'}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {lang === 'ar'
              ? 'اختبارات آلية فعلية تُنفذ داخل قاعدة بيانات معزولة ومحمية، تتحقق من توازن الأستاذ العام، دورة الشراء والبيع، مردودات المبيعات والمشتريات، وحساب المتوسط المرجح للتكلفة، دون المساس ببيانات التشغيل.'
              : 'Automated real-world financial invariant tests running strictly inside an isolated test database without modifying operational data.'}
          </p>
        </div>

        <button
          onClick={runTests}
          disabled={running}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg shadow-sm flex items-center gap-2 transition-colors self-start md:self-auto"
        >
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {running ? 'جارٍ تشغيل الاختبارات...' : 'إعادة تشغيل جميع الاختبارات الآن'}
        </button>
      </div>

      {errorMsg && (
        <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl border border-rose-200">
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Summary Scorecard */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-500">إجمالي الاختبارات المحاسبية</span>
              <div className="text-2xl font-bold font-mono text-slate-900 mt-1">{summary.total}</div>
            </div>
            <div className="p-3 bg-slate-100 rounded-lg text-slate-700">
              <Layers className="w-5 h-5" />
            </div>
          </div>

          <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 shadow-xs flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-emerald-700">الاختبارات الناجحة (Passed)</span>
              <div className="text-2xl font-bold font-mono text-emerald-800 mt-1">{summary.passed}</div>
            </div>
            <div className="p-3 bg-emerald-100 rounded-lg text-emerald-700">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>

          <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-500">الاختبارات المتعثرة (Failed)</span>
              <div className={`text-2xl font-bold font-mono mt-1 ${summary.failed > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                {summary.failed}
              </div>
            </div>
            <div className="p-3 bg-slate-100 rounded-lg text-slate-400">
              <XCircle className="w-5 h-5" />
            </div>
          </div>
        </div>
      )}

      {/* Test Suites List */}
      <div className="space-y-3">
        {testResults.map((t) => (
          <div
            key={t.suiteNumber}
            className={`p-4 rounded-xl border transition-all ${
              t.passed
                ? 'bg-white border-slate-200 shadow-xs hover:border-emerald-300'
                : 'bg-rose-50 border-rose-200'
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 p-1.5 rounded-full ${
                  t.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                }`}>
                  {t.passed ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-400">
                      Suite #{t.suiteNumber.toString().padStart(2, '0')}:
                    </span>
                    <h4 className="font-bold text-sm text-slate-900">{t.name}</h4>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">{t.message}</p>

                  {t.details && (
                    <div className="mt-2 p-2 bg-slate-50 rounded border border-slate-200 text-[11px] font-mono text-slate-700">
                      {JSON.stringify(t.details)}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {t.durationMs}ms
                </span>
                <span className={`px-2.5 py-0.5 rounded text-[10px] font-semibold ${
                  t.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                }`}>
                  {t.passed ? 'ناجح (Passed)' : 'فشل (Failed)'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
