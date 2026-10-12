import { ComponentType, ReactNode, useId } from 'react';
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

/** ขอบในของตราเคลือบ: เส้นสีเดียวกับตัวอักษร + แสงบางที่ขอบบน เหมือนเข็มกลัดเคลือบ */
const ENAMEL = 'ring-1 ring-inset ring-current/20 shadow-[inset_0_1px_0_color-mix(in_oklab,white_45%,transparent)] dark:shadow-[inset_0_1px_0_color-mix(in_oklab,white_8%,transparent)]';

export function ToneChip({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold whitespace-nowrap', TONES[tone], ENAMEL, className)}>{children}</span>;
}

/**
 * ประกายสี่แฉก ตราประจำเวทมนตร์ของแอป (วาดเอง ไม่ใช้ไอคอนทั่วไป)
 * solid = ร่ายสำเร็จ, outline = ยังไม่ได้ร่าย, half = ร่ายได้ครึ่งเดียว, broken = เวทแตก (ไม่ตรง/เสียหาย)
 */
export type SparkleState = 'solid' | 'outline' | 'half' | 'broken';
const SPARKLE = 'M12 1.5C12.9 8 16 11.1 22.5 12C16 12.9 12.9 16 12 22.5C11.1 16 8 12.9 1.5 12C8 11.1 11.1 8 12 1.5Z';
export function Sparkle({ state = 'solid', className }: { state?: SparkleState; className?: string }) {
  const clip = useId();
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-4 shrink-0', className)}>
      {state === 'half' && <clipPath id={clip}><rect x="0" y="12" width="24" height="12" /></clipPath>}
      {(state === 'solid' || state === 'half') && <path d={SPARKLE} fill="currentColor" clipPath={state === 'half' ? `url(#${clip})` : undefined} />}
      {state !== 'solid' && <path d={SPARKLE} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" strokeDasharray={state === 'outline' ? '3 2.2' : undefined} />}
      {state === 'broken' && <path d="M5 19 19 5" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />}
    </svg>
  );
}

/**
 * ช่องรอร่ายเวท: กล่องที่ยังว่าง (ยังไม่ได้สแกน / ยังไม่มีข้อมูล) เส้นประทองจางบนพื้นทองอ่อนมาก
 * ประกายเส้นประที่มุมขวาบนและซ้ายล่าง อ่านเป็น "วงเวทที่ยังไม่ได้ร่าย" แทนกล่องเส้นประเทาธรรมดา
 */
export const SPELL_SLOT = 'relative rounded-xl border border-dashed border-star-ink/40 bg-star-soft/30 dark:border-star/50';
export function SlotSparkles({ filled }: { filled?: boolean }) {
  return (
    <>
      <Sparkle state={filled ? 'solid' : 'outline'} className={cn('pointer-events-none absolute top-2 right-2 size-3.5', filled ? 'text-star-ink dark:text-star' : 'text-star-ink/60 dark:text-star/60')} />
      {!filled && <Sparkle state="outline" className="pointer-events-none absolute bottom-2 left-2 size-2.5 text-star-ink/45 dark:text-star/45" />}
    </>
  );
}

/**
 * ตราสถานะ (Seal) ป้ายเล็กของทั้งแอป: เม็ดเคลือบสีตามสถานะ มีประกายสี่แฉกเป็นตราด้านหน้า
 * สถานะเดียวกันได้รูปประกายเดียวกันทุกหน้า อ่านออกแม้ไม่เห็นสี (รูปทรงต่างกัน ไม่ใช่แค่สี)
 */
export function Seal({ tone, state = 'solid', children, className }: { tone: Tone | 'muted'; state?: SparkleState; children: ReactNode; className?: string }) {
  const pending = state === 'outline';
  return (
    <span
      className={cn(
        'inline-flex h-7 w-fit shrink-0 items-center gap-1.5 rounded-full pr-3 pl-1.5 text-xs font-semibold whitespace-nowrap',
        tone === 'muted' ? 'bg-muted text-muted-foreground' : TONES[tone],
        pending ? 'border border-dashed border-current/45 bg-transparent' : ENAMEL,
        className,
      )}
    >
      <span className={cn('grid size-5 place-items-center rounded-full', !pending && 'bg-current/12')}>
        <Sparkle state={state} className="size-3.5" />
      </span>
      {children}
    </span>
  );
}

/**
 * วงเวท (medallion) รอบไอคอนเมนู: วงขีดแบบนาฬิกาดาวล้อมแผ่นสีของเมนู ใช้แทนสี่เหลี่ยมมนธรรมดา
 * ขีดรอบวงเป็นสีเดียวกับไอคอน วงไม่หมุน (เวทมนตร์เป็นจังหวะตอบรับ ไม่ใช่ของประดับที่ขยับ)
 */
export function Medallion({ tone, icon: Icon, size = 'md', className }: { tone: Tone; icon: ComponentType<{ className?: string }>; size?: 'md' | 'lg'; className?: string }) {
  const ticks = size === 'lg' ? 24 : 16;
  return (
    <span className={cn('relative grid shrink-0 place-items-center', size === 'lg' ? 'size-16' : 'size-12', TONES[tone].split(' ')[1], className)}>
      <svg viewBox="0 0 64 64" aria-hidden className="absolute inset-0 size-full">
        <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} />
        {Array.from({ length: ticks }, (_, i) => {
          const a = (i / ticks) * Math.PI * 2;
          const long = i % (ticks / 4) === 0;
          const r1 = long ? 25 : 27;
          return <line key={i} x1={32 + Math.cos(a) * r1} y1={32 + Math.sin(a) * r1} x2={32 + Math.cos(a) * 30} y2={32 + Math.sin(a) * 30} stroke="currentColor" strokeOpacity={long ? 0.7 : 0.35} strokeWidth={long ? 1.6 : 1} />;
        })}
      </svg>
      <span className={cn('relative grid place-items-center rounded-full', size === 'lg' ? 'size-11' : 'size-8', TONES[tone], ENAMEL)}>
        <Icon className={size === 'lg' ? 'size-6' : 'size-[18px]'} aria-hidden />
      </span>
    </span>
  );
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

/** กลุ่มดาวมุมขวาบนของเวที: ดาวทองเชื่อมเส้นบางเป็นรูปหมวกพ่อมด (ลายเซ็นเวทมนตร์ของแอป) */
const HAT: [number, number][] = [[8, 70], [40, 58], [58, 14], [70, 50], [104, 64]];
function HatConstellation({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 112 80" aria-hidden className={cn('pointer-events-none absolute -z-10', className)}>
      <path d={HAT.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')} fill="none" stroke="var(--pm-star)" strokeOpacity={0.35} strokeWidth={0.8} />
      <path d="M8 70 Q56 82 104 64" fill="none" stroke="var(--pm-star)" strokeOpacity={0.22} strokeWidth={0.8} strokeDasharray="2 3" />
      {HAT.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === 2 ? 2.4 : 1.6} fill={i === 2 ? 'var(--pm-star)' : 'color-mix(in oklab, var(--pm-on-sky) 80%, transparent)'} />)}
      <path d="M58 2.5C58.5 6 60 7.5 63.5 8C60 8.5 58.5 10 58 13.5C57.5 10 56 8.5 52.5 8C56 7.5 57.5 6 58 2.5Z" fill="var(--pm-star)" opacity={0.9} />
    </svg>
  );
}

