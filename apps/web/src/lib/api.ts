import axios, {
  AxiosError,
  InternalAxiosRequestConfig,
  AxiosResponse,
} from 'axios';
import { getAuthToken, setAuthToken } from './auth-store';

const baseURL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
export const API_BASE_URL = baseURL;

type MutableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

const api = axios.create({
  baseURL,
  withCredentials: true,
});

let csrfToken: string | null = null;
let csrfPromise: Promise<string | null> | null = null;
let refreshPromise: Promise<string | null> | null = null;

const CSRF_HEADER = 'X-CSRF-Token';
const CSRF_SAFE_METHODS = new Set(['get', 'head', 'options', 'trace']);

function needsCsrf(method?: string) {
  if (!method) return false;
  return !CSRF_SAFE_METHODS.has(method.toLowerCase());
}

async function fetchCsrfToken(): Promise<string | null> {
  try {
    const res = await api.get<{ token?: string }>('/csrf/token');
    csrfToken = res.data?.token ?? null;
    return csrfToken;
  } catch {
    csrfToken = null;
    return null;
  }
}

export async function ensureCsrfToken(force = false) {
  if (csrfToken && !force) return csrfToken;
  if (!csrfPromise) {
    csrfPromise = fetchCsrfToken().finally(() => {
      csrfPromise = null;
    });
  }
  return csrfPromise;
}

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const response = await api.post<{ accessToken?: string }>(
        '/auth/refresh',
      );
      const nextToken = response.data?.accessToken ?? null;
      setAuthToken(nextToken);
      return nextToken;
    } catch {
      setAuthToken(null);
      return null;
    } finally {
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
    config.headers = {
      ...config.headers,
      [CSRF_HEADER]: csrfToken,
    };
  }

  const token = getAuthToken();
  if (token) {
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${token}`,
    };
  }

  return config;
});

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const { response, config } = error;
    if (!response || !config) {
      return Promise.reject(error);
    }

    const mutableConfig = config as MutableRequestConfig;

    if (response.status === 401 && !mutableConfig._retry) {
      mutableConfig._retry = true;
      try {
        const newToken = await refreshAccessToken();
        if (newToken) {
          mutableConfig.headers = {
            ...mutableConfig.headers,
            Authorization: `Bearer ${newToken}`,
          };
          return api(mutableConfig);
        }
      } catch {
        /* ignore */
      }
    }

    if (response.status === 403 && needsCsrf(config.method)) {
      await ensureCsrfToken(true);
    }

    return Promise.reject(error);
  },
);

export type ApiError = {
  statusCode?: number;
  message: string;
};

export function toApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const statusCode = error.response?.status;
    const message =
      (error.response?.data as { message?: string })?.message ??
      error.message ??
      'Unexpected error';
    return { statusCode, message };
  }
  return { message: (error as Error)?.message ?? 'Unexpected error' };
}

export { api };
