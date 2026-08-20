import { useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api, extractApiError } from "@/api/client";
import type { Role, PermissionGroup } from "@/types";
import { Loader, Modal } from "@/components/ui";
import {
  Plus, Copy, Trash2, Save, CreditCard, Palette, UserPlus, Mail, Check,
  Clock, XCircle, RefreshCw, Users, HardDrive, Zap, Sparkles, Shield,
} from "lucide-react";
import { useAuth } from "@/store/auth";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";

type TabDef = {
  to: string;
  label: string;
  icon: typeof Save;
  ownerOnly?: boolean;
  perm?: string;
};

const SETTINGS_TABS: TabDef[] = [
  { to: "roles", label: "Роли и права", icon: Save, perm: "roles.manage" },
  { to: "team", label: "Команда", icon: UserPlus, perm: "users.create" },
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
          if (t.perm && !can(t.perm) && !isOwner) return null;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-brand-600 font-medium text-white shadow-sm hover:bg-brand-700"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-white",
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
        <Route path="team" element={(can("users.create") || isOwner) ? <TeamSettings /> : <Forbid />} />
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
  const confirm = useConfirm();
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
                onClick={() =>
                  confirm({
                    title: "Удалить роль?",
                    message: `Роль «${selected.name}» будет удалена.`,
                    danger: true,
                    confirmLabel: "Удалить",
                    onConfirm: () => delRole.mutateAsync(selected.id),
                  })
                }
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


type Invitation = {
  id: number;
  email: string;
  role_id: number | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string | null;
  inviter: { id: number; name: string } | null;
};

type InviteCreated = {
  id: number;
  email: string;
  role_id: number | null;
  token: string;
  invite_url: string;
  expires_at: string;
  email_sent: boolean;
};

function inviteStatus(inv: Invitation): "accepted" | "expired" | "pending" {
  if (inv.accepted_at) return "accepted";
  if (new Date(inv.expires_at).getTime() < Date.now()) return "expired";
  return "pending";
}

function TeamSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { me } = useAuth();
  const tenantId = me?.current_tenant?.id;

  const { data: roles } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await api.get<Role[]>("/api/roles")).data,
  });

  const { data: invites, isPending } = useQuery({
    enabled: !!tenantId,
    queryKey: ["invitations", tenantId],
    queryFn: async () =>
      (await api.get<Invitation[]>(`/api/tenants/${tenantId}/invitations`)).data,
    refetchOnMount: "always",
  });

  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState<string>("");
  const [lastCreated, setLastCreated] = useState<InviteCreated | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const body: { email: string; role_id?: number } = { email: email.trim() };
      if (roleId) body.role_id = Number(roleId);
      return (await api.post<InviteCreated>(`/api/tenants/${tenantId}/invite`, body)).data;
    },
    onSuccess: (data) => {
      setLastCreated(data);
      setEmail("");
      setRoleId("");
      qc.invalidateQueries({ queryKey: ["invitations", tenantId] });
      if (data.email_sent) {
        toast.success("Приглашение отправлено", `На ${data.email}`);
      } else {
        toast.success("Приглашение создано", "SMTP не настроен — скопируйте ссылку вручную");
      }
    },
    onError: (e) => toast.error("Не удалось создать", extractApiError(e).message),
  });

  const revoke = useMutation({
    mutationFn: (id: number) =>
      api.delete(`/api/tenants/${tenantId}/invitations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invitations", tenantId] });
      toast.success("Приглашение отозвано");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const resend = useMutation({
    mutationFn: async (inv: Invitation) => {
      const body: { email: string; role_id?: number } = { email: inv.email };
      if (inv.role_id) body.role_id = inv.role_id;
      return (await api.post<InviteCreated>(`/api/tenants/${tenantId}/invite`, body)).data;
    },
    onSuccess: (data) => {
      setLastCreated(data);
      qc.invalidateQueries({ queryKey: ["invitations", tenantId] });
      toast.success("Ссылка обновлена", data.email_sent ? "И письмо отправлено" : "Скопируйте новую ссылку");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Ссылка скопирована");
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  const roleName = (id: number | null) => {
    if (!id) return "Без роли";
    return roles?.find((r) => r.id === id)?.name ?? `Роль #${id}`;
  };

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <UserPlus size={18} className="text-brand-500" />
          <h2 className="text-base font-semibold">Пригласить в компанию</h2>
        </div>
        <p className="mb-4 text-sm text-neutral-500">
          Сотрудник получит письмо с ссылкой. Ссылка действует 7 дней. Если SMTP не настроен, вы сможете скопировать ссылку вручную ниже.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[220px]">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Email</span>
            <input
              className="input"
              type="email"
              placeholder="colleague@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && email.includes("@")) create.mutate();
              }}
            />
          </label>
          <label className="min-w-[180px]">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Роль</span>
            <select
              className="input"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
            >
              <option value="">Без роли</option>
              {roles?.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <button
            className="btn-primary"
            disabled={!email.includes("@") || create.isPending}
            onClick={() => create.mutate()}
          >
            <Mail size={15} /> Пригласить
          </button>
        </div>

        {lastCreated && (
          <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm dark:border-brand-800/40 dark:bg-brand-950/30">
            <div className="mb-2 flex items-center gap-2 text-brand-700 dark:text-brand-300">
              <Check size={16} />
              <span className="font-medium">Ссылка для {lastCreated.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="input flex-1 !py-1.5 text-xs font-mono"
                readOnly
                value={lastCreated.invite_url}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="btn-ghost !py-1.5"
                onClick={() => copyLink(lastCreated.invite_url)}
                title="Скопировать"
              >
                <Copy size={15} />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Отправленные приглашения</h2>
          <span className="text-xs text-neutral-500">{invites?.length ?? 0}</span>
        </div>

        {isPending ? (
          <Loader />
        ) : !invites || invites.length === 0 ? (
          <div className="py-10 text-center text-sm text-neutral-500">
            Пока никого не приглашали.
          </div>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {invites.map((inv) => {
              const status = inviteStatus(inv);
              return (
                <div key={inv.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{inv.email}</div>
                    <div className="mt-0.5 text-xs text-neutral-500">
                      {roleName(inv.role_id)}
                      {inv.inviter && <> · пригласил {inv.inviter.name}</>}
                      {inv.created_at && <> · {new Date(inv.created_at).toLocaleDateString("ru-RU")}</>}
                    </div>
                  </div>

                  <InviteStatusChip status={status} expiresAt={inv.expires_at} acceptedAt={inv.accepted_at} />

                  <div className="flex gap-1">
                    {status !== "accepted" && (
                      <button
                        className="btn-ghost !py-1.5 !px-2"
                        title={status === "expired" ? "Создать новую ссылку" : "Обновить и отправить снова"}
                        onClick={() => resend.mutate(inv)}
                        disabled={resend.isPending}
                      >
                        <RefreshCw size={14} />
                      </button>
                    )}
                    {status !== "accepted" && (
                      <button
                        className="btn-ghost !py-1.5 !px-2 text-rose-500"
                        title="Отозвать"
                        onClick={() =>
                          confirm({
                            title: "Отозвать приглашение?",
                            message: `Приглашение для ${inv.email} будет отозвано.`,
                            danger: true,
                            confirmLabel: "Отозвать",
                            onConfirm: () => revoke.mutateAsync(inv.id),
                          })
                        }
                        disabled={revoke.isPending}
                      >
                        <XCircle size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function InviteStatusChip({
  status,
  expiresAt,
  acceptedAt,
}: {
  status: "accepted" | "expired" | "pending";
  expiresAt: string;
  acceptedAt: string | null;
}) {
  if (status === "accepted") {
    return (
      <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
        <Check size={11} /> Принято
        {acceptedAt && ` · ${new Date(acceptedAt).toLocaleDateString("ru-RU")}`}
      </span>
    );
  }
  if (status === "expired") {
    return (
      <span className="chip bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
        <XCircle size={11} /> Просрочено
      </span>
    );
  }
  const days = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 86400_000));
  return (
    <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      <Clock size={11} /> Ожидает · ещё {days} д.
    </span>
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
          placeholder="#0F67FD"
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

function formatPrice(price: number | null, currency: string): { main: string; suffix?: string } {
  if (price === null) return { main: "По запросу" };
  if (price === 0) return { main: "Бесплатно" };
  return { main: new Intl.NumberFormat("ru-RU").format(price), suffix: `${currency} / мес` };
}

function formatLimit(v: number | null, unit?: string): string {
  if (v === null) return "Без лимита";
  return unit ? `${v.toLocaleString("ru-RU")} ${unit}` : v.toLocaleString("ru-RU");
}

function formatStorage(bytes: number | null): string {
  if (bytes === null) return "Без лимита";
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)} ГБ`;
  return `${Math.round(bytes / (1024 * 1024))} МБ`;
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

  const [pendingPlan, setPendingPlan] = useState<PlanInfo | null>(null);

  const subscribe = useMutation({
    mutationFn: (plan: string) => api.post("/api/billing/subscribe", { plan }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      await fetchMe();
      setPendingPlan(null);
      toast.success("Тариф обновлён");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const currentPlanInfo = plans?.find((p) => p.key === sub?.plan);
  const daysLeft = sub?.current_period_end
    ? Math.max(0, Math.round((new Date(sub.current_period_end).getTime() - Date.now()) / 86400_000))
    : null;

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Текущий план</div>
            <div className="mt-1 flex items-center gap-2">
              <div className="text-2xl font-semibold">{currentPlanInfo?.title ?? sub?.plan ?? "—"}</div>
              {sub?.status === "active" && (
                <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <Check size={11} /> Активен
                </span>
              )}
              {sub?.status === "past_due" && (
                <span className="chip bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  Просрочен платёж
                </span>
              )}
            </div>
            {currentPlanInfo?.tagline && (
              <div className="mt-1 text-sm text-neutral-500">{currentPlanInfo.tagline}</div>
            )}
          </div>
          {sub?.current_period_end && (
            <div className="text-right text-sm">
              <div className="text-neutral-500">Действует до</div>
              <div className="font-medium">
                {new Date(sub.current_period_end).toLocaleDateString("ru-RU")}
              </div>
              {daysLeft !== null && (
                <div className={clsx("text-xs", daysLeft <= 7 ? "text-rose-600" : "text-neutral-500")}>
                  ещё {daysLeft} дн.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {usage && (
        <div className="card p-6">
          <div className="mb-4 text-sm font-medium text-neutral-700 dark:text-neutral-300">Использование</div>
          <div className="grid gap-4 sm:grid-cols-3">
            <UsageBar
              icon={<Users size={14} />}
              label="Пользователи"
              used={usage.usage.users}
              limit={usage.limits.max_users as number | null}
            />
            <UsageBar
              icon={<Sparkles size={14} />}
              label="Проекты"
              used={usage.usage.projects}
              limit={usage.limits.max_projects as number | null}
            />
            <UsageBar
              icon={<HardDrive size={14} />}
              label="Хранилище"
              used={Math.round((usage.usage.storage_bytes / (1024 * 1024)) * 10) / 10}
              limit={usage.limits.max_storage_bytes ? Math.round((usage.limits.max_storage_bytes as number) / (1024 * 1024)) : null}
              unit="МБ"
            />
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold">Тарифы</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {(plans ?? []).map((p) => {
            const current = sub?.plan === p.key;
            const isPopular = p.key === "pro";
            const price = formatPrice(p.price_month, p.currency);
            return (
              <div
                key={p.key}
                className={clsx(
                  "relative flex flex-col rounded-2xl border bg-white p-6 transition-all dark:bg-neutral-900/60",
                  current
                    ? "border-brand-500 ring-2 ring-brand-500 shadow-lg"
                    : isPopular
                      ? "border-brand-300 shadow-md dark:border-brand-800/50"
                      : "border-neutral-200 dark:border-neutral-800",
                )}
              >
                {isPopular && !current && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-brand-500 to-brand-600 px-3 py-0.5 text-[11px] font-semibold text-white shadow">
                      <Sparkles size={11} /> Популярный
                    </span>
                  </div>
                )}
                {current && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-0.5 text-[11px] font-semibold text-white shadow">
                      <Check size={11} /> Ваш тариф
                    </span>
                  </div>
                )}

                <div className="mb-1 flex items-center gap-2">
                  <div className="text-xl font-semibold">{p.title}</div>
                  {p.key === "enterprise" && <Shield size={16} className="text-brand-500" />}
                </div>
                <div className="min-h-[36px] text-sm text-neutral-500">{p.tagline}</div>

                <div className="mt-4 flex items-baseline gap-1">
                  <div className="text-3xl font-bold tabular-nums">{price.main}</div>
                  {price.suffix && (
                    <div className="text-sm text-neutral-500">{price.suffix}</div>
                  )}
                </div>

                <div className="my-5 border-t border-neutral-100 dark:border-neutral-800" />

                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Лимиты
                </div>
                <dl className="mb-4 space-y-1.5 text-sm">
                  <LimitRow icon={<Users size={13} />} label="Пользователей" value={formatLimit(p.limits.max_users as number | null)} />
                  <LimitRow icon={<Sparkles size={13} />} label="Проектов" value={formatLimit(p.limits.max_projects as number | null)} />
                  <LimitRow icon={<HardDrive size={13} />} label="Хранилище" value={formatStorage(p.limits.max_storage_bytes as number | null)} />
                  <LimitRow icon={<Zap size={13} />} label="API req/min" value={formatLimit(p.limits.api_rate_per_min as number | null)} />
                </dl>

                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Что входит
                </div>
                <ul className="flex-1 space-y-1.5 text-sm text-neutral-700 dark:text-neutral-300">
                  {p.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <button
                  className={clsx(
                    "mt-6 w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60",
                    current
                      ? "bg-neutral-100 text-neutral-500 cursor-default dark:bg-neutral-800"
                      : isPopular
                        ? "bg-brand-600 text-white hover:bg-brand-700"
                        : "border border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800",
                  )}
                  disabled={current || subscribe.isPending}
                  onClick={() => {
                    if (p.price_month === null) {
                      window.location.href = "mailto:sales@qadam.kz?subject=Enterprise-тариф Qadam CRM";
                      return;
                    }
                    setPendingPlan(p);
                  }}
                >
                  {current ? "Текущий тариф" : p.price_month === null ? "Связаться" : "Перейти на этот тариф"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card p-4 text-xs text-neutral-500">
        <div className="flex items-start gap-2">
          <Shield size={14} className="mt-0.5 shrink-0" />
          <span>
            При переходе на другой тариф текущий период сбрасывается и начинается новый (30 дней).
            Оплата пока в тестовом режиме — все переходы бесплатны. Полноценный биллинг через Kaspi Pay / Stripe скоро.
          </span>
        </div>
      </div>

      {pendingPlan && (
        <Modal open onClose={() => setPendingPlan(null)} title={`Перейти на «${pendingPlan.title}»?`}>
          <div className="space-y-3">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Тариф изменится сразу. Если новые лимиты меньше текущего использования, часть операций может быть заблокирована.
            </p>
            <div className="rounded-lg bg-neutral-50 p-3 text-sm dark:bg-neutral-800/50">
              <div className="flex justify-between">
                <span className="text-neutral-500">Стоимость</span>
                <span className="font-medium">
                  {pendingPlan.price_month === 0
                    ? "Бесплатно"
                    : `${new Intl.NumberFormat("ru-RU").format(pendingPlan.price_month ?? 0)} ${pendingPlan.currency} / мес`}
                </span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-neutral-500">Пользователей</span>
                <span className="font-medium">{formatLimit(pendingPlan.limits.max_users as number | null)}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-neutral-500">Проектов</span>
                <span className="font-medium">{formatLimit(pendingPlan.limits.max_projects as number | null)}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setPendingPlan(null)}>Отмена</button>
              <button
                className="btn-primary"
                disabled={subscribe.isPending}
                onClick={() => subscribe.mutate(pendingPlan.key)}
              >
                Подтвердить
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function LimitRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
        {icon} {label}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function UsageBar({
  icon,
  label,
  used,
  limit,
  unit,
}: {
  icon?: React.ReactNode;
  label: string;
  used: number;
  limit: number | null;
  unit?: string;
}) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-lg font-medium tabular-nums">
        {used}
        {unit ? ` ${unit}` : ""}
        <span className="ml-1 text-sm font-normal text-neutral-500">
          / {limit ?? "∞"}
          {limit && unit ? ` ${unit}` : ""}
        </span>
      </div>
      {limit && (
        <div className="mt-1 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className={clsx(
              "h-full rounded-full transition-all",
              pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-500" : "bg-brand-500",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
