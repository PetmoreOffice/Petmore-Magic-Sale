import { lazy, ReactNode, Suspense, useRef } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, LogOutIcon, MenuIcon, HouseIcon } from 'lucide-react';
import type { Permission } from '@petmore/shared';
import { Button } from '@/components/ui/button';
import { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { APP_MENUS } from '@/lib/menus';
import { useAuth } from './auth';
import { LoginPage } from './pages/Login';
import { MenuPage } from './pages/Menu';
import { ReceivePage } from './pages/Receive';
import { StockPage } from './pages/Stock';
import { MovePage } from './pages/Move';
// หน้าพิมพ์ป้ายมีไลบรารี QR/บาร์โค้ด โหลดแยกเฉพาะตอนเปิดหน้านี้
const LabelsPage = lazy(() => import('./pages/Labels').then((m) => ({ default: m.LabelsPage })));
const OrdersPage = lazy(() => import('./pages/Orders').then((m) => ({ default: m.OrdersPage })));
const CheckPage = lazy(() => import('./pages/Check').then((m) => ({ default: m.CheckPage })));
const ReturnsPage = lazy(() => import('./pages/Returns').then((m) => ({ default: m.ReturnsPage })));
const UsersPage = lazy(() => import('./pages/Users').then((m) => ({ default: m.UsersPage })));
const ExportPage = lazy(() => import('./pages/Export').then((m) => ({ default: m.ExportPage })));

// หน้าดูป้ายทั้งหมดสำหรับนักพัฒนา (import.meta.env.DEV เป็น false ตอน build เว็บจริง โค้ดหน้านี้จึงไม่ถูกรวม)
const DevLabelsPage = import.meta.env.DEV ? lazy(() => import('./pages/DevLabels')) : null;

// wide = หน้าที่ต้องวางสองคอลัมน์บนจอคอม (ออเดอร์) หน้าอื่นคอลัมน์เดียวแคบอ่านง่าย
function Shell({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  const { user, logout, has } = useAuth();
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const menuRef = useRef<HTMLDivElement>(null);
  const home = pathname === '/';
  // ย้อนกลับหน้าก่อนหน้าในแอป ถ้าเปิดหน้านี้ตรงๆ (ลิงก์/รีเฟรช ไม่มีประวัติในแอป) กลับเมนูหลักแทน ไม่หลุดออกจากแอป
  const back = () => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/'));
  return (
    <div className="min-h-screen">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-star focus:p-3 focus:text-on-star">ข้ามไปเนื้อหาหลัก</a>
      <header className="sticky top-0 z-20 print:hidden bg-brand text-brand-foreground pt-[env(safe-area-inset-top,0px)]">
        <div className={`mx-auto flex min-h-16 items-center gap-2 px-4 sm:gap-3 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>
          {/* ปุ่มย้อนกลับทุกหน้า ยกเว้นเมนูหลัก (48px จอแคบเหลือแค่ไอคอน) */}
          {!home && (
            <Button
              variant="ghost"
              size="touch"
              aria-label="ย้อนกลับ"
              className="-ml-2 min-w-12 shrink-0 px-3 text-brand-foreground hover:bg-on-sky/10 hover:text-brand-foreground"
              onClick={back}
            >
              <ArrowLeftIcon />
              <span className="hidden sm:inline">ย้อนกลับ</span>
            </Button>
          )}
          {/* ลิงก์ชื่อแอปพากลับเมนูหลัก ขยายพื้นที่กดให้สูง 48px */}
          <Link
            to="/"
            aria-label="Petmore Magic Sale กลับเมนูหลัก"
            className={`${home ? '-ml-1 inline-flex' : 'hidden sm:inline-flex'} min-h-12 shrink-0 items-center rounded-lg px-1 outline-none focus-visible:ring-3 focus-visible:ring-star/60`}
          >
            <img src="/brand/logo-sm.png" alt="" width={240} height={185} className="h-12 w-auto" />
          </Link>
          {/* ชื่อหน้าเป็นหัวข้อหลักของหน้า โปรแกรมอ่านหน้าจอจะใช้ข้ามไปที่หน้านั้นได้ */}
          <h1 className="min-w-0 flex-1 truncate font-heading text-base font-semibold">{title}</h1>
          <span className="hidden max-w-40 truncate text-sm text-brand-foreground/80 sm:inline">{user?.displayName}</span>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-touch" aria-label="เปิดเมนูงาน" className="text-brand-foreground hover:bg-on-sky/10 hover:text-brand-foreground"><MenuIcon /></Button>
            </SheetTrigger>
            <SheetContent ref={menuRef} side="left" onOpenAutoFocus={(event) => { event.preventDefault(); menuRef.current?.focus(); }} className="overflow-y-auto sm:max-w-sm">
              <SheetHeader className="border-b border-border pb-5">
                <SheetTitle>เมนูงาน</SheetTitle>
                <SheetDescription>เลือกงานที่ต้องการทำ</SheetDescription>
              </SheetHeader>
              <nav aria-label="เมนูหลัก" className="grid gap-6 p-4">
                <SheetClose asChild><Link to="/" aria-current={home ? 'page' : undefined} className="flex min-h-12 items-center gap-3 rounded-lg px-3 font-medium hover:bg-secondary focus-visible:outline-2 focus-visible:outline-primary"><HouseIcon className="size-5" />เมนูหลัก</Link></SheetClose>
                {(['sales', 'warehouse', 'system'] as const).map((group) => {
                  const menus = APP_MENUS.filter((m) => m.group === group && has(...m.perms));
                  if (!menus.length) return null;
                  return <div key={group} className="grid gap-2">
                    <p className="px-3 text-sm text-muted-foreground">{group === 'sales' ? 'งานขายหน้างาน' : group === 'warehouse' ? 'งานคลัง' : 'ตั้งค่าระบบ'}</p>
                    {menus.map((m) => <SheetClose key={m.to} asChild><Link to={m.to} aria-current={pathname === m.to ? 'page' : undefined} className={`flex min-h-12 items-center gap-3 rounded-lg px-3 font-medium focus-visible:outline-2 focus-visible:outline-primary ${pathname === m.to ? 'bg-secondary text-primary' : 'hover:bg-secondary'}`}><m.icon className="size-5" aria-hidden />{m.title}</Link></SheetClose>)}
                  </div>;
                })}
                <Button variant="outline" size="touch" className="sm:hidden" onClick={() => void logout()}><LogOutIcon />ออกจากระบบ</Button>
              </nav>
            </SheetContent>
          </Sheet>
          <Button
            variant="ghost"
            size="touch"
            aria-label="ออกจากระบบ"
            className="-mr-2 hidden min-w-12 shrink-0 px-3 text-brand-foreground hover:bg-on-sky/10 hover:text-brand-foreground sm:inline-flex"
            onClick={() => void logout()}
          >
            <LogOutIcon />
            {/* จอแคบเหลือแค่ไอคอน ให้ชื่อหน้ามีที่พอ */}
            <span className="hidden sm:inline">ออกจากระบบ</span>
          </Button>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className={`mx-auto px-4 ${wide ? 'max-w-6xl' : 'max-w-3xl'} pt-5 sm:pt-8 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] print:max-w-none print:p-0`}>{children}</main>
    </div>
  );
}

function Guard({ perms, title, wide, children }: { perms?: Permission[]; title: string; wide?: boolean; children: ReactNode }) {
  const { user, has } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (perms && !has(...perms)) return <Navigate to="/" replace />;
  return <Shell title={title} wide={wide}>{children}</Shell>;
}

export function App() {
  const { ready, user } = useAuth();
  if (!ready) return <div className="grid min-h-screen place-items-center text-muted-foreground">กำลังตรวจสอบการเข้าสู่ระบบ…</div>;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={<Guard title="เมนูหลัก" wide><MenuPage /></Guard>} />
      <Route path="/orders" element={<Guard title="ออเดอร์สินค้า" wide perms={['orders.view', 'orders.create']}><Suspense fallback={<p role="status">กำลังเปิดหน้าออเดอร์…</p>}><OrdersPage /></Suspense></Guard>} />
      <Route path="/check" element={<Guard title="ตรวจของเบิก" wide perms={['picks.check']}><Suspense fallback={<p role="status">กำลังเปิดหน้าตรวจของเบิก…</p>}><CheckPage /></Suspense></Guard>} />
      <Route path="/returns" element={<Guard title="คืนสินค้า" wide perms={['returns.create']}><Suspense fallback={<p role="status">กำลังเปิดหน้าคืนสินค้า…</p>}><ReturnsPage /></Suspense></Guard>} />
      <Route path="/receive" element={<Guard title="รับสินค้า" perms={['receive.create']}><ReceivePage /></Guard>} />
      <Route path="/stock" element={<Guard title="ดูสต็อก" perms={['stock.view']}><StockPage /></Guard>} />
      <Route path="/move" element={<Guard title="ย้าย Location" perms={['move.create']}><MovePage /></Guard>} />
      <Route path="/labels" element={<Guard title="พิมพ์ป้าย Location" perms={['locations.print']}><Suspense fallback={<p className="text-sm text-muted-foreground">กำลังเปิดหน้าพิมพ์ป้าย…</p>}><LabelsPage /></Suspense></Guard>} />
      <Route path="/users" element={<Guard title="จัดการผู้ใช้" wide perms={['users.view', 'users.manage']}><Suspense fallback={<p role="status">กำลังเปิดหน้าจัดการผู้ใช้…</p>}><UsersPage /></Suspense></Guard>} />
      <Route path="/export" element={<Guard title="ส่งออก Excel" perms={['reports.export']}><Suspense fallback={<p role="status">กำลังเปิดหน้าส่งออก Excel…</p>}><ExportPage /></Suspense></Guard>} />
      {DevLabelsPage && <Route path="/dev/labels" element={<Suspense fallback={null}><DevLabelsPage /></Suspense>} />}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
