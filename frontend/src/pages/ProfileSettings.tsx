import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, extractApiError } from "@/api/client";
import clsx from "clsx";
import { Bell, Shield, Monitor, Link as LinkIcon, ArrowLeft, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/store/auth";
import { fromNow } from "@/lib/date";

type Tab = "notifications" | "security" | "sessions" | "linked";

const TABS: { key: Tab; label: string; icon: typeof Bell }[] = [
  { key: "notifications", label: "Уведомления", icon: Bell },
  { key: "security", label: "Безопасность", icon: Shield },
  { key: "sessions", label: "Сессии", icon: Monitor },
  { key: "linked", label: "Привязанные аккаунты", icon: LinkIcon },
];

export default function ProfileSettings() {
  const [tab, setTab] = useState<Tab>("notifications");
  return (
    <div className="space-y-4">
      <div>
        <Link to="/profile" className="mb-1 inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-brand-600">
          <ArrowLeft size={12} /> К профилю
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Настройки профиля</h1>
        <p className="text-sm text-neutral-500">Уведомления, безопасность, сессии, интеграции</p>
      </div>

      <div className="grid gap-4 md:grid-cols-[240px_1fr]">
        <nav className="space-y-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={clsx(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800/60",
                )}
              >
                <Icon size={15} />
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
          {tab === "notifications" && <NotificationsTab />}
          {tab === "security" && <SecurityTab />}
          {tab === "sessions" && <SessionsTab />}
          {tab === "linked" && <LinkedTab />}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Notifications
// ============================================================================

type Pref = { kind: string; label: string; inapp: boolean; email: boolean; push: boolean };

function NotificationsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isPending } = useQuery({
    queryKey: ["me-prefs"],
    queryFn: async () => (await api.get<Pref[]>("/api/me/notification-prefs")).data,
  });

  const update = useMutation({
    mutationFn: (patch: Partial<Pref> & { kind: string }) => api.patch("/api/me/notification-prefs", patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me-prefs"] }),
    onError: (e) => toast.error("Не удалось сохранить", extractApiError(e).message),
  });

  if (isPending) return <div className="h-40 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/60" />;

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold">Каналы доставки</h2>
      <p className="mb-3 text-sm text-neutral-500">Выберите, куда присылать какие уведомления</p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500 dark:bg-neutral-900/40">
            <tr>
              <th className="px-3 py-2">Событие</th>
              <th className="px-3 py-2 text-center">В приложении</th>
              <th className="px-3 py-2 text-center">Email</th>
              <th className="px-3 py-2 text-center">Push</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((p) => (
              <tr key={p.kind} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-3 py-2">{p.label}</td>
                {(["inapp", "email", "push"] as const).map((ch) => (
                  <td key={ch} className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={p[ch]}
                      onChange={(e) => update.mutate({ kind: p.kind, [ch]: e.target.checked })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Security
// ============================================================================

function SecurityTab() {
  const { me, fetchMe } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [setupData, setSetupData] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [code, setCode] = useState("");

  const setup = useMutation({
    mutationFn: async () => (await api.post<{ secret: string; otpauth_url: string }>("/api/me/2fa/setup")).data,
    onSuccess: (d) => setSetupData(d),
    onError: (e) => toast.error("Не удалось начать настройку", extractApiError(e).message),
  });

  const verify = useMutation({
    mutationFn: async () => api.post("/api/me/2fa/verify", { code }),
    onSuccess: () => {
      toast.success("2FA включена!");
      setSetupData(null);
      setCode("");
      fetchMe();
      qc.invalidateQueries({ queryKey: ["me-sessions"] });
    },
    onError: (e) => toast.error("Неверный код", extractApiError(e).message),
  });

  const disable = useMutation({
    mutationFn: async () => api.post("/api/me/2fa/disable", { code }),
    onSuccess: () => {
      toast.success("2FA выключена");
      setCode("");
      fetchMe();
    },
    onError: (e) => toast.error("Не удалось выключить", extractApiError(e).message),
  });

  const totpEnabled = (me as any)?.totp_enabled === true;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-1 text-lg font-semibold">Пароль</h2>
        <p className="mb-2 text-sm text-neutral-500">Смена пароля доступна на странице профиля</p>
        <Link to="/profile" className="btn-secondary inline-flex">
          Открыть профиль
        </Link>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
        <div className="mb-2 flex items-center gap-2 font-semibold">
          <ShieldCheck size={16} /> Двухфакторная аутентификация (TOTP)
        </div>
        {totpEnabled ? (
          <div className="space-y-3">
            <div className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
              ✓ 2FA включена. При каждом входе требуется код из приложения.
            </div>
            <div>
              <input
                className="input max-w-[160px]"
                placeholder="Код для выключения"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
              />
              <button className="btn-danger ml-2" onClick={() => disable.mutate()} disabled={code.length < 6 || disable.isPending}>
                Выключить 2FA
              </button>
            </div>
          </div>
        ) : setupData ? (
          <div className="space-y-3">
            <div className="text-sm text-neutral-600 dark:text-neutral-400">
              Отсканируйте QR-код в приложении (Google Authenticator, 1Password, Authy, Aegis):
            </div>
            <div className="flex flex-col items-center gap-2">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(setupData.otpauth_url)}`}
                alt="QR"
                className="rounded border border-neutral-200 dark:border-neutral-700"
              />
              <details className="text-xs text-neutral-500">
                <summary className="cursor-pointer">Ввести секрет вручную</summary>
                <code className="mt-1 block break-all rounded bg-neutral-100 p-2 dark:bg-neutral-800">{setupData.secret}</code>
              </details>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Введите 6-значный код из приложения:</label>
              <div className="flex gap-2">
                <input
                  className="input max-w-[160px] tabular-nums text-lg"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  maxLength={6}
                  autoFocus
                />
                <button className="btn-primary" onClick={() => verify.mutate()} disabled={code.length < 6 || verify.isPending}>
                  Подтвердить
                </button>
                <button className="btn-ghost" onClick={() => { setSetupData(null); setCode(""); }}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">
              Дополнительный уровень защиты. При входе будет требоваться код из мобильного приложения.
            </p>
            <button className="btn-primary" onClick={() => setup.mutate()} disabled={setup.isPending}>
              Включить 2FA
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Sessions
// ============================================================================

type SessionRow = {
  id: number;
  user_agent?: string | null;
  ip_address?: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  is_current?: boolean;
};

function SessionsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isPending } = useQuery({
    queryKey: ["me-sessions"],
    queryFn: async () => (await api.get<SessionRow[]>("/api/me/sessions")).data,
  });

  const revoke = useMutation({
    mutationFn: (id: number) => api.post(`/api/me/sessions/${id}/revoke`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me-sessions"] });
      toast.success("Сессия отозвана");
    },
    onError: (e) => toast.error("Не удалось отозвать", extractApiError(e).message),
  });

  if (isPending) return <div className="h-40 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/60" />;
  if (!data || data.length === 0)
    return <EmptyState icon={<Monitor size={32} />} title="Активных сессий не найдено" description="История сессий появится после следующего входа" />;

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold">Активные сессии</h2>
      <p className="mb-3 text-sm text-neutral-500">Устройства, где вы вошли. Незнакомую сессию — отзовите</p>

      <div className="space-y-2">
        {data.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Monitor size={14} className="text-neutral-500" />
                <span className="truncate">{s.user_agent || "Неизвестное устройство"}</span>
              </div>
              <div className="mt-0.5 text-xs text-neutral-500">
                IP {s.ip_address || "?"} · вход {fromNow(s.created_at)} · активность {fromNow(s.last_seen_at)}
                {s.revoked_at && <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">Отозвана</span>}
              </div>
            </div>
            {!s.revoked_at && (
              <button className="btn-ghost !p-1.5 text-rose-500" onClick={() => revoke.mutate(s.id)} title="Отозвать сессию">
                <LogOut size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Linked
// ============================================================================

type LinkedRow = {
  id: number;
  provider: string;
  external_id: string;
  display_name?: string | null;
  email?: string | null;
  created_at: string;
};

const PROVIDER_LABEL: Record<string, string> = {
  google: "Google",
  slack: "Slack",
  telegram: "Telegram",
  github: "GitHub",
};

function LinkedTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isPending } = useQuery({
    queryKey: ["me-linked"],
    queryFn: async () => (await api.get<LinkedRow[]>("/api/me/linked-accounts")).data,
  });

  const unlink = useMutation({
    mutationFn: (id: number) => api.delete(`/api/me/linked-accounts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me-linked"] });
      toast.success("Привязка удалена");
    },
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  if (isPending) return <div className="h-40 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/60" />;

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold">Привязанные аккаунты</h2>
      <p className="mb-3 text-sm text-neutral-500">Google Calendar / Slack / Telegram и другие интеграции</p>

      {!data || data.length === 0 ? (
        <EmptyState icon={<LinkIcon size={32} />} title="Пока ничего не привязано" description="Привязка появится когда вы подключите интеграцию (например Google Calendar)" />
      ) : (
        <div className="space-y-2">
          {data.map((l) => (
            <div key={l.id} className="flex items-center justify-between rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <div>
                <div className="text-sm font-medium">{PROVIDER_LABEL[l.provider] || l.provider}</div>
                <div className="text-xs text-neutral-500">
                  {l.display_name || l.email || l.external_id} · привязано {fromNow(l.created_at)}
                </div>
              </div>
              <button className="btn-ghost !p-1.5 text-rose-500" onClick={() => unlink.mutate(l.id)} title="Отвязать">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
