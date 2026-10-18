-- ขั้นจัดสินค้า (คนจัดสินค้ารับออเดอร์จากคิว หยิบของ แล้วส่งให้แอดมินตรวจ)
ALTER TABLE "SalesOrder" ADD COLUMN "prepStatus" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "prepById" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "prepByName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "prepStartedAt" TIMESTAMP(3),
  ADD COLUMN "prepDoneAt" TIMESTAMP(3),
  ADD COLUMN "prepPicked" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX "SalesOrder_prepStatus_createdAt_idx" ON "SalesOrder"("prepStatus", "createdAt");

-- สิทธิ์ใหม่ picks.prepare: ให้ผู้ดูแลระบบที่มีอยู่แล้ว
UPDATE "User" SET "permissions" = array_append("permissions", 'picks.prepare')
WHERE "roleCode" = 'ADMIN' AND NOT ('picks.prepare' = ANY("permissions"));
