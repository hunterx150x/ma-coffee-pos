// Printable sales sheet modelled on the shop's paper form: menus × (hot / iced / blended),
// topping counts, discounts, amount, plus a cash / transfer / expenses summary and a list of free / discounted cups.
import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { baht, downloadCsv, num, thDate, toDateStr } from '../utils.js';
import { Empty, ErrorBox, Icon, Loading, Toggle, useAsync } from '../components/ui.jsx';

const VARIANTS = [
  { key: 'hot', label: 'ร้อน', re: /\s*ร้อน$/ },
  { key: 'iced', label: 'เย็น', re: /\s*เย็น$/ },
  { key: 'blend', label: 'ปั่น', re: /\s*ปั่น$/ },
];
const PLAIN = { key: 'plain', label: 'ปกติ' };
const TOP_TOPPING_COLUMNS = 3;

/** "ชาไทย เย็น" → { base: "ชาไทย", variant: "iced" }. Smoothie categories without a suffix count as blended. */
function splitName(name, categoryName) {
  for (const v of VARIANTS) if (v.re.test(name)) return { base: name.replace(v.re, '').trim(), variant: v.key };
  if (/smoothie|ปั่น|frappe/i.test(categoryName || '')) return { base: name, variant: 'blend' };
  return { base: name, variant: PLAIN.key };
}

const mode = (map) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

function buildSheet(orders, catalog, expenses, { showAll }) {
  const paid = orders.filter((o) => o.status === 'paid');
  const lines = paid.flatMap((o) => o.items.map((l) => ({ o, l })));

  // topping columns = most used paid toppings
  const topUse = new Map();
  for (const { l } of lines) for (const t of l.toppings) if (t.price > 0) topUse.set(t.name, (topUse.get(t.name) || 0) + l.qty);
  const topCols = [...topUse.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_TOPPING_COLUMNS).map(([n]) => n);
  const hasOtherTops = [...topUse.keys()].some((n) => !topCols.includes(n));

  // Bills keep the names from the day they were sold; group by today's menu / category names so renames don't split rows.
  const itemById = new Map((catalog?.menuItems || []).map((m) => [m.id, m]));
  const catById = new Map((catalog?.categories || []).map((c) => [c.id, c]));
  const currentNames = (l) => {
    const m = itemById.get(l.menuItemId);
    const c = catById.get(m?.categoryId || l.categoryId);
    return { name: m?.name || l.name, cat: c?.name || l.categoryName || 'อื่นๆ' };
  };
  const sections = new Map(); // category -> Map(base -> row)
  const catOrder = new Map((catalog?.categories || []).map((c, i) => [c.name, c.sort ?? i]));
  const rowFor = (cat, base) => {
    if (!sections.has(cat)) sections.set(cat, new Map());
    const s = sections.get(cat);
    if (!s.has(base)) s.set(base, { base, v: {}, tops: {}, otherTops: 0, cups: 0, discount: 0, amount: 0 });
    return s.get(base);
  };
  const usedVariants = new Set();
  if (showAll && catalog) {
    for (const m of catalog.menuItems.filter((x) => x.active)) {
      const cat = catalog.categories.find((c) => c.id === m.categoryId);
      if (!cat?.active) continue;
      const { base, variant } = splitName(m.name, cat.name);
      const r = rowFor(cat.name, base);
      r.v[variant] = r.v[variant] || { qty: 0, prices: new Map() };
      r.v[variant].prices.set(m.price, (r.v[variant].prices.get(m.price) || 0) + 0.5); // listed price, outweighed by real sales
      usedVariants.add(variant);
    }
  }
  for (const { l } of lines) {
    const cur = currentNames(l);
    const { base, variant } = splitName(cur.name, cur.cat);
    const r = rowFor(cur.cat, base);
    r.v[variant] = r.v[variant] || { qty: 0, prices: new Map() };
    r.v[variant].qty += l.qty;
    r.v[variant].prices.set(l.price, (r.v[variant].prices.get(l.price) || 0) + l.qty);
    usedVariants.add(variant);
    for (const t of l.toppings) {
      if (topCols.includes(t.name)) r.tops[t.name] = (r.tops[t.name] || 0) + l.qty;
      else if (t.price > 0) r.otherTops += l.qty;
    }
    r.cups += l.qty;
    r.discount += l.discountTotal;
    r.amount += l.total;
  }
  const variants = [...VARIANTS, PLAIN].filter((v) => usedVariants.has(v.key));
  const sectionList = [...sections.entries()]
    .sort((a, b) => (catOrder.get(a[0]) ?? 99) - (catOrder.get(b[0]) ?? 99))
    .map(([name, rows]) => {
      const list = [...rows.values()].sort((a, b) => b.cups - a.cups || a.base.localeCompare(b.base, 'th'));
      return {
        name,
        rows: list,
        cups: list.reduce((s, r) => s + r.cups, 0),
        discount: list.reduce((s, r) => s + r.discount, 0),
        amount: list.reduce((s, r) => s + r.amount, 0),
      };
    });

  // discounts by type (e.g. "Flash", staff, bring-your-own-cup, stamps)
  const discounts = new Map();
  for (const { l } of lines) for (const d of l.discounts) discounts.set(d.name, (discounts.get(d.name) || 0) + d.amount);
  // who got discounted / free cups (the handwritten notes on the paper form)
  const freebies = new Map();
  for (const { o, l } of lines) {
    if (!l.discountTotal) continue;
    const key = `${o.customerName}|${l.name}|${l.discounts.map((d) => d.name).join('+')}`;
    const x = freebies.get(key) || { customer: o.customerName, menu: l.name, discount: l.discounts.map((d) => d.name).join(' + '), qty: 0, amount: 0, free: 0 };
    x.qty += l.qty;
    x.amount += l.discountTotal;
    if (l.total === 0) x.free += l.qty;
    freebies.set(key, x);
  }
  const expByCat = new Map();
  for (const e of expenses) expByCat.set(e.category || 'อื่นๆ', (expByCat.get(e.category || 'อื่นๆ') || 0) + e.amount);

  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const cash = sum(paid.filter((o) => o.paymentMethod === 'cash'), (o) => o.total);
  const transfer = sum(paid.filter((o) => o.paymentMethod === 'transfer'), (o) => o.total);
  const expenseTotal = sum(expenses, (e) => e.amount);
  return {
    variants, topCols, hasOtherTops, sections: sectionList,
    totals: { bills: paid.length, cups: sum(lines, (x) => x.l.qty), discount: sum(paid, (o) => o.discountTotal), amount: sum(paid, (o) => o.total) },
    money: { cash, transfer, expenseTotal, cashLeft: cash - expenseTotal, total: cash + transfer, left: cash + transfer - expenseTotal },
    discounts: [...discounts.entries()].sort((a, b) => b[1] - a[1]),
    freebies: [...freebies.values()].sort((a, b) => b.amount - a.amount),
    expenses: [...expByCat.entries()].sort((a, b) => b[1] - a[1]),
  };
}

