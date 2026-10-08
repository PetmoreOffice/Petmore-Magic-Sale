import {
  ArrowLeftIcon, BackpackIcon, BedIcon, FootprintsIcon, HeartPulseIcon, UtensilsIcon, BoneIcon, CatIcon, DogIcon, DropletsIcon, EarIcon, EyeIcon, FenceIcon, FishIcon, GiftIcon, Grid3x3Icon,
  HourglassIcon, HouseIcon, LayersIcon, LayoutGridIcon, LinkIcon, type LucideIcon, MilkIcon, PackageIcon, PawPrintIcon, PillIcon,
  RabbitIcon, ScissorsIcon, ShirtIcon, ShowerHeadIcon, SmileIcon, SoupIcon, SyringeIcon, ToiletIcon, ToyBrickIcon, TreesIcon,
} from 'lucide-react';
import { cn } from 'cn';
import { NO_PRODUCT_TYPE, TYPE_GROUPS, typeGroup, type ProductType, type TypeGroupKey } from '@petmore/shared';
import { Button } from '@/components/ui/button';
import { TONES, toneFor } from '@/components/magic';

/**
 * ไอคอนประจำชนิดสินค้า (หมวดแม่ ICDEPT) จับจากคำในชื่อหมวด ลำดับสำคัญ:
 * คำเฉพาะก่อนคำกว้าง เช่น "อาหารเสริม สำหรับแมว" ต้องได้ยา ไม่ใช่แมว, "ห้องน้ำ/ กระบะทราย" ก่อน "ทราย"
 */
const ICONS: [RegExp, LucideIcon][] = [
  [/อาหารเสริม|วิตามิน/, PillIcon],
  [/ยา/, SyringeIcon],
  [/ห้องน้ำ|กระบะ/, ToiletIcon],
  [/ขี้เลื่อย/, TreesIcon],
  [/ทราย/, HourglassIcon],
  [/ขนมสุนัข/, BoneIcon],
  [/ขนมแมว/, FishIcon],
  [/กระต่าย|ฟันแทะ/, RabbitIcon],
  [/สุนัข/, DogIcon],
  [/แมว/, CatIcon],
  [/ของเล่น/, ToyBrickIcon],
  [/สายจูง|ปลอกคอ/, LinkIcon],
  [/เสื้อผ้า/, ShirtIcon],
  [/ชาม/, SoupIcon],
  [/ที่ให้น้ำ|ที่ให้อาหาร/, DropletsIcon],
  [/เบาะ|ที่นอน/, BedIcon],
  [/อาบน้ำ|บำรุงขน/, ShowerHeadIcon],
  [/กรูมมิ่ง/, ScissorsIcon],
  [/กระเป๋า|ตระกร้า/, BackpackIcon],
  [/คอก/, FenceIcon],
  [/กรง/, Grid3x3Icon],
  [/บ้าน|คอนโด/, HouseIcon],
  [/ช่องปาก/, SmileIcon],
  [/ใบหู/, EarIcon],
  [/ดวงตา/, EyeIcon],
  [/นม/, MilkIcon],
  [/แผ่นรอง|ผ้าอ้อม/, LayersIcon],
  [/ของแถม|แคมเปญ|คละ/, GiftIcon],
  [/ของใช้/, PackageIcon],
];
export function typeIcon(name: string): LucideIcon {
  return ICONS.find(([re]) => re.test(name))?.[1] ?? PawPrintIcon;
}
/** ชื่อสั้นสำหรับชิป: ตัดส่วนหลังเครื่องหมาย / ที่ยาว เช่น "สายจูง/ ปลอกคอ/ ครอบปาก/..." → "สายจูง ปลอกคอ" */
function shortName(name: string) {
  if (name === NO_PRODUCT_TYPE) return 'ไม่ระบุชนิด';
  const parts = name.split('/').map((p) => p.trim()).filter(Boolean);
  return parts.length > 2 ? `${parts[0]} ${parts[1]}` : parts.join(' / ');
}

export interface CategoryFilter {
  group: string;
  type: string;
  sub: string;
}
export const NO_FILTER: CategoryFilter = { group: '', type: '', sub: '' };

