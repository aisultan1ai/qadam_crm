import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  AlertTriangle, ArrowRight, CheckCircle2, CircleDot, Clock, Coins, FolderKanban, ListTodo, Plus, Users,
} from "lucide-react";

import { api } from "@/api/client";
import { STATUS_LABEL, type Page, type TaskListItem, type TaskStatus } from "@/types";
import { Skeleton } from "@/components/Skeleton";
import { PriorityChip, StatusChip } from "@/components/ui";
import { useAuth } from "@/store/auth";
import { fromNow } from "@/lib/date";
import { BirthdaysWidget, MyGoalsWidget, KudosFeedWidget } from "@/components/HRWidgets";

type DashboardStats = {
  total: number;
  in_progress: number;
  done: number;
  overdue: number;
  by_status: Record<string, number>;
};

type Forecast = {
  currency: string;
  total_amount_cents: number;
  weighted_amount_cents: number;
  won_amount_cents: number;
  open_count: number;
  won_count: number;
  lost_count: number;
};

type ActivityItem = {
  id: number;
  action: string;
  entity?: string | null;
  entity_id?: number | null;
  task_id?: number | null;
  detail?: string | null;
  created_at: string;
  user?: { id: number; name: string } | null;
};

const STATUS_BAR: Record<TaskStatus, string> = {
  new: "bg-indigo-500",
  in_progress: "bg-sky-500",
  review: "bg-amber-500",
  done: "bg-emerald-500",
  cancelled: "bg-zinc-400",
};

const ACTION_VERB: Record<string, string> = {
  create: "создал(а)",
  update: "обновил(а)",
  delete: "удалил(а)",
  archive: "архивировал(а)",
  unarchive: "вернул(а) из архива",
  bulk_update: "массово обновил(а)",
  comment: "прокомментировал(а)",
};

const ENTITY_LABEL: Record<string, string> = {
  task: "задачу",
  project: "проект",
  comment: "комментарий",
  contact: "контакт",
  company: "компанию",
  lead: "лид",
  deal: "сделку",
  wiki_article: "статью",
};

const money = (cents: number, currency: string) =>
  `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(cents / 100))} ${
    currency === "KZT" ? "₸" : currency
  }`;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

