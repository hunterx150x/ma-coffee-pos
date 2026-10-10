// Audit log: who did what, when, from which device. Owner-only viewer behind an extra password.
import { getDb, save, uid, now } from './db.js';

/** "iPad · Safari" style label from a user-agent string. */
export function device(ua = '') {
  const os = /iPad/.test(ua) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone'
      : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android' : 'Android แท็บเล็ต')
        : /Macintosh/.test(ua) ? 'Mac / iPad' // iPadOS Safari reports itself as a Mac
          : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Line\//.test(ua) ? 'LINE' : /FBAN|FBAV/.test(ua) ? 'Facebook' : /Edg\//.test(ua) ? 'Edge'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' · ') || (ua ? ua.slice(0, 40) : '-');
}

/**
 * Add one log entry. `req` gives the actor (logged-in user), IP and device unless `actor` is passed.
 * level: info | warn (deletes, voids, restores, failed logins…)
 */
export function audit(req, { category, action, detail = '', result = 'ok', level = 'info', actor } = {}) {
  const db = getDb();
  if (!db.auditLogs) db.auditLogs = [];
  const u = req?.user;
  db.auditLogs.push({
    id: uid(),
    createdAt: now(),
    userId: u?.id || null,
    userName: actor || u?.name || '-',
    role: u?.role || null,
    category,
    action,
    detail: String(detail || '').slice(0, 300),
    result,
    level,
    ip: req?.ip || '',
    device: device(req?.headers?.['user-agent']),
  });
}

// Every successful change made through the API gets a line; handlers can add a detail via res.locals.audit.
const ENTITY = {
  categories: ['เมนู', 'ประเภทเมนู'],
  'menu-items': ['เมนู', 'เมนู'],
  toppings: ['เมนู', 'ท็อปปิ้ง'],
  discounts: ['เมนู', 'ส่วนลด'],
  expenses: ['ค่าใช้จ่าย', 'ค่าใช้จ่าย'],
  capital: ['ค่าใช้จ่าย', 'เงินทุน'],
  ingredients: ['สต๊อก', 'วัตถุดิบ'],
  customers: ['ลูกค้า', 'ลูกค้า'],
  users: ['ผู้ใช้ & สิทธิ์', 'ผู้ใช้'],
  leads: ['ระบบขาย', 'รายชื่อผู้สนใจ'],
};
const ROUTES = {
  'POST /api/auth/change-password': ['บัญชี', 'เปลี่ยนรหัสผ่านตัวเอง'],
  'POST /api/auth/logout': ['เข้าสู่ระบบ', 'ออกจากระบบ'],
  'POST /api/orders': ['การขาย', 'ขาย / ปิดบิล'],
  'POST /api/orders/:id/void': ['การขาย', 'ยกเลิกบิล', 'warn'],
  'POST /api/queues': ['คิว', 'เพิ่มคิว'],
  'POST /api/queues/:id/status': ['คิว', 'เปลี่ยนสถานะคิว'],
  'POST /api/queues/:id/pay': ['คิว', 'ชำระเงินจากคิว'],
  'POST /api/ingredients/:id/adjust': ['สต๊อก', 'ปรับสต๊อก'],
  'POST /api/customers/:id/points': ['ลูกค้า', 'ปรับแต้มสะสม', 'warn'],
  'PUT /api/settings': ['ตั้งค่า', 'แก้ไขตั้งค่าร้าน'],
  'POST /api/restore': ['ตั้งค่า', 'กู้คืนข้อมูลจากไฟล์สำรอง', 'warn'],
  'POST /api/line/test': ['ตั้งค่า', 'ส่งข้อความทดสอบ LINE'],
  'POST /api/line/test-lead': ['ตั้งค่า', 'ส่งตัวอย่างแจ้งเตือนผู้สนใจ'],
  'POST /api/line/summary': ['ตั้งค่า', 'ส่งสรุปยอดเข้า LINE'],
};
function routeLabel(method, path) {
  const fixed = ROUTES[`${method} ${path}`];
  if (fixed) return fixed;
  const m = path.match(/^\/api\/([a-z-]+)(\/:id)?$/);
  const ent = m && ENTITY[m[1]];
  if (ent) {
    const verb = method === 'POST' ? 'เพิ่ม' : method === 'PUT' ? 'แก้ไข' : method === 'DELETE' ? 'ลบ' : method;
    return [ent[0], `${verb}${ent[1]}`, method === 'DELETE' ? 'warn' : 'info'];
  }
  return null;
}

