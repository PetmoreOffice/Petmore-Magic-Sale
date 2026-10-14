import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRightIcon, ClipboardCheckIcon, Undo2Icon, WandSparklesIcon } from 'lucide-react';
import { cn } from 'cn';
import type { CheckCounts, Paged, ProductReturn } from '@petmore/shared';
import { MagicStage, Medallion, Sparkle } from '@/components/magic';
import SpotlightCard from '@/components/SpotlightCard';
import { ExportExcel } from '@/components/ExportExcel';
import { APP_MENUS } from '@/lib/menus';
import { usePrefersReducedMotion } from '@/lib/motion';
import { api } from '../api';
import { useAuth } from '../auth';

// ตัวนับใช้ motion/react โหลดแยกไฟล์ หน้าแรกจะได้ไม่ต้องรอไลบรารีแอนิเมชัน
const CountUp = lazy(() => import('@/components/CountUp'));

/** งานขายหน้างานเป็นลำดับ: จดออเดอร์ → ตรวจของที่เบิก → คืนของที่เหลือ แสดงเป็นเส้นทางเดียวกัน (เมนูทั้งหมดอยู่ที่ lib/menus.ts) */
const SALES_FLOW = APP_MENUS.filter((m) => m.group === 'sales');
const WAREHOUSE = APP_MENUS.filter((m) => m.group === 'warehouse');
const SYSTEM = APP_MENUS.filter((m) => m.group === 'system');

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
  const system = SYSTEM.filter((t) => has(...t.perms));
  // ส่งออก Excel สรุปงานขาย: ตั้งต้นเฉพาะผู้ดูแลระบบ (reports.export) วางใต้การ์ดจัดการผู้ใช้
  const canExport = has('reports.export');
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
    <div className="grid items-start gap-8 pb-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-x-10">
      <MagicStage className="grid w-full gap-6 sm:py-8 lg:col-span-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="grid gap-1">
          <WandSparklesIcon className="mb-3 size-7 text-star" aria-hidden />
          <p className="font-heading text-2xl font-semibold text-balance sm:text-3xl">{greeting(now)} คุณ{user?.displayName}</p>
          <p className="mt-2 text-sm text-brand-foreground/80">{now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' })}</p>
          <p className="text-sm text-brand-foreground/75">ขอบเขตคลัง: {scope?.all ? 'ทุกคลัง' : scope?.codes.join(', ') || 'ยังไม่ได้รับสิทธิ์คลัง ติดต่อผู้ดูแลระบบ'}</p>
        </div>
        {(counts || returnsTotal !== null) && (
          <div className="flex flex-wrap gap-2 lg:max-w-xs lg:flex-col lg:items-stretch" aria-label="งานที่ต้องทำและประวัติ">
            {counts && (
              <Link to="/check" className={cn('inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-star/60', counts.PENDING ? 'bg-star text-on-star' : 'bg-on-sky/10 text-brand-foreground ring-1 ring-on-sky/15 hover:bg-on-sky/15')}>
                <ClipboardCheckIcon className="size-4" aria-hidden />
                {counts.PENDING ? <>รอตรวจของ <span className="tabular-nums">{num(counts.PENDING)}</span> ออเดอร์</> : counts.ALL ? 'ตรวจแล้วทุกออเดอร์' : 'ยังไม่มีออเดอร์ให้ตรวจ'}
              </Link>
            )}
            {counts && counts.MISMATCH > 0 && (
              <Link to="/check" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-rose-soft px-4 text-sm font-semibold text-rose outline-none focus-visible:ring-3 focus-visible:ring-star/60">
                ไม่ตรงออเดอร์ <span className="tabular-nums">{num(counts.MISMATCH)}</span> ออเดอร์
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
        <section className="grid gap-4" aria-labelledby="menu-sales">
          <div>
            <h2 id="menu-sales" className="font-heading text-xl font-semibold">งานขายหน้างาน</h2>
            <p className="text-sm text-muted-foreground">จดออเดอร์ ตรวจของที่เบิก แล้วคืนของที่เหลือ ตามลำดับ</p>
          </div>
          {/* ลำดับงานขายเรียงบนลงล่าง จอคอมมีงานคลังอยู่ข้างกัน */}
          {/* เส้นทางดาว: เส้นประทองลากผ่านกลางวงเวทของทุกขั้น บอกว่าสามงานนี้ต่อกันเป็นลำดับ */}
          <ol className="relative grid gap-3">
            {flow.length > 1 && <span aria-hidden className="pointer-events-none absolute top-14 bottom-14 left-[calc(1rem+2rem)] z-10 w-px bg-[repeating-linear-gradient(to_bottom,var(--pm-star)_0_4px,transparent_4px_9px)] opacity-70 sm:left-[calc(1.25rem+2rem)]" />}
            {flow.map((t) => (
              <li key={t.to} className="relative">
                <SpotlightCard className="group h-full transition-[border-color,box-shadow] duration-200 hover:border-star/60 hover:shadow-lift">
                  <Link to={t.to} className="relative flex h-full min-h-28 items-center gap-4 p-4 outline-none focus-visible:ring-3 focus-visible:ring-star/60 focus-visible:ring-inset sm:px-5">
                    <Medallion tone={t.tone} icon={t.icon} size="lg" className="relative z-20 rounded-full bg-card" />
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="font-heading text-lg font-semibold">{t.title}</span>
                      <span className="text-sm text-muted-foreground">{t.hint}</span>
                    </span>
                    <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground transition-[color,translate] duration-200 group-hover:translate-x-0.5 group-hover:text-star-ink motion-reduce:group-hover:translate-x-0 dark:group-hover:text-star" aria-hidden />
                    <Sparkle className="absolute top-3 right-3 size-3 text-star opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100" />
                  </Link>
                </SpotlightCard>
              </li>
            ))}
          </ol>
        </section>
      )}

      {warehouse.length > 0 && (
        <section className="grid gap-4" aria-labelledby="menu-warehouse">
          <div>
            <h2 id="menu-warehouse" className="font-heading text-xl font-semibold">งานคลัง</h2>
            <p className="text-sm text-muted-foreground">รับเข้า ย้ายที่เก็บ ดูยอด และป้ายชั้นวาง</p>
          </div>
          <ul className="grid divide-y divide-border">
            {warehouse.map((t) => (
              <li key={t.to}>
                <Link
                  to={t.to}
                  className="group flex min-h-20 items-center gap-3 rounded-lg px-2 py-4 outline-none transition-colors hover:bg-secondary focus-visible:ring-3 focus-visible:ring-primary/50"
                >
                  <Medallion tone={t.tone} icon={t.icon} />
                  <span className="grid min-w-0 flex-1">
                    <span className="font-semibold">{t.title}</span>
                    <span className="text-sm text-muted-foreground">{t.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(system.length > 0 || canExport) && (
        <section className="grid gap-3 border-t border-border pt-6 lg:col-span-2" aria-labelledby="menu-system">
          <h2 id="menu-system" className="font-heading text-xl font-semibold">ตั้งค่าระบบ</h2>
          {system.length > 0 && <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {system.map((t) => (
              <li key={t.to}>
                <Link
                  to={t.to}
                  className="group flex h-full min-h-20 items-center gap-3 rounded-xl border border-border bg-card p-3 outline-none transition-[border-color,background-color] hover:border-star/50 hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Medallion tone={t.tone} icon={t.icon} />
                  <span className="grid min-w-0 flex-1">
                    <span className="font-semibold">{t.title}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{t.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>}
          {canExport && <ExportExcel />}
        </section>
      )}

      {!flow.length && !warehouse.length && !system.length && !canExport &&<p className="rounded-xl bg-secondary p-4 text-sm">บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งานเมนูใด ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์</p>}
    </div>
  );
}
