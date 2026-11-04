import React, { useState, useEffect } from 'react';
import {
  Landmark, CreditCard, Plus, ArrowUpRight, ArrowDownLeft, Search, Building,
  Printer, CheckCircle2, AlertCircle, X, RotateCcw, FileText, ChevronRight
} from 'lucide-react';
import { CashBox, BankAccount, PaymentVoucher, Branch, Party, Account } from '../types';
import { Language, translations } from '../translations';
import { apiClient } from '../services/apiClient';
import { ConfirmModal } from './ConfirmModal';

interface TreasuryViewProps {
  cashBoxes: CashBox[];
  bankAccounts: BankAccount[];
  vouchers: PaymentVoucher[];
  branches: Branch[];
  parties: Party[];
  accounts: Account[];
  lang: Language;
  onRefresh: () => void;
}

interface OpenInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: number;
  remaining_amount: number;
}

export const TreasuryView: React.FC<TreasuryViewProps> = ({
  cashBoxes,
  bankAccounts,
  vouchers,
  branches,
  parties,
  accounts,
  lang,
  onRefresh
}) => {
  const t = translations[lang];

  // Filters
  const [activeFilter, setActiveFilter] = useState<'all' | 'receipt' | 'payment'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Modals
  const [showNewVoucherModal, setShowNewVoucherModal] = useState(false);
  const [voucherType, setVoucherType] = useState<'receipt' | 'payment'>('receipt');
  const [branchId, setBranchId] = useState(branches[0]?.id || 'br_cairo');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank_transfer'>('cash');
  const [cashBoxId, setCashBoxId] = useState(cashBoxes[0]?.id || '');
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id || '');
  const [recipientType, setRecipientType] = useState<'party' | 'direct'>('party');
  const [partyId, setPartyId] = useState(parties[0]?.id || '');
  const [directAccountId, setDirectAccountId] = useState('');
  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Allocations state
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [allocations, setAllocations] = useState<{ [invoiceId: string]: number }>({});

  // Details & Reversal modal
  const [selectedVoucher, setSelectedVoucher] = useState<any | null>(null);
  const [voucherAllocations, setVoucherAllocations] = useState<any[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [reversingVoucher, setReversingVoucher] = useState<any | null>(null);
  const [isReversing, setIsReversing] = useState(false);

  const formatEGP = (val: number, curr = 'EGP') => {
    return (val || 0).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + (curr === 'USD' ? ' $' : ' ج.م');
  };

  const nonGroupExpenseAndRevenueAccounts = accounts.filter(
    a => a.is_group === 0 && (a.account_type === 'expense' || a.account_type === 'revenue')
  );

  // Available cashboxes for current branch
  const branchCashBoxes = cashBoxes.filter(cb => !cb.branch_id || cb.branch_id === branchId);

  // Open Voucher Creation with specific type
  const handleOpenCreateModal = (type: 'receipt' | 'payment') => {
    setVoucherType(type);
    setErrorMsg('');
    setAmount('');
    setDescription('');
    setAllocations({});
    setOpenInvoices([]);

    // Select first appropriate party
    const relevantParties = parties.filter(p => type === 'receipt' ? p.type === 'customer' : p.type === 'supplier');
    if (relevantParties.length > 0) {
      setPartyId(relevantParties[0].id);
    } else if (parties.length > 0) {
      setPartyId(parties[0].id);
    }

    if (branchCashBoxes.length > 0) {
      setCashBoxId(branchCashBoxes[0].id);
    }
    setShowNewVoucherModal(true);
  };

  // Fetch open invoices when party or voucher type changes
  useEffect(() => {
    if (!showNewVoucherModal || recipientType !== 'party' || !partyId) {
      setOpenInvoices([]);
      setAllocations({});
      return;
    }

    let isCancelled = false;
    const fetchInvoices = async () => {
      setLoadingInvoices(true);
      try {
        if (voucherType === 'receipt') {
          const res = await apiClient.get('/sales/invoices');
          if (!isCancelled) {
            const open = (res.invoices || []).filter(
              (inv: any) => inv.customer_id === partyId && (inv.status === 'posted' || inv.status === 'partial') && inv.remaining_amount > 0
            );
            setOpenInvoices(open);
          }
        } else {
          const res = await apiClient.get('/purchases/invoices');
          if (!isCancelled) {
            const open = (res.invoices || []).filter(
              (inv: any) => inv.supplier_id === partyId && (inv.status === 'posted' || inv.status === 'partial') && inv.remaining_amount > 0
            );
            setOpenInvoices(open);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!isCancelled) setLoadingInvoices(false);
      }
    };

    fetchInvoices();
    return () => { isCancelled = true; };
  }, [showNewVoucherModal, recipientType, partyId, voucherType]);

  // Handle allocation change
  const handleAllocationChange = (invoiceId: string, val: string, maxRemaining: number) => {
    const num = parseFloat(val);
    if (isNaN(num) || num <= 0) {
      const next = { ...allocations };
      delete next[invoiceId];
      setAllocations(next);
      return;
    }
    const safeVal = Math.min(num, maxRemaining);
    setAllocations({ ...allocations, [invoiceId]: safeVal });
  };

  const handleFullAllocation = (invoiceId: string, maxRemaining: number) => {
    setAllocations({ ...allocations, [invoiceId]: maxRemaining });
  };

  const totalAllocated = Object.values(allocations).reduce((acc, curr) => acc + curr, 0);
  const numAmount = parseFloat(amount) || 0;
  const unallocatedAmount = Math.max(0, numAmount - totalAllocated);

  const handleSyncAmountWithAllocations = () => {
    if (totalAllocated > 0) {
      setAmount(totalAllocated.toFixed(2));
    }
  };

  const handleCreateVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || numAmount <= 0) {
      setErrorMsg('يرجى إدخال مبلغ صحيح وموجب للسند.');
      return;
    }

    if (totalAllocated > numAmount) {
      setErrorMsg(`مجموع المبالغ الموزعة (${totalAllocated.toFixed(2)}) يتجاوز إجمالي مبلغ السند (${numAmount.toFixed(2)}).`);
      return;
    }

    setSaving(true);
    setErrorMsg('');

    try {
      const formattedAllocations = Object.entries(allocations).map(([invoiceId, allocAmount]) => ({
        invoiceType: voucherType === 'receipt' ? 'sales_invoice' : 'purchase_invoice',
        invoiceId,
        amount: allocAmount
      }));

      await apiClient.post('/treasury/vouchers', {
        voucherType,
        branchId,
        paymentMethod,
        cashBoxId: paymentMethod === 'cash' ? cashBoxId : null,
        bankAccountId: paymentMethod === 'bank_transfer' ? bankAccountId : null,
        partyId: recipientType === 'party' ? partyId : null,
        directAccountId: recipientType === 'direct' ? directAccountId : null,
        voucherDate,
        amount: numAmount,
        description: description || (voucherType === 'receipt' ? 'سند تحصيل وقبض نقدية' : 'سند صرف وسداد مالي'),
        allocations: formattedAllocations.length > 0 ? formattedAllocations : undefined
      });

      setShowNewVoucherModal(false);
      setAmount('');
      setDescription('');
      setAllocations({});
      setSuccessMsg(`تم إصدار وترحيل ${voucherType === 'receipt' ? 'سند القبض' : 'سند الدفع'} بنجاح.`);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل إصدار السند');
    } finally {
      setSaving(false);
    }
  };

  // View Voucher Details
  const handleOpenVoucherDetails = async (voucher: PaymentVoucher) => {
    setSelectedVoucher(voucher);
    setVoucherAllocations([]);
    setLoadingDetails(true);

    try {
      const res = await apiClient.get(`/treasury/vouchers/${voucher.id}`);
      if (res.voucher) {
        setSelectedVoucher(res.voucher);
        setVoucherAllocations(res.allocations || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDetails(false);
    }
  };

  // Reversal Execution
  const handleConfirmReversal = async () => {
    if (!reversingVoucher) return;
    setIsReversing(true);
    try {
      await apiClient.post(`/treasury/vouchers/${reversingVoucher.id}/reverse`);
      setSuccessMsg(`تم عكس وإلغاء السند "${reversingVoucher.voucher_number}" بنجاح وإثبات القيد العكسي.`);
      setReversingVoucher(null);
      setSelectedVoucher(null);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل عكس السند');
      setReversingVoucher(null);
    } finally {
      setIsReversing(false);
    }
  };

  // Filtered Vouchers
  const filteredVouchers = vouchers.filter((v) => {
    const matchesFilter =
      activeFilter === 'all' ||
      (activeFilter === 'receipt' && v.voucher_type === 'receipt') ||
      (activeFilter === 'payment' && v.voucher_type === 'payment');

    const searchLower = searchTerm.toLowerCase();
    const matchesSearch =
      !searchTerm ||
      v.voucher_number.toLowerCase().includes(searchLower) ||
      (v.party_name && v.party_name.toLowerCase().includes(searchLower)) ||
      (v.description && v.description.toLowerCase().includes(searchLower)) ||
      v.amount.toString().includes(searchLower) ||
      (v.journal_number && v.journal_number.toLowerCase().includes(searchLower));

    return matchesFilter && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Success Notification */}
      {successMsg && (
        <div className="p-3 bg-emerald-50 text-emerald-800 text-xs rounded-xl border border-emerald-200 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg('')} className="p-1 text-emerald-600 hover:bg-emerald-100 rounded">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Error Notification */}
      {errorMsg && (
        <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl border border-rose-200 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-medium">{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg('')} className="p-1 text-rose-600 hover:bg-rose-100 rounded">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Landmark className="w-5 h-5 text-emerald-600" />
            {t.treasury} والخزائن النقدية والبنوك
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            إدارة حركة السيولة وسندات القبض والدفع المستقلة مع التأثير اللحظي على حسابات الأستاذ العام وتخصيص الفواتير.
          </p>
        </div>

        {/* Two distinct independent buttons for Receipt & Payment */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleOpenCreateModal('receipt')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm flex items-center gap-2 transition-all hover:shadow active:scale-98"
          >
            <ArrowDownLeft className="w-4 h-4 text-emerald-100" />
            <span>إصدار سند قبض</span>
          </button>

          <button
            onClick={() => handleOpenCreateModal('payment')}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-sm flex items-center gap-2 transition-all hover:shadow active:scale-98"
          >
            <ArrowUpRight className="w-4 h-4 text-rose-100" />
            <span>إصدار سند دفع</span>
          </button>
        </div>
      </div>

      {/* Cash Boxes and Banks Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cashBoxes.map((cb) => (
          <div key={cb.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:border-slate-300 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">{cb.name_ar}</span>
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700">
                <CreditCard className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 text-xl font-bold font-mono-numbers text-slate-900">
              {formatEGP(cb.current_balance)}
            </div>
            <div className="mt-1 text-[11px] text-slate-400 font-mono flex items-center justify-between">
              <span>كود: {cb.code}</span>
              <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded text-[10px]">خزينة نقدية</span>
            </div>
          </div>
        ))}

        {bankAccounts.map((ba) => (
          <div key={ba.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:border-slate-300 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">{ba.bank_name}</span>
              <div className="p-2 rounded-lg bg-sky-50 text-sky-700">
                <Landmark className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 text-xl font-bold font-mono-numbers text-slate-900">
              {formatEGP(ba.current_balance, ba.currency_code)}
            </div>
            <div className="mt-1 text-[11px] text-slate-400 font-mono truncate" title={ba.account_number}>
              حساب: {ba.account_number}
            </div>
          </div>
        ))}
      </div>

      {/* Vouchers Filter & Search */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveFilter('all')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                activeFilter === 'all' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              الكل ({vouchers.length})
            </button>
            <button
              onClick={() => setActiveFilter('receipt')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                activeFilter === 'receipt' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-600" />
              سندات القبض ({vouchers.filter(v => v.voucher_type === 'receipt').length})
            </button>
            <button
              onClick={() => setActiveFilter('payment')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                activeFilter === 'payment' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ArrowUpRight className="w-3.5 h-3.5 text-rose-600" />
              سندات الدفع والصرف ({vouchers.filter(v => v.voucher_type === 'payment').length})
            </button>
          </div>

          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 absolute top-2.5 right-3 text-slate-400" />
            <input
              type="text"
              placeholder="بحث برقم السند، الطرف، البيان..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pr-9 pl-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Vouchers Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-start">رقم السند</th>
                <th className="px-4 py-3 text-start">النوع</th>
                <th className="px-4 py-3 text-start">{t.date}</th>
                <th className="px-4 py-3 text-start">الطرف أو الحساب المقابل</th>
                <th className="px-4 py-3 text-start">الوسيلة / الخزينة / البنك</th>
                <th className="px-4 py-3 text-end">{t.total}</th>
                <th className="px-4 py-3 text-center">رقم القيد اليومي</th>
                <th className="px-4 py-3 text-center">التخصيص</th>
                <th className="px-4 py-3 text-center">{t.status}</th>
                <th className="px-4 py-3 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredVouchers.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                    لا توجد سندات مطابقة لمعايير البحث.
                  </td>
                </tr>
              ) : (
                filteredVouchers.map((v) => {
                  const isReceipt = v.voucher_type === 'receipt';
                  const isReversed = v.status === 'reversed';

                  return (
                    <tr
                      key={v.id}
                      onClick={() => handleOpenVoucherDetails(v)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    >
                      <td className="px-4 py-3 font-mono font-bold text-emerald-800">
                        {v.voucher_number}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold inline-flex items-center gap-1 ${
                          isReceipt ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {isReceipt ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                          {isReceipt ? 'سند قبض' : 'سند دفع'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600">{v.voucher_date}</td>
                      <td className="px-4 py-3 text-slate-800 font-medium max-w-[200px] truncate" title={v.party_name || v.description}>
                        {v.party_name ? `${v.party_name} - ${v.description}` : v.description}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {v.cashbox_name || v.bank_name || v.payment_method}
                      </td>
                      <td className="px-4 py-3 text-end font-mono-numbers font-bold text-slate-900">
                        {formatEGP(v.amount)}
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-slate-500">
                        {v.journal_number ? (
                          <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded font-semibold text-[11px]">
                            {v.journal_number}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {(v.allocated_amount || 0) > 0 ? (
                          <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-mono text-[10px]">
                            مخصص ({formatEGP(v.allocated_amount || 0)})
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[10px]">تحت الحساب</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          isReversed
                            ? 'bg-rose-100 text-rose-800 line-through'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {isReversed ? 'معكوس / ملغى' : 'مرحل'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleOpenVoucherDetails(v)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-semibold inline-flex items-center gap-1 transition-colors"
                        >
                          <FileText className="w-3 h-3" />
                          <span>عرض / طباعة</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Voucher Modal */}
      {showNewVoucherModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                {voucherType === 'receipt' ? (
                  <>
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                      <ArrowDownLeft className="w-5 h-5" />
                    </div>
                    <span>إصدار سند قبض وتحصيل مالي (Receipt Voucher)</span>
                  </>
                ) : (
                  <>
                    <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                      <ArrowUpRight className="w-5 h-5" />
                    </div>
                    <span>إصدار سند دفع وصرف مالي (Payment Voucher)</span>
                  </>
                )}
              </h3>
              <button
                type="button"
                onClick={() => setShowNewVoucherModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 mb-4 bg-rose-50 text-rose-700 text-xs rounded-lg border border-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleCreateVoucher} className="space-y-4 text-xs">
              {/* Type Switcher */}
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-center gap-4">
                <span className="font-semibold text-slate-700">نوع السند:</span>
                <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                  <input
                    type="radio"
                    name="vType"
                    checked={voucherType === 'receipt'}
                    onChange={() => setVoucherType('receipt')}
                    className="text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-emerald-800">سند قبض (تحصيل نقدية/بنك)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                  <input
                    type="radio"
                    name="vType"
                    checked={voucherType === 'payment'}
                    onChange={() => setVoucherType('payment')}
                    className="text-rose-600 focus:ring-rose-500"
                  />
                  <span className="text-rose-800">سند دفع (صرف نقدية/سداد)</span>
                </label>
              </div>

              {/* Branch and Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">الفرع</label>
                  <select
                    value={branchId}
                    onChange={(e) => {
                      setBranchId(e.target.value);
                      const cbs = cashBoxes.filter(cb => !cb.branch_id || cb.branch_id === e.target.value);
                      if (cbs.length > 0) setCashBoxId(cbs[0].id);
                    }}
                    className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                  >
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.code} - {b.name_ar}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">تاريخ السند</label>
                  <input
                    type="date"
                    required
                    value={voucherDate}
                    onChange={(e) => setVoucherDate(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Payment Method & Cashbox/Bank */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">طريقة السداد / التحصيل</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                    className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                  >
                    <option value="cash">نقداً من الخزينة (Cash)</option>
                    <option value="bank_transfer">تحويل بنكي (Bank Transfer)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {paymentMethod === 'cash' ? 'الخزينة النقدية' : 'الحساب البنكي'}
                  </label>
                  {paymentMethod === 'cash' ? (
                    <select
                      value={cashBoxId}
                      onChange={(e) => setCashBoxId(e.target.value)}
                      className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                    >
                      {branchCashBoxes.map(cb => (
                        <option key={cb.id} value={cb.id}>{cb.name_ar} (رصيد: {formatEGP(cb.current_balance)})</option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={bankAccountId}
                      onChange={(e) => setBankAccountId(e.target.value)}
                      className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                    >
                      {bankAccounts.map(ba => (
                        <option key={ba.id} value={ba.id}>{ba.bank_name} - {ba.account_number}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* Recipient Type */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <label className="block font-semibold text-slate-800 mb-2">توجيه السند والطرف المقابل</label>
                <div className="flex gap-4 mb-3">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="recType"
                      checked={recipientType === 'party'}
                      onChange={() => setRecipientType('party')}
                      className="text-emerald-600"
                    />
                    <span className="font-medium text-slate-700">طرف تجاري (عميل / مورد)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="recType"
                      checked={recipientType === 'direct'}
                      onChange={() => setRecipientType('direct')}
                      className="text-emerald-600"
                    />
                    <span className="font-medium text-slate-700">حساب مصروف أو إيراد مباشر</span>
                  </label>
                </div>

                {recipientType === 'party' ? (
                  <div>
                    <label className="block text-slate-600 mb-1 font-medium">اختر العميل / المورد</label>
                    <select
                      value={partyId}
                      onChange={(e) => setPartyId(e.target.value)}
                      className="w-full p-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-emerald-500"
                    >
                      {parties.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name_ar} ({p.type === 'supplier' ? 'مورد' : 'عميل'}) - رصيد: {formatEGP(p.current_balance || 0)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-slate-600 mb-1 font-medium">حساب المقابل المباشر</label>
                    <select
                      value={directAccountId}
                      onChange={(e) => setDirectAccountId(e.target.value)}
                      className="w-full p-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-emerald-500"
                    >
                      <option value="">-- اختر حساب المصروف أو الإيراد المباشر --</option>
                      {nonGroupExpenseAndRevenueAccounts.map(a => (
                        <option key={a.id} value={a.id}>{a.code} - {a.name_ar}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Amount & Description */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">المبلغ الإجمالي للسند (ج.م) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    min="0.01"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono text-end font-bold text-sm text-slate-900 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">البيان والشرح *</label>
                  <input
                    type="text"
                    required
                    placeholder={voucherType === 'receipt' ? 'مثال: سداد دفعة نقدية تحت الحساب للفاتورة...' : 'مثال: سداد مستحقات توريد خامات...'}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Invoice Allocation Section (When Party is Selected) */}
              {recipientType === 'party' && (
                <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/70 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-800 text-xs">تخصيص السند على الفواتير المفتوحة (اختياري)</span>
                      <p className="text-[11px] text-slate-500">
                        يمكنك توزيع مبلغ السند على فواتير محددة، أو تركه بدون تخصيص كدفعة تحت الحساب.
                      </p>
                    </div>
                    {totalAllocated > 0 && numAmount !== totalAllocated && (
                      <button
                        type="button"
                        onClick={handleSyncAmountWithAllocations}
                        className="px-2 py-1 bg-sky-100 hover:bg-sky-200 text-sky-800 rounded text-[11px] font-semibold"
                      >
                        مطابقة إجمالي السند ({totalAllocated.toFixed(2)})
                      </button>
                    )}
                  </div>

                  {loadingInvoices ? (
                    <div className="p-3 text-center text-slate-400 text-xs">جارٍ فحص الفواتير المفتوحة للطرف...</div>
                  ) : openInvoices.length === 0 ? (
                    <div className="p-2 text-center text-slate-400 text-[11px] bg-white rounded border border-slate-200">
                      لا توجد فواتير مفتوحة ذات رصيد مستحق لهذا الطرف حالياً. سيتم حفظ السند كدفعة تحت الحساب وتخفيض رصيده الإجمالي.
                    </div>
                  ) : (
                    <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg bg-white">
                      <table className="w-full text-[11px]">
                        <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0">
                          <tr>
                            <th className="p-1.5 text-start">رقم الفاتورة</th>
                            <th className="p-1.5 text-start">التاريخ</th>
                            <th className="p-1.5 text-end">إجمالي الفاتورة</th>
                            <th className="p-1.5 text-end">المتبقي</th>
                            <th className="p-1.5 text-center w-36">المبلغ المخصص</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {openInvoices.map(inv => {
                            const allocVal = allocations[inv.id] !== undefined ? allocations[inv.id] : '';
                            return (
                              <tr key={inv.id} className="hover:bg-slate-50">
                                <td className="p-1.5 font-mono font-bold text-slate-800">{inv.invoice_number}</td>
                                <td className="p-1.5 font-mono text-slate-500">{inv.invoice_date}</td>
                                <td className="p-1.5 text-end font-mono">{formatEGP(inv.total_amount)}</td>
                                <td className="p-1.5 text-end font-mono font-bold text-amber-700">{formatEGP(inv.remaining_amount)}</td>
                                <td className="p-1.5 text-center">
                                  <div className="flex items-center gap-1 justify-center">
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      max={inv.remaining_amount}
                                      value={allocVal}
                                      onChange={(e) => handleAllocationChange(inv.id, e.target.value, inv.remaining_amount)}
                                      placeholder="0.00"
                                      className="w-20 p-1 border border-slate-300 rounded text-end font-mono text-xs font-semibold focus:outline-none focus:border-emerald-500"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleFullAllocation(inv.id, inv.remaining_amount)}
                                      className="px-1.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px]"
                                    >
                                      الكل
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Allocation Summary Bar */}
                  <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200 text-[11px] font-mono">
                    <div>
                      <span className="text-slate-500">إجمالي التخصيص: </span>
                      <span className="font-bold text-emerald-700">{formatEGP(totalAllocated)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">المتبقي تحت الحساب: </span>
                      <span className={`font-bold ${unallocatedAmount < 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                        {formatEGP(unallocatedAmount)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Form Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewVoucherModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={`px-5 py-2 text-white rounded-lg font-semibold shadow-sm flex items-center gap-2 ${
                    voucherType === 'receipt'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {saving ? (
                    'جارٍ الترحيل...'
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{voucherType === 'receipt' ? 'ترحيل سند القبض' : 'ترحيل سند الدفع'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Voucher Details & Print Modal */}
      {selectedVoucher && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full p-6 border border-slate-200 my-8">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg ${
                  selectedVoucher.voucher_type === 'receipt' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                }`}>
                  {selectedVoucher.voucher_type === 'receipt' ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {selectedVoucher.voucher_type === 'receipt' ? 'سند قبض مالي معتمد' : 'سند دفع وصرف مالي معتمد'}
                  </h3>
                  <span className="text-xs font-mono text-slate-500">{selectedVoucher.voucher_number}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة</span>
                </button>
                <button
                  onClick={() => setSelectedVoucher(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Slip Layout */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-4 text-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div>
                  <div className="text-sm font-bold text-slate-900">نظام الميزان المحاسبي المتكامل - Al-Mizan ERP</div>
                  <div className="text-slate-500 text-[11px]">فرع: {selectedVoucher.branch_name || 'الفرع الرئيسي'}</div>
                </div>
                <div className="text-end">
                  <div className="font-mono font-bold text-slate-800">{selectedVoucher.voucher_date}</div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    selectedVoucher.status === 'reversed' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                  }`}>
                    {selectedVoucher.status === 'reversed' ? 'معكوس / ملغى' : 'مرحل ومعتمد'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-slate-500 block text-[11px]">الطرف أو المستفيد:</span>
                  <span className="font-bold text-slate-800 text-sm">{selectedVoucher.party_name || 'حساب مباشر'}</span>
                </div>
                <div className="text-end">
                  <span className="text-slate-500 block text-[11px]">المبلغ:</span>
                  <span className="font-bold font-mono text-base text-emerald-800">
                    {formatEGP(selectedVoucher.amount)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-200">
                <div>
                  <span className="text-slate-500 block text-[11px]">طريقة السداد / التحصيل:</span>
                  <span className="font-medium text-slate-800">
                    {selectedVoucher.cashbox_name ? `خزينة: ${selectedVoucher.cashbox_name}` : selectedVoucher.bank_name ? `بنك: ${selectedVoucher.bank_name}` : selectedVoucher.payment_method}
                  </span>
                </div>
                <div className="text-end">
                  <span className="text-slate-500 block text-[11px]">رقم القيد المحاسبي المقابل:</span>
                  <span className="font-mono font-bold text-slate-800">
                    {selectedVoucher.journal_number || '-'}
                  </span>
                </div>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">البيان:</span>
                <p className="font-medium text-slate-800 bg-white p-2 rounded border border-slate-200">
                  {selectedVoucher.description}
                </p>
              </div>

              {/* Allocations table */}
              {voucherAllocations.length > 0 && (
                <div className="pt-2 border-t border-slate-200">
                  <span className="font-bold text-slate-800 block mb-1">تفاصيل الفواتير المخصصة:</span>
                  <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                    <table className="w-full text-[11px]">
                      <thead className="bg-slate-100 text-slate-600 font-semibold">
                        <tr>
                          <th className="p-1.5 text-start">رقم الفاتورة</th>
                          <th className="p-1.5 text-end">المبلغ المخصص</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {voucherAllocations.map((alloc) => (
                          <tr key={alloc.id}>
                            <td className="p-1.5 font-mono text-slate-800">{alloc.invoice_number}</td>
                            <td className="p-1.5 text-end font-mono font-bold text-emerald-800">{formatEGP(alloc.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Signatures */}
              <div className="grid grid-cols-3 gap-2 pt-6 text-center text-[10px] text-slate-400 border-t border-dashed border-slate-300">
                <div>
                  <span>المستلم / الدافع</span>
                  <div className="mt-4 border-b border-slate-300 w-3/4 mx-auto"></div>
                </div>
                <div>
                  <span>أمين الخزينة / المحاسب</span>
                  <div className="mt-4 border-b border-slate-300 w-3/4 mx-auto"></div>
                </div>
                <div>
                  <span>المدير المالي</span>
                  <div className="mt-4 border-b border-slate-300 w-3/4 mx-auto"></div>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-100">
              {selectedVoucher.status !== 'reversed' ? (
                <button
                  type="button"
                  onClick={() => setReversingVoucher(selectedVoucher)}
                  className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>عكس وإلغاء السند</span>
                </button>
              ) : (
                <span className="text-xs text-rose-600 font-semibold">تم عكس هذا السند مسبقاً بقيد محاسبي.</span>
              )}

              <button
                type="button"
                onClick={() => setSelectedVoucher(null)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reversal Confirmation Modal */}
      <ConfirmModal
        isOpen={!!reversingVoucher}
        title="عكس وإلغاء سند مالي"
        message={`هل أنت متأكد من عكس وإلغاء السند رقم "${reversingVoucher?.voucher_number}" بمبلغ (${reversingVoucher ? formatEGP(reversingVoucher.amount) : ''})؟`}
        warning="سيقوم النظام بإنشاء قيد عكسي تلقائياً في الأستاذ العام وتعديل رصيد الخزينة والطرف وإعادة فتح متبقي الفواتير المخصصة."
        confirmLabel="تأكيد العكس والإلغاء"
        confirmVariant="danger"
        isLoading={isReversing}
        onConfirm={handleConfirmReversal}
        onCancel={() => setReversingVoucher(null)}
      />
    </div>
  );
};
