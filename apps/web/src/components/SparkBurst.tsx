import { forwardRef, useImperativeHandle, useRef } from 'react';

export interface SparkBurstHandle {
  burst: () => void;
}

interface Props {
  color?: string;
  count?: number;
  /** ระยะที่ประกายพุ่งออกจากขอบ (px) */
  reach?: number;
  length?: number;
  duration?: number;
}

const BLEED = 28;

/**
 * ประกายทองพุ่งออกจากขอบกล่อง ใช้เป็นจังหวะตอบรับเมื่อสแกนหรือบันทึกสำเร็จ
 * ดัดแปลงวิธีวาดจาก ClickSpark ของ React Bits แต่สั่งด้วยโค้ด (burst()) แทนการคลิก
 * เพราะ Handheld สแกนด้วยปุ่ม Enter ไม่มีการคลิก และวาดเฉพาะตอนสั่ง ไม่วนลูปค้างไว้
 * วางไว้ในกล่องที่มี position: relative
 */
export const SparkBurst = forwardRef<SparkBurstHandle, Props>(function SparkBurst(
  { color, count = 12, reach = 22, length = 12, duration = 520 },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const run = useRef(0);

  useImperativeHandle(
    ref,
    () => ({
      burst() {
        const canvas = canvasRef.current;
        const box = canvas?.parentElement;
        if (!canvas || !box || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        // ใช้สีทองจากธีม (--pm-star) เปลี่ยนธีมที่ styles.css แล้วประกายเปลี่ยนตาม
        const stroke = color ?? (getComputedStyle(box).getPropertyValue('--pm-star').trim() || 'gold');
        const { width, height } = box.getBoundingClientRect();
        const w = width + BLEED * 2;
        const h = height + BLEED * 2;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const cx = w / 2;
        const cy = h / 2;
        // เริ่มนับเวลาจากเฟรมแรกที่วาดจริง ถ้าเครื่องช้าหรือหน้าเว็บกำลังทำงานหนัก ประกายจะยังเล่นครบ ไม่ข้ามไปจบเลย
        let start: number | null = null;
        const id = ++run.current;

        const frame = (now: number) => {
          if (id !== run.current) return;
          start ??= now;
          const p = Math.min(1, (now - start) / duration);
          const e = p * (2 - p);
          ctx.clearRect(0, 0, w, h);
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.globalAlpha = 1 - p * 0.6;
          for (let i = 0; i < count; i++) {
            const a = (Math.PI * 2 * i) / count;
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            // เริ่มจากขอบกล่อง (วงรีตามขนาดกล่อง) แล้วพุ่งออกด้านนอก
            const bx = cx + cos * (width / 2);
            const by = cy + sin * (height / 2);
            const d = e * reach;
            const l = length * (1 - e);
            ctx.beginPath();
            ctx.moveTo(bx + cos * d, by + sin * d);
            ctx.lineTo(bx + cos * (d + l), by + sin * (d + l));
            ctx.stroke();
          }
          if (p < 1) requestAnimationFrame(frame);
          else ctx.clearRect(0, 0, w, h);
        };
        requestAnimationFrame(frame);
      },
    }),
    [color, count, reach, length, duration],
  );

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute z-10"
      style={{ inset: -BLEED, width: `calc(100% + ${BLEED * 2}px)`, height: `calc(100% + ${BLEED * 2}px)` }}
    />
  );
});
