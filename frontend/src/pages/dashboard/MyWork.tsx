/**
 * «Моя работа» (Home в ClickUp): мои задачи по корзинам — Просрочено / Сегодня / Дальше / Позже / Без срока.
 * Кружок отмечает задачу выполненной, клик по названию открывает её в боковой панели,
 * в «Сегодня» и «Без срока» можно быстро добавить задачу себе.
 */
import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, Check, CheckCircle2, ChevronDown, Flag, Plus } from "lucide-react";

import { api, extractApiError } from "@/api/client";
import { Skeleton } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/store/auth";
import type { Page, TaskListItem } from "@/types";
import { PRIORITY_META } from "../tasks/grouping";
import { TaskDrawer } from "../tasks/TaskDrawer";
import { endOfDayISO, useTaskPatch } from "../tasks/useTaskPatch";

type BucketKey = "overdue" | "today" | "next" | "later" | "none";
const BUCKETS: { key: BucketKey; label: string; color: string; hint: string }[] = [
  { key: "overdue", label: "Просрочено", color: "#E11D48", hint: "Срок прошёл" },
  { key: "today", label: "Сегодня", color: "#F59E0B", hint: "Срок сегодня" },
  { key: "next", label: "Дальше", color: "#0284C7", hint: "Ближайшие 7 дней" },
  { key: "later", label: "Позже", color: "#4C5462", hint: "Больше чем через неделю" },
  { key: "none", label: "Без срока", color: "#979EAA", hint: "Срок не назначен" },
];

function bucketOf(t: TaskListItem): BucketKey {
  if (!t.deadline) return "none";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(t.deadline).setHours(0, 0, 0, 0) - today.getTime()) / 86400000);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 7) return "next";
  return "later";
}

