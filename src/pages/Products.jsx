import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { recipeCost, round2 } from '../../shared/pricing.js';
import { ImagePicker, MenuThumb } from '../components/MenuImage.jsx';
import { baht, discountLabel, num } from '../utils.js';
import { Empty, ErrorBox, Field, Icon, Loading, Modal, NumberInput, PageHead, Tabs, Toggle, useAsync, useUi } from '../components/ui.jsx';

export default function Products() {
  const [tab, setTab] = useState('menu');
  const cats = useAsync(() => api('/categories'), []);
  const ings = useAsync(() => api('/ingredients'), []);
  return (
    <div>
      <PageHead title="เมนู & ราคา" sub="เพิ่ม ลบ แก้ไขเมนู ท็อปปิ้ง ส่วนลด และกำหนดต้นทุนเพื่อคำนวณกำไร" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'menu', label: 'เมนูเครื่องดื่ม' },
        { key: 'cat', label: 'ประเภทเมนู' },
        { key: 'top', label: 'ท็อปปิ้ง' },
        { key: 'disc', label: 'ส่วนลด' },
      ]} />
      {tab === 'menu' && <MenuItems cats={cats.data || []} ings={ings.data || []} />}
      {tab === 'cat' && <Categories onChange={cats.reload} />}
      {tab === 'top' && <Toppings ings={ings.data || []} />}
      {tab === 'disc' && <Discounts />}
    </div>
  );
}

