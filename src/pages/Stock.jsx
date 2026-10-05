import { useState } from 'react';
import { api } from '../api.js';
import { baht, num, thDateTime } from '../utils.js';
import { Empty, ErrorBox, Field, Icon, Loading, Modal, NumberInput, PageHead, Tabs, useAsync, useUi } from '../components/ui.jsx';

const MOVE_LABEL = { in: 'รับเข้า', out: 'เบิกออก', set: 'ตรวจนับ', sale: 'ขาย', void: 'คืนจากยกเลิกบิล' };
const ADJUST = {
  in: { title: 'รับวัตถุดิบเข้า', qty: 'จำนวนที่รับเข้า', ok: 'บันทึกรับเข้า' },
  out: { title: 'เบิกออก / ของเสีย', qty: 'จำนวนที่เบิกออก', ok: 'บันทึกเบิกออก' },
  set: { title: 'ตรวจนับสต๊อก', qty: 'จำนวนคงเหลือจริง', ok: 'บันทึกยอดตรวจนับ' },
};

export default function Stock() {
  const { toast, confirm } = useUi();
  const [tab, setTab] = useState('list');
  const [q, setQ] = useState('');
  const list = useAsync(() => api('/ingredients'), []);
  const [edit, setEdit] = useState(null);
  const [adj, setAdj] = useState(null);
  const [err, setErr] = useState('');

  const rows = (list.data || []).filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()));
  const low = (list.data || []).filter((i) => i.quantity <= i.minQty);
  const value = (list.data || []).reduce((s, i) => s + Math.max(0, i.quantity) * i.costPerUnit, 0);

  const saveIng = async () => {
    setErr('');
    try {
      if (edit.id) await api(`/ingredients/${edit.id}`, { method: 'PUT', body: edit });
      else await api('/ingredients', { method: 'POST', body: edit });
      toast('บันทึกวัตถุดิบแล้ว');
      setEdit(null);
      list.reload();
    } catch (e) {
      setErr(e.message);
    }
  };
  const removeIng = async () => {
    if (!(await confirm({ title: 'ลบวัตถุดิบ', message: `ลบ “${edit.name}” ใช่หรือไม่?`, okText: 'ลบ', danger: true }))) return;
    try {
      await api(`/ingredients/${edit.id}`, { method: 'DELETE' });
      toast('ลบวัตถุดิบแล้ว');
      setEdit(null);
      list.reload();
    } catch (e) {
      setErr(e.message);
    }
  };
  const saveAdj = async () => {
    setErr('');
    try {
      await api(`/ingredients/${adj.ing.id}/adjust`, { method: 'POST', body: { type: adj.type, qty: adj.qty, totalCost: adj.totalCost, note: adj.note } });
      toast('ปรับสต๊อกแล้ว');
      setAdj(null);
      list.reload();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div>
      <PageHead title="จัดการสต๊อก" sub="วัตถุดิบจะถูกตัดอัตโนมัติตามสูตรของแต่ละเมนูเมื่อขาย">
        <button className="btn btn-primary" onClick={() => { setErr(''); setEdit({ name: '', unit: 'กรัม', quantity: '', costPerUnit: '', minQty: '' }); }}>
          <Icon name="plus" /> เพิ่มวัตถุดิบ
        </button>
      </PageHead>

      <div className="kpis kpis-3">
        <div className="kpi"><div className="kpi-label">วัตถุดิบทั้งหมด</div><div className="kpi-value">{num(list.data?.length || 0)}</div><div className="kpi-sub">รายการ</div></div>
        <div className={`kpi ${low.length ? 'kpi-warn' : ''}`}>
          <div className="kpi-label">{low.length > 0 && <Icon name="alert" size={16} />}ใกล้หมด</div>
          <div className="kpi-value">{low.length}</div><div className="kpi-sub">{low.length ? low.slice(0, 3).map((i) => i.name).join(', ') : 'เพียงพอทุกรายการ'}</div>
        </div>
        <div className="kpi"><div className="kpi-label">มูลค่าสต๊อกคงเหลือ</div><div className="kpi-value">{baht(Math.round(value))}</div><div className="kpi-sub">ตามต้นทุนเฉลี่ย</div></div>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'list', label: 'วัตถุดิบคงเหลือ' }, { key: 'moves', label: 'ประวัติเคลื่อนไหว' }]} />

      {tab === 'list' && (list.loading && !list.data ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : (
        <>
          <div className="search search-block">
            <Icon name="search" size={18} />
            <input className="input" placeholder="ค้นหาวัตถุดิบ" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {rows.length ? (
            <div className="stock-list">
              {rows.map((i) => {
                const isLow = i.quantity <= i.minQty;
                const pct = i.minQty > 0 ? Math.min(100, (i.quantity / (i.minQty * 3)) * 100) : 100;
                return (
                  <div key={i.id} className={`card stock-item ${isLow ? 'stock-low' : ''}`}>
                    <div className="stock-item-head">
                      <button className="link-btn" onClick={() => { setErr(''); setEdit({ ...i }); }}>
                        <b>{i.name}</b> <Icon name="edit" size={14} />
                      </button>
                      {isLow && <span className="badge badge-warn"><Icon name="alert" size={12} /> ใกล้หมด</span>}
                    </div>
                    <div className="stock-qty">
                      <span className="stock-qty-num">{num(i.quantity)}</span> <span className="muted">{i.unit}</span>
                    </div>
                    <div className="stock-meter"><span style={{ width: `${Math.max(0, pct)}%` }} /></div>
                    <div className="muted small">ขั้นต่ำ {num(i.minQty)} {i.unit} · ต้นทุน {baht(i.costPerUnit)}/{i.unit}</div>
                    <div className="stock-actions">
                      {Object.keys(ADJUST).map((type) => (
                        <button key={type} className={`btn btn-sm ${type === 'in' ? 'btn-primary' : 'btn-outline'}`}
                          onClick={() => { setErr(''); setAdj({ ing: i, type, qty: '', totalCost: '', note: '' }); }}>
                          {MOVE_LABEL[type]}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <Empty icon="stock" title="ไม่พบวัตถุดิบ" />}
        </>
      ))}

      {tab === 'moves' && <Moves ings={list.data || []} />}

      <Modal open={!!edit} title={edit?.id ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบ'} onClose={() => setEdit(null)}
        footer={(
          <>
            {edit?.id && <button className="btn btn-ghost btn-danger-text mr-auto" onClick={removeIng}><Icon name="trash" /> ลบ</button>}
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>ยกเลิก</button>
            <button className="btn btn-primary" onClick={saveIng}>บันทึก</button>
          </>
        )}>
        {edit && (
          <div className="form">
            <div className="form-grid">
              <Field label="ชื่อวัตถุดิบ *"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
              <Field label="หน่วย">
                <input className="input" list="units" value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} />
                <datalist id="units">{['กรัม', 'มล.', 'ชิ้น', 'ใบ', 'ชุด', 'ขวด', 'กก.', 'ลิตร'].map((u) => <option key={u} value={u} />)}</datalist>
              </Field>
              <Field label={`ต้นทุนต่อ ${edit.unit || 'หน่วย'} (บาท)`} hint="เช่น เมล็ดกาแฟ 1 กก. 800 บาท = 0.8 บาท/กรัม">
                <NumberInput value={edit.costPerUnit} onChange={(v) => setEdit({ ...edit, costPerUnit: v })} />
              </Field>
              <Field label="จุดแจ้งเตือนขั้นต่ำ"><NumberInput value={edit.minQty} onChange={(v) => setEdit({ ...edit, minQty: v })} /></Field>
              {!edit.id && <Field label="จำนวนเริ่มต้น"><NumberInput value={edit.quantity} onChange={(v) => setEdit({ ...edit, quantity: v })} /></Field>}
            </div>
            {err && <div className="field-error">{err}</div>}
          </div>
        )}
      </Modal>

      <Modal open={!!adj} title={adj ? `${ADJUST[adj.type].title} · ${adj.ing.name}` : ''} onClose={() => setAdj(null)} size="sm"
        footer={(
          <>
            <button className="btn btn-ghost" onClick={() => setAdj(null)}>ยกเลิก</button>
            <button className="btn btn-primary" onClick={saveAdj}>{adj && ADJUST[adj.type].ok}</button>
          </>
        )}>
        {adj && (
          <div className="form">
            <div className="muted">คงเหลือปัจจุบัน {num(adj.ing.quantity)} {adj.ing.unit}</div>
            <Field label={`${ADJUST[adj.type].qty} (${adj.ing.unit})`}>
              <NumberInput value={adj.qty} onChange={(v) => setAdj({ ...adj, qty: v })} autoFocus />
            </Field>
            {adj.type === 'in' && (
              <Field label="ราคาที่ซื้อมาทั้งหมด (บาท)" hint="ถ้ากรอก ระบบจะคำนวณต้นทุนเฉลี่ยต่อหน่วยใหม่ให้อัตโนมัติ">
                <NumberInput value={adj.totalCost} onChange={(v) => setAdj({ ...adj, totalCost: v })} />
              </Field>
            )}
            {adj.type === 'in' && Number(adj.qty) > 0 && Number(adj.totalCost) > 0 && (
              <div className="small">ราคาล็อตนี้ {baht(Number(adj.totalCost) / Number(adj.qty))}/{adj.ing.unit}</div>
            )}
            <Field label="หมายเหตุ"><input className="input" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></Field>
            {err && <div className="field-error">{err}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Moves({ ings }) {
  const [ingredientId, setIng] = useState('');
  const moves = useAsync(() => api('/stock-moves', { query: { ingredientId } }), [ingredientId]);
  return (
    <>
      <div className="toolbar">
        <select className="input input-auto" value={ingredientId} onChange={(e) => setIng(e.target.value)}>
          <option value="">วัตถุดิบทั้งหมด</option>
          {ings.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>
      {moves.loading && !moves.data ? <Loading /> : moves.data?.length ? (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>เวลา</th><th>วัตถุดิบ</th><th>ประเภท</th><th className="num">จำนวน</th><th className="num hide-sm">คงเหลือ</th><th className="hide-sm">หมายเหตุ</th></tr></thead>
              <tbody>
                {moves.data.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{thDateTime(m.createdAt)}</td>
                    <td>{m.ingredientName}</td>
                    <td><span className={`badge badge-move-${m.type}`}>{MOVE_LABEL[m.type]}</span></td>
                    <td className={`num ${m.qty < 0 ? 'text-bad' : 'text-good'}`}>{m.qty > 0 ? '+' : ''}{num(m.qty)} {m.unit}</td>
                    <td className="num hide-sm">{num(m.balance)}</td>
                    <td className="hide-sm muted">{[m.note, m.totalCost ? `ซื้อ ${baht(m.totalCost)}` : '', m.userName].filter(Boolean).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : <Empty icon="history" title="ยังไม่มีการเคลื่อนไหว" />}
    </>
  );
}
