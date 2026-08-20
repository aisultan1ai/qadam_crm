import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, API_URL, extractApiError } from "@/api/client";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Plus, LayoutGrid, List as ListIcon, Table as TableIcon, CalendarDays, Search, Trash2,
  Upload, Download, FileSpreadsheet, CheckCircle2, XCircle, Loader2, SlidersHorizontal, X,
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
import { VirtualList } from "@/components/VirtualList";
import { useIsMobile } from "@/hooks/useMediaQuery";

const TASKS_VIEW_STORAGE_KEY = "tasks:view";

type View = "kanban" | "table" | "list" | "calendar";
const VIEWS: View[] = ["kanban", "table", "list", "calendar"];

function readParam(sp: URLSearchParams, key: string) {
  const v = sp.get(key);
  return v ?? "";
}

function activeFilterCount(project: string, assignee: string, status: string, priority: string): number {
  return [project, assignee, status, priority].filter(Boolean).length;
}

export default function Tasks() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const isMobile = useIsMobile();

  // Приоритет: URL > localStorage > дефолт. При переключении вида — сохраняем
  // и в URL (для ссылок/back), и в localStorage (для сессий).
  const storedView = typeof window !== "undefined" ? window.localStorage.getItem(TASKS_VIEW_STORAGE_KEY) : null;
  const urlView = sp.get("view");
  const rawView: View = (urlView && VIEWS.includes(urlView as View))
    ? (urlView as View)
    : (storedView && VIEWS.includes(storedView as View) ? (storedView as View) : "kanban");
  // На мобилке "table" нечитаемо (min-w 900px) → показываем "list" автоматически,
  // но выбор пользователя не затираем.
  const view: View = isMobile && rawView === "table" ? "list" : rawView;

  const q = readParam(sp, "q");
  const projectId = readParam(sp, "project");
  const assigneeId = readParam(sp, "assignee");
  const priority = readParam(sp, "priority");
  const status = readParam(sp, "status");

  const [openNew, setOpenNew] = useState(false);
  const [openImport, setOpenImport] = useState(false);
  const [openExport, setOpenExport] = useState(false);
  const [openFilters, setOpenFilters] = useState(false);
  const [qLocal, setQLocal] = useState(q);
  useEffect(() => setQLocal(q), [q]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<null | "status" | "priority" | "assignee" | "deadline">(null);
  const canBulk = can("tasks.bulk_update");

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    setSp(next, { replace: true });
  };

  const setView = (v: View) => {
    try {
      window.localStorage.setItem(TASKS_VIEW_STORAGE_KEY, v);
    } catch {
      // localStorage может быть недоступен (private mode) — не критично.
    }
    // "kanban" — дефолт, поэтому не мусорим URL.
    updateParam("view", v === "kanban" ? "" : v);
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
    // mutationKey нужен, чтобы отслеживать pending-очередь: при быстром dnd
    // нескольких карт invalidate делаем только после того, как последняя
    // мутация завершилась. Иначе рефетч в середине очереди сбросит optimistic
    // updates других карт → карты «прыгают» обратно.
    mutationKey: ["task-status-update"],
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
      const stillPending = qc
        .getMutationCache()
        .findAll({ mutationKey: ["task-status-update"], status: "pending" }).length;
      if (stillPending === 0) {
        qc.invalidateQueries({ queryKey: ["tasks"] });
        qc.invalidateQueries({ queryKey: ["task", vars.id] });
      }
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

  const bulkUpdate = useMutation({
    mutationFn: async ({ ids, patch }: { ids: number[]; patch: Record<string, unknown> }) =>
      (await api.post("/api/tasks/bulk", { ids, patch })).data,
    onSuccess: (_data, vars) => {
      toast.success(`Обновлено задач: ${vars.ids.length}`);
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["project-tasks"] });
      setSelectedIds(new Set());
      setBulkAction(null);
    },
    onError: (e) => toast.error("Не удалось применить массовое действие", extractApiError(e).message),
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
    // Guard: не отправлять повторно для той же карты, если предыдущая мутация
    // ещё в полёте. Иначе получаем два PATCH подряд с одинаковым body.
    const inFlight = qc
      .getMutationCache()
      .findAll({ mutationKey: ["task-status-update"] })
      .some((m) => m.state.status === "pending" && (m.state.variables as { id?: number } | undefined)?.id === id);
    if (inFlight) return;
    updateStatus.mutate({ id, status: newStatus as TaskStatus });
    setLandedId(id);
    window.setTimeout(() => setLandedId((cur) => (cur === id ? null : cur)), 460);
  };

  const onDragCancel = () => setActiveDragId(null);

  const filtersActive = Boolean(q || projectId || assigneeId || priority || status);
  const canCreate = can("tasks.create");
  const resetFilters = () => {
    const next = new URLSearchParams(sp);
    ["q", "project", "assignee", "status", "priority"].forEach((k) => next.delete(k));
    setSp(next, { replace: true });
    setQLocal("");
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
            ).map(([v, icon]) => {
              // На мобилке скрываем table (всё равно нечитаемо).
              if (isMobile && v === "table") return null;
              return (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  aria-label={v === "kanban" ? "Kanban" : v === "table" ? "Таблица" : v === "list" ? "Список" : "Календарь"}
                  className={clsx(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium capitalize",
                    view === v
                      ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-white"
                      : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-800/50",
                  )}
                >
                  {icon}
                  <span className="hidden sm:inline">
                    {v === "kanban" ? "Kanban" : v === "table" ? "Таблица" : v === "list" ? "Список" : "Календарь"}
                  </span>
                </button>
              );
            })}
          </div>
          {can("analytics.reports") && (
            <button
              className="btn-ghost"
              onClick={() => setOpenExport(true)}
              title="Экспорт задач в Excel (с учётом фильтров)"
              aria-label="Экспорт задач в Excel"
            >
              <Download size={15} /> <span className="hidden sm:inline">Экспорт</span>
            </button>
          )}
          {canCreate && (
            <button
              className="btn-ghost"
              onClick={() => setOpenImport(true)}
              title="Импортировать задачи из CSV"
              aria-label="Импортировать задачи из CSV"
            >
              <Upload size={15} /> <span className="hidden sm:inline">Импорт</span>
            </button>
          )}
          {canCreate && (
            <button className="btn-primary" onClick={() => setOpenNew(true)} aria-label="Новая задача">
              <Plus size={16} /> <span className="hidden sm:inline">Новая задача</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-md">
          <Search size={15} className="absolute left-3 top-2.5 text-neutral-400" />
          <input
            className="input pl-8"
            placeholder="Поиск задач…"
            value={qLocal}
            onChange={(e) => setQLocal(e.target.value)}
            aria-label="Поиск задач"
          />
        </div>

        {/* Десктоп: селекты в строке */}
        <div className="hidden flex-wrap items-center gap-2 md:flex">
          <select
            className="input max-w-[180px]"
            value={projectId}
            onChange={(e) => updateParam("project", e.target.value)}
            aria-label="Проект"
          >
            <option value="">Все проекты</option>
            {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select
            className="input max-w-[180px]"
            value={assigneeId}
            onChange={(e) => updateParam("assignee", e.target.value)}
            aria-label="Исполнитель"
          >
            <option value="">Все исполнители</option>
            {users?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select
            className="input max-w-[160px]"
            value={status}
            onChange={(e) => updateParam("status", e.target.value)}
            aria-label="Статус"
          >
            <option value="">Любой статус</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select
            className="input max-w-[160px]"
            value={priority}
            onChange={(e) => updateParam("priority", e.target.value)}
            aria-label="Приоритет"
          >
            <option value="">Любой приоритет</option>
            {(["low", "medium", "high", "critical"] as const).map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>
        </div>

        {/* Мобилка: одна кнопка "Фильтры" со счётчиком */}
        <button
          type="button"
          className="btn-ghost md:hidden"
          onClick={() => setOpenFilters(true)}
          aria-label="Открыть фильтры"
        >
          <SlidersHorizontal size={15} />
          Фильтры
          {activeFilterCount(projectId, assigneeId, status, priority) > 0 && (
            <span className="ml-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">
              {activeFilterCount(projectId, assigneeId, status, priority)}
            </span>
          )}
        </button>

        {filtersActive && (
          <button
            className="btn-ghost !px-2 !py-1 text-xs"
            onClick={resetFilters}
          >
            Сбросить фильтры
          </button>
        )}
      </div>

      {openFilters && (
        <FilterDrawer
          onClose={() => setOpenFilters(false)}
          projects={projects ?? []}
          users={users ?? []}
          projectId={projectId}
          assigneeId={assigneeId}
          status={status}
          priority={priority}
          onChange={updateParam}
          onReset={resetFilters}
        />
      )}

      {isPending ? (
        view === "kanban" ? <SkeletonKanban /> :
        view === "table" ? <SkeletonTable rows={8} cols={5} /> :
        view === "list" ? <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}</div> :
        <SkeletonTable rows={4} cols={7} />
      ) : !tasks || tasks.length === 0 ? (
        filtersActive ? (
          <EmptyState
            title="По фильтру ничего не найдено"
            description="Попробуйте изменить или сбросить фильтры"
            action={
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={resetFilters}>
                  Сбросить фильтры
                </button>
                {canCreate && (
                  <button className="btn-primary" onClick={() => setOpenNew(true)}>
                    <Plus size={16} /> Новая задача
                  </button>
                )}
              </div>
            }
          />
        ) : (
          <EmptyState
            title="Задач пока нет"
            description="Создайте первую задачу — она появится на канбан-доске"
            action={canCreate && (
              <button className="btn-primary" onClick={() => setOpenNew(true)}>
                <Plus size={16} /> Новая задача
              </button>
            )}
          />
        )
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
        <TableView
          tasks={tasks}
          onDelete={requestDelete}
          selectedIds={canBulk ? selectedIds : undefined}
          onToggleSelect={canBulk ? (id) => toggleSelected(id, setSelectedIds) : undefined}
          onToggleAll={canBulk ? (checked) => setSelectedIds(checked ? new Set(tasks.map((t) => t.id)) : new Set()) : undefined}
        />
      ) : view === "list" ? (
        <ListView
          tasks={tasks}
          onDelete={requestDelete}
          selectedIds={canBulk ? selectedIds : undefined}
          onToggleSelect={canBulk ? (id) => toggleSelected(id, setSelectedIds) : undefined}
        />
      ) : (
        <CalendarView tasks={tasks} />
      )}

      {canBulk && selectedIds.size > 0 && (view === "table" || view === "list") && (
        <BulkToolbar
          count={selectedIds.size}
          onClear={() => setSelectedIds(new Set())}
          onOpen={(action) => setBulkAction(action)}
          onDelete={() => {
            // Массовое удаление — просим подтверждение через ConfirmModal? Здесь простой поток:
            // используем существующую deleteTask последовательно.
            Array.from(selectedIds).forEach((id) => deleteTask.mutate(id));
            setSelectedIds(new Set());
          }}
        />
      )}

      {bulkAction && (
        <BulkPatchModal
          action={bulkAction}
          ids={Array.from(selectedIds)}
          users={users ?? []}
          projects={projects ?? []}
          isPending={bulkUpdate.isPending}
          onClose={() => setBulkAction(null)}
          onSubmit={(patch) => bulkUpdate.mutate({ ids: Array.from(selectedIds), patch })}
        />
      )}

      {openNew && (
        <TaskFormModal
          projects={projects ?? []}
          users={users ?? []}
          onClose={() => setOpenNew(false)}
        />
      )}

      {openImport && (
        <ImportCsvModal
          onClose={() => setOpenImport(false)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["tasks"] });
          }}
        />
      )}

      {openExport && (
        <ExportExcelModal
          filters={filters}
          onClose={() => setOpenExport(false)}
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

// Grid layout для Tasks table-view. Одинаковый template для header и rows.
const TASKS_GRID_COLS = "36px minmax(240px,2.5fr) 130px 120px minmax(160px,1fr) 120px 60px";
const TASKS_GRID_COLS_NO_SELECT = "minmax(240px,2.5fr) 130px 120px minmax(160px,1fr) 120px 60px";
const TASK_ROW_HEIGHT = 52;
const TASK_CARD_HEIGHT = 76;

function toggleSelected(id: number, setter: React.Dispatch<React.SetStateAction<Set<number>>>) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

function TableView({
  tasks,
  onDelete,
  selectedIds,
  onToggleSelect,
  onToggleAll,
}: {
  tasks: TaskListItem[];
  onDelete?: (id: number) => void;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
  onToggleAll?: (checked: boolean) => void;
}) {
  const withSelect = !!onToggleSelect;
  const gridCols = withSelect ? TASKS_GRID_COLS : TASKS_GRID_COLS_NO_SELECT;
  const allSelected = withSelect && tasks.length > 0 && tasks.every((t) => selectedIds?.has(t.id));
  const someSelected = withSelect && tasks.some((t) => selectedIds?.has(t.id)) && !allSelected;
  return (
    <div className="card overflow-hidden">
      <div className="min-w-[900px]">
        <div
          className="grid bg-neutral-50 px-5 py-2.5 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-800/40"
          style={{ gridTemplateColumns: gridCols }}
        >
          {withSelect && (
            <div className="flex items-center">
              <input
                type="checkbox"
                aria-label="Выбрать все задачи"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={(e) => onToggleAll?.(e.target.checked)}
              />
            </div>
          )}
          <div>Задача</div>
          <div>Статус</div>
          <div>Приоритет</div>
          <div>Исполнитель</div>
          <div>Дедлайн</div>
          <div />
        </div>
        <VirtualList
          items={tasks}
          itemHeight={TASK_ROW_HEIGHT}
          height={Math.min(tasks.length, 14) * TASK_ROW_HEIGHT + 4}
          getKey={(t) => t.id}
          threshold={50}
          renderItem={(t) => {
            const isSelected = !!selectedIds?.has(t.id);
            return (
              <div
                className={clsx(
                  "group grid items-center border-b border-neutral-100 px-5 text-sm hover:bg-neutral-50/70 dark:border-neutral-800/80 dark:hover:bg-neutral-800/40",
                  isSelected && "bg-brand-50/50 dark:bg-brand-900/10",
                )}
                style={{ gridTemplateColumns: gridCols, height: TASK_ROW_HEIGHT }}
              >
                {withSelect && (
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      aria-label={`Выбрать «${t.title}»`}
                      checked={isSelected}
                      onChange={() => onToggleSelect?.(t.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                )}
                <div className="min-w-0">
                  <Link to={`/tasks/${t.id}`} className="truncate font-medium hover:text-brand-600 block">
                    {t.title}
                  </Link>
                </div>
                <div><StatusChip status={t.status} /></div>
                <div><PriorityChip priority={t.priority} /></div>
                <div className="min-w-0">
                  {t.assignee ? (
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar name={t.assignee.name} size={22} url={t.assignee.avatar_url} />
                      <span className="truncate">{t.assignee.name}</span>
                    </div>
                  ) : "—"}
                </div>
                <div className="text-neutral-500">
                  {t.deadline ? new Date(t.deadline).toLocaleDateString("ru-RU") : "—"}
                </div>
                <div className="flex justify-end">
                  {onDelete && (
                    <button
                      type="button"
                      onClick={() => onDelete(t.id)}
                      className="rounded p-1.5 text-neutral-400 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 dark:hover:bg-rose-950/30"
                      title="Удалить задачу"
                      aria-label="Удалить задачу"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}

function ListView({
  tasks,
  onDelete,
  selectedIds,
  onToggleSelect,
}: {
  tasks: TaskListItem[];
  onDelete?: (id: number) => void;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
}) {
  const withSelect = !!onToggleSelect;
  return (
    <VirtualList
      items={tasks}
      itemHeight={TASK_CARD_HEIGHT}
      height={Math.min(tasks.length, 10) * TASK_CARD_HEIGHT + 4}
      getKey={(t) => t.id}
      threshold={50}
      className="space-y-2"
      rowClassName="pb-2"
      renderItem={(t) => {
        const isSelected = !!selectedIds?.has(t.id);
        return (
          <div className="group relative flex items-center gap-2">
            {withSelect && (
              <input
                type="checkbox"
                aria-label={`Выбрать «${t.title}»`}
                checked={isSelected}
                onChange={() => onToggleSelect?.(t.id)}
                className="ml-1 shrink-0"
              />
            )}
            <Link
              to={`/tasks/${t.id}`}
              className={clsx(
                "card-interactive flex flex-1 items-center justify-between gap-3 px-4 py-3",
                isSelected && "ring-2 ring-brand-500/40",
              )}
            >
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
        );
      }}
    />
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


type ImportStatus = {
  job_id: string;
  state: string;
  progress?: string;
  total?: number;
  created?: number;
  error_count?: number;
  errors?: string[];
  error?: string;
};

function ImportCsvModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const { data } = await api.get<ImportStatus>(`/api/imports/${jobId}`);
        if (stop) return;
        setStatus(data);
        if (data.state === "SUCCESS" || data.state === "FAILURE") {
          onDone();
          return;
        }
      } catch (e) {
        if (stop) return;
        setStatus({ job_id: jobId, state: "FAILURE", error: extractApiError(e).message });
        return;
      }
      if (!stop) window.setTimeout(tick, 1000);
    };
    tick();
    return () => { stop = true; };
  }, [jobId, onDone]);

  const start = async () => {
    if (!file) return;
    setStarting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post<{ job_id: string; state: string }>(
        "/api/imports/tasks",
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      setJobId(data.job_id);
      setStatus({ job_id: data.job_id, state: data.state });
    } catch (e) {
      toast.error("Не удалось запустить импорт", extractApiError(e).message);
    } finally {
      setStarting(false);
    }
  };

  const done = status?.state === "SUCCESS";
  const failed = status?.state === "FAILURE";
  const inFlight = jobId && !done && !failed;

  return (
    <Modal open onClose={onClose} title="Импорт задач из CSV" size="lg">
      <div className="space-y-4">
        {!jobId && (
          <>
            <div className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-400">
              <div className="mb-1 font-medium text-neutral-700 dark:text-neutral-300">Формат CSV (UTF-8 или CP1251, до 5 МБ)</div>
              <code className="block font-mono text-[11px]">title,description,status,priority,project_id,assignee_email,deadline</code>
              <div className="mt-2 space-y-0.5">
                <div>• <b>title</b> — обязательно</div>
                <div>• <b>status</b> — new, in_progress, review, done, cancelled (по умолчанию new)</div>
                <div>• <b>priority</b> — low, medium, high, critical (по умолчанию medium)</div>
                <div>• <b>deadline</b> — YYYY-MM-DD или YYYY-MM-DD HH:MM</div>
                <div>• <b>assignee_email</b> — email существующего сотрудника компании</div>
              </div>
            </div>

            <div>
              <label
                className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 px-6 py-8 text-sm text-neutral-600 hover:border-brand-400 hover:bg-brand-50 dark:border-neutral-700 dark:bg-neutral-800/40 dark:hover:border-brand-600 dark:hover:bg-brand-950/20"
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <Upload size={18} />
                {file ? (
                  <span className="font-medium">{file.name} · {Math.round(file.size / 1024)} КБ</span>
                ) : (
                  <span>Нажмите чтобы выбрать CSV-файл</span>
                )}
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={onClose}>Отмена</button>
              <button className="btn-primary" disabled={!file || starting} onClick={start}>
                {starting ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                Запустить импорт
              </button>
            </div>
          </>
        )}

        {inFlight && (
          <div className="py-6 text-center">
            <Loader2 size={28} className="mx-auto animate-spin text-brand-500" />
            <div className="mt-3 text-sm font-medium">Обрабатываем CSV…</div>
            {status?.progress && (
              <div className="mt-1 text-xs text-neutral-500">{status.progress}</div>
            )}
            <div className="mt-1 text-xs text-neutral-500">Состояние: {status?.state}</div>
          </div>
        )}

        {done && status && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 size={18} />
              <div>
                <div className="font-medium">Импорт завершён</div>
                <div className="text-xs">
                  Всего строк: {status.total ?? 0} · Создано: {status.created ?? 0}
                  {(status.error_count ?? 0) > 0 && <> · С ошибками: {status.error_count}</>}
                </div>
              </div>
            </div>

            {status.errors && status.errors.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-neutral-500">Ошибки</div>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900/60">
                  {status.errors.map((e, i) => (
                    <div key={i} className="py-0.5 text-rose-600 dark:text-rose-400">{e}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button className="btn-primary" onClick={onClose}>Готово</button>
            </div>
          </div>
        )}

        {failed && status && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
              <XCircle size={18} />
              <div>
                <div className="font-medium">Импорт не удался</div>
                <div className="text-xs">{status.error || "Неизвестная ошибка"}</div>
              </div>
            </div>
            <div className="flex justify-end">
              <button className="btn-ghost" onClick={onClose}>Закрыть</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}


type ExportStatus = {
  job_id: string;
  state: string;
  filename?: string;
  rows?: number;
  download_url?: string;
  error?: string;
};

type TaskFilters = {
  q?: string;
  project_id?: number;
  assignee_id?: number;
  priority?: string;
  status?: string;
};

function ExportExcelModal({ filters, onClose }: { filters: TaskFilters; onClose: () => void }) {
  const toast = useToast();
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<ExportStatus | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  const start = async () => {
    try {
      const params: Record<string, string | number> = {};
      if (filters.status) params.status_filter = filters.status;
      if (filters.project_id) params.project_id = filters.project_id;
      if (filters.assignee_id) params.assignee_id = filters.assignee_id;
      const { data } = await api.post<{ job_id: string; state: string }>(
        "/api/exports/tasks",
        null,
        { params },
      );
      setJobId(data.job_id);
      setStatus({ job_id: data.job_id, state: data.state });
    } catch (e) {
      toast.error("Не удалось запустить экспорт", extractApiError(e).message);
    }
  };

  useEffect(() => {
    start();
  }, []);

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const { data } = await api.get<ExportStatus>(`/api/exports/${jobId}`);
        if (stop) return;
        setStatus(data);
        if (data.state === "SUCCESS" || data.state === "FAILURE") return;
      } catch (e) {
        if (stop) return;
        setStatus({ job_id: jobId, state: "FAILURE", error: extractApiError(e).message });
        return;
      }
      if (!stop) window.setTimeout(tick, 1000);
    };
    tick();
    return () => { stop = true; };
  }, [jobId]);

  const done = status?.state === "SUCCESS";
  const failed = status?.state === "FAILURE";

  const download = () => {
    if (!status?.download_url) return;
    const url = `${API_URL}${status.download_url}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = status.filename || "tasks.xlsx";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setDownloaded(true);
  };

  useEffect(() => {
    if (done && status?.download_url && !downloaded) {
      download();
    }
  }, [done, status?.download_url, downloaded]);

  const activeFilters = [
    filters.status && `статус: ${filters.status}`,
    filters.project_id && `проект #${filters.project_id}`,
    filters.assignee_id && `исполнитель #${filters.assignee_id}`,
  ].filter(Boolean);

  return (
    <Modal open onClose={onClose} title="Экспорт задач в Excel" size="md">
      <div className="space-y-4">
        {activeFilters.length > 0 && (
          <div className="rounded-lg bg-neutral-50 p-3 text-xs dark:bg-neutral-800/50">
            <span className="font-medium text-neutral-700 dark:text-neutral-300">Фильтры: </span>
            <span className="text-neutral-600 dark:text-neutral-400">{activeFilters.join(", ")}</span>
          </div>
        )}

        {!done && !failed && (
          <div className="py-6 text-center">
            <FileSpreadsheet size={32} className="mx-auto text-brand-500" />
            <div className="mt-3 flex items-center justify-center gap-2 text-sm font-medium">
              <Loader2 size={15} className="animate-spin" />
              Готовим файл…
            </div>
            <div className="mt-1 text-xs text-neutral-500">Состояние: {status?.state ?? "запуск"}</div>
          </div>
        )}

        {done && status && (
          <div className="space-y-3 py-2 text-center">
            <CheckCircle2 size={36} className="mx-auto text-emerald-500" />
            <div className="text-sm font-medium">Готово!</div>
            <div className="text-xs text-neutral-500">
              {status.filename} · {status.rows ?? 0} строк
            </div>
            <button className="btn-primary mx-auto" onClick={download}>
              <Download size={15} /> Скачать снова
            </button>
          </div>
        )}

        {failed && status && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
              <XCircle size={18} />
              <div>
                <div className="font-medium">Экспорт не удался</div>
                <div className="text-xs">{status.error || "Неизвестная ошибка"}</div>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <button className="btn-ghost" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </Modal>
  );
}

function BulkToolbar({
  count,
  onClear,
  onOpen,
  onDelete,
}: {
  count: number;
  onClear: () => void;
  onOpen: (action: "status" | "priority" | "assignee" | "deadline") => void;
  onDelete: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 pointer-events-none">
      <div className="card pointer-events-auto flex flex-wrap items-center gap-2 px-3 py-2 shadow-lg animate-slide-up">
        <span className="pl-1 pr-2 text-sm font-medium">Выбрано: {count}</span>
        <div className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-700" />
        <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => onOpen("status")}>Статус</button>
        <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => onOpen("priority")}>Приоритет</button>
        <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => onOpen("assignee")}>Исполнитель</button>
        <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => onOpen("deadline")}>Дедлайн</button>
        <button className="btn-ghost !py-1 !px-2 text-xs text-rose-500" onClick={onDelete}>
          <Trash2 size={12} /> Удалить
        </button>
        <div className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-700" />
        <button className="btn-ghost !py-1 !px-2 text-xs" onClick={onClear}>Отмена</button>
      </div>
    </div>
  );
}

function BulkPatchModal({
  action,
  ids,
  users,
  projects: _projects,
  isPending,
  onClose,
  onSubmit,
}: {
  action: "status" | "priority" | "assignee" | "deadline";
  ids: number[];
  users: User[];
  projects: Project[];
  isPending: boolean;
  onClose: () => void;
  onSubmit: (patch: Record<string, unknown>) => void;
}) {
  const [status, setStatus] = useState<TaskStatus>("new");
  const [priority, setPriority] = useState("medium");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [deadline, setDeadline] = useState("");

  const title = {
    status: "Изменить статус",
    priority: "Изменить приоритет",
    assignee: "Назначить исполнителя",
    deadline: "Изменить дедлайн",
  }[action];

  const submit = () => {
    let patch: Record<string, unknown> = {};
    if (action === "status") patch = { status };
    else if (action === "priority") patch = { priority };
    else if (action === "assignee") patch = { assignee_id: assigneeId ? Number(assigneeId) : null };
    else if (action === "deadline") patch = { deadline: deadline ? new Date(deadline).toISOString() : null };
    onSubmit(patch);
  };

  return (
    <Modal open onClose={onClose} title={title} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-neutral-500">Применится к {ids.length} задачам.</p>

        {action === "status" && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Новый статус</span>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} autoFocus>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </label>
        )}

        {action === "priority" && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Новый приоритет</span>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)} autoFocus>
              {(["low", "medium", "high", "critical"] as const).map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </select>
          </label>
        )}

        {action === "assignee" && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Исполнитель</span>
            <select className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} autoFocus>
              <option value="">— (снять)</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
        )}

        {action === "deadline" && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Новый дедлайн</span>
            <input
              className="input"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              autoFocus
            />
            <div className="mt-1 text-[11px] text-neutral-500">Пусто = снять дедлайн</div>
          </label>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-primary" onClick={submit} disabled={isPending}>
            {isPending ? "Применяем…" : "Применить"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function FilterDrawer({
  onClose,
  projects,
  users,
  projectId,
  assigneeId,
  status,
  priority,
  onChange,
  onReset,
}: {
  onClose: () => void;
  projects: Project[];
  users: User[];
  projectId: string;
  assigneeId: string;
  status: string;
  priority: string;
  onChange: (key: string, value: string) => void;
  onReset: () => void;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Фильтры задач">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-5 animate-slide-up dark:bg-[#26262e]">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">Фильтры</h3>
          <button className="btn-ghost !p-1.5" onClick={onClose} aria-label="Закрыть фильтры">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Проект</span>
            <select
              className="input"
              value={projectId}
              onChange={(e) => onChange("project", e.target.value)}
            >
              <option value="">Все проекты</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Исполнитель</span>
            <select
              className="input"
              value={assigneeId}
              onChange={(e) => onChange("assignee", e.target.value)}
            >
              <option value="">Все исполнители</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Статус</span>
            <select
              className="input"
              value={status}
              onChange={(e) => onChange("status", e.target.value)}
            >
              <option value="">Любой статус</option>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Приоритет</span>
            <select
              className="input"
              value={priority}
              onChange={(e) => onChange("priority", e.target.value)}
            >
              <option value="">Любой приоритет</option>
              {(["low", "medium", "high", "critical"] as const).map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            className="btn-secondary flex-1"
            onClick={() => {
              onReset();
              onClose();
            }}
          >
            Сбросить
          </button>
          <button className="btn-primary flex-1" onClick={onClose}>
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}
