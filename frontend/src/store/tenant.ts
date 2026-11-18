import { create } from "zustand";
import { api } from "@/api/client";
import { goToCompany, onAnySubdomain } from "@/lib/companyAddress";
import type { Tenant } from "@/types";

interface TenantState {
  tenants: Tenant[];
  loading: boolean;
  fetchTenants: () => Promise<void>;
  switchTenant: (id: number) => Promise<void>;
}

export const useTenants = create<TenantState>()((set) => ({
  tenants: [],
  loading: false,

  async fetchTenants() {
    set({ loading: true });
    try {
      const { data } = await api.get<Tenant[]>("/api/auth/tenants");
      set({ tenants: data });
    } catch {
      set({ tenants: [] });
    } finally {
      set({ loading: false });
    }
  },

  async switchTenant(id) {
    const target = useTenants.getState().tenants.find((t) => t.id === id);
    if (target?.subdomain || onAnySubdomain()) {
      // У компании свой адрес или мы сейчас на адресе другой компании — переносим сессию туда.
      await goToCompany(id);
      return;
    }
    await api.post(`/api/auth/switch-tenant/${id}`);
    // Полный перезапуск приложения: гарантирует, что WS переоткрылся,
    // react-query-кэш сброшен, темы/цвета/логотип перечитались.
    window.location.assign("/");
  },
}));
