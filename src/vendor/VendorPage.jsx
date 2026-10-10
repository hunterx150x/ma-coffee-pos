// Public sales page for the POS itself (/system): features, pricing, free trial, contact + trial request form.
import { useState } from 'react';
import { VENDOR } from '../../shared/vendor.js';
import { Icon } from '../components/ui.jsx';
import { ContactIcon } from '../components/Contacts.jsx';

const FEATURES = [
  { icon: 'pos', title: 'ขายง่ายเป็นขั้นตอน', text: 'เลือกเมนู ความหวาน ท็อปปิ้ง ส่วนลด ใช้ได้ทั้งมือถือและ iPad' },
  { icon: 'qr', title: 'ลูกค้าสแกนสั่งเอง', text: 'ออเดอร์เข้าคิวทันที ลูกค้าดูลำดับคิวบนมือถือแบบเรียลไทม์' },
  { icon: 'cash', title: 'รับเงินสด / พร้อมเพย์', text: 'QR พร้อมเพย์ใส่ยอดอัตโนมัติ ลูกค้าแจ้งโอนพร้อมสลิปได้' },
  { icon: 'stock', title: 'สต๊อกตัดอัตโนมัติ', text: 'ตั้งสูตรต่อแก้ว รู้ต้นทุนและกำไรต่อแก้ว แจ้งเตือนของใกล้หมด' },
  { icon: 'reports', title: 'รายงานกำไร-ขาดทุน', text: 'แยกเงินสด เงินโอน รายวัน รายเดือน เมนูขายดี ส่งออก CSV' },
  { icon: 'users', title: 'สะสมแต้ม + LINE', text: 'บัตรสะสมแต้มด้วยเบอร์โทร และแจ้งยอดขายเข้ากลุ่ม LINE' },
];

const nf = new Intl.NumberFormat('th-TH');

export default function VendorPage() {
  const c = VENDOR.contact;
  const contacts = [
    c.line && { key: 'line', label: c.lineId ? `LINE: ${c.lineId}` : 'ทัก LINE', href: c.line, color: '#06C755' },
    c.phone && { key: 'phone', label: `โทร ${c.phone}`, href: `tel:${c.phone.replace(/[^0-9+]/g, '')}`, color: '#6f4e37' },
    c.facebook && { key: 'facebook', label: 'Facebook', href: c.facebook, color: '#1877F2' },
  ].filter(Boolean);

  return (
    <div className="vd">
      <header className="vd-hero">
        <img src="/icon.svg" alt="" width="56" height="56" />
        <h1>{VENDOR.productName}</h1>
        <p>{VENDOR.tagline}</p>
        <a className="btn btn-lg vd-cta" href="#trial">ทดลองใช้ฟรี {VENDOR.trialDays / 30 >= 1 ? `${Math.round(VENDOR.trialDays / 30)} เดือน` : `${VENDOR.trialDays} วัน`}</a>
        <div className="vd-hero-note">ไม่ต้องใช้บัตรเครดิต · ช่วยตั้งเมนูให้ · ใช้ได้ทันทีบนมือถือ / iPad</div>
      </header>

      <section className="vd-sec">
        <h2>ทำอะไรได้บ้าง</h2>
        <div className="vd-features">
          {FEATURES.map((f) => (
            <div key={f.title} className="vd-feature">
              <span className="vd-feature-ic"><Icon name={f.icon} size={22} /></span>
              <b>{f.title}</b>
              <span>{f.text}</span>
            </div>
          ))}
        </div>
        <p className="vd-demo">ใช้งานจริงในร้านกาแฟแล้ว — หน้าที่คุณเพิ่งสแกนสั่งเครื่องดื่มคือตัวอย่างหนึ่งของระบบนี้</p>
      </section>

      <section className="vd-sec">
        <h2>ราคา</h2>
        <div className="vd-plans">
          {VENDOR.plans.map((p) => (
            <div key={p.key} className={`vd-plan ${p.highlight ? 'hl' : ''}`}>
              {p.highlight && <span className="vd-plan-tag">แนะนำ</span>}
              <div className="vd-plan-name">{p.name}</div>
              <div className="vd-plan-price">฿{nf.format(p.price)}<small> / เดือน / ร้าน</small></div>
              <ul>{p.features.map((x) => <li key={x}><Icon name="check" size={16} stroke={3} /> {x}</li>)}</ul>
            </div>
          ))}
        </div>
        <ul className="vd-terms">
          <li><b>ทดลองใช้ฟรี {VENDOR.trialDays} วัน</b> ทุกแพ็กเกจ ไม่พอใจไม่ต้องจ่าย</li>
          {VENDOR.setupFee > 0 && <li>ค่าติดตั้งครั้งเดียว ฿{nf.format(VENDOR.setupFee)} — ลงเมนู สูตร สต๊อก ทำ QR หน้าร้าน และสอนพนักงาน (จ่ายเมื่อใช้ต่อหลังทดลอง)</li>}
          {VENDOR.yearlyNote && <li>{VENDOR.yearlyNote}</li>}
          <li>ข้อมูลเป็นของร้าน ขอสำเนาข้อมูลได้ทุกเมื่อ</li>
        </ul>
      </section>

      <section className="vd-sec" id="trial">
        <h2>ขอทดลองใช้ฟรี</h2>
        {c.name && <p className="vd-by">ติดต่อ <b>{c.name}</b> ได้เลย หรือกรอกแบบฟอร์มด้านล่างแล้วเราจะติดต่อกลับ</p>}
        {contacts.length > 0 && (
          <div className="vd-contacts">
            {contacts.map((x) => (
              <a key={x.key} className="vd-contact" href={x.href} target={x.key === 'phone' ? undefined : '_blank'} rel="noopener noreferrer">
                <span className="contact-icon contact-icon-sm" style={{ background: x.color }}><ContactIcon name={x.key} size={16} /></span>{x.label}
              </a>
            ))}
            {c.email && <a className="vd-contact" href={`mailto:${c.email}`}>✉️ {c.email}</a>}
          </div>
        )}
        <TrialForm />
      </section>
      <footer className="vd-foot">{VENDOR.productName}{c.name ? ` · พัฒนาและดูแลโดย ${c.name}` : ''}</footer>
    </div>
  );
}

