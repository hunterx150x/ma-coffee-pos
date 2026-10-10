import { useEffect, useRef, useState } from 'react';
import { Icon, Modal } from './ui.jsx';

/** Menu photo, or the category emoji when the menu has no photo. */
export function MenuThumb({ item, icon, className = '' }) {
  const [broken, setBroken] = useState(false);
  if (item?.imageUrl && !broken) {
    return <img className={`menu-thumb ${className}`} src={item.imageUrl} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }
  return <span className={`menu-thumb menu-thumb-icon ${className}`} aria-hidden="true">{icon || '☕'}</span>;
}

// Saved photos are 4:3 (the POS tile shape); the customer QR menu and lists show the centre square of it.
const OUT_W = 640;
const OUT_H = 480;
const ASPECT = OUT_W / OUT_H;
const QUALITY = 0.82;
const WORK_SIDE = 2000; // big phone photos are scaled down first so dragging stays smooth
const MAX_ZOOM = 5;

/** Shrink a photo in the browser so it can be stored inline (base64) without bloating the database. */
export function resizeToDataUrl(file, maxSide = OUT_W) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', QUALITY));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('เปิดไฟล์รูปไม่ได้'));
    };
    img.src = url;
  });
}

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('เปิดไฟล์รูปไม่ได้'));
  img.src = src;
});