export default function DashboardPage() {
  const { me, can } = useAuth();
  const canTasks = can(["tasks.view_all", "tasks.view_own"]);
  const canDeals = can("deals.view");

  const { data: stats, isPending } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get<DashboardStats>("/api/analytics/dashboard")).data,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: projectsMeta } = useQuery({
    queryKey: ["projects-count"],
    queryFn: async () =>
      (await api.get<{ total: number }>("/api/projects", { params: { page: 1, per_page: 1 } })).data,
    staleTime: 60_000,
  });

  const isEmptyTenant = !!stats && stats.total === 0 && (projectsMeta?.total ?? 0) === 0;
  const firstName = (me?.name || "").split(" ")[0];
  const today = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="flex flex-col gap-6">
      <div className="page-header">
        <div>
          <p className="section-label first-letter:uppercase">{today}</p>
          <h1 className="page-title mt-1">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}
          </h1>
        </div>
        <div className="flex gap-2">
          {can("projects.view") && (
            <Link to="/projects" className="btn-secondary">
              <FolderKanban size={16} /> Проекты
            </Link>
          )}
          {canTasks && (
            <Link to="/tasks" className="btn-primary">
              <Plus size={16} /> Задачи
            </Link>
          )}
        </div>
      </div>

      {isPending || !stats ? (
        <DashboardSkeleton />
      ) : isEmptyTenant ? (
        <Onboarding />
      ) : (
        <div className="space-y-6">
          <StatRow stats={stats} />

          {/* Две независимые колонки: блоки идут друг под другом без пустот между рядами. */}
          <div className="grid items-start gap-6 xl:grid-cols-3">
            <div className="space-y-6 xl:col-span-2">
              {canTasks ? <MyTasks /> : <StatusBreakdown stats={stats} />}
              <RecentActivity />
            </div>
            <div className="space-y-6">
              {canTasks && <StatusBreakdown stats={stats} />}
              {canDeals && <DealsSummary />}
              <MyGoalsWidget />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <BirthdaysWidget />
            <KudosFeedWidget />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function StatRow({ stats }: { stats: DashboardStats }) {
  const items = [
    { label: "Всего задач", value: stats.total, icon: ListTodo, to: "/tasks", tone: "text-zinc-500" },
    { label: "В работе", value: stats.in_progress, icon: Clock, to: "/tasks", tone: "text-sky-600 dark:text-sky-400" },
    { label: "Завершено", value: stats.done, icon: CheckCircle2, to: "/tasks", tone: "text-emerald-600 dark:text-emerald-400" },
    {
      label: "Просрочено",
      value: stats.overdue,
      icon: AlertTriangle,
      to: "/tasks",
      tone: stats.overdue > 0 ? "text-rose-600 dark:text-rose-400" : "text-zinc-500",
      alert: stats.overdue > 0,
    },
  ];
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-zinc-200 bg-white lg:grid-cols-4 dark:border-zinc-800 dark:bg-[#14171C]">
      {items.map((it, i) => {
        const Icon = it.icon;
        return (
          <Link
            key={it.label}
            to={it.to}
            className={clsx(
              "group flex flex-col gap-3 p-5 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 dark:hover:bg-[#1B1F26]",
              i % 2 === 1 && "border-l border-zinc-200 dark:border-zinc-800",
              i >= 2 && "border-t border-zinc-200 lg:border-t-0 dark:border-zinc-800",
              i === 2 && "lg:border-l",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">{it.label}</span>
              <Icon size={16} className={it.tone} />
            </div>
            <div
              className={clsx(
                "text-[28px] font-semibold leading-none tabular-nums tracking-tight",
                it.alert ? "text-rose-600 dark:text-rose-400" : "text-zinc-900 dark:text-white",
              )}
            >
              {it.value.toLocaleString("ru-RU")}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function MyTasks() {
  const { data, isPending } = useQuery({
    queryKey: ["dashboard", "my-tasks"],
    queryFn: async () =>
      (
        await api.get<Page<TaskListItem>>("/api/tasks", {
          params: { scope: "incoming", page: 1, per_page: 100 },
        })
      ).data.items,
    staleTime: 30_000,
  });

  const now = Date.now();
  const open = (data ?? [])
    .filter((t) => t.status !== "done" && t.status !== "cancelled")
    .sort((a, b) => {
      const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return da - db;
    })
    .slice(0, 8);

  return (
    <section className="card overflow-hidden">
      <div className="card-header">
        <div className="flex items-center gap-2">
          <h2 className="card-title">Мои задачи</h2>
          {data && (
            <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-zinc-600 dark:bg-[#1B1F26] dark:text-zinc-400">
              {open.length}
            </span>
          )}
        </div>
        <Link to="/tasks" className="link inline-flex items-center gap-1 text-[13px]">
          Все задачи <ArrowRight size={14} />
        </Link>
      </div>
      {isPending ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : open.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <CheckCircle2 size={22} className="mx-auto mb-2 text-emerald-500" />
          <div className="text-sm font-medium">Открытых задач нет</div>
          <div className="mt-1 text-[13px] text-zinc-500">Новые назначения появятся здесь</div>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
          {open.map((t) => {
            const overdue = !!t.deadline && new Date(t.deadline).getTime() < now;
            return (
              <li key={t.id}>
                <Link
                  to={`/tasks/${t.id}`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none dark:hover:bg-[#1B1F26] dark:focus-visible:bg-[#1B1F26]"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t.title}
                  </span>
                  <span className="hidden sm:inline-flex">
                    <PriorityChip priority={t.priority} />
                  </span>
                  <StatusChip status={t.status} />
                  <span
                    className={clsx(
                      "w-24 shrink-0 text-right text-xs tabular-nums",
                      overdue ? "font-medium text-rose-600 dark:text-rose-400" : "text-zinc-500",
                    )}
                    title={t.deadline ? new Date(t.deadline).toLocaleString("ru-RU") : undefined}
                  >
                    {t.deadline
                      ? new Date(t.deadline).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
                      : "без срока"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function StatusBreakdown({ stats }: { stats: DashboardStats }) {
  const statuses = Object.keys(STATUS_LABEL) as TaskStatus[];
  const total = statuses.reduce((sum, s) => sum + (stats.by_status[s] || 0), 0);
  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Задачи по статусам</h2>
        <span className="text-xs tabular-nums text-zinc-500">{total.toLocaleString("ru-RU")}</span>
      </div>
      <div className="p-5">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-[#1B1F26]">
          {total > 0 &&
            statuses.map((s) => {
              const v = stats.by_status[s] || 0;
              if (!v) return null;
              return <div key={s} className={STATUS_BAR[s]} style={{ width: `${(v / total) * 100}%` }} />;
            })}
        </div>
        <dl className="mt-4 space-y-2.5">
          {statuses.map((s) => {
            const v = stats.by_status[s] || 0;
            return (
              <div key={s} className="flex items-center gap-2.5 text-sm">
                <span className={clsx("h-2 w-2 shrink-0 rounded-sm", STATUS_BAR[s])} />
                <dt className="flex-1 text-zinc-600 dark:text-zinc-400">{STATUS_LABEL[s]}</dt>
                <dd className="font-medium tabular-nums">{v.toLocaleString("ru-RU")}</dd>
                <dd className="w-10 text-right text-xs tabular-nums text-zinc-500">
                  {total ? Math.round((v / total) * 100) : 0}%
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}

function DealsSummary() {
  const { data, isPending } = useQuery({
    queryKey: ["deals", "forecast", "KZT"],
    queryFn: async () => (await api.get<Forecast>("/api/deals/forecast")).data,
    staleTime: 60_000,
  });
  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title flex items-center gap-2">
          <Coins size={15} className="text-zinc-500" /> Сделки
        </h2>
        <Link to="/deals" className="link text-[13px]">
          Воронка
        </Link>
      </div>
      {isPending || !data ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : data.open_count + data.won_count + data.lost_count === 0 ? (
        <div className="p-5 text-sm text-zinc-500">
          Сделок пока нет.{" "}
          <Link to="/deals" className="link">
            Создать первую
          </Link>
        </div>
      ) : (
        <div className="p-5">
          <div className="text-xs text-zinc-500">В работе · {data.open_count}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
            {money(data.total_amount_cents, data.currency)}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-zinc-100 pt-4 text-sm dark:border-zinc-800">
            <div>
              <dt className="text-xs text-zinc-500">Прогноз (взвешенный)</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{money(data.weighted_amount_cents, data.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Выиграно · {data.won_count}</dt>
              <dd className="mt-0.5 font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                {money(data.won_amount_cents, data.currency)}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}

function RecentActivity() {
  const { data, isPending } = useQuery({
    queryKey: ["activity", "recent"],
    queryFn: async () =>
      (await api.get<Page<ActivityItem>>("/api/activity", { params: { page: 1, per_page: 8 } })).data.items,
    staleTime: 30_000,
  });
  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Последние события</h2>
        <Link to="/activity" className="link inline-flex items-center gap-1 text-[13px]">
          Хроника <ArrowRight size={14} />
        </Link>
      </div>
      {isPending ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-5" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="p-5 text-sm text-zinc-500">Событий пока нет</div>
      ) : (
        <ol className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
          {data.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-5 py-3 text-sm">
              <CircleDot size={14} className="mt-[3px] shrink-0 text-zinc-400" />
              <div className="min-w-0 flex-1">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{a.user?.name || "Система"}</span>{" "}
                <span className="text-zinc-600 dark:text-zinc-400">
                  {ACTION_VERB[a.action] || a.action} {a.entity ? ENTITY_LABEL[a.entity] || a.entity : ""}
                </span>
                {a.detail && <span className="text-zinc-600 dark:text-zinc-400"> — {a.detail}</span>}
              </div>
              <time
                className="shrink-0 text-xs text-zinc-500"
                dateTime={a.created_at}
                title={new Date(a.created_at).toLocaleString("ru-RU")}
              >
                {fromNow(a.created_at)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Onboarding() {
  const { can } = useAuth();
  const steps = [
    {
      icon: FolderKanban,
      title: "Создайте проект",
      text: "Проекты объединяют задачи, участников и сроки.",
      to: "/projects",
      cta: "Новый проект",
      show: can("projects.create"),
    },
    {
      icon: ListTodo,
      title: "Поставьте задачи",
      text: "Kanban, таблица, список или календарь — один источник данных.",
      to: "/tasks",
      cta: "К задачам",
      show: can(["tasks.view_all", "tasks.view_own"]),
    },
    {
      icon: Users,
      title: "Пригласите команду",
      text: "Выдайте роли и права — каждый увидит только своё.",
      to: "/users",
      cta: "Сотрудники",
      show: can("users.view"),
    },
  ];
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Настройка рабочего пространства</h2>
          <p className="mt-0.5 text-[13px] text-zinc-500">Три шага, после которых здесь появится статистика</p>
        </div>
      </div>
      <ol className="grid divide-y divide-zinc-100 md:grid-cols-3 md:divide-x md:divide-y-0 dark:divide-zinc-800">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <li key={s.title} className="flex flex-col gap-3 p-5">
              <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
                <span className="grid h-6 w-6 place-items-center rounded-md border border-zinc-200 tabular-nums dark:border-zinc-700">
                  {i + 1}
                </span>
                <Icon size={15} />
              </div>
              <div>
                <div className="text-sm font-semibold">{s.title}</div>
                <p className="mt-1 text-[13px] text-zinc-500">{s.text}</p>
              </div>
              {s.show && (
                <Link to={s.to} className={clsx("mt-auto self-start", i === 0 ? "btn-primary" : "btn-secondary")}>
                  {s.cta}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-200 lg:grid-cols-4 dark:border-zinc-800">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white p-5 dark:bg-[#14171C]">
            <Skeleton className="mb-4 h-3 w-24" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card space-y-2 p-5 xl:col-span-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
        <div className="card space-y-3 p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-2 w-full" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-4" />
          ))}
        </div>
      </div>
    </div>
  );
}
