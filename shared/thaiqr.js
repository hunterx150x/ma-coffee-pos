// Thai QR (EMVCo) helpers shared by the browser and the server:
// read a shop's static QR (e.g. K SHOP / bank merchant QR) and re-issue it with the bill amount.

export function crc16(s) {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export const tlv = (id, v) => `${id}${String(v.length).padStart(2, '0')}${v}`;

/** "000201010211..." -> [{ id, value }] in order; null when the text isn't valid TLV. */
export function parseTlv(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !Number.isInteger(len) || i + 4 + len > s.length) return null;
    out.push({ id, value: s.slice(i + 4, i + 4 + len) });
    i += 4 + len;
  }
  return out;
}

/**
 * Check a scanned shop QR: EMVCo TLV, Thai baht, correct checksum.
 * Returns { ok, error, info } where info describes the payee for display.
 */
export function checkThaiQr(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: false, error: 'ไม่พบข้อมูล QR' };
  const fields = parseTlv(s);
  if (!fields || fields[0]?.id !== '00') return { ok: false, error: 'QR นี้ไม่ใช่ QR รับเงิน (Thai QR)' };
  const crc = fields.find((f) => f.id === '63');
  if (!crc || crc.value !== crc16(s.slice(0, s.length - 4))) return { ok: false, error: 'QR ไม่สมบูรณ์ (checksum ไม่ตรง) — ลองถ่าย / อัปโหลดใหม่ให้ชัดขึ้น' };
  const get = (id) => fields.find((f) => f.id === id)?.value;
  if (get('53') && get('53') !== '764') return { ok: false, error: 'QR นี้ไม่ได้รับเงินบาท' };
  // 29 = PromptPay, 30 = bill payment (shop / K SHOP style), 31 = bank merchant account.
  const sub = (id) => parseTlv(get(id) || '') || [];
  const bill = sub('30');
  const pp = sub('29');
  const info = bill.length
    ? { kind: 'bill', billerId: bill.find((f) => f.id === '01')?.value || '', ref1: bill.find((f) => f.id === '02')?.value || '', ref2: bill.find((f) => f.id === '03')?.value || '' }
    : pp.length ? { kind: 'promptpay', id: (pp.find((f) => f.id !== '00')?.value || '').replace(/^0066/, '0') } : { kind: 'other' };
  return { ok: true, info: { ...info, hasAmount: !!get('54'), amount: get('54') ? Number(get('54')) : null } };
}

/** The shop's QR with this amount filled in (dynamic QR), or as-is without an amount. */
export function thaiQrWithAmount(raw, amount) {
  const fields = parseTlv(String(raw || '').trim());
  if (!fields) return null;
  const amt = Number(amount);
  const keep = fields.filter((f) => !['54', '63'].includes(f.id));
  const out = keep.map((f) => (f.id === '01' ? { ...f, value: amt > 0 ? '12' : '11' } : f));
  if (amt > 0) out.push({ id: '54', value: amt.toFixed(2) });
  out.sort((a, b) => a.id.localeCompare(b.id)); // EMVCo keeps tags in ascending order (53, 54, 58 ...)
  const p = `${out.map((f) => tlv(f.id, f.value)).join('')}6304`;
  return p + crc16(p);
}
