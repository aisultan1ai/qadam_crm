/**
 * Список задач в стиле ClickUp: группы («Группировать по» статусу, исполнителю, приоритету,
 * проекту или сроку), правка прямо в строке, подзадачи под родителем, перетаскивание
 * внутри группы и между группами, быстрое добавление задачи и подзадачи.
 */
import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarDays, Check, ChevronDown, ChevronRight, Flag, GripVertical, Layers, ListTree, Pencil, Plus, Search, Trash2, UserRound, X,
} from "lucide-react";

import { api, extractApiError } from "@/api/client";
import { Avatar } from "@/components/ui";
import { Popover, PopoverItem } from "@/components/Popover";
import { useToast } from "@/components/Toast";
import type { Project, TaskListItem, TaskPriority, TaskStatus, TaskStatusDef, UserBrief } from "@/types";
import { endOfDayISO, useTaskPatch } from "./useTaskPatch";
import {
  GROUP_BY_OPTIONS, PRIORITY_META, PRIORITY_ORDER, buildGroups, statusKeyOf, statusOptions,
  type GroupBy, type StatusOption, type TaskChange, type TaskGroup,
} from "./grouping";

// Tailwind-классы меток для канбана (там колонки — базовые статусы).
export const GROUP_PILL: Record<TaskStatus, string> = {
  new: "bg-indigo-600",
  in_progress: "bg-sky-600",
  review: "bg-amber-500",
  done: "bg-emerald-600",
  cancelled: "bg-zinc-500",
};

const COLS = "grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_150px_120px_130px_32px]";

export type ListPerms = { update: boolean; status: boolean; assign: boolean; priority: boolean };

type Order = Record<string, number[]>;

const isClosed = (s: TaskStatus) => s === "done" || s === "cancelled";

function fmtDue(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today.getTime()) / 86400000);
  const label = diff === 0 ? "Сегодня" : diff === 1 ? "Завтра" : diff === -1 ? "Вчера" : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  return { label, overdue: diff < 0 };
}

const taskKey = (id: number) => `task:${id}`;
const groupDropKey = (key: string) => `group:${key}`;
const byOrder = (a: TaskListItem, b: TaskListItem) => a.order_index - b.order_index;

