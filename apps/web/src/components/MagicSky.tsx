import { lazy, Suspense, useMemo } from 'react';
import { cn } from 'cn';

// Galaxy มาจาก React Bits (WebGL + ogl) โหลดแยกไฟล์ หน้าเว็บส่วนอื่นไม่ต้องรอ
const Galaxy = lazy(() => import('./Galaxy'));

// Galaxy ใช้ props ที่เป็น array เป็น dependency ของ effect
// ถ้าส่ง array ใหม่ทุกครั้งที่ render (เช่นพิมพ์ในฟอร์ม) จะสร้าง WebGL ใหม่ทุกครั้ง จึงต้องเป็นค่าคงที่
const FOCAL: [number, number] = [0.5, 0.5];
const ROTATION: [number, number] = [1, 0];

type SkyQuality = { animate: false } | { animate: true; resolutionScale: number; maxFps: number };

function pickQuality(): SkyQuality {
  if (typeof window === 'undefined') return { animate: false };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return { animate: false };
  // เครื่อง RAM น้อย (Handheld รุ่นเล็ก) ใช้ดาวนิ่งจาก CSS แทน
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (memory !== undefined && memory <= 2) return { animate: false };
  try {
    if (!document.createElement('canvas').getContext('webgl')) return { animate: false };
  } catch {
    return { animate: false };
  }
  // จอสัมผัส (มือถือ/Handheld) วาดครึ่งความละเอียด ดาวกระพริบช้าอยู่แล้ว 30 เฟรมต่อวินาทีพอ
  const touch = window.matchMedia('(pointer: coarse)').matches;
  return { animate: true, resolutionScale: touch ? 0.5 : 1, maxFps: 30 };
}

/**
 * ท้องฟ้ายามค่ำมีดาวระยิบระยับ วางไว้หลังเนื้อหา
 * เครื่องที่ตั้งลดการเคลื่อนไหว ไม่มี WebGL หรือ RAM น้อย จะเห็นดาวนิ่งจาก CSS ของพื้นหลังแทน
 */
export function MagicSky({ className }: { className?: string }) {
  const quality = useMemo(pickQuality, []);
  return (
    <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      {quality.animate && (
        <Suspense fallback={null}>
          <Galaxy
            focal={FOCAL}
            rotation={ROTATION}
            density={0.8}
            glowIntensity={0.35}
            saturation={0.45}
            hueShift={30}
            twinkleIntensity={0.6}
            rotationSpeed={0.02}
            starSpeed={0.3}
            speed={0.6}
            mouseInteraction={false}
            mouseRepulsion={false}
            transparent
            resolutionScale={quality.resolutionScale}
            maxFps={quality.maxFps}
          />
        </Suspense>
      )}
    </div>
  );
}
