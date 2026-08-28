import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Route, Routes, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api, extractApiError } from "@/api/client";
import type { Role, PermissionGroup } from "@/types";
import { Loader, Modal } from "@/components/ui";
import {
  Plus, Copy, Trash2, Save, CreditCard, Palette, UserPlus, Mail, Check,
  Clock, XCircle, RefreshCw, Users, HardDrive, Zap, Sparkles, Shield,
  GripVertical, Eye, Phone, Hash, AlignLeft, ChevronDown, MessageCircle,
  Loader2, ExternalLink, CalendarClock,
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
  { to: "manager-availability", label: "Расписание менеджеров", icon: Clock, perm: "leads.view" },
  { to: "messengers", label: "Открытые линии", icon: MessageCircle, perm: "messengers.manage" },
  { to: "mailbox", label: "Почта", icon: Mail, perm: "mail.use" },
  { to: "booking", label: "Букинг", icon: CalendarClock, perm: "booking.use" },
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
        <Route
          path="manager-availability"
          element={can("leads.view") ? <ManagerAvailabilitySettings /> : <Forbid />}
        />
        <Route
          path="messengers"
          element={can("messengers.manage") ? <MessengersSettings /> : <Forbid />}
        />
        <Route
          path="mailbox"
          element={can("mail.use") ? <MailboxSettings /> : <Forbid />}
        />
        <Route
          path="booking"
          element={can("booking.use") ? <BookingSettings /> : <Forbid />}
        />
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

type AssigneeStrategy = "manual" | "round_robin" | "least_loaded" | "schedule";

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
  assignee_strategy: AssigneeStrategy;
  default_assignee_id: number | null;
  created_at: string;
  updated_at: string;
};

const STRATEGY_LABEL: Record<AssigneeStrategy, string> = {
  manual: "Вручную",
  round_robin: "По кругу (round-robin)",
  least_loaded: "Наименее загруженному",
  schedule: "По расписанию (на смене)",
};

const STRATEGY_HINT: Record<AssigneeStrategy, string> = {
  manual: "Лиды приходят без назначения — менеджер выбирается вручную",
  round_robin: "Автоматически распределяются по кругу между менеджерами с правом «просмотр лидов»",
  least_loaded: "Отдаётся менеджеру с наименьшим количеством открытых лидов",
  schedule: "Только менеджерам, которые сейчас на смене и не превысили квоту; резерв — вручную",
};

