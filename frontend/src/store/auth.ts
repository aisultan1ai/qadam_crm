import { create } from "zustand";
import { api, extractApiError } from "@/api/client";
import type { Me } from "@/types";

interface AuthState {
  me: Me | null;
  ready: boolean;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
  can: (code: string | string[]) => boolean;
}

export const useAuth = create<AuthState>()((set, get) => ({
  me: null,
  ready: false,
  loading: false,
  error: null,

  async login(email, password) {
    set({ loading: true, error: null });
    try {
      // Backend поставит httpOnly cookies (access + refresh).
      await api.post("/api/auth/login", { email, password });
      await get().fetchMe();
    } catch (e: unknown) {
      set({ error: extractApiError(e).message || "Ошибка входа", loading: false });
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  async logout() {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // не блокируем выход при сетевой ошибке
    }
    set({ me: null, ready: true });
  },

  async fetchMe() {
    try {
      const { data } = await api.get<Me>("/api/auth/me");
      set({ me: data, ready: true });
    } catch {
      set({ me: null, ready: true });
    }
  },

  can(code) {
    const me = get().me;
    if (!me) return false;
    if (me.is_superuser) return true;
    const codes = Array.isArray(code) ? code : [code];
    return codes.some((c) => me.permissions.includes(c));
  },
}));
