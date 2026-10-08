import { FormEvent, ReactNode, SyntheticEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftIcon, ChevronRightIcon, HistoryIcon, LoaderCircleIcon, RotateCcwIcon, SaveIcon, SearchIcon, UserPlusIcon } from 'lucide-react';
import { cn } from 'cn';
import {
  ManagedUser, Permission, PERMISSION_GROUPS, PERMISSIONS, ROLE_DEFAULTS, ROLE_DESCRIPTIONS, RoleCode, ROLES,
  searchKey, UserAuditEntry, UserInput, Warehouse,
} from '@petmore/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field, Message, Notice } from '@/components/wms';
import { monogram, ToneChip, TONES, type Tone } from '@/components/magic';
import { touchInput } from '@/lib/touch';
import { api, formatTime, newRequestId } from '../api';
import { useAuth } from '../auth';

const ROLE_CODES = Object.keys(ROLES) as RoleCode[];
/** สีประจำตำแหน่ง ใช้ทั้งป้ายในรายการและตัวเลือกในฟอร์ม */
const ROLE_TONE: Record<RoleCode, Tone> = { ADMIN: 'star', CHECKER: 'mint', PICKER: 'kibble' };

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

/** ช่องติ๊กทั้งแถวกดได้ สูง 48px (ใช้ input ของเครื่องเอง สีตามธีมจาก accent-color) */
function CheckRow({ checked, onChange, disabled, children, hint }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: ReactNode; hint?: string }) {
  return (
    <Label className={cn('min-h-12 cursor-pointer gap-3 rounded-lg px-2 font-normal hover:bg-secondary', disabled && 'cursor-not-allowed opacity-60 hover:bg-transparent')}>
      <input type="checkbox" className="size-5 shrink-0" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="grid gap-0.5 py-1.5">
        <span>{children}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
    </Label>
  );
}

/**
 * จัดการผู้ใช้: รายการผู้ใช้ (ค้น กรองตามตำแหน่ง) → แตะเพื่อแก้ หรือเพิ่มผู้ใช้ใหม่
 * ตำแหน่งเป็นค่าตั้งต้นของสิทธิ์ เลือกตำแหน่งแล้วปรับสิทธิ์รายข้อต่อได้
 */
