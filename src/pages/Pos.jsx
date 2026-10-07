import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { priceLine, summarize } from '../../shared/pricing.js';
import { baht, discountLabel, sweetLabel, initial } from '../utils.js';
import { Icon, Modal, Field, Loading, ErrorBox, Empty, useAsync, useUi } from '../components/ui.jsx';
import Receipt, { LineDetail, printReceipt } from '../components/Receipt.jsx';
import PaymentModal from '../components/PaymentModal.jsx';
import HowToModal from '../components/HowTo.jsx';

const STEPS = ['ลูกค้า', 'ประเภท', 'เมนู', 'ความหวาน', 'ท็อปปิ้ง', 'ส่วนลด', 'สรุปรายการ', 'ชำระเงิน'];
const CART_KEY = 'ma_pos_cart';

const emptyDraft = () => ({ categoryId: null, menuItemId: null, sweetness: null, toppingIds: [], discountIds: [], note: '', qty: 1, editIndex: null });
const emptyCustomer = () => ({ type: null, id: null, name: '', phone: '', lineId: '' });

function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(CART_KEY) || 'null');
    if (s && Array.isArray(s.cart)) return s;
  } catch { /* ignore */ }
  return null;
}

export default function Pos({ go }) {
  const { toast, confirm } = useUi();
  const cat = useAsync(() => api('/catalog'), []);
  const saved = useMemo(loadSaved, []);
  const [step, setStep] = useState(saved?.step && saved.cart.length ? Math.min(saved.step, 7) : 1);
  const [customer, setCustomer] = useState(saved?.customer || emptyCustomer());
  const [cart, setCart] = useState(saved?.cart || []);
  const [draft, setDraft] = useState(emptyDraft());
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [doneOrder, setDoneOrder] = useState(null);
  const [howToLine, setHowToLine] = useState(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [doneQueue, setDoneQueue] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify({ step, customer, cart }));
    } catch { /* ignore */ }
  }, [step, customer, cart]);

  const catalog = useMemo(() => {
    if (!cat.data) return null;
    const d = cat.data;
    return {
      ...d,
      activeCategories: d.categories.filter((c) => c.active),
      activeItems: d.menuItems.filter((m) => m.active),
      activeToppings: d.toppings.filter((t) => t.active),
      activeDiscounts: d.discounts.filter((x) => x.active),
    };
  }, [cat.data]);

  // Price every cart line against the current catalog; drop lines whose menu was removed.
  const lines = useMemo(() => {
    if (!catalog) return [];
    return cart.map((c) => {
      try {
        return priceLine(c, catalog);
      } catch {
        return null;
      }
    }).filter(Boolean);
  }, [cart, catalog]);
  const totals = summarize(lines);

  const draftLine = useMemo(() => {
    if (!catalog || !draft.menuItemId) return null;
    try {
      return priceLine(draft, catalog);
    } catch {
      return null;
    }
  }, [draft, catalog]);

  if (cat.loading && !cat.data) return <Loading />;
  if (cat.error) return <ErrorBox error={cat.error} onRetry={cat.reload} />;

  const levels = catalog.settings.sweetnessLevels || [25, 50, 75, 100];

  const startNewItem = () => {
    setDraft(emptyDraft());
    setStep(2);
  };

  const commitDraft = () => {
    const entry = {
      menuItemId: draft.menuItemId, sweetness: draft.sweetness, toppingIds: draft.toppingIds,
      discountIds: draft.discountIds, note: draft.note.trim(), qty: draft.qty,
    };
    if (draft.editIndex != null) {
      setCart((c) => c.map((x, i) => (i === draft.editIndex ? entry : x)));
      toast('แก้ไขรายการแล้ว');
    } else {
      setCart((c) => [...c, entry]);
      toast('เพิ่มลงรายการแล้ว');
    }
    setDraft(emptyDraft());
    setStep(7);
  };

  const editLine = (i) => {
    const c = cart[i];
    const item = catalog.menuItems.find((m) => m.id === c.menuItemId);
    setDraft({ ...emptyDraft(), ...c, categoryId: item?.categoryId || null, editIndex: i });
    setStep(3);
  };

  const resetAll = () => {
    setCart([]);
    setCustomer(emptyCustomer());
    setDraft(emptyDraft());
    setStep(1);
  };

  const cancelOrder = async () => {
    if (!cart.length && !customer.type) return resetAll();
    if (await confirm({ title: 'ยกเลิกบิลนี้?', message: 'รายการทั้งหมดในบิลนี้จะถูกล้าง', okText: 'ล้างบิล', danger: true })) resetAll();
  };

  const back = () => {
    if (step === 2) setStep(cart.length ? 7 : 1);
    else if (step === 3 && draft.editIndex != null) { setDraft(emptyDraft()); setStep(7); }
    else setStep((s) => Math.max(1, s - 1));
  };

  const pay = async ({ method, cashReceived }) => {
    const body = {
      customer: customer.type === 'old'
        ? { type: 'old', id: customer.id }
        : { type: 'new', name: customer.name, phone: customer.phone, lineId: customer.lineId },
      items: cart,
      paymentMethod: method,
      cashReceived: method === 'cash' ? cashReceived : undefined,
    };
    const order = await api('/orders', { method: 'POST', body });
    setPayOpen(false);
    setDoneOrder(order);
    resetAll();
  };

  // Sell now, pay later: park the bill in the queue (customer name is not saved as a customer record).
  const addToQueue = async ({ name, note }) => {
    const q = await api('/queues', {
      method: 'POST',
      body: { name, note, items: cart, customer: customer.type === 'old' ? { type: 'old', id: customer.id } : null },
    });
    window.dispatchEvent(new Event('pos:queues-changed'));
    setQueueOpen(false);
    setDoneQueue(q);
    resetAll();
  };

  const selectedItem = draft.menuItemId && catalog.menuItems.find((m) => m.id === draft.menuItemId);
  const showSide = step >= 2 && step <= 6;

  return (
    <div className={`pos ${showSide ? 'pos-with-side' : ''}`}>
      <div className="pos-main">
        <Stepper step={step} />

        <div className="pos-toolbar">
          {step > 1 ? (
            <button className="btn btn-ghost" onClick={back}><Icon name="back" /> ย้อนกลับ</button>
          ) : <span />}
          <div className="pos-toolbar-right">
            {customer.type && (
              <span className="pill pill-customer">
                <Icon name="user" size={14} /> {customer.type === 'old' ? customer.name : (customer.name || 'ลูกค้าใหม่')}
              </span>
            )}
            {(cart.length > 0 || customer.type) && (
              <button className="btn btn-ghost btn-danger-text" onClick={cancelOrder}><Icon name="trash" size={18} /> ล้างบิล</button>
            )}
          </div>
        </div>

        {step >= 3 && step <= 6 && selectedItem && (
          <div className="draft-bar">
            <div>
              <b>{selectedItem.name}</b>
              {draft.sweetness != null && <span className="muted"> · {sweetLabel(draft.sweetness)}</span>}
              {draft.toppingIds.length > 0 && (
                <span className="muted"> · {draft.toppingIds.map((id) => catalog.toppings.find((t) => t.id === id)?.name).filter(Boolean).join(', ')}</span>
              )}
            </div>
            {draftLine && <b className="draft-price">{baht(draftLine.total)}</b>}
          </div>
        )}

        {step === 1 && (
          <StepCustomer customer={customer} setCustomer={setCustomer} onNext={() => setStep(cart.length ? 7 : 2)} />
        )}

        {step === 2 && (
          <section>
            <h2 className="step-title">เลือกประเภทเมนู</h2>
            <div className="grid grid-cats">
              {catalog.activeCategories.map((c) => (
                <button key={c.id} className={`tile tile-cat ${draft.categoryId === c.id ? 'selected' : ''}`}
                  onClick={() => { setDraft((d) => ({ ...d, categoryId: c.id })); setStep(3); }}>
                  <span className="tile-emoji">{c.icon}</span>
                  <span className="tile-name">{c.name}</span>
                  <span className="muted small">{catalog.activeItems.filter((m) => m.categoryId === c.id).length} เมนู</span>
                </button>
              ))}
            </div>
            {!catalog.activeCategories.length && <Empty title="ยังไม่มีประเภทเมนู">เพิ่มได้ที่เมนู “เมนู & ราคา”</Empty>}
          </section>
        )}

        {step === 3 && (
          <section>
            <h2 className="step-title">เลือกเมนู</h2>
            <div className="chips chips-scroll">
              {catalog.activeCategories.map((c) => (
                <button key={c.id} className={`chip ${draft.categoryId === c.id ? 'active' : ''}`}
                  onClick={() => setDraft((d) => ({ ...d, categoryId: c.id }))}>
                  {c.icon} {c.name}
                </button>
              ))}
            </div>
            <div className="grid grid-items">
              {catalog.activeItems.filter((m) => m.categoryId === draft.categoryId).map((m) => (
                <button key={m.id} className={`tile tile-item ${draft.menuItemId === m.id ? 'selected' : ''}`}
                  onClick={() => {
                    setDraft((d) => ({ ...d, menuItemId: m.id }));
                    setStep(4);
                  }}>
                  <span className="tile-name">{m.name}</span>
                  <span className="tile-price">{baht(m.price)}</span>
                </button>
              ))}
            </div>
            {!catalog.activeItems.some((m) => m.categoryId === draft.categoryId) && <Empty title="ไม่มีเมนูในประเภทนี้" />}
          </section>
        )}

        {step === 4 && (
          <section>
            <h2 className="step-title">เลือกระดับความหวาน</h2>
            <div className="grid grid-sweet">
              {levels.map((lv) => (
                <button key={lv} className={`tile tile-sweet ${draft.sweetness === lv ? 'selected' : ''}`}
                  onClick={() => { setDraft((d) => ({ ...d, sweetness: lv })); setStep(5); }}>
                  <span className="sweet-meter"><span style={{ height: `${Math.min(100, lv)}%` }} /></span>
                  <span className="tile-name">{lv}%</span>
                  <span className="muted small">{lv === 0 ? 'ไม่หวาน' : lv <= 25 ? 'หวานน้อย' : lv <= 50 ? 'หวานกลาง' : lv <= 75 ? 'หวานมาก' : 'หวานปกติ'}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 5 && (
          <section>
            <h2 className="step-title">เลือกท็อปปิ้ง <span className="muted small">(เลือกได้หลายอย่าง)</span></h2>
            <div className="grid grid-items">
              {catalog.activeToppings.map((t) => {
                const on = draft.toppingIds.includes(t.id);
                return (
                  <button key={t.id} className={`tile tile-check ${on ? 'selected' : ''}`}
                    onClick={() => setDraft((d) => ({ ...d, toppingIds: on ? d.toppingIds.filter((x) => x !== t.id) : [...d.toppingIds, t.id] }))}>
                    <span className="check-box">{on && <Icon name="check" size={16} stroke={3} />}</span>
                    <span className="tile-name">{t.name}</span>
                    <span className="tile-price">+{baht(t.price)}</span>
                  </button>
                );
              })}
            </div>
            <Field label="หมายเหตุ (ถ้ามี)">
              <input className="input" placeholder="เช่น น้ำแข็งน้อย, แยกน้ำแข็ง" value={draft.note}
                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
            </Field>
            <div className="step-actions">
              <button className="btn btn-primary btn-lg" onClick={() => setStep(6)}>
                {draft.toppingIds.length ? `ถัดไป (${draft.toppingIds.length} ท็อปปิ้ง)` : 'ไม่ใส่ท็อปปิ้ง / ถัดไป'} <Icon name="next" />
              </button>
            </div>
          </section>
        )}

        {step === 6 && draftLine && (
          <section>
            <h2 className="step-title">ส่วนลด / สิทธิพิเศษ <span className="muted small">(ถ้ามี)</span></h2>
            <div className="grid grid-items">
              {catalog.activeDiscounts.map((dc) => {
                const on = draft.discountIds.includes(dc.id);
                return (
                  <button key={dc.id} className={`tile tile-check ${on ? 'selected' : ''}`}
                    onClick={() => setDraft((d) => ({ ...d, discountIds: on ? d.discountIds.filter((x) => x !== dc.id) : [...d.discountIds, dc.id] }))}>
                    <span className="check-box">{on && <Icon name="check" size={16} stroke={3} />}</span>
                    <span className="tile-name">{dc.name}</span>
                    <span className="tile-price tile-price-discount">{discountLabel(dc)}</span>
                  </button>
                );
              })}
            </div>
            {!catalog.activeDiscounts.length && <p className="muted">ยังไม่มีส่วนลดที่เปิดใช้งาน</p>}

            <div className="card draft-summary">
              <div className="qty-row">
                <span>จำนวน</span>
                <Qty value={draft.qty} onChange={(q) => setDraft((d) => ({ ...d, qty: q }))} />
              </div>
              <div className="sum-row"><span>{draftLine.name} ({baht(draftLine.unitPrice)} × {draftLine.qty})</span><span>{baht(draftLine.gross)}</span></div>
              {draftLine.discounts.map((d) => (
                <div key={d.id} className="sum-row text-discount"><span>{d.name}</span><span>−{baht(d.amount)}</span></div>
              ))}
              <div className="sum-row sum-total"><span>รวมรายการนี้</span><span>{baht(draftLine.total)}</span></div>
            </div>
            <div className="step-actions">
              <button className="btn btn-primary btn-lg" onClick={commitDraft}>
                <Icon name={draft.editIndex != null ? 'check' : 'plus'} /> {draft.editIndex != null ? 'บันทึกการแก้ไข' : 'เพิ่มลงรายการ'}
              </button>
            </div>
          </section>
        )}

        {step === 7 && (
          <section>
            <h2 className="step-title">สรุปรายการ</h2>
            {lines.length ? (
              <CartList lines={lines} onEdit={editLine} onHowTo={setHowToLine}
                onQty={(i, q) => setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: q } : x)))}
                onRemove={async (i) => {
                  if (await confirm({ message: `ลบ “${lines[i].name}” ออกจากรายการ?`, okText: 'ลบ', danger: true })) {
                    setCart((c) => c.filter((_, j) => j !== i));
                  }
                }} />
            ) : <Empty title="ยังไม่มีรายการ">กด “เพิ่มเมนู” เพื่อเริ่มเลือกเครื่องดื่ม</Empty>}
            <Totals totals={totals} />
            <div className="step-actions step-actions-split">
              <button className="btn btn-outline btn-lg" onClick={startNewItem}><Icon name="plus" /> เพิ่มเมนู</button>
              <button className="btn btn-primary btn-lg" disabled={!lines.length} onClick={() => setCheckoutOpen(true)}>
                ไปหน้าชำระเงิน <Icon name="next" />
              </button>
            </div>
          </section>
        )}

        {step === 8 && (
          <section>
            <h2 className="step-title">ชำระเงิน</h2>
            <div className="card">
              <div className="sum-row"><span className="muted">ลูกค้า</span>
                <b>{customer.type === 'old' ? customer.name : (customer.name || 'ลูกค้าทั่วไป')} {customer.type === 'new' && <span className="badge">ใหม่</span>}</b>
              </div>
              {customer.phone && <div className="sum-row"><span className="muted">เบอร์โทร</span><span>{customer.phone}</span></div>}
            </div>
            <CartList lines={lines} readOnly onHowTo={setHowToLine} />
            <Totals totals={totals} />
            <div className="due">
              <span>ยอดที่ลูกค้าต้องชำระ</span>
              <b>{baht(totals.total)}</b>
            </div>
            <div className="step-actions step-actions-split">
              <button className="btn btn-outline btn-lg" onClick={() => setStep(7)}><Icon name="edit" /> แก้ไขรายการ</button>
              <button className="btn btn-outline btn-lg btn-queue" disabled={!lines.length} onClick={() => setQueueOpen(true)}>
                <Icon name="queue" /> เพิ่มไปที่คิว
              </button>
              <button className="btn btn-success btn-lg" disabled={!lines.length} onClick={() => setPayOpen(true)}>
                <Icon name="check" /> ยืนยันการชำระเงิน
              </button>
            </div>
          </section>
        )}
      </div>

      {showSide && (
        <aside className="pos-side card">
          <div className="pos-side-head">
            <Icon name="cart" /> รายการในบิล <span className="badge">{totals.cups} แก้ว</span>
          </div>
          {lines.length ? (
            <div className="pos-side-lines">
              {lines.map((l, i) => (
                <div key={i} className="side-line">
                  <div className="sum-row"><b>{l.qty} × {l.name}</b><span>{baht(l.total)}</span></div>
                  <LineDetail line={l} showPrice={false} />
                </div>
              ))}
            </div>
          ) : <p className="muted small">ยังไม่มีรายการ</p>}
          <div className="sum-row sum-total"><span>รวม</span><span>{baht(totals.total)}</span></div>
          {lines.length > 0 && <button className="btn btn-outline btn-block" onClick={() => { setDraft(emptyDraft()); setStep(7); }}>ดูสรุปรายการ</button>}
        </aside>
      )}

      {/* Step 7 -> 8 confirmation */}
      <Modal open={checkoutOpen} title="ยืนยันรายการก่อนชำระเงิน" onClose={() => setCheckoutOpen(false)}
        footer={(
          <>
            <button className="btn btn-ghost" onClick={() => setCheckoutOpen(false)}>กลับไปแก้ไข</button>
            <button className="btn btn-primary" onClick={() => { setCheckoutOpen(false); setStep(8); }}>ยืนยัน ไปหน้าชำระเงิน</button>
          </>
        )}>
        <CartList lines={lines} readOnly compact />
        <Totals totals={totals} />
      </Modal>

      <PaymentModal open={payOpen} total={totals.total} settings={catalog.settings} onClose={() => setPayOpen(false)} onPay={pay} />

      <HowToModal line={howToLine} catalog={catalog} onClose={() => setHowToLine(null)} />

      <AddQueueModal open={queueOpen} defaultName={customer.name} total={totals.total} cups={totals.cups}
        onClose={() => setQueueOpen(false)} onSubmit={addToQueue} />

      <Modal open={!!doneQueue} title="เพิ่มเข้าคิวแล้ว" size="sm" onClose={() => setDoneQueue(null)}
        footer={(
          <>
            <button className="btn btn-outline" onClick={() => { setDoneQueue(null); go('queue'); }}>ไปหน้าคิว</button>
            <button className="btn btn-primary" onClick={() => setDoneQueue(null)}>รับออเดอร์ถัดไป</button>
          </>
        )}>
        {doneQueue && (
          <div className="queue-ticket">
            <div className="muted">หมายเลขคิว</div>
            <div className="queue-ticket-no">{doneQueue.queueNo}</div>
            <div><b>{doneQueue.name}</b></div>
            <div className="muted small">{doneQueue.cups} แก้ว · {baht(doneQueue.total)} · ชำระเงินเมื่อรับสินค้า</div>
          </div>
        )}
      </Modal>

      <Modal open={!!doneOrder} title="ชำระเงินสำเร็จ" onClose={() => setDoneOrder(null)}
        footer={(
          <>
            <button className="btn btn-outline" onClick={printReceipt}><Icon name="print" /> พิมพ์ใบเสร็จ</button>
            <button className="btn btn-primary" onClick={() => setDoneOrder(null)}>ขายบิลถัดไป</button>
          </>
        )}>
        {doneOrder && (
          <>
            <div className="success-banner">
              <span className="success-icon"><Icon name="check" size={28} stroke={3} /></span>
              <div>
                <div className="muted">{doneOrder.paymentMethod === 'cash' ? 'เงินสด' : 'เงินโอน'} · บิล {doneOrder.orderNo}</div>
                <div className="success-amount">{baht(doneOrder.total)}</div>
                {doneOrder.paymentMethod === 'cash' && doneOrder.change > 0 && (
                  <div className="change">เงินทอน <b>{baht(doneOrder.change)}</b></div>
                )}
              </div>
            </div>
            <Receipt order={doneOrder} settings={catalog.settings} />
          </>
        )}
      </Modal>
    </div>
  );
}

