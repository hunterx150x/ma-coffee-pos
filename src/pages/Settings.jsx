import { useEffect, useRef, useState } from 'react';
import { api, getToken } from '../api.js';
import { useAuth } from '../App.jsx';
import { today } from '../utils.js';
import { Field, Icon, Loading, PageHead, useAsync, useUi } from '../components/ui.jsx';

export default function Settings() {
  const { user } = useAuth();
  const { toast, confirm } = useUi();
  const s = useAsync(() => api('/settings'), []);
  const [f, setF] = useState(null);
  const [levels, setLevels] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (s.data) {
      setF({ ...s.data });
      setLevels((s.data.sweetnessLevels || []).join(', '));
    }
  }, [s.data]);

  if (!f) return <Loading />;

  const save = async () => {
    try {
      const sweetnessLevels = levels.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n));
      const r = await api('/settings', { method: 'PUT', body: { ...f, sweetnessLevels } });
      s.setData(r);
      toast('บันทึกการตั้งค่าแล้ว');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const backup = async () => {
    const res = await fetch('/api/backup', { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) return toast('สำรองข้อมูลไม่สำเร็จ', 'error');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ma-coffee-backup-${today()}.json`;
    a.click();
  };

  const restore = async (file) => {
    if (!file) return;
    if (!(await confirm({ title: 'กู้คืนข้อมูล', message: 'ข้อมูลปัจจุบันทั้งหมดจะถูกแทนที่ด้วยไฟล์สำรอง ต้องการดำเนินการต่อหรือไม่?', okText: 'กู้คืน', danger: true }))) return;
    try {
      const data = JSON.parse(await file.text());
      await api('/restore', { method: 'POST', body: data });
      toast('กู้คืนข้อมูลแล้ว');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      toast(e.message || 'ไฟล์ไม่ถูกต้อง', 'error');
    }
  };

  return (
    <div>
      <PageHead title="ตั้งค่าร้าน">
        <button className="btn btn-primary" onClick={save}><Icon name="check" /> บันทึก</button>
      </PageHead>
      <div className="settings-grid">
        <div className="card form">
          <h3 className="card-title">ข้อมูลร้าน (แสดงบนใบเสร็จ)</h3>
          <Field label="ชื่อร้าน"><input className="input" value={f.shopName} onChange={(e) => setF({ ...f, shopName: e.target.value })} /></Field>
          <Field label="ที่อยู่"><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="เบอร์โทร"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="ข้อความท้ายใบเสร็จ"><input className="input" value={f.receiptFooter} onChange={(e) => setF({ ...f, receiptFooter: e.target.value })} /></Field>
        </div>
        <div className="card form">
          <h3 className="card-title">การขาย</h3>
          <Field label="เลขพร้อมเพย์ (เบอร์โทร / เลขบัตรประชาชน)" hint="ใช้สร้าง QR รับเงินโอนพร้อมยอดเงินอัตโนมัติ">
            <input className="input" inputMode="numeric" value={f.promptPayId} onChange={(e) => setF({ ...f, promptPayId: e.target.value })} />
          </Field>
          <Field label="ระดับความหวาน (%)" hint="คั่นด้วยเครื่องหมายจุลภาค เช่น 0, 25, 50, 75, 100">
            <input className="input" value={levels} onChange={(e) => setLevels(e.target.value)} />
          </Field>
        </div>
        {user.role === 'owner' && (
          <div className="card form">
            <h3 className="card-title">สำรอง / กู้คืนข้อมูล</h3>
            <p className="muted small">แนะนำให้สำรองข้อมูลเป็นประจำ ไฟล์ประกอบด้วยเมนู สต๊อก บิล ลูกค้า และผู้ใช้ทั้งหมด</p>
            <div className="form-actions form-actions-left">
              <button className="btn btn-outline" onClick={backup}><Icon name="download" /> ดาวน์โหลดไฟล์สำรอง</button>
              <button className="btn btn-ghost btn-danger-text" onClick={() => fileRef.current?.click()}><Icon name="upload" /> กู้คืนจากไฟล์</button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { restore(e.target.files[0]); e.target.value = ''; }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
