import { create } from "zustand";
import { api, setTokens, clearTokens, getAccessToken, getRefreshToken, extractApiError } from "@/api/client";
import type { Me, TokenPair } from "@/types";

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

export const useAuth = create<AuthState>((set, get) => ({
  me: null,
  ready: false,
  loading: false,
  error: null,

  async login(email, password) {
    set({ loading: true, error: null });
    try {
      const { data } = await api.post<TokenPair>("/api/auth/login", { email, password });
      setTokens(data.access_token, data.refresh_token);
      await get().fetchMe();
    } catch (e: any) {
      set({ error: extractApiError(e).message || "Ошибка входа", loading: false });
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  async logout() {
    const refresh = getRefreshToken();
    try {
      await api.post("/api/auth/logout", refresh ? { refresh_token: refresh } : undefined);
    } catch {}
    clearTokens();
    set({ me: null, ready: true });
  },

  async fetchMe() {
    if (!getAccessToken()) {
      set({ me: null, ready: true });
      return;
    }
    try {
      const { data } = await api.get<Me>("/api/auth/me");
      set({ me: data, ready: true });
    } catch {
      clearTokens();
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
