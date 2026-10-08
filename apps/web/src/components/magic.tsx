import { ReactNode } from 'react';
import { PawPrintIcon } from 'lucide-react';
import { cn } from 'cn';

/**
 * ชุดสีของหน้าออเดอร์ ใช้จาก design-board: Night Sky (ฉาก) · Starlight (เวทมนตร์/ปุ่มหลัก)
 * · Kibble (ขนาดใหญ่) · Potion Mint (ชิ้น/สำเร็จ) เพิ่ม rose/sky/plum ไว้แยกหมวดสินค้าให้ตาจำได้
 * ทุกคู่พื้นอ่อน + ตัวอักษรผ่าน 4.5:1 ทั้งโหมดสว่างและมืด
 */
export const TONES = {
  plum: 'bg-plum-soft text-plum',
  star: 'bg-star-soft text-star-ink',
  kibble: 'bg-kibble-soft text-kibble-ink',
  mint: 'bg-mint-soft text-mint',
  rose: 'bg-rose-soft text-rose',
  sky: 'bg-sky-soft text-sky',
} as const;
export type Tone = keyof typeof TONES;
const HUES: Tone[] = ['plum', 'kibble', 'mint', 'rose', 'sky', 'star'];

/** สีประจำหมวด/ยี่ห้อ: ข้อความเดียวกันได้สีเดียวกันเสมอ */
export function toneFor(text: string): Tone {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return HUES[h % HUES.length];
}

/** สีของขนาดบรรจุตามจำนวนชิ้น: ชิ้นเดี่ยว = มิ้นต์, แพ็คถึงโหล = ทอง, ใหญ่กว่าโหล = คาราเมล */
export function unitTone(qty: number): Tone {
  return qty <= 1 ? 'mint' : qty <= 12 ? 'star' : 'kibble';
}

export function ToneChip({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold whitespace-nowrap', TONES[tone], className)}>{children}</span>;
}

/** ตัวอักษรแรกที่อ่านได้ของชื่อ (ข้ามวงเล็บ ตัวเลข และสระนำ) ใช้เป็นภาพแทนสินค้าที่ยังไม่มีรูป */
export function monogram(text: string): string {
  const m = text.replace(/^[\s([{]*(?:\d+\s*)?/, '').match(/[A-Za-zก-ฮ]/);
  return (m?.[0] ?? text.trim()[0] ?? '?').toUpperCase();
}

const dot = (x: number, y: number, size: number, color: string) => `radial-gradient(${size}px ${size}px at ${x}% ${y}%, ${color} 50%, transparent 51%)`;
const GOLD = 'var(--pm-star)', WHITE = 'color-mix(in oklab, var(--pm-on-sky) 85%, transparent)', DIM = 'color-mix(in oklab, var(--pm-on-sky) 45%, transparent)';
const STARS_A = [
  dot(6, 22, 1.5, WHITE), dot(14, 70, 1, DIM), dot(23, 38, 2, GOLD), dot(31, 84, 1, WHITE), dot(39, 16, 1, DIM), dot(47, 58, 1.5, WHITE),
  dot(55, 30, 1, DIM), dot(62, 78, 2, GOLD), dot(70, 12, 1, WHITE), dot(78, 46, 1, DIM), dot(86, 74, 1.5, WHITE), dot(94, 28, 1, DIM),
].join(', ');
const STARS_B = [
  dot(10, 48, 2, GOLD), dot(19, 10, 1.5, WHITE), dot(35, 62, 1.5, WHITE), dot(51, 86, 1, WHITE), dot(58, 8, 2, GOLD),
  dot(67, 54, 1.5, WHITE), dot(82, 18, 2, GOLD), dot(90, 60, 1, WHITE), dot(97, 88, 1.5, GOLD),
].join(', ');

/**
 * เวทีท้องฟ้ายามค่ำด้านบนหน้า: พื้น Night Sky ทั้งสองโหมด ดาวเลื่อนช้า (ชุดเดียวกับเวทีสแกน)
 * แสงม่วงกับทองจางที่มุม และรอยเท้าจางๆ เป็นลายเซ็นร้านสัตว์เลี้ยง
 */
export function MagicStage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        'relative isolate overflow-hidden rounded-2xl bg-brand px-4 py-4 text-brand-foreground shadow-stage sm:px-6 sm:py-5 print:hidden',
        className,
      )}
      style={{
        backgroundImage:
          'radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, var(--pm-star) 22%, transparent), transparent 55%), radial-gradient(90% 120% at 0% 100%, color-mix(in oklab, var(--pm-accent) 55%, transparent), transparent 60%)',
      }}
    >
      {/* ดาวสองชั้น: ชั้นแรกนิ่ง ชั้นสองกะพริบช้าๆ (ลดการเคลื่อนไหวแล้วหยุดเอง) ตำแหน่งเป็น % จึงกระจายทั่วเวทีทุกขนาดจอ */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ backgroundImage: STARS_A }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 animate-[pulse_5s_ease-in-out_infinite]" style={{ backgroundImage: STARS_B }} />
      <PawPrintIcon aria-hidden className="pointer-events-none absolute -right-3 -bottom-5 -z-10 size-24 rotate-[-18deg] sm:size-32 text-on-sky/[0.06]" />
      {children}
    </section>
  );
}
