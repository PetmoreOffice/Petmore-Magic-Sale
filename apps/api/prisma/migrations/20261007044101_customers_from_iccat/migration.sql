-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "customerCode" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "Customer" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "companySyncedAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("code")
);