function TrialForm() {
  const [f, setF] = useState({ name: '', shop: '', phone: '', lineId: '', note: '', consent: false });
  const [state, setState] = useState({ busy: false, done: false, error: '' });
  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true, done: false, error: '' });
    try {
      const res = await fetch('/api/public/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'ส่งไม่สำเร็จ');
      setState({ busy: false, done: true, error: '' });
    } catch (ex) {
      setState({ busy: false, done: false, error: ex.message });
    }
  };
  if (state.done) {
    return <div className="vd-done"><Icon name="check" size={22} stroke={3} /> ได้รับข้อมูลแล้ว เราจะติดต่อกลับเพื่อเปิดทดลองใช้ฟรีโดยเร็วที่สุด</div>;
  }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="vd-form" onSubmit={submit}>
      <div className="form-grid">
        <label className="field"><span className="field-label">ชื่อของคุณ *</span><input className="input" value={f.name} onChange={set('name')} maxLength={60} required /></label>
        <label className="field"><span className="field-label">ชื่อร้าน *</span><input className="input" value={f.shop} onChange={set('shop')} maxLength={80} required /></label>
        <label className="field"><span className="field-label">เบอร์โทร *</span><input className="input" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} maxLength={20} required /></label>
        <label className="field"><span className="field-label">LINE ID</span><input className="input" value={f.lineId} onChange={set('lineId')} maxLength={40} /></label>
      </div>
      <label className="field"><span className="field-label">อยากได้ฟีเจอร์ไหนเป็นพิเศษ / ข้อความเพิ่มเติม</span>
        <textarea className="input" rows={3} value={f.note} onChange={set('note')} maxLength={500} />
      </label>
      <label className="vd-consent">
        <input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />
        ยินยอมให้ติดต่อกลับตามข้อมูลนี้ เพื่อแนะนำและเปิดทดลองใช้ระบบเท่านั้น
      </label>
      {state.error && <div className="field-error">{state.error}</div>}
      <button className="btn btn-primary btn-lg btn-block" disabled={state.busy || !f.consent}>{state.busy ? 'กำลังส่ง...' : 'ขอทดลองใช้ฟรี'}</button>
    </form>
  );
}
