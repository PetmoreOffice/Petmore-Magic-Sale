import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { AlertCircleIcon, XIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from 'radix-ui';

interface Props {
  onResult: (code: string) => void;
  onClose: () => void;
}

/** เปิดกล้องหลังของมือถือแล้วอ่านบาร์โค้ด/QR (EAN-13, Code128, QR ฯลฯ) */
export function CameraScanner({ onResult, onClose }: Props) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;
  const [error, setError] = useState('');

  useEffect(() => {
    if (!video) return;
    if (!window.isSecureContext) {
      setError('ใช้กล้องไม่ได้ เพราะเว็บนี้ไม่ได้เปิดผ่าน https:// ใช้หัวสแกนหรือพิมพ์รหัสแทน');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง ใช้หัวสแกนหรือพิมพ์รหัสแทน');
      return;
    }
    const reader = new BrowserMultiFormatReader();
    let controls: IScannerControls | undefined;
    let cancelled = false;
    let done = false;
    reader
      .decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video, (result, _err, c) => {
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
        setError(name === 'NotAllowedError' ? 'เบราว์เซอร์ไม่อนุญาตให้ใช้กล้อง เปิดสิทธิ์กล้องในการตั้งค่าเบราว์เซอร์แล้วลองใหม่' : name === 'NotFoundError' ? 'ไม่พบกล้องบนอุปกรณ์นี้ ใช้หัวสแกนหรือพิมพ์รหัสแทน' : 'เปิดกล้องไม่ได้ ปิดแอปอื่นที่ใช้กล้องอยู่แล้วลองใหม่ หรือพิมพ์รหัสแทน');
      });
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [video]);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-brand/90" />
      <Dialog.Content aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus(); }} className="fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-xl bg-card p-4 shadow-stage">
        <Dialog.Title className="font-heading text-lg font-semibold">สแกนด้วยกล้อง</Dialog.Title>
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertCircleIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <video ref={setVideo} className="aspect-[3/4] w-full rounded-xl bg-black object-cover" muted playsInline />
        )}
        {/* กรอบช่วยเล็งบาร์โค้ด */}
        {!error && (
          <div className="pointer-events-none absolute inset-x-[10%] top-[30%] h-[22%] rounded-xl border-[3px] border-star" aria-hidden="true" />
        )}
        <Button variant="secondary" size="touch" className="w-full" onClick={onClose}>
          <XIcon />
          ปิดกล้อง
        </Button>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
