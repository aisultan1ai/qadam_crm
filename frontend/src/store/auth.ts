import { create } from "zustand";
import { api } from "@/api/client";
import type { Me } from "@/types";

interface AuthState {
  me: Me | null;
  ready: boolean;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  fetchMe: () => Promise<void>;
  can: (code: string | string[]) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  me: null,
  ready: false,
  loading: false,
  error: null,

  async login(email, password) {
    set({ loading: true, error: null });
    try {
      const { data } = await api.post("/api/auth/login", { email, password });
      localStorage.setItem("token", data.access_token);
      await get().fetchMe();
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      const msg =
        typeof d === "string"
          ? d
          : Array.isArray(d)
            ? d.map((x: any) => x?.msg || JSON.stringify(x)).join("; ")
            : "Ошибка входа";
      set({ error: msg, loading: false });
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  logout() {
    localStorage.removeItem("token");
    set({ me: null, ready: true });
  },

  async fetchMe() {
    if (!localStorage.getItem("token")) {
      set({ me: null, ready: true });
      return;
    }
    try {
      const { data } = await api.get<Me>("/api/auth/me");
      set({ me: data, ready: true });
    } catch {
      localStorage.removeItem("token");
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
