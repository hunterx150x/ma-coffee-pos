import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { baht, presetRange, thDate, thTime } from '../utils.js';
import { DateRange, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Tabs, useAsync, useUi } from '../components/ui.jsx';
import Receipt, { LineDetail, printReceipt } from '../components/Receipt.jsx';
import PaymentModal from '../components/PaymentModal.jsx';
import HowToModal from '../components/HowTo.jsx';
import { onRealtime, onRealtimeStatus } from '../realtime.js';

const STATUS = {
  waiting: { label: 'รอทำ', cls: 'badge-warn' },
  done: { label: 'ทำแล้ว', cls: 'badge-transfer' },
  paid: { label: 'ชำระแล้ว', cls: 'badge-cash' },
  cancelled: { label: 'ยกเลิก', cls: 'badge-danger' },
};
const FILTERS = [
  { key: 'open', label: 'ยังไม่ชำระ', match: (q) => q.status === 'waiting' || q.status === 'done' },
  { key: 'waiting', label: 'รอทำ', match: (q) => q.status === 'waiting' },
  { key: 'done', label: 'ทำแล้ว', match: (q) => q.status === 'done' },
  { key: 'paid', label: 'ชำระแล้ว', match: (q) => q.status === 'paid' },
  { key: 'cancelled', label: 'ยกเลิก', match: (q) => q.status === 'cancelled' },
  { key: 'all', label: 'ทั้งหมด', match: () => true },
];
const FALLBACK_POLL_MS = 60000;

