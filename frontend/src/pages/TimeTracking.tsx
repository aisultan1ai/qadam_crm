import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus, Trash2, Check } from "lucide-react";
import clsx from "clsx";
import { api, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { useToast } from "@/components/Toast";
import { Loader } from "@/components/ui";

type TimeEntry = {
  id: number;
  task_id: number | null;
  task_title: string | null;
  user_id: number;
  user_name: string | null;
  started_at: string;
  ended_at: string | null;
  seconds: number;
  description: string | null;
  is_billable: boolean;
  approval_status: "pending" | "approved" | "rejected";
};

type SummaryBucket = { key: string; label: string; seconds: number; billable_cents: number };
type Summary = {
  group_by: string;
  from: string;
  to: string;
  total_seconds: number;
  buckets: SummaryBucket[];
};

type Timesheet = {
  id: number;
  user_id: number;
  period_start: string;
  period_end: string;
  total_seconds: number;
  status: "pending" | "approved" | "rejected";
  submitted_at: string | null;
  approver_id: number | null;
  approved_at: string | null;
  comment: string | null;
};

function fmtSec(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}ч ${m}м`;
}

function fmtSecShort(s: number): string {
  if (s === 0) return "";
  const h = s / 3600;
  return h >= 1 ? `${h.toFixed(1)}ч` : `${Math.round(s / 60)}м`;
}

function startOfWeek(d: Date): Date {
  const day = d.getDay() || 7; // Пн=1..Вс=7
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export default function TimeTracking() {
  const { can, me } = useAuth();
  const canApprove = can("time.approve");
  const qc = useQueryClient();
  const toast = useToast();

  const [tab, setTab] = useState<"week" | "reports" | "timesheets">("week");
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));

  const weekEnd = useMemo(() => {
    const e = new Date(weekStart);
    e.setDate(e.getDate() + 7);
    return e;
  }, [weekStart]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Тайм-трекинг</h1>
        <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-1 text-sm dark:border-neutral-700 dark:bg-neutral-900">
          {(["week", "reports", "timesheets"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={clsx(
                "rounded-md px-3 py-1.5",
                tab === k
                  ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
                  : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
              )}
            >
              {k === "week" ? "Неделя" : k === "reports" ? "Отчёты" : "Табели"}
            </button>
          ))}
        </div>
      </div>

      {tab === "week" && (
        <WeekView
          weekStart={weekStart}
          weekEnd={weekEnd}
          onPrev={() => {
            const p = new Date(weekStart);
            p.setDate(p.getDate() - 7);
            setWeekStart(p);
          }}
          onNext={() => {
            const n = new Date(weekStart);
            n.setDate(n.getDate() + 7);
            setWeekStart(n);
          }}
          onSubmit={async () => {
            try {
              await api.post("/api/time-tracking/timesheets/submit", {
                period_start: weekStart.toISOString(),
                period_end: weekEnd.toISOString(),
              });
              toast.success("Табель отправлен");
              qc.invalidateQueries({ queryKey: ["timesheets"] });
            } catch (e) {
              toast.error("Не удалось", extractApiError(e).message);
            }
          }}
        />
      )}

      {tab === "reports" && <ReportsView canApprove={canApprove} />}

      {tab === "timesheets" && <TimesheetsView canApprove={canApprove} />}
    </div>
  );
}

// =============================================================================
// Week view
// =============================================================================


function WeekView({
  weekStart, weekEnd, onPrev, onNext, onSubmit,
}: {
  weekStart: Date;
  weekEnd: Date;
  onPrev: () => void;
  onNext: () => void;
  onSubmit: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: entries = [], isLoading } = useQuery<TimeEntry[]>({
    queryKey: ["time-entries", weekStart.toISOString()],
    queryFn: async () =>
      (await api.get<TimeEntry[]>("/api/time-tracking/entries", {
        params: { from: weekStart.toISOString(), to: weekEnd.toISOString(), limit: 500 },
      })).data,
  });

  const days = useMemo(() => {
    const arr: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, [weekStart]);

  const grid = useMemo(() => {
    // Группировка: task_id → dayIndex → sum seconds
    const map = new Map<string, { taskId: number | null; title: string; perDay: number[] }>();
    for (const e of entries) {
      const key = e.task_id ? `t:${e.task_id}` : `n:${e.description || "no-task"}`;
      if (!map.has(key)) {
        map.set(key, {
          taskId: e.task_id,
          title: e.task_title || e.description || "Без задачи",
          perDay: [0, 0, 0, 0, 0, 0, 0],
        });
      }
      const d = new Date(e.started_at);
      const dayIdx = Math.floor((d.getTime() - weekStart.getTime()) / (24 * 3600 * 1000));
      if (dayIdx >= 0 && dayIdx < 7) map.get(key)!.perDay[dayIdx] += e.seconds;
    }
    return Array.from(map.values());
  }, [entries, weekStart]);

  const dayTotals = useMemo(() => {
    const t = [0, 0, 0, 0, 0, 0, 0];
    for (const row of grid) row.perDay.forEach((s, i) => (t[i] += s));
    return t;
  }, [grid]);

  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/time-tracking/entries/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["time-entries"] }),
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  return (
    <div className="card space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button className="btn-ghost !p-2" onClick={onPrev} aria-label="Прошлая неделя">
            <ChevronLeft size={16} />
          </button>
          <div className="text-sm font-medium tabular-nums">
            {weekStart.toLocaleDateString("ru-RU")} — {new Date(weekEnd.getTime() - 86_400_000).toLocaleDateString("ru-RU")}
          </div>
          <button className="btn-ghost !p-2" onClick={onNext} aria-label="Следующая неделя">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm">Итого за неделю: <b>{fmtSec(weekTotal)}</b></div>
          <button className="btn-primary" onClick={onSubmit}>
            Отправить на утверждение
          </button>
        </div>
      </div>

      {isLoading ? (
        <Loader />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-700">
                <th className="py-2 pr-3">Задача / описание</th>
                {days.map((d) => (
                  <th key={d.toISOString()} className="px-2 py-2 text-center tabular-nums">
                    {d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric" })}
                  </th>
                ))}
                <th className="pl-3 pr-2 text-right">Итого</th>
              </tr>
            </thead>
            <tbody>
              {grid.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-neutral-500">
                    Пусто. Запустите таймер на любой задаче или добавьте запись вручную.
                  </td>
                </tr>
              )}
              {grid.map((row) => {
                const rowTotal = row.perDay.reduce((a, b) => a + b, 0);
                return (
                  <tr key={row.title + row.taskId} className="border-b border-neutral-100 dark:border-neutral-800">
                    <td className="py-2 pr-3">
                      {row.taskId ? (
                        <Link to={`/tasks/${row.taskId}`} className="link">{row.title}</Link>
                      ) : (
                        <span className="text-neutral-700 dark:text-neutral-300">{row.title}</span>
                      )}
                    </td>
                    {row.perDay.map((s, i) => (
                      <td key={i} className="px-2 py-2 text-center text-xs tabular-nums text-neutral-600 dark:text-neutral-400">
                        {fmtSecShort(s)}
                      </td>
                    ))}
                    <td className="pl-3 pr-2 text-right font-medium tabular-nums">{fmtSec(rowTotal)}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-neutral-200 bg-neutral-50 font-medium dark:border-neutral-700 dark:bg-neutral-900/50">
                <td className="py-2 pr-3 text-neutral-500">Итого по дню</td>
                {dayTotals.map((s, i) => (
                  <td key={i} className="px-2 py-2 text-center text-xs tabular-nums">{fmtSecShort(s)}</td>
                ))}
                <td className="pl-3 pr-2 text-right tabular-nums">{fmtSec(weekTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-neutral-100 pt-3 dark:border-neutral-800">
        <ManualEntryForm
          defaultDate={weekStart}
          onCreated={() => qc.invalidateQueries({ queryKey: ["time-entries"] })}
        />
      </div>

      {entries.length > 0 && (
        <div className="border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">Все записи недели</div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {entries.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between rounded-md border border-neutral-100 px-2 py-1 text-xs dark:border-neutral-800"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    {e.task_id ? (
                      <Link to={`/tasks/${e.task_id}`} className="link">{e.task_title || `#${e.task_id}`}</Link>
                    ) : (
                      <span className="text-neutral-700 dark:text-neutral-300">{e.description || "Без задачи"}</span>
                    )}
                  </div>
                  <div className="text-neutral-500">
                    {new Date(e.started_at).toLocaleString("ru-RU")} · {fmtSec(e.seconds)}
                    {e.approval_status === "approved" && <span className="ml-2 text-emerald-600">✓ утв.</span>}
                  </div>
                </div>
                {e.approval_status !== "approved" && (
                  <button
                    type="button"
                    onClick={() => del.mutate(e.id)}
                    className="btn-ghost !p-1 text-neutral-500 hover:text-red-600"
                    title="Удалить"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// =============================================================================
// Manual entry form
// =============================================================================


function ManualEntryForm({ defaultDate, onCreated }: { defaultDate: Date; onCreated: () => void }) {
  const toast = useToast();
  const [taskId, setTaskId] = useState<string>("");
  const [date, setDate] = useState<string>(defaultDate.toISOString().slice(0, 10));
  const [hours, setHours] = useState<string>("1");
  const [description, setDescription] = useState<string>("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const seconds = Math.round(parseFloat(hours || "0") * 3600);
    if (seconds <= 0) {
      toast.error("Некорректная длительность");
      return;
    }
    try {
      await api.post("/api/time-tracking/entries", {
        task_id: taskId ? Number(taskId) : null,
        started_at: new Date(`${date}T09:00:00`).toISOString(),
        seconds,
        description: description || null,
      });
      toast.success("Запись добавлена");
      setDescription("");
      setHours("1");
      onCreated();
    } catch (err) {
      toast.error("Не удалось добавить", extractApiError(err).message);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 text-sm">
      <div className="flex flex-col">
        <label className="text-xs text-neutral-500">Дата</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input !py-1" />
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-neutral-500">Часы</label>
        <input
          type="number"
          step="0.25"
          min="0.25"
          max="24"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className="input !py-1 !w-20"
        />
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-neutral-500">Задача ID (опц.)</label>
        <input
          type="number"
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          className="input !py-1 !w-24"
          placeholder="—"
        />
      </div>
      <div className="flex min-w-[200px] flex-1 flex-col">
        <label className="text-xs text-neutral-500">Описание</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="input !py-1"
          placeholder="Что делали"
        />
      </div>
      <button type="submit" className="btn-primary inline-flex items-center gap-1">
        <Plus size={14} />
        Добавить
      </button>
    </form>
  );
}


// =============================================================================
// Reports
// =============================================================================


function ReportsView({ canApprove }: { canApprove: boolean }) {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  const [from, setFrom] = useState(firstOfMonth.toISOString().slice(0, 10));
  const [to, setTo] = useState(nextMonth.toISOString().slice(0, 10));
  const [groupBy, setGroupBy] = useState<"user" | "project" | "task">(canApprove ? "user" : "project");

  const { data, isLoading } = useQuery<Summary>({
    queryKey: ["time-report", from, to, groupBy],
    queryFn: async () =>
      (await api.get<Summary>("/api/time-tracking/reports/summary", {
        params: {
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
          group_by: groupBy,
        },
      })).data,
  });

  return (
    <div className="card space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label className="text-xs text-neutral-500">С</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input !py-1" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-neutral-500">По</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input !py-1" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-neutral-500">Группировать</label>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)} className="input !py-1">
            {canApprove && <option value="user">По сотрудникам</option>}
            <option value="project">По проектам</option>
            <option value="task">По задачам</option>
          </select>
        </div>
        <div className="ml-auto text-sm">
          Всего: <b>{data ? fmtSec(data.total_seconds) : "—"}</b>
        </div>
      </div>

      {isLoading || !data ? (
        <Loader />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500 dark:border-neutral-700">
                <th className="py-2 pr-3">{groupBy === "user" ? "Сотрудник" : groupBy === "project" ? "Проект" : "Задача"}</th>
                <th className="px-2 py-2 text-right">Часы</th>
                <th className="pl-2 pr-2 text-right">Биллинг</th>
              </tr>
            </thead>
            <tbody>
              {data.buckets.length === 0 && (
                <tr><td colSpan={3} className="py-6 text-center text-neutral-500">Нет записей за период</td></tr>
              )}
              {data.buckets.map((b) => (
                <tr key={b.key} className="border-b border-neutral-100 dark:border-neutral-800">
                  <td className="py-2 pr-3">{b.label}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtSec(b.seconds)}</td>
                  <td className="pl-2 pr-2 text-right tabular-nums text-neutral-500">
                    {b.billable_cents > 0 ? `${(b.billable_cents / 100).toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// =============================================================================
// Timesheets
// =============================================================================


function TimesheetsView({ canApprove }: { canApprove: boolean }) {
  const [onlyMine, setOnlyMine] = useState(!canApprove);
  const qc = useQueryClient();
  const toast = useToast();

  const { data: sheets = [], isLoading } = useQuery<Timesheet[]>({
    queryKey: ["timesheets", onlyMine],
    queryFn: async () =>
      (await api.get<Timesheet[]>("/api/time-tracking/timesheets", {
        params: { only_mine: onlyMine },
      })).data,
  });

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "approve" | "reject" }) =>
      api.post(`/api/time-tracking/timesheets/${id}/decide`, { action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timesheets"] });
      toast.success("Решение сохранено");
    },
    onError: (e) => toast.error("Не удалось", extractApiError(e).message),
  });

  return (
    <div className="card space-y-3 p-4">
      {canApprove && (
        <div className="flex items-center gap-2 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(e) => setOnlyMine(e.target.checked)}
            />
            Только мои табели
          </label>
        </div>
      )}
      {isLoading ? (
        <Loader />
      ) : sheets.length === 0 ? (
        <div className="py-8 text-center text-sm text-neutral-500">Табелей пока нет</div>
      ) : (
        <div className="space-y-2">
          {sheets.map((ts) => {
            const canDecide = canApprove && !onlyMine && ts.status === "pending";
            return (
              <div
                key={ts.id}
                className="flex items-center justify-between rounded-lg border border-neutral-200 p-3 dark:border-neutral-700"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {new Date(ts.period_start).toLocaleDateString("ru-RU")} —{" "}
                    {new Date(ts.period_end).toLocaleDateString("ru-RU")}
                  </div>
                  <div className="text-xs text-neutral-500">
                    Всего: {fmtSec(ts.total_seconds)} · Пользователь #{ts.user_id}
                    {ts.comment && <> · {ts.comment}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={ts.status} />
                  {canDecide && (
                    <>
                      <button
                        type="button"
                        onClick={() => decide.mutate({ id: ts.id, action: "approve" })}
                        className="btn-primary !py-1 !px-2 text-xs"
                      >
                        <Check size={12} className="mr-1 inline" />
                        Одобрить
                      </button>
                      <button
                        type="button"
                        onClick={() => decide.mutate({ id: ts.id, action: "reject" })}
                        className="btn-ghost !py-1 !px-2 text-xs text-red-600"
                      >
                        Отклонить
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "approved"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : status === "rejected"
      ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
      : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  const label = status === "approved" ? "Утверждён" : status === "rejected" ? "Отклонён" : "На утверждении";
  return <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", cls)}>{label}</span>;
}
