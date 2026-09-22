import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { Puzzle, Check, ExternalLink, FolderOpen, Cloud, FileDown, ChevronRight, Loader2, Settings2, X } from "lucide-react";
import clsx from "clsx";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/lib/Button";

type Provider = {
  id: number;
  code: string;
  label: string;
  category: string;
  status: string;
  is_enabled: boolean;
};

type StorageStatus = {
  provider: string;
  connected: boolean;
  configured: boolean;
  account_email?: string | null;
  account_name?: string | null;
  last_error?: string | null;
};

type StorageFile = {
  id?: string | null;
  path?: string | null;
  name: string;
  kind: "file" | "folder" | "other";
  mime?: string | null;
  size?: number | null;
  modified?: string | null;
};

type StorageListResp = {
  provider: string;
  files: StorageFile[];
  next_cursor?: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  storage: "Файловые хранилища",
  messenger: "Мессенджеры",
  marketing: "Маркетинг",
  social: "Соцсети",
  telephony: "Телефония",
  other: "Разное",
};

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  available: { label: "Доступно", color: "bg-emerald-100 text-emerald-700" },
  beta: { label: "Beta", color: "bg-sky-100 text-sky-700" },
  coming_soon: { label: "Скоро", color: "bg-amber-100 text-amber-700" },
  disabled: { label: "Отключено", color: "bg-neutral-200 text-neutral-600" },
};

const STORAGE_CODES = new Set(["google_drive", "dropbox"]);

