import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { PublicUser } from '@shared/types';
import { api, setUnauthorizedHandler } from '../lib/api';

interface AuthApi {
  user: PublicUser | null;
  /** True until the initial `/auth/me` probe settles. */
  loading: boolean;
  login: (username: string, password: string) => Promise<{ defaultPassword: boolean }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<{ user: PublicUser | null }>('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A 401 on any non-probe endpoint means our session is gone (expired cookie,
  // or revoked by a password change elsewhere). Clear the cached user and send
  // admin users back to login, instead of leaving a half-broken dashboard.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      if (typeof window === 'undefined') return;
      const { pathname, search } = window.location;
      if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
        window.location.assign(`/admin/login?from=${encodeURIComponent(pathname + search)}`);
      }
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await api.post<{
      id: number;
      username: string;
      displayName: string | null;
      role: PublicUser['role'];
      defaultPassword?: boolean;
    }>('/auth/login', { username, password });
    setUser({
      id: data.id,
      username: data.username,
      display_name: data.displayName,
      role: data.role,
      created_at: '',
    });
    return { defaultPassword: data.defaultPassword === true };
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthApi>(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