export function UsersPage() {
  const { user: me, has } = useAuth();
  const canManage = has('users.manage');
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleCode | 'ALL'>('ALL');
  const [term, setTerm] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const top = useRef<HTMLDivElement>(null);

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
    // เปิดฟอร์มแล้วพาไปบนสุด โฟกัสหัวข้อให้โปรแกรมอ่านหน้าจอรู้ว่าเปลี่ยนหน้าแล้ว
    requestAnimationFrame(() => { window.scrollTo({ top: 0 }); top.current?.focus(); });
  }

  function close(done?: Message) {
    setDraft(null);
    setMessage(done ?? null);
    requestAnimationFrame(() => top.current?.focus());
  }

  const counts = useMemo(() => {
    const c: Record<RoleCode | 'ALL', number> = { ALL: 0, ADMIN: 0, CHECKER: 0, PICKER: 0 };
    for (const u of users ?? []) { c.ALL++; if (u.roleCode in c) c[u.roleCode]++; }
    return c;
  }, [users]);

  const shown = useMemo(() => {
    const q = searchKey(term);
    return (users ?? []).filter((u) =>
      (roleFilter === 'ALL' || u.roleCode === roleFilter) &&
      (!q || searchKey(u.displayName).includes(q) || searchKey(u.username).includes(q)));
  }, [users, roleFilter, term]);

  if (draft) {
    return (
      <div className="grid gap-4">
        <div ref={top} tabIndex={-1} className="flex flex-wrap items-center justify-between gap-3 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <h2 className="font-heading text-xl font-semibold">{draft.create ? 'เพิ่มผู้ใช้' : `แก้ไข ${draft.displayName || draft.username}`}</h2>
          <Button variant="outline" size="touch" onClick={() => close()}><ArrowLeftIcon />กลับรายการผู้ใช้</Button>
        </div>
        <UserEditor
          initial={draft}
          isSelf={!draft.create && draft.username === me?.username}
          warehouses={warehouses}
          onCancel={() => close()}
          onSaved={(saved) => {
            void load();
            close({ kind: 'info', text: `${draft.create ? 'เพิ่ม' : 'บันทึก'}ผู้ใช้ ${saved.displayName} (${saved.username}) แล้ว` });
          }}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div ref={top} tabIndex={-1} className="flex flex-wrap items-center justify-between gap-3 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <div>
          <h2 className="font-heading text-xl font-semibold">ผู้ใช้ทั้งหมด</h2>
          <p className="text-sm text-muted-foreground">ตำแหน่งกำหนดสิทธิ์ตั้งต้น ปรับสิทธิ์รายคนได้ในหน้าแก้ไข</p>
        </div>
        {canManage && <Button size="touch" onClick={() => open(emptyDraft())}><UserPlusIcon />เพิ่มผู้ใช้</Button>}
      </div>

      <Notice message={message} />

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className={cn(touchInput, 'pl-9')} type="search" aria-label="ค้นหาผู้ใช้" placeholder="ค้นชื่อ หรือชื่อผู้ใช้" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <div role="radiogroup" aria-label="กรองตามตำแหน่ง" className="flex flex-wrap gap-2">
          {(['ALL', ...ROLE_CODES] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={roleFilter === r}
              onClick={() => setRoleFilter(r)}
              className={cn(
                'flex min-h-12 items-center gap-2 rounded-full border-2 px-4 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                roleFilter === r ? 'border-star bg-star-soft font-semibold' : 'border-border bg-card hover:bg-secondary',
              )}
            >
              {r === 'ALL' ? 'ทั้งหมด' : ROLES[r]}
              <span className="tabular-nums text-muted-foreground">{counts[r]}</span>
            </button>
          ))}
        </div>
      </div>

      <Card aria-busy={!users}>
        <CardContent>
          {!users && !message && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />กำลังโหลดผู้ใช้…
            </p>
          )}
          {users && !shown.length && (
            <p className="text-sm text-muted-foreground">
              {term || roleFilter !== 'ALL' ? 'ไม่พบผู้ใช้ที่ตรงกับตัวกรอง ลองล้างคำค้นหรือเลือก "ทั้งหมด"' : 'ยังไม่มีผู้ใช้'}
            </p>
          )}
          {shown.length > 0 && (
            <ul className="-my-2 divide-y divide-border">
              {shown.map((u) => {
                const body = (
                  <>
                    <span aria-hidden className={cn('grid size-11 shrink-0 place-items-center rounded-full font-heading text-lg font-semibold', TONES[ROLE_TONE[u.roleCode] ?? 'plum'])}>
                      {monogram(u.displayName)}
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold">{u.displayName}</span>
                        {u.username === me?.username && <span className="text-xs text-muted-foreground">(คุณ)</span>}
                        <ToneChip tone={ROLE_TONE[u.roleCode] ?? 'plum'}>{ROLES[u.roleCode] ?? u.roleCode}</ToneChip>
                        {!u.active && <Badge variant="destructive">ปิดใช้งาน</Badge>}
                      </span>
                      <span className="truncate text-sm text-muted-foreground">
                        {u.username} · {u.permissions.length} สิทธิ์ · {u.warehouseScope.all ? 'ทุกคลัง' : u.warehouseScope.codes.length ? `คลัง ${u.warehouseScope.codes.join(', ')}` : 'ยังไม่ได้รับสิทธิ์คลัง'}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={u.id}>
                    {canManage ? (
                      <button type="button" onClick={() => open(draftOf(u))} aria-label={`แก้ไข ${u.displayName}`}
                        className="flex w-full items-center gap-3 rounded-lg px-1 py-3 text-left outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50">
                        {body}
                        <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                      </button>
                    ) : (
                      <div className="flex items-center gap-3 px-1 py-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {has('users.audit') && <AuditHistory />}
    </div>
  );
}

function UserEditor({ initial, isSelf, warehouses, onCancel, onSaved }: {
  initial: Draft; isSelf: boolean; warehouses: Warehouse[]; onCancel: () => void; onSaved: (u: ManagedUser) => void;
}) {
  const [d, setD] = useState(initial);
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  // requestId เดิมตลอดการแก้ฟอร์มนี้ กดบันทึกซ้ำ (เน็ตช้า) จะไม่สร้างผู้ใช้ซ้ำ
  const requestId = useRef(newRequestId());
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const defaults = ROLE_DEFAULTS[d.role];
  const custom = !sameSet(d.permissions, defaults);

  function pickRole(role: RoleCode) {
    // ตำแหน่งคือชุดสิทธิ์ตั้งต้น เปลี่ยนตำแหน่ง = ตั้งสิทธิ์ใหม่ตามตำแหน่งนั้น (บัญชีตัวเองคงสิทธิ์จัดการผู้ใช้ไว้ กันล็อกตัวเอง)
    const perms: Permission[] = [...ROLE_DEFAULTS[role]];
    if (isSelf && !perms.includes('users.manage')) perms.push('users.manage');
    set({ role, permissions: perms });
  }

  function togglePerm(p: Permission, on: boolean) {
    set({ permissions: on ? [...d.permissions, p] : d.permissions.filter((x) => x !== p) });
  }

  function toggleWarehouse(code: string, on: boolean) {
    const codes = on ? [...d.warehouseScope.codes, code] : d.warehouseScope.codes.filter((c) => c !== code);
    set({ warehouseScope: { ...d.warehouseScope, codes } });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const pw = d.password ?? '';
    if ((d.create || pw) && pw.length < 8) return setMessage({ kind: 'error', text: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' });
    if (pw && pw !== d.confirm) return setMessage({ kind: 'error', text: 'ยืนยันรหัสผ่านไม่ตรงกัน พิมพ์ใหม่อีกครั้ง' });
    if (!d.permissions.length) return setMessage({ kind: 'error', text: 'เลือกสิทธิ์อย่างน้อย 1 ข้อ ไม่งั้นผู้ใช้นี้จะเข้าเมนูใดไม่ได้เลย' });
    setSaving(true);
    setMessage(null);
    try {
      const { confirm: _confirm, ...body } = d;
      const saved = await api<ManagedUser>('/users', { method: 'POST', body: { ...body, password: pw || undefined, requestId: requestId.current } satisfies UserInput });
      onSaved(saved);
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) });
      // ข้อผิดพลาดอยู่บนสุดของฟอร์ม เลื่อนให้เห็น
      window.scrollTo({ top: 0 });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <Notice message={message} />
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle role="heading" aria-level={3}>ข้อมูลบัญชี</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field id="u-username" label="ชื่อผู้ใช้ (ใช้เข้าสู่ระบบ)">
                <Input id="u-username" className={touchInput} value={d.username} disabled={!d.create} required
                  autoComplete="off" autoCapitalize="off" spellCheck={false}
                  aria-describedby="u-username-hint" onChange={(e) => set({ username: e.target.value.trim() })} />
                <p id="u-username-hint" className="text-xs text-muted-foreground">
                  {d.create ? 'ภาษาอังกฤษ ตัวเลข . _ - อย่างน้อย 3 ตัว เปลี่ยนภายหลังไม่ได้' : 'ชื่อผู้ใช้เปลี่ยนไม่ได้'}
                </p>
              </Field>
              <Field id="u-display" label="ชื่อที่แสดง">
                <Input id="u-display" className={touchInput} value={d.displayName} required maxLength={100}
                  placeholder="เช่น สมชาย (Sup หน้าร้าน)" onChange={(e) => set({ displayName: e.target.value })} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="u-pw" label={d.create ? 'รหัสผ่าน' : 'รหัสผ่านใหม่'}>
                  <Input id="u-pw" className={touchInput} type={showPw ? 'text' : 'password'} autoComplete="new-password"
                    value={d.password} onChange={(e) => set({ password: e.target.value })}
                    placeholder={d.create ? 'อย่างน้อย 8 ตัว' : 'เว้นว่าง = ใช้รหัสเดิม'} />
                </Field>
                <Field id="u-pw2" label="ยืนยันรหัสผ่าน">
                  <Input id="u-pw2" className={touchInput} type={showPw ? 'text' : 'password'} autoComplete="new-password"
                    value={d.confirm} onChange={(e) => set({ confirm: e.target.value })} disabled={!d.password} />
                </Field>
              </div>
              <CheckRow checked={showPw} onChange={setShowPw}>แสดงรหัสผ่าน</CheckRow>
              {!d.create && d.password && <p className="text-sm text-muted-foreground">เปลี่ยนรหัสผ่านแล้ว ผู้ใช้นี้จะถูกออกจากระบบทุกเครื่อง ต้องเข้าใหม่ด้วยรหัสใหม่</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle role="heading" aria-level={3} id="u-role-label">ตำแหน่ง</CardTitle>
              <CardDescription>เลือกตำแหน่งแล้วระบบตั้งสิทธิ์ให้ตามตำแหน่ง ปรับรายข้อต่อได้</CardDescription>
            </CardHeader>
            <CardContent>
              <div role="radiogroup" aria-labelledby="u-role-label" className="grid gap-2">
                {ROLE_CODES.map((r) => {
                  const selected = d.role === r;
                  return (
                    <button key={r} type="button" role="radio" aria-checked={selected} onClick={() => pickRole(r)}
                      className={cn(
                        'flex min-h-16 items-center gap-3 rounded-xl border-2 px-3 py-2 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                        selected ? 'border-star bg-star-soft' : 'border-border bg-card hover:bg-secondary',
                      )}>
                      <ToneChip tone={ROLE_TONE[r]} className="h-7 shrink-0 px-3 text-sm">{ROLES[r]}</ToneChip>
                      <span className="min-w-0 flex-1 text-sm text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{ROLE_DEFAULTS[r].length} สิทธิ์</span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle role="heading" aria-level={3}>สถานะบัญชี</CardTitle>
            </CardHeader>
            <CardContent>
              <CheckRow checked={d.active} onChange={(v) => set({ active: v })} disabled={isSelf}
                hint={isSelf ? 'ปิดบัญชีที่กำลังใช้อยู่ไม่ได้ ให้ผู้ดูแลคนอื่นปิดแทน' : 'ปิดแล้วผู้ใช้นี้เข้าสู่ระบบไม่ได้ และถูกออกจากระบบทันที ข้อมูลเดิมยังอยู่'}>
                เปิดใช้งาน
              </CheckRow>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle role="heading" aria-level={3}>สิทธิ์</CardTitle>
              <CardDescription role="status">
                {custom ? `ปรับเองจากค่าตั้งต้นของ${ROLES[d.role]} · เลือกไว้ ${d.permissions.length} ข้อ` : `ตรงกับค่าตั้งต้นของ${ROLES[d.role]} · ${d.permissions.length} ข้อ`}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {custom && (
                <Button type="button" variant="outline" size="touch" className="justify-self-start" onClick={() => pickRole(d.role)}>
                  <RotateCcwIcon />คืนค่าสิทธิ์ตามตำแหน่ง
                </Button>
              )}
              {PERMISSION_GROUPS.map((g) => (
                <fieldset key={g.name} className="grid gap-0.5">
                  <legend className="mb-1 text-sm font-semibold">{g.name}</legend>
                  {g.items.map((p) => {
                    const locked = isSelf && p === 'users.manage';
                    return (
                      <CheckRow key={p} checked={d.permissions.includes(p)} onChange={(v) => togglePerm(p, v)} disabled={locked}
                        hint={locked ? 'เอาออกจากบัญชีตัวเองไม่ได้ กันล็อกตัวเองออกจากระบบ' : undefined}>
                        {PERMISSIONS[p]}
                      </CheckRow>
                    );
                  })}
                </fieldset>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle role="heading" aria-level={3}>ขอบเขตคลัง</CardTitle>
              <CardDescription>คลังที่ผู้ใช้นี้เห็นสต็อกและทำงานได้</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-0.5">
              <CheckRow checked={d.warehouseScope.all} onChange={(v) => set({ warehouseScope: { ...d.warehouseScope, all: v } })}
                hint="รวมคลังที่จะเพิ่มในอนาคตด้วย">
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
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="touch" disabled={saving}>
          {saving ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />}
          {saving ? 'กำลังบันทึก…' : d.create ? 'เพิ่มผู้ใช้' : 'บันทึกการแก้ไข'}
        </Button>
        <Button type="button" variant="outline" size="touch" disabled={saving} onClick={onCancel}>ยกเลิก</Button>
      </div>
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
    <details className="rounded-xl border border-border bg-card px-4" onToggle={onToggle}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 font-heading text-lg font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <HistoryIcon className="size-5 text-muted-foreground" aria-hidden />ประวัติการแก้ไขผู้ใช้
        <ChevronRightIcon className="ml-auto size-5 text-muted-foreground transition-transform [details[open]_&]:rotate-90" aria-hidden />
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