/** มุมกรอบสมุดคาถา: ประกายทองเล็กที่มุมทั้งสี่ของเส้นกรอบใน */
const CORNERS = ['top-2 left-2', 'top-2 right-2', 'bottom-2 left-2', 'bottom-2 right-2'];

/**
 * กรอบสมุดคาถาสำหรับการ์ดพื้นสว่าง/พื้นผิวปกติ (เช่น การ์ดเข้าสู่ระบบ): เส้นทองบางด้านในห่างขอบ 8px + ประกายสี่มุม
 * ชุดเดียวกับ StageDecor แต่สีเข้มพอบนพื้นการ์ดโหมดสว่าง แม่ต้องเป็น relative isolate
 */
export function SpellFrame({ inset = 2, className }: { inset?: 2 | 3; className?: string }) {
  // inset 3 (12px) ใช้กับบัตรที่มีรอยเว้า 14px ที่มุม: มุมโค้งของกรอบจะไม่ชนรอยเว้า
  const pos = inset === 3 ? ['top-3 left-3', 'top-3 right-3', 'bottom-3 left-3', 'bottom-3 right-3'] : CORNERS;
  return (
    <>
      <div aria-hidden className={cn('pointer-events-none absolute -z-10 rounded-xl border border-star-ink/25 dark:border-star/25', inset === 3 ? 'inset-3' : 'inset-2', className)} />
      {pos.map((c) => (
        <svg key={c} viewBox="0 0 24 24" aria-hidden className={cn('pointer-events-none absolute -z-10 size-3 text-star-ink/70 dark:text-star/70', c, c.includes('right') ? 'translate-x-1/2' : '-translate-x-1/2', c.includes('bottom') ? 'translate-y-1/2' : '-translate-y-1/2', className)}>
          <path d={SPARKLE} fill="currentColor" />
        </svg>
      ))}
    </>
  );
}

