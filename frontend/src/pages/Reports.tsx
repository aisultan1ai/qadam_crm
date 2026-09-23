import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { PieChart, Play, BarChart3, Sparkles } from "lucide-react";
import clsx from "clsx";
import { EmptyState } from "@/components/ui";
import { useAuth } from "@/store/auth";

type Standard = { key: string; label: string; metric: string; group_by: string; description: string };
type MetaOut = { metrics: { key: string; label: string }[]; groups: { key: string; label: string }[] };
type ReportRow = { group?: string | null; group_id?: number | null; value: number; count: number };
type ReportOut = { metric: string; group_by: string; rows: ReportRow[]; total: number; meta: { unit?: string } };

export default function ReportsPage() {
  const { can } = useAuth();
  const [selected, setSelected] = useState<{ metric: string; group_by: string } | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: standard } = useQuery({
    queryKey: ["reports-standard"],
    queryFn: async () => (await api.get<Standard[]>("/api/reports/standard")).data,
    enabled: can("analytics.reports"),
  });
  const { data: meta } = useQuery({
    queryKey: ["reports-meta"],
    queryFn: async () => (await api.get<MetaOut>("/api/reports/metrics")).data,
    enabled: can("analytics.reports"),
  });
  const { data: result, isFetching } = useQuery({
    queryKey: ["reports-run", selected, from, to],
    queryFn: async () =>
      (
        await api.get<ReportOut>("/api/reports/run", {
          params: {
            metric: selected!.metric,
            group_by: selected!.group_by,
            from_date: from || undefined,
            to_date: to || undefined,
          },
        })
      ).data,
    enabled: !!selected && can("analytics.reports"),
  });

  if (!can("analytics.reports")) {
    return <EmptyState icon={<PieChart size={32} />} title="Нет доступа к отчётам" description="Требуется право analytics.reports" />;
  }

  const maxValue = result ? Math.max(1, ...result.rows.map((r) => r.value)) : 1;
  const unit = result?.meta.unit || "";

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Отчёты</h1>
        <p className="page-subtitle">Готовые шаблоны и конструктор произвольных срезов</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <div className="card p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Sparkles size={14} className="text-brand-500" /> Готовые отчёты
            </div>
            <div className="space-y-1">
              {(standard || []).map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSelected({ metric: s.metric, group_by: s.group_by })}
                  className={clsx(
                    "flex w-full flex-col items-start rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    selected?.metric === s.metric && selected?.group_by === s.group_by
                      ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                      : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50",
                  )}
                >
                  <div className="font-medium">{s.label}</div>
                  <div className="text-xs text-neutral-500">{s.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Play size={14} className="text-brand-500" /> Конструктор
            </div>
            <div className="space-y-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Метрика</span>
                <select
                  className="input"
                  value={selected?.metric || ""}
                  onChange={(e) => setSelected({ metric: e.target.value, group_by: selected?.group_by || "assignee" })}
                >
                  <option value="">— выберите —</option>
                  {meta?.metrics.map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Группировка</span>
                <select
                  className="input"
                  value={selected?.group_by || "assignee"}
                  onChange={(e) => setSelected({ metric: selected?.metric || "tasks_count", group_by: e.target.value })}
                >
                  {meta?.groups.map((g) => (
                    <option key={g.key} value={g.key}>{g.label}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">С</span>
                  <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">По</span>
                  <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="card p-4">
          {!selected ? (
            <EmptyState icon={<BarChart3 size={32} />} title="Выберите отчёт" description="Или соберите свой в конструкторе слева" />
          ) : isFetching ? (
            <div className="h-64 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />
          ) : !result || result.rows.length === 0 ? (
            <EmptyState icon={<BarChart3 size={32} />} title="Нет данных" description="Попробуй другой период или метрику" />
          ) : (
            <>
              <div className="mb-3 flex items-baseline justify-between">
                <div>
                  <div className="text-sm text-neutral-500">Итого</div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {result.total.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} <span className="text-sm font-normal text-neutral-500">{unit}</span>
                  </div>
                </div>
                <div className="text-xs text-neutral-500">{result.rows.length} строк</div>
              </div>

              <div className="space-y-2">
                {result.rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-40 shrink-0 truncate text-sm">{r.group || "—"}</div>
                    <div className="relative flex-1 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                      <div
                        className="h-6 rounded bg-brand-500 transition-[width] duration-300"
                        style={{ width: `${(r.value / maxValue) * 100}%` }}
                      />
                    </div>
                    <div className="w-24 shrink-0 text-right text-sm font-medium tabular-nums">
                      {r.value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
