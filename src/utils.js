const pad = (n) => String(n).padStart(2, '0');

export const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => toDateStr(new Date());

export function presetRange(key) {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  switch (key) {
    case 'yesterday': {
      const x = new Date(y, m, d.getDate() - 1);
      return { from: toDateStr(x), to: toDateStr(x) };
    }
    case 'week': {
      const dow = (d.getDay() + 6) % 7; // Monday start
      return { from: toDateStr(new Date(y, m, d.getDate() - dow)), to: today() };
    }
    case 'month':
      return { from: toDateStr(new Date(y, m, 1)), to: today() };
    case 'lastMonth':
      return { from: toDateStr(new Date(y, m - 1, 1)), to: toDateStr(new Date(y, m, 0)) };
    case 'year':
      return { from: toDateStr(new Date(y, 0, 1)), to: today() };
    case 'today':
    default:
      return { from: today(), to: today() };
  }
}

const nf = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const nf2 = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (n) => nf.format(Number(n) || 0);
export const baht = (n) => `฿${nf.format(Number(n) || 0)}`;
export const baht2 = (n) => `฿${nf2.format(Number(n) || 0)}`;

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export function thDate(str, { year = true } = {}) {
  if (!str) return '';
  const d = typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str) ? new Date(`${str}T00:00:00`) : new Date(str);
  return `${d.getDate()} ${TH_MONTHS[d.getMonth()]}${year ? ` ${(d.getFullYear() + 543) % 100}` : ''}`;
}
export const thTime = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const thDateTime = (iso) => `${thDate(iso)} ${thTime(iso)}`;

export const sweetLabel = (s) => (s == null ? '' : `หวาน ${s}%`);
export const sweetDesc = (lv) => (lv === 0 ? 'ไม่หวาน' : lv <= 25 ? 'หวานน้อย' : lv <= 50 ? 'หวานกลาง' : lv <= 75 ? 'หวานมาก' : 'หวานปกติ');

export const discountLabel = (d) => {
  if (d.type === 'percent') return `ลด ${num(d.value)}%`;
  if (d.type === 'free') return d.maxValue > 0 ? `ฟรี 1 แก้ว (≤ ${baht(d.maxValue)})` : 'ฟรี 1 แก้ว';
  return `ลด ${baht(d.value)}`;
};

export function downloadCsv(filename, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); // Safari only downloads links that are in the page
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// PromptPay (Thai QR) payload, EMVCo format.
function crc16(s) {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
const tlv = (id, v) => `${id}${String(v.length).padStart(2, '0')}${v}`;
export function promptPayPayload(id, amount) {
  const digits = String(id || '').replace(/\D/g, '');
  if (!digits) return null;
  let target;
  if (digits.length >= 15) target = tlv('03', digits);
  else if (digits.length >= 13) target = tlv('02', digits);
  else target = tlv('01', `0066${digits.replace(/^0/, '')}`.padStart(13, '0'));
  const merchant = tlv('29', tlv('00', 'A000000677010111') + target);
  let p = tlv('00', '01') + tlv('01', amount ? '12' : '11') + merchant + tlv('58', 'TH') + tlv('53', '764');
  if (amount) p += tlv('54', Number(amount).toFixed(2));
  p += '6304';
  return p + crc16(p);
}

// First letter for avatars; skips Thai leading vowels (เ แ โ ใ ไ).
export const initial = (name) => String(name || '?').replace(/^[เแโใไ]/, '').slice(0, 1);
