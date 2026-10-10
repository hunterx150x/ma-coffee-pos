// LINE Messaging API: push notifications to the shop's LINE group + simple group commands.
import crypto from 'crypto';
import https from 'https';

const TOKEN = () => process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const SECRET = () => process.env.LINE_CHANNEL_SECRET || '';

export const lineConfigured = () => Boolean(TOKEN() && SECRET());
export const lineState = { lastError: null, lastSentAt: null };

function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: 'api.line.me',
      path,
      method,
      headers: {
        Authorization: `Bearer ${TOKEN()}`,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
      timeout: 10000,
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        let json = {};
        try { json = out ? JSON.parse(out) : {}; } catch { /* not json */ }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else {
          const detail = json.details?.map((d) => `${d.property}: ${d.message}`).join('; ');
          reject(new Error(`LINE ${res.statusCode}: ${json.message || out}${detail ? ` (${detail})` : ''}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('LINE API timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

export function verifySignature(rawBody, signature) {
  if (!SECRET() || !signature) return false;
  const expected = crypto.createHmac('sha256', SECRET()).update(rawBody).digest('base64');
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function push(to, messages) {
  if (!lineConfigured() || !to) return;
  try {
    await call('POST', '/v2/bot/message/push', { to, messages });
    lineState.lastSentAt = new Date().toISOString();
    lineState.lastError = null;
  } catch (e) {
    lineState.lastError = `${new Date().toISOString()} ${e.message}`;
    console.error('ส่ง LINE ไม่สำเร็จ:', e.message);
    throw e;
  }
}

/** Fire-and-forget push: a LINE outage must never block a sale. */
export const pushQuiet = (to, messages) => { push(to, messages).catch(() => {}); };

export const reply = (replyToken, messages) => call('POST', '/v2/bot/message/reply', { replyToken, messages });
export const validate = (messages) => call('POST', '/v2/bot/message/validate/push', { messages });
export const groupSummary = (groupId) => call('GET', `/v2/bot/group/${groupId}/summary`);

// ---------- flex builders ----------
const C = { brown: '#6f4e37', ink: '#2b1d14', muted: '#8a7768', green: '#2e7d52', red: '#c0392b', amber: '#b26a00', bg: '#f6f1eb' };
const nf = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
const baht = (n) => `฿${nf.format(Number(n) || 0)}`;
const pad = (n) => String(n).padStart(2, '0');
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const when = (iso) => {
  const d = new Date(iso);
  return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${(d.getFullYear() + 543) % 100} · ${pad(d.getHours())}:${pad(d.getMinutes())} น.`;
};
// LINE rejects empty text, so every text goes through here.
const t = (text, o = {}) => ({ type: 'text', text: String(text ?? '') || '-', wrap: true, size: 'sm', color: C.ink, ...o });
const row = (left, right, o = {}, ro = {}) => ({
  type: 'box', layout: 'horizontal', contents: [t(left, { flex: 5, ...o }), t(right, { flex: 3, align: 'end', ...o, ...ro })],
});
const sep = (margin = 'md') => ({ type: 'separator', margin, color: '#e9dfd4' });

function header(title, subtitle, color) {
  return {
    type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '14px',
    contents: [
      t(title, { color: '#ffffff', weight: 'bold', size: 'lg' }),
      ...(subtitle ? [t(subtitle, { color: '#ffffffcc', size: 'xs', margin: 'xs' })] : []),
    ],
  };
}

/** New paid bill + today's running totals. */
export function saleFlex(order, today, shopName) {
  const items = order.items.flatMap((l, i) => {
    const opts = [
      l.sweetness != null ? `หวาน ${l.sweetness}%` : '',
      ...l.toppings.map((x) => `+${x.name}${x.price ? ` ${baht(x.price)}` : ''}`),
      ...l.discounts.map((d) => `${d.name} −${baht(d.amount)}`),
    ].filter(Boolean).join(' · ');
    return [
      row(`${l.qty} × ${l.name}`, baht(l.total), { weight: 'bold' }),
      ...(opts ? [t(opts, { size: 'xs', color: C.muted })] : []),
      ...(l.note ? [t(`หมายเหตุ: ${l.note}`, { size: 'xs', color: C.amber })] : []),
    ].map((c, j) => (i > 0 && j === 0 ? { ...c, margin: 'md' } : c));
  });
  const paidBy = order.paymentMethod === 'cash'
    ? `เงินสด (รับ ${baht(order.cashReceived)} · ทอน ${baht(order.change)})`
    : 'เงินโอน';
  const meta = [
    row('ขายโดย', order.staffName, { color: C.muted }, { color: C.ink }),
    ...(order.customerName && order.customerName !== 'ลูกค้าทั่วไป' ? [row('ลูกค้า', order.customerName, { color: C.muted }, { color: C.ink })] : []),
    ...(order.queueNo ? [row('คิว', `#${order.queueNo}`, { color: C.muted }, { color: C.ink })] : []),
  ];
  return {
    type: 'flex',
    altText: `ขายแล้ว ${baht(order.total)} · บิล ${order.orderNo} · วันนี้ ${baht(today.sales)}`,
    contents: {
      type: 'bubble', size: 'mega',
      header: header(`🧾 ขายแล้ว ${baht(order.total)}`, `${shopName || 'MA Coffee'} · บิล ${order.orderNo} · ${when(order.createdAt)}`, C.brown),
      body: {
        type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '14px',
        contents: [
          ...meta,
          sep(),
          { type: 'box', layout: 'vertical', spacing: 'xs', margin: 'md', contents: items },
          sep(),
          row(`รวม (${order.cups} แก้ว)`, baht(order.gross), { margin: 'md' }),
          ...(order.discountTotal > 0 ? [row('ส่วนลด', `−${baht(order.discountTotal)}`, { color: C.green })] : []),
          row('ยอดสุทธิ', baht(order.total), { weight: 'bold', size: 'md' }),
          t(`ชำระโดย ${paidBy}`, { size: 'xs', color: C.muted, margin: 'sm' }),
          ...(order.loyalty ? [t(`สะสมแต้ม ${order.loyalty.used ? `แลก ${order.loyalty.redeemedCups} แก้ว (−${order.loyalty.used}) · ` : ''}+${order.loyalty.earned} · คงเหลือ ${order.loyalty.balance} แต้ม`, { size: 'xs', color: C.brown })] : []),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', backgroundColor: C.bg, paddingAll: '14px', spacing: 'xs',
        contents: [
          row('ยอดขายวันนี้', baht(today.sales), { weight: 'bold' }, { color: C.brown, size: 'md' }),
          t(`${today.orders} บิล · ${today.cups} แก้ว · เงินสด ${baht(today.cash)} · โอน ${baht(today.transfer)}`, { size: 'xs', color: C.muted }),
        ],
      },
    },
  };
}

export function voidFlex(order, today) {
  return {
    type: 'flex',
    altText: `⚠️ ยกเลิกบิล ${order.orderNo} ${baht(order.total)} โดย ${order.voidedBy}`,
    contents: {
      type: 'bubble',
      header: header(`⚠️ ยกเลิกบิล ${order.orderNo}`, when(order.voidedAt), C.red),
      body: {
        type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '14px',
        contents: [
          row('ยอดบิล', baht(order.total), { weight: 'bold' }),
          row('ยกเลิกโดย', order.voidedBy),
          row('ขายโดย', order.staffName),
          t(`เหตุผล: ${order.voidReason || 'ไม่ระบุ'}`, { size: 'xs', color: C.muted, margin: 'sm' }),
          sep(),
          row('ยอดขายวันนี้ (หลังหัก)', baht(today.sales), { margin: 'md', color: C.muted }),
        ],
      },
    },
  };
}

export function lowStockFlex(items, title = '📦 วัตถุดิบใกล้หมด') {
  return {
    type: 'flex',
    altText: `${title}: ${items.map((i) => i.name).join(', ')}`,
    contents: {
      type: 'bubble',
      header: header(title, `${items.length} รายการ · ควรสั่งเพิ่ม`, C.amber),
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: items.slice(0, 20).map((i) => row(i.name, `${nf.format(i.quantity)} ${i.unit}`, {}, { color: i.quantity <= 0 ? C.red : C.amber, weight: 'bold' })),
      },
    },
  };
}

export function summaryFlex(r, shopName) {
  const x = r.totals;
  return {
    type: 'flex',
    altText: `สรุปยอดวันนี้ ${baht(x.sales)} · ${x.orders} บิล`,
    contents: {
      type: 'bubble',
      header: header(`📊 สรุปยอดวันนี้ ${baht(x.sales)}`, `${shopName || 'MA Coffee'} · ${when(new Date().toISOString())}`, C.brown),
      body: {
        type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '14px',
        contents: [
          row('จำนวนบิล / แก้ว', `${x.orders} / ${x.cups}`),
          row('เงินสด', baht(x.cash)),
          row('เงินโอน', baht(x.transfer)),
          row('ส่วนลด', `−${baht(x.discount)}`, { color: C.green }),
          sep(),
          row('ยอดขายสุทธิ', baht(x.sales), { weight: 'bold', margin: 'md' }),
          row('ต้นทุน', baht(x.cost), { color: C.muted }),
          row('กำไรขั้นต้น', baht(x.grossProfit), { weight: 'bold' }, { color: x.grossProfit >= 0 ? C.green : C.red }),
          ...(r.topItems.length ? [sep(), t('ขายดี', { size: 'xs', color: C.muted, margin: 'md' }),
            ...r.topItems.slice(0, 3).map((i, n) => row(`${n + 1}. ${i.name}`, `${i.qty} แก้ว`, { size: 'xs' }))] : []),
          ...(x.voidCount ? [t(`ยกเลิก ${x.voidCount} บิล (${baht(x.voidAmount)})`, { size: 'xs', color: C.red, margin: 'md' })] : []),
        ],
      },
    },
  };
}
