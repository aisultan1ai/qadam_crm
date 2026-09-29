/**
 * Проект как пространство (Space в ClickUp): вкладки видов — Список / Доска / Календарь / Ганта / Обзор.
 * Вид хранится в ?view=, открытая задача — в ?task= (боковая панель).
 */
import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Calendar, CalendarDays, CheckCircle2, GanttChart, LayoutGrid, List as ListIcon, ListTodo,
  MessageSquare, PieChart, Plus, Users,
} from "lucide-react";

import { api } from "@/api/client";
import type { Page, Project, TaskListItem, TaskStatusDef, User } from "@/types";
import { Avatar, EmptyState, Loader } from "@/components/ui";
import { PageHeader, Panel, PropertyList, PropertyRow, Tabs } from "@/components/page";
import { Button } from "@/components/lib/Button";
import { useAuth } from "@/store/auth";
import { FavoriteButton } from "@/hooks/useFavorites";
import { CalendarView, KanbanBoard, TaskFormModal } from "./Tasks";
import { GroupByButton, GroupedListView, type ListPerms } from "./tasks/GroupedListView";
import { GROUP_BY_OPTIONS, type GroupBy } from "./tasks/grouping";
import { TaskDrawer } from "./tasks/TaskDrawer";

const GanttView = lazy(() => import("./ProjectGantt").then((m) => ({ default: m.GanttView })));

type ProjectChannelInfo = { id: number; kind: string; project_id: number | null };
type ProjectView = "list" | "board" | "calendar" | "gantt" | "overview";
const VIEWS: ProjectView[] = ["list", "board", "calendar", "gantt", "overview"];
const GROUP_BY_STORAGE_KEY = "project:group-by";
const TASKS_LIMIT = 200;

