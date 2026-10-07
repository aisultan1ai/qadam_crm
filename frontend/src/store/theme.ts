import { create } from "zustand";

type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStored(): Theme | null {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "dark" || v === "light" ? v : null;
}

function applyDomClass(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  // Цвет статус-бара/адресной строки на мобильных следует выбранной теме, а не системной.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = theme === "dark" ? "#12151B" : "#F6F7F9";
  document.head.appendChild(meta);
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

const initial: Theme = readStored() ?? (systemPrefersDark() ? "dark" : "light");
applyDomClass(initial);

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initial,
  toggle() {
    const next: Theme = get().theme === "light" ? "dark" : "light";
    applyDomClass(next);
    localStorage.setItem(STORAGE_KEY, next);
    set({ theme: next });
  },
}));

// Реагируем на смену системной темы, только если пользователь ещё не выбрал
// ручную тему (localStorage пуст). Иначе явный выбор пользователя приоритетнее.
const mq = window.matchMedia("(prefers-color-scheme: dark)");
mq.addEventListener("change", (e) => {
  if (readStored() !== null) return;
  const next: Theme = e.matches ? "dark" : "light";
  applyDomClass(next);
  useTheme.setState({ theme: next });
});
