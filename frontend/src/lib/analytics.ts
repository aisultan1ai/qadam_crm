/**
 * Тонкая обёртка над Yandex.Metrika и Google Analytics 4.
 *
 * Оба провайдера подключаются только если переданы соответствующие env-переменные
 * при сборке. Если ключей нет — функции превращаются в noop, ничего не грузится.
 */

const YM_ID = (import.meta.env.VITE_YANDEX_METRIKA_ID as string | undefined) || "";
const GA_ID = (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined) || "";

let initialized = false;

declare global {
  interface Window {
    ym?: (id: number | string, action: string, ...args: unknown[]) => void;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function injectYandexMetrika(id: string) {
  if (typeof window === "undefined" || window.ym) return;
  (function (m: Window & typeof globalThis, e: Document, t: string, r: string, i: string) {
    (m as any)[i] =
      (m as any)[i] ||
      function () {
        ((m as any)[i].a = (m as any)[i].a || []).push(arguments);
      };
    (m as any)[i].l = 1 * (new Date() as any);
    for (let j = 0; j < e.scripts.length; j++) {
      if (e.scripts[j].src === r) return;
    }
    const k = e.createElement(t) as HTMLScriptElement;
    const a = e.getElementsByTagName(t)[0];
    k.async = true;
    k.src = r;
    a.parentNode?.insertBefore(k, a);
  })(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");

  const ym = (window as any).ym;
  if (typeof ym === "function") {
    ym(id, "init", {
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
      webvisor: false,
    });
  }
}

function injectGA(id: string) {
  if (typeof window === "undefined" || window.gtag) return;
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", id, { send_page_view: false });
}

/**
 * Один раз при загрузке приложения подключаем счётчики (если ключи заданы).
 * Идемпотентно.
 */
export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;
  if (YM_ID) injectYandexMetrika(YM_ID);
  if (GA_ID) injectGA(GA_ID);
}

/**
 * Отправить view-событие текущего URL. Вызывается на смене роута.
 */
export function trackPageview(path: string, title?: string): void {
  if (YM_ID && window.ym) {
    window.ym(YM_ID, "hit", path, { title });
  }
  if (GA_ID && window.gtag) {
    window.gtag("event", "page_view", { page_path: path, page_title: title });
  }
}

/**
 * Отправить пользовательское событие (conversion). Оба провайдера.
 */
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (YM_ID && window.ym) {
    window.ym(YM_ID, "reachGoal", name, params);
  }
  if (GA_ID && window.gtag) {
    window.gtag("event", name, params || {});
  }
}
