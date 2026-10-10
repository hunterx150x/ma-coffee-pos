// Who sells this POS system and for how much. Shown on the public /system page.
// Leave a contact field empty to hide that button.
export const VENDOR = {
  productName: 'MA POS',
  tagline: 'ระบบขายหน้าร้านสำหรับร้านกาแฟและเครื่องดื่ม',
  trialDays: 30,
  contact: {
    name: '',
    phone: '',
    line: '', // https://line.me/ti/p/~yourid หรือ https://lin.ee/xxxx
    email: '',
    facebook: '',
  },
  setupFee: 3000,
  plans: [
    {
      key: 'basic',
      name: 'Basic',
      price: 390,
      features: ['ขายหน้าร้านแบบเป็นขั้นตอน', 'สต๊อกและตัดวัตถุดิบอัตโนมัติ', 'รายงานยอดขาย กำไร-ขาดทุน', 'ผู้ใช้และสิทธิ์พนักงาน'],
    },
    {
      key: 'pro',
      name: 'Pro',
      price: 690,
      highlight: true,
      features: ['ทุกอย่างใน Basic', 'ลูกค้าสแกน QR สั่งเอง + ดูคิวแบบเรียลไทม์', 'รับเงิน QR พร้อมเพย์ + แจ้งโอนพร้อมสลิป', 'สะสมแต้มสมาชิกด้วยเบอร์โทร', 'แจ้งเตือนยอดขายเข้ากลุ่ม LINE'],
    },
  ],
  yearlyNote: 'จ่ายรายปี ลด 2 เดือน',
};