function Stepper({ step }) {
  return (
    <div className="stepper" aria-label={`ขั้นตอนที่ ${step} จาก ${STEPS.length}`}>
      <div className="stepper-compact">
        <span>ขั้นตอน {step}/{STEPS.length}</span>
        <b>{STEPS[step - 1]}</b>
      </div>
      <div className="stepper-bar"><span style={{ width: `${(step / STEPS.length) * 100}%` }} /></div>
      <ol className="stepper-full">
        {STEPS.map((s, i) => (
          <li key={s} className={i + 1 === step ? 'current' : i + 1 < step ? 'done' : ''}>
            <span className="stepper-dot">{i + 1 < step ? <Icon name="check" size={12} stroke={3} /> : i + 1}</span>
            <span className="stepper-label">{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepCustomer({ customer, setCustomer, onNext }) {
  const [q, setQ] = useState('');
  const list = useAsync(() => (customer.type === 'old' ? api('/customers', { query: { q } }) : Promise.resolve([])), [customer.type, q]);

  return (
    <section>
      <h2 className="step-title">ลูกค้าใหม่ หรือ ลูกค้าเก่า?</h2>
      <div className="grid grid-2">
        <button className={`tile tile-big ${customer.type === 'new' ? 'selected' : ''}`}
          onClick={() => setCustomer({ type: 'new', id: null, name: '', phone: '', lineId: '' })}>
          <Icon name="userPlus" size={36} />
          <span className="tile-name">ลูกค้าใหม่</span>
          <span className="muted small">ลูกค้าที่มาครั้งแรก</span>
        </button>
        <button className={`tile tile-big ${customer.type === 'old' ? 'selected' : ''}`}
          onClick={() => setCustomer({ type: 'old', id: null, name: '', phone: '', lineId: '' })}>
          <Icon name="customers" size={36} />
          <span className="tile-name">ลูกค้าเก่า</span>
          <span className="muted small">ค้นหาจากชื่อ / เบอร์โทร</span>
        </button>
      </div>

      {customer.type === 'new' && (
        <div className="card form">
          <p className="muted small">ไม่บังคับกรอก — ถ้าเว้นว่างจะบันทึกเป็น “ลูกค้าทั่วไป” ถ้ากรอกชื่อจะบันทึกไว้เป็นลูกค้าเก่าในครั้งหน้า</p>
          <div className="form-grid">
            <Field label="ชื่อลูกค้า / ชื่อเล่น">
              <input className="input" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            </Field>
            <Field label="เบอร์โทร">
              <input className="input" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
            </Field>
            <Field label="LINE ID">
              <input className="input" value={customer.lineId} onChange={(e) => setCustomer({ ...customer, lineId: e.target.value })} />
            </Field>
          </div>
          <div className="step-actions">
            <button className="btn btn-primary btn-lg" onClick={onNext}>ถัดไป <Icon name="next" /></button>
          </div>
        </div>
      )}

      {customer.type === 'old' && (
        <div className="card">
          <div className="search">
            <Icon name="search" size={18} />
            <input className="input" placeholder="ค้นหาชื่อ เบอร์โทร หรือ LINE ID" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          {list.loading ? <Loading /> : (
            <div className="list">
              {(list.data || []).map((c) => (
                <button key={c.id} className={`list-item ${customer.id === c.id ? 'selected' : ''}`}
                  onClick={() => { setCustomer({ type: 'old', id: c.id, name: c.name, phone: c.phone, lineId: c.lineId }); onNext(); }}>
                  <div className="avatar avatar-sm">{initial(c.name)}</div>
                  <div className="list-item-main">
                    <b>{c.name}</b>
                    <span className="muted small">{[c.phone, c.lineId && `LINE: ${c.lineId}`].filter(Boolean).join(' · ') || '—'}</span>
                  </div>
                  <span className="muted small">มาแล้ว {c.visits || 0} ครั้ง</span>
                </button>
              ))}
              {!list.data?.length && <Empty icon="customers" title={q ? 'ไม่พบลูกค้า' : 'ยังไม่มีข้อมูลลูกค้า'}>ลองเลือก “ลูกค้าใหม่” แทน</Empty>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Qty({ value, onChange }) {
  return (
    <div className="qty">
      <button className="icon-btn" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} aria-label="ลดจำนวน"><Icon name="minus" /></button>
      <span>{value}</span>
      <button className="icon-btn" onClick={() => onChange(value + 1)} aria-label="เพิ่มจำนวน"><Icon name="plus" /></button>
    </div>
  );
}

function CartList({ lines, onEdit, onRemove, onQty, onHowTo, readOnly, compact }) {
  return (
    <div className={`cart ${compact ? 'cart-compact' : ''}`}>
      {lines.map((l, i) => (
        <div key={i} className="cart-line">
          <div className="cart-line-main">
            <div className="cart-line-title">
              <b>{readOnly ? `${l.qty} × ` : ''}{l.name}</b>
              <span className="muted small"> {baht(l.unitPrice)}/แก้ว</span>
            </div>
            <LineDetail line={l} />
            {onHowTo && (
              <button className="btn btn-sm btn-ghost btn-howto" onClick={() => onHowTo(l)}><Icon name="book" size={16} /> ดูวิธีทำ</button>
            )}
          </div>
          <div className="cart-line-side">
            <b>{baht(l.total)}</b>
            {l.discountTotal > 0 && <s className="muted small">{baht(l.gross)}</s>}
            {!readOnly && (
              <div className="cart-line-actions">
                <Qty value={l.qty} onChange={(q) => onQty(i, q)} />
                <button className="icon-btn" onClick={() => onEdit(i)} aria-label="แก้ไข"><Icon name="edit" size={18} /></button>
                <button className="icon-btn icon-btn-danger" onClick={() => onRemove(i)} aria-label="ลบ"><Icon name="trash" size={18} /></button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Totals({ totals }) {
  return (
    <div className="card totals">
      <div className="sum-row"><span>รวม ({totals.cups} แก้ว)</span><span>{baht(totals.gross)}</span></div>
      {totals.discountTotal > 0 && <div className="sum-row text-discount"><span>ส่วนลดรวม</span><span>−{baht(totals.discountTotal)}</span></div>}
      <div className="sum-row sum-total"><span>ยอดสุทธิ</span><span>{baht(totals.total)}</span></div>
    </div>
  );
}

function AddQueueModal({ open, defaultName, total, cups, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (open) { setName(defaultName || ''); setNote(''); setErr(''); }
  }, [open, defaultName]);
  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await onSubmit({ name: name.trim(), note: note.trim() });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} title="เพิ่มไปที่คิว" size="sm" onClose={busy ? undefined : onClose}
      footer={(
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'กำลังบันทึก...' : 'เพิ่มเข้าคิว'}</button>
        </>
      )}>
      <p className="muted small">ทำเมนูก่อน แล้วรับชำระเงินเมื่อลูกค้ารับสินค้าที่หน้า “คิว” — ชื่อนี้ใช้เรียกคิวเท่านั้น ไม่ถูกบันทึกเป็นข้อมูลลูกค้า</p>
      <Field label="ชื่อลูกค้า (สำหรับเรียกคิว)">
        <input className="input input-lg" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น พี่เสื้อแดง" autoFocus
          onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </Field>
      <Field label="หมายเหตุ (ถ้ามี)">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น รอที่โต๊ะ 3" />
      </Field>
      <div className="sum-row sum-total"><span>{cups} แก้ว</span><span>{baht(total)}</span></div>
      {err && <div className="field-error">{err}</div>}
    </Modal>
  );
}
