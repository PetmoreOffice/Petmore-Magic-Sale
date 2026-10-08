import { forwardRef, lazy, Suspense, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { CameraIcon, LoaderCircleIcon, SparklesIcon, WandSparklesIcon } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ไลบรารีอ่านบาร์โค้ดใหญ่ ~500 KB โหลดเฉพาะตอนกดปุ่มกล้อง Handheld ไม่ต้องโหลด
const CameraScanner = lazy(() => import('./CameraScanner').then((m) => ({ default: m.CameraScanner })));

/** ผลการสแกนที่หน้าเว็บส่งกลับมา: ok=true เวทีสว่างทอง (และแสดง text ถ้ามี), ok=false เวทีสั่นสีแดง */
export type ScanFeedback = { ok: boolean; text?: string };

interface Props {
  label: string;
  placeholder?: string;
  onScan: (code: string) => ScanFeedback | void | Promise<ScanFeedback | void>;
  autoFocus?: boolean;
  disabled?: boolean;
  /** ข้อความใต้ช่องตอนยังไม่ได้สแกน */
  hint?: string;
}

export interface ScanInputHandle {
  focus: () => void;
}

type Flash = { kind: 'ok' | 'error'; key: number } | null;

/**
 * เวทีสแกน (Scan stage) ใช้ได้ทุกอุปกรณ์
 * - Handheld / เครื่องสแกน USB: ทำงานแบบคีย์บอร์ด พิมพ์รหัสแล้วส่ง Enter (ตั้ง suffix = Enter ที่ตัวเครื่อง)
 * - มือถือ: กดปุ่มกล้องเพื่ออ่านบาร์โค้ด/QR
 * - คอม: พิมพ์รหัสเองแล้วกด Enter ได้
 * พื้นหลังเป็นท้องฟ้ายามค่ำทั้งโหมดสว่างและมืด เส้นเลเซอร์ทองวิ่งเมื่อพร้อมสแกน
 * สถานะ "แตะเพื่อสแกน" บอกว่าเคอร์เซอร์หลุด ซึ่งบน Handheld แปลว่าสแกนบาร์โค้ดแล้วจะไม่เข้า
 */
export const ScanInput = forwardRef<ScanInputHandle, Props>(function ScanInput(
  { label, placeholder, onScan, autoFocus, disabled, hint = 'สแกนบาร์โค้ดได้เลย หรือกดปุ่มกล้อง' },
  ref,
) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [camera, setCamera] = useState(false);
  const [working, setWorking] = useState(false);
  const [focused, setFocused] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [last, setLast] = useState('');

  /** โฟกัสช่องสแกน แล้วอ่านสถานะจริงจากหน้าเว็บ (บางเครื่องไม่ส่ง focus event ถ้าหน้าต่างยังไม่ active) */
  function focusInput(options?: FocusOptions) {
    const input = inputRef.current;
    if (!input) return;
    input.focus(options);
    setFocused(document.activeElement === input);
  }

  useImperativeHandle(ref, () => ({ focus: () => focusInput() }), []);

  async function submit(raw: string) {
    const code = raw.trim();
    if (!code || working) return;
    setValue('');
    setWorking(true);
    try {
      const result = await onScan(code);
      if (result) {
        setFlash({ kind: result.ok ? 'ok' : 'error', key: Date.now() });
        if (result.ok && result.text) setLast(result.text);
      }
    } finally {
      setWorking(false);
    }
  }

  // คืนเคอร์เซอร์ให้ช่องสแกนหลังทำงานเสร็จ เพื่อให้ Handheld สแกนชิ้นถัดไปได้ทันที
  // autoFocus ไม่ทำงานกับช่องที่ปิดอยู่ตอนเปิดหน้า (เช่นรอโหลดข้อมูล) จึงโฟกัสเองเมื่อช่องเปิดใช้งาน
  useEffect(() => {
    if (autoFocus && !disabled) focusInput({ preventScroll: true });
  }, [autoFocus, disabled]);

  const wasWorking = useRef(false);
  useEffect(() => {
    if (wasWorking.current && !working && !camera) focusInput({ preventScroll: true });
    wasWorking.current = working;
  }, [working, camera]);

  const ready = focused && !working && !disabled;

  // สลับชื่อแอนิเมชันสองชื่อ เพื่อให้สั่นซ้ำได้ทุกครั้งที่ผิด โดยไม่ต้อง remount (ช่องสแกนจะไม่เสียเคอร์เซอร์)
  const shake = flash?.kind === 'error' ? (flash.key % 2 ? 'animate-[scan-shake-a_0.35s_ease-in-out]' : 'animate-[scan-shake-b_0.35s_ease-in-out]') : '';

  return (
    <>
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-2xl bg-brand p-4 text-brand-foreground ring-1 ring-on-sky/10 transition-opacity',
        shake,
        disabled && 'opacity-60',
      )}
      // แตะตรงไหนของเวทีก็ได้ เพื่อเอาเคอร์เซอร์กลับมาที่ช่องสแกน
      onClick={(e) => {
        if (!disabled && e.target === e.currentTarget) focusInput();
      }}
    >
      <div className="scan-stage-stars" aria-hidden="true" />
      {flash && (
        <span
          key={flash.key}
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 -z-0 animate-[scan-flash_0.7s_ease-out_forwards]',
            flash.kind === 'ok' ? 'bg-star/25' : 'bg-destructive/30',
          )}
        />
      )}

      {/* grid-cols-1 = minmax(0,1fr): ข้อความ "สแกนล่าสุด" ยาวๆ ห้ามดันช่องสแกนจนปุ่มกล้องตกขอบจอ */}
      <div className="relative grid grid-cols-1 gap-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={id} className="min-w-0 text-sm font-semibold text-brand-foreground">
            <WandSparklesIcon className="size-4 shrink-0 text-star" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </Label>
          {!disabled && (
            <span className="shrink-0" aria-live="polite">
              {working ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-on-sky/10 px-2.5 py-1 text-xs font-semibold">
                  <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden="true" />
                  กำลังค้นหา
                </span>
              ) : ready ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-on-sky/10 px-2.5 py-1 text-xs font-semibold">
                  <span className="relative flex size-2" aria-hidden="true">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-mint opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-mint" />
                  </span>
                  พร้อมสแกน
                </span>
              ) : (
                <button
                  type="button"
                  data-slot="scan-refocus"
                  onClick={() => focusInput()}
                  className="inline-flex min-h-12 items-center gap-1.5 rounded-full border border-star/70 px-3 text-xs font-semibold text-star outline-none focus-visible:ring-3 focus-visible:ring-star/50"
                >
                  แตะเพื่อสแกน
                </button>
              )}
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Input
              className="h-14 border-on-sky/20 bg-on-sky/10 px-4 text-xl tracking-wide text-on-sky placeholder:text-on-sky/55 focus-visible:border-star focus-visible:ring-star/40 disabled:bg-on-sky/5 md:text-xl dark:bg-on-sky/10"
              id={id}
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit(value);
                }
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={placeholder ?? 'สแกน หรือพิมพ์รหัส'}
              autoFocus={autoFocus}
              disabled={disabled}
              readOnly={working}
              aria-busy={working}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
            />
            {/* เส้นเลเซอร์ทองวิ่งผ่านช่อง เมื่อพร้อมรับการสแกน */}
            {ready && <span className="scan-laser" aria-hidden="true" />}
          </div>
          <Button
            type="button"
            size="icon-touch"
            className="size-14 bg-star text-brand hover:bg-star/90"
            onClick={() => setCamera(true)}
            disabled={disabled || working}
            aria-label={`${label} ด้วยกล้อง`}
            title="สแกนด้วยกล้อง"
          >
            <CameraIcon className="size-6" />
          </Button>
        </div>

        <p className="flex min-h-5 items-center gap-1.5 text-sm text-on-sky/70" aria-live="polite">
          {last ? (
            <>
              <SparklesIcon className="size-4 shrink-0 text-star" aria-hidden="true" />
              <span className="truncate">
                สแกนล่าสุด <strong className="font-semibold text-on-sky">{last}</strong>
              </span>
            </>
          ) : (
            hint
          )}
        </p>
      </div>
    </div>

      {camera && (
        <Suspense fallback={<div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4 text-white">กำลังเปิดกล้อง…</div>}>
          <CameraScanner
            onResult={(code) => {
              setCamera(false);
              void submit(code);
            }}
            onClose={() => {
              setCamera(false);
              focusInput();
            }}
          />
        </Suspense>
      )}
    </>
  );
});