type TenantUser = { id: number; name: string; email: string };

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
  const [addFieldOpen, setAddFieldOpen] = useState(false);

  // Список менеджеров tenant для селекта default_assignee.
  const { data: tenantUsers } = useQuery({
    queryKey: ["tenant-users-for-forms"],
    queryFn: async () =>
      (await api.get<{ items: TenantUser[] }>("/api/users", { params: { per_page: 200 } }))
        .data.items,
    staleTime: 60_000,
  });

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
        assignee_strategy: draft.assignee_strategy,
        default_assignee_id: draft.default_assignee_id,
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

  const addField = (spec: { label: string; key: string; type: FormFieldT["type"]; required: boolean }) => {
    // Гарантируем уникальность ключа.
    const existing = new Set(draft.fields_config.map((f) => f.key));
    let key = spec.key;
    if (existing.has(key)) {
      let n = 2;
      while (existing.has(`${spec.key}_${n}`)) n += 1;
      key = `${spec.key}_${n}`;
    }
    setDraft((d) => ({
      ...d,
      fields_config: [
        ...d.fields_config,
        { key, label: spec.label, type: spec.type, required: spec.required },
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
  const apiEndpoint = `${window.location.origin}/api/f/${tenantSlug}/${form.id}`;
  const apiPayload = draft.fields_config.reduce<Record<string, string>>((acc, f) => {
    acc[f.key] = f.type === "email"
      ? "you@company.com"
      : f.type === "phone"
      ? "+7 700 000 00 00"
      : f.type === "number"
      ? "42"
      : `<${f.label}>`;
    return acc;
  }, {});
  const apiCurl = `curl -X POST '${apiEndpoint}' \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify({ payload: Object.keys(apiPayload).length ? apiPayload : { name: "Иван", contact: "+7 700 000 00 00" } })}'`;

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
            <button className="btn-ghost !py-1 text-xs" onClick={() => setAddFieldOpen(true)}>
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

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Распределение лидов
            </span>
            <Link to="/settings/manager-availability" className="text-xs link">
              Настроить расписание
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-500">Стратегия</span>
              <select
                className="input"
                value={draft.assignee_strategy}
                onChange={(e) => upd("assignee_strategy", e.target.value as AssigneeStrategy)}
              >
                {(Object.keys(STRATEGY_LABEL) as AssigneeStrategy[]).map((s) => (
                  <option key={s} value={s}>
                    {STRATEGY_LABEL[s]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-neutral-500">
                {STRATEGY_HINT[draft.assignee_strategy]}
              </p>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-500">
                Менеджер по умолчанию
                {draft.assignee_strategy === "schedule" && " (fallback вне смены)"}
              </span>
              <select
                className="input"
                value={draft.default_assignee_id ?? ""}
                onChange={(e) =>
                  upd("default_assignee_id", e.target.value ? Number(e.target.value) : null)
                }
                disabled={
                  draft.assignee_strategy === "round_robin" ||
                  draft.assignee_strategy === "least_loaded"
                }
              >
                <option value="">— не выбран —</option>
                {(tenantUsers ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            </label>
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

        <div className="card p-4">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">API endpoint</div>
          <p className="mb-2 text-[11px] text-neutral-500">
            Если у вас уже есть своя форма, шлите заявки прямо на этот URL — авторизация не нужна.
          </p>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">POST</div>
          <div className="flex gap-1">
            <input className="input flex-1 font-mono text-[11px]" readOnly value={apiEndpoint} onClick={(e) => (e.target as HTMLInputElement).select()} />
            <button
              className="btn-ghost !px-2"
              title="Скопировать URL"
              onClick={() => {
                navigator.clipboard.writeText(apiEndpoint);
                toast.success("URL скопирован");
              }}
            >
              <Copy size={13} />
            </button>
          </div>

          <div className="mt-3 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
            Пример запроса (curl)
          </div>
          <textarea
            className="input min-h-[110px] font-mono text-[10.5px] leading-snug"
            readOnly
            value={apiCurl}
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />
          <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500">
            <span>Ответ: <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">{`{"message":"..."}`}</code></span>
            <button
              className="btn-ghost !py-1 text-xs"
              onClick={() => {
                navigator.clipboard.writeText(apiCurl);
                toast.success("curl скопирован");
              }}
            >
              <Copy size={12} className="mr-1" /> Скопировать
            </button>
          </div>
          <div className="mt-2 rounded-md bg-neutral-50 p-2 text-[11px] text-neutral-500 dark:bg-neutral-800/40">
            <b>Совет:</b> добавьте скрытое поле <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">website_url</code> —
            если бот заполнит его, заявка тихо отбрасывается (honeypot).
          </div>
        </div>
      </div>

      {addFieldOpen && (
        <AddFieldModal
          existingKeys={draft.fields_config.map((f) => f.key)}
          onClose={() => setAddFieldOpen(false)}
          onAdd={(spec) => {
            addField(spec);
            setAddFieldOpen(false);
          }}
        />
      )}
    </div>
  );
}

function slugifyKey(label: string): string {
  // Транслит кириллицы → латиница, потом snake_case, отсекаем цифру в начале.
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh",
    щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  const translit = label
    .toLowerCase()
    .split("")
    .map((c) => (c in map ? map[c] : c))
    .join("");
  let s = translit.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (/^[0-9]/.test(s)) s = `f_${s}`;
  return s.slice(0, 50) || "field";
}

function AddFieldModal({
  onClose,
  onAdd,
  existingKeys,
}: {
  onClose: () => void;
  onAdd: (spec: { label: string; key: string; type: FormFieldT["type"]; required: boolean }) => void;
  existingKeys: string[];
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FormFieldT["type"]>("text");
  const [required, setRequired] = useState(false);
  const [keyManual, setKeyManual] = useState<string | null>(null);

  // Ключ по умолчанию — авто-слаг с label, но если юзер вручную правил — не перезаписываем.
  const key = keyManual ?? (label ? slugifyKey(label) : "");
  const keyValid = /^[a-z][a-z0-9_]*$/.test(key);
  const collision = existingKeys.includes(key);
  const canSubmit = label.trim().length > 0 && key.length > 0 && keyValid;

  return (
    <Modal open onClose={onClose} title="Новое поле" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          onAdd({ label: label.trim(), key, type, required });
        }}
        className="space-y-3"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Название поля *</span>
          <input
            className="input"
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Например: Название компании"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Тип поля</span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as FormFieldT["type"])}>
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>

        <div className="block">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500">Ключ (латиница)</span>
            {keyManual !== null && (
              <button type="button" className="text-[11px] text-brand-600 hover:underline" onClick={() => setKeyManual(null)}>
                Авто из названия
              </button>
            )}
          </div>
          <input
            className="input font-mono text-xs"
            value={key}
            onChange={(e) => setKeyManual(e.target.value.toLowerCase())}
            placeholder="company_name"
          />
          {!keyValid && key.length > 0 && (
            <div className="mt-1 text-[11px] text-rose-500">
              Ключ должен начинаться с латинской буквы и содержать только a-z, 0-9, _
            </div>
          )}
          {keyValid && collision && (
            <div className="mt-1 text-[11px] text-amber-600">
              Такой ключ уже есть — при добавлении будет суффикс _2, _3 и т.д.
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Обязательное поле
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn-primary" disabled={!canSubmit}>
            <Plus size={13} /> Добавить
          </button>
        </div>
      </form>
    </Modal>
  );
}

function fieldIcon(type: FormFieldT["type"]) {
  switch (type) {
    case "email": return <Mail size={13} className="text-neutral-400" />;
    case "phone": return <Phone size={13} className="text-neutral-400" />;
    case "number": return <Hash size={13} className="text-neutral-400" />;
    case "textarea": return <AlignLeft size={13} className="text-neutral-400" />;
    case "select": return <ChevronDown size={13} className="text-neutral-400" />;
    default: return null;
  }
}

function fieldPlaceholder(f: FormFieldT): string {
  if (f.placeholder) return f.placeholder;
  switch (f.type) {
    case "email": return "you@company.com";
    case "phone": return "+7 700 000 00 00";
    case "number": return "0";
    case "textarea": return "Расскажите о задаче…";
    case "select": return "Выберите…";
    default: return f.label;
  }
}

function FormPreview({ form }: { form: LeadFormT }) {
  const [tab, setTab] = useState<"form" | "success">("form");
  const color = form.brand_color || "#0f67fd";

  return (
    <div className="space-y-2">
      <div className="flex overflow-hidden rounded-lg border border-neutral-200 text-xs dark:border-neutral-700">
        <button
          type="button"
          onClick={() => setTab("form")}
          className={clsx("flex-1 px-2 py-1", tab === "form" ? "bg-neutral-100 dark:bg-neutral-800" : "text-neutral-500")}
        >
          Форма
        </button>
        <button
          type="button"
          onClick={() => setTab("success")}
          className={clsx("flex-1 px-2 py-1", tab === "success" ? "bg-neutral-100 dark:bg-neutral-800" : "text-neutral-500")}
        >
          После отправки
        </button>
      </div>

      <div
        className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_10px_28px_-14px_rgba(23,23,31,0.18)] dark:border-neutral-700 dark:bg-neutral-900"
      >
        {/* Цветной хедер-бэйдж */}
        <div
          className="h-1.5 w-full"
          style={{ background: `linear-gradient(90deg, ${color}, ${color}80)` }}
        />
        {tab === "form" ? (
          <div className="p-4">
            <div className="mb-0.5 text-[15px] font-semibold leading-tight text-neutral-900 dark:text-white">
              {form.title || "Оставьте заявку"}
            </div>
            {form.subtitle && (
              <div className="mb-3 text-[11px] leading-snug text-neutral-500">{form.subtitle}</div>
            )}
            <div className="space-y-2.5">
              {form.fields_config.length === 0 && (
                <div className="rounded-lg border border-dashed border-neutral-300 p-4 text-center text-[11px] text-neutral-400 dark:border-neutral-700">
                  Добавьте хотя бы одно поле
                </div>
              )}
              {form.fields_config.map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block text-[10.5px] font-medium text-neutral-600 dark:text-neutral-400">
                    {f.label} {f.required && <span className="text-rose-500">*</span>}
                  </label>
                  <div className="relative">
                    {fieldIcon(f.type) && (
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
                        {fieldIcon(f.type)}
                      </span>
                    )}
                    {f.type === "textarea" ? (
                      <textarea
                        className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-2 text-[11.5px] leading-snug placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-800/40"
                        placeholder={fieldPlaceholder(f)}
                        rows={2}
                        readOnly
                      />
                    ) : f.type === "select" ? (
                      <div
                        className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-[11.5px] text-neutral-400 dark:border-neutral-700 dark:bg-neutral-800/40"
                      >
                        {fieldPlaceholder(f)}
                        <ChevronDown size={13} className="text-neutral-400" />
                      </div>
                    ) : (
                      <input
                        className={clsx(
                          "w-full rounded-lg border border-neutral-200 bg-neutral-50 py-1.5 text-[11.5px] placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-800/40",
                          fieldIcon(f.type) ? "pl-7 pr-2.5" : "px-2.5",
                        )}
                        placeholder={fieldPlaceholder(f)}
                        readOnly
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-3.5 w-full rounded-lg py-2 text-[12px] font-medium text-white shadow-[0_6px_18px_-8px_rgba(23,23,31,0.35)] transition-transform active:scale-[0.99]"
              style={{ background: `linear-gradient(180deg, ${color}, ${color}dd)` }}
            >
              {form.submit_label || "Отправить"}
            </button>
            <div className="mt-2 text-center text-[10px] text-neutral-400">
              powered by Qadam
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <div
              className="grid h-11 w-11 place-items-center rounded-full"
              style={{ background: `${color}22`, color }}
            >
              <Check size={22} />
            </div>
            <div className="text-sm font-semibold">Заявка отправлена</div>
            <div className="text-xs leading-snug text-neutral-500">
              {form.success_message || "Спасибо! Мы свяжемся с вами."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================================================
// ManagerAvailabilitySettings — рабочие часы менеджеров + отпуск + квота
// ==========================================================================

type ManagerAvailabilityRow = {
  user_id: number;
  user_name: string | null;
  user_email: string | null;
  timezone: string;
  working_hours: Record<string, [number, number] | null>;
  weekly_quota: number;
  is_available: boolean;
  vacation_from: string | null;
  vacation_until: string | null;
  on_shift_now: boolean;
};

const WEEKDAYS: { key: string; label: string }[] = [
  { key: "monday", label: "Пн" },
  { key: "tuesday", label: "Вт" },
  { key: "wednesday", label: "Ср" },
  { key: "thursday", label: "Чт" },
  { key: "friday", label: "Пт" },
  { key: "saturday", label: "Сб" },
  { key: "sunday", label: "Вс" },
];

const HOUR_OPTIONS = Array.from({ length: 25 }, (_, i) => i);
const TIMEZONE_PRESETS = [
  "Asia/Almaty", "Asia/Aqtobe", "Asia/Astana",
  "Europe/Moscow", "Europe/Kiev", "Europe/Istanbul",
  "UTC",
];

function ManagerAvailabilitySettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { me, can } = useAuth();
  const isOwner = !!me?.current_tenant?.is_owner;
  const canEditOthers = isOwner || can("users.update");

  const { data, isPending } = useQuery({
    queryKey: ["manager-availability"],
    queryFn: async () =>
      (await api.get<ManagerAvailabilityRow[]>("/api/manager-availability")).data,
  });

  const [drafts, setDrafts] = useState<Record<number, ManagerAvailabilityRow>>({});
  const [dirty, setDirty] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!data) return;
    const next: Record<number, ManagerAvailabilityRow> = {};
    for (const row of data) next[row.user_id] = row;
    setDrafts(next);
    setDirty(new Set());
  }, [data]);

  const save = useMutation({
    mutationFn: async (userId: number) => {
      const d = drafts[userId];
      if (!d) return;
      const isMe = me?.id === userId;
      const url = isMe ? "/api/manager-availability/me" : `/api/manager-availability/${userId}`;
      const method = isMe ? "put" : "patch";
      return (
        await api[method](url, {
          timezone: d.timezone,
          working_hours: d.working_hours,
          weekly_quota: d.weekly_quota,
          is_available: d.is_available,
          vacation_from: d.vacation_from,
          vacation_until: d.vacation_until,
        })
      ).data;
    },
    onSuccess: (_res, userId) => {
      qc.invalidateQueries({ queryKey: ["manager-availability"] });
      setDirty((s) => {
        const next = new Set(s);
        next.delete(userId);
        return next;
      });
      toast.success("Сохранено");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const updateDraft = (userId: number, patch: Partial<ManagerAvailabilityRow>) => {
    setDrafts((s) => ({ ...s, [userId]: { ...s[userId], ...patch } }));
    setDirty((s) => new Set(s).add(userId));
  };

  const toggleDay = (userId: number, day: string, on: boolean) => {
    const cur = drafts[userId]?.working_hours ?? {};
    const nextHours = { ...cur, [day]: on ? [9, 18] as [number, number] : null };
    updateDraft(userId, { working_hours: nextHours });
  };

  const updateHour = (userId: number, day: string, idx: 0 | 1, value: number) => {
    const cur = drafts[userId]?.working_hours ?? {};
    const hours = (cur[day] ?? [9, 18]) as [number, number];
    const next = [...hours] as [number, number];
    next[idx] = value;
    if (next[0] >= next[1]) {
      toast.error("Некорректно", "Час окончания должен быть больше начала");
      return;
    }
    updateDraft(userId, { working_hours: { ...cur, [day]: next } });
  };

  if (isPending) return <Loader />;
  if (!data || data.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-neutral-500">
        Нет менеджеров с правом «Просмотр лидов» — расписание нечему настраивать
      </div>
    );
  }

  const rows = Object.values(drafts).sort((a, b) =>
    (a.user_name || "").localeCompare(b.user_name || ""),
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-brand-50 p-3 text-xs text-brand-800 dark:bg-brand-950/30 dark:text-brand-200">
        Стратегия <b>«По расписанию»</b> в формах захвата учитывает эти часы: лид уходит только тому,
        кто сейчас на смене и не превысил квоту. <b>«Наименее загруженному»</b> — по количеству
        открытых лидов. <b>«По кругу»</b> и <b>«Вручную»</b> расписание не смотрят.
      </div>

      <div className="space-y-3">
        {rows.map((row) => {
          const isSelf = me?.id === row.user_id;
          const canEdit = isSelf || canEditOthers;
          const rowDirty = dirty.has(row.user_id);

          return (
            <div key={row.user_id} className="card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{row.user_name || "—"}</span>
                    {isSelf && (
                      <span className="chip bg-neutral-100 text-neutral-600 dark:bg-neutral-800">
                        это вы
                      </span>
                    )}
                    <span
                      className={clsx(
                        "chip",
                        row.on_shift_now
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800",
                      )}
                    >
                      {row.on_shift_now ? "На смене" : "Вне смены"}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-500">{row.user_email}</div>
                </div>
                <button
                  className="btn-primary"
                  disabled={!rowDirty || !canEdit || save.isPending}
                  onClick={() => save.mutate(row.user_id)}
                >
                  <Save size={13} className="mr-1" />
                  Сохранить
                </button>
              </div>

              <fieldset disabled={!canEdit} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-neutral-500">
                      Часовой пояс
                    </span>
                    <select
                      className="input"
                      value={row.timezone}
                      onChange={(e) => updateDraft(row.user_id, { timezone: e.target.value })}
                    >
                      {TIMEZONE_PRESETS.includes(row.timezone) ? null : (
                        <option value={row.timezone}>{row.timezone}</option>
                      )}
                      {TIMEZONE_PRESETS.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-neutral-500">
                      Квота (лидов в работе, 0 = ∞)
                    </span>
                    <input
                      type="number"
                      min={0}
                      className="input"
                      value={row.weekly_quota}
                      onChange={(e) =>
                        updateDraft(row.user_id, { weekly_quota: Number(e.target.value) || 0 })
                      }
                    />
                  </label>
                  <label className="flex items-center gap-2 pt-5 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-600"
                      checked={row.is_available}
                      onChange={(e) => updateDraft(row.user_id, { is_available: e.target.checked })}
                    />
                    Доступен для распределения
                  </label>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Рабочие часы (локальное время)
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {WEEKDAYS.map((d) => {
                      const hours = row.working_hours?.[d.key] ?? null;
                      const active = hours != null;
                      const [start, end] = hours ?? [9, 18];
                      return (
                        <div
                          key={d.key}
                          className="flex items-center gap-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800"
                        >
                          <label className="flex w-16 items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-brand-600"
                              checked={active}
                              onChange={(e) => toggleDay(row.user_id, d.key, e.target.checked)}
                            />
                            {d.label}
                          </label>
                          <select
                            className="input !py-1 text-sm"
                            value={start}
                            disabled={!active}
                            onChange={(e) =>
                              updateHour(row.user_id, d.key, 0, Number(e.target.value))
                            }
                          >
                            {HOUR_OPTIONS.slice(0, 24).map((h) => (
                              <option key={h} value={h}>
                                {String(h).padStart(2, "0")}:00
                              </option>
                            ))}
                          </select>
                          <span className="text-neutral-400">—</span>
                          <select
                            className="input !py-1 text-sm"
                            value={end}
                            disabled={!active}
                            onChange={(e) =>
                              updateHour(row.user_id, d.key, 1, Number(e.target.value))
                            }
                          >
                            {HOUR_OPTIONS.slice(1).map((h) => (
                              <option key={h} value={h}>
                                {String(h).padStart(2, "0")}:00
                              </option>
                            ))}
                          </select>
                          {!active && (
                            <span className="ml-1 text-xs text-neutral-400">выходной</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-neutral-500">
                      Отпуск с
                    </span>
                    <input
                      type="date"
                      className="input"
                      value={row.vacation_from ?? ""}
                      onChange={(e) =>
                        updateDraft(row.user_id, { vacation_from: e.target.value || null })
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-neutral-500">
                      Отпуск до
                    </span>
                    <input
                      type="date"
                      className="input"
                      value={row.vacation_until ?? ""}
                      onChange={(e) =>
                        updateDraft(row.user_id, { vacation_until: e.target.value || null })
                      }
                    />
                  </label>
                </div>
              </fieldset>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==========================================================================
// MessengersSettings — открытые линии: Telegram/WhatsApp/Instagram каналы,
// auto-reply правила, шаблоны быстрых ответов
// ==========================================================================

type ChannelKindT = "telegram" | "whatsapp" | "instagram";

const M_KIND_LABEL: Record<ChannelKindT, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
};

const M_KIND_HINT: Record<ChannelKindT, string> = {
  telegram: "Bot API — бесплатно. Создайте бота у @BotFather и вставьте токен ниже.",
  whatsapp: "WhatsApp Business Cloud API (Meta или 360dialog). Требует Business-аккаунт и BSP.",
  instagram: "Meta Graph API. Требует Instagram Business + связанную Facebook Page.",
};

type ChannelRow = {
  id: number;
  kind: ChannelKindT;
  name: string;
  provider_config: Record<string, string>;
  external_identifier: string | null;
  webhook_secret_set: boolean;
  is_active: boolean;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type RuleRow = {
  id: number;
  channel_id: number;
  kind: "welcome" | "off_hours" | "keyword";
  response_text: string;
  trigger_config: Record<string, unknown>;
  is_active: boolean;
  priority: number;
};

type TemplateRow = {
  id: number;
  name: string;
  body: string;
  kind: string;
  language: string;
  whatsapp_template_name: string | null;
};

function MessengersSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<"channels" | "templates">("channels");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: channels, isPending } = useQuery({
    queryKey: ["messenger-channels"],
    queryFn: async () => (await api.get<ChannelRow[]>("/api/messengers/channels")).data,
  });

  const selected = useMemo(
    () => channels?.find((c) => c.id === selectedId) ?? channels?.[0] ?? null,
    [channels, selectedId],
  );

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/messengers/channels/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messenger-channels"] });
      setSelectedId(null);
      toast.success("Канал удалён");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <div className="space-y-4">
      <nav className="flex gap-1 rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900/60 w-fit">
        <button
          className={clsx(
            "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
            tab === "channels"
              ? "bg-brand-50 text-brand-800 dark:bg-brand-900/25 dark:text-brand-200"
              : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800/60",
          )}
          onClick={() => setTab("channels")}
        >
          <MessageCircle size={14} /> Каналы
        </button>
        <button
          className={clsx(
            "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
            tab === "templates"
              ? "bg-brand-50 text-brand-800 dark:bg-brand-900/25 dark:text-brand-200"
              : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800/60",
          )}
          onClick={() => setTab("templates")}
        >
          <Sparkles size={14} /> Шаблоны быстрых ответов
        </button>
      </nav>

      {tab === "channels" && (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          <div className="card p-2">
            <div className="mb-1 flex items-center justify-between px-2 py-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Каналы</span>
              <button className="btn-ghost !p-1" title="Подключить канал" onClick={() => setCreating(true)}>
                <Plus size={14} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {isPending && <Loader />}
              {!isPending && (channels ?? []).length === 0 && (
                <div className="p-4 text-center text-sm text-neutral-500">
                  Каналов пока нет.<br />
                  <button className="mt-2 text-brand-600" onClick={() => setCreating(true)}>
                    Подключить первый
                  </button>
                </div>
              )}
              {(channels ?? []).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={clsx(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                    selected?.id === c.id
                      ? "bg-brand-50 text-brand-800 dark:bg-brand-900/25 dark:text-brand-200"
                      : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60",
                  )}
                >
                  <MessageCircle size={14} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="truncate text-xs text-neutral-500">{M_KIND_LABEL[c.kind]}</div>
                  </div>
                  {!c.is_active && (
                    <span className="chip bg-neutral-200 text-neutral-600 dark:bg-neutral-800">off</span>
                  )}
                  {c.last_error && (
                    <span className="chip bg-rose-100 text-rose-700 dark:bg-rose-950/30" title={c.last_error}>
                      !
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {selected ? (
            <ChannelEditor
              channel={selected}
              onDelete={async () => {
                if (await confirm({ title: "Удалить канал?", message: `Все диалоги и сообщения канала «${selected.name}» будут удалены.`, confirmLabel: "Удалить" })) {
                  del.mutate(selected.id);
                }
              }}
              onSaved={() => qc.invalidateQueries({ queryKey: ["messenger-channels"] })}
            />
          ) : (
            <div className="card p-8 text-center text-sm text-neutral-500">Выберите канал слева</div>
          )}
        </div>
      )}

      {tab === "templates" && <MessageTemplatesSettings />}

      {creating && (
        <CreateChannelModal
          onClose={() => setCreating(false)}
          onCreated={(newId) => {
            qc.invalidateQueries({ queryKey: ["messenger-channels"] });
            setSelectedId(newId);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function CreateChannelModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<ChannelKindT>("telegram");
  const [name, setName] = useState("");
  const [tgToken, setTgToken] = useState("");
  const [waApiUrl, setWaApiUrl] = useState("https://waba-v2.360dialog.io");
  const [waApiKey, setWaApiKey] = useState("");
  const [waPhoneId, setWaPhoneId] = useState("");
  const [waAppSecret, setWaAppSecret] = useState("");
  const [igApiUrl, setIgApiUrl] = useState("https://graph.facebook.com/v18.0");
  const [igToken, setIgToken] = useState("");
  const [igUserId, setIgUserId] = useState("");
  const [igAppSecret, setIgAppSecret] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const cfg: Record<string, string> = {};
      if (kind === "telegram") cfg.bot_token = tgToken.trim();
      if (kind === "whatsapp") {
        cfg.api_url = waApiUrl.trim();
        cfg.api_key = waApiKey.trim();
        if (waPhoneId.trim()) cfg.phone_number_id = waPhoneId.trim();
        if (waAppSecret.trim()) cfg.app_secret = waAppSecret.trim();
      }
      if (kind === "instagram") {
        cfg.api_url = igApiUrl.trim();
        cfg.page_access_token = igToken.trim();
        cfg.ig_user_id = igUserId.trim();
        if (igAppSecret.trim()) cfg.app_secret = igAppSecret.trim();
      }
      return (
        await api.post<ChannelRow>("/api/messengers/channels", {
          kind,
          name: name.trim() || M_KIND_LABEL[kind],
          provider_config: cfg,
        })
      ).data;
    },
    onSuccess: (data) => {
      toast.success("Канал подключён");
      onCreated(data.id);
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const canCreate =
    (kind === "telegram" && !!tgToken.trim()) ||
    (kind === "whatsapp" && !!waApiKey.trim()) ||
    (kind === "instagram" && !!igToken.trim() && !!igUserId.trim());

  return (
    <Modal open onClose={onClose} title="Подключить канал" size="lg">
      <div className="space-y-4">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Тип канала</div>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(M_KIND_LABEL) as ChannelKindT[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={clsx(
                  "rounded-lg border-2 p-3 text-left text-sm transition-colors",
                  kind === k
                    ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30"
                    : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-800",
                )}
              >
                <div className="font-semibold">{M_KIND_LABEL[k]}</div>
                <div className="mt-1 text-xs text-neutral-500">{M_KIND_HINT[k]}</div>
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Название канала</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Мой ${M_KIND_LABEL[kind]}`}
          />
        </label>

        {kind === "telegram" && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Bot Token</span>
            <input
              type="password"
              className="input font-mono"
              value={tgToken}
              onChange={(e) => setTgToken(e.target.value)}
              placeholder="1234567:AAE..."
            />
            <p className="mt-1 text-[11px] text-neutral-500">
              Получите у <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="link">@BotFather</a>
            </p>
          </label>
        )}

        {kind === "whatsapp" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-neutral-500">API URL</span>
              <input className="input" value={waApiUrl} onChange={(e) => setWaApiUrl(e.target.value)} />
              <p className="mt-1 text-[11px] text-neutral-500">
                Meta: <code>https://graph.facebook.com/v18.0</code>, 360dialog: <code>https://waba-v2.360dialog.io</code>
              </p>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-500">API Key</span>
              <input type="password" className="input font-mono" value={waApiKey} onChange={(e) => setWaApiKey(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-500">Phone Number ID (только Meta)</span>
              <input className="input font-mono" value={waPhoneId} onChange={(e) => setWaPhoneId(e.target.value)} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-neutral-500">App Secret (для проверки подписи Meta)</span>
              <input type="password" className="input font-mono" value={waAppSecret} onChange={(e) => setWaAppSecret(e.target.value)} />
            </label>
          </div>
        )}

        {kind === "instagram" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-neutral-500">Graph API URL</span>
              <input className="input" value={igApiUrl} onChange={(e) => setIgApiUrl(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-500">Page Access Token</span>
              <input type="password" className="input font-mono" value={igToken} onChange={(e) => setIgToken(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-500">Instagram User ID</span>
              <input className="input font-mono" value={igUserId} onChange={(e) => setIgUserId(e.target.value)} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-neutral-500">App Secret</span>
              <input type="password" className="input font-mono" value={igAppSecret} onChange={(e) => setIgAppSecret(e.target.value)} />
            </label>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn-primary"
            disabled={!canCreate || create.isPending}
            onClick={() => create.mutate()}
          >
            Подключить
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ChannelEditor({
  channel,
  onDelete,
  onSaved,
}: {
  channel: ChannelRow;
  onDelete: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(channel.name);
  const [isActive, setIsActive] = useState(channel.is_active);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [webhookInfo, setWebhookInfo] = useState<string | null>(null);
  const webhookUrl = `${window.location.origin}/api/messengers/webhook/${channel.id}`;

  useEffect(() => {
    setName(channel.name);
    setIsActive(channel.is_active);
    setTestResult(null);
    setWebhookInfo(null);
  }, [channel.id]);

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch(`/api/messengers/channels/${channel.id}`, { name, is_active: isActive })).data,
    onSuccess: () => {
      toast.success("Сохранено");
      onSaved();
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const test = useMutation({
    mutationFn: async () =>
      (await api.post(`/api/messengers/channels/${channel.id}/test`)).data as { ok: boolean; info: Record<string, unknown> },
    onSuccess: (data) => {
      setTestResult(JSON.stringify(data.info, null, 2));
      toast.success("Подключение работает");
    },
    onError: (e) => {
      setTestResult(extractApiError(e).message);
      toast.error("Ошибка", extractApiError(e).message);
    },
  });

  const setWh = useMutation({
    mutationFn: async () =>
      (await api.post(`/api/messengers/channels/${channel.id}/set-webhook`)).data as { ok: boolean; webhook_url: string; provider_response: Record<string, unknown> },
    onSuccess: (data) => {
      setWebhookInfo(`OK: ${JSON.stringify(data.provider_response)}`);
      toast.success("Webhook установлен");
    },
    onError: (e) => {
      setWebhookInfo(extractApiError(e).message);
      toast.error("Ошибка", extractApiError(e).message);
    },
  });

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-5">
        <div className="flex items-center justify-between">
          <input
            className="input max-w-sm text-lg font-medium"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Активен
          </label>
        </div>

        <div className="rounded-lg bg-neutral-50 p-3 text-xs dark:bg-neutral-800/50">
          <div className="mb-1 font-semibold">Тип: {M_KIND_LABEL[channel.kind]}</div>
          {channel.last_error && (
            <div className="mt-1 rounded bg-rose-50 p-2 text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
              <b>Последняя ошибка:</b> {channel.last_error}
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Webhook URL</div>
          <div className="flex gap-1">
            <input className="input flex-1 text-xs font-mono" readOnly value={webhookUrl}
              onClick={(e) => (e.target as HTMLInputElement).select()} />
            <button
              className="btn-ghost !px-2"
              onClick={() => {
                navigator.clipboard.writeText(webhookUrl);
                toast.success("URL скопирован");
              }}
            >
              <Copy size={13} />
            </button>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">
            {channel.kind === "telegram"
              ? "Установите этот URL как webhook у бота (кнопка справа сделает это автоматически)"
              : "Настройте этот URL в кабинете провайдера (Meta / 360dialog / Instagram)."}
          </p>
          {webhookInfo && (
            <pre className="mt-2 max-h-32 overflow-y-auto rounded bg-neutral-50 p-2 text-[10px] dark:bg-neutral-900">
              {webhookInfo}
            </pre>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => test.mutate()} disabled={test.isPending}>
              {test.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Проверить подключение
            </button>
            {channel.kind === "telegram" && (
              <button className="btn-secondary" onClick={() => setWh.mutate()} disabled={setWh.isPending}>
                {setWh.isPending ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                Установить webhook у бота
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost text-rose-600" onClick={onDelete}>
              <Trash2 size={14} /> Удалить канал
            </button>
            <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
              <Save size={14} /> Сохранить
            </button>
          </div>
        </div>
        {testResult && (
          <pre className="max-h-40 overflow-y-auto rounded bg-neutral-50 p-2 text-[10px] dark:bg-neutral-900">
            {testResult}
          </pre>
        )}
      </div>

      <AutoReplyRulesEditor channelId={channel.id} />
    </div>
  );
}

function AutoReplyRulesEditor({ channelId }: { channelId: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: rules } = useQuery({
    queryKey: ["messenger-rules", channelId],
    queryFn: async () =>
      (await api.get<RuleRow[]>(`/api/messengers/channels/${channelId}/auto-reply-rules`)).data,
  });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RuleRow | null>(null);

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/messengers/auto-reply-rules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messenger-rules", channelId] });
      toast.success("Правило удалено");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <div className="card space-y-2 p-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Автоответы</h3>
        <button className="btn-ghost !py-1 text-xs" onClick={() => setCreating(true)}>
          <Plus size={12} className="mr-1" /> Правило
        </button>
      </div>
      {(rules?.length ?? 0) === 0 && (
        <div className="rounded border border-dashed border-neutral-300 p-4 text-center text-xs text-neutral-500 dark:border-neutral-700">
          Автоответов ещё нет. Добавьте правило: приветствие, вне рабочих часов или по ключевому слову.
        </div>
      )}
      <div className="space-y-2">
        {(rules ?? []).map((r) => (
          <div
            key={r.id}
            className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-200">
                  {r.kind === "welcome" ? "Приветствие" : r.kind === "off_hours" ? "Вне рабочих часов" : "По ключевому слову"}
                </span>
                {!r.is_active && (
                  <span className="chip bg-neutral-200 text-neutral-600 dark:bg-neutral-800">off</span>
                )}
                {r.kind === "keyword" && (r.trigger_config as { keywords?: string[] })?.keywords && (
                  <span className="text-xs text-neutral-500">
                    ключи: {((r.trigger_config as { keywords: string[] }).keywords).join(", ")}
                  </span>
                )}
              </div>
              <div className="mt-1 line-clamp-2 text-sm text-neutral-700 dark:text-neutral-300">
                {r.response_text}
              </div>
            </div>
            <div className="flex gap-1">
              <button className="btn-ghost !p-1.5" title="Редактировать" onClick={() => setEditing(r)}>
                <Save size={13} />
              </button>
              <button
                className="btn-ghost !p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                title="Удалить"
                onClick={() => del.mutate(r.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {(creating || editing) && (
        <AutoReplyRuleModal
          channelId={channelId}
          rule={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["messenger-rules", channelId] });
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function AutoReplyRuleModal({
  channelId,
  rule,
  onClose,
  onSaved,
}: {
  channelId: number;
  rule: RuleRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = rule != null;
  const toast = useToast();
  const [kind, setKind] = useState<RuleRow["kind"]>(rule?.kind ?? "welcome");
  const [text, setText] = useState(rule?.response_text ?? "");
  const [keywords, setKeywords] = useState<string>(
    (rule?.trigger_config as { keywords?: string[] })?.keywords?.join(", ") ?? "",
  );
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [priority, setPriority] = useState<number>(rule?.priority ?? 0);

  const save = useMutation({
    mutationFn: async () => {
      const trigger_config: Record<string, unknown> = {};
      if (kind === "keyword") {
        trigger_config.keywords = keywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
      }
      const body = {
        kind,
        response_text: text,
        trigger_config,
        is_active: isActive,
        priority,
      };
      if (isEdit) {
        return (await api.patch(`/api/messengers/auto-reply-rules/${rule.id}`, body)).data;
      }
      return (await api.post(`/api/messengers/channels/${channelId}/auto-reply-rules`, body)).data;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Правило обновлено" : "Правило создано");
      onSaved();
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title={isEdit ? "Правило автоответа" : "Новое правило автоответа"} size="md">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Когда срабатывает</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as RuleRow["kind"])}>
            <option value="welcome">Приветствие (первое сообщение от клиента)</option>
            <option value="off_hours">Вне рабочих часов (нет менеджера на смене)</option>
            <option value="keyword">По ключевому слову</option>
          </select>
        </label>
        {kind === "keyword" && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Ключевые слова (через запятую)</span>
            <input
              className="input"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="цена, стоимость, купить"
            />
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Текст ответа</span>
          <textarea
            className="input min-h-[100px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Здравствуйте! Спасибо за обращение. Мы ответим в ближайшее время."
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 pt-4 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Активно
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Приоритет</span>
            <input
              type="number"
              className="input"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) || 0)}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-primary" disabled={!text.trim() || save.isPending} onClick={() => save.mutate()}>
            {isEdit ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MessageTemplatesSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: templates } = useQuery({
    queryKey: ["messenger-templates"],
    queryFn: async () => (await api.get<TemplateRow[]>("/api/messengers/templates")).data,
  });
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [creating, setCreating] = useState(false);

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/messengers/templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messenger-templates"] });
      toast.success("Шаблон удалён");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-500">
          Шаблоны быстрых ответов — доступны менеджерам в inbox при ответе клиенту.
        </p>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Новый шаблон
        </button>
      </div>
      <div className="grid gap-2">
        {(templates ?? []).map((t) => (
          <div
            key={t.id}
            className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{t.name}</span>
                <span className="chip bg-neutral-100 text-neutral-600 dark:bg-neutral-800">{t.language}</span>
                {t.whatsapp_template_name && (
                  <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                    WhatsApp: {t.whatsapp_template_name}
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-400">{t.body}</p>
            </div>
            <div className="flex gap-1">
              <button className="btn-ghost !p-1.5" title="Редактировать" onClick={() => setEditing(t)}>
                <Save size={13} />
              </button>
              <button
                className="btn-ghost !p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                title="Удалить"
                onClick={() => del.mutate(t.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
        {(templates?.length ?? 0) === 0 && (
          <div className="rounded border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
            Шаблонов пока нет
          </div>
        )}
      </div>

      {(editing || creating) && (
        <TemplateModal
          template={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["messenger-templates"] });
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function TemplateModal({
  template,
  onClose,
  onSaved,
}: {
  template: TemplateRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = template != null;
  const toast = useToast();
  const [name, setName] = useState(template?.name ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [language, setLanguage] = useState(template?.language ?? "ru");
  const [waName, setWaName] = useState(template?.whatsapp_template_name ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        body,
        kind: "text",
        language,
        whatsapp_template_name: waName.trim() || null,
      };
      if (isEdit) {
        return (await api.patch(`/api/messengers/templates/${template.id}`, payload)).data;
      }
      return (await api.post(`/api/messengers/templates`, payload)).data;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Шаблон обновлён" : "Шаблон создан");
      onSaved();
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title={isEdit ? "Шаблон" : "Новый шаблон"} size="md">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Название</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Текст</span>
          <textarea className="input min-h-[100px]" value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Язык</span>
            <input className="input" value={language} onChange={(e) => setLanguage(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              WhatsApp template name (для HSM)
            </span>
            <input className="input" value={waName} onChange={(e) => setWaName(e.target.value)} />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn-primary" disabled={!name.trim() || !body.trim() || save.isPending} onClick={() => save.mutate()}>
            {isEdit ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ==========================================================================
// MailboxSettings — настройки email-ящика пользователя (IMAP + SMTP)
// ==========================================================================

type MailboxRow = {
  id: number;
  name: string;
  email: string;
  reply_to_name: string | null;
  imap_host: string;
  imap_port: number;
  imap_ssl: boolean;
  imap_user: string;
  imap_password_set: boolean;
  imap_folder: string;
  smtp_host: string;
  smtp_port: number;
  smtp_tls: boolean;
  smtp_user: string;
  smtp_password_set: boolean;
  is_active: boolean;
  sync_interval_sec: number;
  last_sync_at: string | null;
  last_error: string | null;
  last_seen_uid: number | null;
};

const EMPTY_MAILBOX = {
  name: "",
  email: "",
  reply_to_name: "",
  imap_host: "",
  imap_port: 993,
  imap_ssl: true,
  imap_user: "",
  imap_password: "",
  imap_folder: "INBOX",
  smtp_host: "",
  smtp_port: 587,
  smtp_tls: true,
  smtp_user: "",
  smtp_password: "",
  is_active: true,
  sync_interval_sec: 120,
};

function MailboxSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const { data: mb, isPending } = useQuery({
    queryKey: ["my-mailbox"],
    queryFn: async () => (await api.get<MailboxRow | null>("/api/mail/mailboxes/me")).data,
  });

  const [form, setForm] = useState(EMPTY_MAILBOX);

  useEffect(() => {
    if (mb) {
      setForm({
        name: mb.name || "",
        email: mb.email || "",
        reply_to_name: mb.reply_to_name || "",
        imap_host: mb.imap_host,
        imap_port: mb.imap_port,
        imap_ssl: mb.imap_ssl,
        imap_user: mb.imap_user,
        imap_password: "",   // не показываем пароль; поле для смены
        imap_folder: mb.imap_folder || "INBOX",
        smtp_host: mb.smtp_host,
        smtp_port: mb.smtp_port,
        smtp_tls: mb.smtp_tls,
        smtp_user: mb.smtp_user,
        smtp_password: "",
        is_active: mb.is_active,
        sync_interval_sec: mb.sync_interval_sec,
      });
    }
  }, [mb]);

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { ...form };
      // Пустые пароли не отправляем (не менять)
      if (!form.imap_password) delete payload.imap_password;
      if (!form.smtp_password) delete payload.smtp_password;
      if (!form.reply_to_name) delete payload.reply_to_name;
      return (await api.put("/api/mail/mailboxes/me", payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-mailbox"] });
      toast.success("Сохранено");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const test = useMutation({
    mutationFn: async () => (await api.post("/api/mail/mailboxes/me/test")).data as { ok: boolean; imap: Record<string, unknown>; smtp: Record<string, unknown> },
    onSuccess: (data) => {
      if (data.ok) toast.success("IMAP+SMTP подключились успешно");
      else toast.error("Проверка не удалась", JSON.stringify({imap: data.imap, smtp: data.smtp}));
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const del = useMutation({
    mutationFn: async () => api.delete("/api/mail/mailboxes/me"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-mailbox"] });
      toast.success("Mailbox удалён");
      setForm(EMPTY_MAILBOX);
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  if (isPending) return <Loader />;

  const upd = <K extends keyof typeof EMPTY_MAILBOX>(k: K, v: (typeof EMPTY_MAILBOX)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-brand-50 p-3 text-xs text-brand-800 dark:bg-brand-950/30 dark:text-brand-200">
        Настройте IMAP + SMTP для вашего рабочего почтового ящика. Входящие письма
        будут отображаться на странице «Почта» с группировкой по threadам.
        Пароли шифруются перед сохранением в БД (Fernet).
      </div>

      {mb?.last_error && (
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
          <b>Последняя ошибка синхронизации:</b> {mb.last_error}
        </div>
      )}

      <div className="card space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Имя отправителя</span>
            <input className="input" value={form.name} onChange={(e) => upd("name", e.target.value)} placeholder="Иван Петров" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Email</span>
            <input className="input" type="email" value={form.email} onChange={(e) => upd("email", e.target.value)} placeholder="ivan@company.kz" />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Reply-To имя (опционально)</span>
            <input className="input" value={form.reply_to_name} onChange={(e) => upd("reply_to_name", e.target.value)} />
          </label>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">IMAP (входящие)</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs text-neutral-500">Сервер</span>
              <input className="input" value={form.imap_host} onChange={(e) => upd("imap_host", e.target.value)} placeholder="imap.gmail.com" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">Порт</span>
              <input type="number" className="input" value={form.imap_port} onChange={(e) => upd("imap_port", Number(e.target.value))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">Логин</span>
              <input className="input" value={form.imap_user} onChange={(e) => upd("imap_user", e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">
                Пароль {mb?.imap_password_set && "(сохранён — оставьте пустым если не меняете)"}
              </span>
              <input type="password" className="input" value={form.imap_password} onChange={(e) => upd("imap_password", e.target.value)} placeholder={mb?.imap_password_set ? "••••••••" : ""} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">Папка</span>
              <input className="input" value={form.imap_folder} onChange={(e) => upd("imap_folder", e.target.value)} placeholder="INBOX" />
            </label>
            <label className="flex items-center gap-2 pt-4 text-sm sm:col-span-3">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.imap_ssl} onChange={(e) => upd("imap_ssl", e.target.checked)} />
              SSL/TLS (обычно порт 993)
            </label>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">SMTP (исходящие)</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs text-neutral-500">Сервер</span>
              <input className="input" value={form.smtp_host} onChange={(e) => upd("smtp_host", e.target.value)} placeholder="smtp.gmail.com" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">Порт</span>
              <input type="number" className="input" value={form.smtp_port} onChange={(e) => upd("smtp_port", Number(e.target.value))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">Логин</span>
              <input className="input" value={form.smtp_user} onChange={(e) => upd("smtp_user", e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">
                Пароль {mb?.smtp_password_set && "(сохранён)"}
              </span>
              <input type="password" className="input" value={form.smtp_password} onChange={(e) => upd("smtp_password", e.target.value)} placeholder={mb?.smtp_password_set ? "••••••••" : ""} />
            </label>
            <label className="flex items-center gap-2 pt-4 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.smtp_tls} onChange={(e) => upd("smtp_tls", e.target.checked)} />
              STARTTLS (587)
            </label>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Настройки синхронизации</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-2 pt-4 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.is_active} onChange={(e) => upd("is_active", e.target.checked)} />
              Активен
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">Интервал (сек)</span>
              <input type="number" min={30} max={3600} className="input" value={form.sync_interval_sec} onChange={(e) => upd("sync_interval_sec", Number(e.target.value))} />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              disabled={test.isPending || !mb}
              onClick={() => test.mutate()}
              title="Проверить IMAP + SMTP подключение"
            >
              {test.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Проверить подключение
            </button>
            {mb && (
              <button
                className="btn-ghost text-rose-600"
                onClick={async () => {
                  if (await confirm({ title: "Удалить mailbox?", message: "Все threads и сообщения будут удалены.", confirmLabel: "Удалить" })) {
                    del.mutate();
                  }
                }}
              >
                <Trash2 size={14} /> Удалить
              </button>
            )}
          </div>
          <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
// BookingSettings — Calendly-style страницы бронирования встреч
// ==========================================================================

type BookingPageRow = {
  id: number;
  owner_user_id: number | null;
  team_id: number | null;
  slug: string;
  title: string;
  description: string | null;
  color: string;
  duration_min: number;
  buffer_before_min: number;
  buffer_after_min: number;
  working_hours: Record<string, Array<[number, number]>>;
  timezone: string;
  min_notice_hours: number;
  max_days_ahead: number;
  questions: Array<{ key: string; label: string; type: string; required: boolean }>;
  calendar_id: number | null;
  meeting_provider: string;
  meeting_url_template: string | null;
  is_active: boolean;
  public_url: string | null;
};

type BookingRow = {
  id: number;
  page_id: number;
  assignee_user_id: number | null;
  name: string;
  email: string;
  phone: string | null;
  start_at: string;
  end_at: string;
  status: string;
  answers: Record<string, string>;
  meeting_url: string | null;
  calendar_event_id: number | null;
  created_at: string | null;
};

const B_WEEKDAYS: { key: string; label: string }[] = [
  { key: "monday", label: "Пн" },
  { key: "tuesday", label: "Вт" },
  { key: "wednesday", label: "Ср" },
  { key: "thursday", label: "Чт" },
  { key: "friday", label: "Пт" },
  { key: "saturday", label: "Сб" },
  { key: "sunday", label: "Вс" },
];

const DEFAULT_BOOKING_HOURS = {
  monday: [[9, 18]] as Array<[number, number]>,
  tuesday: [[9, 18]] as Array<[number, number]>,
  wednesday: [[9, 18]] as Array<[number, number]>,
  thursday: [[9, 18]] as Array<[number, number]>,
  friday: [[9, 18]] as Array<[number, number]>,
  saturday: [] as Array<[number, number]>,
  sunday: [] as Array<[number, number]>,
};

function BookingSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const { data: pages, isPending } = useQuery({
    queryKey: ["booking-pages"],
    queryFn: async () => (await api.get<BookingPageRow[]>("/api/booking/pages")).data,
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = useMemo(
    () => pages?.find((p) => p.id === selectedId) ?? pages?.[0] ?? null,
    [pages, selectedId],
  );

  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post<BookingPageRow>("/api/booking/pages", {
          title: "Новая встреча",
          duration_min: 30,
          working_hours: DEFAULT_BOOKING_HOURS,
        })
      ).data,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["booking-pages"] });
      setSelectedId(data.id);
      toast.success("Страница создана");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/booking/pages/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["booking-pages"] });
      setSelectedId(null);
      toast.success("Удалено");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  if (isPending) return <Loader />;

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <div className="card p-2">
        <div className="mb-1 flex items-center justify-between px-2 py-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Страницы</span>
          <button className="btn-ghost !p-1" onClick={() => create.mutate()} title="Новая">
            <Plus size={14} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          {(pages ?? []).length === 0 && (
            <div className="p-4 text-center text-sm text-neutral-500">
              Страниц пока нет.<br />
              <button className="mt-2 text-brand-600" onClick={() => create.mutate()}>Создать первую</button>
            </div>
          )}
          {(pages ?? []).map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={clsx(
                "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                selected?.id === p.id
                  ? "bg-brand-50 text-brand-800 dark:bg-brand-900/25 dark:text-brand-200"
                  : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60",
              )}
            >
              <span className="inline-block h-3 w-3 rounded" style={{ background: p.color }} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.title}</div>
                <div className="truncate text-xs text-neutral-500">{p.duration_min} мин · /{p.slug}</div>
              </div>
              {!p.is_active && <span className="chip bg-neutral-200 text-neutral-600 dark:bg-neutral-800">off</span>}
            </button>
          ))}
        </div>
      </div>

      {selected ? (
        <BookingPageEditor
          page={selected}
          onDelete={async () => {
            if (await confirm({ title: "Удалить страницу?", message: "Все связанные бронирования будут удалены.", confirmLabel: "Удалить" })) {
              del.mutate(selected.id);
            }
          }}
          onSaved={() => qc.invalidateQueries({ queryKey: ["booking-pages"] })}
        />
      ) : (
        <div className="card p-8 text-center text-sm text-neutral-500">Создайте страницу слева</div>
      )}
    </div>
  );
}

function BookingPageEditor({
  page, onDelete, onSaved,
}: {
  page: BookingPageRow;
  onDelete: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState(page);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(page);
    setDirty(false);
  }, [page.id]);

  const upd = <K extends keyof BookingPageRow>(k: K, v: BookingPageRow[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };

  const { data: calendars } = useQuery({
    queryKey: ["my-calendars-for-booking"],
    queryFn: async () =>
      (await api.get<{ id: number; name: string }[]>("/api/calendar/calendars")).data,
    staleTime: 60_000,
  });

  const { data: bookings } = useQuery({
    queryKey: ["booking-page-bookings", page.id],
    queryFn: async () =>
      (await api.get<BookingRow[]>(`/api/booking/bookings`, { params: { page_id: page.id, only_mine: false } })).data,
  });

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/booking/pages/${page.id}`, {
        title: draft.title,
        description: draft.description,
        color: draft.color,
        duration_min: draft.duration_min,
        buffer_before_min: draft.buffer_before_min,
        buffer_after_min: draft.buffer_after_min,
        working_hours: draft.working_hours,
        timezone: draft.timezone,
        min_notice_hours: draft.min_notice_hours,
        max_days_ahead: draft.max_days_ahead,
        questions: draft.questions,
        calendar_id: draft.calendar_id,
        meeting_provider: draft.meeting_provider,
        meeting_url_template: draft.meeting_url_template,
        is_active: draft.is_active,
      }),
    onSuccess: () => {
      onSaved();
      setDirty(false);
      toast.success("Сохранено");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const toggleDay = (day: string, on: boolean) => {
    upd("working_hours", {
      ...draft.working_hours,
      [day]: on ? [[9, 18]] : [],
    });
  };
  const updateSegment = (day: string, idx: 0 | 1, hour: number) => {
    const segs = draft.working_hours[day] || [];
    const seg = (segs[0] || [9, 18]) as [number, number];
    const next = [...seg] as [number, number];
    next[idx] = hour;
    if (next[0] >= next[1]) {
      toast.error("Некорректно", "Конец должен быть больше начала");
      return;
    }
    upd("working_hours", { ...draft.working_hours, [day]: [next] });
  };

  const addQuestion = () => {
    upd("questions", [
      ...(draft.questions || []),
      { key: `q${(draft.questions || []).length + 1}`, label: "Вопрос", type: "text", required: false },
    ]);
  };
  const updateQuestion = (idx: number, patch: Partial<{ key: string; label: string; type: string; required: boolean }>) => {
    upd("questions", (draft.questions || []).map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  };
  const removeQuestion = (idx: number) => {
    upd("questions", (draft.questions || []).filter((_, i) => i !== idx));
  };

  const publicUrl = page.public_url ? `${window.location.origin}${page.public_url}` : null;

  return (
    <div className="space-y-4">
      <div className="card space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <input
            className="input max-w-md text-lg font-medium"
            value={draft.title}
            onChange={(e) => upd("title", e.target.value)}
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

        {publicUrl && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Публичная ссылка</div>
            <div className="flex gap-1">
              <input className="input flex-1 text-xs" readOnly value={publicUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()} />
              <button
                className="btn-ghost !px-2"
                onClick={() => {
                  navigator.clipboard.writeText(publicUrl);
                  toast.success("Скопировано");
                }}
              >
                <Copy size={13} />
              </button>
              <a
                className="btn-ghost !px-2"
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={13} />
              </a>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Описание</span>
            <textarea
              className="input min-h-[60px]"
              value={draft.description ?? ""}
              onChange={(e) => upd("description", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Цвет</span>
            <div className="flex items-center gap-2">
              <input type="color" value={draft.color} onChange={(e) => upd("color", e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border" />
              <input className="input flex-1" value={draft.color} onChange={(e) => upd("color", e.target.value)} />
            </div>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Длительность (мин)</span>
            <input type="number" className="input" value={draft.duration_min}
              onChange={(e) => upd("duration_min", Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Buffer до (мин)</span>
            <input type="number" className="input" value={draft.buffer_before_min}
              onChange={(e) => upd("buffer_before_min", Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Buffer после (мин)</span>
            <input type="number" className="input" value={draft.buffer_after_min}
              onChange={(e) => upd("buffer_after_min", Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Timezone</span>
            <input className="input" value={draft.timezone}
              onChange={(e) => upd("timezone", e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Минимум за N часов</span>
            <input type="number" className="input" value={draft.min_notice_hours}
              onChange={(e) => upd("min_notice_hours", Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Максимум N дней вперёд</span>
            <input type="number" className="input" value={draft.max_days_ahead}
              onChange={(e) => upd("max_days_ahead", Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Календарь (для авто-события)</span>
            <select
              className="input"
              value={draft.calendar_id ?? ""}
              onChange={(e) => upd("calendar_id", e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— не сохранять —</option>
              {(calendars ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Ссылка на встречу</span>
            <input className="input text-xs font-mono" value={draft.meeting_url_template ?? ""}
              placeholder="https://zoom.us/j/..."
              onChange={(e) => upd("meeting_url_template", e.target.value)} />
          </label>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Рабочие часы</div>
          <div className="grid gap-2 md:grid-cols-2">
            {B_WEEKDAYS.map((d) => {
              const segs = draft.working_hours[d.key] || [];
              const active = segs.length > 0;
              const [start, end] = segs[0] || [9, 18];
              return (
                <div key={d.key} className="flex items-center gap-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
                  <label className="flex w-16 items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-brand-600"
                      checked={active} onChange={(e) => toggleDay(d.key, e.target.checked)} />
                    {d.label}
                  </label>
                  <select className="input !py-1 text-sm" disabled={!active} value={start}
                    onChange={(e) => updateSegment(d.key, 0, Number(e.target.value))}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                    ))}
                  </select>
                  <span className="text-neutral-400">—</span>
                  <select className="input !py-1 text-sm" disabled={!active} value={end}
                    onChange={(e) => updateSegment(d.key, 1, Number(e.target.value))}>
                    {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                      <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                    ))}
                  </select>
                  {!active && <span className="ml-1 text-xs text-neutral-400">выходной</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Дополнительные вопросы</div>
            <button className="btn-ghost !py-1 text-xs" onClick={addQuestion}>
              <Plus size={12} className="mr-1" /> Вопрос
            </button>
          </div>
          <div className="space-y-2">
            {(draft.questions ?? []).map((q, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_1fr_120px_auto_auto] items-center gap-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
                <input className="input !py-1 text-sm" value={q.key}
                  onChange={(e) => updateQuestion(idx, { key: e.target.value })} placeholder="ключ" />
                <input className="input !py-1 text-sm" value={q.label}
                  onChange={(e) => updateQuestion(idx, { label: e.target.value })} placeholder="Название" />
                <select className="input !py-1 text-sm" value={q.type}
                  onChange={(e) => updateQuestion(idx, { type: e.target.value })}>
                  <option value="text">Текст</option>
                  <option value="textarea">Многострочный</option>
                </select>
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={q.required}
                    onChange={(e) => updateQuestion(idx, { required: e.target.checked })} /> обяз.
                </label>
                <button className="rounded p-1 text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                  onClick={() => removeQuestion(idx)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {(draft.questions ?? []).length === 0 && (
              <div className="rounded-lg border border-dashed border-neutral-300 p-3 text-center text-xs text-neutral-500 dark:border-neutral-700">
                Дополнительных вопросов нет. Клиенту нужны будут только имя + email.
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <button className="btn-ghost inline-flex items-center gap-1 text-rose-600" onClick={onDelete}>
            <Trash2 size={14} /> Удалить страницу
          </button>
          <button className="btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            <Save size={14} className="mr-1" /> Сохранить
          </button>
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-3 text-sm font-semibold">Забронированные встречи ({(bookings ?? []).length})</div>
        {(bookings?.length ?? 0) === 0 ? (
          <div className="rounded border border-dashed border-neutral-300 p-4 text-center text-xs text-neutral-500 dark:border-neutral-700">
            Пока никто не бронировал
          </div>
        ) : (
          <div className="space-y-1">
            {(bookings ?? []).map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{b.name}</div>
                  <div className="text-xs text-neutral-500">{b.email} {b.phone && `· ${b.phone}`}</div>
                </div>
                <div className="text-right text-xs text-neutral-500">
                  <div>{new Date(b.start_at).toLocaleString("ru-RU")}</div>
                  <span className={clsx(
                    "chip !text-[10px]",
                    b.status === "confirmed" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30",
                    b.status === "canceled" && "bg-rose-100 text-rose-800 dark:bg-rose-950/30",
                    b.status === "pending" && "bg-amber-100 text-amber-800 dark:bg-amber-950/30",
                  )}>{b.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
