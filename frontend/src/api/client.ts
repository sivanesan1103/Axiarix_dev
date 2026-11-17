import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface Page<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number; [k: string]: unknown };
}

/**
 * The access token lives only in memory (never localStorage). The refresh token is an
 * HTTP-only cookie scoped to /api/v1/auth, so page scripts can never read it.
 */
let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => {
    accessToken = t;
  },
  onExpired: (fn: () => void) => {
    onSessionExpired = fn;
  },
};

export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: { 'X-Requested-With': 'axiarix' },
  timeout: 60_000,
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

const RETRY_DELAYS_MS = [500, 1000, 2000, 3500];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Single-flight refresh so parallel 401s trigger one rotation only.
 * Only a definite answer from the API (401/403: no valid session) signs the user out. A transient
 * failure (server restarting, network blip, 502/503/504 from the proxy) is retried with back-off,
 * so a brief outage during page load no longer sends a signed-in user back to the sign-in page.
 */
export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await axios.post<{ data: { accessToken: string } }>('/api/v1/auth/refresh', null, { withCredentials: true, headers: { 'X-Requested-With': 'axiarix' } });
        accessToken = r.data.data.accessToken;
        return accessToken;
      } catch (e) {
        const status = axios.isAxiosError(e) ? e.response?.status : undefined;
        const transient = status === undefined || status >= 500;
        if (!transient || attempt >= RETRY_DELAYS_MS.length) {
          accessToken = null;
          return null;
        }
        await wait(RETRY_DELAYS_MS.at(attempt)!);
      }
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const code = error.response?.data?.error?.code;
    if (error.response?.status === 401 && original && !original._retry && !original.url?.startsWith('/auth/')) {
      original._retry = true;
      if (code === 'TOKEN_EXPIRED' || code === 'UNAUTHORIZED') {
        const token = await refreshAccessToken();
        if (token) {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        }
        onSessionExpired?.();
      }
    }
    // The server now requires MFA set-up for this account: let the app re-read the profile and show the set-up screen.
    if (error.response?.status === 403 && code === 'MFA_ENROLMENT_REQUIRED') window.dispatchEvent(new Event('axiarix:mfa-required'));
    return Promise.reject(error);
  },
);

/** Human-readable message from any API error. */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as ApiErrorBody | undefined;
    if (body?.error?.message) return body.error.message;
    if (err.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
    if (!err.response) return 'Cannot reach the server. Check your connection.';
  }
  return err instanceof Error ? err.message : fallback;
}

export function errorDetails<T = unknown>(err: unknown): T | undefined {
  if (axios.isAxiosError(err)) return (err.response?.data as ApiErrorBody | undefined)?.error?.details as T | undefined;
  return undefined;
}

export async function get<T>(url: string, config?: AxiosRequestConfig) {
  const params = config?.params ? clean(config.params as Record<string, unknown>) : undefined;
  return (await api.get<{ data: T }>(url, { ...config, params })).data.data;
}
export async function getPage<T>(url: string, params?: Record<string, unknown>) {
  return (await api.get<Page<T>>(url, { params: clean(params) })).data;
}
export async function post<T>(url: string, body?: unknown, config?: AxiosRequestConfig) {
  return (await api.post<{ data: T }>(url, body, config)).data.data;
}
export async function put<T>(url: string, body?: unknown) {
  return (await api.put<{ data: T }>(url, body)).data.data;
}
export async function patch<T>(url: string, body?: unknown) {
  return (await api.patch<{ data: T }>(url, body)).data.data;
}
export async function del<T>(url: string) {
  return (await api.delete<{ data: T }>(url)).data.data;
}

/** Drops empty filter values so query strings stay clean. */
export function clean(params?: Record<string, unknown>) {
  if (!params) return undefined;
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

/** Downloads an authenticated binary endpoint (exports) and saves it with the server-provided filename. */
export async function downloadFile(url: string, params?: Record<string, unknown>, fallbackName = 'download') {
  const res = await api.get<Blob>(url, { params: clean(params), responseType: 'blob' });
  const cd = res.headers['content-disposition'] as string | undefined;
  const name = cd?.match(/filename="?([^"]+)"?/)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Opens a short-lived signed download URL issued by the API. */
export function openSignedUrl(url: string, inline = false) {
  if (inline) window.open(url, '_blank', 'noopener');
  else {
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    a.click();
  }
}
