import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { AlertCircleIcon, XIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface Props {
  onResult: (code: string) => void;
  onClose: () => void;
}

/** เปิดกล้องหลังของมือถือแล้วอ่านบาร์โค้ด/QR (EAN-13, Code128, QR ฯลฯ) */
export function CameraScanner({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;
  const [error, setError] = useState('');

  useEffect(() => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('ใช้กล้องไม่ได้ เพราะเว็บนี้ไม่ได้เปิดผ่าน https:// ใช้หัวสแกนหรือพิมพ์รหัสแทน');
      return;
    }
    const reader = new BrowserMultiFormatReader();
    let controls: IScannerControls | undefined;
    let cancelled = false;
    let done = false;
    reader
      .decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, videoRef.current!, (result, _err, c) => {
        if (result && !done) {
          done = true;
          c.stop();
          navigator.vibrate?.(80);
          resultRef.current(result.getText());
        }
      })
      .then((c) => {
        controls = c;
        if (cancelled) c.stop();
      })
      .catch((e: unknown) => {
        const name = e instanceof DOMException ? e.name : '';
        setError(name === 'NotAllowedError' ? 'เบราว์เซอร์ไม่อนุญาตให้ใช้กล้อง เปิดสิทธิ์กล้องในการตั้งค่าเบราว์เซอร์แล้วลองใหม่' : 'เปิดกล้องไม่ได้ ปิดแอปอื่นที่ใช้กล้องอยู่แล้วลองใหม่ หรือพิมพ์รหัสแทน');
      });
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label="สแกนด้วยกล้อง">
      <div className="relative flex w-full max-w-md flex-col gap-3">
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertCircleIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <video ref={videoRef} className="aspect-[3/4] w-full rounded-xl bg-black object-cover" muted playsInline />
        )}
        {/* กรอบช่วยเล็งบาร์โค้ด */}
        {!error && (
          <div className="pointer-events-none absolute inset-x-[10%] top-[30%] h-[22%] rounded-xl border-[3px] border-star" aria-hidden="true" />
        )}
        <Button variant="secondary" size="touch" className="w-full" onClick={onClose}>
          <XIcon />
          ปิดกล้อง
        </Button>
      </div>
    </div>
  );
}
