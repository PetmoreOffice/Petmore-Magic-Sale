import { CSSProperties, FormEvent, ReactNode, SyntheticEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckIcon, ChevronDownIcon, ChevronRightIcon, HistoryIcon, KeyRoundIcon, LoaderCircleIcon, MinusIcon, RotateCcwIcon, SaveIcon,
  SearchIcon, UserPlusIcon, WarehouseIcon, XIcon,
} from 'lucide-react';
import { cn } from 'cn';
import {
  ManagedUser, Permission, PERMISSIONS, ROLE_DEFAULTS, ROLE_DESCRIPTIONS, RoleCode, ROLES,
  searchKey, UserAuditEntry, UserInput, Warehouse,
} from '@petmore/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { MagicStage, monogram, Seal, Sparkle, ToneChip, TONES, type Tone } from '@/components/magic';
import { SparkBurst, SparkBurstHandle } from '@/components/SparkBurst';
import StarBorder from '@/components/StarBorder';
import { Field, Message, Notice } from '@/components/wms';
import { APP_MENUS, canOpen, OTHER_PERMISSION_GROUPS } from '@/lib/menus';
import { touchInput } from '@/lib/touch';
import { api, formatTime, newRequestId } from '../api';
import { useAuth } from '../auth';

const ROLE_CODES = Object.keys(ROLES) as RoleCode[];
/** สีประจำตำแหน่ง: ป้ายบนพื้นปกติใช้ TONES, จุดดาวบนท้องฟ้าใช้สีที่อ่านได้บนพื้นมืด */
const ROLE_TONE: Record<RoleCode, Tone> = { ADMIN: 'star', CHECKER: 'mint', PICKER: 'kibble' };
const ROLE_SKY: Record<RoleCode, string> = { ADMIN: 'var(--pm-star)', CHECKER: 'var(--pm-on-sky-mint)', PICKER: 'var(--pm-on-sky-kibble)' };
const ROLE_INK: Record<RoleCode, string> = { ADMIN: 'text-star-ink', CHECKER: 'text-mint', PICKER: 'text-kibble-ink' };

type Status = 'ALL' | 'ACTIVE' | 'INACTIVE';
type Sort = 'name' | 'role';
type Draft = Omit<UserInput, 'requestId'> & { confirm: string };

function emptyDraft(): Draft {
  return {
    create: true, revision: 0, username: '', displayName: '', role: 'PICKER', active: true,
    password: '', confirm: '', warehouseScope: { all: false, codes: [] }, permissions: [...ROLE_DEFAULTS.PICKER],
  };
}

function draftOf(u: ManagedUser): Draft {
  return {
    create: false, revision: u.revision, username: u.username, displayName: u.displayName, role: u.roleCode, active: u.active,
    password: '', confirm: '', warehouseScope: { all: u.warehouseScope.all, codes: [...u.warehouseScope.codes] }, permissions: [...u.permissions],
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const scopeText = (u: Pick<ManagedUser, 'warehouseScope'>) =>
  u.warehouseScope.all ? 'ทุกคลัง' : u.warehouseScope.codes.length ? `คลัง ${u.warehouseScope.codes.join(', ')}` : 'ยังไม่มีคลัง';

/**
 * แถบเมนูในหัวแผงแก้ไข: ป้ายมีชื่อทุกเมนู ทอง = เปิดได้ เส้นประจาง = เปิดไม่ได้ เปลี่ยนสิทธิ์แล้วติด/ดับทันที
 * โปรแกรมอ่านหน้าจออ่านเป็นประโยคเดียว ("เปิดได้ 3 จาก 8 เมนู: ...")
 */
function MenuStrip({ permissions, onSky, className }: { permissions: readonly Permission[]; onSky?: boolean; className?: string }) {
  const open = APP_MENUS.filter((m) => canOpen(m, permissions));
  return (
    <span
      role="img"
      aria-label={open.length ? `เปิดได้ ${open.length} จาก ${APP_MENUS.length} เมนู: ${open.map((m) => m.short).join(', ')}` : 'ยังเปิดเมนูใดไม่ได้'}
      className={cn('flex flex-wrap gap-1.5', className)}
    >
      {APP_MENUS.map((m) => {
        const on = canOpen(m, permissions);
        return (
          <span
            key={m.to}
            title={`${m.title}${on ? '' : ' (เปิดไม่ได้)'}`}
            className={cn(
              // ป้ายมีชื่อแบบเดียวกับบัตรพนักงาน: เปิดได้ = ทองบนพื้นทองอ่อน, เปิดไม่ได้ = กรอบเส้นประจาง อ่านออกเป็นรูปทรง ไม่ใช่แค่สี
              'inline-flex h-7 items-center gap-1 rounded-full border pr-2.5 pl-2 text-xs font-medium transition-colors duration-300',
              on
                ? 'border-transparent bg-star-soft text-star-ink'
                : onSky ? 'border-dashed border-on-sky/30 text-on-sky/45' : 'border-dashed border-border text-muted-foreground/60',
            )}
          >
            <m.icon className="size-3.5" />{m.short}
          </span>
        );
      })}
    </span>
  );
}

/**
 * กลุ่มดาวประจำตำแหน่ง: ดาวหลักวางมือเป็นรูปทรงคงที่ เชื่อมด้วยเส้นบาง (ผู้ดูแลระบบ = มงกุฎ, แอดมิน = แว่นตรวจ, ผู้เบิกสินค้า = ถุงอาหาร)
 * หนึ่งดาวต่อหนึ่งคน: เติมรูปทรงตามลำดับ คนที่เกินรูปทรงเป็นดาวเล็กกระจายแบบมุมทอง (ไม่เรียงเป็นเส้นกราฟ) รวมไม่เกิน 40 ดวง
 */
const SHAPES: Record<RoleCode, [number, number][]> = {
  ADMIN: [[14, 30], [26, 12], [44, 24], [60, 8], [76, 24], [94, 12], [106, 30]],
  CHECKER: [[22, 26], [34, 12], [52, 10], [66, 22], [60, 36], [42, 38], [26, 34], [84, 40], [102, 46]],
  PICKER: [[20, 16], [40, 8], [60, 14], [80, 8], [100, 16], [96, 44], [60, 48], [24, 44]],
};

function Constellation({ role, count, color, dim }: { role: RoleCode; count: number; color: string; dim?: boolean }) {
  const shape = SHAPES[role];
  const lit = Math.min(count, shape.length);
  const extra = Math.min(Math.max(count - shape.length, 0), 40 - shape.length);
  const path = shape.slice(0, Math.max(lit, 1)).map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  return (
    <svg aria-hidden viewBox="0 0 120 54" className={cn('h-auto w-full max-w-36 transition-opacity', dim && 'opacity-45')}>
      {lit > 1 && <path d={path} fill="none" stroke={color} strokeOpacity={0.45} strokeWidth={0.8} />}
      {Array.from({ length: extra }, (_, i) => {
        const a = (i + 1) * 2.39996;
        const r = 6 + ((i * 7) % 20);
        return <circle key={`e${i}`} cx={60 + Math.cos(a) * r * 2.2} cy={27 + Math.sin(a) * r} r={0.9} fill={color} opacity={0.55} />;
      })}
      {shape.slice(0, lit).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 2.6 : 2} fill={color} />
      ))}
    </svg>
  );
}

