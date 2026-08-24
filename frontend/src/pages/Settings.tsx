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
  GripVertical, Eye,
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
  { to: "forms", label: "Формы захвата", icon: Zap, perm: "leads.manage_forms" },
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
        <Route path="forms" element={can("leads.manage_forms") ? <LeadFormsSettings /> : <Forbid />} />
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
  const toast = useToast();
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
    onError: (e) => toast.error("Не удалось удалить роль", extractApiError(e).message),
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
  email_error?: string | null;
};

const EMAIL_ERROR_MESSAGE: Record<string, string> = {
  smtp_not_configured: "SMTP не настроен — скопируйте ссылку вручную",
  celery_unavailable: "Очередь отправки недоступна — скопируйте ссылку вручную",
};

function emailErrorText(code?: string | null): string {
  if (!code) return "Письмо не отправлено — скопируйте ссылку вручную";
  return EMAIL_ERROR_MESSAGE[code] || `Письмо не отправлено (${code}) — скопируйте ссылку вручную`;
}

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
        toast.info("Приглашение создано", emailErrorText(data.email_error));
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
      if (data.email_sent) {
        toast.success("Ссылка обновлена", "Письмо отправлено повторно");
      } else {
        toast.info("Ссылка обновлена", emailErrorText(data.email_error));
      }
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

  const usageWarnings = usage
    ? [
        {
          label: "Пользователи",
          status: getUsageStatus(usage.usage.users, usage.limits.max_users as number | null),
        },
        {
          label: "Проекты",
          status: getUsageStatus(usage.usage.projects, usage.limits.max_projects as number | null),
        },
        {
          label: "Хранилище",
          status: getUsageStatus(
            usage.usage.storage_bytes,
            usage.limits.max_storage_bytes as number | null,
          ),
        },
      ].filter((x) => x.status !== "ok")
    : [];
  const hasCritical = usageWarnings.some((x) => x.status === "critical");

  return (
    <div className="space-y-4">
      {usageWarnings.length > 0 && (
        <div
          role="alert"
          className={clsx(
            "rounded-xl border px-4 py-3 text-sm",
            hasCritical
              ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
              : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200",
          )}
        >
          <div className="font-medium">
            {hasCritical ? "Лимиты тарифа исчерпаны" : "Приближаетесь к лимитам тарифа"}
          </div>
          <div className="mt-1">
            {usageWarnings.map((w) => w.label).join(", ")}. Перейдите на более крупный тариф ниже,
            чтобы избежать блокировок при создании ресурсов.
          </div>
        </div>
      )}
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

export type UsageStatus = "ok" | "warning" | "critical";

export function getUsageStatus(used: number, limit: number | null | undefined): UsageStatus {
  if (!limit) return "ok";
  const pct = (used / limit) * 100;
  if (pct >= 100) return "critical";
  if (pct >= 80) return "warning";
  return "ok";
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
  const status = getUsageStatus(used, limit);
  const barColor =
    status === "critical" ? "bg-rose-500" : status === "warning" ? "bg-amber-500" : "bg-brand-500";
  const textColor =
    status === "critical"
      ? "text-rose-600 dark:text-rose-400"
      : status === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : "";
  const suffix = unit ? ` ${unit}` : "";
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">
        {icon}
        {label}
      </div>
      <div className={clsx("mt-0.5 text-lg font-medium tabular-nums", textColor)}>
        {used}
        {suffix}
        <span className="ml-1 text-sm font-normal text-neutral-500">
          / {limit ?? "∞"}
          {limit && unit ? ` ${unit}` : ""}
        </span>
      </div>
      {limit && (
        <div
          className="mt-1 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${used}${suffix} из ${limit}${suffix}`}
          title={`${pct}%`}
        >
          <div
            className={clsx("h-full rounded-full transition-all", barColor)}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {status !== "ok" && (
        <div className={clsx("mt-1 text-xs", textColor)}>
          {status === "critical"
            ? "Лимит исчерпан — обновите тариф"
            : `Осталось ${Math.max(0, (limit ?? 0) - used)}${suffix} до лимита`}
        </div>
      )}
    </div>
  );
}


// ==========================================================================
// LeadFormsSettings — конструктор форм захвата (LF6)
// ==========================================================================

type FormFieldT = {
  key: string;
  label: string;
  type: "text" | "email" | "phone" | "textarea" | "select" | "number";
  required: boolean;
  placeholder?: string | null;
  options?: string[] | null;
};

type LeadFormT = {
  id: number;
  name: string;
  slug: string;
  title: string;
  subtitle: string | null;
  submit_label: string;
  success_message: string;
  brand_color: string;
  fields_config: FormFieldT[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const FIELD_TYPES: { value: FormFieldT["type"]; label: string }[] = [
  { value: "text", label: "Текст" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Телефон" },
  { value: "textarea", label: "Многострочный" },
  { value: "select", label: "Выпадающий" },
  { value: "number", label: "Число" },
];

function LeadFormsSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { me } = useAuth();

  const { data: forms, isPending } = useQuery({
    queryKey: ["lead-forms"],
    queryFn: async () => (await api.get<LeadFormT[]>("/api/lead-forms")).data,
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = useMemo(() => forms?.find((f) => f.id === selectedId) ?? forms?.[0] ?? null, [forms, selectedId]);

  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post<LeadFormT>("/api/lead-forms", {
          name: "Новая форма",
          fields_config: [
            { key: "name", label: "Имя", type: "text", required: true },
            { key: "phone", label: "Телефон", type: "phone", required: true },
          ],
        })
      ).data,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["lead-forms"] });
      setSelectedId(data.id);
    },
    onError: (e) => toast.error("Не удалось создать", extractApiError(e).message),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/lead-forms/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-forms"] });
      setSelectedId(null);
      toast.success("Форма удалена");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  if (isPending) return <Loader />;

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <div className="card p-2">
        <div className="mb-1 flex items-center justify-between px-2 py-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Формы</span>
          <button className="btn-ghost !p-1" title="Создать форму" onClick={() => create.mutate()}>
            <Plus size={14} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          {(forms ?? []).map((f) => (
            <button
              key={f.id}
              onClick={() => setSelectedId(f.id)}
              className={clsx(
                "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                selected?.id === f.id
                  ? "bg-brand-50 text-brand-800 dark:bg-brand-900/25 dark:text-brand-200"
                  : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60",
              )}
            >
              <Zap size={14} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{f.name}</div>
                <div className="truncate text-xs text-neutral-500">/{f.slug}</div>
              </div>
              {!f.is_active && <span className="chip bg-neutral-200 text-neutral-600 dark:bg-neutral-800">off</span>}
            </button>
          ))}
          {(!forms || forms.length === 0) && (
            <div className="p-4 text-center text-sm text-neutral-500">
              Форм пока нет.<br />
              <button className="mt-2 text-brand-600" onClick={() => create.mutate()}>Создать первую</button>
            </div>
          )}
        </div>
      </div>

      {selected ? (
        <LeadFormEditor
          form={selected}
          tenantSlug={me?.current_tenant?.slug ?? ""}
          onDelete={async () => {
            if (await confirm({ title: "Удалить форму?", message: "Заявки останутся, но новые перестанут приниматься.", confirmLabel: "Удалить" })) {
              del.mutate(selected.id);
            }
          }}
        />
      ) : (
        <div className="card p-8 text-center text-sm text-neutral-500">Создайте форму слева</div>
      )}
    </div>
  );
}

function LeadFormEditor({
  form,
  tenantSlug,
  onDelete,
}: {
  form: LeadFormT;
  tenantSlug: string;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<LeadFormT>(form);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(form);
    setDirty(false);
  }, [form.id]);

  const upd = <K extends keyof LeadFormT>(k: K, v: LeadFormT[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/lead-forms/${form.id}`, {
        name: draft.name,
        title: draft.title,
        subtitle: draft.subtitle,
        submit_label: draft.submit_label,
        success_message: draft.success_message,
        brand_color: draft.brand_color,
        is_active: draft.is_active,
        fields_config: draft.fields_config,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-forms"] });
      setDirty(false);
      toast.success("Сохранено");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const updField = (idx: number, patch: Partial<FormFieldT>) => {
    setDraft((d) => ({
      ...d,
      fields_config: d.fields_config.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    }));
    setDirty(true);
  };

  const addField = () => {
    setDraft((d) => ({
      ...d,
      fields_config: [
        ...d.fields_config,
        { key: `field_${d.fields_config.length + 1}`, label: "Новое поле", type: "text", required: false },
      ],
    }));
    setDirty(true);
  };

  const removeField = (idx: number) => {
    setDraft((d) => ({ ...d, fields_config: d.fields_config.filter((_, i) => i !== idx) }));
    setDirty(true);
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    setDraft((d) => {
      const next = [...d.fields_config];
      const to = idx + dir;
      if (to < 0 || to >= next.length) return d;
      [next[idx], next[to]] = [next[to], next[idx]];
      return { ...d, fields_config: next };
    });
    setDirty(true);
  };

  const embedCode = `<script src="${window.location.origin}/embed.js" async></script>\n<div data-qadam-form="${tenantSlug}/${form.id}"></div>`;
  const directLink = `${window.location.origin}/f/${tenantSlug}/${form.id}`;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <input
            className="input max-w-sm text-lg font-medium"
            value={draft.name}
            onChange={(e) => upd("name", e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.is_active}
              onChange={(e) => upd("is_active", e.target.checked)}
            />
            Активна
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Заголовок</span>
            <input className="input" value={draft.title} onChange={(e) => upd("title", e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Кнопка отправки</span>
            <input
              className="input"
              value={draft.submit_label}
              onChange={(e) => upd("submit_label", e.target.value)}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Подзаголовок</span>
            <input
              className="input"
              value={draft.subtitle || ""}
              onChange={(e) => upd("subtitle", e.target.value)}
              placeholder="Опционально"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Сообщение после отправки</span>
            <input
              className="input"
              value={draft.success_message}
              onChange={(e) => upd("success_message", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Цвет кнопки</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={draft.brand_color}
                onChange={(e) => upd("brand_color", e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border"
              />
              <input
                className="input flex-1"
                value={draft.brand_color}
                onChange={(e) => upd("brand_color", e.target.value)}
              />
            </div>
          </label>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Поля формы</span>
            <button className="btn-ghost !py-1 text-xs" onClick={addField}>
              <Plus size={12} className="mr-1" /> Поле
            </button>
          </div>
          <div className="space-y-2">
            {draft.fields_config.map((f, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[auto_1fr_1fr_120px_auto_auto] items-center gap-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800"
              >
                <div className="flex flex-col text-neutral-400">
                  <button className="hover:text-neutral-700" title="Вверх" onClick={() => moveField(idx, -1)}>
                    ▲
                  </button>
                  <button className="hover:text-neutral-700" title="Вниз" onClick={() => moveField(idx, 1)}>
                    ▼
                  </button>
                </div>
                <input
                  className="input !py-1 text-sm"
                  value={f.key}
                  placeholder="ключ (латиница)"
                  onChange={(e) => updField(idx, { key: e.target.value })}
                />
                <input
                  className="input !py-1 text-sm"
                  value={f.label}
                  placeholder="Название"
                  onChange={(e) => updField(idx, { label: e.target.value })}
                />
                <select
                  className="input !py-1 text-sm"
                  value={f.type}
                  onChange={(e) => updField(idx, { type: e.target.value as FormFieldT["type"] })}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => updField(idx, { required: e.target.checked })}
                  />
                  обяз.
                </label>
                <button
                  className="rounded p-1 text-neutral-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                  title="Удалить"
                  onClick={() => removeField(idx)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {draft.fields_config.length === 0 && (
              <div className="rounded-lg border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500 dark:border-neutral-700">
                Полей пока нет. Добавьте хотя бы одно.
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <button
            className="btn-ghost inline-flex items-center gap-1 text-rose-600 dark:text-rose-400"
            onClick={onDelete}
          >
            <Trash2 size={14} /> Удалить форму
          </button>
          <button
            className="btn-primary"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            <Save size={14} className="mr-1" /> Сохранить
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Превью</span>
            <Eye size={14} className="text-neutral-400" />
          </div>
          <FormPreview form={draft} />
        </div>

        <div className="card p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Прямая ссылка</div>
          <div className="flex gap-1">
            <input className="input flex-1 text-xs" readOnly value={directLink} onClick={(e) => (e.target as HTMLInputElement).select()} />
            <button
              className="btn-ghost !px-2"
              title="Скопировать"
              onClick={() => {
                navigator.clipboard.writeText(directLink);
                toast.success("Ссылка скопирована");
              }}
            >
              <Copy size={13} />
            </button>
          </div>
          <div className="mb-2 mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Embed-код</div>
          <textarea
            className="input min-h-[80px] font-mono text-[11px]"
            readOnly
            value={embedCode}
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />
          <button
            className="btn-ghost mt-1 !py-1 text-xs"
            onClick={() => {
              navigator.clipboard.writeText(embedCode);
              toast.success("Embed-код скопирован");
            }}
          >
            <Copy size={12} className="mr-1" /> Скопировать
          </button>
        </div>
      </div>
    </div>
  );
}

function FormPreview({ form }: { form: LeadFormT }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="mb-1 text-base font-medium">{form.title}</div>
      {form.subtitle && <div className="mb-3 text-xs text-neutral-500">{form.subtitle}</div>}
      <div className="space-y-2">
        {form.fields_config.map((f) => (
          <div key={f.key}>
            <label className="mb-0.5 block text-[11px] font-medium text-neutral-500">
              {f.label} {f.required && <span className="text-rose-500">*</span>}
            </label>
            {f.type === "textarea" ? (
              <textarea className="input min-h-[60px] text-xs" placeholder={f.placeholder || ""} readOnly />
            ) : (
              <input className="input text-xs" placeholder={f.placeholder || ""} readOnly />
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-3 w-full rounded-lg py-2 text-xs font-medium text-white"
        style={{ background: form.brand_color }}
      >
        {form.submit_label}
      </button>
    </div>
  );
}
