import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { baht, presetRange, thDateTime, thTime } from '../utils.js';
import { DateRange, Empty, ErrorBox, Icon, Loading, Modal, PageHead, Tabs, useAsync, useUi, Field } from '../components/ui.jsx';
import Receipt, { printReceipt } from '../components/Receipt.jsx';

export default function Orders() {
  const { user } = useAuth();
  const { toast } = useUi();
  const [range, setRange] = useState(presetRange('today'));
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState('');
  const orders = useAsync(() => api('/orders', { query: { ...range, method, q } }), [range.from, range.to, method, q]);
  const settings = useAsync(() => api('/settings'), []);

  const list = orders.data || [];
  const paid = list.filter((o) => o.status === 'paid');
  const total = paid.reduce((s, o) => s + o.total, 0);

  const doVoid = async () => {
    try {
      const o = await api(`/orders/${open.id}/void`, { method: 'POST', body: { reason } });
      setOpen(o);
      setVoidOpen(false);
      setReason('');
      toast('ยกเลิกบิลแล้ว และคืนสต๊อกเรียบร้อย');
      orders.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div>
      <PageHead title="ประวัติการขาย" sub={`${paid.length} บิล · ยอดรวม ${baht(total)}`} />
      <div className="card filters">
        <DateRange value={range} onChange={setRange} />
        <div className="filters-row">
          <div className="search">
            <Icon name="search" size={18} />
            <input className="input" placeholder="ค้นหาเลขบิล / ชื่อลูกค้า" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Tabs value={method} onChange={setMethod} tabs={[
            { key: '', label: 'ทั้งหมด' }, { key: 'cash', label: 'เงินสด' }, { key: 'transfer', label: 'เงินโอน' },
          ]} />
        </div>
      </div>

      {orders.loading && !orders.data ? <Loading /> : orders.error ? <ErrorBox error={orders.error} onRetry={orders.reload} /> : list.length ? (
        <div className="card table-card">
          <table className="table table-rows-click">
            <thead>
              <tr>
                <th>เลขบิล</th><th>เวลา</th><th className="hide-sm">ลูกค้า</th><th className="hide-sm">รายการ</th>
                <th>ชำระ</th><th className="num">ยอด</th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} onClick={() => setOpen(o)} className={o.status === 'void' ? 'row-void' : ''}>
                  <td><b>{o.orderNo}</b>{o.status === 'void' && <span className="badge badge-danger">ยกเลิก</span>}</td>
                  <td>{range.from === range.to ? thTime(o.createdAt) : thDateTime(o.createdAt)}</td>
                  <td className="hide-sm">{o.customerName}</td>
                  <td className="hide-sm muted">{o.items.map((l) => `${l.qty}×${l.name}`).join(', ')}</td>
                  <td><span className={`badge ${o.paymentMethod === 'cash' ? 'badge-cash' : 'badge-transfer'}`}>{o.paymentMethod === 'cash' ? 'เงินสด' : 'โอน'}</span></td>
                  <td className="num"><b>{baht(o.total)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty icon="orders" title="ไม่มีบิลในช่วงเวลานี้" />}

      <Modal open={!!open} title={`บิล ${open?.orderNo || ''}`} onClose={() => setOpen(null)}
        footer={open && (
          <>
            {user.role === 'owner' && open.status === 'paid' && (
              <button className="btn btn-danger-text btn-ghost" onClick={() => setVoidOpen(true)}><Icon name="ban" /> ยกเลิกบิล</button>
            )}
            <button className="btn btn-outline" onClick={printReceipt}><Icon name="print" /> พิมพ์</button>
            <button className="btn btn-primary" onClick={() => setOpen(null)}>ปิด</button>
          </>
        )}>
        {open && (
          <>
            {open.status === 'void' && (
              <div className="error-box">ยกเลิกโดย {open.voidedBy} · {thDateTime(open.voidedAt)}{open.voidReason ? ` · ${open.voidReason}` : ''}</div>
            )}
            <Receipt order={open} settings={settings.data} />
          </>
        )}
      </Modal>

      <Modal open={voidOpen} title="ยกเลิกบิล" size="sm" onClose={() => setVoidOpen(false)}
        footer={(
          <>
            <button className="btn btn-ghost" onClick={() => setVoidOpen(false)}>ไม่ยกเลิก</button>
            <button className="btn btn-danger" onClick={doVoid}>ยืนยันยกเลิกบิล</button>
          </>
        )}>
        <p>บิล {open?.orderNo} ยอด {baht(open?.total)} จะไม่ถูกนับในรายงาน และวัตถุดิบจะถูกคืนเข้าสต๊อก</p>
        <Field label="เหตุผล">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น คีย์ผิด, ลูกค้ายกเลิก" />
        </Field>
      </Modal>
    </div>
  );
}
