import { CSSProperties, FormEvent, useEffect, useRef, useState } from 'react';
import { AlertCircleIcon, CheckIcon, PawPrintIcon, WandSparklesIcon } from 'lucide-react';
import { cn } from 'cn';
import { SESSION_HOURS } from '@petmore/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SpellFrame, Sparkle } from '@/components/magic';
import { usePrefersReducedMotion } from '@/lib/motion';
import { touchInput } from '@/lib/touch';
import { useAuth } from '../auth';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * รอยเว้าครึ่งวงกลมที่ปลายรอยปรุ: ตัวบัตรกับต้นขั้วมี mask ของตัวเองคนละครึ่ง พอต้นขั้วฉีกออก
 * ตัวบัตรที่เหลือยังมีรอยเว้าครึ่งวงกลมอยู่ที่ขอบ เหมือนบัตรจริงที่ฉีกตามรอยปรุ
 * ตำแหน่งวงกลมสองจุดมาจากตัวแปร --a / --b (มือถือ = ขอบล่าง/บน, จอคอม = ขอบขวา/ซ้าย) ตั้งด้วยคลาสของแต่ละช่อง
 */
const NOTCH = 14;
const notchMask: CSSProperties = {
  maskImage: `radial-gradient(circle ${NOTCH}px at var(--a), transparent 98%, #000), radial-gradient(circle ${NOTCH}px at var(--b), transparent 98%, #000)`,
  maskComposite: 'intersect',
  WebkitMaskComposite: 'source-in',
};

/** ชิ้นคำที่ห้ามตัดกลางคำ (ตัวตัดคำไทยของเบราว์เซอร์แยก "ถูก/ต้อง" ขึ้นบรรทัดใหม่ได้) */
const keepWords = (text: string) => text.replace(/ถูกต้อง/g, 'ถูก⁠ต้อง');

/**
 * หน้าเข้าสู่ระบบ "บัตรเข้างานแสดง": ฟอร์มคือบัตรพนักงานเข้าโชว์มายากล มีต้นขั้วฉีกได้
 * จอคอม: บัตรแนวนอน ตัวบัตร (ช่องกรอก) ซ้าย ต้นขั้ว (วันที่วันนี้ + ปุ่มทอง) ขวา
 * มือถือ: บัตรแนวตั้ง ต้นขั้วอยู่ล่าง ทั้งใบอยู่ในจอแรก
 * เข้าถูก: ต้นขั้วโดนประทับตรา "ตรวจแล้ว" แล้วฉีกหลุดออกจากบัตรตามรอยปรุก่อนเปิดแอป (ช่วงเวลาที่ขยับช่วงเดียวของหน้านี้)
 *   ตราเป็นหมึกสีมิ้นต์ (สีสำเร็จของแอป) เพราะหมึกทองบนต้นขั้วสีทองมองไม่เห็น ปิดการเคลื่อนไหว = ประทับอย่างเดียว ไม่ฉีก
 * ผิด: บัตรสั่นหนึ่งครั้ง ข้อความผิดพลาดอยู่บนบัตร เคอร์เซอร์กลับไปที่ช่องรหัสผ่านให้พิมพ์ใหม่ได้ทันที
 */
