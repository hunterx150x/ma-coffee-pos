// Shared form controls: a searchable dropdown, a date picker with a Thai calendar, and table paging.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui.jsx';

// ---------- popover (portal, placed under or above its trigger, closes on outside tap / Escape) ----------
function usePopover() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);
  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const panelH = panelRef.current?.offsetHeight || 320;
    const below = window.innerHeight - r.bottom;
    const up = below < panelH + 12 && r.top > below;
    const width = Math.max(r.width, 260);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setPos({ left, width, ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); triggerRef.current?.focus(); } };
    const onMove = () => place();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const panel = (children, className = '') => open && createPortal(
    <div ref={panelRef} className={`popover ${className}`} style={pos ? { position: 'fixed', ...pos } : { position: 'fixed', visibility: 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
  return { open, setOpen, triggerRef, panel };
}

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFC');

// ---------- searchable select ----------
/**
 * Drop-in for <select> with a search box (shown once there are more than 7 options).
 * options: [{ value, label, hint? }] — value '' is a normal option (e.g. "ทั้งหมด").
 */
export function Select({ value, onChange, options, placeholder = 'เลือก...', className = '', ariaLabel, disabled, searchPlaceholder = 'พิมพ์เพื่อค้นหา...' }) {
  const { open, setOpen, triggerRef, panel } = usePopover();
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const listRef = useRef(null);
  const searchable = options.length > 7;
  const current = options.find((o) => String(o.value) === String(value ?? ''));
  const shown = useMemo(() => {
    const k = norm(q.trim());
    return k ? options.filter((o) => norm(o.label).includes(k) || norm(o.hint).includes(k)) : options;
  }, [q, options]);
  useEffect(() => {
    if (!open) return;
    setQ('');
    setHi(Math.max(0, options.findIndex((o) => String(o.value) === String(value ?? ''))));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector('[data-hi="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);
  const pick = (o) => {
    onChange(o.value);
    setOpen(false);
    triggerRef.current?.focus();
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setHi((h) => Math.min(shown.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); if (shown[hi]) pick(shown[hi]); }
  };
  return (
    <>
      <button type="button" ref={triggerRef} className={`input select-btn ${className}`} disabled={disabled} aria-label={ariaLabel}
        aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={onKey}>
        <span className={`select-value ${current ? '' : 'muted'}`}>{current ? current.label : placeholder}</span>
        <Icon name="down" size={16} />
      </button>
      {panel(
        <>
          {searchable && (
            <div className="select-search">
              <Icon name="search" size={16} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={searchPlaceholder} aria-label="ค้นหาตัวเลือก" />
              {q && <button type="button" className="select-clear" onClick={() => setQ('')} aria-label="ล้างคำค้นหา"><Icon name="x" size={14} /></button>}
            </div>
          )}
          <div className="select-list" role="listbox" ref={listRef} tabIndex={searchable ? -1 : 0} onKeyDown={searchable ? undefined : onKey}>
            {shown.map((o, i) => {
              const on = String(o.value) === String(value ?? '');
              return (
                <button type="button" key={`${o.value}`} role="option" aria-selected={on} data-hi={i === hi ? '1' : '0'}
                  className={`select-opt ${on ? 'on' : ''} ${i === hi ? 'hi' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => pick(o)}>
                  <span className="select-opt-label">{o.label}</span>
                  {o.hint && <span className="select-opt-hint">{o.hint}</span>}
                  {on && <Icon name="check" size={16} />}
                </button>
              );
            })}
            {!shown.length && <div className="select-empty">ไม่พบ “{q}”</div>}
          </div>
        </>,
        'select-pop',
      )}
    </>
  );
}

// ---------- date picker ----------
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const WEEK = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']; // Monday first, like the reports' week
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
export const thDateLong = (s) => {
  const d = parse(s);
  return d ? `${d.getDate()} ${TH_MON[d.getMonth()]} ${d.getFullYear() + 543}` : '';
};

/** Date field ('YYYY-MM-DD') with a Thai calendar popover (Buddhist year, Monday start, today marked). */
export function DateInput({ value, onChange, min, max, ariaLabel, placeholder = 'เลือกวันที่', className = '' }) {
  const { open, setOpen, triggerRef, panel } = usePopover();
  const sel = parse(value);
  const [view, setView] = useState(() => sel || new Date());
  const [months, setMonths] = useState(false); // month / year chooser
  useEffect(() => { if (open) { setView(sel || new Date()); setMonths(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const y = view.getFullYear();
  const m = view.getMonth();
  const todayStr = ymd(new Date());
  const allowed = (s) => (!min || s >= min) && (!max || s <= max);
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7; // blanks before the 1st (Monday start)
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(y, m, i + 1))];
  const pick = (d) => {
    const s = ymd(d);
    if (!allowed(s)) return;
    onChange(s);
    setOpen(false);
    triggerRef.current?.focus();
  };
  return (
    <>
      <button type="button" ref={triggerRef} className={`input date-btn ${className}`} aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <Icon name="calendar" size={17} />
        <span className={value ? '' : 'muted'}>{value ? thDateLong(value) : placeholder}</span>
      </button>
      {panel(
        <div className="cal" role="dialog" aria-label={ariaLabel || 'เลือกวันที่'}>
          <div className="cal-head">
            <button type="button" className="icon-btn" onClick={() => setView(months ? new Date(y - 1, m, 1) : new Date(y, m - 1, 1))} aria-label={months ? 'ปีก่อน' : 'เดือนก่อน'}><Icon name="back" size={18} /></button>
            <button type="button" className="cal-title" onClick={() => setMonths(!months)} aria-label="เลือกเดือน / ปี">
              {months ? `พ.ศ. ${y + 543}` : `${TH_MONTHS[m]} ${y + 543}`} <Icon name={months ? 'up' : 'down'} size={14} />
            </button>
            <button type="button" className="icon-btn" onClick={() => setView(months ? new Date(y + 1, m, 1) : new Date(y, m + 1, 1))} aria-label={months ? 'ปีถัดไป' : 'เดือนถัดไป'}><Icon name="next" size={18} /></button>
          </div>
          {months ? (
            <div className="cal-months">
              {TH_MON.map((n, i) => (
                <button type="button" key={n} className={`cal-month ${i === m ? 'on' : ''}`} onClick={() => { setView(new Date(y, i, 1)); setMonths(false); }}>{n}</button>
              ))}
            </div>
          ) : (
            <>
              <div className="cal-week">{WEEK.map((w, i) => <span key={w} className={i >= 5 ? 'cal-we' : ''}>{w}</span>)}</div>
              <div className="cal-grid">
                {cells.map((d, i) => {
                  if (!d) return <span key={`b${i}`} />;
                  const s = ymd(d);
                  const on = s === value;
                  const ok = allowed(s);
                  return (
                    <button type="button" key={s} disabled={!ok} onClick={() => pick(d)} aria-pressed={on}
                      className={`cal-day ${on ? 'on' : ''} ${s === todayStr ? 'today' : ''} ${(d.getDay() + 6) % 7 >= 5 ? 'cal-we' : ''}`}>
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="cal-foot">
            <button type="button" className="btn btn-sm btn-ghost" disabled={!allowed(todayStr)} onClick={() => pick(new Date())}>วันนี้</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>ปิด</button>
          </div>
        </div>,
        'cal-pop',
      )}
    </>
  );
}

// ---------- table paging ----------
export const PAGE_SIZES = [25, 50, 100, 200];

/** Page controls for any table: "แสดง 1–50 จาก 120" · ต่อหน้า · « ‹ หน้า 1/3 › » */
export function Pager({ page, pages, total, perPage, sizes = PAGE_SIZES, onPage, onPerPage }) {
  if (!total) return null;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  return (
    <div className="pager">
      <span className="muted small">แสดง {from.toLocaleString('th-TH')}–{to.toLocaleString('th-TH')} จาก {total.toLocaleString('th-TH')} รายการ</span>
      <div className="pager-ctrl">
        <label className="pager-size">
          <span className="muted small">ต่อหน้า</span>
          <select className="input input-auto" value={perPage} onChange={(e) => onPerPage(Number(e.target.value))}>
            {sizes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button type="button" className="icon-btn" disabled={page <= 1} onClick={() => onPage(1)} aria-label="หน้าแรก">«</button>
        <button type="button" className="icon-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="ก่อนหน้า"><Icon name="back" size={18} /></button>
        <span className="pager-page">หน้า {page} / {pages}</span>
        <button type="button" className="icon-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="ถัดไป"><Icon name="next" size={18} /></button>
        <button type="button" className="icon-btn" disabled={page >= pages} onClick={() => onPage(pages)} aria-label="หน้าสุดท้าย">»</button>
      </div>
    </div>
  );
}

/**
 * Client-side paging for a list already in memory. `key` remembers the page size per table;
 * `resetOn` (e.g. a filter string) sends it back to page 1.
 */
export function usePaged(rows, key, { resetOn = '', defaultSize = 50 } = {}) {
  const storeKey = `ma_pagesize_${key}`;
  const [perPage, setPerPageState] = useState(() => {
    try { return Number(localStorage.getItem(storeKey)) || defaultSize; } catch { return defaultSize; }
  });
  const [page, setPage] = useState(1);
  const total = rows?.length || 0;
  const pages = Math.max(1, Math.ceil(total / perPage));
  useEffect(() => { setPage(1); }, [resetOn, perPage]);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const setPerPage = (n) => {
    setPerPageState(n);
    try { localStorage.setItem(storeKey, String(n)); } catch { /* storage unavailable */ }
  };
  const p = Math.min(page, pages);
  const pageRows = (rows || []).slice((p - 1) * perPage, p * perPage);
  const pager = <Pager page={p} pages={pages} total={total} perPage={perPage} onPage={setPage} onPerPage={setPerPage} />;
  return { pageRows, pager, page: p, offset: (p - 1) * perPage };
}