export default function ProjectDetail() {
  const { id } = useParams();
  const projectId = Number(id);
  const { can } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [openNew, setOpenNew] = useState(false);
  const canCreate = can("tasks.create");

  const rawView = sp.get("view") as ProjectView | null;
  const view: ProjectView = rawView && VIEWS.includes(rawView) ? rawView : "list";
  const setView = (v: ProjectView) => {
    const next = new URLSearchParams(sp);
    if (v === "list") next.delete("view");
    else next.set("view", v);
    setSp(next, { replace: true });
  };

  const openTaskId = Number(sp.get("task")) || null;
  const openTask = useCallback(
    (tid: number) => {
      const next = new URLSearchParams(sp);
      next.set("task", String(tid));
      setSp(next);
    },
    [sp, setSp],
  );
  const closeTask = useCallback(() => {
    const next = new URLSearchParams(sp);
    next.delete("task");
    setSp(next, { replace: true });
  }, [sp, setSp]);

  const [groupBy, setGroupByState] = useState<GroupBy>(() => {
    try {
      const v = window.localStorage.getItem(GROUP_BY_STORAGE_KEY);
      return GROUP_BY_OPTIONS.some((o) => o.key === v) ? (v as GroupBy) : "status";
    } catch {
      return "status";
    }
  });
  const setGroupBy = (v: GroupBy) => {
    setGroupByState(v);
    try {
      window.localStorage.setItem(GROUP_BY_STORAGE_KEY, v);
    } catch {
      // localStorage недоступен — просто не запоминаем.
    }
  };

  const { data: channels } = useQuery({
    enabled: can("messenger.use"),
    queryKey: ["messenger", "channels"],
    queryFn: async () => (await api.get<ProjectChannelInfo[]>("/api/messenger/channels")).data,
  });
  const projectChannel = (channels || []).find((c) => c.kind === "project" && c.project_id === projectId);

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => (await api.get<Project>(`/api/projects/${projectId}`)).data,
  });
  // Ключ начинается с "tasks" — правки из списка/панели/канбана обновляют и этот кэш.
  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks", { project_id: projectId, per_page: TASKS_LIMIT }],
    queryFn: async () =>
      (await api.get<Page<TaskListItem>>("/api/tasks", { params: { project_id: projectId, per_page: TASKS_LIMIT } })).data.items,
  });
  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await api.get<Page<User>>("/api/users")).data.items,
  });
  const { data: statusDefs } = useQuery({
    queryKey: ["task-statuses"],
    queryFn: async () => (await api.get<TaskStatusDef[]>("/api/task-statuses")).data,
    staleTime: 5 * 60_000,
  });

  const perms: ListPerms = {
    update: can("tasks.update"),
    status: can("tasks.update") && can("tasks.change_status"),
    assign: can("tasks.update") && can("tasks.assign"),
    priority: can("tasks.update") && can("tasks.change_priority"),
  };

  const stats = useMemo(() => {
    const list = tasks ?? [];
    const now = Date.now();
    let done = 0;
    let overdue = 0;
    for (const t of list) {
      if (t.status === "done") done += 1;
      if (t.deadline && t.status !== "done" && t.status !== "cancelled" && new Date(t.deadline).getTime() < now) overdue += 1;
    }
    return { total: list.length, done, overdue };
  }, [tasks]);

  if (!project) return <Loader />;

  const list = tasks ?? [];
  const empty = !isLoading && list.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        className="border-b-0 pb-0"
        back={{ to: "/projects", label: "Проекты" }}
        title={
          <>
            <span className="inline-block h-3.5 w-3.5 rounded" style={{ background: project.color || "rgb(var(--brand-600))" }} />
            {project.name}
            <FavoriteButton entity="project" id={projectId} className="!h-7 !w-7" />
          </>
        }
        subtitle={project.description || undefined}
        actions={
          <>
            {projectChannel && (
              <Button variant="secondary" onClick={() => nav(`/messenger/${projectChannel.id}`)}>
                <MessageSquare size={15} /> Чат проекта
              </Button>
            )}
            {canCreate && (
              <Button variant="primary" onClick={() => setOpenNew(true)}>
                <Plus size={15} /> Новая задача
              </Button>
            )}
          </>
        }
      />

      <Tabs<ProjectView>
        label="Вид проекта"
        value={view}
        onChange={setView}
        items={[
          { key: "list", label: "Список", icon: ListIcon, count: stats.total },
          { key: "board", label: "Доска", icon: LayoutGrid },
          { key: "calendar", label: "Календарь", icon: CalendarDays },
          { key: "gantt", label: "Ганта", icon: GanttChart },
          { key: "overview", label: "Обзор", icon: PieChart },
        ]}
      />

      {list.length >= TASKS_LIMIT && view !== "overview" && (
        <p className="text-[13px] text-amber-700 dark:text-amber-300">
          Показаны первые {TASKS_LIMIT} задач проекта. Полный список с фильтрами — в разделе «Задачи».
        </p>
      )}

      {view === "overview" ? (
        <Overview project={project} stats={stats} />
      ) : isLoading ? (
        <Loader />
      ) : empty && view !== "list" ? (
        <EmptyState
          icon={<ListTodo size={20} />}
          title="Задач пока нет"
          description="Создайте первую задачу — она появится во всех видах проекта."
          action={
            canCreate ? (
              <Button variant="primary" onClick={() => setOpenNew(true)}>
                <Plus size={15} /> Новая задача
              </Button>
            ) : undefined
          }
        />
      ) : view === "list" ? (
        <div className="space-y-3">
          <div className="flex justify-end">
            <GroupByButton value={groupBy} onChange={setGroupBy} />
          </div>
          <GroupedListView
            tasks={list}
            users={users ?? []}
            projects={[project]}
            statusDefs={statusDefs ?? []}
            groupBy={groupBy}
            canCreate={canCreate}
            projectId={projectId}
            onOpen={openTask}
            perms={perms}
          />
        </div>
      ) : view === "board" ? (
        <KanbanBoard tasks={list} onOpen={openTask} />
      ) : view === "calendar" ? (
        <CalendarView tasks={list} />
      ) : (
        <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-zinc-100 dark:bg-[#14171C]" />}>
          <GanttView tasks={list} onOpen={openTask} />
        </Suspense>
      )}

      {openNew && (
        <TaskFormModal projects={[project]} users={users ?? []} defaultProjectId={projectId} onClose={() => setOpenNew(false)} />
      )}
      {openTaskId && <TaskDrawer taskId={openTaskId} onClose={closeTask} />}
    </div>
  );
}

function Overview({ project, stats }: { project: Project; stats: { total: number; done: number; overdue: number } }) {
  const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Прогресс">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat icon={ListTodo} label="Всего задач" value={stats.total} />
            <Stat icon={CheckCircle2} label="Завершено" value={stats.done} tone="text-emerald-700 dark:text-emerald-400" />
            <Stat
              icon={AlertTriangle}
              label="Просрочено"
              value={stats.overdue}
              tone={stats.overdue > 0 ? "text-rose-600 dark:text-rose-400" : undefined}
            />
          </div>
          <div>
            <div className="mb-1.5 flex justify-between text-[13px] text-zinc-500">
              <span>Выполнено</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-[#1B1F26]">
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      </Panel>
      <Panel title="О проекте">
        <PropertyList>
          <PropertyRow icon={Calendar} label="Срок">
            {project.deadline ? new Date(project.deadline).toLocaleDateString("ru-RU") : <span className="text-zinc-500">Не задан</span>}
          </PropertyRow>
          <PropertyRow icon={Users} label="Участники">
            {project.members.length === 0 ? (
              <span className="text-zinc-500">Нет</span>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {project.members.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-1.5 text-[13px]">
                    <Avatar name={m.name} size={22} url={m.avatar_url} />
                    {m.name}
                  </span>
                ))}
              </div>
            )}
          </PropertyRow>
        </PropertyList>
        {project.description && <p className="mt-4 whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-300">{project.description}</p>}
      </Panel>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof ListTodo; label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        <Icon size={13} /> {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
