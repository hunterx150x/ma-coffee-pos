import { useState } from 'react';
import { api } from '../api.js';
import { baht, num, presetRange, thDate, downloadCsv } from '../utils.js';
import { DateRange, Empty, ErrorBox, Icon, Loading, PageHead, Tabs, useAsync, useUi } from '../components/ui.jsx';
import { summaryRows, detailRows } from '../reportExport.js';

export default function Reports() {
  const [range, setRange] = useState(presetRange('today'));
  const [tab, setTab] = useState('menu');
  const { toast } = useUi();
  const rep = useAsync(() => api('/reports/summary', { query: range }), [range.from, range.to]);
  const r = rep.data;
  const t = r?.totals;
  const singleDay = range.from === range.to;

  const [exporting, setExporting] = useState('');
  // Both exports work from the raw bills of the selected range (the summary endpoint has no line details).
  const exportCsv = async (kind) => {
    setExporting(kind);
    try {
      const [orders, settings] = await Promise.all([api('/orders', { query: range }), api('/settings')]);
      const name = `${kind === 'detail' ? 'sales-detail' : 'report-promo'}-${r.range.from}_${r.range.to}.csv`;
      downloadCsv(name, kind === 'detail' ? detailRows(orders) : summaryRows(r, orders, settings.shopName));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setExporting('');
    }
  };

  return (
    <div>
      <PageHead title="รายงานยอดขาย & กำไร-ขาดทุน" sub={r ? (singleDay ? thDate(r.range.from) : `${thDate(r.range.from)} – ${thDate(r.range.to)}`) : ''}>
        {r && (
          <>
            <button className="btn btn-outline" disabled={!!exporting} onClick={() => exportCsv('summary')} title="สรุปวิเคราะห์: เมนู × ส่วนลด, ช่วงเวลา, วันในสัปดาห์, ท็อปปิ้ง, ลูกค้า">
              <Icon name="download" /> {exporting === 'summary' ? 'กำลังสร้าง...' : 'CSV สรุปเพื่อทำโปรโมชั่น'}
            </button>
            <button className="btn btn-outline" disabled={!!exporting} onClick={() => exportCsv('detail')} title="1 แถวต่อ 1 รายการ สำหรับทำ Pivot ใน Excel / Google Sheets">
              <Icon name="download" /> {exporting === 'detail' ? 'กำลังสร้าง...' : 'CSV รายละเอียดทุกแก้ว'}
            </button>
          </>
        )}
      </PageHead>
      <div className="card filters"><DateRange value={range} onChange={setRange} /></div>

      {rep.loading && !r ? <Loading /> : rep.error ? <ErrorBox error={rep.error} onRetry={rep.reload} /> : r && (
        <>
          <div className="kpis">
            <Kpi label="ยอดขายสุทธิ" value={baht(t.sales)} sub={`${num(t.orders)} บิล · ${num(t.cups)} แก้ว`} hero />
            <Kpi label="เงินสด" value={baht(t.cash)} sub={`${t.cashCount} บิล`} icon="cash" />
            <Kpi label="เงินโอน" value={baht(t.transfer)} sub={`${t.transferCount} บิล`} icon="qr" />
            <Kpi label={t.netProfit >= 0 ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ'} value={`${t.netProfit < 0 ? '−' : ''}${baht(Math.abs(t.netProfit))}`}
              sub={`กำไรขั้นต้น ${baht(t.grossProfit)} (${num(t.grossMargin)}%)`} tone={t.netProfit >= 0 ? 'good' : 'bad'} />
          </div>

          <div className="report-grid">
            <div className="card">
              <h3 className="card-title">งบกำไร-ขาดทุน</h3>
              <div className="pl">
                <PlRow label="ยอดขายก่อนส่วนลด" value={t.gross} />
                <PlRow label="หัก ส่วนลด" value={-t.discount} muted />
                <PlRow label="ยอดขายสุทธิ" value={t.sales} strong />
                <PlRow label="หัก ต้นทุนสินค้า (วัตถุดิบ)" value={-t.cost} muted />
                <PlRow label="กำไรขั้นต้น" value={t.grossProfit} strong />
                <PlRow label="หัก ค่าใช้จ่ายดำเนินงาน" value={-t.expenses} muted />
                <PlRow label={t.netProfit >= 0 ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ'} value={t.netProfit} total />
              </div>
              {(t.capitalIn > 0) && (
                <div className="pl-capital">
                  <div className="pl-capital-title">เงินทุน (ไม่นับเป็นกำไร)</div>
                  <PlRow label="เงินทุนเพิ่มเข้าช่วงนี้" value={t.capitalIn} />
                  <PlRow label="ค่าใช้จ่ายดำเนินงาน" value={-t.expenses} muted />
                  <PlRow label={t.expensesAfterCapital > 0 ? 'ค่าใช้จ่ายส่วนที่เกินเงินทุน' : 'เงินทุนเหลือหลังหักค่าใช้จ่าย'} value={-t.expensesAfterCapital} strong />
                </div>
              )}
              <div className="pl-foot muted small">
                เฉลี่ย {baht(t.avgPerOrder)}/บิล · ลูกค้าใหม่ {t.newCustomers} · ลูกค้าเก่า {t.returningCustomers}
                {t.voidCount > 0 && ` · ยกเลิก ${t.voidCount} บิล (${baht(t.voidAmount)})`}
              </div>
            </div>

            <div className="card">
              <h3 className="card-title">{singleDay ? 'ยอดขายรายชั่วโมง' : 'ยอดขายรายวัน'}</h3>
              {t.orders ? (
                <BarChart
                  data={singleDay
                    ? r.hours.filter((hr) => hr.hour >= 6 && hr.hour <= 22 || hr.sales > 0).map((hr) => ({ label: `${hr.hour}`, tip: `${hr.hour}:00–${hr.hour}:59`, value: hr.sales, sub: `${hr.orders} บิล` }))
                    : r.daily.map((d) => ({ label: thDate(d.date, { year: false }), tip: thDate(d.date), value: d.sales, sub: `${d.orders} บิล · กำไรสุทธิ ${baht(d.netProfit)}` }))}
                />
              ) : <Empty icon="reports" title="ยังไม่มียอดขายในช่วงนี้" />}
            </div>
          </div>

          {!singleDay && (
            <div className="card table-card">
              <h3 className="card-title">สรุปรายวัน</h3>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>วันที่</th><th className="num">บิล</th><th className="num">ยอดขาย</th><th className="num">เงินสด</th>
                      <th className="num">เงินโอน</th><th className="num hide-sm">ต้นทุน</th><th className="num hide-sm">ค่าใช้จ่าย</th><th className="num">กำไรสุทธิ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.daily.map((d) => (
                      <tr key={d.date} className={d.orders ? '' : 'row-dim'}>
                        <td>{thDate(d.date)}</td><td className="num">{d.orders}</td><td className="num">{baht(d.sales)}</td>
                        <td className="num">{baht(d.cash)}</td><td className="num">{baht(d.transfer)}</td>
                        <td className="num hide-sm">{baht(d.cost)}</td><td className="num hide-sm">{baht(d.expenses)}</td>
                        <td className={`num ${d.netProfit < 0 ? 'text-bad' : ''}`}>{baht(d.netProfit)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>รวม</td><td className="num">{t.orders}</td><td className="num">{baht(t.sales)}</td><td className="num">{baht(t.cash)}</td>
                      <td className="num">{baht(t.transfer)}</td><td className="num hide-sm">{baht(t.cost)}</td><td className="num hide-sm">{baht(t.expenses)}</td>
                      <td className={`num ${t.netProfit < 0 ? 'text-bad' : ''}`}>{baht(t.netProfit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          <div className="card table-card">
            <Tabs value={tab} onChange={setTab} tabs={[
              { key: 'menu', label: 'เมนูขายดี' },
              { key: 'cat', label: 'ตามประเภท' },
              { key: 'top', label: 'ท็อปปิ้ง' },
              { key: 'disc', label: 'ส่วนลด' },
              { key: 'sweet', label: 'ความหวาน' },
              { key: 'staff', label: 'พนักงาน' },
              { key: 'exp', label: 'ค่าใช้จ่าย' },
            ]} />
            <div className="table-scroll">
              {tab === 'menu' && (
                <RankTable rows={r.topItems} cols={[
                  ['เมนู', (x) => <><b>{x.name}</b> <span className="muted small">{x.category}</span></>],
                  ['แก้ว', (x) => num(x.qty), 'num'],
                  ['ยอดขาย', (x) => baht(x.sales), 'num'],
                  ['ต้นทุน', (x) => baht(x.cost), 'num hide-sm'],
                  ['กำไร', (x) => baht(x.profit), 'num'],
                ]} bar={(x) => x.qty} />
              )}
              {tab === 'cat' && <RankTable rows={r.categories} cols={[['ประเภท', (x) => x.name], ['แก้ว', (x) => num(x.qty), 'num'], ['ยอดขาย', (x) => baht(x.sales), 'num']]} bar={(x) => x.sales} />}
              {tab === 'top' && <RankTable rows={r.toppings} cols={[['ท็อปปิ้ง', (x) => x.name], ['จำนวน', (x) => num(x.qty), 'num'], ['ยอดขาย', (x) => baht(x.sales), 'num']]} bar={(x) => x.qty} />}
              {tab === 'disc' && <RankTable rows={r.discounts} cols={[['ส่วนลด', (x) => x.name], ['ครั้ง', (x) => num(x.count), 'num'], ['มูลค่า', (x) => baht(x.amount), 'num']]} bar={(x) => x.amount} />}
              {tab === 'sweet' && <RankTable rows={r.sweetness} cols={[['ระดับความหวาน', (x) => `${x.level}%`], ['แก้ว', (x) => num(x.qty), 'num']]} bar={(x) => x.qty} />}
              {tab === 'staff' && <RankTable rows={r.staff} cols={[['พนักงาน', (x) => x.name], ['บิล', (x) => num(x.orders), 'num'], ['ยอดขาย', (x) => baht(x.sales), 'num']]} bar={(x) => x.sales} />}
              {tab === 'exp' && <RankTable rows={r.expenseByCategory} cols={[['หมวด', (x) => x.name], ['จำนวนเงิน', (x) => baht(x.amount), 'num']]} bar={(x) => x.amount} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, hero, tone, icon }) {
  return (
    <div className={`kpi ${hero ? 'kpi-hero' : ''} ${tone ? `kpi-${tone}` : ''}`}>
      <div className="kpi-label">{icon && <Icon name={icon} size={16} />}{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function PlRow({ label, value, strong, muted, total }) {
  return (
    <div className={`pl-row ${strong ? 'pl-strong' : ''} ${muted ? 'pl-muted' : ''} ${total ? 'pl-total' : ''} ${total && value < 0 ? 'text-bad' : ''} ${total && value >= 0 ? 'text-good' : ''}`}>
      <span>{label}</span>
      <span>{value < 0 ? '−' : ''}{baht(Math.abs(value))}</span>
    </div>
  );
}

function RankTable({ rows, cols, bar }) {
  if (!rows.length) return <Empty icon="reports" title="ไม่มีข้อมูล" />;
  const max = Math.max(...rows.map(bar), 1);
  return (
    <table className="table">
      <thead>
        <tr>
          <th className="rank">#</th>
          {cols.map(([h, , cls]) => <th key={h} className={cls}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((x, i) => (
          <tr key={i}>
            <td className="rank muted">{i + 1}</td>
            {cols.map(([h, f, cls], j) => (
              <td key={h} className={cls}>
                {f(x)}
                {j === 0 && <div className="rank-bar"><span style={{ width: `${(bar(x) / max) * 100}%` }} /></div>}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Single-series column chart: one hue, 4px rounded tops anchored to the baseline, hover tooltip per bar. */
function BarChart({ data }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...data.map((d) => d.value), 0);
  const niceMax = niceCeil(max);
  const ticks = [0, niceMax / 2, niceMax];
  const labelEvery = Math.ceil(data.length / 12);
  return (
    <div className="chart">
      <div className="chart-plot">
        <div className="chart-grid">
          {ticks.slice().reverse().map((tk) => (
            <div key={tk} className="chart-gridline"><span>{tk >= 1000 ? `${num(tk / 1000)}k` : num(tk)}</span></div>
          ))}
        </div>
        <div className="chart-bars" onMouseLeave={() => setHover(null)}>
          {data.map((d, i) => (
            <div key={i} className="chart-col" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <div className={`chart-bar ${hover === i ? 'hover' : ''}`} style={{ height: niceMax ? `${(d.value / niceMax) * 100}%` : 0 }} />
              {hover === i && (
                <div className={`chart-tip ${i > data.length / 2 ? 'left' : ''}`}>
                  <div className="muted small">{d.tip}</div>
                  <b>{baht(d.value)}</b>
                  {d.sub && <div className="small">{d.sub}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="chart-labels">
        {data.map((d, i) => <span key={i}>{i % labelEvery === 0 ? d.label : ''}</span>)}
      </div>
    </div>
  );
}

function niceCeil(v) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}
