-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "customerCode" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "Product_customerCode_idx" ON "Product"("customerCode");
