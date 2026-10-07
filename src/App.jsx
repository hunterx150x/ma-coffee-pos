import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { initial } from './utils.js';
import { onRealtime } from './realtime.js';
import { hasPerm, ROLES } from '../shared/permissions.js';
import { Icon, Loading, Modal, Field, useUi } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Pos from './pages/Pos.jsx';
import Queue from './pages/Queue.jsx';
import Orders from './pages/Orders.jsx';
import Reports from './pages/Reports.jsx';
import Products from './pages/Products.jsx';
import Stock from './pages/Stock.jsx';
import Expenses from './pages/Expenses.jsx';
import Customers from './pages/Customers.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export const ROUTES = [
  { key: 'pos', label: 'ขายหน้าร้าน', icon: 'pos', perm: 'pos', component: Pos },
  { key: 'queue', label: 'คิว', icon: 'queue', perm: 'queue', component: Queue },
  { key: 'orders', label: 'ประวัติการขาย', icon: 'orders', perm: 'orders', component: Orders },
  { key: 'reports', label: 'รายงาน', icon: 'reports', perm: 'reports', component: Reports },
  { key: 'products', label: 'เมนู & ราคา', icon: 'products', perm: 'products', component: Products },
  { key: 'stock', label: 'สต๊อก', icon: 'stock', perm: 'stock', component: Stock },
  { key: 'expenses', label: 'ค่าใช้จ่าย', icon: 'expenses', perm: 'expenses', component: Expenses },
  { key: 'customers', label: 'ลูกค้า', icon: 'customers', perm: 'customers', component: Customers },
  { key: 'users', label: 'ผู้ใช้ & สิทธิ์', icon: 'users', perm: 'users', component: Users },
  { key: 'settings', label: 'ตั้งค่าร้าน', icon: 'settings', perm: 'settings', component: Settings },
];

function useHashRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('?')[0];
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((r) => {
    window.location.hash = `/${r}`;
  }, []);
  return [route, go];
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(!!getToken());
  const [route, go] = useHashRoute();
  const [navOpen, setNavOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [openQueues, setOpenQueues] = useState(0);

  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('pos:logout', out);
    return () => window.removeEventListener('pos:logout', out);
  }, []);

  // Badge with today's unpaid queues, refreshed in the background.
  useEffect(() => {
    if (!user || !hasPerm(user, 'queue')) return undefined;
    let alive = true;
    const load = () => api('/queues/open-count').then((r) => alive && setOpenQueues(r.count)).catch(() => {});
    load();
    const off = onRealtime(['queues', 'resync'], load);
    const t = setInterval(load, 60000);
    window.addEventListener('hashchange', load);
    window.addEventListener('pos:queues-changed', load);
    return () => {
      alive = false;
      off();
      clearInterval(t);
      window.removeEventListener('hashchange', load);
      window.removeEventListener('pos:queues-changed', load);
    };
  }, [user]);

  const logout = () => {
    setToken(null);
    setUser(null);
    go('');
  };

  if (checking) return <div className="center-screen"><Loading /></div>;
  if (!user) {
    return <Login onLogin={(token, u) => { setToken(token); setUser(u); }} />;
  }

  const allowed = ROUTES.filter((r) => hasPerm(user, r.perm));
  const current = allowed.find((r) => r.key === route) || allowed[0];
  const Page = current?.component;
  // Bottom bar on phones shows the first few routes, the rest live in the drawer.
  const bottom = allowed.slice(0, 4);

  return (
    <AuthCtx.Provider value={{ user, setUser, logout, can: (p) => hasPerm(user, p) }}>
      <div className={`app ${navOpen ? 'nav-open' : ''}`}>
        <aside className="sidebar">
          <div className="brand">
            <img src="/icon.svg" alt="" width="36" height="36" />
            <div>
              <div className="brand-name">MA Coffee</div>
              <div className="brand-sub">ระบบขายหน้าร้าน</div>
            </div>
          </div>
          <nav className="nav">
            {allowed.map((r) => (
              <a key={r.key} href={`#/${r.key}`} className={`nav-item ${current?.key === r.key ? 'active' : ''}`}
                onClick={() => setNavOpen(false)}>
                <Icon name={r.icon} />
                <span>{r.label}</span>
                {r.key === 'queue' && openQueues > 0 && <span className="nav-badge">{openQueues}</span>}
              </a>
            ))}
          </nav>
          <div className="sidebar-user">
            <div className="avatar">{initial(user.name)}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user.name}</div>
              <div className="muted small">{ROLES[user.role]}</div>
            </div>
            <button className="icon-btn" title="เปลี่ยนรหัสผ่าน" aria-label="เปลี่ยนรหัสผ่าน" onClick={() => setPwOpen(true)}>
              <Icon name="key" size={18} />
            </button>
            <button className="icon-btn" title="ออกจากระบบ" aria-label="ออกจากระบบ" onClick={logout}>
              <Icon name="logout" size={18} />
            </button>
          </div>
        </aside>
        <div className="nav-scrim" onClick={() => setNavOpen(false)} />

        <div className="main">
          <header className="topbar">
            <button className="icon-btn" onClick={() => setNavOpen(true)} aria-label="เปิดเมนู"><Icon name="menu" /></button>
            <div className="topbar-title">{current?.label}</div>
            <div className="avatar avatar-sm">{initial(user.name)}</div>
          </header>
          <main className="content">
            {Page ? <Page key={current.key} go={go} /> : (
              <div className="card"><p>บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าใช้งานเมนูใด กรุณาติดต่อเจ้าของร้าน</p></div>
            )}
          </main>
          <nav className="bottombar">
            {bottom.map((r) => (
              <a key={r.key} href={`#/${r.key}`} className={`bottom-item ${current?.key === r.key ? 'active' : ''}`}>
                <span className="bottom-icon">
                  <Icon name={r.icon} />
                  {r.key === 'queue' && openQueues > 0 && <span className="nav-badge nav-badge-dot">{openQueues}</span>}
                </span>
                <span>{r.label}</span>
              </a>
            ))}
            {allowed.length > bottom.length && (
              <button className="bottom-item" onClick={() => setNavOpen(true)}>
                <Icon name="menu" />
                <span>เพิ่มเติม</span>
              </button>
            )}
          </nav>
        </div>
        <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
      </div>
    </AuthCtx.Provider>
  );
}

function ChangePassword({ open, onClose }) {
  const { toast } = useUi();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setF({ currentPassword: '', newPassword: '', confirm: '' }); setErr(''); }
  }, [open]);
  const submit = async (e) => {
    e.preventDefault();
    if (f.newPassword !== f.confirm) return setErr('รหัสผ่านใหม่ไม่ตรงกัน');
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: f });
      toast('เปลี่ยนรหัสผ่านแล้ว');
      onClose();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} title="เปลี่ยนรหัสผ่าน" onClose={onClose} size="sm">
      <form onSubmit={submit} className="form">
        <Field label="รหัสผ่านปัจจุบัน">
          <input type="password" className="input" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} autoFocus />
        </Field>
        <Field label="รหัสผ่านใหม่">
          <input type="password" className="input" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
        </Field>
        <Field label="ยืนยันรหัสผ่านใหม่" error={err}>
          <input type="password" className="input" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </Field>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={busy}>บันทึก</button>
        </div>
      </form>
    </Modal>
  );
}
