import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { initial, thDateTime } from '../utils.js';
import { PERMISSIONS, DEFAULT_STAFF_PERMISSIONS, ROLES } from '../../shared/permissions.js';
import { Empty, Field, Icon, Loading, Modal, PageHead, Toggle, useAsync, useUi } from '../components/ui.jsx';

export default function Users() {
  const { user: me } = useAuth();
  const { toast, confirm } = useUi();
  const list = useAsync(() => api('/users'), []);
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');

  const openNew = () => {
    setErr('');
    setF({ username: '', name: '', password: '', role: 'staff', permissions: [...DEFAULT_STAFF_PERMISSIONS], active: true });
  };
  const save = async () => {
    setErr('');
    try {
      const body = { ...f };
      if (f.id && !f.password) delete body.password;
      if (f.id) await api(`/users/${f.id}`, { method: 'PUT', body });
      else await api('/users', { method: 'POST', body });
      toast('บันทึกผู้ใช้แล้ว');
      setF(null);
      list.reload();
    } catch (e) {
      setErr(e.message);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'ลบผู้ใช้', message: `ลบบัญชี “${f.name}” (${f.username})?`, okText: 'ลบ', danger: true }))) return;
    try {
      await api(`/users/${f.id}`, { method: 'DELETE' });
      toast('ลบผู้ใช้แล้ว');
      setF(null);
      list.reload();
    } catch (e) {
      setErr(e.message);
    }
  };
  const togglePerm = (key) => setF((x) => ({
    ...x, permissions: x.permissions.includes(key) ? x.permissions.filter((p) => p !== key) : [...x.permissions, key],
  }));

  return (
    <div>
      <PageHead title="ผู้ใช้ & สิทธิ์การเข้าใช้งาน" sub="เจ้าของร้านเข้าได้ทุกเมนู · พนักงานเข้าได้เฉพาะเมนูที่กำหนด">
        <button className="btn btn-primary" onClick={openNew}><Icon name="plus" /> เพิ่มผู้ใช้</button>
      </PageHead>
      {list.loading && !list.data ? <Loading /> : list.data?.length ? (
        <div className="user-list">
          {list.data.map((u) => (
            <button key={u.id} className={`card user-card ${u.active ? '' : 'tile-off'}`}
              onClick={() => { setErr(''); setF({ ...u, password: '' }); }}>
              <div className="avatar">{initial(u.name)}</div>
              <div className="user-card-main">
                <div><b>{u.name}</b> {u.id === me.id && <span className="muted small">(คุณ)</span>}</div>
                <div className="muted small">@{u.username} · {u.lastLoginAt ? `เข้าใช้ล่าสุด ${thDateTime(u.lastLoginAt)}` : 'ยังไม่เคยเข้าใช้ (ตั้งแต่เริ่มบันทึก)'}</div>
                <div className="perm-pills">
                  {u.role === 'owner'
                    ? <span className="pill">ทุกเมนู</span>
                    : u.permissions.length
                      ? u.permissions.map((p) => <span key={p} className="pill">{PERMISSIONS.find((x) => x.key === p)?.label}</span>)
                      : <span className="muted small">ยังไม่มีสิทธิ์</span>}
                </div>
              </div>
              <div className="user-card-side">
                <span className={`badge ${u.role === 'owner' ? 'badge-owner' : ''}`}>{ROLES[u.role]}</span>
                {!u.active && <span className="badge badge-danger">ระงับ</span>}
              </div>
            </button>
          ))}
        </div>
      ) : <Empty icon="users" title="ยังไม่มีผู้ใช้" />}

      <Modal open={!!f} title={f?.id ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้'} onClose={() => setF(null)}
        footer={(
          <>
            {f?.id && f.id !== me.id && <button className="btn btn-ghost btn-danger-text mr-auto" onClick={remove}><Icon name="trash" /> ลบ</button>}
            <button className="btn btn-ghost" onClick={() => setF(null)}>ยกเลิก</button>
            <button className="btn btn-primary" onClick={save}>บันทึก</button>
          </>
        )}>
        {f && (
          <div className="form">
            <div className="form-grid">
              <Field label="ชื่อ-นามสกุล / ชื่อเล่น *"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
              <Field label="ชื่อผู้ใช้ (ใช้ล็อกอิน) *" hint="a-z, 0-9, . _ -">
                <input className="input" value={f.username} autoCapitalize="none" onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} />
              </Field>
              <Field label={f.id ? 'ตั้งรหัสผ่านใหม่' : 'รหัสผ่าน *'} hint={f.id ? 'เว้นว่างถ้าไม่ต้องการเปลี่ยน' : 'อย่างน้อย 4 ตัวอักษร'}>
                <input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
              </Field>
            </div>
            <Field label="บทบาท">
              <div className="grid grid-2">
                {Object.entries(ROLES).map(([k, label]) => (
                  <button key={k} className={`tile tile-role ${f.role === k ? 'selected' : ''}`} onClick={() => setF({ ...f, role: k })}>
                    <Icon name={k === 'owner' ? 'users' : 'user'} size={24} />
                    <span className="tile-name">{label}</span>
                    <span className="muted small">{k === 'owner' ? 'เข้าได้ทุกเมนู รวมถึงจัดการผู้ใช้' : 'เข้าได้เฉพาะเมนูที่เลือก'}</span>
                  </button>
                ))}
              </div>
            </Field>
            {f.role === 'staff' && (
              <Field label="สิทธิ์เมนูที่เข้าใช้งานได้">
                <div className="perm-grid">
                  {PERMISSIONS.map((p) => (
                    <label key={p.key} className={`perm-item ${f.permissions.includes(p.key) ? 'on' : ''}`}>
                      <input type="checkbox" checked={f.permissions.includes(p.key)} onChange={() => togglePerm(p.key)} />
                      <span className="check-box">{f.permissions.includes(p.key) && <Icon name="check" size={14} stroke={3} />}</span>
                      {p.label}
                    </label>
                  ))}
                </div>
              </Field>
            )}
            <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="เปิดใช้งานบัญชีนี้" />
            {err && <div className="field-error">{err}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