const GROUP_ICONS: Record<TypeGroupKey, LucideIcon> = {
  food: UtensilsIcon, treat: BoneIcon, health: HeartPulseIcon, groom: ShowerHeadIcon, litter: ToiletIcon,
  toy: ToyBrickIcon, outing: FootprintsIcon, home: HouseIcon, bowl: SoupIcon, other: PackageIcon,
};

/** ชื่อชนิดย่อยตัดส่วนที่ซ้ำกับชนิด: "อาหารแมวชนิดเม็ด แบบถุง" ในชนิด "อาหารแมวชนิดเม็ด" → "แบบถุง" */
function subName(sub: string, type: string) {
  const squash = (t: string) => t.replace(/\s+/g, '');
  if (!squash(sub).startsWith(squash(type))) return sub;
  let i = 0, n = 0;
  const target = squash(type).length;
  while (i < sub.length && n < target) { if (!/\s/.test(sub[i])) n++; i++; }
  return sub.slice(i).trim() || sub;
}

/**
 * ตัวเลือกหมวดสินค้า 3 ชั้น: หมวดใหญ่ (จัดเองใน shared/TYPE_GROUPS) → ชนิด (หมวดแม่ ICDEPT) → ชนิดย่อย (หมวดย่อย)
 * ยังไม่เลือก: ตารางหมวดใหญ่ 10 ช่อง เห็นครบในจอเดียว ไม่ต้องเลื่อนข้าง
 * เลือกแล้ว: ตารางยุบเป็นแถบสรุป ("ทุกหมวด" + หมวดที่เลือก) แล้วขึ้นชิปชนิด/ชนิดย่อยแบบตัดบรรทัด
 */
export function CategoryPicker({ types, value, onChange, disabled }: {
  types: ProductType[] | null; value: CategoryFilter; onChange: (value: CategoryFilter) => void; disabled?: boolean;
}) {
  if (!types) return <div className="h-24 animate-pulse rounded-xl bg-muted/60" aria-hidden />;
  const total = types.reduce((n, t) => n + t.count, 0);
  const groups = TYPE_GROUPS.map((g) => {
    const members = types.filter((t) => typeGroup(t.name) === g.key);
    return { ...g, types: members, count: members.reduce((n, t) => n + t.count, 0) };
  }).filter((g) => g.count > 0);
  const group = groups.find((g) => g.key === value.group);
  const type = group?.types.find((t) => t.name === value.type);

  if (!group) {
    return (
      <div role="radiogroup" aria-label="หมวดสินค้า" className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-11">
        <GroupTile selected icon={LayoutGridIcon} tone="star" label="ทุกหมวด" count={total} disabled={disabled} onClick={() => onChange(NO_FILTER)} />
        {groups.map((g) => (
          <GroupTile
            key={g.key}
            selected={false}
            icon={GROUP_ICONS[g.key]}
            tone={toneFor(g.name)}
            label={g.name}
            count={g.count}
            disabled={disabled}
            // หมวดที่มีชนิดเดียว (เช่น ของเล่น) เลือกชนิดให้เลย จะได้เห็นชนิดย่อยทันที
            onClick={() => onChange({ group: g.key, type: g.types.length === 1 ? g.types[0].name : '', sub: '' })}
          />
        ))}
      </div>
    );
  }

  const GroupIcon = GROUP_ICONS[group.key];
  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="touch" className="-ml-2 px-2.5" disabled={disabled} onClick={() => onChange(NO_FILTER)}>
          <ArrowLeftIcon />ทุกหมวด
        </Button>
        <span className="inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-star bg-star-soft py-1 pr-3.5 pl-1 font-semibold">
          <span className={cn('grid size-9 place-items-center rounded-full', TONES[toneFor(group.name)])}><GroupIcon className="size-[18px]" aria-hidden /></span>
          {group.name}
          <span className="text-xs font-normal text-muted-foreground tabular-nums">{group.count.toLocaleString('th-TH')}</span>
        </span>
      </div>
      {group.types.length > 1 && type && (
        // เลือกชนิดแล้ว ยุบรายการชนิดเหลือตัวที่เลือก (หมวดอาหารมี 11 ชนิด บนมือถือจะดันสินค้าตกจอ)
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="touch" className="-ml-2 px-2.5" disabled={disabled} onClick={() => onChange({ group: group.key, type: '', sub: '' })}>
            <ArrowLeftIcon />ทุกชนิด
          </Button>
          <TypeChip selected icon={typeIcon(type.name)} label={shortName(type.name)} title={type.name} count={type.count} disabled={disabled} onClick={() => onChange({ group: group.key, type: type.name, sub: '' })} />
        </div>
      )}
      {group.types.length > 1 && !type && (
        <div role="radiogroup" aria-label={`ชนิดสินค้าในหมวด ${group.name}`} className="flex flex-wrap gap-2">
          <TypeChip selected={!value.type} label="ทุกชนิด" count={group.count} disabled={disabled} onClick={() => onChange({ group: group.key, type: '', sub: '' })} />
          {group.types.map((t) => (
            <TypeChip key={t.name} selected={value.type === t.name} icon={typeIcon(t.name)} label={shortName(t.name)} title={t.name} count={t.count} disabled={disabled}
              onClick={() => onChange({ group: group.key, type: t.name, sub: '' })} />
          ))}
        </div>
      )}
      {type && type.subs.length > 1 && (
        <div role="radiogroup" aria-label={`ชนิดย่อยของ ${type.name}`} className="flex flex-wrap gap-1.5">
          <SubChip selected={!value.sub} label="ทุกแบบ" count={type.count} disabled={disabled} onClick={() => onChange({ ...value, sub: '' })} />
          {type.subs.map((s) => <SubChip key={s.name} selected={value.sub === s.name} label={subName(s.name, type.name)} count={s.count} disabled={disabled} onClick={() => onChange({ ...value, sub: s.name })} />)}
        </div>
      )}
    </div>
  );
}

