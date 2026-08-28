import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { Navigate } from "react-router-dom";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/ui";
import { Pencil, Trash2, Search, Building2, Power, ChevronRight, Users as UsersIcon, HardDrive, Loader2, CreditCard, Plus, Check } from "lucide-react";
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

type TenantUsage = {
  plan: string;
  limits: { max_users: number | null; max_projects: number | null; max_storage_bytes: number | null };
  usage: { users: number; projects: number; storage_bytes: number };
};

type GlobalUser = {
  id: number;
  email: string;
  name: string;
  is_active: boolean;
  is_superuser: boolean;
  is_platform_admin: boolean;
  created_at: string | null;
};

type Tab = "tenants" | "users" | "plans";

type PlanFeatureFlags = {
  export: boolean;
  import: boolean;
  invitations: boolean;
  lead_forms: boolean;
  analytics_cache: boolean;
  branding: boolean;
  custom_subdomain: boolean;
  priority_support: boolean;
};

type PlanRow = {
  key: string;
  title: string;
  tagline: string | null;
  price_month: number | null;
  currency: string;
  features: string[];
  limits: {
    max_users: number | null;
    max_projects: number | null;
    max_storage_bytes: number | null;
    api_rate_per_min: number;
  };
  feature_flags: PlanFeatureFlags;
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
};

const FEATURE_FLAG_LABELS: Record<keyof PlanFeatureFlags, string> = {
  export: "Экспорт Excel",
  import: "Импорт CSV/XLSX",
  invitations: "Приглашения",
  lead_forms: "Формы лидов",
  analytics_cache: "Кэш аналитики",
  branding: "Брендирование",
  custom_subdomain: "Кастомный поддомен",
  priority_support: "Приоритетная поддержка",
};

const FALLBACK_PLAN_KEYS = ["free", "pro", "enterprise"];

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

