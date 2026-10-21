-- ล็อกตรวจของเบิก: คนที่เปิดตรวจออเดอร์อยู่ คนอื่นตรวจทับไม่ได้จนกว่าจะปล่อย/หมดอายุ/รับช่วงต่อ
ALTER TABLE "SalesOrder" ADD COLUMN "checkLockById" TEXT NOT NULL DEFAULT '',
ADD COLUMN "checkLockByName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "checkLockAt" TIMESTAMP(3);