function GroupTile({ selected, onClick, icon: Icon, tone, label, count, disabled }: {
  selected: boolean; onClick: () => void; icon: LucideIcon; tone: keyof typeof TONES; label: string; count: number; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid min-h-24 content-start justify-items-center gap-1 rounded-xl border-2 px-1 py-2 text-center transition-[border-color,background-color,transform] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60',
        'hover:-translate-y-0.5 motion-reduce:hover:translate-y-0',
        selected ? 'border-star bg-star-soft' : 'border-border bg-card hover:border-star/50',
      )}
    >
      <span className={cn('grid size-11 place-items-center rounded-full', TONES[tone])}><Icon className="size-5" aria-hidden /></span>
      <span className="line-clamp-2 text-xs leading-tight font-semibold sm:text-sm">{label}</span>
      <span className="text-[11px] text-muted-foreground tabular-nums">{count.toLocaleString('th-TH')}</span>
    </button>
  );
}

function TypeChip({ selected, onClick, icon: Icon, label, title, count, disabled }: {
  selected: boolean; onClick: () => void; icon?: LucideIcon; label: string; title?: string; count: number; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-12 items-center gap-1.5 rounded-full border-2 px-3 text-sm transition-[border-color,background-color] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60',
        selected ? 'border-star bg-star-soft font-semibold' : 'border-border bg-card hover:border-star/50',
      )}
    >
      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      {label}
      <span className="text-xs text-muted-foreground tabular-nums">{count.toLocaleString('th-TH')}</span>
    </button>
  );
}

function SubChip({ selected, onClick, label, count, disabled }: { selected: boolean; onClick: () => void; label: string; count: number; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-12 shrink-0 snap-start items-center gap-1.5 rounded-full px-3.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60',
        selected ? 'bg-plum text-primary-foreground font-semibold' : 'bg-plum-soft text-plum hover:brightness-95',
      )}
    >
      {label}
      <span className={cn('text-xs tabular-nums', selected ? 'opacity-80' : 'opacity-70')}>{count.toLocaleString('th-TH')}</span>
    </button>
  );
}
