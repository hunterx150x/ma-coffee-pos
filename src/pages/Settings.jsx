import { useEffect, useRef, useState } from 'react';
import { api, getToken } from '../api.js';
import { useAuth } from '../App.jsx';
import { today } from '../utils.js';
import { Field, Icon, Loading, PageHead, Toggle, useAsync, useUi } from '../components/ui.jsx';
import { thDateTime } from '../utils.js';
import QRCode from 'qrcode';
import { CONTACTS, ContactIcon } from '../components/Contacts.jsx';
import BankAccount from '../components/BankAccount.jsx';
import { checkThaiQr, thaiQrWithAmount } from '../../shared/thaiqr.js';
import { baht, promptPayPayload } from '../utils.js';

export default function Settings() {
  const { user } = useAuth();
  const { toast, confirm } = useUi();
  const s = useAsync(() => api('/settings'), []);
  const lineStatus = useAsync(() => api('/line/status'), []);
  const cats = useAsync(() => api('/categories'), []);
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
  const ln = { groupId: '', sale: true, void: true, lowStock: true, lead: true, leadGroupId: '', ...(f.line || {}) };
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
          <Field label="ระดับความหวาน (%)" hint="คั่นด้วยเครื่องหมายจุลภาค เช่น 0, 25, 50, 75, 100">
            <input className="input" value={levels} onChange={(e) => setLevels(e.target.value)} />
          </Field>
        </div>
        <PaymentCard pay={{ mode: 'promptpay', shopQr: '', bankName: '', accountNo: '', accountName: '', ...(f.payment || {}) }}
          promptPayId={f.promptPayId} setPromptPayId={(v) => setF({ ...f, promptPayId: v })}
          setPay={(payment) => setF({ ...f, payment })} />
        <LoyaltyCard loyalty={{ enabled: true, cupsPerReward: 9, rewardMaxValue: 40, excludeCategoryIds: [], ...(f.loyalty || {}) }}
          categories={cats.data || []} setLoyalty={(loyalty) => setF({ ...f, loyalty })} />
        <ContactsCard contacts={f.contacts || {}} setContacts={(contacts) => setF({ ...f, contacts })} />
        <SelfOrderCard so={{ enabled: true, message: '', ...(f.selfOrder || {}) }} setSo={(so) => setF({ ...f, selfOrder: so })} />
        <LineCard ln={ln} setLine={setLine} status={lineStatus} onSaveFirst={save} />
        {user.role === 'owner' && <LeadsCard />}
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
        <Toggle checked={ln.lead} onChange={(v) => setLine({ lead: v })} label="แจ้งเมื่อมีคนขอทดลองใช้ระบบ (จากหน้า /system)" />
      </div>
      {ln.lead && (
        <div className="subcard">
          <Field label="ส่งแจ้งเตือนผู้สนใจไปที่กลุ่ม" hint="เว้นว่าง = ส่งเข้ากลุ่มเดียวกับแจ้งยอดขาย · แนะนำให้แยกเป็นกลุ่มส่วนตัว เพราะพนักงานร้านไม่ต้องเห็น">
            <input className="input" value={ln.leadGroupId} placeholder="ใช้กลุ่มเดียวกับแจ้งยอดขาย" onChange={(e) => setLine({ leadGroupId: e.target.value.trim() })} />
          </Field>
          {st?.groups?.length > 0 && (
            <div className="chips">
              <button className={`chip ${!ln.leadGroupId ? 'active' : ''}`} onClick={() => setLine({ leadGroupId: '' })}>กลุ่มเดียวกับยอดขาย</button>
              {st.groups.map((g) => (
                <button key={g.groupId} className={`chip ${ln.leadGroupId === g.groupId ? 'active' : ''}`} onClick={() => setLine({ leadGroupId: g.groupId })}>
                  {g.name || g.groupId.slice(0, 10) + '…'}
                </button>
              ))}
            </div>
          )}
          <p className="muted small">ถ้าต้องการกลุ่มส่วนตัว: สร้างกลุ่ม LINE ใหม่ (มีแค่คุณ) แล้วเชิญ LINE OA ของร้านเข้ากลุ่ม และพิมพ์อะไรก็ได้ 1 ข้อความ กลุ่มจะมาขึ้นให้เลือกด้านบน</p>
          <button className="btn btn-sm btn-outline align-start" disabled={!!busy} onClick={() => send('/line/test-lead', 'ส่งตัวอย่างแจ้งเตือนผู้สนใจแล้ว')}>
            <Icon name="check" size={16} /> ส่งตัวอย่างแจ้งเตือนผู้สนใจ
          </button>
        </div>
      )}
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

/** Stamp card rules: N cups = 1 free cup worth up to X baht; some categories (e.g. snacks) don't earn stamps. */
function LoyaltyCard({ loyalty, categories, setLoyalty }) {
  const toggleCat = (id) => setLoyalty({
    ...loyalty,
    excludeCategoryIds: loyalty.excludeCategoryIds.includes(id) ? loyalty.excludeCategoryIds.filter((x) => x !== id) : [...loyalty.excludeCategoryIds, id],
  });
  return (
    <div className="card form">
      <h3 className="card-title">สะสมแต้มสมาชิก</h3>
      <Toggle checked={loyalty.enabled} onChange={(v) => setLoyalty({ ...loyalty, enabled: v })} label="เปิดใช้ระบบสะสมแต้ม" />
      <div className="form-grid">
        <Field label="ซื้อครบกี่แก้ว แลกฟรี 1 แก้ว">
          <input className="input" type="number" inputMode="numeric" min={1} max={100} value={loyalty.cupsPerReward}
            onChange={(e) => setLoyalty({ ...loyalty, cupsPerReward: e.target.value })} />
        </Field>
        <Field label="แก้วฟรีราคาไม่เกิน (บาท)" hint="แพงกว่านี้ ลูกค้าจ่ายส่วนต่าง · 0 = ฟรีทั้งแก้ว">
          <input className="input" type="number" inputMode="decimal" min={0} value={loyalty.rewardMaxValue}
            onChange={(e) => setLoyalty({ ...loyalty, rewardMaxValue: e.target.value })} />
        </Field>
      </div>
      <Field label="หมวดที่ไม่ได้แต้ม และแลกไม่ได้">
        <div className="chips">
          {categories.map((c) => (
            <button key={c.id} className={`chip ${loyalty.excludeCategoryIds.includes(c.id) ? 'active' : ''}`} onClick={() => toggleCat(c.id)}>
              {c.icon} {c.name}
            </button>
          ))}
        </div>
      </Field>
      <p className="muted small">1 แก้ว = 1 แต้ม (ได้แต้มเมื่อชำระเงิน) · แก้วที่แลกฟรีไม่ได้แต้ม · ยกเลิกบิลแล้วแต้มคืนอัตโนมัติ · ใช้เบอร์โทรเป็นรหัสสมาชิก · แต้มไม่มีวันหมดอายุ</p>
    </div>
  );
}

/** People who asked for a free trial on the public /system page. */
function LeadsCard() {
  const leads = useAsync(() => api('/leads'), []);
  const { confirm } = useUi();
  const remove = async (l) => {
    if (!(await confirm({ message: `ลบรายชื่อ “${l.shop}”?`, okText: 'ลบ', danger: true }))) return;
    await api(`/leads/${l.id}`, { method: 'DELETE' });
    leads.reload();
  };
  return (
    <div className="card form">
      <h3 className="card-title">ผู้สนใจทดลองใช้ระบบ ({leads.data?.length || 0})</h3>
      <p className="muted small">จากหน้า <a className="link" href="/system" target="_blank" rel="noreferrer">/system</a> (ลิงก์ล่างสุดในหน้าสั่งของลูกค้า) · มีคนส่งใหม่จะแจ้งเข้ากลุ่ม LINE ด้วย</p>
      {leads.data?.length ? leads.data.map((l) => (
        <div key={l.id} className="lead-row">
          <div className="lead-main">
            <b>{l.shop}</b> · {l.name}
            <div className="small"><a className="link" href={`tel:${l.phone}`}>{l.phone}</a>{l.lineId ? ` · LINE ${l.lineId}` : ''} · <span className="muted">{thDateTime(l.createdAt)}</span></div>
            {l.note && <div className="muted small">{l.note}</div>}
          </div>
          <button className="icon-btn icon-btn-danger" aria-label="ลบ" onClick={() => remove(l)}><Icon name="trash" size={18} /></button>
        </div>
      )) : <div className="muted small">ยังไม่มีผู้สนใจ</div>}
    </div>
  );
}


/** Read a QR code from a photo / screenshot in the browser. */
async function decodeQrImage(file) {
  const { default: jsQR } = await import('jsqr');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('เปิดไฟล์รูปไม่ได้'));
      i.src = url;
    });
    // Try the photo at a few sizes: small QR in a big photo, or a tiny screenshot.
    for (const side of [1000, 1600, 600, Math.max(img.width, img.height)]) {
      const k = Math.min(1, side / Math.max(img.width, img.height)) || 1;
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const r = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
      if (r?.data) return r.data;
    }
    throw new Error('อ่าน QR จากรูปไม่ได้ — ลองครอปให้เห็น QR ชัดๆ หรือใช้ภาพหน้าจอจากแอปธนาคาร');
  } finally {
    URL.revokeObjectURL(url);
  }
}

