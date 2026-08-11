import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { Navigate } from "react-router-dom";
import { useToast } from "@/components/Toast";

type AdminTenant = {
  id: number;
  name: string;
  slug: string;
  subdomain: string | null;
  plan: string;
  is_active: boolean;
  created_at: string | null;
  users: number;
  projects: number;
  tasks: number;
};

const PLANS = ["free", "pro", "enterprise"] as const;

export default function Admin() {
  const me = useAuth((s) => s.me);
  const qc = useQueryClient();
  const toast = useToast();

  if (me && !me.is_platform_admin) return <Navigate to="/" replace />;

  const { data, isLoading } = useQuery({
    queryKey: ["admin-tenants"],
    queryFn: async () => (await api.get<AdminTenant[]>("/api/admin/tenants")).data,
  });

  const patch = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      (await api.patch(`/api/admin/tenants/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-tenants"] }),
    onError: (e) => toast.error("Не удалось обновить", extractApiError(e).message),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Платформа</h1>
        <p className="text-sm text-neutral-500">Все компании Qadam CRM</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 dark:bg-neutral-900/40 text-left">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Название</th>
              <th className="px-3 py-2">Slug</th>
              <th className="px-3 py-2">Subdomain</th>
              <th className="px-3 py-2">Users</th>
              <th className="px-3 py-2">Projects</th>
              <th className="px-3 py-2">Tasks</th>
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-neutral-500">Загрузка…</td>
              </tr>
            )}
            {(data ?? []).map((t) => (
              <tr key={t.id} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-3 py-2 text-neutral-500">{t.id}</td>
                <td className="px-3 py-2 font-medium">{t.name}</td>
                <td className="px-3 py-2 text-neutral-500">{t.slug}</td>
                <td className="px-3 py-2 text-neutral-500">{t.subdomain ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{t.users}</td>
                <td className="px-3 py-2 tabular-nums">{t.projects}</td>
                <td className="px-3 py-2 tabular-nums">{t.tasks}</td>
                <td className="px-3 py-2">
                  <select
                    className="input !py-1"
                    value={t.plan}
                    onChange={(e) => patch.mutate({ id: t.id, body: { plan: e.target.value } })}
                  >
                    {PLANS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <button
                    className={
                      t.is_active
                        ? "text-xs rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800"
                        : "text-xs rounded-full bg-rose-100 px-2 py-0.5 text-rose-800"
                    }
                    onClick={() => patch.mutate({ id: t.id, body: { is_active: !t.is_active } })}
                  >
                    {t.is_active ? "active" : "inactive"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
