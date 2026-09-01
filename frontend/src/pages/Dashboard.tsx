import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "@/api/client";
import { CheckCircle2, Clock, ListTodo, AlertTriangle, FolderKanban, Plus, Sparkles } from "lucide-react";
import { STATUS_LABEL, TaskStatus } from "@/types";
import { Skeleton } from "@/components/Skeleton";
import { useCountUp } from "@/hooks/useCountUp";
import { useAuth } from "@/store/auth";
import { BirthdaysWidget, MyGoalsWidget, KudosFeedWidget } from "@/components/HRWidgets";

type Dashboard = {
  total: number;
  in_progress: number;
  done: number;
  overdue: number;
  by_status: Record<string, number>;
};

const STATUS_COLOR: Record<string, string> = {
  new: "bg-neutral-400",
  in_progress: "bg-sky-500",
  review: "bg-amber-500",
  done: "bg-emerald-500",
  cancelled: "bg-rose-500",
};

export default function DashboardPage() {
  const { data, isPending } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get<Dashboard>("/api/analytics/dashboard")).data,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Онбординг: если проектов и задач нет — показываем баннер вместо пустых цифр.
  // Пустой tenant — новый пользователь: нужна не статистика, а первое действие.
  const { data: projectsMeta } = useQuery({
    queryKey: ["projects-count"],
    queryFn: async () =>
      (await api.get<{ total: number }>("/api/projects", { params: { page: 1, per_page: 1 } })).data,
    staleTime: 60_000,
  });
  const isEmptyTenant = !!data && data.total === 0 && (projectsMeta?.total ?? 0) === 0;

  // Управляем кроссфейдом: скелетон над контентом, снимается после 460мс
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [contentVisible, setContentVisible] = useState(false);

  useEffect(() => {
    if (!isPending && data) {
      setContentVisible(true);
      const t = window.setTimeout(() => setShowSkeleton(false), 460);
      return () => window.clearTimeout(t);
    }
  }, [isPending, data]);

  return (
    <div className="relative">
      {showSkeleton && (
        <div
          className={clsx(
            "absolute inset-0 transition-opacity duration-[420ms] ease-out-soft",
            contentVisible ? "opacity-0" : "opacity-100",
          )}
        >
          <DashboardSkeleton />
        </div>
      )}
      {data && (
        <div
          className={clsx(
            "transition-opacity duration-[420ms] ease-out-soft",
            contentVisible ? "opacity-100" : "opacity-0",
          )}
        >
          {isEmptyTenant ? (
            <OnboardingBanner />
          ) : (
            <DashboardContent data={data} startAnimations={contentVisible} />
          )}
        </div>
      )}
    </div>
  );
}

function OnboardingBanner() {
  const { can } = useAuth();
  const canCreateProject = can("projects.create");
  return (
    <div className="space-y-6">
      <div style={{ animation: "rise .52s cubic-bezier(.2,.8,.2,1) both" }}>
        <h1 className="text-2xl font-semibold tracking-tight">Добро пожаловать в Qadam CRM</h1>
        <p className="text-sm text-neutral-500">Настроим рабочее пространство за пару шагов</p>
      </div>

      <div
        className="card relative overflow-hidden p-8 sm:p-10"
        style={{ animation: "rise .52s cubic-bezier(.2,.8,.2,1) both", animationDelay: "80ms" }}
      >
        <div
          aria-hidden
          className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-brand-500/10 blur-3xl"
        />
        <div className="relative flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
            <FolderKanban size={26} />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold">Создайте первый проект</h2>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              Проекты объединяют задачи и участников. Начните с одного — задачи и статистика появятся здесь.
            </p>
          </div>
          {canCreateProject ? (
            <Link to="/projects" className="btn-primary shrink-0">
              <Plus size={16} /> Новый проект
            </Link>
          ) : (
            <Link to="/projects" className="btn-secondary shrink-0">
              Перейти к проектам
            </Link>
          )}
        </div>
      </div>

      <div
        className="grid gap-3 sm:grid-cols-3"
        style={{ animation: "rise .52s cubic-bezier(.2,.8,.2,1) both", animationDelay: "160ms" }}
      >
        <OnboardingStep
          index={1}
          icon={<FolderKanban size={16} />}
          title="Создайте проект"
          desc="Дайте ему имя, цвет и добавьте участников"
        />
        <OnboardingStep
          index={2}
          icon={<ListTodo size={16} />}
          title="Добавьте задачи"
          desc="Kanban, таблица или календарь — выберите удобный вид"
        />
        <OnboardingStep
          index={3}
          icon={<Sparkles size={16} />}
          title="Пригласите команду"
          desc="Раздайте роли и следите за прогрессом на Dashboard"
        />
      </div>
    </div>
  );
}

