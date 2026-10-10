// Owner-only activity log, unlocked with an extra password (server-checked; the unlock lasts 30 minutes).
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { downloadCsv, num, presetRange, thDate, thTime } from '../utils.js';
import { DateRange, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, useAsync, useUi } from '../components/ui.jsx';

const TOKEN_KEY = 'ma_audit_unlock';
const PER_PAGE = [50, 100, 200, 500];

function readUnlock() {
  try {
    const x = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
    return x && x.until > Date.now() ? x : null;
  } catch {
    return null;
  }
}

export default function AuditLog() {
  const [unlock, setUnlock] = useState(readUnlock);
  const lock = () => {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    setUnlock(null);
  };
  // Re-lock automatically when the 30 minutes run out.
  useEffect(() => {
    if (!unlock) return undefined;
    const t = setTimeout(lock, Math.max(0, unlock.until - Date.now()));
    return () => clearTimeout(t);
  }, [unlock]);

  if (!unlock) return <Unlock onUnlocked={(x) => { try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(x)); } catch { /* ignore */ } setUnlock(x); }} />;
  return <Log token={unlock.token} until={unlock.until} onLock={lock} />;
}

function Unlock({ onUnlocked }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api('/audit/unlock', { method: 'POST', body: { password: pw } });
      onUnlocked({ token: r.token, until: Date.now() + r.expiresInMs });
    } catch (ex) {
      setErr(ex.message);
      setPw('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHead title="ประวัติการใช้งาน" sub="การเข้าสู่ระบบ และการเพิ่ม / แก้ไข / ลบข้อมูลของผู้ใช้ทุกคน" />
      <form className="card audit-lock" onSubmit={submit}>
        <div className="audit-lock-icon"><Icon name="key" size={28} /></div>
        <h3>ใส่รหัสผ่านเพื่อดูประวัติ</h3>
        <p className="muted small">เฉพาะเจ้าของร้าน · ปลดล็อกได้ครั้งละ 30 นาที · การเปิดดูถูกบันทึกไว้ด้วย</p>
        <input className="input input-lg audit-pin" type="password" inputMode="numeric" autoComplete="off" value={pw} autoFocus
          onChange={(e) => setPw(e.target.value)} placeholder="รหัสผ่าน" aria-label="รหัสผ่านดูประวัติ" />
        {err && <div className="field-error">{err}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !pw}>{busy ? 'กำลังตรวจสอบ...' : 'ปลดล็อก'}</button>
      </form>
    </div>
  );
}

