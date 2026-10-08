// ขนาดช่องกรอกสำหรับ Handheld/มือถือ (สูง 48px) ใช้กับ <Input className={touchInput} />
export const touchInput = 'h-12 px-3 text-base md:text-base';

/**
 * เปลี่ยนหน้ารายการ (ถัดไป/ก่อนหน้า) แล้วกระโดดกลับไปต้นรายการทันที เหมือนร้านค้าออนไลน์ทั่วไป
 * ไม่เลื่อนแบบ smooth: จากท้ายรายการ 30 ชิ้นไกลหลายพันพิกเซล เลื่อนช้าจนดูเหมือนค้าง
 * ใส่ scroll-mt-20 ที่ปลายทางกันหัวแถบด้านบน (sticky) บัง
 */
export function scrollToStart(el: Element | null | undefined) {
  if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' });
  else window.scrollTo({ top: 0, behavior: 'instant' });
}
