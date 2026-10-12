-- ขนาดอื่นที่ให้แทนขนาดในออเดอร์ (สั่งเป็นลังแต่ให้เป็นโหล/ชิ้น) เทียบกันเป็นชิ้น
ALTER TABLE "PickCheckLine" ADD COLUMN "parts" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "PickCheckLine" ADD COLUMN "unitPieces" DECIMAL(14,3);
ALTER TABLE "PickCheckLine" ADD COLUMN "actualPieces" DECIMAL(14,3);
ALTER TABLE "ReturnLine" ADD COLUMN "inPieces" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PickCheckLine" ADD COLUMN "manualReason" TEXT NOT NULL DEFAULT '';
