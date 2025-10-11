import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { api, ensureCsrfToken, toApiError } from '@/lib/api';
import { setAuthToken, subscribeAuthToken } from '@/lib/auth-store';

type AuthUser = {
  id: string;
  email?: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AUTH_STORAGE_KEY = 'booking:accessToken';
const DEVICE_STORAGE_KEY = 'booking:deviceId';

function decodeJwt(token: string): Record<string, any> | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function getOrCreateDeviceId() {
  if (typeof window === 'undefined') return undefined;
  const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
  if (existing) return existing;
  const next = crypto.randomUUID();
  window.localStorage.setItem(DEVICE_STORAGE_KEY, next);
  return next;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const pendingEmailRef = useRef<string | undefined>();

  useEffect(() => {
    const unsubscribe = subscribeAuthToken((token) => {
      setAccessToken(token);
      if (typeof window !== 'undefined') {
        if (token) {
          window.localStorage.setItem(AUTH_STORAGE_KEY, token);
        } else {
          window.localStorage.removeItem(AUTH_STORAGE_KEY);
        }
      }

      if (token) {
        const decoded = decodeJwt(token);
        const email = decoded?.email ?? pendingEmailRef.current ?? undefined;
        if (decoded?.sub) {
          setUser({ id: decoded.sub, email });
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
      }
      pendingEmailRef.current = undefined;
      setIsBootstrapped(true);
    });

    const stored =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(AUTH_STORAGE_KEY)
        : null;
    if (stored) {
      setAuthToken(stored);
    } else {
      setAuthToken(null);
    }

    ensureCsrfToken().catch(() => undefined);

    return () => unsubscribe();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    pendingEmailRef.current = email;
    try {
      await ensureCsrfToken();
      const deviceId = getOrCreateDeviceId();
      const { data } = await api.post<{
        accessToken: string;
        accessTokenExpiresIn: number;
        accessTokenExpSec: number;
      }>('/auth/login', {
        email,
        password,
        deviceId,
      });
      setAuthToken(data.accessToken);
    } catch (error) {
      pendingEmailRef.current = undefined;
      throw toApiError(error);
    }
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    pendingEmailRef.current = email;
    try {
      await ensureCsrfToken();
      const { data } = await api.post<{
        user: { id: string; email: string };
        accessToken: string;
      }>('/auth/register', {
        email,
        password,
      });
      pendingEmailRef.current = data.user?.email ?? email;
      setAuthToken(data.accessToken);
    } catch (error) {
      pendingEmailRef.current = undefined;
      throw toApiError(error);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAuthToken(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accessToken,
      isLoading: !isBootstrapped,
      login,
      register,
      logout,
    }),
    [user, accessToken, isBootstrapped, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
