import { useState } from 'react';
import { api } from '../api.js';
import { Field } from '../components/ui.jsx';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/auth/login', { method: 'POST', body: { username, password } });
      onLogin(r.token, r.user);
    } catch (ex) {
      setError(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <img src="/icon.svg" alt="" width="64" height="64" />
        <h1>MA Coffee</h1>
        <p className="muted">ระบบขายหน้าร้าน · เข้าสู่ระบบเพื่อเริ่มใช้งาน</p>
        <Field label="ชื่อผู้ใช้">
          <input className="input input-lg" value={username} onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none" autoCorrect="off" autoComplete="username" autoFocus />
        </Field>
        <Field label="รหัสผ่าน" error={error}>
          <input className="input input-lg" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password" />
        </Field>
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !username || !password}>
          {busy ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </div>
  );
}
