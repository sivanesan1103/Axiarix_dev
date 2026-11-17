import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { refreshAccessToken, tokenStore } from '@/api/client';
import { authService } from '@/services/auth.service';
import { setDisplayTimeZone } from '@/lib/utils';
import type { RoleKey, SessionUser } from '@/types/api';

interface AuthState {
  user: SessionUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  login: (email: string, password: string, mfaCode?: string) => Promise<{ mfaRequired: boolean; mfaEnrolmentRequired?: boolean }>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  can: (...permissions: string[]) => boolean;
  hasRole: (...roles: RoleKey[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');

  const reload = useCallback(async () => {
    const me = await authService.me();
    setDisplayTimeZone(me.timeZone);
    setUser(me);
    setStatus('authenticated');
  }, []);

  // Restore the session from the HTTP-only refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await refreshAccessToken();
      if (cancelled) return;
      if (!token) return setStatus('anonymous');
      try {
        await reload();
      } catch {
        setStatus('anonymous');
      }
    })();
    tokenStore.onExpired(() => {
      setUser(null);
      setStatus('anonymous');
      qc.clear();
    });
    return () => {
      cancelled = true;
    };
  }, [reload, qc]);

  // Roles, scope and restrictions can be changed by an administrator at any time. The server applies a
  // change immediately; re-reading the profile every minute and when the tab regains focus keeps the
  // menus and buttons in step, so nobody keeps seeing pages they lost or misses ones they gained.
  useEffect(() => {
    if (status !== 'authenticated') return;
    // /auth/me is not retried by the API client's 401 handler, so renew the access token here first
    // when it has expired, then read the profile again.
    const refresh = () => {
      authService
        .me()
        .catch(async () => ((await refreshAccessToken()) ? authService.me() : Promise.reject(new Error('signed out'))))
        .then((me) => {
          setDisplayTimeZone(me.timeZone);
          setUser(me);
        })
        .catch(() => undefined);
    };
    const t = setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', refresh);
    };
  }, [status]);

  const login = useCallback(async (email: string, password: string, mfaCode?: string) => {
    const r = await authService.login(email, password, mfaCode);
    if (r.mfaRequired || !r.user) return { mfaRequired: true };
    setDisplayTimeZone(r.user.timeZone);
    setUser(r.user);
    setStatus('authenticated');
    return { mfaRequired: false, mfaEnrolmentRequired: r.mfaEnrolmentRequired };
  }, []);

  const logout = useCallback(async () => {
    await authService.logout().catch(() => undefined);
    setUser(null);
    setStatus('anonymous');
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      status,
      login,
      logout,
      reload,
      can: (...perms) => !!user && perms.some((p) => user.permissions.includes(p)),
      hasRole: (...roles) => !!user && user.roles.some((r) => roles.includes(r)),
    }),
    [user, status, login, logout, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
