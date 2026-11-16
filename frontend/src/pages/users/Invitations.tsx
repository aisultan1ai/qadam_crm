/**
 * Приглашения в компанию: отправка по email, ссылка для копирования, список и отзыв.
 * Живёт в «Команда → Пользователи», рядом с созданием пользователя вручную.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import type { Role } from "@/types";
import { Loader } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { Check, Clock, Copy, Mail, RefreshCw, UserPlus, XCircle } from "lucide-react";
import { useAuth } from "@/store/auth";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";

type Invitation = {
  id: number;
  email: string;
  role_id: number | null;
  department_id?: number | null;
  position?: string | null;
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
  smtp_not_configured: "Почта для отправки не настроена — скопируйте ссылку и отправьте её сотруднику",
  celery_unavailable: "Письмо сейчас не отправилось — скопируйте ссылку и отправьте её сотруднику",
};

function emailErrorText(code?: string | null): string {
  if (!code) return "Письмо не отправлено — скопируйте ссылку вручную";
  return EMAIL_ERROR_MESSAGE[code] || "Письмо не отправлено — скопируйте ссылку вручную";
}

function inviteStatus(inv: Invitation): "accepted" | "expired" | "pending" {
  if (inv.accepted_at) return "accepted";
  if (new Date(inv.expires_at).getTime() < Date.now()) return "expired";
  return "pending";
}

export default function InvitationsPanel() {
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
  // Без роли у сотрудника нет доступа ни к одному разделу — по умолчанию предлагаем «Сотрудник».
  const defaultRoleId = roles?.find((r) => r.name === "Сотрудник")?.id;
  useEffect(() => {
    if (!roleId && defaultRoleId) setRoleId(String(defaultRoleId));
  }, [defaultRoleId, roleId]);
  const [lastCreated, setLastCreated] = useState<InviteCreated | null>(null);
  const [departmentId, setDepartmentId] = useState<string>("");
  const [position, setPosition] = useState("");
  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await api.get<{ id: number; name: string }[]>("/api/departments")).data,
  });

  const create = useMutation({
    mutationFn: async () => {
      const body: { email: string; role_id?: number; department_id?: number; position?: string } = { email: email.trim() };
      if (roleId) body.role_id = Number(roleId);
      if (departmentId) body.department_id = Number(departmentId);
      if (position.trim()) body.position = position.trim();
      return (await api.post<InviteCreated>(`/api/tenants/${tenantId}/invite`, body)).data;
    },
    onSuccess: (data) => {
      setLastCreated(data);
      setEmail("");
      setRoleId(defaultRoleId ? String(defaultRoleId) : "");
      setPosition("");
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
      const body: { email: string; role_id?: number; department_id?: number; position?: string } = { email: inv.email };
      if (inv.role_id) body.role_id = inv.role_id;
      if (inv.department_id) body.department_id = inv.department_id;
      if (inv.position) body.position = inv.position;
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
    <div className="space-y-5">
      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <UserPlus size={18} className="text-brand-500" />
          <h2 className="text-base font-semibold">Пригласить в компанию</h2>
        </div>
        <p className="mb-4 text-sm text-neutral-500">
          Сотрудник получит письмо со ссылкой — по ней он вводит имя, фамилию и пароль и сразу попадает в компанию: в выбранный отдел, с указанной должностью и ролью. Ссылка действует 7 дней. Если почта не настроена, ссылку можно скопировать ниже.
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
              <option value="">Без роли (нет доступа к разделам)</option>
              {roles?.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <label className="min-w-[180px]">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Отдел</span>
            <select className="input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">Без отдела</option>
              {departments?.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <label className="min-w-[180px]">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Должность</span>
            <input
              className="input"
              placeholder="Например, менеджер по продажам"
              maxLength={150}
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
          </label>
          <Button
            variant="primary"
            disabled={!email.includes("@") || create.isPending}
            onClick={() => create.mutate()}
          >
            <Mail size={15} /> Пригласить
          </Button>
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyLink(lastCreated.invite_url)}
                title="Скопировать"
              >
                <Copy size={15} />
              </Button>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        className="!px-2"
                        title={status === "expired" ? "Создать новую ссылку" : "Обновить и отправить снова"}
                        onClick={() => resend.mutate(inv)}
                        disabled={resend.isPending}
                      >
                        <RefreshCw size={14} />
                      </Button>
                    )}
                    {status !== "accepted" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="!px-2 text-rose-500"
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
                      </Button>
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
      <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25">
        <Check size={11} /> Принято
        {acceptedAt && ` · ${new Date(acceptedAt).toLocaleDateString("ru-RU")}`}
      </span>
    );
  }
  if (status === "expired") {
    return (
      <span className="chip bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25">
        <XCircle size={11} /> Просрочено
      </span>
    );
  }
  const days = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 86400_000));
  return (
    <span className="chip bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25">
      <Clock size={11} /> Ожидает · ещё {days} д.
    </span>
  );
}



