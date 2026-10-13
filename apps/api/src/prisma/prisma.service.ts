import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

/** รอฐานข้อมูลได้นานสุด 20 × 3 วินาที = 1 นาที (เช่น Docker Postgres เพิ่งเปิดเครื่องยังไม่พร้อม) */
const CONNECT_TRIES = 20;
const CONNECT_WAIT_MS = 3000;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // ค่าตั้งต้นของ Prisma รอ connection เข้าธุรกรรมแค่ 2 วินาที กดบันทึกพร้อมกันหลายเครื่อง (หรือรอล็อกแถวออเดอร์)
    // จะได้ error "Unable to start a transaction" แทนที่จะรอคิว ให้รอได้ 10 วินาที และทำงานในธุรกรรมได้ 20 วินาที
    super({ transactionOptions: { maxWait: 10_000, timeout: 20_000 } });
  }

  async onModuleInit() {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.$connect();
        if (attempt > 1) this.logger.log('เชื่อมฐานข้อมูลได้แล้ว');
        return;
      } catch (e) {
        // ลองใหม่เฉพาะกรณีติดต่อเซิร์ฟเวอร์ฐานข้อมูลไม่ได้ (P1001) ผิดรหัสผ่าน/ชื่อฐานให้ล้มทันที
        const unreachable = e instanceof Prisma.PrismaClientInitializationError && e.errorCode === 'P1001';
        if (!unreachable || attempt >= CONNECT_TRIES) throw e;
        this.logger.warn(`ยังติดต่อฐานข้อมูลไม่ได้ ลองใหม่ใน ${CONNECT_WAIT_MS / 1000} วินาที (${attempt}/${CONNECT_TRIES})`);
        await new Promise((r) => setTimeout(r, CONNECT_WAIT_MS));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/** true ถ้าเป็น error จาก unique constraint (เช่น requestId ซ้ำ) */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}
