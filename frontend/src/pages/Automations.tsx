import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Plus, Power, PowerOff, Pencil, Trash2, Play, History, Workflow, Loader2,
} from "lucide-react";
import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/ui";

type Automation = {
  id: number;
  name: string;
  description: string | null;
  trigger_event: string;
  trigger_config: Record<string, unknown>;
  graph: { nodes?: unknown[]; edges?: unknown[] };
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
  runs_last_7d: number | null;
  last_run_at: string | null;
};

type AutomationRun = {
  id: number;
  status: "running" | "succeeded" | "failed" | "partial";
  triggered_at: string;
  finished_at: string | null;
  is_dry_run: boolean;
  error: string | null;
  trigger_payload: Record<string, unknown>;
  actions: Array<{
    id: number;
    node_id: string;
    action_type: string;
    status: string;
    scheduled_for: string | null;
    executed_at: string | null;
    result: Record<string, unknown>;
    error: string | null;
  }>;
};

const STATUS_COLOR: Record<string, string> = {
  succeeded: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  failed: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  running: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  scheduled: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  pending: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800",
  skipped: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800",
};

const EVENT_LABEL: Record<string, string> = {
  "task.created": "Задача создана",
  "task.updated": "Задача изменена",
  "task.status_changed": "Статус задачи изменён",
  "task.completed": "Задача завершена",
  "task.deadline_near": "Приближается дедлайн",
  "lead.created": "Лид создан",
  "lead.status_changed": "Статус лида изменён",
  "comment.added": "Добавлен комментарий",
  "project.created": "Проект создан",
  "form.submitted": "Заполнена форма",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

export default function Automations() {
  const qc = useQueryClient();
  const toast = useToast();
  const [deleting, setDeleting] = useState<Automation | null>(null);
  const [viewingRuns, setViewingRuns] = useState<Automation | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ["automations"],
    queryFn: async () => (await api.get<Automation[]>("/api/automations")).data,
  });

  const toggle = useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) =>
      (await api.patch(`/api/automations/${id}`, { is_active })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }),
    onError: (e) => toast.error("Не удалось изменить", extractApiError(e).message),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/automations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automations"] });
      setDeleting(null);
      toast.success("Автоматизация удалена");
    },
    onError: (e) => toast.error("Ошибка удаления", extractApiError(e).message),
  });

  const stats = useMemo(() => {
    if (!data) return null;
    return {
      total: data.length,
      active: data.filter((a) => a.is_active).length,
      runs7d: data.reduce((s, a) => s + (a.runs_last_7d ?? 0), 0),
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Автоматизации</h1>
          <p className="text-sm text-neutral-500">
            Триггеры и роботы: реагируйте на события системы без ручной работы
          </p>
        </div>
        <Link to="/automations/new" className="btn-primary">
          <Plus size={16} /> Новая автоматизация
        </Link>
      </div>

      {stats && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Всего" value={stats.total} icon={<Workflow size={16} />} />
          <StatCard
            label="Активных"
            value={stats.active}
            icon={<Power size={16} />}
            tone={stats.active === stats.total && stats.total > 0 ? "success" : undefined}
          />
          <StatCard label="Запусков за 7 дней" value={stats.runs7d} icon={<History size={16} />} />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 dark:bg-neutral-900/40 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">Название</th>
              <th className="px-3 py-2">Триггер</th>
              <th className="px-3 py-2 text-right">Запусков (7 дн.)</th>
              <th className="px-3 py-2">Последний запуск</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2 text-right w-32">Действия</th>
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                  <Loader2 size={16} className="mx-auto animate-spin" />
                </td>
              </tr>
            )}
            {!isPending && data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-neutral-500">
                  <Workflow size={28} className="mx-auto mb-2 text-neutral-400" />
                  <div>Автоматизаций ещё нет</div>
                  <Link to="/automations/new" className="link text-sm">Создать первую</Link>
                </td>
              </tr>
            )}
            {data?.map((a) => {
              const nodesCount = (a.graph.nodes || []).length;
              return (
                <tr
                  key={a.id}
                  className="border-t border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50/50 dark:hover:bg-neutral-800/20"
                >
                  <td className="px-3 py-2">
                    <Link to={`/automations/${a.id}`} className="font-medium hover:text-brand-600">
                      {a.name}
                    </Link>
                    {a.description && (
                      <div className="text-xs text-neutral-500 line-clamp-1">{a.description}</div>
                    )}
                    <div className="mt-0.5 text-[11px] text-neutral-400">
                      {nodesCount} {nodesCount === 1 ? "элемент" : "элементов"} в графе
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="chip bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                      {EVENT_LABEL[a.trigger_event] || a.trigger_event}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.runs_last_7d ?? 0}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500">{formatDate(a.last_run_at)}</td>
                  <td className="px-3 py-2">
                    <button
                      className={clsx(
                        "chip",
                        a.is_active
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800",
                      )}
                      onClick={() => toggle.mutate({ id: a.id, is_active: !a.is_active })}
                      title={a.is_active ? "Выключить" : "Включить"}
                    >
                      {a.is_active ? <><Power size={12} /> активна</> : <><PowerOff size={12} /> выключена</>}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        className="btn-ghost !py-1 !px-1.5"
                        title="История запусков"
                        onClick={() => setViewingRuns(a)}
                      >
                        <History size={14} />
                      </button>
                      <Link
                        to={`/automations/${a.id}`}
                        className="btn-ghost !py-1 !px-1.5"
                        title="Редактировать"
                      >
                        <Pencil size={14} />
                      </Link>
                      <button
                        className="btn-ghost !py-1 !px-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        title="Удалить"
                        onClick={() => setDeleting(a)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Удалить автоматизацию?" size="md">
          <div className="space-y-3">
            <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
              «{deleting.name}» будет удалена вместе со всей историей запусков.
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setDeleting(null)}>Отмена</button>
              <button
                className="btn-primary bg-rose-600 hover:bg-rose-700"
                disabled={del.isPending}
                onClick={() => del.mutate(deleting.id)}
              >
                Удалить
              </button>
            </div>
          </div>
        </Modal>
      )}

      {viewingRuns && (
        <RunsModal automation={viewingRuns} onClose={() => setViewingRuns(null)} />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  tone?: "success";
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        {icon}
        {label}
      </div>
      <div className={clsx("mt-1 text-2xl font-semibold tabular-nums", tone === "success" && "text-emerald-600")}>
        {value}
      </div>
    </div>
  );
}

function RunsModal({ automation, onClose }: { automation: Automation; onClose: () => void }) {
  const [selected, setSelected] = useState<AutomationRun | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["automation-runs", automation.id],
    queryFn: async () =>
      (await api.get<AutomationRun[]>(`/api/automations/${automation.id}/runs`)).data,
  });

  return (
    <Modal open onClose={onClose} title={`История: ${automation.name}`} size="xl">
      <div className="space-y-4">
        {isLoading && (
          <div className="py-8 text-center text-sm text-neutral-500">
            <Loader2 size={16} className="mx-auto animate-spin" />
          </div>
        )}
        {!isLoading && data?.length === 0 && (
          <div className="py-8 text-center text-sm text-neutral-500">Запусков ещё не было</div>
        )}
        {data && data.length > 0 && (
          <div className="grid gap-4 md:grid-cols-[280px_1fr]">
            <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-2">
              {data.map((r) => (
                <button
                  key={r.id}
                  className={clsx(
                    "w-full rounded-lg border p-2 text-left text-xs transition-colors",
                    selected?.id === r.id
                      ? "border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-950/30"
                      : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/40",
                  )}
                  onClick={() => setSelected(r)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={clsx("chip", STATUS_COLOR[r.status])}>{r.status}</span>
                    {r.is_dry_run && <span className="text-[10px] text-neutral-400">DRY-RUN</span>}
                  </div>
                  <div className="mt-1 text-neutral-600 dark:text-neutral-400">
                    {formatDate(r.triggered_at)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-neutral-500">
                    {r.actions.length} действий
                  </div>
                </button>
              ))}
            </div>
            <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-neutral-200 p-3 text-xs dark:border-neutral-800">
              {!selected && (
                <div className="text-neutral-500">Выберите запуск слева, чтобы увидеть детали</div>
              )}
              {selected && (
                <div className="space-y-3">
                  <div>
                    <div className="font-semibold text-sm">Статус запуска</div>
                    <span className={clsx("chip mt-1", STATUS_COLOR[selected.status])}>
                      {selected.status}
                    </span>
                    {selected.error && (
                      <div className="mt-2 rounded bg-rose-50 p-2 text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                        {selected.error}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="mb-1 font-semibold text-sm">Действия</div>
                    <div className="space-y-1">
                      {selected.actions.map((a) => (
                        <div
                          key={a.id}
                          className="rounded border border-neutral-200 p-2 dark:border-neutral-800"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-mono text-[11px] text-neutral-500">
                              {a.node_id}
                            </div>
                            <span className={clsx("chip", STATUS_COLOR[a.status])}>{a.status}</span>
                          </div>
                          <div className="mt-1 font-medium">{a.action_type}</div>
                          {a.result && Object.keys(a.result).length > 0 && (
                            <pre className="mt-1 overflow-x-auto rounded bg-neutral-50 p-2 text-[10px] dark:bg-neutral-900">
                              {JSON.stringify(a.result, null, 2)}
                            </pre>
                          )}
                          {a.error && (
                            <div className="mt-1 rounded bg-rose-50 p-1.5 text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                              {a.error}
                            </div>
                          )}
                          {a.scheduled_for && (
                            <div className="mt-1 text-[10px] text-neutral-500">
                              ⏱ scheduled: {formatDate(a.scheduled_for)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <details>
                    <summary className="cursor-pointer text-neutral-500 hover:text-neutral-700">
                      Trigger payload
                    </summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-neutral-50 p-2 text-[10px] dark:bg-neutral-900">
                      {JSON.stringify(selected.trigger_payload, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
