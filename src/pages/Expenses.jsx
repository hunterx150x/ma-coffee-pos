import { useState } from 'react';
import { api } from '../api.js';
import { baht, presetRange, thDate, today } from '../utils.js';
import { DateRange, Empty, ErrorBox, Field, Icon, Loading, Modal, NumberInput, PageHead, useAsync, useUi } from '../components/ui.jsx';

const CATS = ['ค่าเช่า', 'ค่าน้ำ-ไฟ', 'ค่าจ้างพนักงาน', 'อุปกรณ์', 'การตลาด', 'ค่าขนส่ง', 'อื่นๆ'];

export default function Expenses() {
  const { toast, confirm } = useUi();
  const [range, setRange] = useState(presetRange('month'));
  const list = useAsync(() => api('/expenses-range', { query: range }), [range.from, range.to]);
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const rows = list.data || [];
  const total = rows.reduce((s, e) => s + e.amount, 0);

  const save = async () => {
    setErr('');
    try {
      if (f.id) await api(`/expenses/${f.id}`, { method: 'PUT', body: f });
      else await api('/expenses', { method: 'POST', body: f });
      toast('บันทึกค่าใช้จ่ายแล้ว');
      setF(null);
      list.reload();
    } catch (e) {
      setErr(e.message);
    }
  };
  const remove = async () => {
    if (!(await confirm({ message: `ลบรายการ “${f.description}”?`, okText: 'ลบ', danger: true }))) return;
    await api(`/expenses/${f.id}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    setF(null);
    list.reload();
  };

  return (
    <div>
      <PageHead title="ค่าใช้จ่าย" sub={`รวม ${baht(total)} · นำไปหักในรายงานกำไร-ขาดทุน`}>
        <button className="btn btn-primary" onClick={() => { setErr(''); setF({ date: today(), category: CATS[0], description: '', amount: '' }); }}>
          <Icon name="plus" /> เพิ่มค่าใช้จ่าย
        </button>
      </PageHead>
      <div className="card filters"><DateRange value={range} onChange={setRange} /></div>
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
                {CATS.map((c) => <button key={c} className={`chip ${f.category === c ? 'active' : ''}`} onClick={() => setF({ ...f, category: c })}>{c}</button>)}
              </div>
            </Field>
            {err && <div className="field-error">{err}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
