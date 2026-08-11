import { useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api, extractApiError } from "@/api/client";
import type { Role, PermissionGroup } from "@/types";
import { Loader, Modal } from "@/components/ui";
import { Plus, Copy, Trash2, Save, CreditCard, Palette } from "lucide-react";
import { useAuth } from "@/store/auth";
import { useToast } from "@/components/Toast";

const SETTINGS_TABS = [
  { to: "roles", label: "Роли и права", icon: Save },
  { to: "branding", label: "Брендинг", icon: Palette, ownerOnly: true },
  { to: "billing", label: "Тариф", icon: CreditCard, ownerOnly: true },
];

export default function Settings() {
  const { can, me } = useAuth();
  const isOwner = !!me?.current_tenant?.is_owner || !!me?.is_platform_admin;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Настройки</h1>
        <p className="text-sm text-neutral-500">Компания, тариф и права доступа</p>
      </div>

      <nav className="flex flex-wrap gap-1 rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900/60">
        {SETTINGS_TABS.map((t) => {
          if (t.ownerOnly && !isOwner) return null;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-white"
                    : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white",
                )
              }
            >
              <t.icon size={15} />
              {t.label}
            </NavLink>
          );
        })}
      </nav>

      <Routes>
        <Route index element={<Navigate to="roles" replace />} />
        <Route path="roles" element={can("roles.manage") ? <RolesSettings /> : <Forbid />} />
        <Route path="branding" element={isOwner ? <BrandingSettings /> : <Forbid />} />
        <Route path="billing" element={isOwner ? <BillingSettings /> : <Forbid />} />
      </Routes>
    </div>
  );
}

function Forbid() {
  return <div className="card p-8 text-center text-sm text-neutral-500">Недостаточно прав</div>;
}