export function LoginPage() {
  const { login } = useAuth();
  const reduce = usePrefersReducedMotion();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'idle' | 'stamped' | 'torn'>('idle');
  const [fails, setFails] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const now = new Date();
  const date = (opts: Intl.DateTimeFormatOptions) => now.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', ...opts });

  // รหัสผิด: สั่นบัตรครั้งเดียว (ไม่ remount ฟอร์ม) แล้วคืนเคอร์เซอร์ให้ช่องรหัสผ่าน
  useEffect(() => {
    if (!fails) return;
    passwordRef.current?.focus();
    if (reduce) return;
    formRef.current?.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }],
      { duration: 350, easing: 'ease-in-out' },
    );
  }, [fails, reduce]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await login(username, password, async () => {
        // จังหวะตรวจบัตร: ประทับตรา แล้วฉีกต้นขั้ว
        setPhase('stamped');
        await wait(reduce ? 450 : 380);
        if (reduce) return;
        setPhase('torn');
        await wait(560);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPassword('');
      setPhase('idle');
      setBusy(false);
      setFails((n) => n + 1);
    }
  }

  return (
    // .login ให้พื้นท้องฟ้ายามค่ำกับดาวนิ่งชุดแรกจาก CSS
    <div className="login relative isolate overflow-hidden">
      <StageStars />
      <TheaterBackdrop />
      <div className="flex w-full max-w-sm flex-col items-center gap-3 sm:max-w-2xl">
        {/* โลโก้นิ่ง ให้การฉีกบัตรเป็นการเคลื่อนไหวเดียวที่ตั้งใจของหน้า (ท้องฟ้าด้านหลังขยับอยู่แล้ว) */}
        <h1 className="w-full max-w-56 sm:max-w-72">
          <img
            src="/brand/logo.png"
            alt="Petmore Magic Sale"
            width={720}
            height={555}
            className="h-auto w-full drop-shadow-[0_10px_18px_color-mix(in_oklab,var(--pm-shadow)_70%,transparent)]"
          />
        </h1>

        {/* เงาอยู่ที่กรอบนอก เพราะ mask ของแต่ละช่องจะตัดเงาของตัวเองทิ้ง */}
        <div className="w-full drop-shadow-[0_20px_28px_color-mix(in_oklab,black_45%,transparent)]">
          <form
            ref={formRef}
            onSubmit={submit}
            aria-labelledby="login-title"
            className="grid w-full grid-rows-[auto_auto] sm:grid-cols-[minmax(0,1fr)_14rem] sm:grid-rows-1"
          >
            {/* ตัวบัตร: รอยเว้าที่มุมล่างสองข้าง (มือถือ) / มุมขวาบน-ล่าง (จอคอม) */}
            <div
              className="relative isolate grid content-start gap-4 rounded-t-2xl bg-card p-6 text-card-foreground [--a:0%_100%] [--b:100%_100%] sm:rounded-l-2xl sm:rounded-tr-none sm:p-7 sm:[--a:100%_0%] sm:[--b:100%_100%]"
              style={notchMask}
            >
              {/* ลายเส้นสมุดคาถา: เส้นทองด้านในห่างขอบ 12px โค้งหลบรอยเว้า + ประกายสี่มุม */}
              <SpellFrame inset={3} />
              <div className="grid gap-1">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="login-title" className="flex items-center gap-2 font-heading text-2xl leading-tight font-semibold">
                    <Sparkle className="size-5 text-star-ink dark:text-star" />
                    เข้าสู่ระบบ
                  </h2>
                  <span className="shrink-0 rounded-full border border-star-ink/30 px-2.5 py-0.5 text-xs font-semibold text-star-ink dark:border-star/35 dark:text-star">บัตรพนักงาน</span>
                </div>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <PawPrintIcon className="size-4 shrink-0 text-kibble" aria-hidden="true" />
                  ระบบคลังสินค้าและงานขายหน้างาน
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="username">ชื่อผู้ใช้</Label>
                <Input id="username" className={touchInput} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="off" required readOnly={busy} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="password">รหัสผ่าน</Label>
                <Input
                  ref={passwordRef}
                  id="password"
                  className={touchInput}
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  readOnly={busy}
                />
              </div>
              {/* ทั้งแถวเป็นพื้นที่กด สูง 48px ช่องติ๊กธีมทองแบบหน้าจัดการผู้ใช้ */}
              <Label className="-my-1 min-h-12 cursor-pointer gap-3 font-normal text-muted-foreground">
                <span className="relative grid size-5 shrink-0 place-items-center">
                  <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)}
                    className="peer size-5 cursor-pointer appearance-none rounded-[6px] border-2 border-input bg-background transition-colors outline-none checked:border-star checked:bg-star focus-visible:ring-3 focus-visible:ring-ring/50" />
                  <CheckIcon aria-hidden className="pointer-events-none absolute hidden size-3.5 stroke-[3] text-on-star peer-checked:block" />
                </span>
                แสดงรหัสผ่าน
              </Label>
              {error && (
                <Alert variant="destructive" role="alert">
                  <AlertCircleIcon />
                  <AlertDescription>{keepWords(error)}</AlertDescription>
                </Alert>
              )}
            </div>

            {/* ต้นขั้ว (ทองฟอยล์): รอยปรุเส้นประด้านบน (มือถือ) / ด้านซ้าย (จอคอม) ฉีกหลุดออกเมื่อเข้าสำเร็จ */}
            <div
              className={cn(
                // ทองฟอยล์: สว่าง = ทอง 30% บนพื้นการ์ด, มืด = ทอง 65% บนคาราเมลเข้ม (ผสมกับม่วงแล้วออกน้ำตาลหม่น) ตัวหนังสือบนต้นขั้วมืดเป็นหมึกเข้ม on-star
                'relative isolate grid content-center gap-3 rounded-b-2xl bg-[color-mix(in_oklab,var(--pm-star)_30%,var(--pm-surface))] px-6 py-5 dark:bg-[color-mix(in_oklab,var(--pm-star)_65%,var(--pm-kibble-soft))] dark:text-on-star',
                '[--a:0%_0%] [--b:100%_0%] sm:rounded-r-2xl sm:rounded-bl-none sm:px-5 sm:py-7 sm:[--a:0%_0%] sm:[--b:0%_100%]',
                phase === 'torn' && 'origin-top-left animate-[ticket-tear-down_0.55s_cubic-bezier(0.5,0,0.75,0)_forwards] sm:animate-[ticket-tear_0.55s_cubic-bezier(0.5,0,0.75,0)_forwards]',
              )}
              style={notchMask}
            >
              <SpellFrame inset={3} className="dark:border-on-star/35 dark:text-on-star/60" />
              {/* รอยปรุ: จุดประระหว่างรอยเว้าทั้งสองข้าง (มือถือแนวนอนด้านบน, จอคอมแนวตั้งด้านซ้าย) */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-5 top-0 h-0.5 bg-[repeating-linear-gradient(to_right,currentColor_0_6px,transparent_6px_11px)] text-star-ink/55 sm:inset-x-auto sm:inset-y-5 sm:left-0 sm:h-auto sm:w-0.5 sm:bg-[repeating-linear-gradient(to_bottom,currentColor_0_6px,transparent_6px_11px)] dark:text-on-star/55"
              />
              <div className="flex items-end gap-3 sm:grid sm:justify-items-center sm:gap-0 sm:text-center" role="img" aria-label={`วันนี้ ${date({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}>
                <span aria-hidden className="font-heading text-5xl leading-none font-semibold text-star-ink tabular-nums sm:text-6xl dark:text-on-star">{date({ day: 'numeric' })}</span>
                <span aria-hidden className="grid pb-0.5 text-sm leading-tight sm:pt-1">
                  <span className="font-semibold">{date({ month: 'long', year: 'numeric' })}</span>
                  <span className="text-kibble-ink dark:text-on-star/85">{date({ weekday: 'long' })}</span>
                </span>
              </div>
              <Button type="submit" size="touch" className="w-full bg-star text-on-star hover:bg-star/90 dark:bg-on-star dark:text-star dark:hover:bg-on-star/90" disabled={busy}>
                <WandSparklesIcon />
                {busy ? 'กำลังตรวจบัตร…' : 'เข้าสู่ระบบ'}
              </Button>
              <p className="text-center text-xs text-kibble-ink dark:text-on-star/85">บัตรใช้ได้ {SESSION_HOURS} ชั่วโมง</p>

              {/* ตราประทับหมึก "ตรวจแล้ว": วงสองเส้น ไม่มีพื้น เอียงเหมือนตรายาง */}
              {phase !== 'idle' && (
                <span role="status" className="pointer-events-none absolute inset-0 grid place-items-center">
                  <span className="flex animate-[stamp-in_0.3s_cubic-bezier(0.16,1,0.3,1)_both] items-center gap-1.5 rounded-md border-[5px] border-double border-mint px-3 py-1 font-heading text-2xl font-semibold text-mint dark:border-[color-mix(in_oklab,var(--pm-mint)_40%,black)] dark:text-[color-mix(in_oklab,var(--pm-mint)_40%,black)]">
                    <Sparkle className="size-5" />ตรวจแล้ว
                  </span>
                </span>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/**
 * ดาวฉากหลังเวที: ดาวนิ่งวางตำแหน่งตายตัว (ไม่สุ่มทุกครั้งที่เปิด) ระยิบเบาๆ แค่บางดวง และดาวตกพาดผ่านนานๆ ครั้ง
 * วาดด้วย CSS ล้วน ไม่ใช้ WebGL จึงเบาเครื่องบนมือถือ ปิดการเคลื่อนไหว = ดาวนิ่งทั้งหมด ไม่มีดาวตก
 */
const STARS = Array.from({ length: 46 }, (_, i) => {
  // ลำดับ Halton (ฐาน 2 และ 3) กระจายดาวทั่วฉากแบบไม่เป็นแถว และได้ตำแหน่งเดิมทุกครั้ง
  const halton = (n: number, b: number) => { let f = 1, r = 0; while (n > 0) { f /= b; r += f * (n % b); n = Math.floor(n / b); } return r; };
  return { x: halton(i + 1, 2) * 100, y: halton(i + 1, 3) * 82, size: i % 7 === 0 ? 2.5 : i % 3 === 0 ? 2 : 1.25, gold: i % 5 === 0, twinkle: i % 4 === 0, delay: (i * 0.73) % 5 };
});

function StageStars() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-30">
      {STARS.map((s, i) => (
        <span
          key={i}
          className={cn('absolute rounded-full', s.gold ? 'bg-star' : 'bg-on-sky/80', s.twinkle && 'animate-[twinkle_4.5s_ease-in-out_infinite]')}
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s` }}
        />
      ))}
      {/* ดาวตกสองดวงคนละจังหวะ วิ่งทแยงลงซ้ายผ่านช่องท้องฟ้าว่าง (ไม่ผ่านหลังโลโก้) หัวสว่าง หางทองจางลง */}
      {[
        { pos: 'top-[7%] left-[84%]', anim: 'animate-[shooting-star_9s_cubic-bezier(0.3,0,0.7,1)_infinite]', delay: '1.5s' },
        { pos: 'top-[4%] left-[40%]', anim: 'animate-[shooting-star_14s_cubic-bezier(0.3,0,0.7,1)_infinite]', delay: '7s' },
      ].map((m) => (
        <span key={m.pos} className={cn('absolute flex h-0.5 w-44 items-center opacity-0 [rotate:-28deg] [transform-origin:left_center]', m.pos, m.anim)} style={{ animationDelay: m.delay }}>
          <span className="size-1.5 shrink-0 rounded-full bg-on-sky shadow-[0_0_6px_1px_var(--pm-star)]" />
          <span className="h-full flex-1 bg-[linear-gradient(to_right,var(--pm-star),transparent)]" />
        </span>
      ))}
    </div>
  );
}

