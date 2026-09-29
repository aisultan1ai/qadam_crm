/**
 * Группировка списка задач («Группировать по»): статус (базовый или свои статусы компании),
 * исполнитель, приоритет, проект, срок. Каждая группа знает, что поменять в задаче,
 * если её туда перетащили или создали в ней задачу.
 */
import { STATUS_LABEL, type Project, type TaskListItem, type TaskPriority, type TaskStatus, type TaskStatusDef, type UserBrief } from "@/types";
import { endOfDayISO } from "./useTaskPatch";

export type GroupBy = "status" | "assignee" | "priority" | "project" | "due";

export const GROUP_BY_OPTIONS: { key: GroupBy; label: string }[] = [
  { key: "status", label: "Статус" },
  { key: "assignee", label: "Исполнитель" },
  { key: "priority", label: "Приоритет" },
  { key: "project", label: "Проект" },
  { key: "due", label: "Срок" },
];

export type TaskChange = { body: Record<string, unknown>; optimistic: Partial<TaskListItem> };

export type TaskGroup = {
  key: string;
  label: string;
  /** Цвет метки (#RRGGBB). Нет цвета — заголовок без метки. */
  color?: string;
  /** Для группировки по исполнителю: аватар в заголовке. */
  user?: UserBrief | null;
  /** Можно ли перетащить сюда задачу из другой группы. */
  accepts: boolean;
  /** Что поменять в задаче при переносе в группу. */
  drop?: (t: TaskListItem) => TaskChange;
  /** Поля новой задачи, созданной в группе. */
  create?: Record<string, unknown>;
  collapsedByDefault?: boolean;
};

export const BASE_STATUS_ORDER: TaskStatus[] = ["in_progress", "review", "new", "done", "cancelled"];
export const BASE_STATUS_COLOR: Record<TaskStatus, string> = {
  new: "#4F46E5",
  in_progress: "#0284C7",
  review: "#F59E0B",
  done: "#059669",
  cancelled: "#697180",
};
export const PRIORITY_ORDER: TaskPriority[] = ["critical", "high", "medium", "low"];
export const PRIORITY_META: Record<TaskPriority, { label: string; color: string }> = {
  critical: { label: "Критический", color: "#E11D48" },
  high: { label: "Высокий", color: "#F59E0B" },
  medium: { label: "Средний", color: "#0EA5E9" },
  low: { label: "Низкий", color: "#979EAA" },
};

/** Вариант статуса для меню в строке: свой статус компании или базовый. */
export type StatusOption = { key: string; label: string; color: string; category: TaskStatus } & TaskChange;

function baseOption(s: TaskStatus): StatusOption {
  return {
    key: `st:${s}`,
    label: STATUS_LABEL[s],
    color: BASE_STATUS_COLOR[s],
    category: s,
    body: { status: s },
    optimistic: { status: s, custom_status_id: null },
  };
}

/** Свои статусы компании по порядку + базовые для категорий, где своего статуса нет. */
export function statusOptions(defs: TaskStatusDef[]): StatusOption[] {
  if (defs.length) {
    const custom: StatusOption[] = [...defs]
      .sort((a, b) => a.order_index - b.order_index || a.id - b.id)
      .map((d) => ({
        key: `cs:${d.id}`,
        label: d.label,
        color: d.color,
        category: d.category,
        body: { custom_status_id: d.id },
        optimistic: { custom_status_id: d.id, status: d.category },
      }));
    const covered = new Set(defs.map((d) => d.category));
    return [...custom, ...BASE_STATUS_ORDER.filter((s) => !covered.has(s)).map(baseOption)];
  }
  return BASE_STATUS_ORDER.map(baseOption);
}

/** Ключ статуса задачи: свой статус, иначе статус по умолчанию той же категории, иначе базовый. */
export function statusKeyOf(t: TaskListItem, defs: TaskStatusDef[]): string {
  if (!defs.length) return `st:${t.status}`;
  if (t.custom_status_id && defs.some((d) => d.id === t.custom_status_id)) return `cs:${t.custom_status_id}`;
  const same = defs.filter((d) => d.category === t.status);
  const pick = same.find((d) => d.is_default) ?? [...same].sort((a, b) => a.order_index - b.order_index)[0];
  return pick ? `cs:${pick.id}` : `st:${t.status}`;
}

const isClosed = (s: TaskStatus) => s === "done" || s === "cancelled";

function dayDiff(iso: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso).setHours(0, 0, 0, 0) - today.getTime()) / 86400000);
}

function inDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return endOfDayISO(d);
}

export type GroupCtx = {
  tasks: TaskListItem[];
  defs: TaskStatusDef[];
  projects: Project[];
  perms: { update: boolean; status: boolean; assign: boolean; priority: boolean };
};