export function GroupedListView({
  tasks,
  users = [],
  projects = [],
  statusDefs = [],
  groupBy = "status",
  onDelete,
  selectedIds,
  onToggleSelect,
  canCreate,
  projectId,
  onOpen,
  perms,
}: {
  tasks: TaskListItem[];
  users?: UserBrief[];
  projects?: Project[];
  statusDefs?: TaskStatusDef[];
  groupBy?: GroupBy;
  onDelete?: (id: number) => void;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
  canCreate?: boolean;
  projectId?: number;
  onOpen?: (id: number) => void;
  perms: ListPerms;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const patch = useTaskPatch();

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  // Подзадачи показываем под родителем, если родитель есть в выборке; иначе — как обычные строки.
  const children = useMemo(() => {
    const m = new Map<number, TaskListItem[]>();
    tasks.forEach((t) => {
      if (t.parent_task_id && byId.has(t.parent_task_id)) {
        const arr = m.get(t.parent_task_id) ?? [];
        arr.push(t);
        m.set(t.parent_task_id, arr);
      }
    });
    m.forEach((arr) => arr.sort(byOrder));
    return m;
  }, [tasks, byId]);
  const topLevel = useMemo(() => tasks.filter((t) => !(t.parent_task_id && byId.has(t.parent_task_id))), [tasks, byId]);

  const { groups, keyOf } = useMemo(
    () => buildGroups(groupBy, { tasks: topLevel, defs: statusDefs, projects, perms }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupBy, topLevel, statusDefs, projects, perms.update, perms.status, perms.assign, perms.priority],
  );
  const groupByKey = useMemo(() => new Map(groups.map((g) => [g.key, g])), [groups]);
  const baseOrder = useMemo(() => {
    const o: Order = Object.fromEntries(groups.map((g) => [g.key, [] as number[]]));
    [...topLevel].sort(byOrder).forEach((t) => {
      const k = keyOf(t);
      (o[k] ??= []).push(t.id);
    });
    return o;
  }, [groups, topLevel, keyOf]);

  const options = useMemo(() => statusOptions(statusDefs), [statusDefs]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const isGroupCollapsed = (g: TaskGroup) => collapsed[`${groupBy}|${g.key}`] ?? !!g.collapsedByDefault;
  const toggleGroup = (g: TaskGroup) => setCollapsed((c) => ({ ...c, [`${groupBy}|${g.key}`]: !isGroupCollapsed(g) }));

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [addingSubFor, setAddingSubFor] = useState<number | null>(null);
  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const [dragOrder, setDragOrder] = useState<Order | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const order = dragOrder ?? baseOrder;

  const reorder = useMutation({
    mutationFn: (ids: number[]) => api.post("/api/tasks/reorder", { ids }),
    onError: (e) => {
      toast.error("Не удалось сохранить порядок", extractApiError(e).message);
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const containerOf = (key: string, o: Order): string | null => {
    if (key.startsWith("group:")) return key.slice(6);
    const id = Number(key.slice(5));
    return Object.keys(o).find((k) => o[k].includes(id)) ?? null;
  };

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(Number(String(e.active.id).slice(5)));
    setDragOrder(baseOrder);
  };

  // Переносим строку между группами «вживую», если целевая группа принимает задачи.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !dragOrder) return;
    const from = containerOf(String(active.id), dragOrder);
    const to = containerOf(String(over.id), dragOrder);
    if (!from || !to || from === to || !groupByKey.get(to)?.accepts) return;
    const id = Number(String(active.id).slice(5));
    const overKey = String(over.id);
    const target = (dragOrder[to] ?? []).filter((x) => x !== id);
    const overIdx = overKey.startsWith("task:") ? target.indexOf(Number(overKey.slice(5))) : -1;
    target.splice(overIdx < 0 ? target.length : overIdx, 0, id);
    setDragOrder({ ...dragOrder, [from]: dragOrder[from].filter((x) => x !== id), [to]: target });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const o = dragOrder;
    setActiveId(null);
    setDragOrder(null);
    if (!over || !o) return;
    const id = Number(String(active.id).slice(5));
    const groupKey = containerOf(String(active.id), o);
    const task = byId.get(id);
    if (!groupKey || !task) return;
    let list = o[groupKey];
    const overKey = String(over.id);
    if (overKey.startsWith("task:")) {
      const oldIdx = list.indexOf(id);
      const newIdx = list.indexOf(Number(overKey.slice(5)));
      if (oldIdx >= 0 && newIdx >= 0 && oldIdx !== newIdx) list = arrayMove(list, oldIdx, newIdx);
    }
    const moved = keyOf(task) !== groupKey;
    const change: TaskChange | undefined = moved ? groupByKey.get(groupKey)?.drop?.(task) : undefined;
    if (moved && !change) return;
    if (!moved && list.join(",") === (baseOrder[groupKey] ?? []).join(",")) return;

    // Оптимистично: порядок (+ поле группы) в кэше, чтобы строка не «прыгала» назад до ответа сервера.
    const idx = new Map(list.map((x, i) => [x, i * 10]));
    qc.setQueriesData<unknown>({ queryKey: ["tasks"] }, (old: unknown) =>
      Array.isArray(old)
        ? (old as TaskListItem[]).map((t) =>
            idx.has(t.id) ? { ...t, order_index: idx.get(t.id)!, ...(t.id === id && change ? change.optimistic : {}) } : t,
          )
        : old,
    );
    if (change) patch.mutate({ id, body: change.body, optimistic: change.optimistic });
    reorder.mutate(list);
  };

  // Пустые группы прячем; при группировке по статусу оставляем первую «новую», во время переноса — все принимающие.
  const firstNewKey = groupBy === "status" ? options.find((o) => o.category === "new")?.key : undefined;
  const visibleGroups = groups.filter(
    (g) => (order[g.key]?.length ?? 0) > 0 || g.key === firstNewKey || (activeId != null && g.accepts),
  );
  const activeTask = activeId != null ? byId.get(activeId) : undefined;

  const renderRow = (t: TaskListItem, depth: 0 | 1) => {
    const subs = children.get(t.id) ?? [];
    const isOpen = expanded.has(t.id);
    return (
      <Row
        key={t.id}
        task={t}
        depth={depth}
        users={users}
        perms={perms}
        options={options}
        statusKey={statusKeyOf(t, statusDefs)}
        subtasks={depth === 0 ? { total: subs.length, done: subs.filter((s) => isClosed(s.status)).length } : undefined}
        expanded={isOpen}
        onToggleExpand={() => toggleExpand(t.id)}
        onAddSubtask={
          depth === 0 && canCreate
            ? () => {
                setExpanded((prev) => new Set(prev).add(t.id));
                setAddingSubFor(t.id);
              }
            : undefined
        }
        onDelete={onDelete}
        onOpen={onOpen}
        selected={!!selectedIds?.has(t.id)}
        onToggleSelect={onToggleSelect}
        onPatch={(change) => patch.mutate({ id: t.id, ...change })}
      />
    );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setDragOrder(null);
      }}
    >
      <div className="flex flex-col gap-6">
        {visibleGroups.map((g) => {
          const ids = order[g.key] ?? [];
          const isCollapsed = isGroupCollapsed(g) && activeId == null;
          return (
            <GroupSection key={g.key} dropKey={groupDropKey(g.key)} label={g.label}>
              <div className="mb-1.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleGroup(g)}
                  aria-expanded={!isCollapsed}
                  aria-label={isCollapsed ? "Развернуть группу" : "Свернуть группу"}
                  className="grid h-6 w-6 place-items-center rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-[#23262D]"
                >
                  <ChevronDown size={16} className={clsx("transition-transform", isCollapsed && "-rotate-90")} />
                </button>
                <GroupLabel group={g} />
                <span className="text-[13px] tabular-nums text-zinc-500">{ids.length}</span>
              </div>

              {!isCollapsed && (
                <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#1B1E23]">
                  <div className={clsx("hidden gap-3 border-b border-zinc-100 py-2 pl-12 pr-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-400 sm:grid dark:border-zinc-800", COLS)}>
                    <span>Название</span>
                    <span>Исполнитель</span>
                    <span>Срок</span>
                    <span>Приоритет</span>
                    <span />
                  </div>
                  <SortableContext items={ids.map(taskKey)} strategy={verticalListSortingStrategy}>
                    {ids.map((id) => {
                      const t = byId.get(id);
                      if (!t) return null;
                      const subs = children.get(id) ?? [];
                      const isOpen = expanded.has(id);
                      return (
                        <div key={id}>
                          {renderRow(t, 0)}
                          {isOpen && (
                            <div className="bg-zinc-50/60 dark:bg-white/[0.015]">
                              {subs.map((s) => renderRow(s, 1))}
                              {canCreate && (
                                <QuickAdd
                                  subtask
                                  autoOpen={addingSubFor === id}
                                  onClosed={() => setAddingSubFor((cur) => (cur === id ? null : cur))}
                                  body={{ parent_task_id: id, project_id: t.project_id ?? null }}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </SortableContext>
                  {ids.length === 0 && activeId != null && (
                    <div className="py-3 pl-12 pr-4 text-[13px] text-zinc-400">Перетащите сюда</div>
                  )}
                  {canCreate && (
                    <QuickAdd body={{ project_id: projectId ?? null, ...(g.create ?? {}) }} dotColor={g.color} />
                  )}
                </div>
              )}
            </GroupSection>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask && (
          <div className="flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-[14px] shadow-pop dark:border-zinc-700 dark:bg-[#23262D]">
            <StatusDot option={options.find((o) => o.key === statusKeyOf(activeTask, statusDefs))} />
            <span className="truncate">{activeTask.title}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function GroupLabel({ group: g }: { group: TaskGroup }) {
  if (g.user !== undefined) {
    return (
      <span className="flex items-center gap-2 text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">
        {g.user ? (
          <Avatar name={g.user.name} url={g.user.avatar_url} size={22} />
        ) : (
          <span className="grid h-[22px] w-[22px] place-items-center rounded-full border border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-600">
            <UserRound size={12} />
          </span>
        )}
        {g.label}
      </span>
    );
  }
  return (
    <span
      className="rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-white"
      style={{ backgroundColor: g.color ?? "#4C5462" }}
    >
      {g.label}
    </span>
  );
}

function GroupSection({ dropKey, label, children }: { dropKey: string; label: string; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: dropKey });
  return (
    <section ref={setNodeRef} aria-label={label}>
      {children}
    </section>
  );
}

function StatusDot({ option }: { option?: StatusOption }) {
  const color = option?.color ?? "#979EAA";
  const filled = !!option && isClosed(option.category);
  return (
    <span
      className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border-2"
      style={{ borderColor: color, backgroundColor: filled ? color : undefined }}
      aria-hidden
    >
      {option?.category === "done" && <Check size={9} strokeWidth={3.5} className="text-white" />}
    </span>
  );
}

function Row({
  task: t,
  depth,
  users,
  perms,
  options,
  statusKey,
  subtasks,
  expanded,
  onToggleExpand,
  onAddSubtask,
  onDelete,
  onOpen,
  selected,
  onToggleSelect,
  onPatch,
}: {
  task: TaskListItem;
  depth: 0 | 1;
  users: UserBrief[];
  perms: ListPerms;
  options: StatusOption[];
  statusKey: string;
  subtasks?: { total: number; done: number };
  expanded: boolean;
  onToggleExpand: () => void;
  onAddSubtask?: () => void;
  onDelete?: (id: number) => void;
  onOpen?: (id: number) => void;
  selected: boolean;
  onToggleSelect?: (id: number) => void;
  onPatch: (change: TaskChange) => void;
}) {
  // Подзадачи не перетаскиваются (порядок — внутри родителя), поэтому их сортировка отключена.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: depth === 0 ? taskKey(t.id) : `sub:${t.id}`,
    disabled: depth === 1 || !perms.update,
  });
  const [renaming, setRenaming] = useState(false);
  const closed = isClosed(t.status);
  const hasSubs = !!subtasks && subtasks.total > 0;

  const openTask = (e: ReactMouseEvent) => {
    // Ctrl/⌘/Shift — обычная ссылка (новая вкладка), иначе панель справа.
    if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onOpen(t.id);
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        "group relative grid items-center gap-3 border-b border-zinc-100 py-1 pr-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800/70 dark:hover:bg-[#23262D]",
        COLS,
        depth === 1 ? "pl-[72px]" : "pl-12",
        selected && "bg-brand-50/60 dark:bg-brand-500/10",
        // Посадочное место: пунктирный плейсхолдер вместо полупрозрачной строки.
        isDragging && "!border-transparent !bg-brand-50 outline-dashed outline-2 -outline-offset-2 outline-brand-300 [&>*]:invisible dark:!bg-brand-500/10 dark:outline-brand-500/50",
      )}
    >
      <div className="absolute left-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
        {depth === 0 && perms.update ? (
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label="Перетащить задачу"
            className="grid h-6 w-4 cursor-grab place-items-center rounded text-zinc-300 opacity-0 hover:text-zinc-600 group-hover:opacity-100 focus:opacity-100 active:cursor-grabbing dark:text-zinc-600"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={14} />
          </button>
        ) : (
          <span className="w-4" />
        )}
        {onToggleSelect && (
          <input
            type="checkbox"
            aria-label={`Выбрать «${t.title}»`}
            checked={selected}
            onChange={() => onToggleSelect(t.id)}
            className={clsx("h-3.5 w-3.5 shrink-0 accent-brand-600", !selected && "opacity-0 group-hover:opacity-100 focus:opacity-100")}
          />
        )}
      </div>

      <div className="relative flex min-w-0 items-center gap-2">
        {depth === 0 && hasSubs && (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            aria-label={expanded ? "Скрыть подзадачи" : "Показать подзадачи"}
            className="absolute -left-6 grid h-5 w-5 place-items-center rounded text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-700 dark:hover:bg-zinc-700/50"
          >
            <ChevronRight size={14} className={clsx("transition-transform", expanded && "rotate-90")} />
          </button>
        )}
        <StatusCell options={options} current={statusKey} disabled={!perms.status} onChange={(o) => onPatch(o)} />
        {renaming ? (
          <RenameInput
            initial={t.title}
            onCancel={() => setRenaming(false)}
            onSave={(title) => {
              setRenaming(false);
              if (title !== t.title) onPatch({ body: { title }, optimistic: { title } });
            }}
          />
        ) : (
          <>
            <Link
              to={`/tasks/${t.id}`}
              onClick={openTask}
              className={clsx(
                "truncate py-1.5 hover:text-brand-700 dark:hover:text-brand-300",
                depth === 1 ? "text-[13.5px]" : "text-[14px]",
                closed ? "text-zinc-400 line-through" : "text-zinc-900 dark:text-zinc-100",
              )}
            >
              {t.title}
            </Link>
            {hasSubs && (
              <button
                type="button"
                onClick={onToggleExpand}
                title="Подзадачи: выполнено / всего"
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                <ListTree size={11} /> {subtasks!.done}/{subtasks!.total}
              </button>
            )}
            {perms.update && (
              <button
                type="button"
                onClick={() => setRenaming(true)}
                aria-label="Переименовать"
                className="shrink-0 rounded p-1 text-zinc-400 opacity-0 hover:bg-zinc-200/60 hover:text-zinc-700 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-zinc-700/50"
              >
                <Pencil size={12} />
              </button>
            )}
            {onAddSubtask && (
              <button
                type="button"
                onClick={onAddSubtask}
                aria-label="Добавить подзадачу"
                title="Добавить подзадачу"
                className="shrink-0 rounded p-1 text-zinc-400 opacity-0 hover:bg-zinc-200/60 hover:text-zinc-700 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-zinc-700/50"
              >
                <Plus size={13} />
              </button>
            )}
          </>
        )}
      </div>
      <div className="hidden min-w-0 sm:block">
        <AssigneeCell
          assignee={t.assignee}
          users={users}
          disabled={!perms.assign}
          onChange={(u) => onPatch({ body: { assignee_id: u?.id ?? null }, optimistic: { assignee: u } })}
        />
      </div>
      <div className="hidden sm:block">
        <DueCell
          deadline={t.deadline}
          closed={closed}
          disabled={!perms.update}
          onChange={(iso) => onPatch({ body: { deadline: iso }, optimistic: { deadline: iso } })}
        />
      </div>
      <div className="hidden sm:block">
        <PriorityCell
          priority={t.priority}
          disabled={!perms.priority}
          onChange={(p) => onPatch({ body: { priority: p }, optimistic: { priority: p } })}
        />
      </div>
      <div className="hidden justify-end sm:flex">
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(t.id)}
            className="rounded p-1 text-zinc-400 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-rose-500/10"
            aria-label="Удалить задачу"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- Ячейки с правкой на месте ---------------- */

const CELL_BTN =
  "flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] text-zinc-600 transition-colors hover:bg-zinc-200/50 disabled:cursor-default disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-700/40";

function StatusCell({
  options,
  current,
  disabled,
  onChange,
}: {
  options: StatusOption[];
  current: string;
  disabled: boolean;
  onChange: (o: StatusOption) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.key === current);
  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={cur ? (disabled ? cur.label : `Статус: ${cur.label} — изменить`) : undefined}
        aria-label={`Статус: ${cur?.label ?? ""}`}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full transition-transform hover:scale-110 disabled:hover:scale-100"
      >
        <StatusDot option={cur} />
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={210}>
        <div className="max-h-72 overflow-y-auto">
          {options.map((o) => (
            <PopoverItem
              key={o.key}
              active={o.key === current}
              onClick={() => {
                setOpen(false);
                if (o.key !== current) onChange(o);
              }}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />
              <span className="truncate">{o.label}</span>
            </PopoverItem>
          ))}
        </div>
      </Popover>
    </>
  );
}

function RenameInput({ initial, onSave, onCancel }: { initial: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    v.trim() ? onSave(v.trim()) : onCancel();
  };
  return (
    <input
      autoFocus
      value={v}
      aria-label="Название задачи"
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          done.current = true;
          onCancel();
        }
      }}
      className="my-0.5 h-7 min-w-0 flex-1 rounded-md border border-brand-400 bg-white px-2 text-[14px] text-zinc-900 outline-none ring-[3px] ring-brand-500/15 dark:bg-[#14161A] dark:text-zinc-100"
    />
  );
}

function AssigneeCell({
  assignee,
  users,
  disabled,
  onChange,
}: {
  assignee?: UserBrief | null;
  users: UserBrief[];
  disabled: boolean;
  onChange: (u: UserBrief | null) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = users.filter((u) => !needle || u.name.toLowerCase().includes(needle) || u.email?.toLowerCase().includes(needle));
  const pick = (u: UserBrief | null) => {
    setOpen(false);
    setQ("");
    if ((u?.id ?? null) !== (assignee?.id ?? null)) onChange(u);
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={CELL_BTN}
        aria-label={assignee ? `Исполнитель: ${assignee.name}` : "Назначить исполнителя"}
      >
        {assignee ? (
          <>
            <Avatar name={assignee.name} url={assignee.avatar_url} size={22} />
            <span className="truncate">{assignee.name.split(" ")[0]}</span>
          </>
        ) : (
          <span className="grid h-[22px] w-[22px] place-items-center rounded-full border border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-600">
            <UserRound size={12} />
          </span>
        )}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={240}>
        <div className="relative mb-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Найти сотрудника"
            aria-label="Найти сотрудника"
            className="h-8 w-full rounded-md border border-zinc-200 bg-transparent pl-7 pr-2 text-[13px] outline-none focus:border-brand-400 dark:border-zinc-700"
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {assignee && (
            <PopoverItem onClick={() => pick(null)}>
              <X size={14} className="text-zinc-400" /> Снять исполнителя
            </PopoverItem>
          )}
          {list.map((u) => (
            <PopoverItem key={u.id} active={u.id === assignee?.id} onClick={() => pick(u)}>
              <Avatar name={u.name} url={u.avatar_url} size={20} />
              <span className="truncate">{u.name}</span>
            </PopoverItem>
          ))}
          {list.length === 0 && <div className="px-2 py-2 text-[13px] text-zinc-400">Никого не нашли</div>}
        </div>
      </Popover>
    </>
  );
}

function DueCell({
  deadline,
  closed,
  disabled,
  onChange,
}: {
  deadline?: string | null;
  closed: boolean;
  disabled: boolean;
  onChange: (iso: string | null) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const due = fmtDue(deadline);
  const set = (iso: string | null) => {
    setOpen(false);
    onChange(iso);
  };
  const inDays = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return endOfDayISO(d);
  };
  const nextMonday = () => {
    const d = new Date();
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    return endOfDayISO(d);
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-label={due ? `Срок: ${due.label}` : "Поставить срок"}
        className={clsx(CELL_BTN, "tabular-nums", due?.overdue && !closed && "font-medium !text-rose-600 dark:!text-rose-400")}
      >
        {due ? due.label : <CalendarDays size={14} className="text-zinc-300 dark:text-zinc-600" />}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={220}>
        <PopoverItem onClick={() => set(inDays(0))}>Сегодня</PopoverItem>
        <PopoverItem onClick={() => set(inDays(1))}>Завтра</PopoverItem>
        <PopoverItem onClick={() => set(nextMonday())}>В понедельник</PopoverItem>
        <PopoverItem onClick={() => set(inDays(7))}>Через неделю</PopoverItem>
        <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
        <label className="block px-2 py-1 text-[12px] text-zinc-500">
          Дата
          <input
            type="date"
            value={deadline ? toLocalDate(deadline) : ""}
            onChange={(e) => e.target.value && set(endOfDayISO(new Date(`${e.target.value}T12:00:00`)))}
            className="mt-1 h-8 w-full rounded-md border border-zinc-200 bg-transparent px-2 text-[13px] text-zinc-800 outline-none focus:border-brand-400 dark:border-zinc-700 dark:text-zinc-100"
          />
        </label>
        {deadline && (
          <PopoverItem onClick={() => set(null)}>
            <X size={14} className="text-zinc-400" /> Убрать срок
          </PopoverItem>
        )}
      </Popover>
    </>
  );
}

function toLocalDate(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function PriorityCell({ priority, disabled, onChange }: { priority: TaskPriority; disabled: boolean; onChange: (p: TaskPriority) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pr = PRIORITY_META[priority];
  return (
    <>
      <button ref={ref} type="button" disabled={disabled} onClick={() => setOpen((v) => !v)} className={CELL_BTN} aria-label={`Приоритет: ${pr.label}`}>
        <Flag size={14} style={{ color: pr.color }} className={clsx(priority !== "low" && "fill-current")} />
        {pr.label}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={180}>
        {PRIORITY_ORDER.map((p) => (
          <PopoverItem
            key={p}
            active={p === priority}
            onClick={() => {
              setOpen(false);
              if (p !== priority) onChange(p);
            }}
          >
            <Flag size={14} style={{ color: PRIORITY_META[p].color }} className={clsx(p !== "low" && "fill-current")} />
            {PRIORITY_META[p].label}
          </PopoverItem>
        ))}
      </Popover>
    </>
  );
}

/* ---------------- Быстрое добавление задачи / подзадачи ---------------- */

function QuickAdd({
  body,
  dotColor,
  subtask = false,
  autoOpen = false,
  onClosed,
}: {
  body: Record<string, unknown>;
  dotColor?: string;
  subtask?: boolean;
  autoOpen?: boolean;
  onClosed?: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [openState, setOpen] = useState(false);
  const open = openState || autoOpen;
  const [title, setTitle] = useState("");
  const close = () => {
    setOpen(false);
    setTitle("");
    onClosed?.();
  };
  const create = useMutation({
    mutationFn: (t: string) => api.post("/api/tasks", { title: t, ...body }),
    onSuccess: () => {
      setTitle("");
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toast.error(subtask ? "Не удалось создать подзадачу" : "Не удалось создать задачу", extractApiError(e).message),
  });
  const pad = subtask ? "pl-[72px]" : "pl-12";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={clsx(
          "flex w-full items-center gap-2 py-2 pr-4 text-left text-[13px] text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-800 dark:hover:bg-[#23262D] dark:hover:text-zinc-200",
          pad,
          !subtask && "rounded-b-xl",
          subtask && "border-b border-zinc-100 dark:border-zinc-800/70",
        )}
      >
        <Plus size={14} /> {subtask ? "Добавить подзадачу" : "Добавить задачу"}
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const t = title.trim();
        if (t && !create.isPending) create.mutate(t);
      }}
      className={clsx("flex items-center gap-2 py-1.5 pr-4", pad, subtask && "border-b border-zinc-100 dark:border-zinc-800/70")}
    >
      <span
        className="mx-[5px] h-3.5 w-3.5 shrink-0 rounded-full border-2 border-zinc-300"
        style={dotColor ? { borderColor: dotColor } : undefined}
        aria-hidden
      />
      <input
        autoFocus
        aria-label={subtask ? "Название подзадачи" : "Название новой задачи"}
        placeholder={subtask ? "Название подзадачи и Enter" : "Название задачи и Enter"}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && close()}
        onBlur={() => !title.trim() && close()}
        className="h-8 min-w-0 flex-1 bg-transparent text-[14px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100"
      />
      <button type="submit" disabled={!title.trim() || create.isPending} className="btn-primary !h-7 !px-2.5 !py-0 !text-xs">
        Сохранить
      </button>
    </form>
  );
}

/* ---------------- Кнопка «Группировка» ---------------- */

export function GroupByButton({ value, onChange }: { value: GroupBy; onChange: (v: GroupBy) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const cur = GROUP_BY_OPTIONS.find((o) => o.key === value) ?? GROUP_BY_OPTIONS[0];
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-[#1B1E23] dark:text-zinc-300 dark:hover:bg-[#23262D]"
      >
        <Layers size={14} />
        <span className="hidden sm:inline">Группировка:</span>
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{cur.label}</span>
        <ChevronDown size={13} className="text-zinc-400" />
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={200} align="end">
        {GROUP_BY_OPTIONS.map((o) => (
          <PopoverItem
            key={o.key}
            active={o.key === value}
            onClick={() => {
              setOpen(false);
              onChange(o.key);
            }}
          >
            {o.label}
          </PopoverItem>
        ))}
      </Popover>
    </>
  );
}