export default function Queue() {
  const { toast, confirm } = useUi();
  const [range, setRange] = useState(presetRange('today'));
  const [filter, setFilter] = useState('open');
  const [q, setQ] = useState('');
  const list = useAsync(() => api('/queues', { query: range }), [range.from, range.to]);
  const changed = () => {
    list.reload();
    window.dispatchEvent(new Event('pos:queues-changed'));
  };
  const cat = useAsync(() => api('/catalog'), []);
  const [nowTs, setNowTs] = useState(Date.now());
  const [payQueue, setPayQueue] = useState(null); // details confirm (like step 8)
  const [payOpen, setPayOpen] = useState(false);
  const [doneOrder, setDoneOrder] = useState(null);
  const [cancelQ, setCancelQ] = useState(null);
  const [reason, setReason] = useState('');
  const [howToLine, setHowToLine] = useState(null);

  const [live, setLive] = useState(false);

  // Realtime: reload as soon as any device changes a queue; slow polling stays as a safety net.
  useEffect(() => {
    const offEvents = onRealtime(['queues', 'resync'], () => list.reload());
    const offStatus = onRealtimeStatus(setLive);
    const poll = setInterval(() => list.reload(), FALLBACK_POLL_MS);
    return () => { offEvents(); offStatus(); clearInterval(poll); };
  }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keeps the "waiting N minutes" labels fresh.
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const all = list.data || [];
  const f = FILTERS.find((x) => x.key === filter);
  const term = q.trim().toLowerCase();
  const rows = all.filter(f.match).filter((x) => !term || x.name.toLowerCase().includes(term) || String(x.queueNo) === term);
  const openTotal = all.filter(FILTERS[0].match).reduce((s, x) => s + x.total, 0);
  const singleDay = range.from === range.to;

  const setStatus = async (queue, status, extra = {}) => {
    try {
      await api(`/queues/${queue.id}/status`, { method: 'POST', body: { status, ...extra } });
      changed();
    } catch (e) {
      toast(e.message, 'error');
      list.reload();
    }
  };

  const pay = async ({ method, cashReceived }) => {
    const r = await api(`/queues/${payQueue.id}/pay`, { method: 'POST', body: { paymentMethod: method, cashReceived } });
    setPayOpen(false);
    setPayQueue(null);
    setDoneOrder(r.order);
    changed();
  };

  const doCancel = async () => {
    await setStatus(cancelQ, 'cancelled', { reason });
    toast(`ยกเลิกคิว ${cancelQ.queueNo} แล้ว`);
    setCancelQ(null);
    setReason('');
  };

  return (
    <div>
      <PageHead title="คิว" sub={`ยังไม่ชำระ ${all.filter(FILTERS[0].match).length} คิว · ${baht(openTotal)} · มาก่อนได้ก่อน`}>
        <span className={`live ${live ? 'on' : ''}`} title={live ? 'อัปเดตอัตโนมัติทันทีเมื่อมีการเปลี่ยนแปลง' : 'กำลังเชื่อมต่อใหม่...'}>
          <span className="live-dot" /> {live ? 'Realtime' : 'กำลังเชื่อมต่อ...'}
        </span>
      </PageHead>
      <div className="card filters">
        <DateRange value={range} onChange={setRange} />
        <div className="filters-row">
          <div className="search">
            <Icon name="search" size={18} />
            <input className="input" placeholder="ค้นหาชื่อ / เลขคิว" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Tabs value={filter} onChange={setFilter} tabs={FILTERS.map((x) => ({ key: x.key, label: x.label, count: all.filter(x.match).length }))} />
        </div>
      </div>

      {list.loading && !list.data ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : rows.length ? (
        <div className="queue-grid">
          {rows.map((x) => {
            const mins = Math.max(0, Math.floor((nowTs - new Date(x.createdAt).getTime()) / 60000));
            const open = x.status === 'waiting' || x.status === 'done';
            return (
              <article key={x.id} className={`card queue-card queue-${x.status}`}>
                <header className="queue-head">
                  <div className="queue-no">{x.queueNo}</div>
                  <div className="queue-head-main">
                    <b className="queue-name">{x.source === 'customer' && <span className="badge badge-self">📱 สั่งเอง</span>}{x.name}</b>
                    <div className="muted small">
                      <Icon name="clock" size={12} /> {singleDay ? thTime(x.createdAt) : `${thDate(x.createdAt)} ${thTime(x.createdAt)}`}
                      {open && singleDay && ` · รอ ${mins} นาที`} · {x.staffName}
                    </div>
                  </div>
                  <span className={`badge ${STATUS[x.status].cls}`}>{STATUS[x.status].label}</span>
                </header>
                {x.note && <div className="line-note">{x.note}</div>}
                <div className="queue-lines">
                  {x.lines.map((l, i) => (
                    <div key={i} className="queue-line">
                      <div className="sum-row"><b>{l.qty} × {l.name}</b><span>{baht(l.total)}</span></div>
                      <LineDetail line={l} showPrice={false} />
                      {cat.data && (
                        <button className="btn btn-sm btn-ghost btn-howto" onClick={() => setHowToLine(l)}><Icon name="book" size={16} /> ดูวิธีทำ</button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="sum-row sum-total"><span>{x.cups} แก้ว</span><span>{baht(x.total)}</span></div>
                {x.status === 'paid' && <div className="muted small">ชำระแล้ว · บิล {x.orderNo}</div>}
                {x.status === 'cancelled' && (
                  <div className="muted small">ยกเลิกโดย {x.cancelledBy}{x.cancelReason ? ` · ${x.cancelReason}` : ''}</div>
                )}
                <footer className="queue-actions">
                  {x.status === 'waiting' && (
                    <button className="btn btn-outline" onClick={() => setStatus(x, 'done')}><Icon name="check" /> ทำเสร็จแล้ว</button>
                  )}
                  {x.status === 'done' && (
                    <button className="btn btn-ghost" onClick={() => setStatus(x, 'waiting')}><Icon name="history" /> กลับเป็นรอทำ</button>
                  )}
                  {open && (
                    <button className="btn btn-success" onClick={() => setPayQueue(x)}><Icon name="cash" /> ชำระเงิน</button>
                  )}
                  {open && (
                    <button className="icon-btn icon-btn-danger" aria-label="ยกเลิกคิว" title="ยกเลิกคิว"
                      onClick={() => { setReason(''); setCancelQ(x); }}><Icon name="ban" /></button>
                  )}
                  {x.status === 'cancelled' && (
                    <button className="btn btn-ghost" onClick={async () => {
                      if (await confirm({ message: `นำคิว ${x.queueNo} (${x.name}) กลับมาเป็น “รอทำ”?` })) setStatus(x, 'waiting');
                    }}><Icon name="history" /> กู้คืนคิว</button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      ) : <Empty icon="queue" title={filter === 'open' ? 'ไม่มีคิวค้างอยู่' : 'ไม่มีคิว'}>เพิ่มคิวได้จากหน้า “ขายหน้าร้าน” ขั้นตอนชำระเงิน → “เพิ่มไปที่คิว”</Empty>}

      {/* Same as step 8: show details and the amount due, then choose cash / transfer. */}
      <Modal open={!!payQueue} title={payQueue ? `ชำระเงิน · คิว ${payQueue.queueNo}` : ''} onClose={() => setPayQueue(null)}
        footer={(
          <>
            <button className="btn btn-ghost" onClick={() => setPayQueue(null)}>ยกเลิก</button>
            <button className="btn btn-success" onClick={() => setPayOpen(true)}><Icon name="check" /> ยืนยันการชำระเงิน</button>
          </>
        )}>
        {payQueue && (
          <>
            <div className="sum-row"><span className="muted">ลูกค้า</span><b>{payQueue.name}</b></div>
            <div className="cart cart-compact">
              {payQueue.lines.map((l, i) => (
                <div key={i} className="cart-line">
                  <div className="cart-line-main">
                    <b>{l.qty} × {l.name}</b> <span className="muted small">{baht(l.unitPrice)}/แก้ว</span>
                    <LineDetail line={l} />
                  </div>
                  <div className="cart-line-side"><b>{baht(l.total)}</b>{l.discountTotal > 0 && <s className="muted small">{baht(l.gross)}</s>}</div>
                </div>
              ))}
            </div>
            <div className="due due-sm"><span>ยอดที่ลูกค้าต้องชำระ</span><b>{baht(payQueue.total)}</b></div>
          </>
        )}
      </Modal>

      {cat.data && (
        <PaymentModal open={payOpen} total={payQueue?.total || 0} settings={cat.data.settings} onClose={() => setPayOpen(false)} onPay={pay} />
      )}

      <Modal open={!!doneOrder} title="ชำระเงินสำเร็จ" onClose={() => setDoneOrder(null)}
        footer={(
          <>
            <button className="btn btn-outline" onClick={printReceipt}><Icon name="print" /> พิมพ์ใบเสร็จ</button>
            <button className="btn btn-primary" onClick={() => setDoneOrder(null)}>ปิด</button>
          </>
        )}>
        {doneOrder && (
          <>
            <div className="success-banner">
              <span className="success-icon"><Icon name="check" size={28} stroke={3} /></span>
              <div>
                <div className="muted">คิว {doneOrder.queueNo} · {doneOrder.paymentMethod === 'cash' ? 'เงินสด' : 'เงินโอน'} · บิล {doneOrder.orderNo}</div>
                <div className="success-amount">{baht(doneOrder.total)}</div>
                {doneOrder.paymentMethod === 'cash' && doneOrder.change > 0 && <div className="change">เงินทอน <b>{baht(doneOrder.change)}</b></div>}
              </div>
            </div>
            <Receipt order={doneOrder} settings={cat.data?.settings} />
          </>
        )}
      </Modal>

      <Modal open={!!cancelQ} title={cancelQ ? `ยกเลิกคิว ${cancelQ.queueNo}` : ''} size="sm" onClose={() => setCancelQ(null)}
        footer={(
          <>
            <button className="btn btn-ghost" onClick={() => setCancelQ(null)}>ไม่ยกเลิก</button>
            <button className="btn btn-danger" onClick={doCancel}>ยืนยันยกเลิกคิว</button>
          </>
        )}>
        <p>คิวของ <b>{cancelQ?.name}</b> ({baht(cancelQ?.total)}) จะถูกยกเลิก และไม่ถูกนับเป็นยอดขาย</p>
        <Field label="เหตุผล">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ลูกค้าไม่มารับ" />
        </Field>
      </Modal>

      <HowToModal line={howToLine} catalog={cat.data} onClose={() => setHowToLine(null)} />
    </div>
  );
}
