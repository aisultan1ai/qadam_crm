import axios, { AxiosError, AxiosRequestConfig } from "axios";

export const API_URL = (import.meta.env.VITE_API_URL as string) || "http://localhost:8000";

export type ApiErrorDetail = { field: string; message: string; type?: string };
export type ApiError = { code: string; message: string; details?: ApiErrorDetail[] };

export function extractApiError(err: unknown): ApiError {
  const anyErr = err as AxiosError<any>;
  const body = anyErr?.response?.data;
  if (body && typeof body === "object" && body.error) {
    return body.error as ApiError;
  }
  if (body && typeof body === "object" && body.detail) {
    const d = body.detail;
    if (typeof d === "string") return { code: "http_error", message: d };
    if (Array.isArray(d)) return { code: "http_error", message: d.map((x: any) => x?.msg || String(x)).join("; ") };
  }
  const status = anyErr?.response?.status;
  return { code: "network_error", message: anyErr?.message || `Ошибка (${status ?? "?"})` };
}

export function fieldErrorsFrom(err: unknown): Record<string, string> {
  const api = extractApiError(err);
  const out: Record<string, string> = {};
  for (const d of api.details ?? []) {
    if (d.field && d.message) out[d.field] = d.message;
  }
  return out;
}

const ACCESS_KEY = "token";
const REFRESH_KEY = "refresh_token";

export const api = axios.create({ baseURL: API_URL });

export function setTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

api.interceptors.request.use((cfg) => {
  const token = getAccessToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  try {
    const { data } = await axios.post(`${API_URL}/api/auth/refresh`, { refresh_token: refresh });
    setTokens(data.access_token, data.refresh_token);
    return data.access_token as string;
  } catch {
    clearTokens();
    return null;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    const original = err.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    const status = err.response?.status;
    const url = original?.url || "";

    // не пытаемся рефрешить сам /auth/refresh или /auth/login
    if (
      status === 401 &&
      original &&
      !original._retry &&
      !url.includes("/api/auth/refresh") &&
      !url.includes("/api/auth/login")
    ) {
      original._retry = true;
      refreshInFlight = refreshInFlight ?? refreshAccessToken();
      const newToken = await refreshInFlight;
      refreshInFlight = null;

      if (newToken) {
        original.headers = { ...(original.headers || {}), Authorization: `Bearer ${newToken}` };
        return api.request(original);
      }
      // не удалось обновить — на логин
      if (!location.pathname.startsWith("/login")) location.replace("/login");
    }

    if (status === 401) {
      clearTokens();
      if (!location.pathname.startsWith("/login")) location.replace("/login");
    }

    return Promise.reject(err);
  },
);