const dayList = (from, to) => {
  const out = [];
  const d = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (d <= end && out.length < 62) { out.push(toDateStr(d)); d.setDate(d.getDate() + 1); }
  return out;
};
const localDay = (iso) => toDateStr(new Date(iso));
const rangeLabel = (from, to) => (from === to ? thDate(from) : `${thDate(from)} – ${thDate(to)}`);

export default function SalesSheet({ range }) {
  const [showAll, setShowAll] = useState(false);
  const [perDay, setPerDay] = useState(false);
  const data = useAsync(async () => {
    const [orders, catalog, settings, expenses] = await Promise.all([
      api('/orders', { query: range }),
      api('/catalog'),
      api('/settings'),
      api('/expenses-range', { query: range }).catch(() => null), // staff without the expenses menu
    ]);
    return { orders, catalog, settings, expenses };
  }, [range.from, range.to]);

  const pages = useMemo(() => {
    if (!data.data) return [];
    const { orders, catalog, expenses } = data.data;
    const exp = expenses || [];
    if (!perDay) return [{ from: range.from, to: range.to, sheet: buildSheet(orders, catalog, exp, { showAll }) }];
    return dayList(range.from, range.to).map((day) => ({
      from: day, to: day,
      sheet: buildSheet(orders.filter((o) => localDay(o.createdAt) === day), catalog, exp.filter((e) => e.date === day), { showAll }),
    })).filter((p) => showAll || p.sheet.totals.bills);
  }, [data.data, perDay, showAll, range.from, range.to]);

  const print = () => {
    const style = document.createElement('style');
    style.textContent = '@page { size: A4 landscape; margin: 8mm; }';
    document.head.appendChild(style);
    document.body.classList.add('printing-sheet');
    setTimeout(() => {
      window.print();
      document.body.classList.remove('printing-sheet');
      style.remove();
    }, 60);
  };

  const exportCsv = () => {
    const rows = [];
    for (const p of pages) {
      const s = p.sheet;
      rows.push([`รายงานยอดขาย ${rangeLabel(p.from, p.to)}`]);
      rows.push(['ลำดับ', 'รายการ', ...s.variants.flatMap((v) => [`${v.label} ราคา`, `${v.label} จำนวน`]), ...s.topCols, ...(s.hasOtherTops ? ['ท็อปปิ้งอื่น'] : []), 'ส่วนลด', 'จำนวนเงิน']);
      for (const sec of s.sections) {
        rows.push([`[${sec.name}]`]);
        sec.rows.forEach((r, i) => rows.push([i + 1, r.base,
          ...s.variants.flatMap((v) => (r.v[v.key] ? [mode(r.v[v.key].prices), r.v[v.key].qty] : ['', ''])),
          ...s.topCols.map((t) => r.tops[t] || ''), ...(s.hasOtherTops ? [r.otherTops || ''] : []), r.discount || '', r.amount]));
        rows.push(['', `รวม ${sec.name}`, ...s.variants.flatMap(() => ['', '']), ...s.topCols.map(() => ''), ...(s.hasOtherTops ? [''] : []), sec.discount, sec.amount]);
      }
      rows.push(['', 'ยอดรวม', `${s.totals.cups} แก้ว`, `${s.totals.bills} บิล`]);
      rows.push(['เงินสด', s.money.cash], ['เงินโอน', s.money.transfer], ['ส่วนลดรวม', s.totals.discount]);
      s.discounts.forEach(([n, a]) => rows.push([`  ${n}`, a]));
      s.expenses.forEach(([n, a]) => rows.push([`ค่าใช้จ่าย: ${n}`, a]));
      rows.push(['คงเหลือ (เงินสด)', s.money.cashLeft], ['คงเหลือ (เงินโอน)', s.money.transfer], ['รวมคงเหลือ', s.money.left], []);
    }
    downloadCsv(`sales-sheet-${range.from}_${range.to}.csv`, rows);
  };

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />;
  const shop = data.data.settings.shopName;

  return (
    <div>
      <div className="card sheet-tools no-print">
        <Toggle checked={showAll} onChange={setShowAll} label="แสดงทุกเมนู (รวมที่ขายไม่ได้) แบบใบฟอร์ม" />
        <Toggle checked={perDay} onChange={setPerDay} label="แยกหน้าละ 1 วัน" />
        <div className="sheet-tools-btns">
          <button className="btn btn-outline" onClick={exportCsv} disabled={!pages.length}><Icon name="download" /> CSV</button>
          <button className="btn btn-primary" onClick={print} disabled={!pages.length}><Icon name="print" /> พิมพ์ (A4 แนวนอน)</button>
        </div>
        {!data.data.expenses && <p className="muted small">บัญชีนี้ไม่มีสิทธิ์เมนูค่าใช้จ่าย จึงไม่แสดงค่าใช้จ่ายในใบสรุป</p>}
      </div>
      {!pages.length ? <Empty icon="reports" title="ไม่มียอดขายในช่วงนี้" /> : (
        <div id="sales-sheet">
          {pages.map((p) => <Sheet key={p.from + p.to} page={p} shop={shop} />)}
        </div>
      )}
    </div>
  );
}

