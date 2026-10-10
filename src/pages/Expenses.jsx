import { useState } from 'react';
import { api } from '../api.js';
import { baht, presetRange, thDate, today } from '../utils.js';
import { DateRange, Empty, ErrorBox, Field, Icon, Loading, Modal, NumberInput, PageHead, Tabs, useAsync, useUi } from '../components/ui.jsx';

const CATS = ['ค่าเช่า', 'ค่าน้ำ-ไฟ', 'ค่าจ้างพนักงาน', 'อุปกรณ์', 'การตลาด', 'ค่าขนส่ง', 'อื่นๆ'];

export default function Expenses() {
  const { toast, confirm } = useUi();
  const [tab, setTab] = useState('expenses');
  const [range, setRange] = useState(presetRange('month'));
  const list = useAsync(() => api('/expenses-range', { query: range }), [range.from, range.to]);
  const cap = useAsync(() => api('/capital', { query: range }), [range.from, range.to]);
  const [f, setF] = useState(null); // expense being edited
  const [c, setC] = useState(null); // capital entry being edited
  const [err, setErr] = useState('');
  const rows = list.data || [];
  const total = rows.reduce((s, e) => s + e.amount, 0);
  const capRange = cap.data?.range.capital || 0;
  const afterCapital = total - capRange;
  const all = cap.data?.allTime;
  const reloadAll = () => { list.reload(); cap.reload(); };

  const save = async () => {
    setErr('');
    try {
      if (f.id) await api(`/expenses/${f.id}`, { method: 'PUT', body: f });
      else await api('/expenses', { method: 'POST', body: f });
      toast('บันทึกค่าใช้จ่ายแล้ว');
      setF(null);
      reloadAll();
    } catch (e) {
      setErr(e.message);
    }
  };
  const remove = async () => {
    if (!(await confirm({ message: `ลบรายการ “${f.description}”?`, okText: 'ลบ', danger: true }))) return;
    await api(`/expenses/${f.id}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    setF(null);
    reloadAll();
  };
  const saveCapital = async () => {
    setErr('');
    try {
      if (c.id) await api(`/capital/${c.id}`, { method: 'PUT', body: c });
      else await api('/capital', { method: 'POST', body: c });
      toast('บันทึกเงินทุนแล้ว');
      setC(null);
      cap.reload();
    } catch (e) {
      setErr(e.message);
    }
  };
  const removeCapital = async () => {
    if (!(await confirm({ message: `ลบรายการเงินทุน ${baht(c.amount)}?`, okText: 'ลบ', danger: true }))) return;
    await api(`/capital/${c.id}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    setC(null);
    cap.reload();
  };
  const newExpense = () => { setErr(''); setF({ date: today(), category: CATS[0], description: '', amount: '' }); };
  const newCapital = () => { setErr(''); setC({ date: today(), source: 'เจ้าของร้าน', note: '', amount: '' }); };

  return (
    <div>
      <PageHead title="ค่าใช้จ่าย & เงินทุน" sub="ค่าใช้จ่ายนำไปหักในรายงานกำไร-ขาดทุน · เงินทุนใช้ดูว่าครอบคลุมค่าใช้จ่ายได้แค่ไหน">
        <button className="btn btn-outline" onClick={newCapital}><Icon name="plus" /> เพิ่มเงินทุน</button>
        <button className="btn btn-primary" onClick={newExpense}><Icon name="plus" /> เพิ่มค่าใช้จ่าย</button>
      </PageHead>
      <div className="card filters"><DateRange value={range} onChange={setRange} /></div>

      <div className="kpis kpis-3">
        <div className="kpi"><div className="kpi-label">ค่าใช้จ่ายช่วงนี้</div><div className="kpi-value">{baht(total)}</div><div className="kpi-sub">{rows.length} รายการ</div></div>
        <div className="kpi kpi-good"><div className="kpi-label">เงินทุนเพิ่มเข้าช่วงนี้</div><div className="kpi-value">{baht(capRange)}</div><div className="kpi-sub">{cap.data?.rows.length || 0} รายการ</div></div>
        <div className={`kpi ${afterCapital > 0 ? 'kpi-bad' : 'kpi-good'}`}>
          <div className="kpi-label">{afterCapital > 0 ? 'ค่าใช้จ่ายหลังหักเงินทุน' : 'เงินทุนเหลือหลังหักค่าใช้จ่าย'}</div>
          <div className="kpi-value">{baht(Math.abs(afterCapital))}</div>
          <div className="kpi-sub">{afterCapital > 0 ? 'ส่วนที่ต้องจ่ายจากรายได้ร้าน' : 'เงินทุนครอบคลุมค่าใช้จ่ายทั้งหมด'}</div>
        </div>
      </div>
      {all && (
        <div className={`capital-all ${all.balance >= 0 ? 'pos' : 'neg'}`}>
          <Icon name="expenses" size={16} />
          <span>สะสมทั้งหมด: เงินทุน {baht(all.capital)} − ค่าใช้จ่าย {baht(all.expenses)} = </span>
          <b>{all.balance >= 0 ? `ทุนคงเหลือ ${baht(all.balance)}` : `ค่าใช้จ่ายเกินทุน ${baht(-all.balance)}`}</b>
        </div>
      )}

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'expenses', label: 'ค่าใช้จ่าย', count: rows.length },
        { key: 'capital', label: 'เงินทุน', count: cap.data?.rows.length || 0 },
      ]} />

      {tab === 'expenses' && (
        <>
          <p className="muted small">ไม่ต้องบันทึกค่าวัตถุดิบที่นี่ — ต้นทุนวัตถุดิบคิดจากเมนูที่ขายได้แล้ว ให้บันทึกเฉพาะค่าใช้จ่ายดำเนินงาน เช่น ค่าเช่า ค่าไฟ ค่าแรง</p>
          {list.loading && !list.data ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : rows.length ? (
            <div className="card table-card">
              <table className="table table-rows-click">
                <thead><tr><th>วันที่</th><th>รายการ</th><th className="hide-sm">หมวด</th><th className="num">จำนวนเงิน</th></tr></thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} onClick={() => { setErr(''); setF({ ...e }); }}>
                      <td className="nowrap">{thDate(e.date)}</td>
                      <td>{e.description}<div className="muted small show-sm">{e.category}</div></td>
                      <td className="hide-sm"><span className="badge">{e.category}</span></td>
                      <td className="num"><b>{baht(e.amount)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty icon="expenses" title="ไม่มีค่าใช้จ่ายในช่วงนี้" />}
        </>
      )}

      {tab === 'capital' && (
        <>
          <p className="muted small">บันทึกเงินที่เจ้าของหรือหุ้นส่วนนำเข้ามาในร้าน เช่น เพิ่มทุน 3,000 บาท — เงินทุนไม่ใช่รายได้ จึงไม่นับเป็นกำไร แต่ใช้หักกับค่าใช้จ่ายเพื่อดูว่าร้านยังต้องจ่ายเองอีกเท่าไหร่</p>
          {cap.loading && !cap.data ? <Loading /> : cap.error ? <ErrorBox error={cap.error} /> : cap.data.rows.length ? (
            <div className="card table-card">
              <table className="table table-rows-click">
                <thead><tr><th>วันที่</th><th>ผู้ลงทุน</th><th className="hide-sm">หมายเหตุ</th><th className="num">จำนวนเงิน</th></tr></thead>
                <tbody>
                  {cap.data.rows.map((x) => (
                    <tr key={x.id} onClick={() => { setErr(''); setC({ ...x }); }}>
                      <td className="nowrap">{thDate(x.date)}</td>
                      <td>{x.source}<div className="muted small show-sm">{x.note}</div></td>
                      <td className="hide-sm muted">{x.note || '—'}</td>
                      <td className="num text-good"><b>+{baht(x.amount)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty icon="expenses" title="ยังไม่มีการเพิ่มทุนในช่วงนี้"><button className="btn btn-outline btn-sm" onClick={newCapital}>เพิ่มเงินทุน</button></Empty>}
        </>
      )}

      <Modal open={!!f} title={f?.id ? 'แก้ไขค่าใช้จ่าย' : 'เพิ่มค่าใช้จ่าย'} onClose={() => setF(null)}
        footer={(
          <>
            {f?.id && <button className="btn btn-ghost btn-danger-text mr-auto" onClick={remove}><Icon name="trash" /> ลบ</button>}
            <button className="btn btn-ghost" onClick={() => setF(null)}>ยกเลิก</button>
            <button className="btn btn-primary" onClick={save}>บันทึก</button>
          </>
        )}>
        {f && (
          <div className="form">
            <div className="form-grid">
              <Field label="วันที่"><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
              <Field label="จำนวนเงิน (บาท) *"><NumberInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
            </div>
            <Field label="รายละเอียด *"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} autoFocus /></Field>
            <Field label="หมวด">
              <div className="chips">
                {CATS.map((x) => <button key={x} className={`chip ${f.category === x ? 'active' : ''}`} onClick={() => setF({ ...f, category: x })}>{x}</button>)}
              </div>
            </Field>
            {err && <div className="field-error">{err}</div>}
          </div>
        )}
      </Modal>

      <Modal open={!!c} title={c?.id ? 'แก้ไขเงินทุน' : 'เพิ่มเงินทุน'} onClose={() => setC(null)}
        footer={(
          <>
            {c?.id && <button className="btn btn-ghost btn-danger-text mr-auto" onClick={removeCapital}><Icon name="trash" /> ลบ</button>}
            <button className="btn btn-ghost" onClick={() => setC(null)}>ยกเลิก</button>
            <button className="btn btn-primary" onClick={saveCapital}>บันทึก</button>
          </>
        )}>
        {c && (
          <div className="form">
            <div className="form-grid">
              <Field label="วันที่"><input type="date" className="input" value={c.date} onChange={(e) => setC({ ...c, date: e.target.value })} /></Field>
              <Field label="จำนวนเงินทุน (บาท) *"><NumberInput value={c.amount} onChange={(v) => setC({ ...c, amount: v })} autoFocus /></Field>
            </div>
            <Field label="ผู้ลงทุน" hint="เช่น เจ้าของร้าน หรือชื่อหุ้นส่วน">
              <input className="input" value={c.source} onChange={(e) => setC({ ...c, source: e.target.value })} list="capital-sources" />
              <datalist id="capital-sources">{['เจ้าของร้าน', 'หุ้นส่วน'].map((x) => <option key={x} value={x} />)}</datalist>
            </Field>
            <Field label="หมายเหตุ"><input className="input" value={c.note} onChange={(e) => setC({ ...c, note: e.target.value })} placeholder="เช่น เพิ่มทุนซื้อวัตถุดิบเดือนนี้" /></Field>
            {err && <div className="field-error">{err}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
