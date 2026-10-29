/**
 * บูธในงาน Petmore Magic Sale 30 ต.ค. – 1 พ.ย. 2569 (แปลน updated 25/08/2569) ผูกกับรหัสผู้สั่งใน dbo.ICCAT
 * ชื่อบริษัทที่แสดงดึงจากทะเบียนผู้สั่ง (sync จาก ICCAT) ไม่เก็บซ้ำที่นี่ ตรวจชื่อกับผู้ใช้แล้ว 2026-10-18
 * บูธ 10/15 สลับตามบัญชี Booth10/Booth15 ที่ผู้ใช้ตั้งตามแปลนจริง (ผู้ใช้ยืนยัน 2026-10-29)
 */
export const EVENT_BOOTHS: readonly { booth: number; customerCode: string }[] = [
  { booth: 1, customerCode: '002' }, // เพอร์เฟค คอมพาเนียน กรุ๊ป (Me-O)
  { booth: 2, customerCode: '005' }, // บลูฟาโล่ (Bok Dok)
  { booth: 3, customerCode: '007' }, // ฟู้ด อินโนวา (Nekko, Toro)
  { booth: 4, customerCode: '004' }, // โรยัล คานิน
  { booth: 5, customerCode: '156' }, // มาร์ส ไทยแลนด์ (Whiskas)
  { booth: 6, customerCode: '044' }, // เกรทเทสท์ เพ็ทแคร์
  { booth: 7, customerCode: '067' }, // ไฮคิวผลิตภัณฑ์อาหาร (VIF)
  { booth: 8, customerCode: '023' }, // ชอว์ ปิง (Pramy)
  { booth: 9, customerCode: '079' }, // เคเค เพาเวอร์ ช็อป (Powercat)
  { booth: 10, customerCode: '121' }, // บีเจซี คอนซูเมอร์ (Ginno)
  { booth: 11, customerCode: '147' }, // โบทานี เพ็ทแคร์ (Bravo Boss)
  { booth: 12, customerCode: '165' }, // อมตะ888 (ChicChic)
  { booth: 13, customerCode: '089' }, // เว็ทซิโนว่า (VFcore)
  { booth: 14, customerCode: '164' }, // โฟร์ พี กรุ๊ป (mypaws)
  { booth: 15, customerCode: '070' }, // เพ็ท เซอร์เคิล
  { booth: 16, customerCode: '009' }, // ซิลลิค ฟาร์มา (MARIA)
  { booth: 17, customerCode: '158' }, // วินดา เทรดดิ้ง 2017 (Cheer Share)
  { booth: 18, customerCode: '043' }, // เพ็ท โฟกัส (Dog n Joy)
  { booth: 19, customerCode: '115' }, // พอดี อินโนเวชั่น (Pawdy)
  { booth: 20, customerCode: '010' }, // อินเตอร์เนชั่นแนล เพ็ท ฟู้ด (Jerhigh)
  { booth: 21, customerCode: '015' }, // ออสแทม กู๊ดส์ (BUZZ)
  { booth: 22, customerCode: '042' }, // เนสท์เล่ (Purina ONE)
  { booth: 23, customerCode: '040' }, // เพ็ทโพรเทคท์ (Kaniva)
];

/** เลขบูธของผู้สั่ง (ไม่มีบูธในงาน = undefined) */
export function boothOf(customerCode: string): number | undefined {
  return EVENT_BOOTHS.find((b) => b.customerCode === customerCode)?.booth;
}
