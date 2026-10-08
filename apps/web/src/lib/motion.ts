import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/**
 * เครื่องตั้งลดการเคลื่อนไหวไหม (ตามการตั้งค่าเปลี่ยนสด)
 * ใช้แทน useReducedMotion ของ motion/react ในหน้าที่โหลดพร้อมแอป ไม่ต้องดึงไลบรารีแอนิเมชันมาทั้งก้อน
 */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