/**
 * ฉากโรงละครก่อนม่านเปิด (พื้นหลังหน้าเข้าสู่ระบบเท่านั้น): วาดแบนแบบโปสเตอร์ ไม่เลียนแบบผิวผ้าหรือลายไม้ และนิ่ง ไม่ขยับ
 * ท้องฟ้าดาว (StageStars) เป็นฉากหลังเวทีที่เห็นผ่านกลางม่าน, ระบายม่านด้านบนขอบหยักพร้อมพู่ทอง,
 * ม่านข้างเป็นรูปทรง SVG สีกำมะหยี่แบนสองโทน รวบเข้าเอวด้วยเชือกทอง (จอแคบไม่แสดงเชือก ไม่ให้โผล่ข้างบัตร),
 * สปอตไลต์ขอบนุ่ม (mask) ส่องลงที่บัตร, พื้นเวทีแบนสีคาราเมล (เม็ดอาหาร) ขอบทองกับจุดไฟหน้าเวที
 */
const FOLD = 'color-mix(in oklab, var(--pm-velvet) 70%, black)';

function Curtain({ side }: { side: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 1000"
      preserveAspectRatio="none"
      className={cn('pointer-events-none absolute inset-y-0 -z-10 h-full w-[14vw] min-w-12 max-w-60', side === 'left' ? 'left-0' : 'right-0 -scale-x-100')}
    >
      {/* ผืนม่านรวบเข้าเอวที่ 58% แล้วบานออกถึงพื้น */}
      <path d="M0 0H100C92 300 60 470 34 580C58 700 84 860 96 1000H0Z" fill="var(--pm-velvet)" />
      {/* รอยพับแบน (โทนเข้มโทนเดียว) ไล่ตามรูปม่าน */}
      <path d="M22 0C24 260 18 470 14 580C20 720 30 870 36 1000H28C22 870 12 720 8 580C10 470 14 260 12 0Z" fill={FOLD} />
      <path d="M58 0C58 280 44 470 28 580C48 700 64 860 72 1000H64C56 860 40 700 22 580C36 470 50 280 50 0Z" fill={FOLD} />
    </svg>
  );
}

