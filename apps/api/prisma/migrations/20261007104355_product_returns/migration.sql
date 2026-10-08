-- CreateTable
CREATE TABLE "ProductReturn" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "orderId" TEXT,
    "reason" TEXT NOT NULL,
    "returnerName" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "orderLineNo" INTEGER,
    "sku" TEXT NOT NULL DEFAULT '',
    "itemCode" TEXT NOT NULL DEFAULT '',
    "packCode" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "goodQty" DECIMAL(14,3) NOT NULL,
    "damagedQty" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "ReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductReturn_requestId_key" ON "ProductReturn"("requestId");

-- CreateIndex
CREATE INDEX "ProductReturn_orderId_idx" ON "ProductReturn"("orderId");

-- CreateIndex
CREATE INDEX "ProductReturn_createdAt_idx" ON "ProductReturn"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnLine_returnId_lineNo_key" ON "ReturnLine"("returnId", "lineNo");

-- AddForeignKey
ALTER TABLE "ProductReturn" ADD CONSTRAINT "ProductReturn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ProductReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- สิทธิ์ใหม่ returns.create: ให้ผู้ดูแลและผู้จัดการที่มีอยู่แล้ว
UPDATE "User" SET "permissions" = array_append("permissions", 'returns.create')
WHERE "roleCode" IN ('ADMIN', 'MANAGER') AND NOT ('returns.create' = ANY("permissions"));
