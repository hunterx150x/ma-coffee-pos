// Report charts: one form per job (trend = columns, share = 100% bar or donut, ranking = horizontal bars,
// profit/loss = diverging columns). Every chart has hover tooltips and labelled values; which charts are shown
// (and bar/donut choice) is remembered per device.
import { useState } from 'react';
import { baht, num, thDate } from '../utils.js';
import { Empty, Icon } from '../components/ui.jsx';

// Validated categorical palette (fixed order, assigned by entity, never by rank). Low-contrast slots are
// always paired with a text label + value in the legend.
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const OTHER = '#a8a29a';
const MAX_SLICES = 6;

const PREFS_KEY = 'ma_report_charts';
export const CHARTS = [
  { key: 'trend', label: 'ยอดขายตามเวลา' },
  { key: 'profit', label: 'กำไรสุทธิรายวัน', multiDay: true },
  { key: 'category', label: 'สัดส่วนตามหมวด', share: true },
  { key: 'payment', label: 'เงินสด / เงินโอน', share: true },
  { key: 'menus', label: 'เมนูขายดี' },
  { key: 'discounts', label: 'ส่วนลดที่ใช้' },
  { key: 'weekday', label: 'ยอดตามวันในสัปดาห์', multiDay: true },
  { key: 'hours', label: 'ช่วงเวลาขายดี', multiDay: true },
];
const DEFAULT_PREFS = { visible: ['trend', 'category', 'payment', 'menus'], types: {} };

