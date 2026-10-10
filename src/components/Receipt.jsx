import { baht, thDateTime, sweetLabel } from '../utils.js';

export function LineDetail({ line, showPrice = true }) {
  return (
    <div className="line-detail">
      <div className="line-detail-sub">
        {line.sweetness != null && <span className="pill">{sweetLabel(line.sweetness)}</span>}
        {line.toppings.map((t) => (
          <span key={t.id} className="pill pill-topping">+ {t.name}{showPrice && t.price ? ` ${baht(t.price)}` : ''}</span>
        ))}
        {line.discounts.map((d) => (
          <span key={d.id} className="pill pill-discount">{d.name}{showPrice ? ` −${baht(d.amount)}` : ''}</span>
        ))}
      </div>
      {line.note && <div className="line-note">หมายเหตุ: {line.note}</div>}
    </div>
  );
}

export default function Receipt({ order, settings }) {
  return (
    <div className="receipt" id="receipt">
      <div className="receipt-head">
        <div className="receipt-shop">{settings?.shopName || 'MA Coffee'}</div>
        {settings?.address && <div>{settings.address}</div>}
        {settings?.phone && <div>โทร {settings.phone}</div>}
      </div>
      <div className="receipt-meta">
        <div><span>เลขที่บิล</span><b>{order.orderNo}</b></div>
        <div><span>วันที่</span><span>{thDateTime(order.createdAt)}</span></div>
        <div><span>ลูกค้า</span><span>{order.customerName}{order.customerType === 'new' ? ' (ใหม่)' : ''}</span></div>
        <div><span>พนักงาน</span><span>{order.staffName}</span></div>
      </div>
      <div className="receipt-lines">
        {order.items.map((l, i) => (
          <div key={i} className="receipt-line">
            <div className="receipt-row">
              <span>{l.qty} × {l.name}</span>
              <span>{baht(l.gross)}</span>
            </div>
            <div className="receipt-sub">
              {[sweetLabel(l.sweetness), ...l.toppings.map((t) => `+${t.name} ${baht(t.price)}`)].filter(Boolean).join(' · ')}
            </div>
            {l.discounts.map((d) => (
              <div key={d.id} className="receipt-row receipt-sub"><span>&nbsp;&nbsp;{d.name}</span><span>−{baht(d.amount)}</span></div>
            ))}
            {l.note && <div className="receipt-sub">* {l.note}</div>}
          </div>
        ))}
      </div>
      <div className="receipt-totals">
        <div className="receipt-row"><span>รวม ({order.cups} แก้ว)</span><span>{baht(order.gross)}</span></div>
        {order.discountTotal > 0 && <div className="receipt-row"><span>ส่วนลด</span><span>−{baht(order.discountTotal)}</span></div>}
        <div className="receipt-row receipt-grand"><span>ยอดสุทธิ</span><span>{baht(order.total)}</span></div>
        <div className="receipt-row"><span>ชำระโดย</span><span>{order.paymentMethod === 'cash' ? 'เงินสด' : 'เงินโอน'}</span></div>
        {order.paymentMethod === 'cash' && (
          <>
            <div className="receipt-row"><span>รับเงิน</span><span>{baht(order.cashReceived)}</span></div>
            <div className="receipt-row"><span>เงินทอน</span><span>{baht(order.change)}</span></div>
          </>
        )}
      </div>
      {order.loyalty && (
        <div className="receipt-totals receipt-stamps">
          {order.loyalty.used > 0 && <div className="receipt-row"><span>แลกแต้มฟรี {order.loyalty.redeemedCups} แก้ว</span><span>−{order.loyalty.used} แต้ม</span></div>}
          <div className="receipt-row"><span>ได้รับแต้ม</span><span>+{order.loyalty.earned}</span></div>
          <div className="receipt-row"><b>แต้มสะสมคงเหลือ</b><b>{order.loyalty.balance}</b></div>
        </div>
      )}
      {order.status === 'void' && <div className="receipt-void">*** บิลนี้ถูกยกเลิก ***</div>}
      {settings?.receiptFooter && <div className="receipt-foot">{settings.receiptFooter}</div>}
    </div>
  );
}

export function printReceipt() {
  document.body.classList.add('printing-receipt');
  setTimeout(() => {
    window.print();
    document.body.classList.remove('printing-receipt');
  }, 50);
}