function Log({ token, until, onLock }) {
  const { toast } = useUi();
  const [range, setRange] = useState(presetRange('week'));
  const [user, setUser] = useState('');
  const [category, setCategory] = useState('');
  const [only, setOnly] = useState('');
  const [q, setQ] = useState('');
  const [perPage, setPerPage] = useState(50);
  const [page, setPage] = useState(1);
  const [pwOpen, setPwOpen] = useState(false);
  const headers = { 'X-Audit-Token': token };
  const key = [range.from, range.to, user, category, only, q, perPage].join('|');
  useEffect(() => { setPage(1); }, [key]);
  const log = useAsync(() => api('/audit', { headers, query: { ...range, user, category, only, q, perPage, page } }), [key, page]);
  // Server says the unlock expired -> back to the lock screen.
  useEffect(() => { if (log.error && /รหัสผ่าน/.test(log.error)) onLock(); }, [log.error]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = log.data;

  const exportCsv = async () => {
    try {
      const all = await api('/audit', { headers, query: { ...range, user, category, only, q, perPage: 500, page: 1 } });
      const rows = [['วันที่', 'เวลา', 'ผู้ใช้', 'บทบาท', 'หมวด', 'การกระทำ', 'รายละเอียด', 'ผล', 'IP', 'อุปกรณ์']];
      for (const x of all.rows) {
        rows.push([thDate(x.createdAt), thTime(x.createdAt), x.userName, x.role === 'owner' ? 'เจ้าของร้าน' : x.role === 'staff' ? 'พนักงาน' : '',
          x.category, x.action, x.detail, x.result === 'fail' ? 'ไม่สำเร็จ' : 'สำเร็จ', x.ip, x.device]);
      }
      downloadCsv(`activity-log-${range.from}_${range.to}.csv`, rows);
      if (all.total > all.rows.length) toast(`ส่งออก ${all.rows.length} รายการล่าสุด (จากทั้งหมด ${all.total}) — แคบช่วงวันที่เพื่อดูส่วนที่เหลือ`, 'error');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const from = d ? (d.page - 1) * d.perPage + 1 : 0;
  const to = d ? Math.min(d.total, d.page * d.perPage) : 0;
  const pager = d && d.total > 0 && (
    <div className="pager">
      <span className="muted small">แสดง {num(from)}–{num(to)} จาก {num(d.total)} รายการ</span>
      <div className="pager-ctrl">
        <label className="pager-size">
          <span className="muted small">ต่อหน้า</span>
          <select className="input input-auto" value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>
            {PER_PAGE.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button className="icon-btn" disabled={d.page <= 1} onClick={() => setPage(1)} aria-label="หน้าแรก">«</button>
        <button className="icon-btn" disabled={d.page <= 1} onClick={() => setPage(d.page - 1)} aria-label="ก่อนหน้า"><Icon name="back" size={18} /></button>
        <span className="pager-page">หน้า {d.page} / {d.pages}</span>
        <button className="icon-btn" disabled={d.page >= d.pages} onClick={() => setPage(d.page + 1)} aria-label="ถัดไป"><Icon name="next" size={18} /></button>
        <button className="icon-btn" disabled={d.page >= d.pages} onClick={() => setPage(d.pages)} aria-label="หน้าสุดท้าย">»</button>
      </div>
    </div>
  );

  const s = d?.summary;
  return (
    <div>
      <PageHead title="ประวัติการใช้งาน" sub={`ปลดล็อกถึง ${thTime(new Date(until).toISOString())} น.`}>
        <button className="btn btn-outline" onClick={exportCsv} disabled={!d?.total}><Icon name="download" /> CSV</button>
        <button className="btn btn-ghost" onClick={() => setPwOpen(true)}><Icon name="key" /> เปลี่ยนรหัส</button>
        <button className="btn btn-ghost" onClick={onLock}><Icon name="ban" /> ล็อก</button>
      </PageHead>

      <div className="card filters">
        <DateRange value={range} onChange={setRange} />
        <div className="moves-filters">
          <select className="input" value={user} onChange={(e) => setUser(e.target.value)} aria-label="ผู้ใช้">
            <option value="">ผู้ใช้ทุกคน</option>
            {(d?.users || []).map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="หมวด">
            <option value="">ทุกหมวด</option>
            {(d?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input" value={only} onChange={(e) => setOnly(e.target.value)} aria-label="ระดับ">
            <option value="">ทุกรายการ</option>
            <option value="warn">เฉพาะที่ควรตรวจ (ลบ / ยกเลิก / ล้มเหลว)</option>
            <option value="fail">เฉพาะที่ไม่สำเร็จ</option>
          </select>
          <div className="search">
            <Icon name="search" size={18} />
            <input className="input" placeholder="ค้นหา เช่น เลขบิล ชื่อเมนู IP" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </div>

      {s && (
        <div className="audit-kpis">
          <button className="kpi" onClick={() => { setCategory('เข้าสู่ระบบ'); setOnly(''); }}><div className="kpi-label">เข้าสู่ระบบ</div><div className="kpi-value">{s.logins}</div></button>
          <button className={`kpi ${s.failedLogins ? 'kpi-warn' : ''}`} onClick={() => { setCategory('เข้าสู่ระบบ'); setOnly('fail'); }}><div className="kpi-label">เข้าไม่สำเร็จ</div><div className="kpi-value">{s.failedLogins}</div></button>
          <button className={`kpi ${s.voids ? 'kpi-warn' : ''}`} onClick={() => { setCategory('การขาย'); setOnly('warn'); }}><div className="kpi-label">ยกเลิกบิล</div><div className="kpi-value">{s.voids}</div></button>
          <button className={`kpi ${s.deletes ? 'kpi-warn' : ''}`} onClick={() => { setCategory(''); setOnly('warn'); }}><div className="kpi-label">การลบข้อมูล</div><div className="kpi-value">{s.deletes}</div></button>
        </div>
      )}

      {log.loading && !d ? <Loading /> : log.error ? <ErrorBox error={log.error} onRetry={log.reload} /> : d?.rows.length ? (
        <>
          {pager}
          <div className="card table-card">
            <table className="table audit-table">
              <thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th className="hide-sm">รายละเอียด</th><th className="hide-sm">อุปกรณ์ / IP</th></tr></thead>
              <tbody>
                {d.rows.map((x) => (
                  <tr key={x.id} className={x.result === 'fail' ? 'audit-fail' : x.level === 'warn' ? 'audit-warn' : ''}>
                    <td className="nowrap"><span className="moves-when">{thDate(x.createdAt, { year: false })}<br /><span className="muted">{thTime(x.createdAt)}</span></span></td>
                    <td><b>{x.userName}</b>{x.role && <div className="muted small">{x.role === 'owner' ? 'เจ้าของร้าน' : 'พนักงาน'}</div>}</td>
                    <td>
                      <span className={`badge audit-cat ${x.result === 'fail' ? 'badge-danger' : x.level === 'warn' ? 'badge-warn' : ''}`}>{x.category}</span>
                      <div className="audit-action">{x.action}</div>
                      <div className="muted small show-sm">{x.detail}</div>
                    </td>
                    <td className="hide-sm audit-detail">{x.detail || <span className="muted">—</span>}</td>
                    <td className="hide-sm muted small">{x.device}<br />{x.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pager}
        </>
      ) : <Empty icon="history" title="ไม่มีประวัติตามตัวกรองนี้" />}

      <AuditPasswordModal open={pwOpen} headers={headers} onClose={() => setPwOpen(false)} />
    </div>
  );
}

function AuditPasswordModal({ open, headers, onClose }) {
  const { toast } = useUi();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setF({ current: '', next: '', confirm: '' }); setErr(''); } }, [open]);
  const save = async () => {
    if (f.next !== f.confirm) return setErr('รหัสผ่านใหม่ไม่ตรงกัน');
    try {
      await api('/audit/password', { method: 'POST', headers, body: { current: f.current, next: f.next } });
      toast('เปลี่ยนรหัสผ่านดูประวัติแล้ว');
      onClose();
    } catch (e) {
      setErr(e.message);
    }
  };
  return (
    <Modal open={open} title="เปลี่ยนรหัสผ่านดูประวัติ" size="sm" onClose={onClose}
      footer={(<><button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary" onClick={save}>บันทึก</button></>)}>
      <div className="form">
        <Field label="รหัสปัจจุบัน"><input className="input" type="password" inputMode="numeric" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoFocus /></Field>
        <Field label="รหัสใหม่ (อย่างน้อย 4 ตัว)"><input className="input" type="password" inputMode="numeric" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
        <Field label="ยืนยันรหัสใหม่" error={err}><input className="input" type="password" inputMode="numeric" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
