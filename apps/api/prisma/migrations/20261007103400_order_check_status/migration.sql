-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "checkStatus" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "SalesOrder_checkStatus_createdAt_idx" ON "SalesOrder"("checkStatus", "createdAt");

-- เติมสถานะจากผลตรวจล่าสุดของออเดอร์เดิม
UPDATE "SalesOrder" o SET "checkStatus" = c.status
FROM (SELECT DISTINCT ON ("orderId") "orderId", status FROM "PickCheck" ORDER BY "orderId", "createdAt" DESC) c
WHERE c."orderId" = o.id;
