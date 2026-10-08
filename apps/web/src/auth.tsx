import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { LoginResult, Permission, SessionUser } from '@petmore/shared';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';

interface AuthState {
  user: SessionUser | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  has: (...perms: Permission[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    try {
      const r = await api<{ user: SessionUser }>('/auth/session');
      setUser(r.user);
    } catch {
      /* 401 จัดการใน handler ด้านล่าง ส่วนเน็ตหลุดให้ใช้ข้อมูลเดิมต่อ */
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    refresh().finally(() => setReady(true));
    // ตรวจสิทธิ์ใหม่ทุก 60 วินาที และเมื่อกลับมาที่แท็บ (เหมือนระบบเดิม)
    const timer = setInterval(() => !document.hidden && refresh(), 60_000);
    const onVisible = () => !document.hidden && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const login = async (username: string, password: string) => {
    const r = await api<LoginResult>('/auth/login', { method: 'POST', body: { username, password } });
    setToken(r.token);
    setUser(r.user);
  };

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setToken('');
      setUser(null);
    }
  };

  const has = (...perms: Permission[]) => !!user && perms.some((p) => user.permissions.includes(p));

  return <AuthContext.Provider value={{ user, ready, login, logout, has }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth ต้องอยู่ใน AuthProvider');
  return ctx;
}