export default function Admin() {
  const me = useAuth((s) => s.me);
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("tenants");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<AdminTenant | null>(null);
  const [deleting, setDeleting] = useState<AdminTenant | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (me && !me.is_platform_admin) return <Navigate to="/" replace />;

  const { data, isLoading } = useQuery({
    queryKey: ["admin-tenants"],
    queryFn: async () => (await api.get<AdminTenant[]>("/api/admin/tenants")).data,
  });

  const { data: plansData } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: async () => (await api.get<PlanRow[]>("/api/admin/plans")).data,
    staleTime: 30_000,
  });
  const planKeys = plansData?.map((p) => p.key) ?? FALLBACK_PLAN_KEYS;

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
      byPlan: planKeys.map((p) => ({
        plan: p,
        count: data.filter((t) => t.plan === p).length,
      })),
    };
  }, [data, planKeys]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Платформа</h1>
          <p className="text-sm text-neutral-500">
            {tab === "tenants" ? "Все компании Qadam CRM" : "Все пользователи платформы"}
          </p>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-2.5 text-neutral-400" />
          <input
            className="input pl-8 w-64"
            placeholder={tab === "tenants" ? "Поиск по названию / slug…" : "Поиск по email / имени…"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <nav className="flex gap-1 rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900/60 w-fit">
        <button
          className={clsx(
            "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
            tab === "tenants"
              ? "bg-brand-50 text-brand-800 dark:bg-brand-900/25 dark:text-brand-200"
              : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800/60",
          )}
          onClick={() => setTab("tenants")}
        >
          <Building2 size={14} /> Компании
        </button>
        <button
          className={clsx(
            "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
            tab === "users"
              ? "bg-brand-50 text-brand-800 dark:bg-brand-900/25 dark:text-brand-200"
              : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800/60",
          )}
          onClick={() => setTab("users")}
        >
          <UsersIcon size={14} /> Пользователи
        </button>
        <button
          className={clsx(
            "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
            tab === "plans"
              ? "bg-brand-50 text-brand-800 dark:bg-brand-900/25 dark:text-brand-200"
              : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800/60",
          )}
          onClick={() => setTab("plans")}
        >
          <CreditCard size={14} /> Тарифы
        </button>
      </nav>

      {tab === "users" ? (
        <GlobalUsersTab query={q} />
      ) : tab === "plans" ? (
        <PlansTab />
      ) : (
        <>
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
              <th className="w-8 px-3 py-2" />
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
                <td colSpan={11} className="px-3 py-6 text-center text-neutral-500">Загрузка…</td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-neutral-500">
                  {q ? "Ничего не найдено" : "Компаний ещё нет"}
                </td>
              </tr>
            )}
            {filtered.map((t) => {
              const isOpen = expandedId === t.id;
              return (
                <>
                  <tr
                    key={t.id}
                    className="border-t border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50/50 dark:hover:bg-neutral-800/20"
                  >
                    <td className="px-3 py-2">
                      <button
                        className="btn-ghost !p-1"
                        onClick={() => setExpandedId(isOpen ? null : t.id)}
                        aria-label={isOpen ? "Свернуть" : "Развернуть детали"}
                        aria-expanded={isOpen}
                      >
                        <ChevronRight size={14} className={clsx("transition-transform", isOpen && "rotate-90")} />
                      </button>
                    </td>
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
                        {planKeys.map((p) => (
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
                  {isOpen && (
                    <tr className="border-t border-neutral-100 bg-neutral-50/40 dark:border-neutral-800 dark:bg-neutral-900/40">
                      <td colSpan={11} className="px-3 py-3">
                        <TenantUsagePanel tenantId={t.id} plan={t.plan} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
        </>
      )}

      {editing && (
        <EditTenantModal
          tenant={editing}
          planKeys={planKeys}
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
  planKeys,
  onClose,
  onSaved,
}: {
  tenant: AdminTenant;
  planKeys: string[];
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
              {planKeys.map((p) => (
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

function UsageProgressRow({
  label,
  icon,
  used,
  limit,
  formatFn,
}: {
  label: string;
  icon: React.ReactNode;
  used: number;
  limit: number | null;
  formatFn: (n: number) => string;
}) {
  const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const isOver = limit != null && used >= limit;
  const isNear = limit != null && percent >= 80 && !isOver;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
          {icon}
          {label}
        </div>
        <div className="tabular-nums text-neutral-500">
          {formatFn(used)} {limit != null && <>/ {formatFn(limit)}</>}
          {limit == null && <span className="text-neutral-400">/ ∞</span>}
        </div>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        {limit != null && (
          <div
            className={clsx(
              "h-full rounded-full transition-all duration-300",
              isOver ? "bg-rose-500" : isNear ? "bg-amber-500" : "bg-brand-600",
            )}
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
    </div>
  );
}

function TenantUsagePanel({ tenantId, plan }: { tenantId: number; plan: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-tenant-usage", tenantId],
    queryFn: async () => (await api.get<TenantUsage>(`/api/admin/tenants/${tenantId}/usage`)).data,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Loader2 size={14} className="animate-spin" /> Загружаем статистику…
      </div>
    );
  }
  if (error || !data) {
    return <div className="text-sm text-rose-500">Не удалось загрузить статистику</div>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <UsageProgressRow
        label="Пользователи"
        icon={<UsersIcon size={12} />}
        used={data.usage.users}
        limit={data.limits.max_users}
        formatFn={(n) => String(n)}
      />
      <UsageProgressRow
        label="Проекты"
        icon={<Building2 size={12} />}
        used={data.usage.projects}
        limit={data.limits.max_projects}
        formatFn={(n) => String(n)}
      />
      <UsageProgressRow
        label="Хранилище"
        icon={<HardDrive size={12} />}
        used={data.usage.storage_bytes}
        limit={data.limits.max_storage_bytes}
        formatFn={formatBytes}
      />
      <div className="sm:col-span-3 text-[11px] text-neutral-500">
        Тариф: <span className="font-medium">{plan}</span>
      </div>
    </div>
  );
}

function GlobalUsersTab({ query }: { query: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-global-users"],
    queryFn: async () => (await api.get<GlobalUser[]>("/api/admin/users", { params: { limit: 500 } })).data,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return data;
    return data.filter(
      (u) => u.email.toLowerCase().includes(needle) || u.name.toLowerCase().includes(needle),
    );
  }, [data, query]);

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 dark:bg-neutral-900/40 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-3 py-2">ID</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Имя</th>
            <th className="px-3 py-2">Статус</th>
            <th className="px-3 py-2">Роли</th>
            <th className="px-3 py-2">Создан</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                Загрузка…
              </td>
            </tr>
          )}
          {!isLoading && filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                {query ? "Ничего не найдено" : "Пользователей ещё нет"}
              </td>
            </tr>
          )}
          {filtered.map((u) => (
            <tr
              key={u.id}
              className="border-t border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50/50 dark:hover:bg-neutral-800/20"
            >
              <td className="px-3 py-2 tabular-nums text-neutral-500">{u.id}</td>
              <td className="px-3 py-2 font-mono text-xs">{u.email}</td>
              <td className="px-3 py-2 font-medium">{u.name}</td>
              <td className="px-3 py-2">
                <span
                  className={clsx(
                    "chip",
                    u.is_active
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800",
                  )}
                >
                  {u.is_active ? "active" : "inactive"}
                </span>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {u.is_platform_admin && (
                    <span className="chip bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                      platform admin
                    </span>
                  )}
                  {u.is_superuser && (
                    <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      super
                    </span>
                  )}
                  {!u.is_platform_admin && !u.is_superuser && (
                    <span className="text-xs text-neutral-400">—</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-xs text-neutral-500">
                {u.created_at ? new Date(u.created_at).toLocaleDateString("ru-RU") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// Управление тарифами (CRUD)
// =============================================================================

function PlansTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<PlanRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: async () => (await api.get<PlanRow[]>("/api/admin/plans")).data,
  });

  const del = useMutation({
    mutationFn: (key: string) => api.delete(`/api/admin/plans/${key}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-plans"] });
      setDeleting(null);
      toast.success("Тариф удалён");
    },
    onError: (e) => toast.error("Ошибка удаления", extractApiError(e).message),
  });

  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-500">
          Тарифы применяются ко всем компаниям. Изменение цены не влияет на активные подписки до следующего периода.
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Новый тариф
        </button>
      </div>

      {isLoading && (
        <div className="card p-6 text-center text-sm text-neutral-500">Загрузка…</div>
      )}

      {!isLoading && sorted.length === 0 && (
        <div className="card p-6 text-center text-sm text-neutral-500">Тарифов ещё нет</div>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {sorted.map((p) => (
          <PlanCard
            key={p.key}
            plan={p}
            onEdit={() => setEditing(p)}
            onDelete={() => setDeleting(p)}
          />
        ))}
      </div>

      {(editing || creating) && (
        <PlanFormModal
          plan={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["admin-plans"] });
            setEditing(null);
            setCreating(false);
          }}
        />
      )}

      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Удалить тариф?" size="md">
          <div className="space-y-3">
            <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
              Тариф «{deleting.title}» ({deleting.key}) будет удалён навсегда.
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setDeleting(null)}>Отмена</button>
              <button
                className="btn-primary bg-rose-600 hover:bg-rose-700"
                disabled={del.isPending}
                onClick={() => del.mutate(deleting.key)}
              >
                Удалить
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  onEdit,
  onDelete,
}: {
  plan: PlanRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const priceLabel =
    plan.price_month == null
      ? "По запросу"
      : plan.price_month === 0
        ? "Бесплатно"
        : `${plan.price_month.toLocaleString("ru-RU")} ${plan.currency} / мес`;

  const activeFeatures = (Object.keys(plan.feature_flags) as (keyof PlanFeatureFlags)[])
    .filter((k) => plan.feature_flags[k]);

  return (
    <div className={clsx("card p-5 space-y-3", !plan.is_active && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">{plan.title}</span>
            <span className="font-mono text-xs text-neutral-400">{plan.key}</span>
            {!plan.is_active && (
              <span className="chip bg-neutral-100 text-neutral-500 dark:bg-neutral-800">выключен</span>
            )}
            {!plan.is_public && plan.is_active && (
              <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">скрыт</span>
            )}
          </div>
          {plan.tagline && <div className="mt-1 text-xs text-neutral-500">{plan.tagline}</div>}
        </div>
        <div className="flex gap-1">
          <button className="btn-ghost !p-1.5" title="Редактировать" onClick={onEdit}>
            <Pencil size={14} />
          </button>
          <button
            className="btn-ghost !p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
            title="Удалить"
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="text-xl font-bold tabular-nums">{priceLabel}</div>

      <div className="space-y-1 rounded-lg bg-neutral-50 p-3 text-xs dark:bg-neutral-800/40">
        <PlanLimitRow label="Пользователи" v={plan.limits.max_users} />
        <PlanLimitRow label="Проекты" v={plan.limits.max_projects} />
        <PlanLimitRow label="Хранилище" v={plan.limits.max_storage_bytes} format={formatBytes} />
        <PlanLimitRow label="API rate/мин" v={plan.limits.api_rate_per_min} />
      </div>

      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Включённые функции</div>
        {activeFeatures.length === 0 ? (
          <div className="text-xs text-neutral-400">Ничего не включено</div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {activeFeatures.map((k) => (
              <span
                key={k}
                className="chip bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-300"
              >
                <Check size={11} /> {FEATURE_FLAG_LABELS[k]}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanLimitRow({
  label,
  v,
  format,
}: {
  label: string;
  v: number | null;
  format?: (n: number) => string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-neutral-500">{label}</span>
      <span className="font-medium tabular-nums">
        {v == null ? "∞" : format ? format(v) : v.toLocaleString("ru-RU")}
      </span>
    </div>
  );
}

const EMPTY_FLAGS: PlanFeatureFlags = {
  export: false,
  import: false,
  invitations: true,
  lead_forms: false,
  analytics_cache: false,
  branding: false,
  custom_subdomain: false,
  priority_support: false,
};

function PlanFormModal({
  plan,
  onClose,
  onSaved,
}: {
  plan: PlanRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = plan != null;
  const toast = useToast();

  const [key, setKey] = useState(plan?.key ?? "");
  const [title, setTitle] = useState(plan?.title ?? "");
  const [tagline, setTagline] = useState(plan?.tagline ?? "");
  const [priceMonth, setPriceMonth] = useState<string>(plan?.price_month?.toString() ?? "");
  const [currency, setCurrency] = useState(plan?.currency ?? "KZT");
  const [maxUsers, setMaxUsers] = useState<string>(plan?.limits.max_users?.toString() ?? "");
  const [maxProjects, setMaxProjects] = useState<string>(plan?.limits.max_projects?.toString() ?? "");
  const [maxStorageGb, setMaxStorageGb] = useState<string>(
    plan?.limits.max_storage_bytes != null
      ? (plan.limits.max_storage_bytes / (1024 ** 3)).toString()
      : "",
  );
  const [apiRate, setApiRate] = useState<string>(plan?.limits.api_rate_per_min?.toString() ?? "60");
  const [flags, setFlags] = useState<PlanFeatureFlags>(plan?.feature_flags ?? EMPTY_FLAGS);
  const [marketingFeatures, setMarketingFeatures] = useState<string>(plan?.features.join("\n") ?? "");
  const [isActive, setIsActive] = useState(plan?.is_active ?? true);
  const [isPublic, setIsPublic] = useState(plan?.is_public ?? true);
  const [sortOrder, setSortOrder] = useState<string>(plan?.sort_order.toString() ?? "0");

  const save = useMutation({
    mutationFn: async () => {
      const nullableInt = (v: string): number | null => {
        const trimmed = v.trim();
        if (trimmed === "" || trimmed === "-") return null;
        const n = Number(trimmed);
        return Number.isFinite(n) ? Math.floor(n) : null;
      };
      const storageBytes = (() => {
        const trimmed = maxStorageGb.trim();
        if (trimmed === "") return null;
        const n = Number(trimmed);
        return Number.isFinite(n) ? Math.floor(n * 1024 ** 3) : null;
      })();

      const body: Record<string, unknown> = {
        title: title.trim(),
        tagline: tagline.trim() || null,
        price_month: nullableInt(priceMonth),
        currency: currency.trim() || "KZT",
        max_users: nullableInt(maxUsers),
        max_projects: nullableInt(maxProjects),
        max_storage_bytes: storageBytes,
        api_rate_per_min: nullableInt(apiRate) ?? 60,
        feature_export: flags.export,
        feature_import: flags.import,
        feature_invitations: flags.invitations,
        feature_lead_forms: flags.lead_forms,
        feature_analytics_cache: flags.analytics_cache,
        feature_branding: flags.branding,
        feature_custom_subdomain: flags.custom_subdomain,
        feature_priority_support: flags.priority_support,
        marketing_features: marketingFeatures.trim() || null,
        is_active: isActive,
        is_public: isPublic,
        sort_order: nullableInt(sortOrder) ?? 0,
      };

      if (isEdit) {
        return (await api.patch(`/api/admin/plans/${plan.key}`, body)).data;
      }
      body.key = key.trim();
      return (await api.post("/api/admin/plans", body)).data;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Тариф обновлён" : "Тариф создан");
      onSaved();
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title={isEdit ? `Тариф «${plan.title}»` : "Новый тариф"} size="lg">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Ключ (без пробелов, латиница)
            </span>
            <input
              className={clsx("input font-mono", isEdit && "opacity-60")}
              value={key}
              disabled={isEdit}
              onChange={(e) => setKey(e.target.value.toLowerCase())}
              placeholder="pro-annual"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Подзаголовок</span>
            <input className="input" value={tagline} onChange={(e) => setTagline(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Цена в месяц (пусто = «По запросу»)
            </span>
            <input
              className="input"
              type="number"
              min="0"
              value={priceMonth}
              onChange={(e) => setPriceMonth(e.target.value)}
              placeholder="9990"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Валюта</span>
            <input className="input" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </label>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Лимиты</div>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">Пользователей (пусто = ∞)</span>
              <input className="input" type="number" min="0" value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">Проектов (пусто = ∞)</span>
              <input className="input" type="number" min="0" value={maxProjects} onChange={(e) => setMaxProjects(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">Хранилище, ГБ</span>
              <input className="input" type="number" min="0" step="0.1" value={maxStorageGb} onChange={(e) => setMaxStorageGb(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">API rate/мин</span>
              <input className="input" type="number" min="1" value={apiRate} onChange={(e) => setApiRate(e.target.value)} />
            </label>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Функции</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(FEATURE_FLAG_LABELS) as (keyof PlanFeatureFlags)[]).map((k) => (
              <label
                key={k}
                className={clsx(
                  "flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors",
                  flags[k]
                    ? "border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-950/30"
                    : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/40",
                )}
              >
                <span>{FEATURE_FLAG_LABELS[k]}</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-600"
                  checked={flags[k]}
                  onChange={(e) => setFlags((f) => ({ ...f, [k]: e.target.checked }))}
                />
              </label>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            Маркетинг-описание (по строке — один буллет)
          </span>
          <textarea
            className="input min-h-[100px]"
            value={marketingFeatures}
            onChange={(e) => setMarketingFeatures(e.target.value)}
            placeholder="До 50 пользователей&#10;20 ГБ файлов&#10;Экспорт в Excel"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span className="text-sm">Активен</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            <span className="text-sm">Публичный (на лендинге)</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500">Порядок</span>
            <input className="input" type="number" min="0" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button
            className="btn-primary"
            disabled={save.isPending || !title.trim() || (!isEdit && !key.trim())}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Сохраняем…" : isEdit ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
