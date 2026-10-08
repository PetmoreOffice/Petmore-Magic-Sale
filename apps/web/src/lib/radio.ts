/**
 * ปุ่มตัวเลือกแบบ radio ที่ทำเอง (<button role="radio"> ใน role="radiogroup") ให้ทำงานตามแบบ ARIA ทั้งแอป
 * - Tab เข้ากลุ่มได้จุดเดียว (ตัวที่เลือกอยู่ หรือตัวแรกถ้ายังไม่เลือก) ตัวอื่น tabindex=-1
 * - ลูกศร ซ้าย/ขึ้น ขวา/ลง เลื่อนไปตัวก่อน/ถัดไปแล้วเลือกทันที, Home/End ไปตัวแรก/ตัวสุดท้าย ข้ามตัวที่กดไม่ได้
 * ติดตั้งครั้งเดียวที่ main.tsx กลุ่มใหม่ไม่ต้องเขียนอะไรเพิ่ม แค่ใส่ role ให้ถูก
 */
const RADIO = '[role="radio"]';

function radiosOf(group: Element) {
  // เฉพาะตัวเลือกของกลุ่มนี้ ไม่นับกลุ่มที่ซ้อนอยู่ข้างใน
  return [...group.querySelectorAll<HTMLElement>(RADIO)].filter((r) => r.closest('[role="radiogroup"]') === group);
}

const usable = (r: HTMLElement) => !r.hasAttribute('disabled') && r.getAttribute('aria-disabled') !== 'true';

function rove(group: Element) {
  const radios = radiosOf(group);
  const current = radios.find((r) => r.getAttribute('aria-checked') === 'true' && usable(r)) ?? radios.find(usable);
  for (const r of radios) {
    const tab = r === current ? '0' : '-1';
    if (r.getAttribute('tabindex') !== tab) r.setAttribute('tabindex', tab);
  }
}

function onKeyDown(e: KeyboardEvent) {
  const radio = (e.target as Element | null)?.closest?.(RADIO);
  const group = radio?.closest('[role="radiogroup"]');
  if (!radio || !group || e.altKey || e.ctrlKey || e.metaKey) return;
  const radios = radiosOf(group).filter(usable);
  const i = radios.indexOf(radio as HTMLElement);
  if (i < 0) return;
  const next =
    e.key === 'ArrowRight' || e.key === 'ArrowDown' ? radios[(i + 1) % radios.length]
    : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? radios[(i - 1 + radios.length) % radios.length]
    : e.key === 'Home' ? radios[0]
    : e.key === 'End' ? radios[radios.length - 1]
    : null;
  if (!next) return;
  e.preventDefault();
  next.focus();
  if (next.getAttribute('aria-checked') !== 'true') next.click();
}

export function installRadioGroups() {
  document.addEventListener('keydown', onKeyDown);
  let queued = false;
  const sync = () => {
    queued = false;
    document.querySelectorAll('[role="radiogroup"]').forEach(rove);
  };
  // React วาดใหม่/เปลี่ยนตัวที่เลือก → จัด tabindex ใหม่ รวมเป็นครั้งเดียวต่อเฟรม
  new MutationObserver(() => {
    if (!queued) { queued = true; requestAnimationFrame(sync); }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-checked', 'disabled'] });
  sync();
}