function Sheet({ page, shop }) {
  const s = page.sheet;
  const nVar = s.variants.length;
  const nTop = s.topCols.length + (s.hasOtherTops ? 1 : 0);
  const cols = 2 + nVar * 2 + nTop + 2;
  return (
    <section className="sheet">
      <header className="sheet-head">
        <h2>รายงานยอดขาย {page.from === page.to ? 'รายวัน' : ''} {rangeLabel(page.from, page.to)}</h2>
        <span>{shop} · {s.totals.bills} บิล · {s.totals.cups} แก้ว</span>
      </header>
      <div className="sheet-body">
        <div className="sheet-table-wrap">
          <table className="sheet-table">
            <thead>
              <tr>
                <th rowSpan={2} className="c-no">ลำดับ</th>
                <th rowSpan={2} className="c-name">รายการ</th>
                {s.variants.map((v) => <th key={v.key} colSpan={2}>{v.label}</th>)}
                {nTop > 0 && <th colSpan={nTop}>ท็อปปิ้ง (แก้ว)</th>}
                <th rowSpan={2}>ส่วนลด</th>
                <th rowSpan={2}>จำนวนเงิน</th>
              </tr>
              <tr>
                {s.variants.map((v) => [<th key={`${v.key}p`}>ราคา</th>, <th key={`${v.key}q`}>จำนวน</th>])}
                {s.topCols.map((t) => <th key={t} className="c-top">{t}</th>)}
                {s.hasOtherTops && <th className="c-top">อื่นๆ</th>}
              </tr>
            </thead>
            <tbody>
              {s.sections.map((sec) => [
                <tr key={`h-${sec.name}`} className="sheet-sec"><td colSpan={cols}>{sec.name}</td></tr>,
                ...sec.rows.map((r, i) => (
                  <tr key={`${sec.name}-${r.base}`} className={r.cups ? '' : 'sheet-zero'}>
                    <td className="c-no">{i + 1}</td>
                    <td className="c-name">{r.base}</td>
                    {s.variants.map((v) => {
                      const x = r.v[v.key];
                      return [
                        <td key={`${v.key}p`} className="num muted">{x ? num(mode(x.prices)) : '–'}</td>,
                        <td key={`${v.key}q`} className="num">{x?.qty ? <b>{x.qty}</b> : ''}</td>,
                      ];
                    })}
                    {s.topCols.map((t) => <td key={t} className="num">{r.tops[t] || ''}</td>)}
                    {s.hasOtherTops && <td className="num">{r.otherTops || ''}</td>}
                    <td className="num text-discount">{r.discount ? `−${num(r.discount)}` : ''}</td>
                    <td className="num"><b>{r.amount ? num(r.amount) : ''}</b></td>
                  </tr>
                )),
                <tr key={`t-${sec.name}`} className="sheet-subtotal">
                  <td colSpan={2} className="num">รวม {sec.name}</td>
                  <td colSpan={nVar * 2 + nTop} className="num">{sec.cups} แก้ว</td>
                  <td className="num">{sec.discount ? `−${num(sec.discount)}` : ''}</td>
                  <td className="num">{num(sec.amount)}</td>
                </tr>,
              ])}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="num">ยอดรวม</td>
                <td colSpan={nVar * 2 + nTop} className="num">{s.totals.cups} แก้ว</td>
                <td className="num">{s.totals.discount ? `−${num(s.totals.discount)}` : ''}</td>
                <td className="num">{baht(s.totals.amount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <aside className="sheet-side">
          <div className="sheet-box">
            <div className="sheet-row"><span>เงินสด</span><b>{baht(s.money.cash)}</b></div>
            <div className="sheet-row"><span>เงินโอน</span><b>{baht(s.money.transfer)}</b></div>
            <div className="sheet-row"><span>ส่วนลดรวม</span><span>{s.totals.discount ? `−${baht(s.totals.discount)}` : '–'}</span></div>
            {s.discounts.map(([n, a]) => <div key={n} className="sheet-row sheet-sub"><span>{n}</span><span>−{baht(a)}</span></div>)}
            {s.expenses.length > 0 && <div className="sheet-row"><span>ค่าใช้จ่าย</span><span>−{baht(s.money.expenseTotal)}</span></div>}
            {s.expenses.map(([n, a]) => <div key={n} className="sheet-row sheet-sub"><span>{n}</span><span>−{baht(a)}</span></div>)}
            <div className="sheet-row sheet-line"><span>คงเหลือ (เงินสด)</span><b>{baht(s.money.cashLeft)}</b></div>
            <div className="sheet-row"><span>คงเหลือ (เงินโอน)</span><b>{baht(s.money.transfer)}</b></div>
            <div className="sheet-row sheet-grand"><span>รวมคงเหลือ</span><b>{baht(s.money.left)}</b></div>
            {s.expenses.length > 0 && <div className="muted small">คิดว่าค่าใช้จ่ายจ่ายด้วยเงินสด</div>}
          </div>
          {s.freebies.length > 0 && (
            <div className="sheet-box">
              <div className="sheet-box-title">ได้ส่วนลด / แก้วฟรี</div>
              {s.freebies.map((x) => (
                <div key={`${x.customer}${x.menu}${x.discount}`} className="sheet-free">
                  <div><b>{x.customer}</b> · {x.menu} {x.qty}{x.free ? ' (ฟรี)' : ''}</div>
                  <div className="muted small">{x.discount} −{baht(x.amount)}</div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
