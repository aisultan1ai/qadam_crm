import { create } from "zustand";

interface ThemeState {
  theme: "light" | "dark";
  toggle: () => void;
}

const initial: "light" | "dark" =
  (localStorage.getItem("theme") as "light" | "dark") ||
  (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initial,
  toggle() {
    const next = get().theme === "light" ? "dark" : "light";
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem("theme", next);
    set({ theme: next });
  },
}));
