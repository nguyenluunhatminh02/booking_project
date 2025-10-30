import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, } from 'react';
import { api, ensureCsrfToken, toApiError } from '@/lib/api';
import { setAuthToken, subscribeAuthToken } from '@/lib/auth-store';
const AuthContext = createContext(undefined);
const AUTH_STORAGE_KEY = 'booking:accessToken';
const DEVICE_STORAGE_KEY = 'booking:deviceId';
function decodeJwt(token) {
    try {
        const [, payload] = token.split('.');
        if (!payload)
            return null;
        const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
        return JSON.parse(decoded);
    }
    catch {
        return null;
    }
}
function getOrCreateDeviceId() {
    if (typeof window === 'undefined')
        return undefined;
    const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (existing)
        return existing;
    const next = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_STORAGE_KEY, next);
    return next;
}
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [accessToken, setAccessToken] = useState(null);
    const [isBootstrapped, setIsBootstrapped] = useState(false);
    const pendingEmailRef = useRef();
    useEffect(() => {
        const unsubscribe = subscribeAuthToken((token) => {
            setAccessToken(token);
            if (typeof window !== 'undefined') {
                if (token) {
                    window.localStorage.setItem(AUTH_STORAGE_KEY, token);
                }
                else {
                    window.localStorage.removeItem(AUTH_STORAGE_KEY);
                }
            }
            if (token) {
                const decoded = decodeJwt(token);
                const email = decoded?.email ?? pendingEmailRef.current ?? undefined;
                if (decoded?.sub) {
                    setUser({ id: decoded.sub, email });
                }
                else {
                    setUser(null);
                }
            }
            else {
                setUser(null);
            }
            pendingEmailRef.current = undefined;
            setIsBootstrapped(true);
        });
        const stored = typeof window !== 'undefined'
            ? window.localStorage.getItem(AUTH_STORAGE_KEY)
            : null;
        if (stored) {
            setAuthToken(stored);
        }
        else {
            setAuthToken(null);
        }
        ensureCsrfToken().catch(() => undefined);
        return () => unsubscribe();
    }, []);
    const login = useCallback(async (email, password) => {
        pendingEmailRef.current = email;
        try {
            await ensureCsrfToken();
            const deviceId = getOrCreateDeviceId();
            const { data } = await api.post('/auth/login', {
                email,
                password,
                deviceId,
            });
            setAuthToken(data.accessToken);
        }
        catch (error) {
            pendingEmailRef.current = undefined;
            throw toApiError(error);
        }
    }, []);
    const register = useCallback(async (email, password) => {
        pendingEmailRef.current = email;
        try {
            await ensureCsrfToken();
            const { data } = await api.post('/auth/register', {
                email,
                password,
            });
            pendingEmailRef.current = data.user?.email ?? email;
            setAuthToken(data.accessToken);
        }
        catch (error) {
            pendingEmailRef.current = undefined;
            throw toApiError(error);
        }
    }, []);
    const logout = useCallback(async () => {
        try {
            await api.post('/auth/logout');
        }
        finally {
            setAuthToken(null);
        }
    }, []);
    const value = useMemo(() => ({
        user,
        accessToken,
        isLoading: !isBootstrapped,
        login,
        register,
        logout,
    }), [user, accessToken, isBootstrapped, login, register, logout]);
    return _jsx(AuthContext.Provider, { value: value, children: children });
}
export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx)
        throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