export default function IntegrationsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [browsing, setBrowsing] = useState<"google_drive" | "dropbox" | null>(null);
  const [configuring, setConfiguring] = useState<"dropbox" | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => (await api.get<Provider[]>("/api/integrations")).data,
  });

  const toggle = useMutation({
    mutationFn: (code: string) => api.post(`/api/integrations/${code}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }),
    onError: (e) => toast.error("Не удалось", extractApiError(e).message),
  });

  const start = useMutation({
    mutationFn: (code: string) => api.get<{ consent_url: string; note?: string }>(`/api/integrations/${code}/oauth-start`),
    onSuccess: (r) => {
      const url = r.data.consent_url;
      if (url.startsWith("http")) {
        window.location.href = url;
      } else {
        window.location.href = url;
      }
      if (r.data.note) toast.info("Настройка", r.data.note);
    },
    onError: (e) => toast.error("OAuth не настроен", extractApiError(e).message),
  });

  const grouped = new Map<string, Provider[]>();
  (data || []).forEach((p) => {
    if (!grouped.has(p.category)) grouped.set(p.category, []);
    grouped.get(p.category)!.push(p);
  });

  if (isPending) {
    return <div className="h-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Puzzle size={20} /> Интеграции
        </h1>
        <p className="text-sm text-neutral-500">Подключение внешних сервисов: облачные хранилища, мессенджеры, маркетинг</p>
      </div>

      {Array.from(grouped.entries()).map(([cat, items]) => (
        <div key={cat}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {CATEGORY_LABEL[cat] || cat}
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <ProviderCard
                key={p.id}
                p={p}
                onConnect={() => start.mutate(p.code)}
                onToggle={() => toggle.mutate(p.code)}
                onBrowse={() => STORAGE_CODES.has(p.code) && setBrowsing(p.code as "google_drive" | "dropbox")}
                onConfigure={() => p.code === "dropbox" && setConfiguring("dropbox")}
              />
            ))}
          </div>
        </div>
      ))}

      {browsing && (
        <StorageBrowser
          provider={browsing}
          onClose={() => setBrowsing(null)}
        />
      )}
      {configuring === "dropbox" && (
        <DropboxConfigModal onClose={() => setConfiguring(null)} />
      )}
    </div>
  );
}

function ProviderCard({
  p,
  onConnect,
  onToggle,
  onBrowse,
  onConfigure,
}: {
  p: Provider;
  onConnect: () => void;
  onToggle: () => void;
  onBrowse: () => void;
  onConfigure: () => void;
}) {
  const style = STATUS_STYLE[p.status] || STATUS_STYLE.coming_soon;
  const isStorage = STORAGE_CODES.has(p.code);

  const statusQ = useQuery({
    enabled: isStorage,
    queryKey: ["storage", p.code, "status"],
    queryFn: async () =>
      (await api.get<StorageStatus>(`/api/integrations/storage/${p.code}/status`)).data,
  });

  const connected = statusQ.data?.connected ?? false;
  const configured = statusQ.data?.configured ?? false;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            {p.code === "google_drive" && <Cloud size={14} className="text-blue-500" />}
            {p.code === "dropbox" && <Cloud size={14} className="text-sky-500" />}
            {p.label}
          </div>
          <span className={clsx("mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium", style.color)}>
            {style.label}
          </span>
          {isStorage && statusQ.data && (
            <div className="mt-1 text-[11px] text-neutral-500">
              {connected ? (
                <>
                  <Check size={10} className="inline text-emerald-500" /> {statusQ.data.account_email || statusQ.data.account_name}
                </>
              ) : configured ? (
                "Компания настроена — можно подключить"
              ) : (
                p.code === "dropbox" ? "Требуется настройка App key/secret" : "Требуется настройка Google OAuth"
              )}
            </div>
          )}
        </div>
        {p.is_enabled && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            <Check size={11} /> вкл.
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {isStorage ? (
          <>
            {connected ? (
              <Button variant="secondary" className="flex-1" onClick={onBrowse}>
                <FolderOpen size={13} /> Файлы
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="flex-1"
                disabled={!configured}
                onClick={onConnect}
              >
                <ExternalLink size={13} /> Подключить
              </Button>
            )}
            {p.code === "dropbox" && (
              <Button variant="ghost" onClick={onConfigure} title="Настройки Dropbox App">
                <Settings2 size={13} />
              </Button>
            )}
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              className="flex-1"
              disabled={p.status === "coming_soon"}
              onClick={onConnect}
            >
              <ExternalLink size={13} /> Подключить
            </Button>
            <Button
              variant="ghost"
              className={clsx(p.is_enabled ? "text-rose-500" : "text-emerald-600")}
              onClick={onToggle}
            >
              {p.is_enabled ? "Выкл." : "Вкл."}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

type Crumb = { id?: string | null; path?: string | null; name: string };

function StorageBrowser({
  provider,
  onClose,
}: {
  provider: "google_drive" | "dropbox";
  onClose: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ name: "Корень", id: null, path: "" }]);
  const current = crumbs[crumbs.length - 1];

  const listQ = useQuery({
    queryKey: ["storage", provider, "list", current.id ?? "", current.path ?? ""],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (provider === "google_drive" && current.id) params.folder_id = current.id;
      if (provider === "dropbox" && current.path) params.path = current.path;
      const qs = new URLSearchParams(params).toString();
      const url = `/api/integrations/storage/${provider}/list${qs ? "?" + qs : ""}`;
      return (await api.get<StorageListResp>(url)).data;
    },
  });

  const disconnect = useMutation({
    mutationFn: () => api.delete(`/api/integrations/storage/${provider}/disconnect`),
    onSuccess: () => {
      toast.success(`${provider} отключён`);
      qc.invalidateQueries({ queryKey: ["storage", provider, "status"] });
      onClose();
    },
    onError: (e) => toast.error("Не удалось отключить", extractApiError(e).message),
  });

  const importFile = useMutation({
    mutationFn: async (f: StorageFile) => {
      const body: Record<string, unknown> = {};
      if (provider === "google_drive") body.file_id = f.id;
      if (provider === "dropbox") body.path = f.path;
      return (await api.post(`/api/integrations/storage/${provider}/import`, body)).data;
    },
    onSuccess: (_r, f) => toast.success("Импортировано", `${f.name} добавлен в Документы`),
    onError: (e) => toast.error("Импорт не удался", extractApiError(e).message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <Cloud size={16} />
            <h3 className="text-base font-semibold">
              {provider === "google_drive" ? "Google Drive" : "Dropbox"}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-rose-500" onClick={() => disconnect.mutate()}>
              Отключить
            </Button>
            <Button variant="ghost" onClick={onClose}>
              <X size={16} />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-1 border-b border-neutral-200 p-3 text-sm dark:border-neutral-800">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} className="text-neutral-400" />}
              <button
                className={clsx(
                  "rounded px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800",
                  i === crumbs.length - 1 && "font-medium",
                )}
                onClick={() => setCrumbs(crumbs.slice(0, i + 1))}
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>

        <div className="max-h-[60vh] min-h-[240px] overflow-y-auto">
          {listQ.isPending && (
            <div className="flex items-center justify-center p-8 text-neutral-500">
              <Loader2 size={16} className="animate-spin" /> <span className="ml-2 text-sm">Загрузка…</span>
            </div>
          )}
          {listQ.isError && (
            <div className="p-4 text-sm text-rose-500">
              Не удалось загрузить: {extractApiError(listQ.error).message}
            </div>
          )}
          {listQ.data && (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {listQ.data.files.length === 0 && (
                <li className="p-6 text-center text-sm text-neutral-500">Пусто</li>
              )}
              {listQ.data.files.map((f) => (
                <li key={(f.id || f.path) ?? f.name} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                  {f.kind === "folder" ? (
                    <button
                      className="flex flex-1 items-center gap-2 text-left"
                      onClick={() =>
                        setCrumbs([...crumbs, { id: f.id, path: f.path, name: f.name }])
                      }
                    >
                      <FolderOpen size={14} className="text-amber-500" />
                      <span className="font-medium">{f.name}</span>
                    </button>
                  ) : (
                    <>
                      <div className="flex flex-1 items-center gap-2">
                        <Cloud size={14} className="text-neutral-400" />
                        <span>{f.name}</span>
                        {f.size != null && (
                          <span className="text-[11px] text-neutral-500">
                            {(f.size / 1024).toFixed(1)} KB
                          </span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={importFile.isPending}
                        onClick={() => importFile.mutate(f)}
                        title="Импортировать в Документы"
                      >
                        <FileDown size={13} /> Импортировать
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

type DropboxConfig = {
  app_key: string | null;
  redirect_uri: string | null;
  has_secret: boolean;
};

function DropboxConfigModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const cfgQ = useQuery({
    queryKey: ["integrations", "dropbox", "tenant-config"],
    queryFn: async () =>
      (await api.get<DropboxConfig>("/api/integrations/storage/dropbox/tenant-config")).data,
  });

  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (cfgQ.data && !initialized) {
      setAppKey(cfgQ.data.app_key ?? "");
      setRedirectUri(cfgQ.data.redirect_uri ?? `${window.location.origin}/api/integrations/storage/dropbox/callback`);
      setInitialized(true);
    }
  }, [cfgQ.data, initialized]);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {
        app_key: appKey.trim(),
        redirect_uri: redirectUri.trim(),
      };
      if (appSecret.trim()) body.app_secret = appSecret.trim();
      return (await api.put("/api/integrations/storage/dropbox/tenant-config", body)).data;
    },
    onSuccess: () => {
      toast.success("Dropbox App настроен");
      qc.invalidateQueries({ queryKey: ["integrations", "dropbox", "tenant-config"] });
      qc.invalidateQueries({ queryKey: ["storage", "dropbox", "status"] });
      onClose();
    },
    onError: (e) => toast.error("Не удалось сохранить", extractApiError(e).message),
  });

  const hasSecret = cfgQ.data?.has_secret ?? false;
  const secretRequired = !hasSecret;
  const canSubmit =
    appKey.trim().length >= 5 &&
    redirectUri.trim().length >= 10 &&
    (!secretRequired || appSecret.trim().length >= 5);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-200 p-4 dark:border-neutral-800">
          <h3 className="text-base font-semibold">Настройки Dropbox App</h3>
          <Button variant="ghost" onClick={onClose}><X size={16} /></Button>
        </div>
        <div className="space-y-4 p-4">
          <details className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400">
            <summary className="cursor-pointer font-medium">Как получить credentials</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>Открыть <a className="link" href="https://www.dropbox.com/developers/apps" target="_blank" rel="noreferrer">Dropbox App Console</a></li>
              <li>Create app → Scoped access → Full Dropbox → задать имя</li>
              <li>Вкладка Permissions: включить <code>files.metadata.read</code>, <code>files.content.read</code>, <code>account_info.read</code></li>
              <li>Вкладка Settings → OAuth 2 → Redirect URIs: добавить URL ниже</li>
              <li>Скопировать <b>App key</b> и <b>App secret</b> в поля ниже</li>
            </ol>
          </details>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">App key</span>
            <input
              className="input font-mono text-xs"
              value={appKey}
              onChange={(e) => setAppKey(e.target.value)}
              placeholder="xxxxxxxxxxxxxxx"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              App secret {hasSecret && <span className="text-emerald-600">· сохранён</span>}
            </span>
            <input
              className="input font-mono text-xs"
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={hasSecret ? "Оставьте пустым, чтобы не менять" : "xxxxxxxxxxxxxxxxxxxxxx"}
              autoComplete="new-password"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Redirect URI</span>
            <input
              className="input font-mono text-xs"
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
            />
            <span className="mt-1 block text-[11px] text-neutral-500">
              Обычно: <code>{window.location.origin}/api/integrations/storage/dropbox/callback</code>
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Отмена</Button>
            <Button
              variant="primary"
              disabled={!canSubmit || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
              Сохранить
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