/** Draw `img` (optionally turned 90° `turns` times) onto a canvas no bigger than WORK_SIDE. */
function workCanvas(img, turns = 0) {
  const scale = Math.min(1, WORK_SIDE / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const side = turns % 2 === 1;
  const c = document.createElement('canvas');
  c.width = side ? h : w;
  c.height = side ? w : h;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return c;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The part of the source (in its pixels) that the frame shows: centre (cx, cy as 0..1) + zoom. */
function cropRect(src, { cx, cy, zoom }) {
  const base = Math.min(src.width / ASPECT, src.height); // crop height at zoom 1 (largest 4:3 that fits)
  const h = base / zoom;
  const w = h * ASPECT;
  return { x: cx * src.width - w / 2, y: cy * src.height - h / 2, w, h };
}
function clampView(src, v) {
  const zoom = clamp(v.zoom, 1, MAX_ZOOM);
  const { w, h } = cropRect(src, { cx: 0.5, cy: 0.5, zoom });
  const hx = w / 2 / src.width;
  const hy = h / 2 / src.height;
  return { zoom, cx: clamp(v.cx, hx, 1 - hx), cy: clamp(v.cy, hy, 1 - hy) };
}
function drawCrop(canvas, src, r, square = false) {
  const ctx = canvas.getContext('2d');
  // square = the centre square of the 4:3 crop, as the QR menu / lists show it (object-fit: cover)
  const sx = square ? r.x + (r.w - r.h) / 2 : r.x;
  const sw = square ? r.h : r.w;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, r.y, sw, r.h, 0, 0, canvas.width, canvas.height);
}

/** Crop dialog: drag to move, slider / pinch / wheel to zoom, rotate 90°. Resolves a 640×480 JPEG data URL. */
export function ImageCropper({ src: fileSrc, onCancel, onDone }) {
  const [img, setImg] = useState(null);
  const [turns, setTurns] = useState(0);
  const [view, setView] = useState({ cx: 0.5, cy: 0.5, zoom: 1 });
  const [err, setErr] = useState('');
  const frame = useRef(null);
  const work = useRef(null);
  const [workUrl, setWorkUrl] = useState('');
  const [frameW, setFrameW] = useState(0);
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const prev = { pos: useRef(null), qr: useRef(null), list: useRef(null) };

  useEffect(() => {
    let alive = true;
    loadImage(fileSrc).then((x) => alive && setImg(x)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [fileSrc]);
  useEffect(() => {
    if (!img) return;
    work.current = workCanvas(img, turns);
    setWorkUrl(work.current.toDataURL('image/jpeg', 0.9));
    setView({ cx: 0.5, cy: 0.5, zoom: 1 });
  }, [img, turns]);
  useEffect(() => {
    if (!frame.current) return undefined;
    const ro = new ResizeObserver(([e]) => setFrameW(e.contentRect.width));
    ro.observe(frame.current);
    return () => ro.disconnect();
  }, [workUrl]);

  const src = work.current;
  const r = src && cropRect(src, view);
  useEffect(() => {
    if (!src) return;
    if (prev.pos.current) drawCrop(prev.pos.current, src, r);
    if (prev.qr.current) drawCrop(prev.qr.current, src, r, true);
    if (prev.list.current) drawCrop(prev.list.current, src, r, true);
  });

  const update = (fn) => setView((v) => (src ? clampView(src, fn(v)) : v));
  // Frame px -> source px for the current zoom.
  const pxScale = () => (r && frameW ? r.w / frameW : 1);
  const onDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
    }
  };
  const onMove = (e) => {
    const p = pointers.current.get(e.pointerId);
    if (!p || !src) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const z = pinch.current.zoom * (dist / pinch.current.dist);
      update((v) => ({ ...v, zoom: z }));
    } else if (pointers.current.size === 1) {
      const k = pxScale();
      update((v) => ({ ...v, cx: v.cx - (dx * k) / src.width, cy: v.cy - (dy * k) / src.height }));
    }
  };
  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  useEffect(() => {
    const el = frame.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      update((v) => ({ ...v, zoom: v.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const done = () => {
    const c = document.createElement('canvas');
    c.width = OUT_W;
    c.height = OUT_H;
    drawCrop(c, src, r);
    onDone(c.toDataURL('image/jpeg', QUALITY));
  };

  // Where the work image sits inside the frame (CSS px).
  const s = r && frameW ? frameW / r.w : 0;
  const imgStyle = src && s ? { width: src.width * s, height: src.height * s, transform: `translate(${-r.x * s}px, ${-r.y * s}px)` } : { display: 'none' };
  const lowRes = r && r.w < 480;

  return (
    <Modal open title="ครอปรูปเมนู" size="lg" onClose={onCancel}
      footer={(<><button className="btn btn-ghost" onClick={onCancel}>ยกเลิก</button><button className="btn btn-primary" onClick={done} disabled={!src}><Icon name="check" size={18} /> ใช้รูปนี้</button></>)}>
      {err ? <div className="field-error">{err}</div> : (
        <div className="cropper">
          <div className="cropper-main">
            <div ref={frame} className="crop-frame" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              {workUrl && <img src={workUrl} alt="" draggable={false} style={imgStyle} />}
              <div className="crop-grid" aria-hidden="true" />
              <div className="crop-square" aria-hidden="true"><span>เมนูลูกค้า (QR) · รายการ</span></div>
              <span className="crop-label" aria-hidden="true">หน้าขาย (POS) 4:3</span>
            </div>
            <div className="crop-tools">
              <Icon name="minus" size={16} />
              <input type="range" min="1" max={MAX_ZOOM} step="0.01" value={view.zoom} aria-label="ซูม"
                onChange={(e) => update((v) => ({ ...v, zoom: Number(e.target.value) }))} />
              <Icon name="plus" size={16} />
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setTurns((t) => (t + 1) % 4)}><Icon name="rotate" size={16} /> หมุน</button>
            </div>
            <p className="muted small crop-hint">ลากเพื่อเลื่อนรูป · ใช้แถบ (หรือถ่างสองนิ้ว / ลูกกลิ้งเมาส์) เพื่อซูม · กรอบเส้นประคือส่วนที่ลูกค้าเห็นในเมนู QR</p>
          </div>
          <div className="crop-previews">
            <div className="muted small crop-prev-title">ตัวอย่างที่จะแสดง</div>
            <figure><canvas ref={prev.pos} width={160} height={120} className="crop-prev-pos" /><figcaption>หน้าขาย (POS)</figcaption></figure>
            <figure><canvas ref={prev.qr} width={120} height={120} className="crop-prev-qr" /><figcaption>เมนูลูกค้า (QR)</figcaption></figure>
            <figure><canvas ref={prev.list} width={88} height={88} className="crop-prev-list" /><figcaption>รายการเมนู</figcaption></figure>
            {r && (
              <div className={`small crop-size ${lowRes ? 'crop-size-low' : 'muted'}`}>
                ส่วนที่เลือก {Math.round(r.w)} × {Math.round(r.h)} px → บันทึก {OUT_W} × {OUT_H} px
                {lowRes && <div>ซูมมากเกินไป รูปอาจไม่คมชัด</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * value: undefined = keep current photo, data URL = new photo, null = remove.
 * currentUrl: the saved photo (shown while value is undefined).
 */
export function ImagePicker({ value, currentUrl, icon, onChange }) {
  const input = useRef(null);
  const [cropSrc, setCropSrc] = useState(null);
  const preview = value === undefined ? currentUrl : value;
  const pick = (file) => {
    if (!file) return;
    setCropSrc(URL.createObjectURL(file));
  };
  const closeCrop = () => {
    if (cropSrc?.startsWith('blob:')) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };
  return (
    <div className="image-picker">
      <button type="button" className="image-picker-box" onClick={() => input.current?.click()} aria-label="เลือกรูปเมนู">
        {preview ? <img src={preview} alt="" /> : <span className="menu-thumb-icon">{icon || '☕'}</span>}
      </button>
      <div className="image-picker-actions">
        <div className="image-picker-btns">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => input.current?.click()}>
            <Icon name="upload" size={16} /> {preview ? 'เปลี่ยนรูป' : 'เพิ่มรูป'}
          </button>
          {preview && (
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setCropSrc(preview)}>
              <Icon name="crop" size={16} /> ครอปใหม่
            </button>
          )}
          {preview && (
            <button type="button" className="btn btn-sm btn-ghost btn-danger-text" onClick={() => onChange(null)}>
              <Icon name="trash" size={16} /> ลบรูป
            </button>
          )}
        </div>
        <span className="muted small">เลือกรูปแล้วครอปได้ก่อนบันทึก · ถ้าไม่มีรูป จะแสดงไอคอนของประเภทแทน</span>
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
      {cropSrc && <ImageCropper src={cropSrc} onCancel={closeCrop} onDone={(url) => { onChange(url); closeCrop(); }} />}
    </div>
  );
}
