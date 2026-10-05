import { useState } from 'react';
import { api } from '../api.js';
import { baht, thDate } from '../utils.js';
import { Empty, Field, Icon, Loading, Modal, PageHead, useAsync, useUi } from '../components/ui.jsx';

export default function Customers() {
  const { toast, confirm } = useUi();
  const [q, setQ] = useState('');
  const list = useAsync(() => api('/customers', { query: { q } }), [q]);
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');

  const save = async () => {
    setErr('');
    try {
      if (f.id) await api(`/customers/${f.id}`, { method: 'PUT', body: f });
      else await api('/customers', { method: 'POST', body: f });
      toast('บันทึกข้อมูลลูกค้าแล้ว');
      setF(null);
      list.reload();
    } catch (e) {
      setErr(e.message);
    }
  };
  const remove = async () => {
    if (!(await confirm({ message: `ลบลูกค้า “${f.name}”? (ประวัติบิลยังคงอยู่)`, okText: 'ลบ', danger: true }))) return;
    await api(`/customers/${f.id}`, { method: 'DELETE' });
    toast('ลบลูกค้าแล้ว');
    setF(null);
    list.reload();
  };

  return (
    <div>
      <PageHead title="ลูกค้า" sub={`${list.data?.length || 0} รายชื่อ`}>
        <button className="btn btn-primary" onClick={() => { setErr(''); setF({ name: '', phone: '', lineId: '', note: '' }); }}>
          <Icon name="plus" /> เพิ่มลูกค้า
        </button>
      </PageHead>
      <div className="search search-block">
        <Icon name="search" size={18} />
        <input className="input" placeholder="ค้นหาชื่อ เบอร์โทร LINE ID" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.loading && !list.data ? <Loading /> : list.data?.length ? (
        <div className="card table-card">
          <table className="table table-rows-click">
            <thead><tr><th>ชื่อ</th><th className="hide-sm">ติดต่อ</th><th className="num">มา (ครั้ง)</th><th className="num">ยอดซื้อรวม</th><th className="hide-sm">ล่าสุด</th></tr></thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id} onClick={() => { setErr(''); setF({ ...c }); }}>
                  <td><b>{c.name}</b>{c.note && <div className="muted small">{c.note}</div>}</td>
                  <td className="hide-sm">{[c.phone, c.lineId && `LINE: ${c.lineId}`].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="num">{c.visits || 0}</td>
                  <td className="num">{baht(c.totalSpent)}</td>
                  <td className="hide-sm">{c.lastVisitAt ? thDate(c.lastVisitAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty icon="customers" title="ยังไม่มีลูกค้า" />}

      <Modal open={!!f} title={f?.id ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้า'} onClose={() => setF(null)}
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
              <Field label="ชื่อ *"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
              <Field label="เบอร์โทร"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
              <Field label="LINE ID"><input className="input" value={f.lineId} onChange={(e) => setF({ ...f, lineId: e.target.value })} /></Field>
            </div>
            <Field label="หมายเหตุ"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="เช่น ชอบหวานน้อย" /></Field>
            {err && <div className="field-error">{err}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
