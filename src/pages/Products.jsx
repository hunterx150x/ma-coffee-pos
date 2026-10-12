import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { recipeCost, round2, sweetRatio, DEFAULT_SWEET_AMOUNTS, DEFAULT_CUP_VOLUME } from '../../shared/pricing.js';
import { ImagePicker, MenuThumb } from '../components/MenuImage.jsx';
import { baht, discountLabel, num } from '../utils.js';
import { Empty, ErrorBox, Field, Icon, Loading, Modal, NumberInput, PageHead, Tabs, Toggle, useAsync, useUi } from '../components/ui.jsx';

export default function Products() {
  const [tab, setTab] = useState('menu');
  const cats = useAsync(() => api('/categories'), []);
  const ings = useAsync(() => api('/ingredients'), []);
  const settings = useAsync(() => api('/settings'), []);
  return (
    <div>
      <PageHead title="เมนู & ราคา" sub="เพิ่ม ลบ แก้ไขเมนู ท็อปปิ้ง ส่วนลด และกำหนดต้นทุนเพื่อคำนวณกำไร" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'menu', label: 'เมนูเครื่องดื่ม' },
        { key: 'cat', label: 'ประเภทเมนู' },
        { key: 'top', label: 'ท็อปปิ้ง' },
        { key: 'disc', label: 'ส่วนลด' },
      ]} />
      {tab === 'menu' && <MenuItems cats={cats.data || []} ings={ings.data || []} settings={settings.data} />}
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
function MenuItems({ cats, ings, settings }) {
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
            <CostEditor f={f} setF={setF} ings={ings} settings={settings} roles />
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
function CostEditor({ f, setF, ings, settings, roles = false }) {
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
            <div key={i} className={`recipe-row ${roles ? 'recipe-row-role' : ''}`}>
              <select className="input" value={r.ingredientId} onChange={(e) => setRow(i, { ingredientId: e.target.value })}>
                {ings.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <NumberInput value={r.qty} onChange={(v) => setRow(i, { qty: v })} aria-label="ปริมาณ" />
              <span className="muted small recipe-unit">{ing?.unit}</span>
              {roles && (
                <select className={`input recipe-role ${r.role ? `role-${r.role}` : ''}`} value={r.role || ''} aria-label="บทบาทในสูตร"
                  onChange={(e) => setF({ ...f, recipe: recipe.map((x, j) => {
                    if (j === i) return { ...x, role: e.target.value || undefined };
                    // only one line tops the cup up
                    return e.target.value === 'fill' && x.role === 'fill' ? { ...x, role: undefined } : x;
                  }) })}>
                  <option value="">ปกติ</option>
                  <option value="sweet">🍯 ความหวาน</option>
                  <option value="fill">🥛 เติมให้ครบ</option>
                </select>
              )}
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
      {roles && recipe.length > 0 && <SweetPreview f={f} setF={setF} ings={ings} settings={settings} />}
      {f.price !== undefined && (
        <div className="cost-summary">
          <span>ต้นทุน <b>{baht(cost)}</b></span>
          <span>กำไรต่อหน่วย <b><Margin price={f.price} cost={cost} /></b></span>
        </div>
      )}
    </div>
  );
}

const isLiquid = (ing) => /มล|ml|cc|ซีซี/i.test(ing?.unit || '');

/**
 * Menu recipe vs. sweetness: liquid total against the cup volume (with a "top up" button) and what each
 * sweetness level actually cuts — sweetener scaled by the shop's table, the 🥛 line topped up by the difference.
 */
function SweetPreview({ f, setF, ings, settings }) {
  const recipe = (f.recipe || []).map((r) => ({ ...r, qty: Number(r.qty) || 0 }));
  const levels = settings?.sweetnessLevels?.length ? [...settings.sweetnessLevels].sort((a, b) => b - a) : [100, 50, 25];
  const amounts = { ...DEFAULT_SWEET_AMOUNTS, ...(settings?.sweetAmounts || {}) };
  const shopVolume = Number(settings?.cupVolume) || DEFAULT_CUP_VOLUME;
  const volume = Number(f.cupVolume) || shopVolume;
  const ing = (id) => ings.find((i) => i.id === id);
  const liquid = recipe.filter((r) => isLiquid(ing(r.ingredientId))).reduce((a, r) => a + r.qty, 0);
  const sweet = recipe.filter((r) => r.role === 'sweet');
  const fill = recipe.find((r) => r.role === 'fill');
  const diff = round2(volume - liquid);
  const topUp = () => setF({ ...f, recipe: (f.recipe || []).map((r) => (r.role === 'fill' ? { ...r, qty: round2((Number(r.qty) || 0) + diff) } : r)) });
  const shown = recipe.filter((r) => r.role || isLiquid(ing(r.ingredientId)));
  return (
    <div className="sweet-preview">
      <div className="sweet-preview-head">
        <span className={`small ${diff ? 'text-bad' : 'text-good'}`}>
          ของเหลวต่อแก้ว <b>{num(liquid)} มล.</b> / ควรเป็น {num(volume)} มล.{diff ? ` (${diff > 0 ? 'ขาด' : 'เกิน'} ${num(Math.abs(diff))})` : ' ✓'}
        </span>
        {diff !== 0 && fill && <button type="button" className="btn btn-sm btn-outline" onClick={topUp}>ปรับ {ing(fill.ingredientId)?.name.split(' ')[0]} ให้ครบ {num(volume)} มล.</button>}
        <label className="sweet-vol small">
          <span className="muted">ปริมาณต่อแก้วของเมนูนี้</span>
          <NumberInput value={f.cupVolume || ''} placeholder={String(shopVolume)} onChange={(v) => setF({ ...f, cupVolume: v })} aria-label="ปริมาณต่อแก้ว (มล.)" />
          <span className="muted">มล.</span>
        </label>
      </div>
      {sweet.length ? (
        <>
          <div className="muted small">ตัดสต๊อกตามระดับความหวาน{fill ? ` — ${ing(fill.ingredientId)?.name.split(' ')[0]} เติมส่วนที่ลดลง ให้รวมเท่าเดิม` : ' — ยังไม่ได้เลือก 🥛 เติมให้ครบ ปริมาณรวมจะลดลงตามความหวาน'}</div>
          <div className="table-wrap">
            <table className="table sweet-levels">
              <thead><tr><th>หวาน</th>{shown.map((r, i) => <th key={i} className="num">{ing(r.ingredientId)?.name.split(' ')[0]}{r.role === 'sweet' ? ' 🍯' : r.role === 'fill' ? ' 🥛' : ''}</th>)}<th className="num">รวม</th></tr></thead>
              <tbody>
                {levels.map((lv) => {
                  // same rule as the stock cut (shared cupStock): sweetener scaled, the 🥛 line takes the difference
                  const ratio = sweetRatio(lv, amounts);
                  const given = sweet.reduce((a, r) => a + r.qty - round2(r.qty * ratio), 0);
                  const qtyOf = (r) => (r.role === 'sweet' ? round2(r.qty * ratio) : r === fill ? round2(Math.max(0, r.qty + given)) : r.qty);
                  const total = shown.filter((r) => isLiquid(ing(r.ingredientId))).reduce((a, r) => a + qtyOf(r), 0);
                  return (
                    <tr key={lv}><td>{lv}%</td>{shown.map((r, i) => <td key={i} className="num">{num(qtyOf(r))}</td>)}<td className="num"><b>{num(total)}</b></td></tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : <div className="muted small">เลือก 🍯 ความหวาน ที่วัตถุดิบนมข้น / น้ำเชื่อม เพื่อให้ตัดสต๊อกตามระดับความหวาน และ 🥛 เติมให้ครบ ที่นมที่ใช้เติมแก้ว</div>}
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
        <button className="btn btn-primary" onClick={() => crud.open({ name: '', icon: '☕', sort: rows.length + 1, active: true, activeOutside: true })}>
          <Icon name="plus" /> เพิ่มประเภท
        </button>
      </div>
      <div className="grid grid-cats">
        {rows.map((c) => (
          <div key={c.id} className={`tile tile-cat cat-card ${c.active || c.activeOutside !== false ? '' : 'tile-off'}`}>
            <button className="cat-open" onClick={() => crud.open(c)}>
              <span className="tile-emoji">{c.icon}</span>
              <span className="tile-name">{c.name}</span>
              <span className="muted small">ลำดับ {c.sort}{c.requireRoast ? ' · ต้องเลือกคั่ว' : ''}</span>
            </button>
            <div className="cat-switches">
              <Toggle checked={c.active} onChange={(v) => crud.toggleActive(c, v)} label="หน้าร้าน" />
              <Toggle checked={c.activeOutside !== false} onChange={(v) => crud.toggleActive(c, v, 'activeOutside')} label="นอกสถานที่ / QR" />
            </div>
          </div>
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
            <div className="toggle-list">
              <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="ขายหน้าร้าน (หน้าขายของพนักงาน)" />
              <Toggle checked={f.activeOutside !== false} onChange={(v) => setF({ ...f, activeOutside: v })} label="ขายนอกสถานที่ / ลูกค้าสแกน QR สั่งเอง" />
              <Toggle checked={!!f.requireRoast} onChange={(v) => setF({ ...f, requireRoast: v })} label="ต้องเลือกระดับการคั่วเมล็ดกาแฟ (เช่น หมวดกาแฟ)" />
            </div>
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
        <button className="btn btn-primary" onClick={() => crud.open({ name: '', price: '', cost: '', costMode: 'manual', recipe: [], sort: rows.length + 1, active: true, activeOutside: true })}>
          <Icon name="plus" /> เพิ่มท็อปปิ้ง
        </button>
      </div>
      {rows.length ? (
        <div className="card table-card">
          <table className="table table-rows-click">
            <thead><tr><th>ท็อปปิ้ง</th><th className="num">ราคา</th><th className="num">ต้นทุน</th><th className="num hide-sm">กำไร</th><th className="th-sell"><span className="hide-sm">ขาย</span>หน้าร้าน</th><th className="th-sell">นอกสถานที่<span className="hide-sm"> / QR</span></th></tr></thead>
            <tbody>
              {rows.map((t) => {
                const cost = costOf(t, ings);
                return (
                  <tr key={t.id} onClick={() => crud.open(t)} className={t.active || t.activeOutside !== false ? '' : 'row-dim'}>
                    <td><b>{t.name}</b>{t.isRoast && <span className="badge badge-roast">ระดับคั่ว</span>}
                      {t.replaceIngredientIds?.length > 0 && <div className="muted small">ใช้แทน {t.replaceIngredientIds.map((id) => ings.find((i) => i.id === id)?.name).filter(Boolean).join(', ')}</div>}
                    </td>
                    <td className="num">+{baht(t.price)}</td>
                    <td className="num">{baht(cost)}</td>
                    <td className="num hide-sm"><Margin price={t.price} cost={cost} /></td>
                    <td onClick={(e) => e.stopPropagation()}><Toggle checked={t.active} onChange={(v) => crud.toggleActive(t, v)} /></td>
                    <td onClick={(e) => e.stopPropagation()}><Toggle checked={t.activeOutside !== false} onChange={(v) => crud.toggleActive(t, v, 'activeOutside')} /></td>
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
            <ReplacePicker ids={f.replaceIngredientIds || []} ings={ings} onChange={(replaceIngredientIds) => setF({ ...f, replaceIngredientIds })} />
            <div className="toggle-list">
              <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="ขายหน้าร้าน (หน้าขายของพนักงาน)" />
              <Toggle checked={f.activeOutside !== false} onChange={(v) => setF({ ...f, activeOutside: v })} label="ขายนอกสถานที่ / ลูกค้าสแกน QR สั่งเอง" />
              <Toggle checked={!!f.isRoast} onChange={(v) => setF({ ...f, isRoast: v })} label="เป็นตัวเลือกระดับการคั่ว (ให้เมนูกาแฟเลือก 1 อย่าง) — ปิดขายเมื่อเมล็ดชนิดนี้หมด" />
            </div>
          </>
        )}
      </EditorModal>
    </>
  );
}

/** Topping that is used instead of a menu ingredient (oat milk instead of fresh milk): pick which ingredients it replaces. */
function ReplacePicker({ ids, ings, onChange }) {
  const left = ings.filter((i) => !ids.includes(i.id));
  return (
    <Field label="ใช้แทนวัตถุดิบในสูตรเมนู (ถ้ามี)"
      hint="เช่น “นมโอ๊ต” ใช้แทน “นมสด” — เมื่อเลือกท็อปปิ้งนี้ ระบบจะไม่ตัดสต๊อกและไม่คิดต้นทุนวัตถุดิบที่เลือกจากสูตรเมนู แต่ตัดตามสูตรของท็อปปิ้งนี้แทน">
      <div className="replace-list">
        {ids.map((id) => {
          const i = ings.find((x) => x.id === id);
          return (
            <span key={id} className="chip active replace-chip">
              {i?.name || 'วัตถุดิบที่ถูกลบ'}
              <button type="button" className="replace-x" onClick={() => onChange(ids.filter((x) => x !== id))} aria-label={`เอา ${i?.name || ''} ออก`}><Icon name="x" size={14} /></button>
            </span>
          );
        })}
        <select className="input input-auto" value="" onChange={(e) => e.target.value && onChange([...ids, e.target.value])} aria-label="เพิ่มวัตถุดิบที่ใช้แทน">
          <option value="">+ เลือกวัตถุดิบที่ถูกแทน</option>
          {left.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>
    </Field>
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