/** Shared list + modal editor wiring. */
function useCrud(endpoint, label) {
  const { toast, confirm } = useUi();
  const list = useAsync(() => api(`/${endpoint}`), [endpoint]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async (row) => {
    setBusy(true);
    setErr('');
    try {
      if (row.id) await api(`/${endpoint}/${row.id}`, { method: 'PUT', body: row });
      else await api(`/${endpoint}`, { method: 'POST', body: row });
      toast(row.id ? 'บันทึกการแก้ไขแล้ว' : `เพิ่ม${label}แล้ว`);
      setEditing(null);
      list.reload();
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const remove = async (row) => {
    if (!(await confirm({ title: `ลบ${label}`, message: `ต้องการลบ “${row.name}” ใช่หรือไม่?`, okText: 'ลบ', danger: true }))) return;
    try {
      await api(`/${endpoint}/${row.id}`, { method: 'DELETE' });
      toast(`ลบ${label}แล้ว`);
      setEditing(null);
      list.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const toggleActive = async (row, active, field = 'active') => {
    try {
      await api(`/${endpoint}/${row.id}`, { method: 'PUT', body: { ...row, [field]: active } });
      list.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const open = (row) => { setErr(''); setEditing(row); };
  return { list, editing, open, close: () => setEditing(null), save, remove, toggleActive, busy, err };
}

function EditorModal({ crud, title, children, onSubmit }) {
  return (
    <Modal open={!!crud.editing} title={title} onClose={crud.close}
      footer={(
        <>
          {crud.editing?.id && (
            <button className="btn btn-ghost btn-danger-text mr-auto" onClick={() => crud.remove(crud.editing)}><Icon name="trash" /> ลบ</button>
          )}
          <button className="btn btn-ghost" onClick={crud.close}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={crud.busy} onClick={onSubmit}>บันทึก</button>
        </>
      )}>
      <div className="form">
        {children}
        {crud.err && <div className="field-error">{crud.err}</div>}
      </div>
    </Modal>
  );
}

// ---------- menu items ----------
function MenuItems({ cats, ings }) {
  const crud = useCrud('menu-items', 'เมนู');
  const [filter, setFilter] = useState('');
  const [f, setF] = useState(null);
  useEffect(() => { setF(crud.editing ? { ...crud.editing } : null); }, [crud.editing]);

  if (crud.list.loading && !crud.list.data) return <Loading />;
  if (crud.list.error) return <ErrorBox error={crud.list.error} onRetry={crud.list.reload} />;
  const items = (crud.list.data || []).filter((m) => !filter || m.categoryId === filter);

  return (
    <>
      <div className="toolbar">
        <div className="chips chips-scroll">
          <button className={`chip ${!filter ? 'active' : ''}`} onClick={() => setFilter('')}>ทั้งหมด</button>
          {cats.map((c) => (
            <button key={c.id} className={`chip ${filter === c.id ? 'active' : ''}`} onClick={() => setFilter(c.id)}>{c.icon} {c.name}</button>
          ))}
        </div>
        <button className="btn btn-primary" disabled={!cats.length}
          onClick={() => crud.open({ categoryId: filter || cats[0]?.id, name: '', price: '', cost: '', costMode: 'manual', recipe: [], steps: [], sort: 0, active: true, activeOutside: true })}>
          <Icon name="plus" /> เพิ่มเมนู
        </button>
      </div>
      {items.length ? (
        <div className="card table-card">
          <table className="table table-rows-click">
            <thead><tr><th>เมนู</th><th className="num">ราคา</th><th className="num hide-sm">ต้นทุน</th><th className="num hide-sm">กำไร/แก้ว</th>
              <th className="th-sell"><span className="hide-sm">ขาย</span>หน้าร้าน</th><th className="th-sell">นอกสถานที่<span className="hide-sm"> / QR</span></th></tr></thead>
            <tbody>
              {items.map((m) => {
                const cost = costOf(m, ings);
                const cat = cats.find((c) => c.id === m.categoryId);
                return (
                  <tr key={m.id} onClick={() => crud.open(m)} className={m.active || m.activeOutside !== false ? '' : 'row-dim'}>
                    <td className="td-menu"><MenuThumb item={m} icon={cat?.icon} className="list-thumb" /><div><b>{m.name}</b><div className="muted small">{cat ? `${cat.icon} ${cat.name}` : '-'}{m.costMode === 'recipe' ? ' · ต้นทุนจากสูตร' : ''}{m.steps?.length ? ` · วิธีทำ ${m.steps.length} ขั้นตอน` : ''}</div></div></td>
                    <td className="num">{baht(m.price)}<div className="muted small show-sm">ทุน {baht(cost)}</div></td>
                    <td className="num hide-sm">{baht(cost)}</td>
                    <td className="num hide-sm"><Margin price={m.price} cost={cost} /></td>
                    <td onClick={(e) => e.stopPropagation()}><Toggle checked={m.active} onChange={(v) => crud.toggleActive(m, v)} /></td>
                    <td onClick={(e) => e.stopPropagation()}><Toggle checked={m.activeOutside !== false} onChange={(v) => crud.toggleActive(m, v, 'activeOutside')} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty icon="products" title="ยังไม่มีเมนู" />}

      <EditorModal crud={crud} title={f?.id ? 'แก้ไขเมนู' : 'เพิ่มเมนูใหม่'} onSubmit={() => crud.save(f)}>
        {f && (
          <>
            <ImagePicker value={f.image} currentUrl={f.imageUrl} icon={cats.find((c) => c.id === f.categoryId)?.icon}
              onChange={(image) => setF({ ...f, image })} />
            <div className="form-grid">
              <Field label="ชื่อเมนู *">
                <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
              </Field>
              <Field label="ประเภท *">
                <select className="input" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                </select>
              </Field>
              <Field label="ราคาขาย (บาท) *">
                <NumberInput value={f.price} onChange={(v) => setF({ ...f, price: v })} />
              </Field>
              <Field label="ลำดับการแสดง">
                <NumberInput value={f.sort} onChange={(v) => setF({ ...f, sort: v })} step="1" />
              </Field>
            </div>
            <CostEditor f={f} setF={setF} ings={ings} />
            <StepsEditor f={f} setF={setF} ings={ings} />
            <div className="toggle-list">
              <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="ขายหน้าร้าน (หน้าขายของพนักงาน)" />
              <Toggle checked={f.activeOutside !== false} onChange={(v) => setF({ ...f, activeOutside: v })} label="ขายนอกสถานที่ / ลูกค้าสแกน QR สั่งเอง" />
            </div>
          </>
        )}
      </EditorModal>
    </>
  );
}

const costOf = (m, ings) => (m.costMode === 'recipe' ? round2(recipeCost(m.recipe, ings)) : Number(m.cost) || 0);

function Margin({ price, cost }) {
  const p = Number(price) - cost;
  const pct = Number(price) > 0 ? (p / Number(price)) * 100 : 0;
  return <span className={p < 0 ? 'text-bad' : ''}>{baht(p)} <span className="muted small">({num(Math.round(pct))}%)</span></span>;
}

/** Cost: either typed manually, or computed from a recipe of stock ingredients (also used for stock deduction). */
function CostEditor({ f, setF, ings }) {
  const recipe = f.recipe || [];
  const rc = round2(recipeCost(recipe, ings));
  const setRow = (i, patch) => setF({ ...f, recipe: recipe.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const cost = f.costMode === 'recipe' ? rc : Number(f.cost) || 0;
  return (
    <div className="subcard">
      <div className="subcard-head">
        <b>ต้นทุน & สูตร (ตัดสต๊อก)</b>
        <Tabs value={f.costMode} onChange={(v) => setF({ ...f, costMode: v })}
          tabs={[{ key: 'manual', label: 'กรอกต้นทุนเอง' }, { key: 'recipe', label: 'คำนวณจากสูตร' }]} />
      </div>
      {f.costMode === 'manual' && (
        <Field label="ต้นทุนต่อหน่วย (บาท)" hint="ใช้คำนวณกำไรในรายงาน">
          <NumberInput value={f.cost} onChange={(v) => setF({ ...f, cost: v })} />
        </Field>
      )}
      <div className="recipe">
        <div className="muted small">วัตถุดิบที่ใช้ต่อ 1 หน่วย — ระบบจะตัดสต๊อกอัตโนมัติเมื่อขาย{f.costMode === 'recipe' ? ' และคำนวณต้นทุนจากราคาวัตถุดิบ' : ''}</div>
        {recipe.map((r, i) => {
          const ing = ings.find((x) => x.id === r.ingredientId);
          return (
            <div key={i} className="recipe-row">
              <select className="input" value={r.ingredientId} onChange={(e) => setRow(i, { ingredientId: e.target.value })}>
                {ings.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <NumberInput value={r.qty} onChange={(v) => setRow(i, { qty: v })} aria-label="ปริมาณ" />
              <span className="muted small recipe-unit">{ing?.unit}</span>
              <span className="small recipe-cost">{baht(round2((ing?.costPerUnit || 0) * (Number(r.qty) || 0)))}</span>
              <button className="icon-btn icon-btn-danger" onClick={() => setF({ ...f, recipe: recipe.filter((_, j) => j !== i) })} aria-label="ลบวัตถุดิบ">
                <Icon name="x" size={18} />
              </button>
            </div>
          );
        })}
        {ings.length ? (
          <button className="btn btn-sm btn-outline" onClick={() => setF({ ...f, recipe: [...recipe, { ingredientId: ings[0].id, qty: '' }] })}>
            <Icon name="plus" size={16} /> เพิ่มวัตถุดิบ
          </button>
        ) : <div className="muted small">ยังไม่มีวัตถุดิบ เพิ่มได้ที่เมนู “สต๊อก”</div>}
        {recipe.length > 0 && <div className="small">ต้นทุนตามสูตร: <b>{baht(rc)}</b></div>}
      </div>
      {f.price !== undefined && (
        <div className="cost-summary">
          <span>ต้นทุน <b>{baht(cost)}</b></span>
          <span>กำไรต่อหน่วย <b><Margin price={f.price} cost={cost} /></b></span>
        </div>
      )}
    </div>
  );
}

/**
 * How-to steps shown to baristas. Each step is free text and can optionally point at a stock
 * ingredient + amount (e.g. "ชงกาแฟ" → เมล็ดกาแฟ 18 กรัม). Display only — stock is cut by the recipe above.
 */
function StepsEditor({ f, setF, ings }) {
  const steps = f.steps || [];
  const set = (next) => setF({ ...f, steps: next });
  const setRow = (i, patch) => set(steps.map((st, j) => (j === i ? { ...st, ...patch } : st)));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };
  const fromRecipe = () => set([
    ...steps,
    ...(f.recipe || []).map((r) => ({ text: '', ingredientId: r.ingredientId, qty: r.qty })),
  ]);
  return (
    <div className="subcard">
      <div className="subcard-head">
        <b>วิธีทำ (ขั้นตอน)</b>
        {(f.recipe || []).length > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={fromRecipe}><Icon name="stock" size={16} /> ดึงจากส่วนผสม</button>
        )}
      </div>
      <div className="muted small">เช่น 1. ชงกาแฟ (อ้างอิง เมล็ดกาแฟ 18 กรัม) · 2. ใส่น้ำเปล่าเย็น 4 Oz. (พิมพ์เอง ไม่อ้างอิงสต๊อก)</div>
      {steps.map((st, i) => {
        const ing = ings.find((x) => x.id === st.ingredientId);
        return (
          <div key={i} className="step-row">
            <span className="howto-num">{i + 1}</span>
            <div className="step-row-main">
              <input className="input" value={st.text} placeholder="รายละเอียดขั้นตอน เช่น ชงกาแฟ, ใส่น้ำแข็งเต็มแก้ว"
                onChange={(e) => setRow(i, { text: e.target.value })} />
              <div className="step-row-ing">
                <select className="input" value={st.ingredientId || ''} aria-label="วัตถุดิบจากสต๊อก"
                  onChange={(e) => {
                    const id = e.target.value || null;
                    const r = (f.recipe || []).find((x) => x.ingredientId === id);
                    setRow(i, { ingredientId: id, qty: id ? (st.qty || r?.qty || '') : null });
                  }}>
                  <option value="">— ไม่อ้างอิงสต๊อก —</option>
                  {ings.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                {st.ingredientId && (
                  <>
                    <NumberInput value={st.qty} onChange={(v) => setRow(i, { qty: v })} aria-label="ปริมาณ" />
                    <span className="muted small recipe-unit">{ing?.unit}</span>
                  </>
                )}
              </div>
            </div>
            <div className="step-row-tools">
              <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="เลื่อนขึ้น"><Icon name="up" size={18} /></button>
              <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="เลื่อนลง"><Icon name="down" size={18} /></button>
              <button className="icon-btn icon-btn-danger" onClick={() => set(steps.filter((_, j) => j !== i))} aria-label="ลบขั้นตอน"><Icon name="x" size={18} /></button>
            </div>
          </div>
        );
      })}
      <button className="btn btn-sm btn-outline align-start" onClick={() => set([...steps, { text: '', ingredientId: null, qty: null }])}>
        <Icon name="plus" size={16} /> เพิ่มขั้นตอน
      </button>
    </div>
  );
}

// ---------- categories ----------
function Categories({ onChange }) {
  const crud = useCrud('categories', 'ประเภท');
  const [f, setF] = useState(null);
  useEffect(() => { setF(crud.editing ? { ...crud.editing } : null); }, [crud.editing]);
  useEffect(() => { if (crud.list.data) onChange(); }, [crud.list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (crud.list.loading && !crud.list.data) return <Loading />;
  const rows = crud.list.data || [];
  return (
    <>
      <div className="toolbar">
        <span className="muted">ประเภทที่แสดงในขั้นตอนที่ 2 ของการขาย</span>
        <button className="btn btn-primary" onClick={() => crud.open({ name: '', icon: '☕', sort: rows.length + 1, active: true })}>
          <Icon name="plus" /> เพิ่มประเภท
        </button>
      </div>
      <div className="grid grid-cats">
        {rows.map((c) => (
          <button key={c.id} className={`tile tile-cat ${c.active ? '' : 'tile-off'}`} onClick={() => crud.open(c)}>
            <span className="tile-emoji">{c.icon}</span>
            <span className="tile-name">{c.name}</span>
            <span className="muted small">{c.active ? `ลำดับ ${c.sort}` : 'ปิดใช้งาน'}</span>
          </button>
        ))}
      </div>
      <EditorModal crud={crud} title={f?.id ? 'แก้ไขประเภท' : 'เพิ่มประเภท'} onSubmit={() => crud.save(f)}>
        {f && (
          <>
            <div className="form-grid">
              <Field label="ชื่อประเภท *"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
              <Field label="ไอคอน (อีโมจิ)"><input className="input" value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} /></Field>
              <Field label="ลำดับการแสดง"><NumberInput value={f.sort} onChange={(v) => setF({ ...f, sort: v })} step="1" /></Field>
            </div>
            <div className="chips">
              {['☕', '🍵', '🥤', '🧋', '🍫', '🥛', '🍋', '🍓', '🧁', '🍰'].map((e) => (
                <button key={e} className={`chip ${f.icon === e ? 'active' : ''}`} onClick={() => setF({ ...f, icon: e })}>{e}</button>
              ))}
            </div>
            <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="เปิดใช้งาน" />
          </>
        )}
      </EditorModal>
    </>
  );
}

// ---------- toppings ----------
function Toppings({ ings }) {
  const crud = useCrud('toppings', 'ท็อปปิ้ง');
  const [f, setF] = useState(null);
  useEffect(() => { setF(crud.editing ? { ...crud.editing } : null); }, [crud.editing]);
  if (crud.list.loading && !crud.list.data) return <Loading />;
  const rows = crud.list.data || [];
  return (
    <>
      <div className="toolbar">
        <span className="muted">ตัวเลือกเพิ่มเติมในขั้นตอนที่ 5</span>
        <button className="btn btn-primary" onClick={() => crud.open({ name: '', price: '', cost: '', costMode: 'manual', recipe: [], sort: rows.length + 1, active: true })}>
          <Icon name="plus" /> เพิ่มท็อปปิ้ง
        </button>
      </div>
      {rows.length ? (
        <div className="card table-card">
          <table className="table table-rows-click">
            <thead><tr><th>ท็อปปิ้ง</th><th className="num">ราคา</th><th className="num">ต้นทุน</th><th className="num hide-sm">กำไร</th><th>ใช้งาน</th></tr></thead>
            <tbody>
              {rows.map((t) => {
                const cost = costOf(t, ings);
                return (
                  <tr key={t.id} onClick={() => crud.open(t)} className={t.active ? '' : 'row-dim'}>
                    <td><b>{t.name}</b></td>
                    <td className="num">+{baht(t.price)}</td>
                    <td className="num">{baht(cost)}</td>
                    <td className="num hide-sm"><Margin price={t.price} cost={cost} /></td>
                    <td onClick={(e) => e.stopPropagation()}><Toggle checked={t.active} onChange={(v) => crud.toggleActive(t, v)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty icon="products" title="ยังไม่มีท็อปปิ้ง" />}
      <EditorModal crud={crud} title={f?.id ? 'แก้ไขท็อปปิ้ง' : 'เพิ่มท็อปปิ้ง'} onSubmit={() => crud.save(f)}>
        {f && (
          <>
            <div className="form-grid">
              <Field label="ชื่อท็อปปิ้ง *"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
              <Field label="ราคาเพิ่ม (บาท)"><NumberInput value={f.price} onChange={(v) => setF({ ...f, price: v })} /></Field>
              <Field label="ลำดับการแสดง"><NumberInput value={f.sort} onChange={(v) => setF({ ...f, sort: v })} step="1" /></Field>
            </div>
            <CostEditor f={f} setF={setF} ings={ings} />
            <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="เปิดใช้งาน" />
          </>
        )}
      </EditorModal>
    </>
  );
}

// ---------- discounts ----------
const DISCOUNT_TYPES = [
  { key: 'amount', label: 'ลดเป็นบาท / แก้ว' },
  { key: 'percent', label: 'ลดเป็น % / แก้ว' },
  { key: 'free', label: 'ฟรี 1 แก้ว (กำหนดราคาสูงสุด)' },
];

function Discounts() {
  const crud = useCrud('discounts', 'ส่วนลด');
  const [f, setF] = useState(null);
  useEffect(() => { setF(crud.editing ? { ...crud.editing } : null); }, [crud.editing]);
  if (crud.list.loading && !crud.list.data) return <Loading />;
  const rows = crud.list.data || [];
  return (
    <>
      <div className="toolbar">
        <span className="muted">สิทธิพิเศษที่เลือกได้ในขั้นตอนที่ 6</span>
        <button className="btn btn-primary" onClick={() => crud.open({ name: '', type: 'amount', value: '', maxValue: '', sort: rows.length + 1, active: true })}>
          <Icon name="plus" /> เพิ่มส่วนลด
        </button>
      </div>
      {rows.length ? (
        <div className="card table-card">
          <table className="table table-rows-click">
            <thead><tr><th>ส่วนลด</th><th>เงื่อนไข</th><th>ใช้งาน</th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} onClick={() => crud.open(d)} className={d.active ? '' : 'row-dim'}>
                  <td><b>{d.name}</b></td>
                  <td><span className="badge badge-discount">{discountLabel(d)}</span></td>
                  <td onClick={(e) => e.stopPropagation()}><Toggle checked={d.active} onChange={(v) => crud.toggleActive(d, v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty icon="tag" title="ยังไม่มีส่วนลด" />}
      <EditorModal crud={crud} title={f?.id ? 'แก้ไขส่วนลด' : 'เพิ่มส่วนลด'} onSubmit={() => crud.save(f)}>
        {f && (
          <>
            <Field label="ชื่อส่วนลด / สิทธิ์ *">
              <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="เช่น นำแก้วมาเอง" autoFocus />
            </Field>
            <Field label="รูปแบบ">
              <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                {DISCOUNT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </Field>
            {f.type !== 'free' ? (
              <Field label={f.type === 'percent' ? 'ลดกี่ %' : 'ลดกี่บาท ต่อแก้ว'}>
                <NumberInput value={f.value} onChange={(v) => setF({ ...f, value: v })} />
              </Field>
            ) : (
              <Field label="ราคาสูงสุดที่ฟรีได้ (บาท)" hint="เช่น 40 = ฟรีไม่เกิน 40 บาท ถ้าเมนูแพงกว่า ลูกค้าจ่ายส่วนต่าง (0 = ฟรีทั้งแก้ว)">
                <NumberInput value={f.maxValue} onChange={(v) => setF({ ...f, maxValue: v })} />
              </Field>
            )}
            <Field label="ลำดับการแสดง"><NumberInput value={f.sort} onChange={(v) => setF({ ...f, sort: v })} step="1" /></Field>
            <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="เปิดใช้งาน" />
          </>
        )}
      </EditorModal>
    </>
  );
}