/** Группы в порядке показа + функция «к какой группе относится задача». */
export function buildGroups(by: GroupBy, ctx: GroupCtx): { groups: TaskGroup[]; keyOf: (t: TaskListItem) => string } {
  const { tasks, defs, projects, perms } = ctx;

  if (by === "assignee") {
    const users = new Map<number, UserBrief>();
    tasks.forEach((t) => t.assignee && users.set(t.assignee.id, t.assignee));
    const groups: TaskGroup[] = [...users.values()]
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((u) => ({
        key: `as:${u.id}`,
        label: u.name,
        user: u,
        accepts: perms.assign,
        drop: () => ({ body: { assignee_id: u.id }, optimistic: { assignee: u } }),
        create: { assignee_id: u.id },
      }));
    groups.push({
      key: "as:none",
      label: "Без исполнителя",
      user: null,
      accepts: perms.assign,
      drop: () => ({ body: { assignee_id: null }, optimistic: { assignee: null } }),
    });
    return { groups, keyOf: (t) => (t.assignee ? `as:${t.assignee.id}` : "as:none") };
  }

  if (by === "priority") {
    return {
      groups: PRIORITY_ORDER.map((p) => ({
        key: `pr:${p}`,
        label: PRIORITY_META[p].label,
        color: PRIORITY_META[p].color,
        accepts: perms.priority,
        drop: () => ({ body: { priority: p }, optimistic: { priority: p } }),
        create: { priority: p },
      })),
      keyOf: (t) => `pr:${t.priority}`,
    };
  }

  if (by === "project") {
    const ids = [...new Set(tasks.map((t) => t.project_id).filter((x): x is number => !!x))];
    const byId = new Map(projects.map((p) => [p.id, p]));
    const groups: TaskGroup[] = ids
      .map((id) => ({ id, p: byId.get(id) }))
      .sort((a, b) => (a.p?.name ?? "").localeCompare(b.p?.name ?? "", "ru"))
      .map(({ id, p }) => ({
        key: `pj:${id}`,
        label: p?.name ?? `Проект #${id}`,
        color: p?.color || "#4C5462",
        accepts: perms.update,
        drop: () => ({ body: { project_id: id }, optimistic: { project_id: id } }),
        create: { project_id: id },
      }));
    groups.push({
      key: "pj:none",
      label: "Без проекта",
      color: "#979EAA",
      accepts: perms.update,
      drop: () => ({ body: { project_id: null }, optimistic: { project_id: null } }),
      create: { project_id: null },
    });
    return { groups, keyOf: (t) => (t.project_id ? `pj:${t.project_id}` : "pj:none") };
  }

  if (by === "due") {
    const setDue = (iso: string | null) => () => ({ body: { deadline: iso }, optimistic: { deadline: iso } });
    const groups: TaskGroup[] = [
      { key: "due:overdue", label: "Просрочено", color: "#E11D48", accepts: false },
      { key: "due:today", label: "Сегодня", color: "#F59E0B", accepts: perms.update, drop: setDue(inDays(0)), create: { deadline: inDays(0) } },
      { key: "due:tomorrow", label: "Завтра", color: "#0284C7", accepts: perms.update, drop: setDue(inDays(1)), create: { deadline: inDays(1) } },
      { key: "due:week", label: "На этой неделе", color: "#4F46E5", accepts: false },
      { key: "due:later", label: "Позже", color: "#4C5462", accepts: false },
      { key: "due:none", label: "Без срока", color: "#979EAA", accepts: perms.update, drop: setDue(null) },
      { key: "due:past", label: "Завершённые в прошлом", color: "#979EAA", accepts: false, collapsedByDefault: true },
    ];
    const daysToSunday = (7 - new Date().getDay()) % 7;
    return {
      groups,
      keyOf: (t) => {
        if (!t.deadline) return "due:none";
        const d = dayDiff(t.deadline);
        if (d < 0) return isClosed(t.status) ? "due:past" : "due:overdue";
        if (d === 0) return "due:today";
        if (d === 1) return "due:tomorrow";
        if (d <= daysToSunday) return "due:week";
        return "due:later";
      },
    };
  }

  // status
  const opts = statusOptions(defs);
  const groups: TaskGroup[] = opts.map((o) => ({
    key: o.key,
    label: o.label,
    color: o.color,
    accepts: perms.status,
    drop: () => ({ body: o.body, optimistic: o.optimistic }),
    create: o.body,
    collapsedByDefault: o.category === "cancelled",
  }));
  return { groups, keyOf: (t) => statusKeyOf(t, defs) };
}
