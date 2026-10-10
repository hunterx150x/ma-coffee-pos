import { useEffect, useRef, useState } from 'react';
import { api, getToken } from '../api.js';
import { useAuth } from '../App.jsx';
import { today } from '../utils.js';
import { Field, Icon, Loading, PageHead, Toggle, useAsync, useUi } from '../components/ui.jsx';
import { thDateTime } from '../utils.js';
import QRCode from 'qrcode';
import { CONTACTS, ContactIcon } from '../components/Contacts.jsx';

export default function Settings() {
  const { user } = useAuth();
  const { toast, confirm } = useUi();
  const s = useAsync(() => api('/settings'), []);
  const lineStatus = useAsync(() => api('/line/status'), []);
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
  const ln = { groupId: '', sale: true, void: true, lowStock: true, ...(f.line || {}) };
  const setLine = (patch) => setF({ ...f, line: { ...ln, ...patch } });

  const save = async () => {
    try {
      const sweetnessLevels = levels.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n));
      const r = await api('/settings', { method: 'PUT', body: { ...f, sweetnessLevels } });
      lineStatus.reload();
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
          <Field label="เบอร์โทร" hint="แสดงเป็นปุ่มโทรหาร้านในหน้าคิวของลูกค้าด้วย"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
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
        <ContactsCard contacts={f.contacts || {}} setContacts={(contacts) => setF({ ...f, contacts })} />
        <SelfOrderCard so={{ enabled: true, message: '', ...(f.selfOrder || {}) }} setSo={(so) => setF({ ...f, selfOrder: so })} />
        <LineCard ln={ln} setLine={setLine} status={lineStatus} onSaveFirst={save} />
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

function LineCard({ ln, setLine, status, onSaveFirst }) {
  const { toast } = useUi();
  const [busy, setBusy] = useState('');
  const st = status.data;
  const webhookUrl = `${window.location.origin}/api/line/webhook`;
  const send = async (path, ok) => {
    setBusy(path);
    try {
      await onSaveFirst();
      await api(path, { method: 'POST' });
      toast(ok);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
      status.reload();
    }
  };
  return (
    <div className="card form">
      <h3 className="card-title">แจ้งเตือน LINE (กลุ่มของร้าน)</h3>
      {st && (
        <div className={`line-status ${st.configured ? 'ok' : 'off'}`}>
          <Icon name={st.configured ? 'check' : 'alert'} size={16} />
          {st.configured ? 'เชื่อมต่อ LINE Official Account แล้ว' : 'ยังไม่ได้ตั้งค่า token บนเซิร์ฟเวอร์ (LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET)'}
        </div>
      )}
      <Field label="Group ID ที่จะส่งแจ้งเตือน" hint={st?.envGroupId && !ln.groupId ? `ถ้าเว้นว่างจะใช้ค่าจากเซิร์ฟเวอร์: ${st.envGroupId}` : 'ขึ้นต้นด้วย C'}>
        <input className="input" value={ln.groupId} placeholder={st?.envGroupId || 'Cxxxxxxxx...'} onChange={(e) => setLine({ groupId: e.target.value.trim() })} />
      </Field>
      {st?.groups?.length > 0 && (
        <div className="chips">
          {st.groups.map((g) => (
            <button key={g.groupId} className={`chip ${(ln.groupId || st.envGroupId) === g.groupId ? 'active' : ''}`} onClick={() => setLine({ groupId: g.groupId })}>
              {g.name || g.groupId.slice(0, 10) + '…'}
            </button>
          ))}
        </div>
      )}
      <div className="toggle-list">
        <Toggle checked={ln.sale} onChange={(v) => setLine({ sale: v })} label="แจ้งทุกครั้งที่ขาย (รายละเอียดบิล + ยอดขายวันนี้)" />
        <Toggle checked={ln.void} onChange={(v) => setLine({ void: v })} label="แจ้งเมื่อยกเลิกบิล" />
        <Toggle checked={ln.lowStock} onChange={(v) => setLine({ lowStock: v })} label="แจ้งเมื่อวัตถุดิบลดลงถึงจุดขั้นต่ำ" />
      </div>
      <div className="form-actions form-actions-left">
        <button className="btn btn-outline" disabled={!!busy} onClick={() => send('/line/test', 'ส่งข้อความทดสอบแล้ว')}><Icon name="check" /> ส่งข้อความทดสอบ</button>
        <button className="btn btn-outline" disabled={!!busy} onClick={() => send('/line/summary', 'ส่งสรุปยอดวันนี้แล้ว')}><Icon name="reports" /> ส่งสรุปยอดวันนี้</button>
      </div>
      {st?.lastError && <div className="field-error">ส่งล่าสุดไม่สำเร็จ: {st.lastError}</div>}
      {st?.lastSentAt && <div className="muted small">ส่งสำเร็จล่าสุด {thDateTime(st.lastSentAt)}</div>}
      <details className="line-help">
        <summary>Webhook และคำสั่งในกลุ่ม</summary>
        <p className="small">ตั้ง Webhook URL ใน LINE Developers → Messaging API เป็น<br /><code>{webhookUrl}</code><br />แล้วเปิด “Use webhook” — ระบบจะจำกลุ่มที่เชิญ OA เข้าไปให้เลือกด้านบน</p>
        <p className="small">พิมพ์ในกลุ่มของร้าน (ตอบกลับฟรี ไม่ใช้โควตา): <b>ยอดวันนี้</b> = สรุปยอดขาย · <b>สต๊อก</b> = วัตถุดิบใกล้หมด</p>
        <p className="small muted">หมายเหตุ: ข้อความที่ส่งเข้ากลุ่มนับโควตาตามจำนวนสมาชิกในกลุ่ม ถ้าโควตาไม่พอให้ปิด “แจ้งทุกครั้งที่ขาย” แล้วใช้คำสั่ง “ยอดวันนี้” แทน</p>
      </details>
    </div>
  );
}

/** Public "scan to order" link for customers, with a printable QR code. */
function SelfOrderCard({ so, setSo }) {
  const url = `${window.location.origin}/order`;
  const [qr, setQr] = useState(null);
  const { toast } = useUi();
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 480 }).then(setQr).catch(() => setQr(null));
  }, [url]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('คัดลอกลิงก์แล้ว');
    } catch {
      toast(url);
    }
  };
  return (
    <div className="card form">
      <h3 className="card-title">ลูกค้าสแกนสั่งเอง (QR หน้าร้าน)</h3>
      <Toggle checked={so.enabled} onChange={(v) => setSo({ ...so, enabled: v })} label="เปิดรับออเดอร์จากลูกค้า" />
      <div className="selforder">
        {qr && (
          <div className="selforder-qr" id="selforder-qr">
            <img src={qr} alt="QR สั่งเครื่องดื่ม" />
            <div className="selforder-qr-text">สแกนเพื่อสั่งเครื่องดื่ม<br /><small>ชำระเงินที่หน้าร้าน</small></div>
          </div>
        )}
        <div className="selforder-side">
          <code className="selforder-url">{url}</code>
          <div className="form-actions form-actions-left">
            <button className="btn btn-sm btn-outline" onClick={copy}>คัดลอกลิงก์</button>
            <a className="btn btn-sm btn-outline" href={url} target="_blank" rel="noreferrer">เปิดดูหน้าลูกค้า</a>
            {qr && <a className="btn btn-sm btn-outline" href={qr} download="ma-coffee-order-qr.png"><Icon name="download" size={16} /> ดาวน์โหลด QR</a>}
            {qr && (
              <button className="btn btn-sm btn-outline" onClick={() => {
                document.body.classList.add('printing-qr');
                setTimeout(() => { window.print(); document.body.classList.remove('printing-qr'); }, 50);
              }}><Icon name="print" size={16} /> พิมพ์ QR</button>
            )}
          </div>
          <p className="muted small">ออเดอร์จากลูกค้าจะเข้าเมนู “คิว” ทันที (มีป้าย 📱 สั่งเอง) ลูกค้าดูลำดับคิวของตัวเองได้แบบ realtime ส่วนลดให้พนักงานกดเพิ่มตอนชำระเงินไม่ได้ — ถ้าต้องให้ส่วนลด ให้ขายผ่านหน้าขายหน้าร้านแทน</p>
          {!so.enabled && (
            <Field label="ข้อความเมื่อปิดรับออเดอร์">
              <input className="input" value={so.message} placeholder="เช่น วันนี้ร้านปิด 18:00 น." onChange={(e) => setSo({ ...so, message: e.target.value })} />
            </Field>
          )}
        </div>
      </div>
    </div>
  );
}