/** เชือกทองรวบม่าน วาดเป็นปมสองเส้นพันรอบเอวม่าน แสดงเฉพาะจอกว้าง */
function TieBack({ side }: { side: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 60 40"
      className={cn('pointer-events-none absolute top-[55%] -z-10 hidden w-[6vw] max-w-24 sm:block', side === 'left' ? 'left-[1vw]' : 'right-[1vw] -scale-x-100')}
    >
      <path d="M2 14C18 6 38 6 56 16M2 24C18 32 38 32 56 22" fill="none" stroke="var(--pm-star)" strokeWidth={5} strokeLinecap="round" />
      <circle cx="56" cy="19" r="6" fill="var(--pm-star)" />
      <path d="M54 25L50 38M58 25L60 38" stroke="var(--pm-star)" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

function TheaterBackdrop() {
  return (
    <>
      {/* สปอตไลต์จากด้านบน: สีแสงเวทีจางๆ ขอบนุ่มด้วย mask ไม่ใช่รูปทรงขอบแข็ง */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          backgroundColor: 'color-mix(in oklab, var(--pm-stage-light) 20%, transparent)',
          maskImage: 'radial-gradient(ellipse 34% 95% at 50% 0, #000 30%, transparent 100%)',
        }}
      />
      {/* พื้นเวทีแบน + ขอบทอง + จุดไฟหน้าเวที */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-20 h-[12vh] min-h-16 border-t-[3px] border-star bg-[color-mix(in_oklab,var(--pm-kibble)_32%,var(--pm-brand))]"
      >
        <span
          className="absolute inset-x-[16vw] top-2 h-2"
          style={{ backgroundImage: 'radial-gradient(circle at 50% 50%, var(--pm-star) 3px, transparent 3.5px)', backgroundSize: '44px 100%' }}
        />
      </div>
      <Curtain side="left" />
      <Curtain side="right" />
      <TieBack side="left" />
      <TieBack side="right" />
      {/* ระบายม่านด้านบน: ผืนแบนขอบล่างหยักเป็นลอน + พู่ทอง */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10">
        <div
          className="h-14 bg-[var(--pm-velvet)] sm:h-16"
          style={{
            maskImage: 'radial-gradient(circle 34px at 34px 0, #000 98%, transparent), linear-gradient(#000, #000)',
            maskSize: '68px 100%, 100% calc(100% - 14px)',
            maskRepeat: 'repeat-x, no-repeat',
            maskPosition: '0 14px, 0 0',
          }}
        />
        <div className="-mt-3 h-1.5 bg-[repeating-linear-gradient(90deg,var(--pm-star)_0_2px,transparent_2px_6px)]" />
      </div>
    </>
  );
}
