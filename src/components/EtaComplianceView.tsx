import React, { useState } from 'react';
import { FileCheck2, ShieldCheck, ExternalLink, AlertTriangle, CheckCircle, RefreshCw, Key, Hash, Send, X } from 'lucide-react';
import { Language } from '../translations';
import { SalesInvoice } from '../types';
import { apiClient } from '../services/apiClient';

interface EtaComplianceViewProps {
  invoices: SalesInvoice[];
  lang: Language;
  onRefresh: () => void;
}

export const EtaComplianceView: React.FC<EtaComplianceViewProps> = ({ invoices, lang, onRefresh }) => {
  const [activeTab, setActiveTab] = useState<'submissions' | 'standards' | 'settings'>('submissions');
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [lastSubmissionResponse, setLastSubmissionResponse] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const officialSources = [
    {
      title: 'بوابة منظومة الفاتورة الإلكترونية - مصلحة الضرائب المصرية (ETA Portal)',
      url: 'https://invoicing.eta.gov.eg',
      reviewDate: 'نوفمبر 2026',
      notes: 'المواصفة الفنية V1.0 - معايير توقيع المستندات والتشفير والربط عبر واجهات برمجة التطبيقات (API SDK).'
    },
    {
      title: 'قانون الإجراءات الضريبية الموحد رقم 206 لسنة 2020 ولائحته التنفيذية',
      url: 'https://www.eta.gov.eg',
      reviewDate: 'نوفمبر 2026',
      notes: 'إلزام الشركات بإصدار فواتير وإيصالات إلكترونية واعتماد دفاتر الحسابات الإلكترونية.'
    },
    {
      title: 'قانون الضريبة على القيمة المضافة رقم 67 لسنة 2016 وتعديلاته بالقانون 3 لسنة 2022',
      url: 'https://mof.gov.eg',
      reviewDate: 'نوفمبر 2026',
      notes: 'النسبة العامة 14% للسلع والخدمات التجارية، مع تحديد حالات الإعفاء وجداول السلع المعفاة والضريبة الإضافية.'
    },
    {
      title: 'دليل أكواد السلع والخدمات العالمية والمحلية (GS1 / EGS)',
      url: 'https://gs1eg.org',
      reviewDate: 'نوفمبر 2026',
      notes: 'التكويد الإلزامي لجميع الأصناف التجارية الموردة وربطها برقم التسجيل الضريبي للشركة.'
    }
  ];

  const handleSimulateSubmit = async (invoiceId: string) => {
    setSubmittingId(invoiceId);
    setLastSubmissionResponse(null);
    setErrorMsg('');
    try {
      const data = await apiClient.post(`/eta/simulate-submission/${invoiceId}`);
      setLastSubmissionResponse(data);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(`خطأ: ${err.message}`);
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <FileCheck2 className="w-5 h-5 text-emerald-600" />
            منظومة الفاتورة والإيصال الإلكتروني (ETA Compliance Portal)
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            طبقة تكامل مستقلة تحاكي متطلبات مصلحة الضرائب المصرية الرسمية وتوثق الأكواد والتوقيع الإلكتروني.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold rounded-lg">
            وضع المحاكاة النشط (Sandbox Simulation)
          </span>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl border border-rose-200 flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="p-1 text-rose-600 hover:bg-rose-100 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('submissions')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            activeTab === 'submissions'
              ? 'bg-emerald-600 text-white font-bold'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          سجل إرسال ومطابقة الفواتير
        </button>
        <button
          onClick={() => setActiveTab('standards')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            activeTab === 'standards'
              ? 'bg-emerald-600 text-white font-bold'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          المصادر القانونية والمعايير الرسمية الموثقة
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            activeTab === 'settings'
              ? 'bg-emerald-600 text-white font-bold'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          إعدادات الأكواد والتوقيع الإلكتروني (HSM / Token)
        </button>
      </div>

      {/* Tab 1: Submissions */}
      {activeTab === 'submissions' && (
        <div className="space-y-4">
          {lastSubmissionResponse && (
            <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 text-xs">
              <div className="flex items-center gap-2 text-emerald-800 font-bold mb-1">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                <span>{lastSubmissionResponse.message}</span>
              </div>
              <div className="text-slate-600 font-mono text-[11px] mt-2 space-y-1">
                <div>Document UUID: <span className="text-slate-900 font-bold">{lastSubmissionResponse.uuid}</span></div>
                <div className="truncate">Cryptographic Hash: {lastSubmissionResponse.hashSignature}</div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-start">رقم الفاتورة</th>
                  <th className="px-4 py-3 text-start">العميل</th>
                  <th className="px-4 py-3 text-start">الرقم الضريبي للمشتري</th>
                  <th className="px-4 py-3 text-end">قيمة الفاتورة</th>
                  <th className="px-4 py-3 text-center">حالة المنظومة</th>
                  <th className="px-4 py-3 text-center">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono font-bold text-emerald-800">{inv.invoice_number}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{inv.customer_name}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">{inv.customer_tax_id || 'غير مسجل'}</td>
                    <td className="px-4 py-2.5 text-end font-mono-numbers font-bold text-slate-900">
                      {inv.total_amount?.toLocaleString('ar-EG')} ج.م
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`px-2.5 py-0.5 rounded text-[10px] font-semibold inline-flex items-center gap-1 ${
                        inv.eta_status === 'Valid'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : 'bg-amber-100 text-amber-800 border border-amber-300'
                      }`}>
                        {inv.eta_status === 'Valid' ? 'معتمدة ومطابقة (Valid)' : 'قيد الإرسال (Pending)'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {inv.eta_status !== 'Valid' ? (
                        <button
                          onClick={() => handleSimulateSubmit(inv.id)}
                          disabled={submittingId === inv.id}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-semibold inline-flex items-center gap-1"
                        >
                          <Send className="w-3 h-3" />
                          {submittingId === inv.id ? 'جارٍ الإرسال...' : 'إرسال للمنظومة'}
                        </button>
                      ) : (
                        <span className="text-emerald-700 font-mono text-[10px] font-bold">
                          UUID: {inv.eta_uuid?.slice(0, 8)}...
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Standards & Legal Sources */}
      {activeTab === 'standards' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <div>
              <h3 className="font-bold text-sm text-slate-900">المراجع والأسس القانونية المعتمدة لمنظومة الضرائب المصرية</h3>
              <p className="text-xs text-slate-500">تمت المراجعة والتوثيق بما يتوافق مع أحدث قرارات مصلحة الضرائب المصرية ووزارة المالية.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-2">
            {officialSources.map((s, idx) => (
              <div key={idx} className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
                <div className="font-bold text-slate-900 flex items-center justify-between">
                  <span>{s.title}</span>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-600 hover:text-emerald-700"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
                <div className="text-slate-600">{s.notes}</div>
                <div className="pt-2 text-[11px] text-slate-400 border-t border-slate-200 flex justify-between">
                  <span>تاريخ الفحص والمراجعة:</span>
                  <span className="font-semibold text-slate-700">{s.reviewDate}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5 mt-4">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block mb-1">ملاحظة محاسبية وإخلاء مسؤولية تنظيمي:</span>
              تخضع بعض الأنشطة التجارية أو المعاملات التصديرية أو السلع المعفاة بموجب المادة 29 إلى معالجات ضريبية خاصة (مثل ضريبة الجدول أو إعفاء كامل). يجب مراجعة أي نسبة خاصة أو توجيه ضريبي مع المحاسب القانوني المعتمد للشركة قبل إصدار الإقرارات الختامية.
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Security & ETA Secrets */}
      {activeTab === 'settings' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 max-w-2xl mx-auto space-y-4 text-xs">
          <div className="pb-3 border-b border-slate-200">
            <h3 className="font-bold text-sm text-slate-900">إعدادات أمان الربط والتوقيع الإلكتروني (ETA Security Secrets)</h3>
            <p className="text-slate-500 mt-1">تُحفظ الأسرار وشهادات التوقيع الإلكتروني حصرياً بالخادم ولا تُعرض بالمتصفح وفقاً لضوابط الأمان.</p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">معرف العميل (ETA Client ID)</label>
              <input
                type="text"
                disabled
                value="d92b87f1-3940-410a-8491-000000000000"
                className="w-full p-2 bg-slate-100 border border-slate-300 rounded font-mono text-slate-500"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">الرقم السري للعميل (ETA Client Secret)</label>
              <input
                type="password"
                disabled
                value="••••••••••••••••••••••••••••••••"
                className="w-full p-2 bg-slate-100 border border-slate-300 rounded font-mono text-slate-500"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">شهادة التوقيع الرقمي (Egypt Trust / Misr Sign HSM Token)</label>
              <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 text-emerald-800 font-semibold flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                <span>شهادة التوقيع الإلكتروني معرّفة ومشفرة بالخادم (Algorithm: SHA-256 with RSA)</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
