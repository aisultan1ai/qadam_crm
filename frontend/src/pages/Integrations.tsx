import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { Puzzle, Check, ExternalLink } from "lucide-react";
import clsx from "clsx";
import { useToast } from "@/components/Toast";

type Provider = {
  id: number;
  code: string;
  label: string;
  category: string;
  status: string;
  is_enabled: boolean;
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

export default function IntegrationsPage() {
  const qc = useQueryClient();
  const toast = useToast();
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
        window.open(url, "_blank", "noopener,noreferrer");
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
            {items.map((p) => {
              const style = STATUS_STYLE[p.status] || STATUS_STYLE.coming_soon;
              return (
                <div key={p.id} className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{p.label}</div>
                      <span className={clsx("mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium", style.color)}>
                        {style.label}
                      </span>
                    </div>
                    {p.is_enabled && (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        <Check size={11} /> вкл.
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      className="btn-secondary flex-1"
                      disabled={p.status === "coming_soon"}
                      onClick={() => start.mutate(p.code)}
                    >
                      <ExternalLink size={13} /> Подключить
                    </button>
                    <button
                      className={clsx("btn-ghost", p.is_enabled ? "text-rose-500" : "text-emerald-600")}
                      onClick={() => toggle.mutate(p.code)}
                    >
                      {p.is_enabled ? "Выкл." : "Вкл."}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
