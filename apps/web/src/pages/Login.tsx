import { FormEvent, useState } from 'react';
import { AlertCircleIcon, PawPrintIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MagicSky } from '@/components/MagicSky';
import { touchInput } from '@/lib/touch';
import { useAuth } from '../auth';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    // .login ให้ดาวนิ่งจาก CSS เป็นพื้นหลังสำรอง ถ้าเครื่องไม่ได้แสดงท้องฟ้าเคลื่อนไหว
    <div className="login relative isolate">
      <MagicSky className="-z-10" />
      <div className="flex w-full max-w-sm flex-col items-center gap-2">
        {/* โลโก้ลอยเหนือท้องฟ้า เป็นหัวข้อหลักของหน้า (alt คือชื่อแอป) */}
        <h1 className="w-full max-w-72">
          <img
            src="/brand/logo.png"
            alt="Petmore Magic Sale"
            width={720}
            height={555}
            className="h-auto w-full animate-[magic-float_6s_ease-in-out_infinite] drop-shadow-[0_10px_18px_rgba(0,0,0,0.45)]"
          />
        </h1>
      <Card className="w-full gap-5 py-6 shadow-2xl shadow-black/40 [--card-spacing:--spacing(6)]">
        <CardHeader className="gap-2">
          <CardTitle role="heading" aria-level={2} className="text-2xl leading-tight font-semibold">
            เข้าสู่ระบบ
          </CardTitle>
          <CardDescription className="flex items-center gap-1.5">
            <PawPrintIcon className="size-4 shrink-0 text-kibble" aria-hidden="true" />
            ระบบคลังสินค้าและงานขายหน้างาน
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-1.5">
              <Label htmlFor="username">ชื่อผู้ใช้</Label>
              <Input
                id="username"
                className={touchInput}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="off"
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">รหัสผ่าน</Label>
              <Input
                id="password"
                className={touchInput}
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {/* ทั้งแถวเป็นพื้นที่กด สูง 48px ตามกฎปุ่มงานคลัง */}
            <Label className="-my-1 min-h-12 cursor-pointer gap-3 font-normal text-muted-foreground">
              <input type="checkbox" className="size-5 accent-primary" checked={show} onChange={(e) => setShow(e.target.checked)} />
              แสดงรหัสผ่าน
            </Label>
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertCircleIcon />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" size="touch" className="w-full" disabled={busy}>
              {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">เข้าสู่ระบบครั้งเดียว ใช้งานได้ 12 ชั่วโมง</p>
          </form>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
