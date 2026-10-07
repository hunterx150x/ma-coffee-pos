import { num, sweetLabel } from '../utils.js';
import { Empty, Icon, Modal } from './ui.jsx';

/** How to make one cart / queue line: ingredients (recipe + toppings) and the numbered steps. */
export default function HowToModal({ line, catalog, onClose }) {
  const item = line && catalog?.menuItems.find((m) => m.id === line.menuItemId);
  const howTo = item?.howTo || { ingredients: [], steps: [] };
  const toppings = (line?.toppings || []).map((t) => ({ ...t, howTo: catalog?.toppings.find((x) => x.id === t.id)?.howTo }));

  return (
    <Modal open={!!line} title={`วิธีทำ · ${line?.name || ''}`} onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>ปิด</button>}>
      {line && (
        <>
          <div className="howto-tags">
            <span className="pill">{line.qty} แก้ว</span>
            {line.sweetness != null && <span className="pill">{sweetLabel(line.sweetness)}</span>}
            {line.toppings.map((t) => <span key={t.id} className="pill pill-topping">+ {t.name}</span>)}
          </div>
          {line.note && <div className="line-note">หมายเหตุ: {line.note}</div>}

          <section>
            <h4 className="howto-h">ขั้นตอนการทำ</h4>
            {howTo.steps.length ? (
              <ol className="howto-steps">
                {howTo.steps.map((st, i) => (
                  <li key={i}>
                    <span className="howto-num">{i + 1}</span>
                    <div>
                      <div>{st.text || st.ingredientName}</div>
                      {st.ingredientName && (
                        <div className="howto-ing"><Icon name="stock" size={14} /> {st.ingredientName} <b>{num(st.qty)} {st.unit}</b></div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            ) : <Empty icon="products" title="ยังไม่ได้กรอกขั้นตอนการทำ">เพิ่มได้ที่ “เมนู & ราคา” → แก้ไขเมนู → วิธีทำ</Empty>}
          </section>

          {(howTo.ingredients.length > 0 || toppings.some((t) => t.howTo?.ingredients.length)) && (
            <section>
              <h4 className="howto-h">ส่วนผสมต่อ 1 แก้ว</h4>
              <table className="table howto-table">
                <tbody>
                  {howTo.ingredients.map((r, i) => (
                    <tr key={i}><td>{r.name}</td><td className="num">{num(r.qty)} {r.unit}</td></tr>
                  ))}
                  {toppings.flatMap((t) => (t.howTo?.ingredients || []).map((r, i) => (
                    <tr key={`${t.id}-${i}`}><td>{r.name} <span className="muted small">({t.name})</span></td><td className="num">{num(r.qty)} {r.unit}</td></tr>
                  )))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </Modal>
  );
}
