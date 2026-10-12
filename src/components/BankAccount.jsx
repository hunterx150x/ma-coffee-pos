import { useState } from 'react';
import { Icon } from './ui.jsx';

/** Bank account to type in by hand (for customers who don't scan), with a copy button. */
export default function BankAccount({ payment, compact = false }) {
  const [copied, setCopied] = useState(false);
  if (!payment?.accountNo) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(payment.accountNo.replace(/-/g, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  };
  return (
    <div className={`bank-account ${compact ? 'bank-account-compact' : ''}`}>
      <div className="bank-account-main">
        <span className="muted small">{payment.bankName || 'เลขบัญชี'}</span>
        <b className="bank-account-no">{payment.accountNo}</b>
        {payment.accountName && <span className="small">{payment.accountName}</span>}
      </div>
      <button type="button" className="btn btn-sm btn-outline" onClick={copy}>
        {copied ? <><Icon name="check" size={16} /> คัดลอกแล้ว</> : 'คัดลอกเลขบัญชี'}
      </button>
    </div>
  );
}
