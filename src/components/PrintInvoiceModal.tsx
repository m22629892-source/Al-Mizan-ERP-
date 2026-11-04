import React from 'react';
import { Printer, Download, X, ShieldCheck } from 'lucide-react';
import { SalesInvoice, Company } from '../types';
import { Language } from '../translations';

interface PrintInvoiceModalProps {
  invoice: SalesInvoice | null;
  company: Company | null;
  lang: Language;
  onClose: () => void;
}

export const PrintInvoiceModal: React.FC<PrintInvoiceModalProps> = ({
  invoice,
  company,
  lang,
  onClose
}) => {
  if (!invoice) return null;

  const formatEGP = (val: number) => {
    return (val || 0).toLocaleString('ar-EG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' ج.م';
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full p-6 border border-slate-200 my-8">
        {/* Action Toolbar (hidden on print) */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200 no-print">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800 text-sm">معاينة الفاتورة الضريبية الرسمية A4</span>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono">
              {invoice.invoice_number}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-sm transition-colors"
            >
              <Printer className="w-4 h-4" />
              طباعة فورية / حفظ PDF
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Official Printable Egyptian Tax Invoice Paper (A4 Style) */}
        <div className="print-invoice-page bg-white p-6 sm:p-8 border border-slate-300 rounded-lg text-slate-900 font-sans">
          {/* Header */}
          <div className="flex justify-between items-start pb-6 border-b-2 border-slate-800">
            <div>
              <h1 className="text-xl font-black text-slate-900 tracking-tight">
                {company?.legal_name || 'شركة الميزان للتجارة والتوريدات ش.م.م'}
              </h1>
              <p className="text-xs text-slate-600 mt-1">
                {company?.address_ar || '15 شارع مكرم عبيد، المنطقة السادسة، مدينة نصر، القاهرة'}
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs font-semibold text-slate-800">
                <span>س.ت: {company?.commercial_registry || '189452'}</span>
                <span>•</span>
                <span className="text-emerald-800 font-mono">رقم التسجيل الضريبي: {company?.tax_id || '458-921-364'}</span>
              </div>
            </div>

            <div className="text-end">
              <div className="inline-block px-3 py-1 bg-slate-900 text-white font-bold text-xs uppercase tracking-wider rounded mb-2">
                فاتورة ضريبية إلكترونية
              </div>
              <div className="text-xs font-mono font-bold text-emerald-800">
                رقم الفاتورة: {invoice.invoice_number}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                تاريخ الإصدار: {invoice.invoice_date}
              </div>
              <div className="text-xs text-slate-500">
                الفرع المصدر: {invoice.branch_name || 'الفرع الرئيسي - القاهرة'}
              </div>
            </div>
          </div>

          {/* Customer & Tax Registration Block */}
          <div className="grid grid-cols-2 gap-6 my-6 p-4 bg-slate-50 rounded-lg border border-slate-200 text-xs">
            <div>
              <span className="text-slate-500 font-medium block mb-1">بيانات العميل (المشتري):</span>
              <div className="font-bold text-sm text-slate-900">{invoice.customer_name}</div>
              <div className="text-slate-600 mt-0.5">العنوان: {invoice.customer_address || 'القاهرة، مصر'}</div>
              <div className="text-slate-800 font-mono mt-1 font-semibold">
                الرقم الضريبي للمشتري: {invoice.customer_tax_id || 'غير مسجل'}
              </div>
            </div>

            <div className="text-end">
              <span className="text-slate-500 font-medium block mb-1">شروط وسداد المعاملة:</span>
              <div className="font-semibold text-slate-800">
                طريقة الدفع: {invoice.payment_type === 'cash' ? 'نقدي فوري' : 'آجل على الحساب'}
              </div>
              <div className="text-slate-500 mt-0.5">تاريخ الاستحقاق: {invoice.due_date}</div>
              <div className="inline-flex items-center gap-1 mt-2 text-[11px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                <ShieldCheck className="w-3.5 h-3.5" />
                حالة الضرائب المصرية: {invoice.eta_status === 'Valid' ? 'معتمدة بمنظومة ETA' : 'جاهزة للربط الإلكتروني'}
              </div>
            </div>
          </div>

          {/* Items Table */}
          <table className="w-full text-xs text-start border border-slate-300 rounded mb-6">
            <thead className="bg-slate-100 text-slate-800 font-bold border-b border-slate-300">
              <tr>
                <th className="p-2 text-center w-10">م</th>
                <th className="p-2 text-start">الصنف والبيان التفصيلي</th>
                <th className="p-2 text-center w-16">الوحدة</th>
                <th className="p-2 text-end w-16">الكمية</th>
                <th className="p-2 text-end w-24">سعر الوحدة</th>
                <th className="p-2 text-end w-24">الضريبة (14%)</th>
                <th className="p-2 text-end w-28">الإجمالي بالضريبة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {invoice.items && invoice.items.length > 0 ? (
                invoice.items.map((item, idx) => (
                  <tr key={item.id} className="hover:bg-slate-50/50">
                    <td className="p-2 text-center text-slate-500 font-mono">{idx + 1}</td>
                    <td className="p-2 font-medium text-slate-900">
                      <div>{item.item_name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        كود: {item.item_code} {item.eta_item_code ? `| ETA: ${item.eta_item_code}` : ''}
                      </div>
                    </td>
                    <td className="p-2 text-center text-slate-600">قطعة</td>
                    <td className="p-2 text-end font-mono font-bold">{item.quantity}</td>
                    <td className="p-2 text-end font-mono">{formatEGP(item.unit_price)}</td>
                    <td className="p-2 text-end font-mono text-slate-600">{formatEGP(item.tax_amount)}</td>
                    <td className="p-2 text-end font-mono font-bold text-slate-900">{formatEGP(item.total_amount)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-slate-400">
                    بنود الفاتورة مسجلة بترحيل الأستاذ العام
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Financial Calculation Totals Box (Egyptian VAT 14% + 1% WHT) */}
          <div className="flex justify-between items-start gap-8 border-t border-slate-300 pt-4">
            {/* Left QR Code & Notes */}
            <div className="w-1/2 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-3">
                {/* Simulated e-Invoice QR Code placeholder */}
                <div className="w-16 h-16 bg-slate-900 text-white flex items-center justify-center font-mono text-[9px] text-center p-1 rounded shrink-0">
                  QR CODE ETA VERIFIED
                </div>
                <div className="text-[11px] text-slate-600">
                  <div className="font-bold text-slate-800">ختم منظومة الفاتورة الإلكترونية</div>
                  <div className="font-mono text-[10px] text-slate-500 break-all">
                    UUID: {invoice.eta_uuid || 'f47ac10b-58cc-4372-a567-0e02b2c3d479'}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Totals Table */}
            <div className="w-80 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>الإجمالي قبل الخصم والضريبة:</span>
                <span className="font-mono font-semibold">{formatEGP(invoice.subtotal)}</span>
              </div>
              {invoice.discount_amount > 0 && (
                <div className="flex justify-between text-rose-600">
                  <span>الخصم التجاري الممنوح:</span>
                  <span className="font-mono">- {formatEGP(invoice.discount_amount)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-700 font-semibold border-t border-slate-200 pt-1">
                <span>الوعاء الخاضع للضريبة:</span>
                <span className="font-mono">{formatEGP(invoice.taxable_amount)}</span>
              </div>
              <div className="flex justify-between text-emerald-800 font-medium">
                <span>ضريبة القيمة المضافة (14%):</span>
                <span className="font-mono">+ {formatEGP(invoice.tax_amount)}</span>
              </div>
              <div className="flex justify-between text-sky-800 font-medium">
                <span>خصم وتحصيل تحت الحساب (1%):</span>
                <span className="font-mono">- {formatEGP(invoice.withholding_tax_amount)}</span>
              </div>
              <div className="flex justify-between text-slate-900 font-black text-sm border-t-2 border-slate-900 pt-2 bg-emerald-50/50 p-2 rounded">
                <span>الصافي الإجمالي المستحق:</span>
                <span className="font-mono text-emerald-900 font-bold">{formatEGP(invoice.total_amount)}</span>
              </div>
            </div>
          </div>

          {/* Signatures */}
          <div className="grid grid-cols-3 gap-6 pt-12 mt-8 border-t border-slate-200 text-center text-xs text-slate-600">
            <div>
              <span className="block font-semibold mb-8">المستلم / المشتري</span>
              <span className="text-slate-400">التوقيع: ...........................</span>
            </div>
            <div>
              <span className="block font-semibold mb-8">أمين المخزن المختص</span>
              <span className="text-slate-400">التوقيع: ...........................</span>
            </div>
            <div>
              <span className="block font-semibold mb-8">إدارة الحسابات والمالية</span>
              <span className="text-slate-400">التوقيع والختم: ...........................</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
