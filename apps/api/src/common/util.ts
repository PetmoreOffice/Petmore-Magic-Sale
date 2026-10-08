import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Location as LocationDto } from '@petmore/shared';
import type { Tx } from '../prisma/prisma.service';

export function requireText(value: unknown, label: string, max = 200): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new BadRequestException(`กรอก${label}`);
  if (text.length > max) throw new BadRequestException(`${label}ยาวเกิน ${max} ตัวอักษร ย่อให้สั้นลงแล้วลองอีกครั้ง`);
  return text;
}

export function optionalText(value: unknown, max = 500): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.slice(0, max);
}

export function requireRequestId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new BadRequestException('บันทึกไม่สำเร็จ โหลดหน้าใหม่แล้วลองอีกครั้ง');
  return id;
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'));
}

/** เลขเอกสารต่อเนื่องรายปี เช่น RC-2026-000001 (ต้องเรียกภายใน transaction) */
export async function nextDocNo(tx: Tx, prefix: string): Promise<string> {
  const key = `${prefix}-${new Date().getFullYear()}`;
  const seq = await tx.docSequence.upsert({
    where: { key },
    create: { key, last: 1 },
    update: { last: { increment: 1 } },
  });
  return `${key}-${String(seq.last).padStart(6, '0')}`;
}

export async function audit(
  tx: Tx,
  entity: string,
  entityId: string,
  actorId: string,
  before: unknown,
  after: unknown,
) {
  await tx.auditLog.create({
    data: {
      entity,
      entityId,
      actorId,
      before: (before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (after ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

type LocationWithZone = Prisma.LocationGetPayload<{ include: { zone: true } }>;

export function toLocationDto(l: LocationWithZone): LocationDto {
  return {
    id: l.id,
    warehouse: l.warehouseCode,
    zoneId: l.zoneId,
    code: l.code,
    displayCode: [l.zone.code, l.code].filter(Boolean).join('-'),
    name: l.name,
    active: l.active && l.zone.active,
    revision: l.revision,
  };
}
