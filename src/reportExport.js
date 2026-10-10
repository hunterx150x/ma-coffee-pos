// CSV exports for the Reports page, built from the raw bills of the selected range.
// 1) summaryRows: analysis sections for planning promotions (menu × discount, hours, weekdays, toppings, customers…)
// 2) detailRows: one row per sold line, for pivot tables in Excel / Google Sheets.
import { round2 } from '../shared/pricing.js';

const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun
const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const pct = (a, b) => (b ? round2((a / b) * 100) : 0);
const r2 = (n) => round2(n || 0);
const LOYALTY = 'loyalty';

const channel = (o) => (o.queueId ? (o.source === 'customer' ? 'QR ลูกค้าสั่งเอง' : 'คิว') : 'หน้าร้าน');
const isGuest = (o) => !o.customerId && (!o.customerName || o.customerName === 'ลูกค้าทั่วไป');

function bump(map, key, init) {
  if (!map.has(key)) map.set(key, init());
  return map.get(key);
}

/** Days in range (up to today) per weekday, so weekday averages are fair. */
function weekdayCounts(from, to) {
  const counts = Array(7).fill(0);
  const d = new Date(`${from}T00:00:00`);
  const todayStr = dateStr(new Date());
  const end = new Date(`${to < todayStr ? to : todayStr}T00:00:00`); // future days have no sales yet
  while (d <= end) {
    counts[d.getDay()] += 1;
    d.setDate(d.getDate() + 1);
  }
  return counts;
}

