import axios, { AxiosHeaders, } from 'axios';
import { getAuthToken, setAuthToken } from './auth-store';
const baseURL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
export const API_BASE_URL = baseURL;
const api = axios.create({
    baseURL,
    withCredentials: true,
});
let csrfToken = null;
let csrfPromise = null;
let refreshPromise = null;
const CSRF_HEADER = 'X-CSRF-Token';
const CSRF_SAFE_METHODS = new Set(['get', 'head', 'options', 'trace']);
function needsCsrf(method) {
    if (!method)
        return false;
    return !CSRF_SAFE_METHODS.has(method.toLowerCase());
}
async function fetchCsrfToken() {
    try {
        const res = await api.get('/csrf/token');
        csrfToken = res.data?.token ?? null;
        return csrfToken;
    }
    catch {
        csrfToken = null;
        return null;
    }
}
export async function ensureCsrfToken(force = false) {
    if (csrfToken && !force)
        return csrfToken;
    if (!csrfPromise) {
        csrfPromise = fetchCsrfToken().finally(() => {
            csrfPromise = null;
        });
    }
    return csrfPromise;
}
async function refreshAccessToken() {
    if (refreshPromise)
        return refreshPromise;
    refreshPromise = (async () => {
        try {
            const response = await api.post('/auth/refresh');
            const nextToken = response.data?.accessToken ?? null;
            setAuthToken(nextToken);
            return nextToken;
        }
        catch {
            setAuthToken(null);
            return null;
        }
        finally {
            refreshPromise = null;
        }
    })();
    return refreshPromise;
}
api.interceptors.request.use(async (config) => {
    const method = config.method;
    if (needsCsrf(method) && !csrfToken) {
        await ensureCsrfToken();
    }
    if (needsCsrf(method) && csrfToken) {
        // Use AxiosHeaders helper so we don't assign a raw object to the
        // axios headers type (which may be AxiosHeaders in newer axios types).
        config.headers = new AxiosHeaders(config.headers).set(CSRF_HEADER, csrfToken);
    }
    const token = getAuthToken();
    if (token) {
        config.headers = new AxiosHeaders(config.headers).set('Authorization', `Bearer ${token}`);
    }
    return config;
});
api.interceptors.response.use((response) => response, async (error) => {
    const { response, config } = error;
    if (!response || !config) {
        return Promise.reject(error);
    }
    const mutableConfig = config;
    if (response.status === 401 && !mutableConfig._retry) {
        mutableConfig._retry = true;
        try {
            const newToken = await refreshAccessToken();
            if (newToken) {
                mutableConfig.headers = new AxiosHeaders(mutableConfig.headers).set('Authorization', `Bearer ${newToken}`);
                return api(mutableConfig);
            }
        }
        catch {
            /* ignore */
        }
    }
    if (response.status === 403 && needsCsrf(config.method)) {
        await ensureCsrfToken(true);
    }
    return Promise.reject(error);
});
export function toApiError(error) {
    if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status;
        const message = error.response?.data?.message ??
            error.message ??
            'Unexpected error';
        return { statusCode, message };
    }
    return { message: error?.message ?? 'Unexpected error' };
}
export { api };
