import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { priceLine, summarize, stampsEarned, rewardsAvailable, roastChoices, cleanCustomDiscount } from '../../shared/pricing.js';
import { baht, discountLabel, sweetLabel, sweetDesc, initial, APP_NAMES, payLabel } from '../utils.js';
import { Icon, Modal, Field, Loading, ErrorBox, Empty, NumberInput, useAsync, useUi } from '../components/ui.jsx';
import Receipt, { LineDetail, printReceipt } from '../components/Receipt.jsx';
import PaymentModal from '../components/PaymentModal.jsx';
import HowToModal from '../components/HowTo.jsx';
import { MenuThumb } from '../components/MenuImage.jsx';
import StampCard from '../components/StampCard.jsx';

const STEPS = ['ลูกค้า', 'ประเภท', 'เมนู', 'ความหวาน', 'ท็อปปิ้ง', 'ส่วนลด', 'สรุปรายการ', 'ชำระเงิน'];
const CART_KEY = 'ma_pos_cart';
const SELL_MODE_KEY = 'ma_pos_sell_mode';

const emptyDraft = () => ({ categoryId: null, menuItemId: null, sweetness: null, toppingIds: [], discountIds: [], customDiscount: null, note: '', qty: 1, rewardQty: 0, editIndex: null });
const emptyCustom = () => ({ name: '', type: 'percent', value: '' });
// type: new | old | app (delivery app order: app = grab | lineman, ref = the app's order number)
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
  // Where we are selling decides which menus show: the counter switch or the "sell outside" switch.
  const [sellMode, setSellMode] = useState(() => {
    try { return localStorage.getItem(SELL_MODE_KEY) === 'outside' ? 'outside' : 'counter'; } catch { return 'counter'; }
  });
  const changeSellMode = (m) => {
    setSellMode(m);
    try { localStorage.setItem(SELL_MODE_KEY, m); } catch { /* storage unavailable */ }
  };
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
  const [appBusy, setAppBusy] = useState(false);

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
      loyalty: d.settings.loyalty, // priceLine needs the free-cup cap
      activeCategories: d.categories.filter((c) => (sellMode === 'outside' ? c.activeOutside !== false : c.active)),
      activeItems: d.menuItems.filter((m) => (sellMode === 'outside' ? m.activeOutside !== false : m.active)),
      activeToppings: d.toppings.filter((t) => (sellMode === 'outside' ? t.activeOutside !== false : t.active)),
      activeDiscounts: d.discounts.filter((x) => x.active),
    };
  }, [cat.data, sellMode]);

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
  // Stamp card: free cups still available for this draft = earned rewards − rewards already used by other cart lines.
  const loyalty = catalog.settings.loyalty;
  const draftItem = draft.menuItemId && catalog.menuItems.find((m) => m.id === draft.menuItemId);
  // Coffee: one roast is required (roasts switched off for this sell mode show as sold out); others never see roasts.
  const roastAll = roastChoices(draftItem, catalog.categories, catalog.toppings);
  const roasts = roastAll.filter((t) => catalog.activeToppings.includes(t));
  const roastId = draft.toppingIds.find((id) => roasts.some((t) => t.id === id));
  const needRoast = roasts.length > 0 && !roastId;
  const extraToppings = catalog.activeToppings.filter((t) => !t.isRoast);
  // Custom discount typed at step 6: a value without a name can't be added.
  const cd = draft.customDiscount;
  const customMissingName = !!cd && Number(cd.value) > 0 && !cd.name.trim();
  const isApp = customer.type === 'app';
  const rewardExcluded = !draftItem || (loyalty?.excludeCategoryIds || []).includes(draftItem.categoryId);
  const rewardUsedElsewhere = cart.reduce((s, c, i) => s + (i === draft.editIndex ? 0 : c.rewardQty || 0), 0);
  const rewardRoom = customer.type === 'old' && loyalty?.enabled && !rewardExcluded
    ? Math.max(0, rewardsAvailable(customer.points, loyalty) - rewardUsedElsewhere - (draft.rewardQty || 0)) : 0;

  const startNewItem = () => {
    setDraft(emptyDraft());
    setStep(2);
  };

  const commitDraft = () => {
    const entry = {
      menuItemId: draft.menuItemId, sweetness: draft.sweetness,
      // a roast left over from another menu (e.g. switched coffee -> tea while editing) is dropped
      toppingIds: draft.toppingIds.filter((id) => roastAll.length || !catalog.toppings.find((t) => t.id === id)?.isRoast),
      discountIds: draft.discountIds, customDiscount: cleanCustomDiscount(draft.customDiscount),
      note: draft.note.trim(), qty: draft.qty, rewardQty: Math.min(draft.rewardQty || 0, draft.qty),
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
        : customer.type === 'app'
          ? { type: 'app', app: customer.app, ref: customer.ref }
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

  const recordAppOrder = async () => {
    setAppBusy(true);
    try {
      await pay({ method: 'app' });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setAppBusy(false);
    }
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
            <div className="type-switch sell-mode" role="group" aria-label="ขายที่">
              <button className={sellMode === 'counter' ? 'active' : ''} onClick={() => changeSellMode('counter')}>หน้าร้าน</button>
              <button className={sellMode === 'outside' ? 'active' : ''} onClick={() => changeSellMode('outside')}>นอกสถานที่</button>
            </div>
            {customer.type && (
              <span className="pill pill-customer">
                <Icon name="user" size={14} /> {customer.type === 'app' ? `${APP_NAMES[customer.app]}${customer.ref ? ` #${customer.ref}` : ''}` : customer.type === 'old' ? customer.name : (customer.name || 'ลูกค้าใหม่')}
                {customer.type === 'old' && customer.id && loyalty?.enabled && <span className="pill-stamps">☕ {customer.points || 0}</span>}
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
          <StepCustomer customer={customer} setCustomer={setCustomer} loyalty={catalog.settings.loyalty} onNext={() => setStep(cart.length ? 7 : 2)} />
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
                  <MenuThumb item={m} icon={catalog.categories.find((c) => c.id === m.categoryId)?.icon} className="tile-thumb" />
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
                  <span className="muted small">{sweetDesc(lv)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 5 && (
          <section>
            {roastAll.length > 0 && (
              <>
                <h2 className="step-title">เลือกระดับการคั่ว <span className="req-badge">ต้องเลือก 1</span></h2>
                <div className="grid grid-items roast-grid">
                  {roastAll.map((t) => {
                    const on = roastId === t.id;
                    const out = !roasts.includes(t);
                    return (
                      <button key={t.id} className={`tile tile-check ${on ? 'selected' : ''} ${out ? 'tile-out' : ''}`} disabled={out}
                        onClick={() => setDraft((d) => ({ ...d, toppingIds: [...d.toppingIds.filter((x) => !roastAll.some((r) => r.id === x)), t.id] }))}>
                        <span className="check-box check-radio">{on && <Icon name="check" size={16} stroke={3} />}</span>
                        <span className="tile-name">{t.name}</span>
                        <span className="tile-price">{out ? 'หมด' : t.price ? `+${baht(t.price)}` : ''}</span>
                      </button>
                    );
                  })}
                </div>
                {!roasts.length && <p className="muted small">เมล็ดทุกระดับคั่วปิดอยู่ — ขายต่อได้โดยไม่ต้องเลือก</p>}
              </>
            )}
            <h2 className="step-title">เลือกท็อปปิ้ง <span className="muted small">(เลือกได้หลายอย่าง)</span></h2>
            <div className="grid grid-items">
              {extraToppings.map((t) => {
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
              {needRoast && <span className="field-error">กรุณาเลือกระดับการคั่วก่อน</span>}
              <button className="btn btn-primary btn-lg" disabled={needRoast} onClick={() => setStep(6)}>
                {(() => {
                  const n = draft.toppingIds.filter((id) => !roastAll.some((r) => r.id === id)).length;
                  return n ? `ถัดไป (${n} ท็อปปิ้ง)` : 'ไม่ใส่ท็อปปิ้ง / ถัดไป';
                })()} <Icon name="next" />
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
            {rewardRoom > 0 || draft.rewardQty > 0 ? (
              <div className={`card reward-card ${draft.rewardQty ? 'on' : ''}`}>
                <div className="reward-main">
                  <b>🎁 ใช้แต้มสะสมแลกฟรี</b>
                  <span className="muted small">{customer.name} แลกได้อีก {rewardRoom} แก้ว · แก้วละไม่เกิน {baht(loyalty.rewardMaxValue)}</span>
                </div>
                <Qty min={0} max={Math.min(draft.qty, rewardRoom + (draft.rewardQty || 0))} value={draft.rewardQty || 0}
                  onChange={(v) => setDraft((d) => ({ ...d, rewardQty: v }))} />
              </div>
            ) : customer.type === 'old' && loyalty?.enabled && !rewardExcluded && (
              <p className="muted small">☕ {customer.name} มี {customer.points || 0} แต้ม — ครบ {loyalty.cupsPerReward} แก้วแลกฟรีได้</p>
            )}
            <CustomDiscount value={draft.customDiscount} missingName={customMissingName}
              onChange={(v) => setDraft((d) => ({ ...d, customDiscount: v }))} />

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
              <button className="btn btn-primary btn-lg" onClick={commitDraft} disabled={customMissingName}>
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
            <StampSummary customer={customer} loyalty={loyalty} lines={lines} />
            <div className="step-actions step-actions-split">
              <button className="btn btn-outline btn-lg" onClick={startNewItem}><Icon name="plus" /> เพิ่มเมนู</button>
              {!isApp && (
                <button className="btn btn-outline btn-lg btn-queue" disabled={!lines.length} onClick={() => setQueueOpen(true)}>
                  <Icon name="queue" /> เพิ่มเข้าคิว
                </button>
              )}
              <button className="btn btn-primary btn-lg" disabled={!lines.length} onClick={() => setCheckoutOpen(true)}>
                {isApp ? 'ไปหน้าบันทึกออเดอร์' : 'ไปหน้าชำระเงิน'} <Icon name="next" />
              </button>
            </div>
          </section>
        )}

        {step === 8 && (
          <section>
            <h2 className="step-title">ชำระเงิน</h2>
            <div className="card">
              {isApp ? (
                <div className="sum-row"><span className="muted">ขายในแอพ</span>
                  <b><span className={`app-badge app-${customer.app}`}>{APP_NAMES[customer.app]}</span>{customer.ref ? ` #${customer.ref}` : ''}</b>
                </div>
              ) : (
                <div className="sum-row"><span className="muted">ลูกค้า</span>
                  <b>{customer.type === 'old' ? customer.name : (customer.name || 'ลูกค้าทั่วไป')} {customer.type === 'new' && <span className="badge">ใหม่</span>}</b>
                </div>
              )}
              {customer.phone && <div className="sum-row"><span className="muted">เบอร์โทร</span><span>{customer.phone}</span></div>}
            </div>
            <CartList lines={lines} readOnly onHowTo={setHowToLine} />
            <Totals totals={totals} />
            <StampSummary customer={customer} loyalty={loyalty} lines={lines} />
            <div className="due">
              <span>{isApp ? `ยอดขายใน ${APP_NAMES[customer.app]} (ชำระผ่านแอพ)` : 'ยอดที่ลูกค้าต้องชำระ'}</span>
              <b>{baht(totals.total)}</b>
            </div>
            {isApp ? (
              <div className="step-actions step-actions-split">
                <button className="btn btn-outline btn-lg" onClick={() => setStep(7)}><Icon name="edit" /> แก้ไขรายการ</button>
                <button className="btn btn-success btn-lg" disabled={!lines.length || appBusy} onClick={recordAppOrder}>
                  <Icon name="check" /> {appBusy ? 'กำลังบันทึก...' : `บันทึกออเดอร์ ${APP_NAMES[customer.app]}`}
                </button>
              </div>
            ) : (
            <div className="step-actions step-actions-split">
              <button className="btn btn-outline btn-lg" onClick={() => setStep(7)}><Icon name="edit" /> แก้ไขรายการ</button>
              <button className="btn btn-outline btn-lg btn-queue" disabled={!lines.length} onClick={() => setQueueOpen(true)}>
                <Icon name="queue" /> เพิ่มไปที่คิว
              </button>
              <button className="btn btn-success btn-lg" disabled={!lines.length} onClick={() => setPayOpen(true)}>
                <Icon name="check" /> ยืนยันการชำระเงิน
              </button>
            </div>
            )}
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
            <button className="btn btn-primary" onClick={() => { setCheckoutOpen(false); setStep(8); }}>{isApp ? 'ยืนยัน ไปหน้าบันทึกออเดอร์' : 'ยืนยัน ไปหน้าชำระเงิน'}</button>
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

      <Modal open={!!doneOrder} title={doneOrder?.paymentMethod === 'app' ? 'บันทึกออเดอร์แล้ว' : 'ชำระเงินสำเร็จ'} onClose={() => setDoneOrder(null)}
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
                <div className="muted">{payLabel(doneOrder)}{doneOrder.appRef ? ` #${doneOrder.appRef}` : ''} · บิล {doneOrder.orderNo}</div>
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

function StepCustomer({ customer, setCustomer, onNext, loyalty }) {
  const [q, setQ] = useState('');
  const [appOpen, setAppOpen] = useState(false);
  const list = useAsync(() => (customer.type === 'old' ? api('/customers', { query: { q } }) : Promise.resolve([])), [customer.type, q]);

  return (
    <section>
      <h2 className="step-title">ลูกค้าใหม่ ลูกค้าเก่า หรือขายในแอพ?</h2>
      <div className="grid grid-3 grid-customer">
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
        <button className={`tile tile-big ${customer.type === 'app' ? 'selected' : ''}`} onClick={() => setAppOpen(true)}>
          <Icon name="queue" size={36} />
          <span className="tile-name">ขายในแอพ</span>
          <span className="muted small">{customer.type === 'app' ? `${APP_NAMES[customer.app]}${customer.ref ? ` #${customer.ref}` : ''}` : 'Grab / LINE MAN'}</span>
        </button>
      </div>
      <AppPicker open={appOpen} current={customer.type === 'app' ? customer : null} onClose={() => setAppOpen(false)}
        onPick={(app, ref) => { setAppOpen(false); setCustomer({ ...emptyCustomer(), type: 'app', app, ref, name: APP_NAMES[app] }); onNext(); }} />

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
                  onClick={() => { setCustomer({ type: 'old', id: c.id, name: c.name, phone: c.phone, lineId: c.lineId, points: c.points || 0 }); onNext(); }}>
                  <div className="avatar avatar-sm">{initial(c.name)}</div>
                  <div className="list-item-main">
                    <b>{c.name}</b>
                    <span className="muted small">{[c.phone, c.lineId && `LINE: ${c.lineId}`].filter(Boolean).join(' · ') || '—'} · มาแล้ว {c.visits || 0} ครั้ง</span>
                    <StampCard points={c.points || 0} loyalty={loyalty} compact />
                  </div>
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

function Qty({ value, onChange, min = 1, max = Infinity }) {
  return (
    <div className="qty">
      <button className="icon-btn" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="ลดจำนวน"><Icon name="minus" /></button>
      <span>{value}</span>
      <button className="icon-btn" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="เพิ่มจำนวน"><Icon name="plus" /></button>
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

/** What this bill does to the member's stamp card (preview; the server applies it on payment). */
function StampSummary({ customer, loyalty, lines }) {
  if (customer.type !== 'old' || !loyalty?.enabled || !lines.length) return null;
  const redeemed = lines.reduce((s, l) => s + (l.rewardQty || 0), 0);
  const used = redeemed * loyalty.cupsPerReward;
  const earned = stampsEarned(lines, loyalty);
  const after = (customer.points || 0) - used + earned;
  return (
    <div className="card stamp-summary">
      <div className="sum-row"><b>☕ สะสมแต้ม · {customer.name}</b><span>{customer.points || 0} แต้ม</span></div>
      {used > 0 && <div className="sum-row text-discount"><span>แลกฟรี {redeemed} แก้ว</span><span>−{used} แต้ม</span></div>}
      <div className="sum-row"><span>ได้รับจากบิลนี้</span><span>+{earned} แต้ม</span></div>
      <StampCard points={after} loyalty={loyalty} compact title={`หลังชำระ: ${after} แต้ม`} />
    </div>
  );
}


/** Step 1 "ขายในแอพ": which delivery app, plus its order number (optional). */
function AppPicker({ open, current, onClose, onPick }) {
  const [app, setApp] = useState(null);
  const [ref, setRef] = useState('');
  useEffect(() => {
    if (open) { setApp(current?.app || null); setRef(current?.ref || ''); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} title="ขายในแอพ" size="sm" onClose={onClose}
      footer={(
        <>
          <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={!app} onClick={() => onPick(app, ref.trim())}>ถัดไป <Icon name="next" /></button>
        </>
      )}>
      <p className="muted small">เลือกแอพที่ลูกค้าสั่งเข้ามา — ออเดอร์นี้ชำระผ่านแอพ ไม่นับเป็นเงินสดหรือเงินโอนของร้าน</p>
      <div className="grid grid-2">
        {Object.entries(APP_NAMES).map(([k, label]) => (
          <button key={k} className={`tile tile-big tile-app app-${k} ${app === k ? 'selected' : ''}`} onClick={() => setApp(k)}>
            <span className="app-logo">{k === 'grab' ? 'G' : 'L'}</span>
            <span className="tile-name">{label}</span>
          </button>
        ))}
      </div>
      <Field label="เลขออเดอร์ในแอพ (ถ้ามี)">
        <input className="input" value={ref} maxLength={40} onChange={(e) => setRef(e.target.value)} placeholder={app === 'lineman' ? 'เช่น LM-1234' : 'เช่น GF-1234'}
          onKeyDown={(e) => e.key === 'Enter' && app && onPick(app, ref.trim())} />
      </Field>
    </Modal>
  );
}

/** Step 6: a one-off discount typed in by staff — % or baht per cup, with what it is for. */
function CustomDiscount({ value, missingName, onChange }) {
  const v = value || emptyCustom();
  const open = !!value;
  const set = (patch) => onChange({ ...v, ...patch });
  if (!open) {
    return (
      <button className="btn btn-outline custom-disc-add" onClick={() => onChange(emptyCustom())}>
        <Icon name="tag" size={18} /> ส่วนลดกำหนดเอง
      </button>
    );
  }
  return (
    <div className="card custom-disc">
      <div className="custom-disc-head">
        <b><Icon name="tag" size={16} /> ส่วนลดกำหนดเอง</b>
        <button className="btn btn-sm btn-ghost btn-danger-text" onClick={() => onChange(null)}><Icon name="x" size={16} /> ไม่ใช้</button>
      </div>
      <div className="custom-disc-row">
        <div className="type-switch" role="group" aria-label="รูปแบบส่วนลด">
          <button className={v.type === 'percent' ? 'active' : ''} onClick={() => set({ type: 'percent' })}>ลดเป็น %</button>
          <button className={v.type === 'amount' ? 'active' : ''} onClick={() => set({ type: 'amount' })}>ลดเป็นบาท</button>
        </div>
        <div className="custom-disc-value">
          <NumberInput value={v.value} onChange={(x) => set({ value: v.type === 'percent' && Number(x) > 100 ? 100 : x })} placeholder="0" aria-label="จำนวนส่วนลด" />
          <span className="muted">{v.type === 'percent' ? '%' : 'บาท / แก้ว'}</span>
        </div>
      </div>
      <Field label="ส่วนลดนี้คือส่วนลดอะไร *" error={missingName ? 'กรุณาระบุว่าเป็นส่วนลดอะไร' : ''}>
        <input className="input" value={v.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="เช่น ลูกค้าประจำ, ชดเชยรอนาน, โปรเปิดร้าน" />
      </Field>
    </div>
  );
}