export function summaryRows(report, orders, shopName) {
  const t = report.totals;
  const paid = orders.filter((o) => o.status === 'paid');
  const voided = orders.filter((o) => o.status === 'void');
  const lines = paid.flatMap((o) => o.items.map((l) => ({ o, l })));
  const totalCups = lines.reduce((s, x) => s + x.l.qty, 0);
  const rows = [];
  const section = (title, note) => {
    if (rows.length) rows.push([]);
    rows.push([`■ ${title}`]);
    if (note) rows.push([note]);
  };

  // ---- overview
  rows.push([`รายงานยอดขายละเอียด — ${shopName || ''}`]);
  rows.push(['ช่วงวันที่', `${report.range.from} ถึง ${report.range.to}`, 'สร้างเมื่อ', `${dateStr(new Date())} ${timeStr(new Date())}`]);
  section('สรุปภาพรวม');
  rows.push(['รายการ', 'ค่า']);
  [
    ['จำนวนบิล (ชำระแล้ว)', t.orders],
    ['จำนวนแก้ว', t.cups],
    ['ยอดขายก่อนส่วนลด', t.gross],
    ['ส่วนลดรวม', t.discount],
    ['% ส่วนลดต่อยอดขาย', pct(t.discount, t.gross)],
    ['ยอดขายสุทธิ', t.sales],
    ['เงินสด', t.cash],
    ['เงินโอน', t.transfer],
    ['ต้นทุนวัตถุดิบ', t.cost],
    ['กำไรขั้นต้น', t.grossProfit],
    ['% กำไรขั้นต้น', t.grossMargin],
    ['ค่าใช้จ่ายดำเนินงาน', t.expenses],
    ['ซื้อวัตถุดิบ (ไม่หักในกำไร เพราะคิดเป็นต้นทุนสินค้าแล้ว)', t.ingredientPurchases || 0],
    ['กำไร(ขาดทุน)สุทธิ', t.netProfit],
    ['เงินทุนเพิ่มเข้า (ไม่นับเป็นกำไร)', t.capitalIn || 0],
    ['ยอดเฉลี่ยต่อบิล', t.avgPerOrder],
    ['แก้วเฉลี่ยต่อบิล', t.orders ? r2(t.cups / t.orders) : 0],
    ['บิลลูกค้าใหม่', t.newCustomers],
    ['บิลลูกค้าเก่า', t.returningCustomers],
    ['บิลที่ยกเลิก', `${t.voidCount} บิล (${t.voidAmount} บาท)`],
  ].forEach((x) => rows.push(x));

  // ---- by channel / payment
  section('ยอดตามช่องทางการขาย และวิธีชำระ');
  rows.push(['ช่องทาง', 'บิล', 'แก้ว', 'ยอดขายสุทธิ', '% ของยอดขาย']);
  const byChannel = new Map();
  for (const o of paid) {
    const c = bump(byChannel, channel(o), () => ({ bills: 0, cups: 0, sales: 0 }));
    c.bills += 1; c.cups += o.cups; c.sales += o.total;
  }
  for (const [k, v] of byChannel) rows.push([k, v.bills, v.cups, r2(v.sales), pct(v.sales, t.sales)]);
  rows.push(['วิธีชำระ', 'บิล', '', 'ยอดขายสุทธิ', '% ของยอดขาย']);
  rows.push(['เงินสด', t.cashCount, '', t.cash, pct(t.cash, t.sales)]);
  rows.push(['เงินโอน', t.transferCount, '', t.transfer, pct(t.transfer, t.sales)]);

  // ---- daily
  section('สรุปรายวัน');
  rows.push(['วันที่', 'วัน', 'บิล', 'แก้ว', 'ยอดขาย', 'เงินสด', 'เงินโอน', 'ต้นทุน', 'กำไรขั้นต้น', 'ค่าใช้จ่าย', 'กำไรสุทธิ']);
  for (const d of report.daily) {
    rows.push([d.date, WEEKDAYS[new Date(`${d.date}T00:00:00`).getDay()], d.orders, d.cups, d.sales, d.cash, d.transfer, d.cost, d.grossProfit, d.expenses, d.netProfit]);
  }
  rows.push(['รวม', '', t.orders, t.cups, t.sales, t.cash, t.transfer, t.cost, t.grossProfit, t.expenses, t.netProfit]);

  // ---- weekday
  section('ยอดตามวันในสัปดาห์', 'ใช้หาวันที่ขายเงียบ เพื่อจัดโปรวันธรรมดา');
  const wdDays = weekdayCounts(report.range.from, report.range.to);
  const wd = Array.from({ length: 7 }, () => ({ bills: 0, cups: 0, sales: 0 }));
  for (const o of paid) {
    const x = wd[new Date(o.createdAt).getDay()];
    x.bills += 1; x.cups += o.cups; x.sales += o.total;
  }
  rows.push(['วัน', 'จำนวนวันในช่วง', 'บิล', 'แก้ว', 'ยอดขาย', 'ยอดขายเฉลี่ยต่อวัน', 'แก้วเฉลี่ยต่อวัน']);
  for (const i of WEEK_ORDER) {
    const x = wd[i];
    rows.push([WEEKDAYS[i], wdDays[i], x.bills, x.cups, r2(x.sales), wdDays[i] ? r2(x.sales / wdDays[i]) : 0, wdDays[i] ? r2(x.cups / wdDays[i]) : 0]);
  }

  // ---- hours
  section('ยอดตามช่วงเวลา (รายชั่วโมง)', 'ใช้หาช่วงเวลาที่ขายเงียบ เพื่อจัด Happy Hour');
  rows.push(['ช่วงเวลา', 'บิล', 'แก้ว', 'ยอดขาย', '% ของยอดขาย', 'เมนูขายดีช่วงนี้']);
  const hours = Array.from({ length: 24 }, () => ({ bills: 0, cups: 0, sales: 0, menus: new Map() }));
  for (const { o, l } of lines) {
    const hr = hours[new Date(o.createdAt).getHours()];
    hr.cups += l.qty;
    hr.menus.set(l.name, (hr.menus.get(l.name) || 0) + l.qty);
  }
  for (const o of paid) {
    const hr = hours[new Date(o.createdAt).getHours()];
    hr.bills += 1; hr.sales += o.total;
  }
  hours.forEach((x, h) => {
    if (!x.bills) return;
    const top = [...x.menus.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, q]) => `${n} (${q})`).join(' / ');
    rows.push([`${pad(h)}:00-${pad(h)}:59`, x.bills, x.cups, r2(x.sales), pct(x.sales, t.sales), top]);
  });

  // ---- menu performance
  const menus = new Map();
  for (const { o, l } of lines) {
    const m = bump(menus, l.menuItemId || l.name, () => ({
      name: l.name, category: l.categoryName, cups: 0, bills: new Set(), gross: 0, discount: 0, net: 0, cost: 0,
      cupsDiscounted: 0, cupsRedeemed: 0, sweet: new Map(), tops: new Map(), discs: new Map(), newCust: 0, oldCust: 0,
    }));
    m.cups += l.qty;
    m.bills.add(o.id);
    m.gross += l.gross; m.discount += l.discountTotal; m.net += l.total; m.cost += l.cost;
    if (l.discountTotal > 0) m.cupsDiscounted += l.qty;
    m.cupsRedeemed += l.rewardQty || 0;
    if (l.sweetness != null) m.sweet.set(l.sweetness, (m.sweet.get(l.sweetness) || 0) + l.qty);
    for (const tp of l.toppings) m.tops.set(tp.name, (m.tops.get(tp.name) || 0) + l.qty);
    for (const d of l.discounts) {
      const x = bump(m.discs, d.id || d.name, () => ({ name: d.name, type: d.type, times: 0, cups: 0, amount: 0 }));
      x.times += 1;
      x.cups += d.id === LOYALTY ? (l.rewardQty || 0) : d.type === 'free' ? 1 : l.qty;
      x.amount += d.amount;
    }
    if (o.customerType === 'old') m.oldCust += l.qty; else m.newCust += l.qty;
  }
  const menuList = [...menus.values()].sort((a, b) => b.cups - a.cups || b.net - a.net);
  const topOf = (map, n = 1) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} (${v})`).join(' / ');

  section('ผลงานรายเมนู', 'เมนูขายดี/ขายไม่ดี กำไรต่อแก้ว และการพึ่งพาส่วนลด');
  rows.push(['อันดับ', 'เมนู', 'ประเภท', 'แก้ว', '% ของแก้วทั้งหมด', 'จำนวนบิล', 'ยอดก่อนลด', 'ส่วนลด', '% ส่วนลด', 'ยอดสุทธิ', '% ของยอดขาย',
    'ต้นทุน', 'กำไร', '% กำไร', 'ราคาขายเฉลี่ย/แก้ว', 'กำไรเฉลี่ย/แก้ว', 'แก้วที่ได้ส่วนลด', 'แก้วที่แลกแต้ม', 'แก้ว-ลูกค้าเก่า', 'แก้ว-ลูกค้าใหม่/ทั่วไป',
    'ความหวานยอดนิยม', 'ท็อปปิ้งยอดนิยม']);
  menuList.forEach((m, i) => rows.push([
    i + 1, m.name, m.category, m.cups, pct(m.cups, totalCups), m.bills.size, r2(m.gross), r2(m.discount), pct(m.discount, m.gross), r2(m.net), pct(m.net, t.sales),
    r2(m.cost), r2(m.net - m.cost), pct(m.net - m.cost, m.net), m.cups ? r2(m.net / m.cups) : 0, m.cups ? r2((m.net - m.cost) / m.cups) : 0,
    m.cupsDiscounted, m.cupsRedeemed, m.oldCust, m.newCust,
    topOf(new Map([...m.sweet].map(([k, v]) => [`${k}%`, v]))), topOf(m.tops, 2),
  ]));

  // ---- menu × discount
  section('เมนู × ส่วนลด', 'แต่ละเมนูใช้ส่วนลดอะไร กี่ครั้ง มูลค่าเท่าไหร่');
  rows.push(['เมนู', 'ส่วนลด', 'ประเภทส่วนลด', 'ใช้ (ครั้ง)', 'แก้วที่ได้ส่วนลด', '% ของแก้วเมนูนี้', 'มูลค่าส่วนลด', 'ส่วนลดเฉลี่ย/แก้ว', '% ของยอดก่อนลดเมนูนี้']);
  const typeLabel = { amount: 'ลดเป็นบาท', percent: 'ลดเป็น %', free: 'ฟรี 1 แก้ว', loyalty: 'แลกแต้มสะสม' };
  for (const m of menuList) {
    for (const d of [...m.discs.values()].sort((a, b) => b.amount - a.amount)) {
      rows.push([m.name, d.name, typeLabel[d.type] || d.type, d.times, d.cups, pct(d.cups, m.cups), r2(d.amount), d.cups ? r2(d.amount / d.cups) : 0, pct(d.amount, m.gross)]);
    }
    if (!m.discs.size) rows.push([m.name, '(ไม่มีการใช้ส่วนลด)', '', 0, 0, 0, 0, 0, 0]);
  }

  // ---- discounts summary
  section('สรุปส่วนลด / โปรโมชั่น', 'ส่วนลดไหนคนใช้เยอะ คุ้มไหม และใช้กับเมนูอะไร');
  const discs = new Map();
  for (const { o, l } of lines) {
    for (const d of l.discounts) {
      const x = bump(discs, d.id || d.name, () => ({ name: d.name, type: d.type, bills: new Set(), times: 0, cups: 0, amount: 0, sales: 0, menus: new Map() }));
      x.bills.add(o.id);
      x.times += 1;
      const cups = d.id === LOYALTY ? (l.rewardQty || 0) : d.type === 'free' ? 1 : l.qty;
      x.cups += cups;
      x.amount += d.amount;
      x.sales += l.total;
      x.menus.set(l.name, (x.menus.get(l.name) || 0) + cups);
    }
  }
  rows.push(['ส่วนลด', 'ประเภท', 'บิลที่ใช้', '% ของบิลทั้งหมด', 'ใช้ (ครั้ง)', 'แก้ว', 'มูลค่าส่วนลดรวม', 'เฉลี่ย/บิล', 'ยอดขายสุทธิของรายการที่ใช้', '% ของส่วนลดทั้งหมด', 'เมนูที่ใช้บ่อย']);
  for (const x of [...discs.values()].sort((a, b) => b.amount - a.amount)) {
    rows.push([x.name, typeLabel[x.type] || x.type, x.bills.size, pct(x.bills.size, t.orders), x.times, x.cups, r2(x.amount),
      x.bills.size ? r2(x.amount / x.bills.size) : 0, r2(x.sales), pct(x.amount, t.discount), topOf(x.menus, 3)]);
  }
  const billsNoDisc = paid.filter((o) => !o.discountTotal).length;
  rows.push(['(บิลที่ไม่มีส่วนลด)', '', billsNoDisc, pct(billsNoDisc, t.orders)]);

  // ---- toppings × menu
  section('ท็อปปิ้ง', 'ท็อปปิ้งขายดี และขายคู่กับเมนูไหน (ใช้ทำโปรจับคู่ / อัปเซล)');
  const tops = new Map();
  for (const { l } of lines) {
    for (const tp of l.toppings) {
      const x = bump(tops, tp.name, () => ({ cups: 0, revenue: 0, cost: 0, menus: new Map() }));
      x.cups += l.qty; x.revenue += tp.price * l.qty; x.cost += (tp.cost || 0) * l.qty;
      x.menus.set(l.name, (x.menus.get(l.name) || 0) + l.qty);
    }
  }
  rows.push(['ท็อปปิ้ง', 'แก้ว', '% ของแก้วทั้งหมด', 'รายได้', 'ต้นทุน', 'กำไร', 'เมนูที่ใส่บ่อย']);
  for (const [name, x] of [...tops.entries()].sort((a, b) => b[1].cups - a[1].cups)) {
    rows.push([name, x.cups, pct(x.cups, totalCups), r2(x.revenue), r2(x.cost), r2(x.revenue - x.cost), topOf(x.menus, 3)]);
  }
  rows.push([]);
  rows.push(['เมนู', 'ท็อปปิ้ง', 'แก้วที่ใส่', '% ของแก้วเมนูนี้ (attach rate)']);
  for (const m of menuList) for (const [tp, q] of [...m.tops.entries()].sort((a, b) => b[1] - a[1])) rows.push([m.name, tp, q, pct(q, m.cups)]);

  // ---- sweetness × menu
  const levels = [...new Set(lines.map((x) => x.l.sweetness).filter((s) => s != null))].sort((a, b) => a - b);
  if (levels.length) {
    section('ความหวานรายเมนู (จำนวนแก้ว)');
    rows.push(['เมนู', ...levels.map((lv) => `หวาน ${lv}%`), 'รวม']);
    for (const m of menuList) rows.push([m.name, ...levels.map((lv) => m.sweet.get(lv) || 0), m.cups]);
  }

  // ---- customers
  section('ลูกค้าที่ระบุชื่อ', 'ลูกค้าประจำ ยอดซื้อ และส่วนลดที่ใช้ (ใช้ทำโปรเฉพาะกลุ่ม / แจกคูปอง)');
  const customers = new Map();
  for (const o of paid) {
    if (isGuest(o)) continue;
    const c = bump(customers, o.customerId || o.customerName, () => ({
      name: o.customerName, member: Boolean(o.customerId), bills: 0, cups: 0, spend: 0, discount: 0, first: o.createdAt, last: o.createdAt,
      menus: new Map(), stamps: null, redeemed: 0,
    }));
    c.bills += 1; c.cups += o.cups; c.spend += o.total; c.discount += o.discountTotal;
    if (o.createdAt < c.first) c.first = o.createdAt;
    if (o.createdAt > c.last) { c.last = o.createdAt; if (o.loyalty) c.stamps = o.loyalty.balance; }
    if (o.loyalty) c.redeemed += o.loyalty.redeemedCups || 0;
    for (const l of o.items) c.menus.set(l.name, (c.menus.get(l.name) || 0) + l.qty);
  }
  rows.push(['ลูกค้า', 'สมาชิก', 'บิล', 'แก้ว', 'ยอดซื้อสุทธิ', 'เฉลี่ย/บิล', 'ส่วนลดที่ได้', 'แลกแต้ม (แก้ว)', 'แต้มคงเหลือล่าสุด', 'มาครั้งแรกในช่วง', 'มาล่าสุด', 'เมนูโปรด']);
  for (const c of [...customers.values()].sort((a, b) => b.spend - a.spend)) {
    rows.push([c.name, c.member ? 'ใช่' : 'ไม่', c.bills, c.cups, r2(c.spend), r2(c.spend / c.bills), r2(c.discount), c.redeemed,
      c.stamps ?? '', dateStr(new Date(c.first)), dateStr(new Date(c.last)), topOf(c.menus, 2)]);
  }
  const guestBills = paid.filter(isGuest);
  rows.push(['(ลูกค้าทั่วไป ไม่ระบุชื่อ)', '', guestBills.length, guestBills.reduce((s, o) => s + o.cups, 0), r2(guestBills.reduce((s, o) => s + o.total, 0))]);

  // ---- loyalty
  const earned = paid.reduce((s, o) => s + (o.loyalty?.earned || 0), 0);
  const used = paid.reduce((s, o) => s + (o.loyalty?.used || 0), 0);
  const redeemedCups = paid.reduce((s, o) => s + (o.loyalty?.redeemedCups || 0), 0);
  const loyaltyValue = lines.reduce((s, x) => s + x.l.discounts.filter((d) => d.id === LOYALTY).reduce((a, d) => a + d.amount, 0), 0);
  section('สะสมแต้ม');
  rows.push(['แต้มที่แจก', earned]);
  rows.push(['แต้มที่ใช้แลก', used]);
  rows.push(['แก้วที่แลกฟรี', redeemedCups]);
  rows.push(['มูลค่าส่วนลดจากการแลกแต้ม', r2(loyaltyValue)]);
  rows.push(['บิลของสมาชิก', paid.filter((o) => o.loyalty).length, '% ของบิลทั้งหมด', pct(paid.filter((o) => o.loyalty).length, t.orders)]);

  // ---- staff
  section('ยอดขายตามพนักงาน');
  rows.push(['พนักงาน', 'บิล', 'แก้ว', 'ยอดขายสุทธิ', 'ส่วนลดที่ให้']);
  const staff = new Map();
  for (const o of paid) {
    const s = bump(staff, o.staffName || '-', () => ({ bills: 0, cups: 0, sales: 0, discount: 0 }));
    s.bills += 1; s.cups += o.cups; s.sales += o.total; s.discount += o.discountTotal;
  }
  for (const [k, s] of [...staff.entries()].sort((a, b) => b[1].sales - a[1].sales)) rows.push([k, s.bills, s.cups, r2(s.sales), r2(s.discount)]);

  // ---- voids
  if (voided.length) {
    section('บิลที่ยกเลิก');
    rows.push(['วันที่', 'เวลา', 'เลขบิล', 'ยอด', 'ขายโดย', 'ยกเลิกโดย', 'เหตุผล', 'รายการ']);
    for (const o of voided) {
      const d = new Date(o.createdAt);
      rows.push([dateStr(d), timeStr(d), o.orderNo, o.total, o.staffName, o.voidedBy || '', o.voidReason || '', o.items.map((l) => `${l.qty}×${l.name}`).join(', ')]);
    }
  }
  return rows;
}

/** One row per sold line (cup group) — raw data for pivot tables. Includes voided bills, marked in the status column. */
export function detailRows(orders) {
  const rows = [[
    'วันที่', 'เวลา', 'วัน', 'ชั่วโมง', 'เลขบิล', 'สถานะบิล', 'ช่องทาง', 'วิธีชำระ', 'ลูกค้า', 'ประเภทลูกค้า', 'สมาชิก', 'พนักงาน',
    'เมนู', 'ประเภทเมนู', 'จำนวนแก้ว', 'ราคาเมนู/แก้ว', 'ท็อปปิ้ง', 'ราคารวมท็อปปิ้ง/แก้ว', 'ราคาขาย/แก้ว', 'ความหวาน',
    'ยอดก่อนลด', 'ส่วนลดที่ใช้', 'มูลค่าส่วนลด', 'ยอดสุทธิ', 'ต้นทุน', 'กำไร', 'แลกแต้ม (แก้ว)', 'หมายเหตุ', 'คิวที่',
  ]];
  for (const o of [...orders].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
    const d = new Date(o.createdAt);
    for (const l of o.items) {
      rows.push([
        dateStr(d), timeStr(d), WEEKDAYS[d.getDay()], d.getHours(), o.orderNo, o.status === 'void' ? 'ยกเลิก' : 'ชำระแล้ว', channel(o),
        o.paymentMethod === 'cash' ? 'เงินสด' : 'เงินโอน', o.customerName, o.customerType === 'old' ? 'ลูกค้าเก่า' : 'ลูกค้าใหม่/ทั่วไป', o.customerId ? 'ใช่' : 'ไม่',
        o.staffName, l.name, l.categoryName, l.qty, l.price, l.toppings.map((x) => x.name).join(' + '), r2(l.toppings.reduce((s, x) => s + x.price, 0)),
        l.unitPrice, l.sweetness != null ? `${l.sweetness}%` : '', l.gross, l.discounts.map((x) => `${x.name} (${x.amount})`).join(' + '), l.discountTotal,
        l.total, l.cost, r2(l.total - l.cost), l.rewardQty || 0, l.note || '', o.queueNo || '',
      ]);
    }
  }
  return rows;
}
