import { lazy, Suspense, useState } from 'react';
import { CameraIcon } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';

// ไลบรารีอ่านบาร์โค้ดใหญ่ ~500 KB โหลดเฉพาะตอนกดปุ่มกล้อง (ตัวเดียวกับ ScanInput)
const CameraScanner = lazy(() => import('./CameraScanner').then((m) => ({ default: m.CameraScanner })));

/**
 * ปุ่มกล้องสแกนบาร์โค้ด/QR สำหรับช่องกรอกธรรมดา (ช่องค้นสินค้า ช่องรหัส) ที่ไม่ได้ใช้เวทีสแกน ScanInput
 * อ่านได้แล้วส่งรหัสให้ onResult เหมือนสแกนด้วย Handheld แล้วกด Enter
 */
export function CameraButton({ label, onResult, onClose, disabled, className }: {
  label: string; onResult: (code: string) => void; onClose?: () => void; disabled?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="icon-touch" className={cn('bg-star text-on-star hover:bg-star/90', className)} disabled={disabled} onClick={() => setOpen(true)} aria-label={label} title={label}>
        <CameraIcon />
      </Button>
      {open && (
        <Suspense fallback={<div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4 text-white">กำลังเปิดกล้อง…</div>}>
          <CameraScanner
            onResult={(code) => { setOpen(false); onResult(code.trim()); }}
            onClose={() => { setOpen(false); onClose?.(); }}
          />
        </Suspense>
      )}
    </>
  );
}