const CONTACT_HINTS = {
  facebook: 'https://www.facebook.com/ชื่อเพจ',
  instagram: 'https://www.instagram.com/ชื่อบัญชี',
  line: 'https://lin.ee/xxxx (ลิงก์เพิ่มเพื่อน LINE OA)',
  tiktok: 'https://www.tiktok.com/@ชื่อบัญชี',
  map: 'https://maps.app.goo.gl/xxxx',
};

/** Social / contact links shown as icons on the customer's queue page. Empty = hidden. */
function ContactsCard({ contacts, setContacts }) {
  return (
    <div className="card form">
      <h3 className="card-title">ช่องทางติดต่อ (แสดงในหน้าคิวของลูกค้า)</h3>
      <p className="muted small">เว้นว่างช่องที่ไม่ใช้ ไอคอนนั้นจะไม่แสดง · บนมือถือที่มีแอปติดตั้งไว้ ลิงก์จะเปิดในแอปให้อัตโนมัติ</p>
      {CONTACTS.map((c) => (
        <Field key={c.key} label={(
          <span className="contact-field-label"><span className="contact-icon contact-icon-sm" style={{ background: c.color }}><ContactIcon name={c.key} size={16} /></span>{c.label}</span>
        )}>
          <input className="input" type="url" inputMode="url" value={contacts[c.key] || ''} placeholder={CONTACT_HINTS[c.key]}
            onChange={(e) => setContacts({ ...contacts, [c.key]: e.target.value.trim() })} />
        </Field>
      ))}
    </div>
  );
}