/** พื้นเวที: แสงจากด้านบน + ม่านกำมะหยี่สองข้าง ใช้ร่วมกันทุกป้ายบนท้องฟ้า (เวทีหัวหน้า กล่องสแกน) */
export const STAGE_BACKGROUND =
  'radial-gradient(ellipse at 50% -70%, color-mix(in oklab, var(--pm-stage-light) 30%, transparent), transparent 75%), linear-gradient(110deg, var(--pm-velvet), transparent 32%, transparent 68%, var(--pm-velvet))';

/**
 * ของประดับเวทีชุดเดียวกันทุกป้าย: ดาวนิ่ง เส้นทองขอบบน กรอบในเส้นทองแบบหน้าสมุดคาถา ประกายสี่มุม และรอยเท้าจาง
 * hat = กลุ่มดาวรูปหมวกพ่อมดมุมขวาบน (ปิดในกล่องสแกน เพราะมุมนั้นมีป้าย "พร้อมสแกน")
 * แม่ต้องเป็น relative isolate overflow-hidden ทุกชิ้นอยู่หลังเนื้อหา (-z-10) และนิ่ง ไม่ขยับ
 */
export function StageDecor({ hat = true, paw = 'lg' }: { hat?: boolean; paw?: 'lg' | 'sm' }) {
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-35" style={{ backgroundImage: STARS_A }} />
      <div aria-hidden className="pointer-events-none absolute inset-x-6 top-0 h-px bg-star/35" />
      <div aria-hidden className="pointer-events-none absolute inset-2 -z-10 rounded-xl border border-star/20" />
      {CORNERS.map((c) => (
        <svg key={c} viewBox="0 0 24 24" aria-hidden className={cn('pointer-events-none absolute -z-10 size-3 text-star/70', c, c.includes('right') ? 'translate-x-1/2' : '-translate-x-1/2', c.includes('bottom') ? 'translate-y-1/2' : '-translate-y-1/2')}>
          <path d={SPARKLE} fill="currentColor" />
        </svg>
      ))}
      {hat && <HatConstellation className="top-3 right-4 h-16 w-24 sm:right-8 sm:h-20 sm:w-28" />}
      <PawPrintIcon aria-hidden className={cn('pointer-events-none absolute -z-10 rotate-[-18deg] text-on-sky/[0.06]', paw === 'lg' ? '-right-3 -bottom-5 size-24 sm:size-32' : '-right-2 -bottom-4 size-20')} />
    </>
  );
}

/**
 * เวทีท้องฟ้ายามค่ำด้านบนหน้า (ป้ายหัวหน้า): พื้น Night Sky ทั้งสองโหมด แสงจากด้านบน ม่านกำมะหยี่ที่ขอบ
 * กรอบในเส้นทองบางแบบหน้าสมุดคาถา มีประกายที่มุม กลุ่มดาวรูปหมวกพ่อมดมุมขวาบน และรอยเท้าจางเป็นลายเซ็นร้านสัตว์เลี้ยง
 * ทุกอย่างนิ่ง ไม่ขยับ (ไม่แย่งสายตาจากงาน)
 */
export function MagicStage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        'relative isolate overflow-hidden rounded-2xl bg-brand px-4 py-4 text-brand-foreground shadow-stage sm:px-6 sm:py-5 print:hidden',
        className,
      )}
      style={{ backgroundImage: STAGE_BACKGROUND }}
    >
      <StageDecor />
      {children}
    </section>
  );
}
