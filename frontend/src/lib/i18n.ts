/**
 * Язык интерфейса: РУ / ҚАЗ / EN.
 *
 * Ключ перевода — сам русский текст: t("Задачи"). Нет перевода — показывается русский,
 * поэтому разделы переводятся постепенно и ничего не ломается.
 * Язык хранится в аккаунте (users.language) и дублируется в localStorage для страниц до входа.
 */
import { create } from "zustand";

import { EN } from "./locales/en";
import { KK } from "./locales/kk";

export type Lang = "ru" | "kk" | "en";
export const LANGS: { key: Lang; label: string; short: string }[] = [
  { key: "ru", label: "Русский", short: "РУ" },
  { key: "kk", label: "Қазақша", short: "ҚАЗ" },
  { key: "en", label: "English", short: "EN" },
];

const DICTS: Record<Lang, Record<string, string>> = { ru: {}, kk: KK, en: EN };
const STORAGE_KEY = "qadam:lang";

function initialLang(): Lang {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "ru" || v === "kk" || v === "en") return v;
  } catch {
    // localStorage недоступен
  }
  return "ru";
}

type LangState = { lang: Lang; setLang: (l: Lang) => void };

export const useLang = create<LangState>((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
    document.documentElement.lang = lang === "kk" ? "kk" : lang;
    set({ lang });
  },
}));

try {
  document.documentElement.lang = useLang.getState().lang;
} catch {
  // SSR/тесты без document
}

/** Перевод вне компонентов (берёт текущий язык). */
export function t(ru: string, vars?: Record<string, string | number>): string {
  const lang = useLang.getState().lang;
  let s = DICTS[lang][ru] ?? ru;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** Хук: компонент перерисуется при смене языка. */
export function useT() {
  const lang = useLang((s) => s.lang);
  return (ru: string, vars?: Record<string, string | number>) => {
    let s = DICTS[lang][ru] ?? ru;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
}
