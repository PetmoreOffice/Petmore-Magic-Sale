import type { NextFunction, Request, Response } from 'express';

/**
 * IP จริงของผู้ใช้: หลัง Cloudflare Tunnel / Caddy ทุกคำขอมาจากเครื่องเดียวกัน (loopback หรือวง Docker)
 * จึงเชื่อหัว CF-Connecting-IP / X-Forwarded-For เฉพาะเมื่อคำขอมาจากเครื่องในวงภายในเท่านั้น
 * (คนข้างนอกปลอมหัวเหล่านี้เพื่อหลบการจำกัดไม่ได้ เพราะคำขอของเขาต้องผ่าน Cloudflare/Caddy ที่เขียนหัวทับให้)
 */
const PRIVATE = /^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|fc|fd)/i;
export function clientIp(req: Request): string {
  const peer = req.socket.remoteAddress ?? '';
  if (PRIVATE.test(peer)) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return peer || 'unknown';
}

/** ตัวนับแบบหน้าต่างเวลาคงที่ต่อคีย์ (เก็บในหน่วยความจำ API มีโปรเซสเดียว เปิดใหม่แล้วนับใหม่) */
export class WindowCounter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly limit: number, private readonly windowMs: number) {
    // ล้างคีย์ที่หมดเวลาแล้วทุกนาที ไม่ให้หน่วยความจำโตไปเรื่อยๆ
    setInterval(() => {
      const now = Date.now();
      for (const [key, v] of this.hits) if (v.resetAt <= now) this.hits.delete(key);
    }, 60_000).unref();
  }

  /** นับ 1 ครั้ง คืนจำนวนวินาทีที่ต้องรอถ้าเกินเพดาน (0 = ผ่าน) */
  hit(key: string, now = Date.now()): number {
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return 0;
    }
    cur.count += 1;
    return cur.count > this.limit ? Math.ceil((cur.resetAt - now) / 1000) : 0;
  }
}

/**
 * จำกัดจำนวนคำขอต่อ IP กันเครื่องที่ยิงคำขอรัวผิดปกติ
 * - ทั้ง API: 600 ครั้ง/นาที (สแกนรัวๆ ทั้งวันยังไม่ถึง)
 * - เข้าสู่ระบบ: 30 ครั้ง/10 นาที ต่อ IP (งานอีเวนต์ Sup หลายคนใช้ Wi-Fi เดียวกันยังล็อกอินพร้อมกันได้)
 *   การเดารหัสของบัญชีเดียวถูกกันอีกชั้นที่ AuthService (ผิด 5 ครั้งรอ 15 นาที)
 */
const general = new WindowCounter(600, 60_000);
const login = new WindowCounter(30, 10 * 60_000);

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = clientIp(req);
  const isLogin = req.method === 'POST' && req.path.replace(/\/+$/, '').endsWith('/auth/login');
  const wait = Math.max(general.hit(ip), isLogin ? login.hit(ip) : 0);
  if (!wait) return next();
  res.setHeader('Retry-After', String(wait));
  res.status(429).json({
    statusCode: 429,
    message: isLogin
      ? `ลองเข้าสู่ระบบบ่อยเกินไปจากเครือข่ายนี้ รอประมาณ ${Math.ceil(wait / 60)} นาทีแล้วลองใหม่`
      : `ส่งคำขอถี่เกินไป รอ ${wait} วินาทีแล้วลองใหม่`,
  });
}
