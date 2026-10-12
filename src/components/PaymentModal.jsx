import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { baht, transferQrPayload } from '../utils.js';
import BankAccount from './BankAccount.jsx';
import { Icon, Modal, Field, Loading } from './ui.jsx';

/** Choose cash / transfer, take cash and show change, or show the shop's transfer QR with the amount. */
export default function PaymentModal({ open, total, settings, onClose, onPay, defaultMethod = null }) {
  const [method, setMethod] = useState(null);
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [qr, setQr] = useState(null);

  useEffect(() => {
    if (open) { setMethod(defaultMethod); setCash(''); setErr(''); }
  }, [open, defaultMethod]);

  useEffect(() => {
    setQr(null);
    if (method !== 'transfer') return;
    const payload = transferQrPayload(settings.payment, settings.promptPayId, total);
    if (payload) QRCode.toDataURL(payload, { margin: 1, width: 240 }).then(setQr).catch(() => setQr(null));
  }, [method, total, settings.promptPayId, settings.payment]);
  const mode = settings.payment?.mode || 'promptpay';
  const shopQr = mode === 'shopqr' && settings.payment.shopQr;
  const account = mode === 'account' && settings.payment.accountNo ? settings.payment : null;
  const hasQr = shopQr || (mode === 'promptpay' && settings.promptPayId);

  const received = cash === '' ? total : Number(cash);
  const change = received - total;
  const quick = [...new Set([total, Math.ceil(total / 20) * 20, Math.ceil(total / 100) * 100, 500, 1000])].filter((v) => v >= total).slice(0, 5);

  const submit = async () => {
    if (method === 'cash' && change < 0) return setErr('จำนวนเงินที่รับมาไม่พอ');
    setBusy(true);
    setErr('');
    try {
      await onPay({ method, cashReceived: method === 'cash' ? received : undefined });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="เลือกวิธีชำระเงิน" onClose={busy ? undefined : onClose}
      footer={(
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn btn-success" disabled={!method || busy || (method === 'cash' && change < 0)} onClick={submit}>
            {busy ? 'กำลังบันทึก...' : 'ยืนยันรับเงิน'}
          </button>
        </>
      )}>
      <div className="due due-sm"><span>ยอดชำระ</span><b>{baht(total)}</b></div>
      <div className="grid grid-2">
        <button className={`tile tile-pay ${method === 'cash' ? 'selected' : ''}`} onClick={() => setMethod('cash')}>
          <Icon name="cash" size={32} /><span className="tile-name">เงินสด</span>
        </button>
        <button className={`tile tile-pay ${method === 'transfer' ? 'selected' : ''}`} onClick={() => setMethod('transfer')}>
          <Icon name="qr" size={32} /><span className="tile-name">เงินโอน / QR</span>
        </button>
      </div>

      {method === 'cash' && (
        <div className="pay-cash">
          <Field label="รับเงินมา (บาท)">
            <input className="input input-lg" type="number" inputMode="decimal" min={0} placeholder={String(total)} value={cash}
              onChange={(e) => setCash(e.target.value)} autoFocus />
          </Field>
          <div className="chips">
            {quick.map((v) => (
              <button key={v} className={`chip ${received === v ? 'active' : ''}`} onClick={() => setCash(String(v))}>
                {v === total ? `พอดี ${baht(v)}` : baht(v)}
              </button>
            ))}
          </div>
          <div className={`change-box ${change < 0 ? 'neg' : ''}`}>
            <span>{change < 0 ? 'ยังขาดอีก' : 'เงินทอน'}</span>
            <b>{baht(Math.abs(change))}</b>
          </div>
        </div>
      )}

      {method === 'transfer' && (
        <div className="pay-transfer">
          {hasQr ? (
            qr ? (
              <>
                <img src={qr} alt={`QR รับเงิน ${baht(total)}`} width="220" height="220" />
                <div className="muted small">{shopQr ? `QR ร้าน · ระบุยอด ${baht(total)} ให้แล้ว` : `PromptPay: ${settings.promptPayId}`}</div>
              </>
            ) : <Loading />
          ) : account ? (
            <>
              <div className="muted small">ให้ลูกค้าโอน {baht(total)} เข้าบัญชีนี้</div>
              <BankAccount payment={account} compact />
            </>
          ) : (
            <p className="muted">ตรวจสอบยอดโอนจากลูกค้า แล้วกด “ยืนยันรับเงิน”<br /><span className="small">(ตั้งค่าการรับเงินโอนที่ “ตั้งค่าร้าน” เพื่อแสดง QR พร้อมยอดอัตโนมัติ)</span></p>
          )}
        </div>
      )}
      {err && <div className="field-error">{err}</div>}
    </Modal>
  );
}