const SAMPLE_AMOUNT = 50;

/** How customers transfer: the shop's own Thai QR (amount filled in per bill) or PromptPay, plus the account number. */
function PaymentCard({ pay, setPay, promptPayId, setPromptPayId }) {
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);
  const check = pay.shopQr ? checkThaiQr(pay.shopQr) : null;
  const set = (patch) => setPay({ ...pay, ...patch });

  useEffect(() => {
    setPreview(null);
    const payload = pay.mode === 'shopqr'
      ? (check?.ok ? thaiQrWithAmount(pay.shopQr, SAMPLE_AMOUNT) : null)
      : promptPayPayload(promptPayId, SAMPLE_AMOUNT);
    if (payload) QRCode.toDataURL(payload, { margin: 1, width: 200 }).then(setPreview).catch(() => setPreview(null));
  }, [pay.mode, pay.shopQr, promptPayId]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (file) => {
    if (!file) return;
    setErr('');
    try {
      const text = await decodeQrImage(file);
      const c = checkThaiQr(text);
      if (!c.ok) throw new Error(c.error);
      set({ shopQr: text, mode: 'shopqr' });
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="card form pay-card">
      <h3 className="card-title">การรับเงินโอน</h3>
      <div className="type-switch pay-mode" role="group" aria-label="วิธีรับเงินโอน">
        <button className={pay.mode === 'shopqr' ? 'active' : ''} onClick={() => set({ mode: 'shopqr' })}>QR ร้าน (บัญชีธนาคาร / K SHOP)</button>
        <button className={pay.mode !== 'shopqr' ? 'active' : ''} onClick={() => set({ mode: 'promptpay' })}>พร้อมเพย์</button>
      </div>

      {pay.mode === 'shopqr' ? (
        <>
          <p className="muted small">อัปโหลดรูป QR รับเงินของร้าน (QR แบบไม่ระบุยอด) — ระบบจะสร้าง QR ใหม่ที่ <b>ระบุยอดของแต่ละบิล</b> ให้ลูกค้าอัตโนมัติ ทั้งหน้าชำระเงินและหน้าคิวของลูกค้า</p>
          <div className="pay-upload">
            <button className="btn btn-outline" onClick={() => fileRef.current?.click()}><Icon name="upload" size={18} /> {pay.shopQr ? 'เปลี่ยนรูป QR' : 'อัปโหลดรูป QR ร้าน'}</button>
            {pay.shopQr && <button className="btn btn-ghost btn-danger-text" onClick={() => set({ shopQr: '' })}><Icon name="trash" size={16} /> ลบ</button>}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
          </div>
          {check?.ok && (
            <div className="pay-qr-info small">
              <Icon name="check" size={16} stroke={3} />
              <span>
                {check.info.kind === 'bill' ? `QR ร้านค้า · Biller ID ${check.info.billerId}${check.info.ref1 ? ` · Ref ${check.info.ref1}` : ''}` : check.info.kind === 'promptpay' ? `QR พร้อมเพย์ ${check.info.id}` : 'Thai QR'}
                {check.info.hasAmount && ' · QR นี้มียอดอยู่แล้ว ระบบจะแทนด้วยยอดของแต่ละบิล'}
              </span>
            </div>
          )}
          {pay.shopQr && check && !check.ok && <div className="field-error">{check.error}</div>}
        </>
      ) : (
        <Field label="เลขพร้อมเพย์ (เบอร์โทร / เลขบัตรประชาชน)" hint="ใช้สร้าง QR รับเงินโอนพร้อมยอดเงินอัตโนมัติ">
          <input className="input" inputMode="numeric" value={promptPayId || ''} onChange={(e) => setPromptPayId(e.target.value)} />
        </Field>
      )}
      {err && <div className="field-error">{err}</div>}

      {preview && (
        <div className="pay-preview">
          <img src={preview} alt={`ตัวอย่าง QR ${baht(SAMPLE_AMOUNT)}`} width="150" height="150" />
          <div className="small">
            <b>ตัวอย่าง: บิล {baht(SAMPLE_AMOUNT)}</b>
            <div className="muted">ลองสแกนด้วยแอปธนาคาร ควรเห็นชื่อร้านและยอด {baht(SAMPLE_AMOUNT)} — ตรวจสอบแล้วกดยกเลิกได้เลย ไม่ต้องโอนจริง</div>
          </div>
        </div>
      )}

      <div className="pay-bank">
        <div className="muted small">เลขบัญชีสำหรับลูกค้าที่โอนด้วยการกรอกเลขบัญชี (ไม่บังคับ)</div>
        <div className="form-grid">
          <Field label="ธนาคาร"><input className="input" value={pay.bankName} maxLength={60} onChange={(e) => set({ bankName: e.target.value })} placeholder="เช่น กสิกรไทย" list="bank-names" /></Field>
          <Field label="เลขบัญชี"><input className="input" inputMode="numeric" value={pay.accountNo} maxLength={30} onChange={(e) => set({ accountNo: e.target.value })} placeholder="เช่น 123-4-56789-0" /></Field>
          <Field label="ชื่อบัญชี"><input className="input" value={pay.accountName} maxLength={80} onChange={(e) => set({ accountName: e.target.value })} placeholder="ชื่อบัญชีตามธนาคาร" /></Field>
        </div>
        <datalist id="bank-names">{['กสิกรไทย', 'ไทยพาณิชย์', 'กรุงเทพ', 'กรุงไทย', 'กรุงศรีอยุธยา', 'ทีทีบี', 'ออมสิน', 'ธ.ก.ส.'].map((b) => <option key={b} value={b} />)}</datalist>
        {pay.accountNo && <BankAccount payment={pay} compact />}
      </div>
    </div>
  );
}
