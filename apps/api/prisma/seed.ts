import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS } from '@petmore/shared';
import { hashPassword } from '../src/auth/password';

// สร้างบัญชีผู้ดูแลคนแรก (แทน createManager ของระบบเดิม)
async function main() {
  const prisma = new PrismaClient();
  const username = process.env.SEED_ADMIN_USERNAME?.trim();
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';
  if (!username || password.length < 8) {
    throw new Error('ตั้ง SEED_ADMIN_USERNAME และ SEED_ADMIN_PASSWORD (อย่างน้อย 8 ตัวอักษร) ใน apps/api/.env ก่อน');
  }
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`มีผู้ใช้ ${username} อยู่แล้ว ไม่สร้างซ้ำ`);
  } else {
    await prisma.user.create({
      data: {
        username,
        displayName: 'ผู้ดูแลระบบ',
        passwordHash: await hashPassword(password),
        roleCode: 'ADMIN',
        permissions: ALL_PERMISSIONS,
        allWarehouses: true,
      },
    });
    console.log(`สร้างผู้ดูแล ${username} แล้ว`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
