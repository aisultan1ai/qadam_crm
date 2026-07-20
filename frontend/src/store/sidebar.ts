import { create } from "zustand";

interface SidebarState {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
}

const KEY = "sidebar-collapsed";
const initial = localStorage.getItem(KEY) === "1";

export const useSidebar = create<SidebarState>((set, get) => ({
  collapsed: initial,
  toggle() {
    const next = !get().collapsed;
    localStorage.setItem(KEY, next ? "1" : "0");
    set({ collapsed: next });
  },
  setCollapsed(v) {
    localStorage.setItem(KEY, v ? "1" : "0");
    set({ collapsed: v });
  },
}));
