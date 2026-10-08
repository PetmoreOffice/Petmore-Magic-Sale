import React, { useRef } from 'react';
import { cn } from 'cn';

/**
 * SpotlightCard จาก React Bits (https://reactbits.dev) ปรับให้เข้าธีม:
 * แสงทองจางตามเมาส์บนจอคอม และสว่างค้างเมื่อโฟกัสด้วยคีย์บอร์ด
 * จอสัมผัส/Handheld ไม่มี hover จึงไม่มีอะไรวิ่ง ไม่กวนการสแกน
 * ตำแหน่งแสงเขียนลงตัวแปร CSS ตรงๆ ไม่ผ่าน state การ์ดจึงไม่ render ใหม่ทุกครั้งที่ขยับเมาส์
 */
interface SpotlightCardProps extends React.PropsWithChildren {
  className?: string;
  spotlightColor?: string;
}

const SpotlightCard: React.FC<SpotlightCardProps> = ({ children, className, spotlightColor = 'color-mix(in oklab, var(--pm-star) 22%, transparent)' }) => {
  const divRef = useRef<HTMLDivElement>(null);
  const focused = useRef(false);

  const set = (name: string, value: string) => divRef.current?.style.setProperty(name, value);

  const handleMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!divRef.current || focused.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    set('--spot-x', `${e.clientX - rect.left}px`);
    set('--spot-y', `${e.clientY - rect.top}px`);
  };

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onFocus={() => { focused.current = true; set('--spot-o', '0.9'); }}
      onBlur={() => { focused.current = false; set('--spot-o', '0'); }}
      onMouseEnter={() => set('--spot-o', '0.9')}
      onMouseLeave={() => { if (!focused.current) set('--spot-o', '0'); }}
      className={cn('relative overflow-hidden rounded-xl border border-border bg-card', className)}
      style={{ '--spot-color': spotlightColor } as React.CSSProperties}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-500 ease-out"
        style={{ opacity: 'var(--spot-o, 0)', background: 'radial-gradient(circle at var(--spot-x, 50%) var(--spot-y, 50%), var(--spot-color), transparent 70%)' }}
      />
      {children}
    </div>
  );
};

export default SpotlightCard;
