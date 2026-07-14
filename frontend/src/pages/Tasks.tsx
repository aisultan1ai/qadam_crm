import { memo, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus, LayoutGrid, List as ListIcon, Table as TableIcon, CalendarDays, Search,
} from "lucide-react";
import clsx from "clsx";
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, useDroppable, useDraggable,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import type { TaskListItem, TaskStatus, Project, User } from "@/types";
import { STATUS_LABEL, STATUS_ORDER, PRIORITY_LABEL } from "@/types";
import { Avatar, EmptyState, Loader, Modal, PriorityChip, StatusChip } from "@/components/ui";
import { useAuth } from "@/store/auth";

type View = "kanban" | "table" | "list" | "calendar";

export default function Tasks() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [view, setView] = useState<View>("kanban");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const [projectId, setProjectId] = useState<number | "">("");
  const [assigneeId, setAssigneeId] = useState<number | "">("");
  const [priority, setPriority] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [openNew, setOpenNew] = useState(false);

  const filters = useMemo(
    () => ({
      q: qDebounced || undefined,
      project_id: projectId || undefined,
      assignee_id: assigneeId || undefined,
      priority: priority || undefined,
      status: status || undefined,
    }),
    [qDebounced, projectId, assigneeId, priority, status],
  );

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks", filters],
    queryFn: async () => (await api.get<TaskListItem[]>("/api/tasks", { params: filters })).data,
  });

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await api.get<Project[]>("/api/projects")).data,
  });
  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await api.get<User[]>("/api/users")).data,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TaskStatus }) => api.patch(`/api/tasks/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const overId = e.over?.id;
    const activeId = e.active.id;
    if (!overId || typeof activeId !== "string" || typeof overId !== "string") return;
    const [, taskIdStr] = activeId.split(":");
    const [, newStatus] = overId.split(":");
    updateStatus.mutate({ id: Number(taskIdStr), status: newStatus as TaskStatus });
  };

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
                onClick={() => setView(v as View)}
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
          {can("tasks.create") && (
            <button className="btn-primary" onClick={() => setOpenNew(true)}>
              <Plus size={16} /> Новая задача
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={15} className="absolute left-3 top-2.5 text-neutral-400" />
          <input className="input pl-8" placeholder="Поиск задач…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input max-w-[180px]" value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Все проекты</option>
          {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="input max-w-[180px]" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Все исполнители</option>
          {users?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="input max-w-[160px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Любой статус</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className="input max-w-[160px]" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">Любой приоритет</option>
          {(["low", "medium", "high", "critical"] as const).map((p) => (
            <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <Loader />
      ) : !tasks || tasks.length === 0 ? (
        <EmptyState title="Задач не найдено" description="Измените фильтры или создайте новую задачу" />
      ) : view === "kanban" ? (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {STATUS_ORDER.map((s) => (
              <KanbanColumn key={s} status={s} tasks={tasks.filter((t) => t.status === s)} />
            ))}
          </div>
        </DndContext>
      ) : view === "table" ? (
        <TableView tasks={tasks} />
      ) : view === "list" ? (
        <ListView tasks={tasks} />
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
    </div>
  );
}

function KanbanColumn({ status, tasks }: { status: TaskStatus; tasks: TaskListItem[] }) {
  const { isOver, setNodeRef } = useDroppable({ id: `col:${status}` });
  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "flex min-h-[220px] flex-col rounded-2xl border p-2.5",
        isOver
          ? "border-brand-400 bg-brand-50/50 dark:border-brand-700 dark:bg-brand-900/10"
          : "border-neutral-200 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-900/40",
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1.5">
        <div className="flex items-center gap-2">
          <StatusChip status={status} />
        </div>
        <span className="text-xs text-neutral-500">{tasks.length}</span>
      </div>
      <div className="space-y-2">
        {tasks.map((t) => <KanbanCard key={t.id} task={t} />)}
      </div>
    </div>
  );
}

const KanbanCard = memo(function KanbanCard({ task }: { task: TaskListItem }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `task:${task.id}` });
  const nav = useNavigate();
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 }}
      {...listeners}
      {...attributes}
      onClick={() => nav(`/tasks/${task.id}`)}
      className="cursor-pointer rounded-xl border border-neutral-200 bg-white p-3 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="mb-1.5 text-sm font-medium leading-snug">{task.title}</div>
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

function TableView({ tasks }: { tasks: TaskListItem[] }) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-800/40">
          <tr>
            <th className="px-5 py-2.5 text-left">Задача</th>
            <th className="px-5 py-2.5 text-left">Статус</th>
            <th className="px-5 py-2.5 text-left">Приоритет</th>
            <th className="px-5 py-2.5 text-left">Исполнитель</th>
            <th className="px-5 py-2.5 text-left">Дедлайн</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="table-row">
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListView({ tasks }: { tasks: TaskListItem[] }) {
  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <Link key={t.id} to={`/tasks/${t.id}`}
          className="card flex items-center justify-between gap-3 px-4 py-3 hover:border-neutral-300 dark:hover:border-neutral-700">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{t.title}</div>
            <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
              <StatusChip status={t.status} />
              <PriorityChip priority={t.priority} />
              {t.deadline && <span>до {new Date(t.deadline).toLocaleDateString("ru-RU")}</span>}
            </div>
          </div>
          {t.assignee && <Avatar name={t.assignee.name} size={26} url={t.assignee.avatar_url} />}
        </Link>
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

function TaskFormModal({
  onClose,
  projects,
  users,
}: {
  onClose: () => void;
  projects: Project[];
  users: User[];
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [projectId, setProjectId] = useState<number | "">("");
  const [assigneeId, setAssigneeId] = useState<number | "">("");
  const [deadline, setDeadline] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/tasks", {
        title,
        description: description || null,
        priority,
        project_id: projectId || null,
        assignee_id: assigneeId || null,
        deadline: deadline ? new Date(deadline).toISOString() : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title="Новая задача" size="md">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Описание</span>
          <textarea className="input min-h-[80px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Проект</span>
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">—</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Исполнитель</span>
            <select className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">—</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Приоритет</span>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as any)}>
              <option value="low">{PRIORITY_LABEL.low}</option>
              <option value="medium">{PRIORITY_LABEL.medium}</option>
              <option value="high">{PRIORITY_LABEL.high}</option>
              <option value="critical">{PRIORITY_LABEL.critical}</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Дедлайн</span>
            <input className="input" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-primary" disabled={!title || create.isPending} onClick={() => create.mutate()}>Создать</button>
        </div>
      </div>
    </Modal>
  );
}