function RolesSettings() {
  const qc = useQueryClient();
  const { data: roles } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await api.get<Role[]>("/api/roles")).data,
    refetchOnMount: "always",
    staleTime: 0,
  });
  const { data: groups } = useQuery({
    queryKey: ["permissions"],
    queryFn: async () => (await api.get<PermissionGroup[]>("/api/permissions")).data,
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = useMemo(
    () => roles?.find((r) => r.id === selectedId) ?? roles?.[0] ?? null,
    [roles, selectedId],
  );

  const [nameDraft, setNameDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [permSet, setPermSet] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [openNew, setOpenNew] = useState(false);

  useEffect(() => {
    if (selected) {
      setNameDraft(selected.name);
      setDescDraft(selected.description || "");
      setPermSet(new Set(selected.permissions.map((p) => p.code)));
      setDirty(false);
    }
  }, [selected]);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/roles/${selected!.id}`, {
        name: nameDraft,
        description: descDraft,
        permission_codes: Array.from(permSet),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      setDirty(false);
    },
  });
  const copyRole = useMutation({
    mutationFn: (id: number) => api.post(`/api/roles/${id}/copy`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      setSelectedId(r.data.id);
    },
  });
  const delRole = useMutation({
    mutationFn: (id: number) => api.delete(`/api/roles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roles"] }),
    onError: (e: any) => alert(e?.response?.data?.detail || "Ошибка"),
  });

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <div className="card p-2">
        <div className="mb-1 flex items-center justify-between px-2 py-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Роли</span>
          <button className="btn-ghost !p-1" onClick={() => setOpenNew(true)}>
            <Plus size={14} />
          </button>
        </div>
        <div className="space-y-0.5">
          {roles?.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={clsx(
                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                selected?.id === r.id
                  ? "bg-neutral-100 font-medium dark:bg-neutral-800"
                  : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60",
              )}
            >
              <span className="truncate">{r.name}</span>
              <span className="text-xs text-neutral-500">{r.users_count}</span>
            </button>
          ))}
        </div>
      </div>

      {!selected || !groups ? (
        <Loader />
      ) : (
        <div className="card flex max-h-[calc(100vh-12rem)] flex-col p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex-1 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
                <input className="input" value={nameDraft} onChange={(e) => { setNameDraft(e.target.value); setDirty(true); }} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Описание</span>
                <input className="input" value={descDraft} onChange={(e) => { setDescDraft(e.target.value); setDirty(true); }} />
              </label>
            </div>
            <div className="flex gap-1">
              <button className="btn-ghost !p-2" title="Копировать" onClick={() => copyRole.mutate(selected.id)}>
                <Copy size={16} />
              </button>
              <button
                className="btn-ghost !p-2 text-rose-500"
                title="Удалить"
                onClick={() => confirm(`Удалить роль «${selected.name}»?`) && delRole.mutate(selected.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto pr-1">
            {groups.map((g) => {
              const allChecked = g.items.every((p) => permSet.has(p.code));
              const someChecked = g.items.some((p) => permSet.has(p.code));
              return (
                <div key={g.group}>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => el && (el.indeterminate = !allChecked && someChecked)}
                      onChange={(e) => {
                        const next = new Set(permSet);
                        for (const p of g.items) {
                          if (e.target.checked) next.add(p.code);
                          else next.delete(p.code);
                        }
                        setPermSet(next);
                        setDirty(true);
                      }}
                    />
                    {g.group}
                  </label>
                  <div className="grid gap-1 pl-6 sm:grid-cols-2">
                    {g.items.map((p) => (
                      <label key={p.code} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
                        <input
                          type="checkbox"
                          checked={permSet.has(p.code)}
                          onChange={(e) => {
                            const next = new Set(permSet);
                            if (e.target.checked) next.add(p.code);
                            else next.delete(p.code);
                            setPermSet(next);
                            setDirty(true);
                          }}
                        />
                        {p.name}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-4 dark:border-neutral-800">
            <span className="text-xs text-neutral-500">{permSet.size} прав выбрано</span>
            <button className="btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              <Save size={14} /> Сохранить
            </button>
          </div>
        </div>
      )}

      {openNew && <NewRoleModal onClose={() => setOpenNew(false)} onCreated={(id) => setSelectedId(id)} />}
    </div>
  );
}

function NewRoleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () => api.post("/api/roles", { name, description, permission_codes: [] }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      onCreated(r.data.id);
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title="Новая роль">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Описание</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-primary" disabled={!name || create.isPending} onClick={() => create.mutate()}>Создать</button>
        </div>
      </div>
    </Modal>
  );
}


type TenantCurrent = {
  id: number;
  name: string;
  slug: string;
  plan: string;
  logo_url: string | null;
  primary_color: string | null;
  subdomain: string | null;
  company_display_name: string | null;
  is_owner: boolean;
};

function BrandingSettings() {
  const toast = useToast();
  const { fetchMe } = useAuth();
  const { data, refetch } = useQuery({
    queryKey: ["tenant-current"],
    queryFn: async () => (await api.get<TenantCurrent>("/api/tenants/current")).data,
  });

  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [color, setColor] = useState("");
  const [subdomain, setSubdomain] = useState("");

  useEffect(() => {
    if (data) {
      setName(data.name);
      setDisplayName(data.company_display_name ?? "");
      setColor(data.primary_color ?? "");
      setSubdomain(data.subdomain ?? "");
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api.patch("/api/tenants/current", {
        name,
        company_display_name: displayName,
        primary_color: color,
        subdomain,
      }),
    onSuccess: async () => {
      await refetch();
      await fetchMe();
      toast.success("Сохранено");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.post("/api/tenants/current/logo", fd, { headers: { "Content-Type": "multipart/form-data" } });
    },
    onSuccess: async () => {
      await refetch();
      await fetchMe();
      toast.success("Логотип обновлён");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const removeLogo = useMutation({
    mutationFn: () => api.delete("/api/tenants/current/logo"),
    onSuccess: async () => {
      await refetch();
      await fetchMe();
    },
  });

  if (!data) return <Loader />;

  return (
    <div className="card space-y-4 p-6">
      <div className="flex items-center gap-3">
        {data.logo_url ? (
          <img src={data.logo_url} alt="" className="h-14 w-14 rounded-lg object-contain border" />
        ) : (
          <div className="grid h-14 w-14 place-items-center rounded-lg border bg-neutral-100 text-neutral-500 dark:bg-neutral-800">
            {data.name.charAt(0)}
          </div>
        )}
        <div>
          <label className="btn-ghost cursor-pointer">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadLogo.mutate(f);
              }}
            />
            Загрузить логотип
          </label>
          {data.logo_url && (
            <button className="btn-ghost ml-2 text-rose-600" onClick={() => removeLogo.mutate()}>Удалить</button>
          )}
          <div className="mt-1 text-xs text-neutral-500">PNG, JPEG, WebP или SVG · до 2 МБ</div>
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название компании</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Отображаемое название (опционально)</span>
        <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Основной цвет (#RRGGBB)</span>
        <input
          className="input"
          type="text"
          placeholder="#6366f1"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Поддомен (acme.qadam.kz)</span>
        <input
          className="input"
          type="text"
          placeholder="acme"
          value={subdomain}
          onChange={(e) => setSubdomain(e.target.value)}
        />
      </label>

      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
          Сохранить
        </button>
      </div>
    </div>
  );
}


type Usage = {
  plan: string;
  limits: Record<string, number | null>;
  usage: { users: number; projects: number; storage_bytes: number };
};

type Sub = {
  plan: string;
  status: string;
  current_period_end: string | null;
};

type PlanInfo = {
  key: string;
  title: string;
  tagline: string;
  price_month: number | null;
  currency: string;
  features: string[];
  limits: Record<string, number | null>;
};

function formatPrice(price: number | null, currency: string): string {
  if (price === null) return "По запросу";
  if (price === 0) return "Бесплатно";
  return `${new Intl.NumberFormat("ru-RU").format(price)} ${currency} / мес`;
}

function BillingSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { fetchMe } = useAuth();
  const { data: sub } = useQuery({
    queryKey: ["billing-sub"],
    queryFn: async () => (await api.get<Sub>("/api/billing/subscription")).data,
  });
  const { data: usage } = useQuery({
    queryKey: ["tenant-usage"],
    queryFn: async () => (await api.get<Usage>("/api/tenants/current/usage")).data,
  });
  const { data: plans } = useQuery({
    queryKey: ["billing-plans"],
    queryFn: async () => (await api.get<PlanInfo[]>("/api/billing/plans")).data,
    staleTime: 60_000,
  });

  const subscribe = useMutation({
    mutationFn: (plan: string) => api.post("/api/billing/subscribe", { plan }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      await fetchMe();
      toast.success("Тариф обновлён");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="text-sm text-neutral-500">Текущий план</div>
        <div className="text-2xl font-semibold capitalize">{sub?.plan ?? "—"}</div>
        {sub?.current_period_end && (
          <div className="mt-1 text-xs text-neutral-500">
            Действует до {new Date(sub.current_period_end).toLocaleDateString("ru-RU")}
          </div>
        )}
      </div>

      {usage && (
        <div className="card grid gap-3 p-6 sm:grid-cols-3">
          <UsageBar label="Пользователи" used={usage.usage.users} limit={usage.limits.max_users as number | null} />
          <UsageBar label="Проекты" used={usage.usage.projects} limit={usage.limits.max_projects as number | null} />
          <UsageBar
            label="Хранилище"
            used={Math.round((usage.usage.storage_bytes / (1024 * 1024)) * 10) / 10}
            limit={usage.limits.max_storage_bytes ? Math.round((usage.limits.max_storage_bytes as number) / (1024 * 1024)) : null}
            unit="МБ"
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {(plans ?? []).map((p) => {
          const current = sub?.plan === p.key;
          return (
            <div
              key={p.key}
              className={clsx(
                "card flex flex-col p-5",
                current && "ring-2 ring-brand-500",
              )}
            >
              <div className="flex items-start justify-between">
                <div className="text-lg font-semibold">{p.title}</div>
                {current && (
                  <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                    Активен
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-neutral-500">{p.tagline}</div>

              <div className="mt-3 text-2xl font-semibold tabular-nums">
                {formatPrice(p.price_month, p.currency)}
              </div>

              <ul className="mt-4 space-y-1.5 text-sm text-neutral-700 dark:text-neutral-300">
                {p.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <button
                className="btn-primary mt-5 w-full disabled:opacity-50"
                disabled={current || subscribe.isPending}
                onClick={() => subscribe.mutate(p.key)}
              >
                {current ? "Текущий" : p.price_month === null ? "Связаться" : "Переключить"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UsageBar({
  label,
  used,
  limit,
  unit,
}: {
  label: string;
  used: number;
  limit: number | null;
  unit?: string;
}) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-lg font-medium tabular-nums">
        {used}
        {unit ? ` ${unit}` : ""} / {limit ?? "∞"}
        {limit && unit ? ` ${unit}` : ""}
      </div>
      {limit && (
        <div className="mt-1 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className={clsx("h-full rounded-full", pct >= 90 ? "bg-rose-500" : "bg-brand-500")}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
