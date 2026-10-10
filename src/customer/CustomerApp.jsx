// Public, no-login pages for customers: /order (scan QR → order) and /order/q/:token (track my queue).
import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { priceLine, summarize } from '../../shared/pricing.js';
import { baht, sweetLabel, sweetDesc, promptPayPayload } from '../utils.js';
import { Empty, Icon, Loading, Modal } from '../components/ui.jsx';
import { MenuThumb, resizeToDataUrl } from '../components/MenuImage.jsx';
import ContactBar from '../components/Contacts.jsx';

const CART_KEY = 'ma_order_cart';
const MY_QUEUES_KEY = 'ma_my_queues';

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
  },
};

async function publicApi(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api/public${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('เชื่อมต่อไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
  return data;
}

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const go = (p) => {
    window.history.pushState({}, '', p);
    setPath(p);
    window.scrollTo(0, 0);
  };
  return [path, go];
}

export default function CustomerApp() {
  const [path, go] = usePath();
  const m = path.match(/^\/order\/q\/([a-f0-9]+)/);
  return (
    <div className="cx">
      {m ? <TrackQueue token={m[1]} go={go} /> : <OrderFlow go={go} />}
    </div>
  );
}

function ShopHeader({ name, children }) {
  return (
    <header className="cx-head">
      <img src="/icon.svg" alt="" width="36" height="36" />
      <div className="cx-head-main">
        <div className="cx-shop">{name || 'MA Coffee'}</div>
        <div className="cx-sub">{children}</div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- ordering
const STEPS = ['ชื่อ', 'เลือกเมนู', 'สรุปยอด'];

function OrderFlow({ go }) {
  const [menu, setMenu] = useState(null);
  const [err, setErr] = useState('');
  const saved = store.get(CART_KEY, {});
  const [name, setName] = useState(saved.name || '');
  const [cart, setCart] = useState(saved.cart || []);
  const [step, setStep] = useState(saved.name ? (saved.cart?.length ? 2 : 1) : 0);
  const [cat, setCat] = useState(null);
  const [picking, setPicking] = useState(null); // menu item being customised
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const myQueues = store.get(MY_QUEUES_KEY, []).filter((q) => Date.now() - q.at < 12 * 3600 * 1000);

  useEffect(() => {
    publicApi('/menu').then((m) => { setMenu(m); setCat(m.categories[0]?.id || null); }).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => { store.set(CART_KEY, { name, cart }); }, [name, cart]);

  const catalog = useMemo(() => menu && { ...menu, discounts: [], ingredients: [] }, [menu]);
  const lines = useMemo(() => (catalog ? cart.map((c) => { try { return priceLine(c, catalog); } catch { return null; } }).filter(Boolean) : []), [cart, catalog]);
  const totals = summarize(lines);

  if (err) return <div className="cx-body"><Empty icon="alert" title="เปิดเมนูไม่ได้">{err}</Empty></div>;
  if (!menu) return <div className="cx-body"><Loading /></div>;

  if (!menu.open) {
    return (
      <>
        <ShopHeader name={menu.shop.name}>สั่งเครื่องดื่มออนไลน์</ShopHeader>
        <div className="cx-body">
          <Empty icon="ban" title="ร้านปิดรับออเดอร์ออนไลน์ชั่วคราว">{menu.message || 'กรุณาสั่งกับพนักงานที่หน้าร้านได้เลยค่ะ'}</Empty>
          <MyQueues list={myQueues} go={go} />
        </div>
      </>
    );
  }

  const submit = async () => {
    setBusy(true);
    try {
      const r = await publicApi('/orders', { method: 'POST', body: { name, items: cart } });
      store.set(MY_QUEUES_KEY, [{ token: r.token, queueNo: r.queueNo, at: Date.now() }, ...myQueues].slice(0, 5));
      setCart([]);
      setConfirmOpen(false);
      go(`/order/q/${r.token}`);
    } catch (e) {
      setErr(e.message);
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ShopHeader name={menu.shop.name}>สั่งเองได้เลย · ชำระเงินที่หน้าร้าน</ShopHeader>
      <ol className="cx-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'current' : i < step ? 'done' : ''}>
            <span>{i < step ? <Icon name="check" size={12} stroke={3} /> : i + 1}</span>{s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="cx-body">
          <h1 className="cx-title">สวัสดีค่ะ 👋</h1>
          <p className="muted">กรอกชื่อของคุณ เพื่อให้พนักงานเรียกเมื่อเครื่องดื่มพร้อม</p>
          <form className="cx-name" onSubmit={(e) => { e.preventDefault(); if (name.trim()) setStep(1); }}>
            <input className="input input-lg" value={name} maxLength={40} placeholder="ชื่อ หรือ ชื่อเล่น" autoFocus
              onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-primary btn-lg btn-block" disabled={!name.trim()}>เริ่มสั่งเครื่องดื่ม <Icon name="next" /></button>
          </form>
          <MyQueues list={myQueues} go={go} />
        </div>
      )}

      {step === 1 && (
        <div className="cx-body cx-body-menu">
          <div className="cx-hello">สวัสดีคุณ <b>{name}</b> <button className="link-btn small" onClick={() => setStep(0)}>(แก้ชื่อ)</button></div>
          <div className="chips chips-scroll cx-cats">
            {menu.categories.map((c) => (
              <button key={c.id} className={`chip ${cat === c.id ? 'active' : ''}`} onClick={() => setCat(c.id)}>{c.icon} {c.name}</button>
            ))}
          </div>
          <div className="cx-grid">
            {menu.menuItems.filter((m) => m.categoryId === cat).map((m) => {
              const inCart = cart.filter((c) => c.menuItemId === m.id).reduce((s, c) => s + c.qty, 0);
              return (
                <button key={m.id} className="cx-item" onClick={() => setPicking(m)}>
                  <MenuThumb item={m} icon={menu.categories.find((c) => c.id === m.categoryId)?.icon} className="cx-item-img" />
                  {inCart > 0 && <span className="cx-item-count">{inCart}</span>}
                  <span className="cx-item-name">{m.name}</span>
                  <span className="cx-item-price">{baht(m.price)}</span>
                </button>
              );
            })}
          </div>
          {!menu.menuItems.some((m) => m.categoryId === cat) && <Empty icon="products" title="ยังไม่มีเมนูในหมวดนี้" />}
        </div>
      )}

      {step === 2 && (
        <div className="cx-body">
          <h2 className="cx-title">สรุปรายการ</h2>
          {lines.length ? (
            <div className="cx-lines">
              {lines.map((l, i) => (
                <div key={i} className="cx-line">
                  <div className="cx-line-main">
                    <b>{l.name}</b>
                    <div className="muted small">{[sweetLabel(l.sweetness), ...l.toppings.map((t) => `+${t.name}${t.price ? ` ${baht(t.price)}` : ''}`)].filter(Boolean).join(' · ')}</div>
                    {l.note && <div className="line-note">หมายเหตุ: {l.note}</div>}
                  </div>
                  <div className="cx-line-side">
                    <b>{baht(l.total)}</b>
                    <div className="qty">
                      <button className="icon-btn" aria-label="ลดจำนวน"
                        onClick={() => setCart((c) => (l.qty <= 1 ? c.filter((_, j) => j !== i) : c.map((x, j) => (j === i ? { ...x, qty: x.qty - 1 } : x))))}>
                        <Icon name={l.qty <= 1 ? 'trash' : 'minus'} size={18} />
                      </button>
                      <span>{l.qty}</span>
                      <button className="icon-btn" aria-label="เพิ่มจำนวน" onClick={() => setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))}>
                        <Icon name="plus" size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty icon="cart" title="ยังไม่มีรายการ" />}
          <div className="due">
            <span>ยอดที่ต้องชำระ<br /><small>ชำระที่หน้าร้านเมื่อรับเครื่องดื่ม</small></span>
            <b>{baht(totals.total)}</b>
          </div>
          <div className="cx-actions">
            <button className="btn btn-outline btn-lg" onClick={() => setStep(1)}><Icon name="plus" /> สั่งเพิ่ม</button>
            <button className="btn btn-primary btn-lg" disabled={!lines.length} onClick={() => setConfirmOpen(true)}>ยืนยันการสั่ง</button>
          </div>
        </div>
      )}

      {step === 1 && cart.length > 0 && (
        <div className="cx-cartbar">
          <button className="btn btn-primary btn-lg btn-block" onClick={() => setStep(2)}>
            <span className="cx-cartbar-count">{totals.cups}</span> ดูตะกร้า · {baht(totals.total)} <Icon name="next" />
          </button>
        </div>
      )}

      <ItemSheet item={picking} menu={menu} onClose={() => setPicking(null)}
        onAdd={(entry) => { setCart((c) => [...c, entry]); setPicking(null); }} />

      <Modal open={confirmOpen} title="ยืนยันการสั่ง" size="sm" onClose={busy ? undefined : () => setConfirmOpen(false)}
        footer={(
          <>
            <button className="btn btn-ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>กลับไปแก้ไข</button>
            <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'กำลังส่ง...' : 'ยืนยัน สั่งเลย'}</button>
          </>
        )}>
        <p>สั่ง <b>{totals.cups} แก้ว</b> ในชื่อ <b>{name}</b></p>
        <div className="sum-row sum-total"><span>ยอดที่ต้องชำระที่หน้าร้าน</span><span>{baht(totals.total)}</span></div>
      </Modal>
    </>
  );
}

function ItemSheet({ item, menu, onClose, onAdd }) {
  const levels = menu.sweetnessLevels || [];
  const [sweetness, setSweetness] = useState(null);
  const [toppingIds, setToppingIds] = useState([]);
  const [note, setNote] = useState('');
  const [qty, setQty] = useState(1);
  useEffect(() => {
    if (item) {
      setSweetness(levels.includes(100) ? 100 : levels[levels.length - 1] ?? null);
      setToppingIds([]);
      setNote('');
      setQty(1);
    }
  }, [item]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return null;
  const unit = item.price + toppingIds.reduce((s, id) => s + (menu.toppings.find((t) => t.id === id)?.price || 0), 0);
  return (
    <Modal open title={item.name} onClose={onClose}
      footer={(
        <button className="btn btn-primary btn-lg btn-block" onClick={() => onAdd({ menuItemId: item.id, sweetness, toppingIds, discountIds: [], note: note.trim(), qty })}>
          เพิ่มลงตะกร้า · {baht(unit * qty)}
        </button>
      )}>
      {item.imageUrl && <img className="cx-sheet-img" src={item.imageUrl} alt="" />}
      {levels.length > 0 && (
        <section>
          <h4 className="cx-h">ความหวาน</h4>
          {/* Same tiles as the staff POS (step 4). */}
          <div className="grid cx-sweet" style={{ gridTemplateColumns: `repeat(${Math.min(levels.length, 5)}, minmax(0, 1fr))` }}>
            {levels.map((lv) => (
              <button key={lv} className={`tile tile-sweet ${sweetness === lv ? 'selected' : ''}`} onClick={() => setSweetness(lv)}>
                <span className="sweet-meter"><span style={{ height: `${Math.min(100, lv)}%` }} /></span>
                <span className="tile-name">{lv}%</span>
                <span className="muted small">{sweetDesc(lv)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {menu.toppings.length > 0 && (
        <section>
          <h4 className="cx-h">เพิ่มท็อปปิ้ง <span className="muted small">(ไม่บังคับ)</span></h4>
          <div className="cx-opts">
            {menu.toppings.map((t) => {
              const on = toppingIds.includes(t.id);
              return (
                <label key={t.id} className={`perm-item ${on ? 'on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => setToppingIds((x) => (on ? x.filter((y) => y !== t.id) : [...x, t.id]))} />
                  <span className="check-box">{on && <Icon name="check" size={14} stroke={3} />}</span>
                  <span className="cx-opt-name">{t.name}</span>
                  <span className="muted">{t.price ? `+${baht(t.price)}` : 'ฟรี'}</span>
                </label>
              );
            })}
          </div>
        </section>
      )}
      <section>
        <h4 className="cx-h">หมายเหตุ</h4>
        <input className="input" value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} placeholder="เช่น น้ำแข็งน้อย" />
      </section>
      <div className="qty-row">
        <span>จำนวน</span>
        <div className="qty">
          <button className="icon-btn" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="ลดจำนวน"><Icon name="minus" /></button>
          <span>{qty}</span>
          <button className="icon-btn" onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label="เพิ่มจำนวน"><Icon name="plus" /></button>
        </div>
      </div>
    </Modal>
  );
}

function MyQueues({ list, go }) {
  if (!list.length) return null;
  return (
    <div className="cx-myq">
      <div className="muted small">คิวของฉันวันนี้</div>
      {list.map((q) => (
        <button key={q.token} className="list-item" onClick={() => go(`/order/q/${q.token}`)}>
          <span className="queue-no queue-no-sm">{q.queueNo}</span>
          <span className="list-item-main"><b>ดูสถานะคิว #{q.queueNo}</b></span>
          <Icon name="next" />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- tracking
const STATUS_TEXT = {
  waiting: { title: 'รอทำเครื่องดื่ม', cls: 'waiting' },
  done: { title: 'เครื่องดื่มพร้อมแล้ว!', cls: 'done' },
  paid: { title: 'ชำระเงินเรียบร้อย', cls: 'paid' },
  cancelled: { title: 'คิวนี้ถูกยกเลิก', cls: 'cancelled' },
};

function TrackQueue({ token, go }) {
  const [q, setQ] = useState(null);
  const [err, setErr] = useState('');
  const [live, setLive] = useState(false);

  useEffect(() => {
    let alive = true;
    let lastStatus = null;
    const load = () => publicApi(`/queues/${token}`).then((r) => {
      if (!alive) return;
      if (lastStatus && lastStatus !== r.status && r.status === 'done' && navigator.vibrate) navigator.vibrate([200, 100, 200]);
      lastStatus = r.status;
      setQ(r);
      setErr('');
    }).catch((e) => alive && setErr(e.message));
    load();
    // Realtime: the shop's queue changes push an event; we refetch our own queue.
    let es = null;
    const open = () => {
      if (typeof EventSource === 'undefined') return;
      es = new EventSource('/api/public/events');
      es.addEventListener('hello', () => { setLive(true); load(); });
      es.addEventListener('queues', load);
      es.onerror = () => setLive(false);
    };
    open();
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      load();
      if (!es || es.readyState === EventSource.CLOSED) open();
    };
    document.addEventListener('visibilitychange', onVis);
    const poll = setInterval(load, 30000);
    return () => {
      alive = false;
      es?.close();
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [token]);

  if (err && !q) {
    return (
      <div className="cx-body">
        <Empty icon="alert" title="ไม่พบคิว">{err}</Empty>
        <button className="btn btn-primary btn-block" onClick={() => go('/order')}>สั่งเครื่องดื่ม</button>
      </div>
    );
  }
  if (!q) return <div className="cx-body"><Loading /></div>;
  const st = STATUS_TEXT[q.status];

  return (
    <>
      <ShopHeader name={q.shop.name}>
        <span className={`live ${live ? 'on' : ''}`}><span className="live-dot" /> {live ? 'อัปเดตอัตโนมัติ' : 'กำลังเชื่อมต่อ...'}</span>
      </ShopHeader>
      <div className="cx-body">
        <div className={`cx-ticket cx-ticket-${st.cls}`}>
          <div className="cx-ticket-label">หมายเลขคิวของคุณ</div>
          <div className="cx-ticket-no">{q.queueNo}</div>
          <div className="cx-ticket-name">{q.name}</div>
          <div className="cx-ticket-status">{st.title}</div>
          {q.status === 'waiting' && (
            q.ahead > 0 ? (
              <div className="cx-ahead">
                <div><b className="cx-ahead-num">{q.ahead}</b> คิว</div>
                <div>จะถึงคิวของคุณ · ตอนนี้อยู่ลำดับที่ {q.position} จาก {q.waitingTotal}</div>
              </div>
            ) : <div className="cx-ahead"><b>ถึงคิวของคุณแล้ว</b> กำลังทำเครื่องดื่มให้ค่ะ ☕</div>
          )}
          {q.status === 'done' && <div className="cx-ahead">กรุณารับเครื่องดื่มที่หน้าร้าน และชำระเงิน <b>{baht(q.total)}</b></div>}
          {q.status === 'paid' && <div className="cx-ahead">ขอบคุณที่อุดหนุนค่ะ 🙏{q.orderNo ? ` · บิล ${q.orderNo}` : ''}</div>}
          {q.status === 'cancelled' && <div className="cx-ahead">หากมีข้อสงสัย กรุณาติดต่อพนักงาน</div>}
        </div>

        <h3 className="cx-h">รายการที่สั่ง</h3>
        <div className="cx-lines">
          {q.lines.map((l, i) => (
            <div key={i} className="cx-line">
              <div className="cx-line-main">
                <b>{l.qty} × {l.name}</b>
                <div className="muted small">{[sweetLabel(l.sweetness), ...l.toppings.map((t) => `+${t.name}`), ...l.discounts.map((d) => `${d.name} −${baht(d.amount)}`)].filter(Boolean).join(' · ')}</div>
                {l.note && <div className="line-note">หมายเหตุ: {l.note}</div>}
              </div>
              <b>{baht(l.total)}</b>
            </div>
          ))}
        </div>
        {q.status !== 'paid' && q.status !== 'cancelled' && (
          <PaySection token={token} q={q} onClaimed={() => publicApi(`/queues/${token}`).then(setQ).catch(() => {})} />
        )}
        <button className="btn btn-outline btn-lg btn-block cx-more" onClick={() => go('/order')}><Icon name="plus" /> สั่งเครื่องดื่มเพิ่ม</button>
        <p className="muted small cx-hint">เก็บหน้านี้ไว้เพื่อดูสถานะคิว หรือกลับมาที่ลิงก์เดิมได้ทุกเมื่อ</p>
        <ContactBar contacts={q.shop.contacts} phone={q.shop.phone} />
      </div>
    </>
  );
}

/** Pay by PromptPay QR (amount filled in), or at the counter. Customer can tell the shop they transferred, with a slip. */
function PaySection({ token, q, onClaimed }) {
  const [qr, setQr] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [slip, setSlip] = useState(null);
  const fileRef = useRef(null);
  const ppId = q.payment?.promptPayId;

  useEffect(() => {
    const payload = ppId && promptPayPayload(ppId, q.total);
    if (!payload || !(q.total > 0)) { setQr(null); return; }
    QRCode.toDataURL(payload, { margin: 2, width: 520 }).then(setQr).catch(() => setQr(null));
  }, [ppId, q.total]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ppId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  };
  const pickSlip = async (file) => {
    if (!file) return;
    setErr('');
    try {
      setSlip(await resizeToDataUrl(file, 1280));
    } catch (e) {
      setErr(e.message);
    }
  };
  const claim = async () => {
    setBusy(true);
    setErr('');
    try {
      await publicApi(`/queues/${token}/paid`, { method: 'POST', body: slip ? { slip } : {} });
      setSlip(null);
      onClaimed();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cx-pay">
      <div className="due"><span>ยอดที่ต้องชำระ</span><b>{baht(q.total)}</b></div>
      {qr ? (
        <div className="cx-pay-card">
          <div className="cx-pay-title"><Icon name="qr" size={18} /> โอนผ่าน QR พร้อมเพย์</div>
          <img className="cx-pay-qr" src={qr} alt={`QR พร้อมเพย์ ${baht(q.total)}`} />
          <div className="cx-pay-amount">{baht(q.total)}</div>
          <div className="muted small">กดค้างที่รูป QR เพื่อบันทึก แล้วเปิดสแกนจากแอปธนาคาร</div>
          <div className="cx-pay-tools">
            <a className="btn btn-sm btn-outline" href={qr} download={`promptpay-queue-${q.queueNo}.png`}><Icon name="download" size={16} /> บันทึก QR</a>
            <button className="btn btn-sm btn-outline" onClick={copy}>{copied ? 'คัดลอกแล้ว ✓' : `คัดลอกเลข ${ppId}`}</button>
          </div>

          {q.payment.claimedAt ? (
            <div className="cx-claimed">
              <Icon name="check" size={18} stroke={3} /> แจ้งโอนแล้ว{q.payment.hasSlip ? ' (แนบสลิป)' : ''} · รอพนักงานตรวจสอบ
            </div>
          ) : (
            <div className="cx-claim">
              <div className="muted small">โอนเสร็จแล้ว แจ้งร้านได้เลย (แนบสลิปหรือไม่ก็ได้)</div>
              {slip && <img className="cx-slip" src={slip} alt="สลิป" />}
              <div className="cx-pay-tools">
                <button className="btn btn-sm btn-ghost" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={16} /> {slip ? 'เปลี่ยนสลิป' : 'แนบสลิป'}
                </button>
                <button className="btn btn-success" disabled={busy} onClick={claim}>{busy ? 'กำลังแจ้ง...' : 'แจ้งโอนแล้ว'}</button>
              </div>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pickSlip(e.target.files[0]); e.target.value = ''; }} />
            </div>
          )}
          {err && <div className="field-error">{err}</div>}
        </div>
      ) : null}
      <div className="muted small cx-hint">{qr ? 'หรือชำระด้วยเงินสด / สแกนที่หน้าร้านก็ได้' : 'ชำระเงินที่หน้าร้านเมื่อรับเครื่องดื่ม'}</div>
    </section>
  );
}

