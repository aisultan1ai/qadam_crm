import axios, { AxiosError, AxiosRequestConfig } from "axios";

// VITE_API_URL="/" (один домен через nginx) → пустая строка: иначе `${API_URL}/api/...` даёт «//api/...»,
// а браузер читает это как адрес другого сайта (ломались аватары, обновление сессии, вложения, веб-сокет).
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8000").replace(/\/+$/, "");

export type ApiErrorDetail = { field: string; message: string; type?: string };
export type ApiError = { code: string; message: string; details?: ApiErrorDetail[] };

type ErrorBody = {
  error?: ApiError;
  detail?: string | Array<{ msg?: string }>;
};

const STATUS_TEXT: Record<number, string> = {
  400: "Не удалось выполнить действие: проверьте введённые данные",
  401: "Сессия истекла — войдите снова",
  403: "Недостаточно прав для этого действия",
  404: "Не найдено — возможно, это уже удалили",
  409: "Данные изменились или уже существуют — обновите страницу и повторите",
  413: "Файл слишком большой",
  422: "Проверьте введённые данные",
  429: "Слишком много запросов — подождите минуту и повторите",
  500: "Внутренняя ошибка сервера. Попробуйте ещё раз, а если повторится — сообщите в поддержку",
  502: "Сервис временно недоступен. Попробуйте через минуту",
  503: "Сервис временно недоступен. Попробуйте через минуту",
  504: "Сервер не ответил вовремя. Попробуйте ещё раз",
};

const HAS_CYRILLIC = /[А-Яа-яЁё]/;

/** Пользователю — только русский текст: «Network Error», «Request failed with status code 502» и HTML от прокси сюда не попадают. */
function friendly(message: string | undefined, status: number | undefined): string {
  if (message && HAS_CYRILLIC.test(message)) return message;
  if (status && STATUS_TEXT[status]) return STATUS_TEXT[status];
  if (status && status >= 500) return STATUS_TEXT[500];
  if (status) return "Не удалось выполнить действие. Попробуйте ещё раз";
  return "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз";
}

export function extractApiError(err: unknown): ApiError {
  const axErr = err as AxiosError<ErrorBody>;
  const status = axErr?.response?.status;
  const body = axErr?.response?.data;
  if (body && typeof body === "object" && body.error) {
    return { ...body.error, message: friendly(body.error.message, status) };
  }
  if (body && typeof body === "object" && body.detail) {
    const d = body.detail;
    if (typeof d === "string") return { code: "http_error", message: friendly(d, status) };
    if (Array.isArray(d)) return { code: "http_error", message: friendly(d.map((x) => x?.msg || String(x)).join("; "), status) };
  }
  // Ошибка не от сервера (например, throw new Error("Выберите слот")) — оставляем, если уже по-русски.
  if (!axErr?.isAxiosError && err instanceof Error && HAS_CYRILLIC.test(err.message)) {
    return { code: "client_error", message: err.message };
  }
  if (axErr?.code === "ECONNABORTED" || axErr?.code === "ETIMEDOUT") {
    return { code: "timeout", message: "Сервер не ответил вовремя. Попробуйте ещё раз" };
  }
  return { code: status ? "http_error" : "network_error", message: friendly(undefined, status) };
}

/** Ошибки, о которых пользователь уже узнал иначе: редирект на вход, баннер «нет прав» или «нет сети». */
export function isShownGlobally(err: unknown): boolean {
  const axErr = err as AxiosError;
  if (axErr?.code === "ERR_CANCELED") return true;
  if (!axErr?.isAxiosError) return false;
  const status = axErr.response?.status;
  return status === 401 || status === 403 || !axErr.response;
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
