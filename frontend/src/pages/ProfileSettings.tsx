import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, extractApiError } from "@/api/client";
import clsx from "clsx";
import { Bell, Shield, Monitor, Link as LinkIcon, ArrowLeft, LogOut, ShieldCheck, Trash2, KeyRound, Copy, RefreshCw, Check } from "lucide-react";
import { EmptyState, Modal } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/store/auth";
import { fromNow } from "@/lib/date";
import { Button } from "@/components/lib/Button";
import { FormField } from "@/components/lib/FormField";

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

      <div className="table-container">
        <div className="table-scroll">
          <table className="w-full">
            <thead className="table-head">
              <tr>
                <th className="table-head-cell">Событие</th>
                <th className="table-head-cell text-center">В приложении</th>
                <th className="table-head-cell text-center">Email</th>
                <th className="table-head-cell text-center">Push</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((p) => (
                <tr key={p.kind} className="table-row">
                  <td className="table-cell">{p.label}</td>
                  {(["inapp", "email", "push"] as const).map((ch) => (
                    <td key={ch} className="table-cell text-center">
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
        {/* keep Link with btn-secondary — Button is <button> only */}
      </div>

      {totpEnabled && <BackupCodesSection />}

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
              <Button
                variant="danger"
                className="ml-2"
                onClick={() => disable.mutate()}
                isLoading={disable.isPending}
                disabled={code.length < 6}
              >
                Выключить 2FA
              </Button>
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
                <Button
                  variant="primary"
                  onClick={() => verify.mutate()}
                  isLoading={verify.isPending}
                  disabled={code.length < 6}
                >
                  Подтвердить
                </Button>
                <Button variant="ghost" onClick={() => { setSetupData(null); setCode(""); }}>
                  Отмена
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">
              Дополнительный уровень защиты. При входе будет требоваться код из мобильного приложения.
            </p>
            <Button
              variant="primary"
              onClick={() => setup.mutate()}
              isLoading={setup.isPending}
            >
              Включить 2FA
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Backup codes 2FA
// ============================================================================

type BackupStatus = { total: number; unused: number; generated_at?: string | null };

function BackupCodesSection() {
  const toast = useToast();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  const status = useQuery({
    queryKey: ["me-2fa-backup-status"],
    queryFn: async () => (await api.get<BackupStatus>("/api/me/2fa/backup-codes/status")).data,
  });

  const regen = useMutation({
    mutationFn: async () =>
      (await api.post<{ codes: string[]; message: string }>("/api/me/2fa/backup-codes/regenerate", { code })).data,
    onSuccess: (d) => {
      setFreshCodes(d.codes);
      setShowRegenModal(false);
      setCode("");
      qc.invalidateQueries({ queryKey: ["me-2fa-backup-status"] });
      toast.success("Коды сгенерированы");
    },
    onError: (e) => toast.error("Не удалось сгенерировать", extractApiError(e).message),
  });

  const copyAll = () => {
    if (!freshCodes) return;
    void navigator.clipboard.writeText(freshCodes.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const downloadTxt = () => {
    if (!freshCodes) return;
    const blob = new Blob(
      [
        "Qadam CRM — резервные коды 2FA\n",
        "Каждый код работает один раз. Храните в надёжном месте.\n",
        `Сгенерировано: ${new Date().toLocaleString("ru-RU")}\n\n`,
        freshCodes.join("\n"),
        "\n",
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "qadam-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = status.data;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="mb-2 flex items-center gap-2 font-semibold">
        <KeyRound size={16} /> Резервные коды
      </div>
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
        Одноразовые коды на случай, если вы потеряете доступ к authenticator-приложению.
        При каждом использовании код удаляется.
      </p>

      {status.isPending ? (
        <div className="h-8 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/60" />
      ) : (
        <div className="mb-3 flex items-center gap-3 text-sm">
          <div>
            Осталось неиспользованных:{" "}
            <b className={s && s.unused === 0 ? "text-rose-600" : "text-emerald-600"}>{s?.unused ?? 0}</b>
            {s && s.total > 0 && <span className="text-neutral-500"> / {s.total}</span>}
          </div>
          {s?.generated_at && (
            <div className="text-xs text-neutral-500">Сгенерированы {fromNow(s.generated_at)}</div>
          )}
        </div>
      )}

      <Button
        variant="secondary"
        leftIcon={<RefreshCw size={14} />}
        onClick={() => setShowRegenModal(true)}
      >
        {s && s.total > 0 ? "Перегенерировать коды" : "Сгенерировать коды"}
      </Button>

      {showRegenModal && (
        <Modal open onClose={() => { setShowRegenModal(false); setCode(""); }} title="Подтвердите TOTP-кодом" size="sm">
          <p className="mb-4 text-sm text-neutral-500">
            Введите текущий 6-значный код из authenticator-приложения. Старые резервные
            коды перестанут работать.
          </p>
          <FormField label="Код" required>
            <input
              className="input tabular-nums text-lg"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              maxLength={6}
              autoFocus
            />
          </FormField>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setShowRegenModal(false); setCode(""); }}>Отмена</Button>
            <Button
              variant="primary"
              disabled={code.length < 6}
              isLoading={regen.isPending}
              onClick={() => regen.mutate()}
            >
              Сгенерировать
            </Button>
          </div>
        </Modal>
      )}

      {freshCodes && (
        <Modal open onClose={() => setFreshCodes(null)} title="Резервные коды" size="md">
          <div className="mb-3 rounded bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Сохраните эти коды сейчас — мы больше не покажем их. Только пересгенерируем новые.
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 font-mono text-sm dark:border-neutral-800 dark:bg-neutral-900">
            {freshCodes.map((c, i) => (
              <div key={i} className="tabular-nums">{c}</div>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              leftIcon={copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
              onClick={copyAll}
            >
              {copied ? "Скопировано" : "Скопировать все"}
            </Button>
            <Button variant="ghost" onClick={downloadTxt}>Скачать .txt</Button>
            <Button variant="primary" onClick={() => setFreshCodes(null)}>Я сохранил коды</Button>
          </div>
        </Modal>
      )}
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

  const revokeOthers = useMutation({
    mutationFn: async () => (await api.post<{ revoked: number }>("/api/me/sessions/revoke-others")).data,
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["me-sessions"] });
      toast.success(d.revoked > 0 ? `Отозвано сессий: ${d.revoked}` : "Других активных сессий не было");
    },
    onError: (e) => toast.error("Не удалось выполнить", extractApiError(e).message),
  });

  if (isPending) return <div className="h-40 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/60" />;
  if (!data || data.length === 0)
    return <EmptyState icon={<Monitor size={32} />} title="Активных сессий не найдено" description="История сессий появится после следующего входа" />;

  const activeOthers = data.filter((s) => !s.revoked_at && !s.is_current).length;

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="mb-1 text-lg font-semibold">Активные сессии</h2>
          <p className="text-sm text-neutral-500">Устройства, где вы вошли. Незнакомую сессию — отзовите</p>
        </div>
        <Button
          variant="danger"
          size="sm"
          className="shrink-0"
          onClick={() => {
            if (window.confirm("Выйти со всех других устройств? Текущая сессия останется активной.")) {
              revokeOthers.mutate();
            }
          }}
          disabled={activeOthers === 0 || revokeOthers.isPending}
          title="Отозвать все сессии кроме текущей"
        >
          <LogOut size={13} className="mr-1 inline" />
          Выйти со всех других ({activeOthers})
        </Button>
      </div>

      <div className="space-y-2">
        {data.map((s) => (
          <div
            key={s.id}
            className={clsx(
              "flex items-center justify-between rounded-lg border p-3",
              s.is_current
                ? "border-brand-300 bg-brand-50/40 dark:border-brand-500/40 dark:bg-brand-500/5"
                : "border-neutral-200 dark:border-neutral-800",
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Monitor size={14} className="text-neutral-500" />
                <span className="truncate">{s.user_agent || "Неизвестное устройство"}</span>
                {s.is_current && (
                  <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
                    Текущая
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-neutral-500">
                IP {s.ip_address || "?"} · вход {fromNow(s.created_at)} · активность {fromNow(s.last_seen_at)}
                {s.revoked_at && <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">Отозвана</span>}
              </div>
            </div>
            {!s.revoked_at && !s.is_current && (
              <Button variant="ghost" size="icon" className="text-rose-500" onClick={() => revoke.mutate(s.id)} title="Отозвать сессию">
                <LogOut size={14} />
              </Button>
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
              <Button variant="ghost" size="icon" className="text-rose-500" onClick={() => unlink.mutate(l.id)} title="Отвязать">
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