/** ช่องติ๊กทั้งแถวกดได้ สูง 48px รองรับสถานะ "บางข้อ" (indeterminate) สำหรับติ๊กทั้งกลุ่ม */
function CheckRow({ checked, indeterminate, onChange, disabled, children, hint, className }: {
  checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: ReactNode; hint?: string; className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return (
    <Label className={cn('min-h-12 min-w-0 flex-1 cursor-pointer gap-3 rounded-lg px-2 font-normal hover:bg-secondary', disabled && 'cursor-not-allowed opacity-60 hover:bg-transparent', className)}>
      {/* ช่องติ๊กธีมทอง: เลือก = ทองทึบ ว่าง = กรอบสีช่องกรอก (ไม่ใช้สี่เหลี่ยมเทาของเบราว์เซอร์) */}
      <span className="relative grid size-5 shrink-0 place-items-center">
        <input ref={ref} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
          className="peer size-5 cursor-[inherit] appearance-none rounded-[6px] border-2 border-input bg-background transition-colors outline-none checked:border-star checked:bg-star indeterminate:border-star indeterminate:bg-star focus-visible:ring-3 focus-visible:ring-ring/50" />
        <CheckIcon aria-hidden className="pointer-events-none absolute hidden size-3.5 stroke-[3] text-on-star peer-checked:block peer-indeterminate:hidden" />
        <MinusIcon aria-hidden className="pointer-events-none absolute hidden size-3.5 stroke-[3] text-on-star peer-indeterminate:block" />
      </span>
      <span className="grid min-w-0 gap-0.5 py-1.5">
        <span>{children}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
    </Label>
  );
}

/**
 * จัดการผู้ใช้: ทะเบียนทีม แต่ละแถวมีแถบเมนูที่เปิดได้ บนสุดเป็นท้องฟ้าสรุปทีมเป็นกลุ่มดาวตามตำแหน่ง (แตะเพื่อกรอง)
 * แตะแถวเปิดแผงแก้ไขด้านขวา (มือถือเต็มจอ) บันทึกแล้วประกายทองบนท้องฟ้า
 */
export function UsersPage() {
  const { user: me, has } = useAuth();
  const canManage = has('users.manage');
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const [role, setRole] = useState<RoleCode | 'ALL'>('ALL');
  const [status, setStatus] = useState<Status>('ALL');
  const [sort, setSort] = useState<Sort>('role');
  const [term, setTerm] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const spark = useRef<SparkBurstHandle>(null);

  async function load() {
    try {
      setUsers(await api<ManagedUser[]>('/users'));
    } catch (e) {
      setMessage({ text: errorText(e), kind: 'error' });
    }
  }

  useEffect(() => {
    void load();
    if (canManage) api<Warehouse[]>('/warehouses').then((w) => setWarehouses(w.filter((x) => x.active))).catch(() => undefined);
  }, []);

  function open(next: Draft) {
    setMessage(null);
    setDraft(next);
  }

  const stats = useMemo(() => {
    const byRole: Record<RoleCode, number> = { ADMIN: 0, CHECKER: 0, PICKER: 0 };
    let inactive = 0;
    for (const u of users ?? []) {
      if (u.roleCode in byRole) byRole[u.roleCode]++;
      if (!u.active) inactive++;
    }
    return { byRole, inactive, total: users?.length ?? 0 };
  }, [users]);

  const shown = useMemo(() => {
    const q = searchKey(term);
    const order = (r: RoleCode) => ROLE_CODES.indexOf(r);
    return (users ?? [])
      .filter((u) =>
        (role === 'ALL' || u.roleCode === role) &&
        (status === 'ALL' || (status === 'ACTIVE') === u.active) &&
        (!q || searchKey(u.displayName).includes(q) || searchKey(u.username).includes(q)))
      .sort((a, b) =>
        (sort === 'role' ? order(a.roleCode) - order(b.roleCode) : 0) || a.displayName.localeCompare(b.displayName, 'th'));
  }, [users, role, status, sort, term]);

  const filtered = role !== 'ALL' || status !== 'ALL' || !!term;
  // เรียงตามตำแหน่ง: แบ่งบัตรเป็นกลุ่มต่อตำแหน่ง มีหัวกลุ่ม, ตามชื่อ: กลุ่มเดียวทั้งทีม
  const groups = useMemo(() => sort === 'role'
    ? ROLE_CODES.map((r) => ({ key: r, role: r as RoleCode | null, users: shown.filter((u) => u.roleCode === r) })).filter((g) => g.users.length)
    : shown.length ? [{ key: 'all', role: null as RoleCode | null, users: shown }] : [], [shown, sort]);

  return (
    <div className="grid gap-4">
      <MagicStage className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-center">
        {/* มือถือ: หัวกับปุ่มเพิ่มอยู่แถวเดียวกัน เวทีไม่สูงจนรายชื่อตกขอบจอ */}
        <div className="flex flex-wrap items-center justify-between gap-3 lg:grid lg:justify-items-start">
          {/* ประกายทองพุ่งรอบจำนวนทีมเมื่อบันทึกผู้ใช้สำเร็จ */}
          <div className="relative justify-self-start">
            <SparkBurst ref={spark} count={18} reach={26} />
            <h2 className="font-heading text-2xl font-semibold sm:text-3xl">
              ทีม <span className="tabular-nums">{users ? stats.total.toLocaleString('th-TH') : '…'}</span> คน
            </h2>
            <p className="text-sm text-brand-foreground/75">
              ใช้งานอยู่ <span className="tabular-nums">{stats.total - stats.inactive}</span>
              {stats.inactive > 0 && <> · ปิดใช้งาน <span className="tabular-nums">{stats.inactive}</span></>}
            </p>
          </div>
          {canManage && (
            <Button size="touch" className="bg-star text-on-star hover:bg-star/90" onClick={() => open(emptyDraft())}>
              <UserPlusIcon />เพิ่มผู้ใช้
            </Button>
          )}
        </div>

        {/* กลุ่มดาวตามตำแหน่ง = ปุ่มกรอง แตะซ้ำเพื่อเลิกกรอง ดาวของตำแหน่งที่ไม่ได้เลือกจางลง */}
        <div className="grid gap-2">
          <div role="group" aria-label="กรองตามตำแหน่ง" className="grid grid-cols-3 gap-2">
            {ROLE_CODES.map((r) => {
              const selected = role === r;
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setRole(selected ? 'ALL' : r)}
                  className={cn(
                    'grid min-h-12 content-start gap-1 rounded-xl px-2.5 py-2 text-left ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-star/60 sm:px-3',
                    selected ? 'bg-star/15 ring-star' : 'bg-on-sky/5 ring-on-sky/15 hover:bg-on-sky/10',
                  )}
                >
                  <span className="grid gap-0.5 sm:flex sm:items-baseline sm:justify-between sm:gap-2">
                    <span className="text-xs font-semibold sm:text-sm">{ROLES[r]}</span>
                    <span className="font-heading text-xl leading-none font-semibold tabular-nums sm:text-2xl">{stats.byRole[r]}</span>
                  </span>
                  <Constellation role={r} count={stats.byRole[r]} color={ROLE_SKY[r]} dim={role !== 'ALL' && !selected} />
                </button>
              );
            })}
          </div>
          {role !== 'ALL' && (
            <button type="button" onClick={() => setRole('ALL')}
              className="inline-flex min-h-12 items-center gap-1.5 justify-self-end rounded-full px-3 text-sm text-brand-foreground/85 outline-none hover:bg-on-sky/10 focus-visible:ring-3 focus-visible:ring-star/60">
              <XIcon className="size-4" aria-hidden />ดูทุกตำแหน่ง
            </button>
          )}
        </div>
      </MagicStage>

      <Notice message={message} />

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:gap-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className={cn(touchInput, 'pl-9')} type="search" aria-label="ค้นหาผู้ใช้" placeholder="ค้นชื่อ หรือชื่อผู้ใช้" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:contents">
          <NativeSelect size="touch" aria-label="สถานะบัญชี" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <NativeSelectOption value="ALL">ทุกสถานะ</NativeSelectOption>
            <NativeSelectOption value="ACTIVE">ใช้งานอยู่</NativeSelectOption>
            <NativeSelectOption value="INACTIVE">ปิดใช้งาน</NativeSelectOption>
          </NativeSelect>
          {/* เรียงตามตำแหน่ง = แบ่งกลุ่มบัตรตามตำแหน่ง, ตามชื่อ = เรียง ก-ฮ ต่อกันทั้งทีม */}
          <div role="radiogroup" aria-label="เรียงบัตร" className="inline-flex h-12 items-center rounded-lg border border-input p-1">
            {([['role', 'ตำแหน่ง'], ['name', 'ชื่อ']] as const).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={sort === k} onClick={() => setSort(k)}
                className={cn('h-full rounded-md px-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  sort === k ? 'bg-star-soft font-semibold text-star-ink' : 'text-muted-foreground hover:text-foreground')}>
                ตาม{label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section aria-label="บัตรพนักงาน" aria-busy={!users} className="grid gap-7">
        {!users && !message && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />กำลังโหลดผู้ใช้…
          </p>
        )}
        {users && !shown.length && (
          <div className="grid justify-items-start gap-3 rounded-2xl border border-dashed border-card-edge p-5">
            <p className="text-sm text-muted-foreground">{filtered ? 'ไม่พบผู้ใช้ที่ตรงกับตัวกรอง' : 'ยังไม่มีผู้ใช้'}</p>
            {filtered && <Button variant="outline" size="touch" onClick={() => { setRole('ALL'); setStatus('ALL'); setTerm(''); }}>ล้างตัวกรอง</Button>}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.key} className="grid gap-3">
            {g.role && (
              <h3 className="flex items-center gap-2 font-heading text-lg font-semibold">
                <Sparkle className={cn('size-4', ROLE_INK[g.role])} />{ROLES[g.role]}
                <span className="text-sm font-normal text-muted-foreground tabular-nums">{g.users.length} คน</span>
              </h3>
            )}
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {g.users.map((u) => (
                <li key={u.id} className="min-w-0">
                  <StaffCard user={u} isSelf={u.username === me?.username} grouped={!!g.role} onEdit={canManage ? () => open(draftOf(u)) : undefined} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {has('users.audit') && <AuditHistory />}

      <Sheet open={!!draft} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        {/* เปิดแผงแล้วโฟกัสที่แผง ไม่กระโดดเข้าช่องกรอก (มือถือจะเด้งแป้นพิมพ์บังทั้งแผง) */}
        <SheetContent className="gap-0 p-0" closeLabel="ปิดแผงแก้ไข"
          closeClassName="text-brand-foreground/80 hover:bg-on-sky/10 hover:text-brand-foreground"
          onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).focus(); }}>
          {draft && (
            <UserEditor
              key={draft.create ? 'new' : draft.username}
              initial={draft}
              isSelf={!draft.create && draft.username === me?.username}
              warehouses={warehouses}
              onCancel={() => setDraft(null)}
              onSaved={(saved) => {
                const created = draft.create;
                setDraft(null);
                setMessage({ kind: 'info', text: `${created ? 'เพิ่ม' : 'บันทึก'}ผู้ใช้ ${saved.displayName} (${saved.username}) แล้ว` });
                void load();
                // ประกายทองบนท้องฟ้าเมื่อบันทึกสำเร็จ (หลังแผงปิด)
                setTimeout(() => spark.current?.burst(), 250);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** รอยเว้าครึ่งวงกลมที่ปลายรอยปรุของบัตร: ตัวบัตร (บน) กับต้นขั้ว (ล่าง) มี mask ของตัวเองคนละครึ่ง แบบเดียวกับบัตรหน้าเข้าสู่ระบบ */
const NOTCH = 11;
const notchAt = (y: '0' | '100%'): CSSProperties => {
  const mask = `radial-gradient(circle ${NOTCH}px at 0 ${y}, transparent 98%, #000), radial-gradient(circle ${NOTCH}px at 100% ${y}, transparent 98%, #000)`;
  return { maskImage: mask, WebkitMaskImage: mask, maskComposite: 'intersect', WebkitMaskComposite: 'source-in' };
};

/**
 * บัตรพนักงานเวทมนตร์ 1 คน: ตัวบัตรมีแถบสีประจำตำแหน่ง ชื่อ ชื่อผู้ใช้ สถานะ, ต้นขั้วใต้รอยปรุบอกเมนูที่เปิดได้เป็นป้ายมีชื่อ และคลัง
 * ทั้งใบกดเปิดแผงแก้ไข (ถ้ามีสิทธิ์จัดการ) ชี้/แตะ/โฟกัสแล้วขอบทอง
 */
function StaffCard({ user: u, isSelf, grouped, onEdit }: { user: ManagedUser; isSelf: boolean; grouped?: boolean; onEdit?: () => void }) {
  const tone = ROLE_TONE[u.roleCode] ?? 'plum';
  const menus = APP_MENUS.filter((m) => canOpen(m, u.permissions));
  const edge = 'border-card-edge transition-colors duration-200 group-hover:border-star/70 group-active:border-star group-focus-visible:border-star';
  const body = (
    <>
      <div style={notchAt('100%')} className={cn('overflow-hidden rounded-t-2xl border border-b-0 bg-card', edge)}>
        {/* แถบประจำตำแหน่ง: สีเดียวกับกลุ่มดาวบนเวที อ่านตำแหน่งได้ก่อนชื่อ */}
        <div className={cn('flex min-h-10 items-center justify-between gap-2 px-4 py-1.5', TONES[tone])}>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold"><Sparkle className="size-3.5" />{!grouped && (ROLES[u.roleCode] ?? u.roleCode)}</span>
          {u.active
            ? <span className="inline-flex items-center gap-1.5 text-xs font-medium"><span aria-hidden className="size-1.5 rounded-full bg-current" />ใช้งานอยู่</span>
            : <Seal tone="rose" state="broken" className="h-6">ปิดใช้งาน</Seal>}
        </div>
        <div className="flex items-center gap-3 px-4 pt-4 pb-5">
          <span aria-hidden className={cn('grid size-14 shrink-0 place-items-center rounded-full font-heading text-xl font-semibold ring-2 ring-offset-2 ring-offset-card', TONES[tone], u.active ? 'ring-current/35' : 'opacity-50 ring-border grayscale')}>
            {monogram(u.displayName)}
          </span>
          <span className="grid min-w-0 gap-0.5">
            <span className={cn('font-heading text-lg leading-snug font-semibold break-words', !u.active && 'text-muted-foreground')}>{u.displayName}</span>
            <span className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <span className="break-all">{u.username}</span>
              {isSelf && <span className="rounded-full bg-star-soft px-2 text-xs font-semibold text-star-ink">คุณ</span>}
            </span>
          </span>
        </div>
      </div>
      {/* ต้นขั้ว: รอยปรุเส้นประทองคั่น เมนูที่เปิดได้เป็นป้ายมีชื่อ อ่านได้ไม่ต้องเดาไอคอน */}
      <div style={notchAt('0')} className={cn('relative grid flex-1 content-start gap-3 rounded-b-2xl border border-t-0 bg-secondary/60 px-4 pt-4 pb-3', edge)}>
        <span aria-hidden className="pointer-events-none absolute inset-x-[15px] top-0 border-t-2 border-dashed border-star-ink/35 dark:border-star/40" />
        <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">เมนูที่เปิดได้</span>
          <span className="tabular-nums">{menus.length} จาก {APP_MENUS.length}</span>
        </span>
        {menus.length ? (
          <span className={cn('flex flex-wrap gap-1.5', !u.active && 'opacity-60')}>
            {menus.map((m) => (
              <span key={m.to} className="inline-flex h-7 items-center gap-1 rounded-full bg-star-soft pr-2.5 pl-2 text-xs font-medium text-star-ink">
                <m.icon className="size-3.5" aria-hidden />{m.short}
              </span>
            ))}
          </span>
        ) : (
          <span className="rounded-lg border border-dashed border-card-edge px-3 py-2 text-xs text-muted-foreground">ยังเปิดเมนูใดไม่ได้</span>
        )}
        <span className="mt-auto flex items-center justify-between gap-2 border-t border-border/70 pt-3 text-sm">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <WarehouseIcon className="size-4 shrink-0" aria-hidden /><span className="truncate">{scopeText(u)}</span>
          </span>
          {onEdit && <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-star-ink transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none">แก้ไข<ChevronRightIcon className="size-4" aria-hidden /></span>}
        </span>
      </div>
    </>
  );
  // เงาตามรูปบัตร (drop-shadow ตาม mask รอยเว้า) ยกขึ้นเล็กน้อยเมื่อชี้
  const shell = 'group relative flex h-full w-full flex-col text-left drop-shadow-[0_6px_12px_color-mix(in_oklab,var(--pm-shadow)_14%,transparent)] transition-[translate,filter] duration-200 hover:-translate-y-0.5 hover:drop-shadow-[0_10px_18px_color-mix(in_oklab,var(--pm-shadow)_22%,transparent)] motion-reduce:hover:translate-y-0';
  return onEdit ? (
    <button type="button" onClick={onEdit} aria-label={`แก้ไขบัตรของ ${u.displayName} (${ROLES[u.roleCode] ?? u.roleCode}${u.active ? '' : ', ปิดใช้งาน'}) ${menus.length ? `เปิดได้ ${menus.length} เมนู: ${menus.map((m) => m.short).join(', ')}` : 'ยังเปิดเมนูใดไม่ได้'}`}
      className={cn(shell, 'rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-star/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background')}>
      {body}
    </button>
  ) : <div className={shell}>{body}</div>;
}

function UserEditor({ initial, isSelf, warehouses, onCancel, onSaved }: {
  initial: Draft; isSelf: boolean; warehouses: Warehouse[]; onCancel: () => void; onSaved: (u: ManagedUser) => void;
}) {
  const [d, setD] = useState(initial);
  const [showPw, setShowPw] = useState(false);
  // คนเดิม: ซ่อนช่องรหัสผ่านไว้หลังปุ่ม "เปลี่ยนรหัสผ่าน" งานหลักของแผงนี้คือตำแหน่งและสิทธิ์
  const [pwOpen, setPwOpen] = useState(initial.create);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const body = useRef<HTMLDivElement>(null);
  // requestId เดิมตลอดการแก้ฟอร์มนี้ กดบันทึกซ้ำ (เน็ตช้า) จะไม่สร้างผู้ใช้ซ้ำ
  const requestId = useRef(newRequestId());
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const custom = !sameSet(d.permissions, ROLE_DEFAULTS[d.role]);
  const locked = (p: Permission) => isSelf && p === 'users.manage';

  function pickRole(role: RoleCode) {
    // ตำแหน่งคือชุดสิทธิ์ตั้งต้น เปลี่ยนตำแหน่ง = ตั้งสิทธิ์ใหม่ตามตำแหน่งนั้น (บัญชีตัวเองคงสิทธิ์จัดการผู้ใช้ไว้ กันล็อกตัวเอง)
    const perms: Permission[] = [...ROLE_DEFAULTS[role]];
    if (isSelf && !perms.includes('users.manage')) perms.push('users.manage');
    set({ role, permissions: perms });
  }

  function setPerms(items: readonly Permission[], on: boolean) {
    const change = items.filter((p) => !locked(p));
    set({ permissions: on ? [...new Set([...d.permissions, ...change])] : d.permissions.filter((x) => !change.includes(x)) });
  }

  function toggleWarehouse(code: string, on: boolean) {
    const codes = on ? [...d.warehouseScope.codes, code] : d.warehouseScope.codes.filter((c) => c !== code);
    set({ warehouseScope: { ...d.warehouseScope, codes } });
  }

  function fail(text: string) {
    setMessage({ kind: 'error', text });
    body.current?.scrollTo({ top: 0 });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const pw = pwOpen ? d.password ?? '' : '';
    if (d.create && !/^[a-zA-Z0-9._-]{3,50}$/.test(d.username)) return fail('ชื่อผู้ใช้ใช้ได้เฉพาะภาษาอังกฤษ ตัวเลข . _ - อย่างน้อย 3 ตัว');
    if (!d.displayName.trim()) return fail('ใส่ชื่อที่แสดง');
    if ((d.create || pw) && pw.length < 8) return fail('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
    if (pw && pw !== d.confirm) return fail('ยืนยันรหัสผ่านไม่ตรงกัน พิมพ์ใหม่อีกครั้ง');
    if (!d.permissions.length) return fail('เลือกสิทธิ์อย่างน้อย 1 ข้อ ไม่งั้นผู้ใช้นี้จะเข้าเมนูใดไม่ได้เลย');
    setSaving(true);
    setMessage(null);
    try {
      const { confirm: _confirm, ...rest } = d;
      const saved = await api<ManagedUser>('/users', { method: 'POST', body: { ...rest, password: pw || undefined, requestId: requestId.current } satisfies UserInput });
      onSaved(saved);
    } catch (err) {
      fail(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  const groupRow = (key: string, name: string, items: readonly Permission[], icon?: ReactNode) => {
    const n = items.filter((p) => d.permissions.includes(p)).length;
    const isOpen = expanded.includes(key);
    const panel = `ue-group-${key.replace(/[^a-z0-9]/gi, '')}`;
    return (
      <li key={key}>
        <div className="flex items-center gap-1 pr-1">
          <CheckRow checked={n === items.length} indeterminate={n > 0 && n < items.length}
            onChange={(v) => setPerms(items, v)} disabled={items.every(locked)} className="rounded-none hover:bg-transparent">
            <span className="flex items-center gap-2.5">
              {icon}
              <span className="font-medium">{name}</span>
              {items.length > 1 && <span className="text-sm text-muted-foreground tabular-nums">{n}/{items.length}</span>}
            </span>
          </CheckRow>
          {items.length > 1 ? (
            <Button type="button" variant="ghost" size="icon-touch" aria-expanded={isOpen} aria-controls={panel}
              aria-label={`${isOpen ? 'ซ่อน' : 'แสดง'}สิทธิ์รายข้อของ${name}`}
              onClick={() => setExpanded((x) => (isOpen ? x.filter((k) => k !== key) : [...x, key]))}>
              <ChevronDownIcon className={cn('transition-transform', isOpen && 'rotate-180')} />
            </Button>
          ) : <span className="size-12 shrink-0" aria-hidden />}
        </div>
        {isOpen && (
          <div id={panel} className="grid gap-0.5 border-t border-border bg-secondary/40 py-1 pl-6">
            {items.map((p) => (
              <CheckRow key={p} checked={d.permissions.includes(p)} onChange={(v) => setPerms([p], v)} disabled={locked(p)}
                hint={locked(p) ? 'เอาออกจากบัญชีตัวเองไม่ได้ กันล็อกตัวเองออกจากระบบ' : undefined}>
                {PERMISSIONS[p]}
              </CheckRow>
            ))}
          </div>
        )}
      </li>
    );
  };

  const account = (
    <section className="grid gap-4" aria-labelledby="ue-account">
      <h3 id="ue-account" className="font-heading text-lg font-semibold">บัญชี</h3>
      {d.create && (
        <Field id="u-username" label="ชื่อผู้ใช้ (ใช้เข้าสู่ระบบ)">
          <Input id="u-username" className={touchInput} value={d.username} required
            autoComplete="off" autoCapitalize="off" spellCheck={false} aria-describedby="u-username-hint"
            onChange={(e) => set({ username: e.target.value.trim() })} />
          <p id="u-username-hint" className="text-xs text-muted-foreground">ภาษาอังกฤษ ตัวเลข . _ - อย่างน้อย 3 ตัว เปลี่ยนภายหลังไม่ได้</p>
        </Field>
      )}
      <Field id="u-display" label="ชื่อที่แสดง">
        <Input id="u-display" className={touchInput} value={d.displayName} required maxLength={100}
          placeholder="เช่น สมชาย (Sup หน้าร้าน)" onChange={(e) => set({ displayName: e.target.value })} />
      </Field>
      {!d.create && (
        <Button type="button" variant="outline" size="touch" className="justify-self-start" aria-expanded={pwOpen} aria-controls="ue-password"
          onClick={() => { if (pwOpen) set({ password: '', confirm: '' }); setPwOpen(!pwOpen); }}>
          <KeyRoundIcon />{pwOpen ? 'ไม่เปลี่ยนรหัสผ่าน' : 'เปลี่ยนรหัสผ่าน'}
        </Button>
      )}
      {pwOpen && (
        <div id="ue-password" className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="u-pw" label={d.create ? 'รหัสผ่าน' : 'รหัสผ่านใหม่'}>
              <Input id="u-pw" className={touchInput} type={showPw ? 'text' : 'password'} autoComplete="new-password"
                value={d.password} onChange={(e) => set({ password: e.target.value })} placeholder="อย่างน้อย 8 ตัว" />
            </Field>
            <Field id="u-pw2" label="ยืนยันรหัสผ่าน">
              <Input id="u-pw2" className={touchInput} type={showPw ? 'text' : 'password'} autoComplete="new-password"
                value={d.confirm} onChange={(e) => set({ confirm: e.target.value })} />
            </Field>
          </div>
          <CheckRow checked={showPw} onChange={setShowPw} className="-mt-2 flex-none">แสดงรหัสผ่าน</CheckRow>
          {!d.create && <p className="text-sm text-muted-foreground">บันทึกแล้วผู้ใช้นี้จะถูกออกจากระบบทุกเครื่อง ต้องเข้าใหม่ด้วยรหัสใหม่</p>}
        </div>
      )}
    </section>
  );

  const roleAndPerms = (
    <>
      <section className="grid gap-3" aria-labelledby="ue-role">
        <div>
          <h3 id="ue-role" className="font-heading text-lg font-semibold">ตำแหน่ง</h3>
          <p className="text-sm text-muted-foreground">เลือกแล้วระบบตั้งสิทธิ์ตามตำแหน่ง ปรับรายข้อต่อได้</p>
        </div>
        <div role="radiogroup" aria-labelledby="ue-role" className="grid gap-2">
          {ROLE_CODES.map((r) => {
            const selected = d.role === r;
            return (
              <button key={r} type="button" role="radio" aria-checked={selected} onClick={() => pickRole(r)}
                className={cn(
                  'grid min-h-14 gap-0.5 rounded-xl border-2 px-3 py-2 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  selected ? 'border-star bg-star-soft' : 'border-border bg-card hover:bg-secondary',
                )}>
                <span className="flex items-center justify-between gap-2">
                  <ToneChip tone={ROLE_TONE[r]} className="h-7 px-3 text-sm">{ROLES[r]}</ToneChip>
                  <span className="text-xs text-muted-foreground tabular-nums">{ROLE_DEFAULTS[r].length} สิทธิ์</span>
                </span>
                <span className="text-sm text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-2" aria-labelledby="ue-perms">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="ue-perms" className="font-heading text-lg font-semibold">สิทธิ์ตามเมนู</h3>
            <p className="text-sm text-muted-foreground" role="status">
              {custom ? `ปรับเองจากค่าตั้งต้นของ${ROLES[d.role]} · ${d.permissions.length} ข้อ` : `ตามค่าตั้งต้นของ${ROLES[d.role]} · ${d.permissions.length} ข้อ`}
            </p>
          </div>
          {custom && (
            <Button type="button" variant="outline" size="touch" onClick={() => pickRole(d.role)}><RotateCcwIcon />คืนค่าตามตำแหน่ง</Button>
          )}
        </div>
        {/* กลุ่มสิทธิ์เรียงตามเมนูของแอป ไอคอนเดียวกับแถบเมนู สว่างทองเมื่อเมนูนั้นจะเปิดได้ กางดูรายข้อเมื่อต้องปรับละเอียด */}
        <ul className="divide-y divide-border rounded-xl border border-border">
          {APP_MENUS.map((m) => {
            const on = canOpen(m, d.permissions);
            const icon = (
              <span aria-hidden className={cn('grid size-7 shrink-0 place-items-center rounded-md border transition-colors duration-300',
                on ? 'border-transparent bg-star-soft text-star-ink' : 'border-dashed border-border text-muted-foreground/40')}>
                <m.icon className="size-4" />
              </span>
            );
            return groupRow(m.to, m.title, m.related, icon);
          })}
        </ul>
        <p className="mt-2 text-sm font-medium text-muted-foreground">สิทธิ์อื่นที่ไม่ใช่เมนู</p>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {OTHER_PERMISSION_GROUPS.map((g) => groupRow(g.name, g.name, g.items))}
        </ul>
      </section>
    </>
  );

  return (
    <form className="flex h-full min-h-0 flex-col" onSubmit={submit} noValidate>
      {/* หัวแผงเป็นท้องฟ้า แถบเมนูสดเรืองบนฟ้า: ติ๊กสิทธิ์แล้วเห็นทันทีว่าคนนี้จะเปิดเมนูไหนได้ */}
      <SheetHeader className="bg-brand text-brand-foreground">
        <SheetTitle className="text-brand-foreground">{d.create ? 'เพิ่มผู้ใช้' : `แก้ไข ${initial.displayName}`}</SheetTitle>
        <SheetDescription className="text-brand-foreground/75">{d.create ? 'ตั้งบัญชี ตำแหน่ง และสิทธิ์ของคนใหม่' : `${initial.username} · ${ROLES[initial.role]}`}</SheetDescription>
        <div className="mt-2 grid gap-1.5">
          <span className="text-xs font-medium text-brand-foreground/75">เมนูที่จะเปิดได้</span>
          <MenuStrip permissions={d.permissions} onSky />
        </div>
      </SheetHeader>

      <div ref={body} className="grid min-h-0 flex-1 content-start gap-6 overflow-y-auto p-4">
        <Notice message={message} />
        {d.create ? <>{account}{roleAndPerms}</> : <>{roleAndPerms}{account}</>}

        <section className="grid gap-1" aria-labelledby="ue-scope">
          <h3 id="ue-scope" className="font-heading text-lg font-semibold">ขอบเขตคลัง</h3>
          <CheckRow checked={d.warehouseScope.all} onChange={(v) => set({ warehouseScope: { ...d.warehouseScope, all: v } })} hint="รวมคลังที่จะเพิ่มในอนาคตด้วย">
            ทุกคลัง
          </CheckRow>
          {!d.warehouseScope.all && warehouses.map((w) => (
            <CheckRow key={w.code} checked={d.warehouseScope.codes.includes(w.code)} onChange={(v) => toggleWarehouse(w.code, v)}>
              <span className="font-medium">{w.code}</span> <span className="text-muted-foreground">{w.name}</span>
            </CheckRow>
          ))}
          {!d.warehouseScope.all && !warehouses.length && (
            <p className="px-2 text-sm text-muted-foreground">ยังไม่มีคลังในระบบ เลือก "ทุกคลัง" หรือเพิ่มคลังก่อนแล้วกลับมากำหนดทีหลัง</p>
          )}
        </section>

        <section className="grid gap-1" aria-labelledby="ue-status">
          <h3 id="ue-status" className="font-heading text-lg font-semibold">สถานะบัญชี</h3>
          <CheckRow checked={d.active} onChange={(v) => set({ active: v })} disabled={isSelf}
            hint={isSelf ? 'ปิดบัญชีที่กำลังใช้อยู่ไม่ได้ ให้ผู้ดูแลคนอื่นปิดแทน' : 'ปิดแล้วเข้าสู่ระบบไม่ได้ และถูกออกจากระบบทันที ข้อมูลเดิมยังอยู่'}>
            เปิดใช้งาน
          </CheckRow>
        </section>
      </div>

      <SheetFooter className="flex-row items-center border-t border-border pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
        {/* ปุ่มบันทึกแบบ StarBorder (ปุ่มบันทึกของธีม เหมือนหน้าออเดอร์/ตรวจของเบิก) ดาววิ่งหยุดเองเมื่อลดการเคลื่อนไหว */}
        <StarBorder className="flex-1" innerClassName="border-0">
          <Button type="submit" size="touch" className="w-full bg-star text-on-star hover:bg-star/90" disabled={saving}>
            {saving ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />}
            {saving ? 'กำลังบันทึก…' : d.create ? 'เพิ่มผู้ใช้' : 'บันทึก'}
          </Button>
        </StarBorder>
        <Button type="button" variant="outline" size="touch" disabled={saving} onClick={onCancel}>ยกเลิก</Button>
      </SheetFooter>
    </form>
  );
}

/** สรุปสิ่งที่เปลี่ยนใน 1 ครั้ง เป็นภาษาคน */
function describe(e: UserAuditEntry): string {
  const a = e.after, b = e.before;
  if (!a) return 'ลบผู้ใช้';
  if (!b) return `สร้างผู้ใช้ ตำแหน่ง${ROLES[a.roleCode] ?? a.roleCode}`;
  const parts: string[] = [];
  if (b.displayName !== a.displayName) parts.push(`เปลี่ยนชื่อเป็น "${a.displayName}"`);
  if (b.roleCode !== a.roleCode) parts.push(`ตำแหน่ง ${ROLES[b.roleCode] ?? b.roleCode} → ${ROLES[a.roleCode] ?? a.roleCode}`);
  const added = a.permissions.filter((p) => !b.permissions.includes(p)).length;
  const removed = b.permissions.filter((p) => !a.permissions.includes(p)).length;
  if (added) parts.push(`เพิ่มสิทธิ์ ${added} ข้อ`);
  if (removed) parts.push(`ลดสิทธิ์ ${removed} ข้อ`);
  if (b.warehouseScope.all !== a.warehouseScope.all || !sameSet(b.warehouseScope.codes, a.warehouseScope.codes)) parts.push('เปลี่ยนขอบเขตคลัง');
  if (a.active === false && (b as { active?: boolean }).active !== false) parts.push('ปิดใช้งาน');
  if (a.passwordChanged) parts.push('เปลี่ยนรหัสผ่าน');
  return parts.join(' · ') || 'บันทึกโดยไม่มีการเปลี่ยนแปลง';
}

function AuditHistory() {
  const [rows, setRows] = useState<UserAuditEntry[] | null>(null);
  const [error, setError] = useState<Message | null>(null);

  function onToggle(e: SyntheticEvent<HTMLDetailsElement>) {
    // โหลดเมื่อเปิดดูครั้งแรกเท่านั้น
    if (e.currentTarget.open && !rows) api<UserAuditEntry[]>('/users/audit').then(setRows).catch((err) => setError({ kind: 'error', text: errorText(err) }));
  }

  return (
    <details className="group rounded-xl border border-border bg-card px-4" onToggle={onToggle}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 font-heading text-lg font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <HistoryIcon className="size-5 text-muted-foreground" aria-hidden />ประวัติการแก้ไขผู้ใช้
        <ChevronRightIcon className="ml-auto size-5 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
      </summary>
      <div className="grid gap-2 pb-4">
        <Notice message={error} />
        {!rows && !error && <p className="text-sm text-muted-foreground" role="status">กำลังโหลดประวัติ…</p>}
        {rows && !rows.length && <p className="text-sm text-muted-foreground">ยังไม่มีประวัติ</p>}
        {rows && rows.length > 0 && (
          <ol className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="grid gap-0.5 py-2.5">
                <span><strong className="font-semibold">{r.username}</strong> <span className="text-muted-foreground">·</span> {describe(r)}</span>
                <span className="text-xs text-muted-foreground tabular-nums">โดย {r.actor} · {formatTime(r.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}
