import { useRef, useState } from 'react';
import { Icon } from './ui.jsx';

/** Menu photo, or the category emoji when the menu has no photo. */
export function MenuThumb({ item, icon, className = '' }) {
  const [broken, setBroken] = useState(false);
  if (item?.imageUrl && !broken) {
    return <img className={`menu-thumb ${className}`} src={item.imageUrl} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }
  return <span className={`menu-thumb menu-thumb-icon ${className}`} aria-hidden="true">{icon || '☕'}</span>;
}

const MAX_SIDE = 640;
const QUALITY = 0.82;

/** Shrink a photo in the browser so it can be stored inline (base64) without bloating the database. */
export function resizeToDataUrl(file, maxSide = MAX_SIDE) {
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

/**
 * value: undefined = keep current photo, data URL = new photo, null = remove.
 * currentUrl: the saved photo (shown while value is undefined).
 */
export function ImagePicker({ value, currentUrl, icon, onChange }) {
  const input = useRef(null);
  const [err, setErr] = useState('');
  const preview = value === undefined ? currentUrl : value;
  const pick = async (file) => {
    if (!file) return;
    setErr('');
    try {
      onChange(await resizeToDataUrl(file));
    } catch (e) {
      setErr(e.message);
    }
  };
  return (
    <div className="image-picker">
      <button type="button" className="image-picker-box" onClick={() => input.current?.click()} aria-label="เลือกรูปเมนู">
        {preview ? <img src={preview} alt="" /> : <span className="menu-thumb-icon">{icon || '☕'}</span>}
      </button>
      <div className="image-picker-actions">
        <button type="button" className="btn btn-sm btn-outline" onClick={() => input.current?.click()}>
          <Icon name="upload" size={16} /> {preview ? 'เปลี่ยนรูป' : 'เพิ่มรูป'}
        </button>
        {preview && (
          <button type="button" className="btn btn-sm btn-ghost btn-danger-text" onClick={() => onChange(null)}>
            <Icon name="trash" size={16} /> ลบรูป
          </button>
        )}
        <span className="muted small">ถ้าไม่มีรูป จะแสดงไอคอนของประเภทแทน</span>
        {err && <span className="field-error">{err}</span>}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
    </div>
  );
}
