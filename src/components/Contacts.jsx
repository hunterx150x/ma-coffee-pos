// Shop contact links shown to customers (Facebook, Instagram, LINE, TikTok, Maps, phone).
// Plain https links: on phones with the app installed, Facebook / Instagram / LINE / TikTok open in their app.

const ICONS = {
  facebook: <path fill="currentColor" d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.4H8v3h2.6V21h2.9z" />,
  instagram: (
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" />
    </g>
  ),
  line: (
    <g>
      <path fill="currentColor" d="M12 3.5c-5 0-9 3.2-9 7.2 0 3.6 3.2 6.6 7.5 7.1.3.1.7.2.8.5.1.2.1.6 0 .9l-.1.8c0 .2-.2.9.8.5s5.4-3.2 7.3-5.4c1.3-1.4 1.9-2.9 1.9-4.4 0-4-4-7.2-9-7.2z" />
      <path fill="#fff" d="M7.2 12.9V9.2h.9v2.9h1.6v.8H7.2zm3.2 0V9.2h.9v3.7h-.9zm1.8 0V9.2h.8l1.6 2.2V9.2h.9v3.7h-.8l-1.6-2.2v2.2h-.9zm4.2 0V9.2h2.4v.8h-1.5v.6h1.5v.8h-1.5v.6h1.5v.9h-2.4z" />
    </g>
  ),
  tiktok: <path fill="currentColor" d="M16.6 3h-3v12.2a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.6a5.6 5.6 0 1 0 4.8 5.6V9.1a7.3 7.3 0 0 0 3.9 1.2v-3a4.1 4.1 0 0 1-3.9-4.3z" />,
  map: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </g>
  ),
  phone: <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />,
};

export const CONTACTS = [
  { key: 'facebook', label: 'Facebook', color: '#1877F2' },
  { key: 'instagram', label: 'Instagram', color: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)' },
  { key: 'line', label: 'LINE', color: '#06C755' },
  { key: 'tiktok', label: 'TikTok', color: '#111111' },
  { key: 'map', label: 'แผนที่ร้าน', color: '#EA4335' },
];

export function ContactIcon({ name, size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;
}

export default function ContactBar({ contacts = {}, phone }) {
  const items = CONTACTS.filter((c) => contacts[c.key]).map((c) => ({ ...c, href: contacts[c.key] }));
  const tel = String(phone || '').replace(/[^0-9+]/g, '');
  if (tel) items.push({ key: 'phone', label: 'โทรหาร้าน', color: '#6f4e37', href: `tel:${tel}` });
  if (!items.length) return null;
  return (
    <section className="contact-bar" aria-label="ช่องทางติดต่อร้าน">
      <div className="contact-title">ติดต่อร้าน / ติดตามเรา</div>
      <div className="contact-list">
        {items.map((c) => (
          <a key={c.key} className="contact-item" href={c.href} target={c.key === 'phone' ? undefined : '_blank'} rel="noopener noreferrer">
            <span className="contact-icon" style={{ background: c.color }}><ContactIcon name={c.key} /></span>
            <span className="contact-label">{c.label}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
