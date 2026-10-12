import { ChevronRightIcon, ClipboardCheckIcon, MapPinIcon, PackageIcon, SparklesIcon, WandSparklesIcon } from 'lucide-react';
import { CheckBadge, PickTile, StatusBadge } from '@/components/wms';
import { ScanInput } from '@/components/ScanInput';
import { LocationLabel } from '@/components/LocationLabel';
import { MagicStage, Medallion, Seal, SlotSparkles, Sparkle, SPELL_SLOT, ToneChip } from '@/components/magic';
import SpotlightCard from '@/components/SpotlightCard';
import { APP_MENUS } from '@/lib/menus';

/**
 * หน้าดูป้ายทั้งหมด (เปิดได้เฉพาะตอนพัฒนา /dev/labels ไม่ต้องเข้าสู่ระบบ ไม่ถูก build ลงเว็บจริง)
 * ใช้ตรวจหน้าตาป้ายเวทมนตร์ทุกแบบในที่เดียว ข้อมูลเป็นตัวอย่าง
 */
export default function DevLabelsPage() {
  const sales = APP_MENUS.filter((m) => m.group === 'sales');
  const warehouse = APP_MENUS.filter((m) => m.group === 'warehouse');
  return (
    <main className="mx-auto grid max-w-6xl gap-10 px-4 py-8">
      <MagicStage className="grid w-full gap-6 sm:py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="grid gap-1">
          <WandSparklesIcon className="mb-3 size-7 text-star" aria-hidden />
          <h1 className="font-heading text-2xl font-semibold text-balance sm:text-3xl">อรุณสวัสดิ์ คุณผู้ดูแลระบบ</h1>
          <p className="mt-2 text-sm text-brand-foreground/80">วันจันทร์ที่ 12 ตุลาคม 2569</p>
          <p className="text-sm text-brand-foreground/75">ขอบเขตคลัง: ทุกคลัง</p>
        </div>
        <div className="flex flex-wrap gap-2 lg:max-w-xs lg:flex-col lg:items-stretch">
          <span className="inline-flex min-h-12 items-center gap-2 rounded-full bg-star px-4 text-sm font-semibold text-on-star"><ClipboardCheckIcon className="size-4" aria-hidden />รอตรวจของ 3 ออเดอร์</span>
        </div>
      </MagicStage>

      <section className="grid max-w-3xl gap-4">
        <h2 className="font-heading text-xl font-semibold">กล่องสแกน</h2>
        <ScanInput label="สแกนสินค้าหรือป้าย Location" placeholder="สแกนบาร์โค้ด หรือพิมพ์ชื่อสินค้าแล้วกด Enter" onScan={() => ({ ok: true, text: 'ตัวอย่าง' })} />
        <ScanInput label="สแกน Location ปลายทาง" placeholder="สแกน หรือพิมพ์รหัส" onScan={() => undefined} disabled hint="เลือกต้นทางก่อน แล้วสแกนปลายทาง" />
      </section>

      <section className="grid max-w-3xl gap-4">
        <h2 className="font-heading text-xl font-semibold">กล่องรอสแกน / ยังไม่มีข้อมูล</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <PickTile icon={<PackageIcon className="size-5" />} label="สินค้า" />
          <PickTile icon={<MapPinIcon className="size-5" />} label="Location" value="A-01-02" detail="โซน A · ชั้นอาหารแมว" />
        </div>
        <div className={`${SPELL_SLOT} grid justify-items-center gap-2 px-4 py-10 text-center`}>
          <SlotSparkles />
          <SparklesIcon className="size-8 text-star-ink dark:text-star" aria-hidden />
          <p className="text-muted-foreground">ยังไม่มีออเดอร์ให้ตรวจ</p>
        </div>
      </section>

      <section className="grid gap-4">
        <h2 className="font-heading text-xl font-semibold">ตราสถานะ (Seal)</h2>
        <div className="flex flex-wrap gap-3">
          <CheckBadge check={null} />
          <CheckBadge check={{ status: 'MATCH' }} />
          <CheckBadge check={{ status: 'PARTIAL' }} />
          <CheckBadge check={{ status: 'MISMATCH' }} />
          <StatusBadge status="FG" />
          <StatusBadge status="DM" />
          <Seal tone="rose" state="broken">ปิดใช้งาน</Seal>
          <Seal tone="muted" state="outline">ยังไม่กรอก 2 ช่อง</Seal>
        </div>
        <div className="flex flex-wrap gap-2">
          <ToneChip tone="star">ผู้ดูแลระบบ</ToneChip>
          <ToneChip tone="mint">แอดมิน</ToneChip>
          <ToneChip tone="kibble">ผู้เบิกสินค้า</ToneChip>
          <ToneChip tone="plum">อาหารแมว</ToneChip>
          <ToneChip tone="sky">ขนม</ToneChip>
        </div>
      </section>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-x-10">
        <section className="grid gap-4">
          <h2 className="font-heading text-xl font-semibold">งานขายหน้างาน</h2>
          <ol className="relative grid gap-3">
            <span aria-hidden className="pointer-events-none absolute top-14 bottom-14 left-[calc(1rem+2rem)] z-10 w-px bg-[repeating-linear-gradient(to_bottom,var(--pm-star)_0_4px,transparent_4px_9px)] opacity-70 sm:left-[calc(1.25rem+2rem)]" />
            {sales.map((t) => (
              <li key={t.to} className="relative">
                <SpotlightCard className="group h-full transition-[border-color,box-shadow] duration-200 hover:border-star/60 hover:shadow-lift">
                  <a href="#" className="relative flex h-full min-h-28 items-center gap-4 p-4 outline-none focus-visible:ring-3 focus-visible:ring-star/60 focus-visible:ring-inset sm:px-5">
                    <Medallion tone={t.tone} icon={t.icon} size="lg" className="relative z-20 rounded-full bg-card" />
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="font-heading text-lg font-semibold">{t.title}</span>
                      <span className="text-sm text-muted-foreground">{t.hint}</span>
                    </span>
                    <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                    <Sparkle className="absolute top-3 right-3 size-3 text-star opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  </a>
                </SpotlightCard>
              </li>
            ))}
          </ol>
        </section>
        <section className="grid gap-4">
          <h2 className="font-heading text-xl font-semibold">งานคลัง</h2>
          <ul className="grid divide-y divide-border">
            {warehouse.map((t) => (
              <li key={t.to} className="flex min-h-20 items-center gap-3 px-2 py-4">
                <Medallion tone={t.tone} icon={t.icon} />
                <span className="grid min-w-0 flex-1"><span className="font-semibold">{t.title}</span><span className="text-sm text-muted-foreground">{t.hint}</span></span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="grid max-w-3xl gap-4">
        <h2 className="font-heading text-xl font-semibold">ป้าย Location (พิมพ์)</h2>
        <LocationLabel
          location={{ id: 'cmloc0000000000demo0001', warehouse: 'WH1', zoneId: 'z', code: '01-02', displayCode: 'A-01-02', name: 'ชั้นอาหารแมว', active: true, revision: 0 }}
          zoneName="โซน A"
          batch={{ id: 'batch000000demo', actor: 'ผู้ดูแลระบบ', time: '2026-10-12T03:00:00.000Z' }}
        />
      </section>
    </main>
  );
}