function fmtDate(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function MyWork() {
  const { me, can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const patch = useTaskPatch();
  const canCreate = can("tasks.create");
  const canComplete = can("tasks.update") && can("tasks.change_status");

  // Ключ начинается с "tasks" — правки из панели и списка сразу видны здесь.
  const { data, isPending } = useQuery({
    queryKey: ["tasks", { scope: "incoming", per_page: 200, view: "my-work" }],
    queryFn: async () =>
      (await api.get<Page<TaskListItem>>("/api/tasks", { params: { scope: "incoming", per_page: 200 } })).data.items,
    staleTime: 30_000,
  });

  const buckets = useMemo(() => {
    const m: Record<BucketKey, TaskListItem[]> = { overdue: [], today: [], next: [], later: [], none: [] };
    (data ?? [])
      .filter((t) => t.status !== "done" && t.status !== "cancelled")
      .forEach((t) => m[bucketOf(t)].push(t));
    const byDeadline = (a: TaskListItem, b: TaskListItem) =>
      (a.deadline ? new Date(a.deadline).getTime() : 0) - (b.deadline ? new Date(b.deadline).getTime() : 0);
    Object.values(m).forEach((arr) => arr.sort(byDeadline));
    return m;
  }, [data]);
  const openCount = Object.values(buckets).reduce((n, arr) => n + arr.length, 0);

  const [collapsed, setCollapsed] = useState<Set<BucketKey>>(new Set(["later"]));
  const toggle = (k: BucketKey) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const openTaskId = Number(sp.get("task")) || null;
  const openTask = (id: number) => {
    const next = new URLSearchParams(sp);
    next.set("task", String(id));
    setSp(next);
  };
  const closeTask = useCallback(() => {
    const next = new URLSearchParams(sp);
    next.delete("task");
    setSp(next, { replace: true });
  }, [sp, setSp]);

  return (
    <section className="card overflow-hidden">
      <div className="card-header">
        <div className="flex items-center gap-2">
          <h2 className="card-title">Моя работа</h2>
          {data && (
            <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-zinc-600 dark:bg-[#23262D] dark:text-zinc-400">
              {openCount}
            </span>
          )}
        </div>
        <Link to="/tasks?scope=incoming" className="link inline-flex items-center gap-1 text-[13px]">
          Все мои задачи <ArrowRight size={14} />
        </Link>
      </div>

      {isPending ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
          {openCount === 0 && (
            <div className="px-5 py-8 text-center">
              <CheckCircle2 size={22} className="mx-auto mb-2 text-emerald-500" />
              <div className="text-sm font-medium">Открытых задач нет</div>
              <div className="mt-1 text-[13px] text-zinc-500">Новые назначения появятся здесь</div>
            </div>
          )}
          {BUCKETS.map((b) => {
            const items = buckets[b.key];
            const quickAdd = canCreate && (b.key === "today" || b.key === "none");
            // Пустые корзины прячем, кроме «Сегодня» — туда удобно быстро добавить задачу.
            if (items.length === 0 && !(b.key === "today" && quickAdd && openCount > 0)) return null;
            const isCollapsed = collapsed.has(b.key);
            return (
              <div key={b.key}>
                <button
                  type="button"
                  onClick={() => toggle(b.key)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-[#23262D]"
                >
                  <ChevronDown size={15} className={clsx("text-zinc-400 transition-transform", isCollapsed && "-rotate-90")} />
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
                  <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">{b.label}</span>
                  <span className="text-[13px] tabular-nums text-zinc-500">{items.length}</span>
                  <span className="ml-auto hidden text-xs text-zinc-400 sm:inline">{b.hint}</span>
                </button>
                {!isCollapsed && (
                  <ul>
                    {items.map((t) => (
                      <li key={t.id} className="group flex items-center gap-2.5 py-1.5 pl-10 pr-4 hover:bg-zinc-50 dark:hover:bg-[#23262D]">
                        <button
                          type="button"
                          disabled={!canComplete}
                          onClick={() => patch.mutate({ id: t.id, body: { status: "done" }, optimistic: { status: "done" } })}
                          aria-label={`Отметить «${t.title}» выполненной`}
                          title={canComplete ? "Отметить выполненной" : undefined}
                          className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-zinc-300 text-transparent transition-colors hover:border-emerald-500 hover:text-emerald-500 disabled:hover:border-zinc-300 disabled:hover:text-transparent dark:border-zinc-600"
                        >
                          <Check size={11} strokeWidth={3} />
                        </button>
                        <Link
                          to={`/tasks/${t.id}`}
                          onClick={(e) => {
                            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                            e.preventDefault();
                            openTask(t.id);
                          }}
                          className="min-w-0 flex-1 truncate text-sm text-zinc-900 hover:text-brand-700 dark:text-zinc-100 dark:hover:text-brand-300"
                        >
                          {t.title}
                        </Link>
                        {t.priority !== "low" && t.priority !== "medium" && (
                          <Flag size={13} className="shrink-0 fill-current" style={{ color: PRIORITY_META[t.priority].color }} />
                        )}
                        {t.deadline && (
                          <span
                            className={clsx(
                              "w-16 shrink-0 text-right text-xs tabular-nums",
                              b.key === "overdue" ? "font-medium text-rose-600 dark:text-rose-400" : "text-zinc-500",
                            )}
                          >
                            {fmtDate(t.deadline)}
                          </span>
                        )}
                      </li>
                    ))}
                    {quickAdd && me && (
                      <QuickAddMine deadline={b.key === "today" ? "today" : null} userId={me.id} />
                    )}
                  </ul>
                )}
              </div>
            );
          })}
          {openCount === 0 && canCreate && me && (
            <ul>
              <QuickAddMine deadline="today" userId={me.id} />
            </ul>
          )}
        </div>
      )}
      {openTaskId && <TaskDrawer taskId={openTaskId} onClose={closeTask} />}
    </section>
  );
}

function QuickAddMine({ deadline, userId }: { deadline: "today" | null; userId: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const create = useMutation({
    mutationFn: (t: string) =>
      api.post("/api/tasks", {
        title: t,
        assignee_id: userId,
        deadline: deadline === "today" ? endOfDayISO(new Date()) : null,
      }),
    onSuccess: () => {
      setTitle("");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error("Не удалось создать задачу", extractApiError(e).message),
  });
  if (!open) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 py-2 pl-10 pr-4 text-left text-[13px] text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 dark:hover:bg-[#23262D] dark:hover:text-zinc-200"
        >
          <Plus size={14} /> {deadline === "today" ? "Задача на сегодня" : "Добавить задачу"}
        </button>
      </li>
    );
  }
  return (
    <li>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = title.trim();
          if (t && !create.isPending) create.mutate(t);
        }}
        className="flex items-center gap-2 py-1.5 pl-10 pr-4"
      >
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              setTitle("");
            }
          }}
          onBlur={() => !title.trim() && setOpen(false)}
          placeholder="Название задачи и Enter"
          aria-label="Название новой задачи"
          className="h-8 min-w-0 flex-1 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100"
        />
        <button type="submit" disabled={!title.trim() || create.isPending} className="btn-primary !h-7 !px-2.5 !py-0 !text-xs">
          Сохранить
        </button>
      </form>
    </li>
  );
}
