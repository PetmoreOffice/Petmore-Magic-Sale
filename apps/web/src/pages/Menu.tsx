import { type ComponentType, lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRightIcon, ArrowRightIcon, BoxesIcon, ChevronRightIcon, ClipboardCheckIcon, ClipboardListIcon, PackagePlusIcon, QrCodeIcon, Undo2Icon,
} from 'lucide-react';
import { cn } from 'cn';
import type { CheckCounts, Paged, Permission, ProductReturn } from '@petmore/shared';
import { MagicStage, TONES, type Tone } from '@/components/magic';
import SpotlightCard from '@/components/SpotlightCard';
import { usePrefersReducedMotion } from '@/lib/motion';
import { api } from '../api';

// ตัวนับใช้ motion/react โหลดแยกไฟล์ หน้าแรกจะได้ไม่ต้องรอไลบรารีแอนิเมชัน
const CountUp = lazy(() => import('@/components/CountUp'));
import { useAuth } from '../auth';

interface Task {
  to: string;
  title: string;
  hint: string;
  perms: Permission[];
  icon: ComponentType<{ className?: string }>;
  tone: Tone;
}

/** งานขายหน้างานเป็นลำดับ: จดออเดอร์ → ตรวจของที่เบิก → คืนของที่เหลือ แสดงเป็นเส้นทางเดียวกัน */
const SALES_FLOW: Task[] = [
  { to: '/orders', title: 'ออเดอร์สินค้า', hint: 'จดออเดอร์ของผู้สั่ง และดูออเดอร์ย้อนหลัง', perms: ['orders.view', 'orders.create'], icon: ClipboardListIcon, tone: 'star' },
  { to: '/check', title: 'ตรวจของเบิก', hint: 'สแกนของที่เบิกมา เทียบกับออเดอร์ว่าครบ ขาด หรือเกิน', perms: ['picks.check'], icon: ClipboardCheckIcon, tone: 'mint' },
  { to: '/returns', title: 'คืนสินค้า', hint: 'คืนของที่เบิกเกิน ขายไม่หมด หรือปิดงานอีเวนต์', perms: ['returns.create'], icon: Undo2Icon, tone: 'kibble' },
];

const WAREHOUSE: Task[] = [
  { to: '/receive', title: 'รับสินค้า', hint: 'สแกนสินค้าและ Location เพิ่มสต็อก', perms: ['receive.create'], icon: PackagePlusIcon, tone: 'sky' },
  { to: '/move', title: 'ย้าย Location', hint: 'สแกนต้นทาง เลือกสินค้า สแกนปลายทาง', perms: ['move.create'], icon: ArrowLeftRightIcon, tone: 'plum' },
  { to: '/stock', title: 'ดูสต็อก', hint: 'ค้นตาม SKU บาร์โค้ด Location ล็อต', perms: ['stock.view'], icon: BoxesIcon, tone: 'rose' },
  { to: '/labels', title: 'พิมพ์ป้าย Location', hint: 'ป้าย QR + บาร์โค้ด A4 หน้าละ 3 ป้าย', perms: ['locations.print'], icon: QrCodeIcon, tone: 'mint' },
];

/** คำทักตามช่วงเวลา (เวลาไทย) */
function greeting(now: Date) {
  const h = Number(now.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }));
  return h < 12 ? 'อรุณสวัสดิ์' : h < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
}

/**
 * หน้าแรก: ท้องฟ้าทักทาย + งานค้างวันนี้ (แตะไปทำต่อได้) แล้วแยกงานเป็น 2 กลุ่ม
 * งานขายหน้างานเรียงเป็นเส้นทาง 3 ขั้น งานคลังเป็นช่องเล็กสีต่างกัน ใช้ตามสิทธิ์ของแต่ละคน
 */