export function useChartPrefs() {
  const [prefs, setPrefs] = useState(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY));
      return p && Array.isArray(p.visible) ? { ...DEFAULT_PREFS, ...p } : DEFAULT_PREFS;
    } catch {
      return DEFAULT_PREFS;
    }
  });
  // Functional updates so quick successive clicks never overwrite each other.
  const update = (fn) => setPrefs((cur) => {
    const next = fn(cur);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  return {
    prefs,
    isOn: (k) => prefs.visible.includes(k),
    toggle: (k) => update((p) => ({ ...p, visible: p.visible.includes(k) ? p.visible.filter((x) => x !== k) : [...p.visible, k] })),
    typeOf: (k, fallback) => prefs.types[k] || fallback,
    setType: (k, t) => update((p) => ({ ...p, types: { ...p.types, [k]: t } })),
  };
}

const short = (v) => (Math.abs(v) >= 1000 ? `${num(Math.round(v / 100) / 10)}k` : num(v));
function niceCeil(v) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

export function ChartCard({ title, sub, children, tools }) {
  return (
    <div className="card chart-card">
      <div className="chart-card-head">
        <div>
          <h3 className="card-title">{title}</h3>
          {sub && <div className="muted small chart-sub">{sub}</div>}
        </div>
        {tools}
      </div>
      <div className="chart-card-body">{children}</div>
    </div>
  );
}

/** Single-series columns that fill the card height. data: [{ label, tip, value, sub }] */
export function ColumnChart({ data, format = baht }) {
  const [hover, setHover] = useState(null);
  const max = niceCeil(Math.max(...data.map((d) => d.value), 0));
  const ticks = [max, (max * 3) / 4, max / 2, max / 4, 0];
  const labelEvery = Math.ceil(data.length / 12);
  return (
    <div className="chart chart-fill">
      <div className="chart-plot">
        <div className="chart-grid">
          {ticks.map((tk) => <div key={tk} className="chart-gridline"><span>{short(tk)}</span></div>)}
        </div>
        <div className="chart-bars" onMouseLeave={() => setHover(null)}>
          {data.map((d, i) => (
            <div key={i} className="chart-col" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <div className={`chart-bar ${hover === i ? 'hover' : ''}`} style={{ height: `${(d.value / max) * 100}%` }} />
              {hover === i && (
                <div className={`chart-tip ${i > data.length / 2 ? 'left' : ''}`}>
                  <div className="muted small">{d.tip}</div>
                  <b>{format(d.value)}</b>
                  {d.sub && <div className="small">{d.sub}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="chart-labels">{data.map((d, i) => <span key={i}>{i % labelEvery === 0 ? d.label : ''}</span>)}</div>
    </div>
  );
}

/** Profit / loss per day: one axis, gains above and losses below a neutral zero line. */
export function DivergingColumns({ data }) {
  const [hover, setHover] = useState(null);
  const top = niceCeil(Math.max(0, ...data.map((d) => d.value)));
  const bottom = niceCeil(Math.max(0, ...data.map((d) => -d.value)));
  const hasNeg = data.some((d) => d.value < 0);
  const hasPos = data.some((d) => d.value > 0);
  const span = (hasPos ? top : 0) + (hasNeg ? bottom : 0) || 100;
  const zeroPct = ((hasPos ? top : 0) / span) * 100;
  const labelEvery = Math.ceil(data.length / 12);
  return (
    <div className="chart chart-fill">
      <div className="chart-plot">
        <div className="chart-zero" style={{ top: `${zeroPct}%` }}><span>0</span></div>
        {hasPos && <div className="chart-axis-label" style={{ top: 0 }}>{short(top)}</div>}
        {hasNeg && <div className="chart-axis-label" style={{ bottom: 0 }}>−{short(bottom)}</div>}
        <div className="chart-bars chart-bars-div" onMouseLeave={() => setHover(null)}>
          {data.map((d, i) => {
            const h = (Math.abs(d.value) / span) * 100;
            return (
              <div key={i} className="chart-col chart-col-div" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
                <div className={`chart-bar ${d.value < 0 ? 'neg' : 'pos'} ${hover === i ? 'hover' : ''}`}
                  style={d.value >= 0 ? { bottom: `${100 - zeroPct}%`, height: `${h}%` } : { top: `${zeroPct}%`, height: `${h}%` }} />
                {hover === i && (
                  <div className={`chart-tip ${i > data.length / 2 ? 'left' : ''}`}>
                    <div className="muted small">{d.tip}</div>
                    <b className={d.value < 0 ? 'text-bad' : 'text-good'}>{d.value < 0 ? 'ขาดทุน ' : 'กำไร '}{baht(Math.abs(d.value))}</b>
                    {d.sub && <div className="small">{d.sub}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="chart-labels">{data.map((d, i) => <span key={i}>{i % labelEvery === 0 ? d.label : ''}</span>)}</div>
      <div className="chart-legend">
        <span><i className="sw sw-pos" />กำไร</span><span><i className="sw sw-neg" />ขาดทุน</span>
      </div>
    </div>
  );
}

/** Ranking: horizontal bars, one hue, value labelled at the bar end. rows: [{ label, value, sub }] */
export function HBarChart({ rows, format = baht, color = 'var(--chart)' }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <div className="hbars" onMouseLeave={() => setHover(null)}>
      {rows.map((r, i) => (
        <div key={i} className={`hbar ${hover === i ? 'hover' : ''}`} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
          <div className="hbar-label" title={r.label}>{r.label}</div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
            <span className="hbar-value">{format(r.value)}</span>
          </div>
          {hover === i && r.sub && <div className="hbar-tip">{r.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/** Part-to-whole. slices: [{ key, label, value, color }] — folded to MAX_SLICES with "อื่นๆ". */
export function ShareChart({ slices, type = 'bar', format = baht }) {
  const [hover, setHover] = useState(null);
  const sorted = [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const shown = sorted.length > MAX_SLICES
    ? [...sorted.slice(0, MAX_SLICES - 1), { key: '_other', label: 'อื่นๆ', color: OTHER, value: sorted.slice(MAX_SLICES - 1).reduce((s, x) => s + x.value, 0) }]
    : sorted;
  const total = shown.reduce((s, x) => s + x.value, 0);
  if (!total) return <Empty icon="reports" title="ไม่มีข้อมูล" />;
  const pct = (v) => Math.round((v / total) * 1000) / 10;

  const legend = (
    <ul className="share-legend">
      {shown.map((s, i) => (
        <li key={s.key} className={hover === i ? 'hover' : ''} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <i className="sw" style={{ background: s.color }} />
          <span className="share-name">{s.label}</span>
          <b>{pct(s.value)}%</b>
          <span className="muted">{format(s.value)}</span>
        </li>
      ))}
    </ul>
  );

  if (type === 'donut') {
    const R = 70;
    const C = 2 * Math.PI * R;
    let acc = 0;
    return (
      <div className="share share-donut">
        <svg viewBox="0 0 180 180" className="donut" role="img" aria-label="สัดส่วน">
          <circle cx="90" cy="90" r={R} fill="none" stroke="var(--line)" strokeWidth="26" />
          {shown.map((s, i) => {
            const len = (s.value / total) * C;
            const gap = shown.length > 1 ? Math.min(2, len / 2) : 0; // 2px surface gap between segments
            const el = (
              <circle key={s.key} cx="90" cy="90" r={R} fill="none" stroke={s.color} strokeWidth={hover === i ? 30 : 26}
                strokeDasharray={`${Math.max(0, len - gap)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 90 90)"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ transition: 'stroke-width .12s' }}>
                <title>{`${s.label}: ${pct(s.value)}% (${format(s.value)})`}</title>
              </circle>
            );
            acc += len;
            return el;
          })}
          <text x="90" y="86" textAnchor="middle" className="donut-total">{format(hover != null ? shown[hover].value : total)}</text>
          <text x="90" y="106" textAnchor="middle" className="donut-cap">{hover != null ? shown[hover].label : 'รวม'}</text>
        </svg>
        {legend}
      </div>
    );
  }
  return (
    <div className="share">
      <div className="share-bar">
        {shown.map((s, i) => (
          <div key={s.key} className={`share-seg ${hover === i ? 'hover' : ''}`} style={{ flexGrow: s.value, background: s.color }}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} title={`${s.label}: ${pct(s.value)}%`}>
            {pct(s.value) >= 12 && <span>{pct(s.value)}%</span>}
          </div>
        ))}
      </div>
      {legend}
    </div>
  );
}

export function TypeSwitch({ value, onChange }) {
  return (
    <div className="type-switch" role="group" aria-label="รูปแบบกราฟ">
      <button className={value === 'bar' ? 'active' : ''} onClick={() => onChange('bar')} title="แท่ง 100%">แท่ง</button>
      <button className={value === 'donut' ? 'active' : ''} onClick={() => onChange('donut')} title="โดนัท (วงกลม)">วงกลม</button>
    </div>
  );
}

const WEEKDAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** The extra charts below the P&L. `catalog` gives stable category order → stable colors. */
export function ChartsGrid({ r, singleDay, catalog, prefs }) {
  const t = r.totals;
  const [menuMetric, setMenuMetric] = useState('qty');
  const catSlot = new Map((catalog?.categories || []).map((c, i) => [c.name, i]));
  const colorFor = (name, fallbackIdx) => {
    const i = catSlot.has(name) ? catSlot.get(name) : fallbackIdx;
    return i < SERIES.length ? SERIES[i] : OTHER;
  };
  const show = (k) => prefs.isOn(k) && !(singleDay && CHARTS.find((c) => c.key === k)?.multiDay);
  const cards = [];

  if (show('profit')) {
    cards.push(
      <ChartCard key="profit" title="กำไรสุทธิรายวัน" sub="ยอดขาย − ต้นทุน − ค่าใช้จ่าย ของแต่ละวัน">
        <DivergingColumns data={r.daily.map((d) => ({
          label: thDate(d.date, { year: false }), tip: thDate(d.date), value: d.netProfit,
          sub: `ขาย ${baht(d.sales)} · ต้นทุน ${baht(d.cost)} · ค่าใช้จ่าย ${baht(d.expenses)}`,
        }))} />
      </ChartCard>,
    );
  }
  if (show('category')) {
    const type = prefs.typeOf('category', 'bar');
    cards.push(
      <ChartCard key="category" title="สัดส่วนยอดขายตามหมวด" tools={<TypeSwitch value={type} onChange={(v) => prefs.setType('category', v)} />}>
        <ShareChart type={type} slices={r.categories.map((c, i) => ({ key: c.name, label: c.name, value: c.sales, color: colorFor(c.name, i) }))} />
      </ChartCard>,
    );
  }
  if (show('payment')) {
    const type = prefs.typeOf('payment', 'bar');
    cards.push(
      <ChartCard key="payment" title="เงินสด / เงินโอน" sub={`${t.cashCount} บิลเงินสด · ${t.transferCount} บิลเงินโอน`}
        tools={<TypeSwitch value={type} onChange={(v) => prefs.setType('payment', v)} />}>
        <ShareChart type={type} slices={[
          { key: 'cash', label: 'เงินสด', value: t.cash, color: SERIES[0] },
          { key: 'transfer', label: 'เงินโอน', value: t.transfer, color: SERIES[1] },
        ]} />
      </ChartCard>,
    );
  }
  if (show('menus')) {
    const metric = { qty: { label: 'แก้ว', f: (x) => x.qty, fmt: (v) => `${num(v)} แก้ว` }, sales: { label: 'ยอดขาย', f: (x) => x.sales, fmt: baht }, profit: { label: 'กำไร', f: (x) => x.profit, fmt: baht } }[menuMetric];
    const rows = [...r.topItems].sort((a, b) => metric.f(b) - metric.f(a)).slice(0, 8)
      .map((x) => ({ label: x.name, value: Math.max(0, metric.f(x)), sub: `${num(x.qty)} แก้ว · ขาย ${baht(x.sales)} · กำไร ${baht(x.profit)}` }));
    cards.push(
      <ChartCard key="menus" title="เมนูขายดี (8 อันดับ)" tools={(
        <div className="type-switch" role="group" aria-label="วัดจาก">
          {['qty', 'sales', 'profit'].map((m) => (
            <button key={m} className={menuMetric === m ? 'active' : ''} onClick={() => setMenuMetric(m)}>{{ qty: 'แก้ว', sales: 'ยอดขาย', profit: 'กำไร' }[m]}</button>
          ))}
        </div>
      )}>
        {rows.length ? <HBarChart rows={rows} format={metric.fmt} /> : <Empty icon="reports" title="ไม่มีข้อมูล" />}
      </ChartCard>,
    );
  }
  if (show('discounts')) {
    const rows = r.discounts.slice(0, 8).map((d) => ({ label: d.name, value: d.amount, sub: `ใช้ ${d.count} ครั้ง` }));
    cards.push(
      <ChartCard key="discounts" title="ส่วนลดที่ใช้" sub={t.discount ? `รวม ${baht(t.discount)} · ${Math.round((t.discount / (t.gross || 1)) * 1000) / 10}% ของยอดก่อนลด` : null}>
        {rows.length ? <HBarChart rows={rows} color={SERIES[1]} /> : <Empty icon="tag" title="ไม่มีการใช้ส่วนลด" />}
      </ChartCard>,
    );
  }
  if (show('weekday')) {
    const sums = Array.from({ length: 7 }, () => ({ sales: 0, days: 0, orders: 0 }));
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const d of r.daily) {
      if (d.date > todayStr) continue; // future days would drag the average down
      const w = sums[new Date(`${d.date}T00:00:00`).getDay()];
      w.sales += d.sales; w.orders += d.orders; w.days += 1;
    }
    cards.push(
      <ChartCard key="weekday" title="ยอดขายเฉลี่ยตามวันในสัปดาห์" sub="ใช้หาวันที่ขายเงียบ เพื่อจัดโปรวันธรรมดา">
        <ColumnChart data={WEEK_ORDER.map((i) => ({
          label: WEEKDAYS[i], tip: `วัน${['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'][i]} (${sums[i].days} วัน)`,
          value: sums[i].days ? Math.round(sums[i].sales / sums[i].days) : 0, sub: `${sums[i].orders} บิลรวม`,
        }))} />
      </ChartCard>,
    );
  }
  if (show('hours')) {
    const hrs = r.hours.filter((h) => (h.hour >= 6 && h.hour <= 22) || h.sales > 0);
    cards.push(
      <ChartCard key="hours" title="ช่วงเวลาขายดี (รวมทั้งช่วง)" sub="ใช้จัด Happy Hour ช่วงที่ขายเงียบ">
        <ColumnChart data={hrs.map((h) => ({ label: `${h.hour}`, tip: `${h.hour}:00–${h.hour}:59`, value: h.sales, sub: `${h.orders} บิล` }))} />
      </ChartCard>,
    );
  }
  if (!cards.length) return null;
  return <div className="charts-grid">{cards}</div>;
}

export function ChartPicker({ prefs, singleDay }) {
  return (
    <div className="chart-picker no-print">
      <span className="muted small"><Icon name="reports" size={14} /> แสดงกราฟ:</span>
      {CHARTS.map((c) => {
        const disabled = singleDay && c.multiDay;
        return (
          <button key={c.key} className={`chip ${prefs.isOn(c.key) && !disabled ? 'active' : ''}`} disabled={disabled}
            title={disabled ? 'เลือกช่วงมากกว่า 1 วันเพื่อดูกราฟนี้' : ''} onClick={() => prefs.toggle(c.key)}>
            {prefs.isOn(c.key) && !disabled ? '✓ ' : ''}{c.label}
          </button>
        );
      })}
    </div>
  );
}
