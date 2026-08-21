import axios, { AxiosError, AxiosRequestConfig } from "axios";

export const API_URL = (import.meta.env.VITE_API_URL as string) || "http://localhost:8000";

export type ApiErrorDetail = { field: string; message: string; type?: string };
export type ApiError = { code: string; message: string; details?: ApiErrorDetail[] };

type ErrorBody = {
  error?: ApiError;
  detail?: string | Array<{ msg?: string }>;
};

export function extractApiError(err: unknown): ApiError {
  const axErr = err as AxiosError<ErrorBody>;
  const body = axErr?.response?.data;
  if (body && typeof body === "object" && body.error) {
    return body.error;
  }
  if (body && typeof body === "object" && body.detail) {
    const d = body.detail;
    if (typeof d === "string") return { code: "http_error", message: d };
    if (Array.isArray(d)) return { code: "http_error", message: d.map((x) => x?.msg || String(x)).join("; ") };
  }
  const status = axErr?.response?.status;
  return { code: "network_error", message: axErr?.message || `Ошибка (${status ?? "?"})` };
}

export function fieldErrorsFrom(err: unknown): Record<string, string> {
  const api = extractApiError(err);
  const out: Record<string, string> = {};
  for (const d of api.details ?? []) {
    if (d.field && d.message) out[d.field] = d.message;
  }
  return out;
}

// httpOnly cookies отправляются автоматически, если withCredentials=true
// и origin такой же (или CORS позволяет credentials).
export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  try {
    // refresh-cookie отправится автоматически (path=/api/auth, httpOnly)
    await axios.post(`${API_URL}/api/auth/refresh`, {}, { withCredentials: true });
    return true;
  } catch {
    return false;
  }
}

// Слушатели для сквозной обработки статусов — Toast/Layout подписываются на них,
// чтобы показать баннер "нет прав" или "нет сети", не тряся весь роутинг.
type ApiEvent = "forbidden" | "network_error";
type ApiEventHandler = (err: AxiosError) => void;
const listeners: Record<ApiEvent, Set<ApiEventHandler>> = {
  forbidden: new Set(),
  network_error: new Set(),
};

export function onApiEvent(event: ApiEvent, handler: ApiEventHandler): () => void {
  listeners[event].add(handler);
  return () => listeners[event].delete(handler);
}

function emit(event: ApiEvent, err: AxiosError) {
  listeners[event].forEach((h) => {
    try { h(err); } catch { /* handler errors ignored */ }
  });
}

api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    const original = err.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    const status = err.response?.status;
    const url = original?.url || "";

    // /api/auth/me — это check-эндпоинт: 401 означает «гость», не форсим редирект.
    // Гость может сидеть на публичном лендинге, вызывающий сам решит, что делать.
    const isMeCheck = url.includes("/api/auth/me");

    // не пытаемся рефрешить сам /auth/refresh или /auth/login
    if (
      status === 401 &&
      original &&
      !original._retry &&
      !url.includes("/api/auth/refresh") &&
      !url.includes("/api/auth/login") &&
      !isMeCheck
    ) {
      original._retry = true;
      refreshInFlight = refreshInFlight ?? refreshAccessToken();
      const ok = await refreshInFlight;
      refreshInFlight = null;

      if (ok) {
        return api.request(original);
      }
      // не удалось обновить — на логин
      if (!location.pathname.startsWith("/login")) location.replace("/login");
    }

    if (status === 401 && !isMeCheck && !location.pathname.startsWith("/login")) {
      location.replace("/login");
    }

    // 403 — не редиректим, показываем toast. Юзер залогинен, но конкретно
    // на эту операцию у него нет прав; пусть остаётся где был.
    if (status === 403) {
      emit("forbidden", err);
    }

    // Сетевая ошибка (нет соединения, DNS, таймаут) — показываем баннер.
    if (!err.response && err.code !== "ERR_CANCELED") {
      emit("network_error", err);
    }

    return Promise.reject(err);
  },
);
