import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { Navigate } from "react-router-dom";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/ui";
import { Pencil, Trash2, Search, Building2, Power } from "lucide-react";
import clsx from "clsx";

type AdminTenant = {
  id: number;
  name: string;
  slug: string;
  subdomain: string | null;
  company_display_name: string | null;
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
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<AdminTenant | null>(null);
  const [deleting, setDeleting] = useState<AdminTenant | null>(null);

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

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/admin/tenants/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-tenants"] });
      setDeleting(null);
      toast.success("Компания удалена");
    },
    onError: (e) => toast.error("Ошибка удаления", extractApiError(e).message),
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return data;
    return data.filter(
      (t) =>
        t.name.toLowerCase().includes(needle) ||
        t.slug.toLowerCase().includes(needle) ||
        (t.subdomain?.toLowerCase().includes(needle) ?? false),
    );
  }, [data, q]);

  const stats = useMemo(() => {
    if (!data) return null;
    return {
      total: data.length,
      active: data.filter((t) => t.is_active).length,
      byPlan: PLANS.map((p) => ({
        plan: p,
        count: data.filter((t) => t.plan === p).length,
      })),
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Платформа</h1>
          <p className="text-sm text-neutral-500">Все компании Qadam CRM</p>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-2.5 text-neutral-400" />
          <input
            className="input pl-8 w-64"
            placeholder="Поиск по названию / slug…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {stats && (
        <div className="grid gap-3 sm:grid-cols-4">
          <StatCard label="Всего компаний" value={stats.total} icon={<Building2 size={16} />} />
          <StatCard
            label="Активных"
            value={stats.active}
            icon={<Power size={16} />}
            tone={stats.active === stats.total ? "success" : undefined}
          />
          {stats.byPlan.map((s) => (
            <StatCard
              key={s.plan}
              label={`${s.plan.charAt(0).toUpperCase()}${s.plan.slice(1)}`}
              value={s.count}
            />
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 dark:bg-neutral-900/40 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Название</th>
              <th className="px-3 py-2">Slug</th>
              <th className="px-3 py-2">Subdomain</th>
              <th className="px-3 py-2 text-right">Users</th>
              <th className="px-3 py-2 text-right">Projects</th>
              <th className="px-3 py-2 text-right">Tasks</th>
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right w-24">Действия</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-neutral-500">Загрузка…</td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-neutral-500">
                  {q ? "Ничего не найдено" : "Компаний ещё нет"}
                </td>
              </tr>
            )}
            {filtered.map((t) => (
              <tr key={t.id} className="border-t border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50/50 dark:hover:bg-neutral-800/20">
                <td className="px-3 py-2 text-neutral-500 tabular-nums">{t.id}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{t.name}</div>
                  {t.company_display_name && t.company_display_name !== t.name && (
                    <div className="text-xs text-neutral-500">«{t.company_display_name}»</div>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-neutral-500">{t.slug}</td>
                <td className="px-3 py-2 font-mono text-xs text-neutral-500">{t.subdomain ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.users}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.projects}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.tasks}</td>
                <td className="px-3 py-2">
                  <select
                    className="input !py-1"
                    value={t.plan}
                    onChange={(e) => patch.mutate({ id: t.id, body: { plan: e.target.value } })}
                  >
                    {PLANS.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <button
                    className={clsx(
                      "chip",
                      t.is_active
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
                    )}
                    title={t.is_active ? "Нажмите чтобы деактивировать" : "Нажмите чтобы активировать"}
                    onClick={() => patch.mutate({ id: t.id, body: { is_active: !t.is_active } })}
                  >
                    {t.is_active ? "active" : "inactive"}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      className="btn-ghost !py-1 !px-1.5"
                      title="Редактировать"
                      onClick={() => setEditing(t)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="btn-ghost !py-1 !px-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      title="Удалить компанию"
                      onClick={() => setDeleting(t)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditTenantModal
          tenant={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["admin-tenants"] });
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <DeleteTenantModal
          tenant={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={() => del.mutate(deleting.id)}
          isPending={del.isPending}
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  tone?: "success";
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        {icon}
        {label}
      </div>
      <div
        className={clsx(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "success" && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function EditTenantModal({
  tenant,
  onClose,
  onSaved,
}: {
  tenant: AdminTenant;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(tenant.name);
  const [slug, setSlug] = useState(tenant.slug);
  const [subdomain, setSubdomain] = useState(tenant.subdomain ?? "");
  const [displayName, setDisplayName] = useState(tenant.company_display_name ?? "");
  const [plan, setPlan] = useState(tenant.plan);
  const [isActive, setIsActive] = useState(tenant.is_active);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (name !== tenant.name) body.name = name.trim();
      if (slug !== tenant.slug) body.slug = slug.trim().toLowerCase();
      if (subdomain !== (tenant.subdomain ?? "")) body.subdomain = subdomain.trim();
      if (displayName !== (tenant.company_display_name ?? "")) body.company_display_name = displayName.trim();
      if (plan !== tenant.plan) body.plan = plan;
      if (isActive !== tenant.is_active) body.is_active = isActive;
      if (Object.keys(body).length === 0) return null;
      return (await api.patch(`/api/admin/tenants/${tenant.id}`, body)).data;
    },
    onSuccess: (data) => {
      if (!data) {
        toast.success("Без изменений");
      } else {
        toast.success("Компания обновлена");
      }
      onSaved();
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title={`Редактировать компанию #${tenant.id}`} size="lg">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Отображаемое (опционально)
            </span>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Slug <span className="text-rose-500">⚠</span>
            </span>
            <input
              className="input font-mono"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="my-company"
            />
            <div className="mt-1 text-[11px] text-neutral-500">
              a-z, 0-9, дефис. Изменение может сломать закладки.
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Subdomain
            </span>
            <input
              className="input font-mono"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
              placeholder="acme"
            />
            <div className="mt-1 text-[11px] text-neutral-500">
              Итог: <span className="font-mono">{subdomain || "—"}.qadam.kz</span>
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Тариф</span>
            <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {PLANS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Статус</span>
            <select
              className="input"
              value={isActive ? "1" : "0"}
              onChange={(e) => setIsActive(e.target.value === "1")}
            >
              <option value="1">active</option>
              <option value="0">inactive</option>
            </select>
          </label>
        </div>

        <div className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-400">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-neutral-500">Пользователей</div>
              <div className="font-medium tabular-nums text-neutral-800 dark:text-neutral-200">{tenant.users}</div>
            </div>
            <div>
              <div className="text-neutral-500">Проектов</div>
              <div className="font-medium tabular-nums text-neutral-800 dark:text-neutral-200">{tenant.projects}</div>
            </div>
            <div>
              <div className="text-neutral-500">Задач</div>
              <div className="font-medium tabular-nums text-neutral-800 dark:text-neutral-200">{tenant.tasks}</div>
            </div>
          </div>
          {tenant.created_at && (
            <div className="mt-2 text-[11px]">
              Создана: {new Date(tenant.created_at).toLocaleDateString("ru-RU")}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteTenantModal({
  tenant,
  onClose,
  onConfirm,
  isPending,
}: {
  tenant: AdminTenant;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const [confirmName, setConfirmName] = useState("");
  const canDelete = confirmName.trim() === tenant.name;

  return (
    <Modal open onClose={onClose} title="Удалить компанию?" size="md">
      <div className="space-y-4">
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
          <div className="font-medium">Опасное действие</div>
          <div className="mt-1 text-xs">
            Будут удалены все данные компании «{tenant.name}»: {tenant.users} чел., {tenant.projects} проектов,{" "}
            {tenant.tasks} задач, комментарии, вложения. Восстановление невозможно.
          </div>
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Если хотите просто временно отключить компанию — используйте «Деактивировать» вместо удаления.
        </p>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            Введите название компании для подтверждения: <span className="font-mono">{tenant.name}</span>
          </span>
          <input
            className="input"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            autoFocus
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button
            className="btn-primary bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-600"
            disabled={!canDelete || isPending}
            onClick={onConfirm}
          >
            Удалить навсегда
          </button>
        </div>
      </div>
    </Modal>
  );
}
