-- CreateTable
CREATE TABLE "PickCheck" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "pickerName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "checkedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickCheckLine" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "orderLineNo" INTEGER,
    "sku" TEXT NOT NULL DEFAULT '',
    "itemCode" TEXT NOT NULL DEFAULT '',
    "packCode" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "expectedQty" DECIMAL(14,3) NOT NULL,
    "actualQty" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "PickCheckLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PickCheck_requestId_key" ON "PickCheck"("requestId");

-- CreateIndex
CREATE INDEX "PickCheck_orderId_createdAt_idx" ON "PickCheck"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PickCheckLine_checkId_lineNo_key" ON "PickCheckLine"("checkId", "lineNo");

-- AddForeignKey
ALTER TABLE "PickCheck" ADD CONSTRAINT "PickCheck_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickCheckLine" ADD CONSTRAINT "PickCheckLine_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "PickCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- สิทธิ์ใหม่ picks.check: ให้ผู้ดูแลและผู้จัดการที่มีอยู่แล้ว (ตำแหน่งเหล่านี้ได้ทุกสิทธิ์อยู่แล้วตาม ROLE_DEFAULTS)
UPDATE "User" SET "permissions" = array_append("permissions", 'picks.check')
WHERE "roleCode" IN ('ADMIN', 'MANAGER') AND NOT ('picks.check' = ANY("permissions"));
