import { memo, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Plus, LayoutGrid, List as ListIcon, Table as TableIcon, CalendarDays, Search, Trash2,
} from "lucide-react";
import clsx from "clsx";
import {
  DndContext, DragEndEvent, DragStartEvent, DragOverlay,
  PointerSensor, useSensor, useSensors, useDroppable, useDraggable,
} from "@dnd-kit/core";

import type { TaskListItem, TaskStatus, Project, User, Page } from "@/types";
import { STATUS_LABEL, STATUS_ORDER, PRIORITY_LABEL } from "@/types";
import { Avatar, EmptyState, FieldError, FormError, Modal, PriorityChip, StatusChip } from "@/components/ui";
import { SkeletonKanban, SkeletonTable, SkeletonCard } from "@/components/Skeleton";
import { taskSchema, type TaskForm } from "@/lib/validation";
import { useAuth } from "@/store/auth";
import { useToast } from "@/components/Toast";

type View = "kanban" | "table" | "list" | "calendar";
const VIEWS: View[] = ["kanban", "table", "list", "calendar"];

function readParam(sp: URLSearchParams, key: string) {
  const v = sp.get(key);
  return v ?? "";
}

export default function Tasks() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();

  const view = (VIEWS.includes(sp.get("view") as View) ? (sp.get("view") as View) : "kanban");
  const q = readParam(sp, "q");
  const projectId = readParam(sp, "project");
  const assigneeId = readParam(sp, "assignee");
  const priority = readParam(sp, "priority");
  const status = readParam(sp, "status");

  const [openNew, setOpenNew] = useState(false);
  const [qLocal, setQLocal] = useState(q);
  useEffect(() => setQLocal(q), [q]);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    setSp(next, { replace: true });
  };

  useEffect(() => {
    if (qLocal === q) return;
    const t = setTimeout(() => updateParam("q", qLocal), 250);
    return () => clearTimeout(t);
  }, [qLocal, q, sp, setSp]);

  const filters = useMemo(
    () => ({
      q: q || undefined,
      project_id: projectId ? Number(projectId) : undefined,
      assignee_id: assigneeId ? Number(assigneeId) : undefined,
      priority: priority || undefined,
      status: status || undefined,
    }),
    [q, projectId, assigneeId, priority, status],
  );

  const { data: tasks, isPending } = useQuery({
    queryKey: ["tasks", filters],
    queryFn: async () => (await api.get<Page<TaskListItem>>("/api/tasks", { params: filters })).data.items,
  });

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await api.get<Page<Project>>("/api/projects")).data.items,
  });
  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await api.get<Page<User>>("/api/users")).data.items,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TaskStatus }) => api.patch(`/api/tasks/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const snapshots = qc.getQueriesData<TaskListItem[]>({ queryKey: ["tasks"] });
      snapshots.forEach(([key, data]) => {
        if (!data) return;
        qc.setQueryData<TaskListItem[]>(key, data.map((t) => (t.id === id ? { ...t, status } : t)));
      });
      return { snapshots };
    },
    onError: (err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error("Не удалось изменить статус", extractApiError(err).message);
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task", vars.id] });
    },
  });

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const deleteTask = useMutation({
    mutationFn: (id: number) => api.delete(`/api/tasks/${id}`),
    onSuccess: () => {
      toast.success("Задача удалена");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["project-tasks"] });
      setConfirmDeleteId(null);
    },
    onError: (e) => toast.error("Не удалось удалить задачу", extractApiError(e).message),
  });
  const canDelete = can("tasks.delete");
  const requestDelete = canDelete ? (id: number) => setConfirmDeleteId(id) : undefined;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const [landedId, setLandedId] = useState<number | null>(null);
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const activeDragTask = useMemo(
    () => (activeDragId != null ? tasks?.find((t) => t.id === activeDragId) ?? null : null),
    [activeDragId, tasks],
  );

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id).split(":")[1];
    setActiveDragId(Number(id));
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const overId = e.over?.id;
    const activeId = e.active.id;
    if (!overId || typeof activeId !== "string" || typeof overId !== "string") return;
    const [, taskIdStr] = activeId.split(":");
    const [, newStatus] = overId.split(":");
    const id = Number(taskIdStr);
    const current = tasks?.find((t) => t.id === id);
    if (!current || current.status === newStatus) return;
    updateStatus.mutate({ id, status: newStatus as TaskStatus });
    setLandedId(id);
    window.setTimeout(() => setLandedId((cur) => (cur === id ? null : cur)), 460);
  };

  const onDragCancel = () => setActiveDragId(null);

  const filtersActive = Boolean(q || projectId || assigneeId || priority || status);
  const canCreate = can("tasks.create");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Задачи</h1>
          <p className="text-sm text-neutral-500">{tasks?.length ?? 0} задач</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            {(
              [
                ["kanban", <LayoutGrid size={15} />],
                ["table", <TableIcon size={15} />],
                ["list", <ListIcon size={15} />],
                ["calendar", <CalendarDays size={15} />],
              ] as const
            ).map(([v, icon]) => (
              <button
                key={v}
                onClick={() => updateParam("view", v === "kanban" ? "" : v)}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium capitalize",
                  view === v
                    ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-white"
                    : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-800/50",
                )}
              >
                {icon}
                {v === "kanban" ? "Kanban" : v === "table" ? "Таблица" : v === "list" ? "Список" : "Календарь"}
              </button>
            ))}
          </div>
          {canCreate && (
            <button className="btn-primary" onClick={() => setOpenNew(true)}>
              <Plus size={16} /> Новая задача
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={15} className="absolute left-3 top-2.5 text-neutral-400" />
          <input
            className="input pl-8"
            placeholder="Поиск задач…"
            value={qLocal}
            onChange={(e) => setQLocal(e.target.value)}
          />
        </div>
        <select
          className="input max-w-[180px]"
          value={projectId}
          onChange={(e) => updateParam("project", e.target.value)}
        >
          <option value="">Все проекты</option>
          {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select
          className="input max-w-[180px]"
          value={assigneeId}
          onChange={(e) => updateParam("assignee", e.target.value)}
        >
          <option value="">Все исполнители</option>
          {users?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select
          className="input max-w-[160px]"
          value={status}
          onChange={(e) => updateParam("status", e.target.value)}
        >
          <option value="">Любой статус</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select
          className="input max-w-[160px]"
          value={priority}
          onChange={(e) => updateParam("priority", e.target.value)}
        >
          <option value="">Любой приоритет</option>
          {(["low", "medium", "high", "critical"] as const).map((p) => (
            <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
          ))}
        </select>
        {filtersActive && (
          <button
            className="btn-ghost !px-2 !py-1 text-xs"
            onClick={() => {
              const next = new URLSearchParams(sp);
              ["q", "project", "assignee", "status", "priority"].forEach((k) => next.delete(k));
              setSp(next, { replace: true });
            }}
          >
            Сбросить фильтры
          </button>
        )}
      </div>

      {isPending ? (
        view === "kanban" ? <SkeletonKanban /> :
        view === "table" ? <SkeletonTable rows={8} cols={5} /> :
        view === "list" ? <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}</div> :
        <SkeletonTable rows={4} cols={7} />
      ) : !tasks || tasks.length === 0 ? (
        <EmptyState
          title="Задач не найдено"
          description={filtersActive ? "Измените фильтры или создайте новую задачу" : "Создайте первую задачу"}
          action={canCreate && (
            <button className="btn-primary" onClick={() => setOpenNew(true)}>
              <Plus size={16} /> Новая задача
            </button>
          )}
        />
      ) : view === "kanban" ? (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {STATUS_ORDER.map((s) => (
              <KanbanColumn
                key={s}
                status={s}
                tasks={tasks.filter((t) => t.status === s)}
                onDelete={requestDelete}
                landedId={landedId}
                activeDragId={activeDragId}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeDragTask ? <KanbanCardGhost task={activeDragTask} /> : null}
          </DragOverlay>
        </DndContext>
      ) : view === "table" ? (
        <TableView tasks={tasks} onDelete={requestDelete} />
      ) : view === "list" ? (
        <ListView tasks={tasks} onDelete={requestDelete} />
      ) : (
        <CalendarView tasks={tasks} />
      )}

      {openNew && (
        <TaskFormModal
          projects={projects ?? []}
          users={users ?? []}
          onClose={() => setOpenNew(false)}
        />
      )}

      {confirmDeleteId !== null && (
        <Modal open onClose={() => setConfirmDeleteId(null)} title="Удалить задачу?" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Задача «{tasks?.find((t) => t.id === confirmDeleteId)?.title || ""}» будет удалена без возможности восстановления.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmDeleteId(null)}>Отмена</button>
              <button
                className="btn-primary bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-600"
                disabled={deleteTask.isPending}
                onClick={() => deleteTask.mutate(confirmDeleteId)}
              >
                Удалить
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function KanbanColumn({
  status,
  tasks,
  onDelete,
  landedId,
  activeDragId,
}: {
  status: TaskStatus;
  tasks: TaskListItem[];
  onDelete?: (id: number) => void;
  landedId?: number | null;
  activeDragId?: number | null;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `col:${status}` });
  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "flex max-h-[calc(100vh-16rem)] min-h-[220px] flex-col rounded-2xl border p-2.5 transition-all duration-[180ms] ease-out-soft",
        isOver
          ? "border-brand-400 bg-brand-50/70 dark:border-brand-700 dark:bg-brand-900/10"
          : "border-neutral-200 bg-neutral-50/60 dark:border-neutral-700/50 dark:bg-[#22222a]",
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1.5">
        <div className="flex items-center gap-2">
          <StatusChip status={status} />
        </div>
        <span className="text-xs text-neutral-500 tabular-nums">{tasks.length}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto pr-0.5">
        {tasks.map((t) => (
          <KanbanCard
            key={t.id}
            task={t}
            onDelete={onDelete}
            landed={landedId === t.id}
            isActiveDrag={activeDragId === t.id}
          />
        ))}
      </div>
    </div>
  );
}

const KanbanCard = memo(function KanbanCard({
  task,
  onDelete,
  landed = false,
  isActiveDrag = false,
}: {
  task: TaskListItem;
  onDelete?: (id: number) => void;
  landed?: boolean;
  isActiveDrag?: boolean;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `task:${task.id}` });
  const nav = useNavigate();
  return (
    <div
      ref={setNodeRef}
      style={{
        // Пока тащим — полностью скрываем оригинал (визуально «след» не остаётся).
        // Не убираем из DOM (display:none) — это сломает измерения @dnd-kit.
        visibility: isActiveDrag ? "hidden" : "visible",
        touchAction: "none",
      }}
      {...listeners}
      {...attributes}
      onClick={() => {
        if (isActiveDrag) return;
        nav(`/tasks/${task.id}`);
      }}
      className={clsx(
        "group relative rounded-xl border border-neutral-200 bg-white p-3 shadow-soft transition-all duration-[220ms] ease-out-soft dark:border-neutral-700/50 dark:bg-[#2b2b34]",
        !isActiveDrag && "cursor-pointer hover:-translate-y-0.5 hover:shadow-md",
        landed && "animate-settle",
      )}
    >
      {onDelete && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
          className="absolute right-1.5 top-1.5 hidden rounded p-1 text-neutral-400 hover:bg-rose-50 hover:text-rose-600 group-hover:block dark:hover:bg-rose-950/30"
          title="Удалить задачу"
          aria-label="Удалить задачу"
        >
          <Trash2 size={13} />
        </button>
      )}
      <div className="mb-1.5 pr-6 text-sm font-medium leading-snug">{task.title}</div>
      <div className="flex items-center justify-between">
        <PriorityChip priority={task.priority} />
        {task.assignee && <Avatar name={task.assignee.name} size={22} url={task.assignee.avatar_url} />}
      </div>
      {task.deadline && (
        <div className="mt-2 text-[11px] text-neutral-500">
          до {new Date(task.deadline).toLocaleDateString("ru-RU")}
        </div>
      )}
    </div>
  );
});

function KanbanCardGhost({ task }: { task: TaskListItem }) {
  return (
    <div
      className="rounded-xl border border-brand-300 bg-white p-3 shadow-[0_18px_40px_-12px_rgba(23,23,31,0.35)] dark:border-brand-500/60 dark:bg-[#2b2b34]"
      style={{
        width: 240,
        transform: "rotate(2.5deg) scale(1.03)",
        cursor: "grabbing",
      }}
    >
      <div className="mb-1.5 pr-6 text-sm font-medium leading-snug">{task.title}</div>
      <div className="flex items-center justify-between">
        <PriorityChip priority={task.priority} />
        {task.assignee && <Avatar name={task.assignee.name} size={22} url={task.assignee.avatar_url} />}
      </div>
      {task.deadline && (
        <div className="mt-2 text-[11px] text-neutral-500">
          до {new Date(task.deadline).toLocaleDateString("ru-RU")}
        </div>
      )}
    </div>
  );
}

function TableView({
  tasks,
  onDelete,
}: {
  tasks: TaskListItem[];
  onDelete?: (id: number) => void;
}) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-800/40">
          <tr>
            <th className="px-5 py-2.5 text-left">Задача</th>
            <th className="px-5 py-2.5 text-left">Статус</th>
            <th className="px-5 py-2.5 text-left">Приоритет</th>
            <th className="px-5 py-2.5 text-left">Исполнитель</th>
            <th className="px-5 py-2.5 text-left">Дедлайн</th>
            {onDelete && <th className="px-5 py-2.5 text-right w-10" aria-label="Действия" />}
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="table-row group">
              <td className="px-5 py-3">
                <Link to={`/tasks/${t.id}`} className="font-medium hover:text-brand-600">{t.title}</Link>
              </td>
              <td className="px-5 py-3"><StatusChip status={t.status} /></td>
              <td className="px-5 py-3"><PriorityChip priority={t.priority} /></td>
              <td className="px-5 py-3">
                {t.assignee ? <div className="flex items-center gap-2"><Avatar name={t.assignee.name} size={22} url={t.assignee.avatar_url} />{t.assignee.name}</div> : "—"}
              </td>
              <td className="px-5 py-3 text-neutral-500">
                {t.deadline ? new Date(t.deadline).toLocaleDateString("ru-RU") : "—"}
              </td>
              {onDelete && (
                <td className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onDelete(t.id)}
                    className="rounded p-1.5 text-neutral-400 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 dark:hover:bg-rose-950/30"
                    title="Удалить задачу"
                    aria-label="Удалить задачу"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListView({
  tasks,
  onDelete,
}: {
  tasks: TaskListItem[];
  onDelete?: (id: number) => void;
}) {
  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <div key={t.id} className="group relative">
          <Link to={`/tasks/${t.id}`}
            className="card-interactive flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{t.title}</div>
              <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
                <StatusChip status={t.status} />
                <PriorityChip priority={t.priority} />
                {t.deadline && <span>до {new Date(t.deadline).toLocaleDateString("ru-RU")}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {t.assignee && <Avatar name={t.assignee.name} size={26} url={t.assignee.avatar_url} />}
              {onDelete && <span className="w-6" aria-hidden />}
            </div>
          </Link>
          {onDelete && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); onDelete(t.id); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1.5 text-neutral-400 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 dark:hover:bg-rose-950/30"
              title="Удалить задачу"
              aria-label="Удалить задачу"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function CalendarView({ tasks }: { tasks: TaskListItem[] }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const base = new Date();
  base.setMonth(base.getMonth() + monthOffset);
  const y = base.getFullYear();
  const m = base.getMonth();
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const startWeekday = (first.getDay() + 6) % 7;

  const byDay: Record<string, TaskListItem[]> = {};
  for (const t of tasks) {
    if (!t.deadline) continue;
    const d = new Date(t.deadline);
    if (d.getFullYear() === y && d.getMonth() === m) {
      const k = String(d.getDate());
      (byDay[k] = byDay[k] || []).push(t);
    }
  }

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold capitalize">
          {base.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}
        </h3>
        <div className="flex gap-1">
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setMonthOffset((o) => o - 1)}>← Пред</button>
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setMonthOffset(0)}>Сегодня</button>
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setMonthOffset((o) => o + 1)}>След →</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-neutral-500">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: startWeekday }).map((_, i) => <div key={"e" + i} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const items = byDay[String(day)] || [];
          return (
            <div key={day} className="min-h-[92px] rounded-lg border border-neutral-100 p-1.5 dark:border-neutral-800">
              <div className="mb-1 text-xs font-medium text-neutral-500">{day}</div>
              <div className="space-y-1">
                {items.slice(0, 3).map((t) => (
                  <Link key={t.id} to={`/tasks/${t.id}`} className="block truncate rounded bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-300">
                    {t.title}
                  </Link>
                ))}
                {items.length > 3 && <div className="text-[10px] text-neutral-500">+{items.length - 3}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TaskFormModal({
  onClose,
  projects,
  users,
  defaultProjectId,
}: {
  onClose: () => void;
  projects: Project[];
  users: User[];
  defaultProjectId?: number;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<TaskForm>({
    resolver: zodResolver(taskSchema),
    mode: "onChange",
    defaultValues: {
      title: "",
      description: "",
      priority: "medium",
      project_id: defaultProjectId ?? "",
      assignee_id: "",
      deadline: "",
    },
  });

  const create = useMutation({
    mutationFn: (data: TaskForm) =>
      api.post("/api/tasks", {
        title: data.title,
        description: data.description || null,
        priority: data.priority,
        project_id: data.project_id || null,
        assignee_id: data.assignee_id || null,
        deadline: data.deadline ? new Date(data.deadline).toISOString() : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["project-tasks"] });
      toast.success("Задача создана");
      onClose();
    },
    onError: (e) => setFormError(extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title="Новая задача" size="md">
      <form onSubmit={handleSubmit((d) => create.mutate(d))} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
          <input className="input" autoFocus {...register("title")} />
          <FieldError msg={errors.title?.message} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Описание</span>
          <textarea className="input min-h-[80px]" {...register("description")} />
          <FieldError msg={errors.description?.message} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Проект</span>
            <select className="input" {...register("project_id", { setValueAs: (v) => (v ? Number(v) : "") })}>
              <option value="">—</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Исполнитель</span>
            <select className="input" {...register("assignee_id", { setValueAs: (v) => (v ? Number(v) : "") })}>
              <option value="">—</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Приоритет</span>
            <select className="input" {...register("priority")}>
              <option value="low">{PRIORITY_LABEL.low}</option>
              <option value="medium">{PRIORITY_LABEL.medium}</option>
              <option value="high">{PRIORITY_LABEL.high}</option>
              <option value="critical">{PRIORITY_LABEL.critical}</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Дедлайн</span>
            <input className="input" type="datetime-local" {...register("deadline")} />
          </label>
        </div>
        <FormError msg={formError} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn-primary" disabled={!isValid || create.isPending}>Создать</button>
        </div>
      </form>
    </Modal>
  );
}