const STATUS_TH = { waiting: 'รอทำ', done: 'ทำแล้ว', paid: 'ชำระแล้ว', cancelled: 'ยกเลิก' };
const bill = (o) => `บิล ${o.orderNo} ฿${o.total} (${o.paymentMethod === 'cash' ? 'เงินสด' : 'โอน'}) · ${o.cups} แก้ว · ${o.customerName}`;
/** Detail text built from what the endpoint returned, for routes that don't set res.locals.audit. */
function autoDetail(key, req, body) {
  if (!body || typeof body !== 'object') return '';
  if (key === 'POST /api/orders/:id/void') return `${bill(body)} · เหตุผล: ${body.voidReason || '-'}`;
  if (body.order && body.queue) return `คิว ${body.queue.queueNo} ${body.queue.name} · ${bill(body.order)}`;
  if (body.orderNo && body.total != null) return bill(body);
  if (body.queueNo != null && body.status) return `คิว ${body.queueNo} ${body.name || ''} → ${STATUS_TH[body.status] || body.status}${body.cancelReason ? ` (${body.cancelReason})` : ''}`;
  if (key === 'POST /api/customers/:id/points') return `${body.name} ${req.body?.points > 0 ? '+' : ''}${req.body?.points} แต้ม (${req.body?.note || '-'}) → คงเหลือ ${body.points}`;
  if (key === 'POST /api/ingredients/:id/adjust') {
    const t = { in: 'รับเข้า', out: 'เบิกออก', set: 'ตรวจนับ' }[req.body?.type] || req.body?.type;
    return `${body.name} ${t} ${req.body?.qty} ${body.unit}${req.body?.totalCost ? ` (ซื้อ ${req.body.totalCost} บาท)` : ''} → คงเหลือ ${body.quantity}`;
  }
  return body.name || body.description || '';
}

export function auditMutations(req, res, next) {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return next();
  const json = res.json.bind(res);
  res.json = (b) => { res.locals.body = b; return json(b); };
  res.on('finish', () => {
    if (res.statusCode >= 400 || res.locals.auditSkip || !req.route) return;
    const key = `${req.method} ${req.baseUrl}${req.route.path}`;
    const label = routeLabel(req.method, `${req.baseUrl}${req.route.path}`);
    if (!label) return;
    const [category, action, level = 'info'] = label;
    audit(req, { category, action, level, detail: res.locals.audit || autoDetail(key, req, res.locals.body) });
    save();
  });
  next();
}

const SCALARS = { name: 'ชื่อ', price: 'ราคา', cost: 'ต้นทุน', costMode: 'วิธีคิดต้นทุน', active: 'ขายหน้าร้าน', activeOutside: 'ขายนอกสถานที่', sort: 'ลำดับ',
  icon: 'ไอคอน', type: 'รูปแบบ', value: 'มูลค่า', maxValue: 'สูงสุด', unit: 'หน่วย', costPerUnit: 'ต้นทุน/หน่วย', minQty: 'ขั้นต่ำ',
  amount: 'จำนวนเงิน', category: 'หมวด', description: 'รายละเอียด', date: 'วันที่', phone: 'เบอร์', lineId: 'LINE', note: 'หมายเหตุ',
  source: 'ผู้ลงทุน', categoryId: 'ประเภท', role: 'บทบาท', username: 'ชื่อผู้ใช้' };
// Key-order-insensitive JSON, so a re-saved recipe {qty, ingredientId} vs {ingredientId, qty} isn't a "change".
const stable = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const same = (a, b) => stable(a) === stable(b);
const fmt = (v) => (v === true ? 'เปิด' : v === false ? 'ปิด' : v === '' || v == null ? '-' : String(v));

/** "ราคา 40→45, ขายนอกสถานที่ เปิด→ปิด, แก้สูตร" */
export function describeChanges(before, after) {
  const out = [];
  for (const [k, label] of Object.entries(SCALARS)) {
    if (!(k in after) && !(k in before)) continue;
    if (!same(before[k], after[k]) && (k in after)) out.push(`${label} ${fmt(before[k])}→${fmt(after[k])}`);
  }
  if (!same(before.recipe || [], after.recipe || [])) out.push('แก้สูตร/ส่วนผสม');
  if (!same(before.steps || [], after.steps || [])) out.push('แก้วิธีทำ');
  if ((before.image || '') !== (after.image || '')) out.push(after.image ? 'เปลี่ยนรูป' : 'ลบรูป');
  if (!same(before.permissions || [], after.permissions || []) && after.permissions) out.push(`สิทธิ์: ${(after.permissions || []).join(', ') || '-'}`);
  return out.join(', ');
}
