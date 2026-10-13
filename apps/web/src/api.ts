const TOKEN_KEY = 'petmore-wms-token';

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* โหมดส่วนตัว: ต้องเข้าสู่ระบบใหม่เมื่อรีเฟรช */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบการเชื่อมต่อ แล้วลองอีกครั้ง', 0);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('\n') : data?.message;
    if (res.status === 401) {
      setToken('');
      onUnauthorized();
    }
    throw new ApiError(res.status >= 500 ? 'ระบบขัดข้องชั่วคราว ลองอีกครั้ง หากยังไม่สำเร็จให้ติดต่อผู้ดูแลระบบ' : msg || `ทำรายการไม่สำเร็จ (${res.status}) ลองอีกครั้ง หรือติดต่อผู้ดูแลระบบ`, res.status);
  }
  return data as T;
}

/**
 * ดาวน์โหลดไฟล์จาก API (เช่น Excel) ด้วย token ของผู้ใช้ แล้วให้เบราว์เซอร์บันทึกไฟล์ คืนชื่อไฟล์ที่บันทึก
 * ใช้ fetch + blob เพราะลิงก์ธรรมดาส่งหัว Authorization ไม่ได้
 */
export async function downloadFile(path: string, fallbackName: string): Promise<string> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch('/api' + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบการเชื่อมต่อ แล้วลองอีกครั้ง', 0);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401) {
      setToken('');
      onUnauthorized();
    }
    throw new ApiError(res.status >= 500 ? 'ระบบขัดข้องชั่วคราว ลองอีกครั้ง หากยังไม่สำเร็จให้ติดต่อผู้ดูแลระบบ' : data?.message || `ดาวน์โหลดไม่สำเร็จ (${res.status}) ลองอีกครั้ง`, res.status);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // ให้เบราว์เซอร์เริ่มบันทึกก่อนคืนหน่วยความจำ
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

/**
 * requestId กันกดบันทึกซ้ำ ใช้ getRandomValues แทน crypto.randomUUID
 * เพราะ randomUUID ใช้ไม่ได้บน http ธรรมดา (Handheld ที่เข้าผ่าน IP ในวง LAN)
 */
export function newRequestId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function todayIso(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
}