function OnboardingStep({
  index,
  icon,
  title,
  desc,
}: {
  index: number;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          {index}
        </span>
        <span className="text-neutral-500">{icon}</span>
      </div>
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{desc}</div>
    </div>
  );
}

function DashboardContent({ data, startAnimations }: { data: Dashboard; startAnimations: boolean }) {
  const totalByStatus = Math.max(1, Object.values(data.by_status).reduce((a, b) => a + b, 0));
  const [barGrown, setBarGrown] = useState(false);

  useEffect(() => {
    if (!startAnimations) return;
    const t = window.setTimeout(() => setBarGrown(true), 220);
    return () => window.clearTimeout(t);
  }, [startAnimations]);

  return (
    <div className="space-y-6">
      <div style={{ animation: "rise .52s cubic-bezier(.2,.8,.2,1) both" }}>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-neutral-500">Обзор задач и активности</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric index={0} icon={<ListTodo size={18} />} label="Всего задач" value={data.total} start={startAnimations} />
        <Metric index={1} icon={<Clock size={18} />} label="В работе" value={data.in_progress} accent="text-sky-600" start={startAnimations} />
        <Metric index={2} icon={<CheckCircle2 size={18} />} label="Завершены" value={data.done} accent="text-emerald-600" start={startAnimations} />
        <Metric index={3} icon={<AlertTriangle size={18} />} label="Просрочены" value={data.overdue} accent="text-rose-600" start={startAnimations} />
      </div>

      <div className="card p-5" style={{ animation: "rise .52s cubic-bezier(.2,.8,.2,1) both", animationDelay: "300ms" }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Задачи по статусам</h2>
          <span className="text-xs text-neutral-500">Всего {totalByStatus}</span>
        </div>
        <div className="mb-4 flex h-3 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
          {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s, i) => {
            const v = data.by_status[s] || 0;
            const w = (v / totalByStatus) * 100;
            if (!w) return null;
            return (
              <div
                key={s}
                className={clsx(STATUS_COLOR[s], "transition-[width] duration-[760ms] ease-out-soft")}
                style={{
                  width: barGrown ? `${w}%` : "0%",
                  transitionDelay: `${i * 70}ms`,
                }}
              />
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s, i) => (
            <div
              key={s}
              className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 transition-all duration-[180ms] ease-out-soft hover:-translate-y-0.5 hover:bg-neutral-100 dark:bg-neutral-800/50 dark:hover:bg-neutral-800"
              style={{
                animation: "rise .52s cubic-bezier(.2,.8,.2,1) both",
                animationDelay: `${360 + i * 60}ms`,
              }}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${STATUS_COLOR[s]}`} />
              <div>
                <div className="text-xs text-neutral-500">{STATUS_LABEL[s]}</div>
                <div className="text-sm font-semibold tabular-nums">{data.by_status[s] || 0}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="grid gap-4 lg:grid-cols-3"
        style={{ animation: "rise .52s cubic-bezier(.2,.8,.2,1) both", animationDelay: "480ms" }}
      >
        <MyGoalsWidget />
        <BirthdaysWidget />
        <KudosFeedWidget />
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  accent,
  index,
  start,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: string;
  index: number;
  start: boolean;
}) {
  const shown = useCountUp(value, { duration: 1000, delay: 220, enabled: start });
  return (
    <div
      className="card-interactive p-4"
      style={{
        animation: "rise .52s cubic-bezier(.2,.8,.2,1) both",
        animationDelay: `${index * 70}ms`,
      }}
    >
      <div className="mb-2 flex items-center gap-2 text-neutral-500">
        <span className={accent}>{icon}</span>
        <span className="text-xs">{label}</span>
      </div>
      <div className="text-2xl font-semibold tabular-nums">{shown}</div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-7 w-40 animate-breathe" />
        <Skeleton className="mt-2 h-3 w-56 animate-breathe" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4">
            <Skeleton className="mb-3 h-3 w-24 animate-breathe" />
            <Skeleton className="h-7 w-16 animate-breathe" />
          </div>
        ))}
      </div>
      <div className="card p-5 space-y-4">
        <Skeleton className="h-4 w-40 animate-breathe" />
        <Skeleton className="h-3 w-full rounded-full animate-breathe" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-11 animate-breathe" />
          ))}
        </div>
      </div>
    </div>
  );
}