export function MenuPage() {
  const { user, has } = useAuth();
  const reduce = usePrefersReducedMotion();
  const flow = SALES_FLOW.filter((t) => has(...t.perms));
  const warehouse = WAREHOUSE.filter((t) => has(...t.perms));
  const scope = user?.warehouseScope;
  const now = new Date();
  const [counts, setCounts] = useState<CheckCounts | null>(null);
  const [returnsTotal, setReturnsTotal] = useState<number | null>(null);

  // งานค้าง: ออเดอร์รอตรวจ / ตรวจแล้วไม่ครบ (สิทธิ์ตรวจของ) และจำนวนใบคืน (สิทธิ์คืนสินค้า) ไม่มีสิทธิ์ก็ไม่ดึง
  useEffect(() => {
    let live = true;
    if (has('picks.check')) api<CheckCounts>('/orders/check-counts').then((c) => { if (live) setCounts(c); }).catch(() => undefined);
    if (has('returns.create')) api<Paged<ProductReturn>>('/returns?page=1').then((r) => { if (live) setReturnsTotal(r.total); }).catch(() => undefined);
    return () => { live = false; };
  }, [user?.id]);

  const num = (n: number) => {
    const plain = n.toLocaleString('th-TH');
    return reduce ? plain : <Suspense fallback={plain}><CountUp to={n} duration={0.8} separator="," /></Suspense>;
  };

  return (
    <div className="grid gap-8 pb-4">
      <MagicStage className="grid gap-5 sm:py-7">
        <div className="grid gap-1">
          <p className="text-sm text-brand-foreground/75">{now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' })}</p>
          <p className="font-heading text-2xl font-semibold text-balance sm:text-3xl">{greeting(now)} คุณ{user?.displayName}</p>
          <p className="text-sm text-brand-foreground/75">ขอบเขตคลัง: {scope?.all ? 'ทุกคลัง' : scope?.codes.join(', ') || 'ยังไม่ได้รับสิทธิ์คลัง ติดต่อผู้ดูแลระบบ'}</p>
        </div>
        {(counts || returnsTotal !== null) && (
          <div className="flex flex-wrap gap-2" aria-label="งานค้าง">
            {counts && (
              <Link to="/check" className={cn('inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-star/60', counts.PENDING ? 'bg-star text-on-star' : 'bg-on-sky/10 text-brand-foreground ring-1 ring-on-sky/15 hover:bg-on-sky/15')}>
                <ClipboardCheckIcon className="size-4" aria-hidden />
                {counts.PENDING ? <>รอตรวจของ <span className="tabular-nums">{num(counts.PENDING)}</span> ออเดอร์</> : counts.ALL ? 'ตรวจของครบทุกออเดอร์แล้ว' : 'ยังไม่มีออเดอร์ให้ตรวจ'}
              </Link>
            )}
            {counts && counts.MISMATCH > 0 && (
              <Link to="/check" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-rose-soft px-4 text-sm font-semibold text-rose outline-none focus-visible:ring-3 focus-visible:ring-star/60">
                ตรวจแล้วไม่ครบ <span className="tabular-nums">{num(counts.MISMATCH)}</span> ออเดอร์
              </Link>
            )}
            {returnsTotal !== null && (
              <Link to="/returns" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-on-sky/10 px-4 text-sm font-semibold text-brand-foreground ring-1 ring-on-sky/15 outline-none hover:bg-on-sky/15 focus-visible:ring-3 focus-visible:ring-star/60">
                <Undo2Icon className="size-4" aria-hidden />ใบคืนทั้งหมด <span className="tabular-nums">{num(returnsTotal)}</span> ใบ
              </Link>
            )}
          </div>
        )}
      </MagicStage>

      {flow.length > 0 && (
        <section className="grid gap-3" aria-labelledby="menu-sales">
          <div>
            <h2 id="menu-sales" className="font-heading text-xl font-semibold">งานขายหน้างาน</h2>
            <p className="text-sm text-muted-foreground">จดออเดอร์ ตรวจของที่เบิก แล้วคืนของที่เหลือ ตามลำดับ</p>
          </div>
          {/* เส้นทาง 3 ขั้น: จอกว้างเรียงแนวนอนมีลูกศรเชื่อม มือถือเรียงลงมาเป็นเส้นดาว */}
          <ol className="relative grid gap-3 lg:grid-cols-[repeat(var(--steps),minmax(0,1fr))] lg:gap-6" style={{ ['--steps' as string]: flow.length }}>
            <span aria-hidden className="absolute top-6 bottom-6 left-[2.55rem] w-px bg-gradient-to-b from-star/60 via-mint/50 to-kibble/60 lg:hidden" />
            {flow.map((t, i) => (
              <li key={t.to} className="relative">
                {i > 0 && <ArrowRightIcon aria-hidden className="absolute top-1/2 -left-[1.2rem] hidden size-4 -translate-y-1/2 text-muted-foreground lg:block" />}
                <SpotlightCard className="h-full transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-star/60 hover:shadow-lift motion-reduce:hover:translate-y-0">
                  <Link to={t.to} className="relative flex h-full min-h-28 items-center gap-4 p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset lg:min-h-40 lg:flex-col lg:items-start lg:justify-between">
                    <span className={cn('relative grid size-12 shrink-0 place-items-center rounded-2xl', TONES[t.tone])}>
                      <t.icon className="size-6" aria-hidden />
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5 lg:flex-none">
                      <span className="font-heading text-lg font-semibold">{t.title}</span>
                      <span className="text-sm text-muted-foreground">{t.hint}</span>
                    </span>
                    <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground lg:hidden" aria-hidden />
                  </Link>
                </SpotlightCard>
              </li>
            ))}
          </ol>
        </section>
      )}

      {warehouse.length > 0 && (
        <section className="grid gap-3" aria-labelledby="menu-warehouse">
          <div>
            <h2 id="menu-warehouse" className="font-heading text-xl font-semibold">งานคลัง</h2>
            <p className="text-sm text-muted-foreground">รับเข้า ย้ายที่เก็บ ดูยอด และป้ายชั้นวาง</p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {warehouse.map((t) => (
              <li key={t.to}>
                <Link
                  to={t.to}
                  className="group flex h-full min-h-20 items-center gap-3 rounded-xl border border-border bg-card p-3 outline-none transition-[border-color,background-color] hover:border-star/50 hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', TONES[t.tone])}><t.icon className="size-5" aria-hidden /></span>
                  <span className="grid min-w-0 flex-1">
                    <span className="font-semibold">{t.title}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{t.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!flow.length && !warehouse.length && <p className="rounded-xl bg-secondary p-4 text-sm">บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งานเมนูใด ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์</p>}
    </div>
  );
}
