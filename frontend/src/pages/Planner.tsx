import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Calendar as BigCalendar, dateFnsLocalizer, Views } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { ru } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import clsx from "clsx";
import { CalendarClock, ListTodo, Inbox as InboxIcon, LayoutGrid, Table as TableIcon } from "lucide-react";
import { api } from "@/api/client";
import { useAuth } from "@/store/auth";
import type { TaskListItem, Page } from "@/types";
import { STATUS_LABEL, STATUS_ORDER } from "@/types";
import { EmptyState } from "@/components/ui";
import { PriorityChip, StatusChip } from "@/components/ui";

import { Tabs } from "@/components/page";
type TabKey = "my_tasks" | "my_schedule" | "table_all" | "assigned_by_me" | "kanban_all";

const TABS: { key: TabKey; label: string; icon: typeof CalendarClock }[] = [
  { key: "my_tasks", label: "Мои задачи", icon: ListTodo },
  { key: "my_schedule", label: "Моё расписание", icon: CalendarClock },
  { key: "table_all", label: "Таблица", icon: TableIcon },
  { key: "assigned_by_me", label: "Я поставил", icon: InboxIcon },
  { key: "kanban_all", label: "Все задачи", icon: LayoutGrid },
];

const locales = { ru };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d: Date) => startOfWeek(d, { weekStartsOn: 1 }),
  getDay,
  locales,
});

export default function Planner() {
  const [sp, setSp] = useSearchParams();
  const rawTab = sp.get("tab") as TabKey | null;
  const activeTab: TabKey = rawTab && TABS.some((t) => t.key === rawTab) ? rawTab : "my_tasks";

  const setTab = (key: TabKey) => {
    const next = new URLSearchParams(sp);
    if (key === "my_tasks") next.delete("tab");
    else next.set("tab", key);
    setSp(next, { replace: true });
  };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Планировщик</h1>
        <p className="page-subtitle">Личная лента задач и недельное расписание</p>
      </div>

      <Tabs label="Разделы планировщика" value={activeTab} onChange={setTab} items={TABS} />

      {activeTab === "my_tasks" && <TasksKanban scope="incoming" />}
      {activeTab === "my_schedule" && <MySchedule />}
      {activeTab === "table_all" && <TasksTable />}
      {activeTab === "assigned_by_me" && <TasksKanban scope="outgoing" />}
      {activeTab === "kanban_all" && <TasksKanban scope="all" />}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Table view — плоская таблица моих задач с сортировкой по deadline
// ----------------------------------------------------------------------------

function TasksTable() {
  const { data, isPending } = useQuery({
    queryKey: ["planner-table-tasks"],
    queryFn: async () =>
      (
        await api.get<Page<TaskListItem>>("/api/tasks", {
          params: { scope: "incoming", per_page: 500 },
        })
      ).data.items,
  });

  if (isPending) {
    return <div className="h-64 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />;
  }
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<ListTodo size={32} />}
        title="Задач нет"
        description="Как только вам назначат задачу — она появится в таблице"
      />
    );
  }

  const sorted = [...data].sort((a, b) => {
    const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    return ad - bd;
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
      <table className="w-full">
        <thead className="table-head">
          <tr>
            <th className="table-head-cell">Название</th>
            <th className="table-head-cell">Статус</th>
            <th className="table-head-cell">Приоритет</th>
            <th className="table-head-cell">Дедлайн</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr key={t.id} className="table-row">
              <td className="table-cell">
                <Link to={`/tasks/${t.id}`} className="font-medium hover:text-brand-700 dark:hover:text-brand-300">
                  {t.title}
                </Link>
              </td>
              <td className="table-cell">
                <StatusChip status={t.status} />
              </td>
              <td className="table-cell">
                <PriorityChip priority={t.priority} />
              </td>
              <td className="table-cell text-xs text-neutral-500 tabular-nums">
                {t.deadline ? new Date(t.deadline).toLocaleDateString("ru-RU") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Простая kanban-доска без DnD (для скорости). Клик на карточку → /tasks/:id.
// ----------------------------------------------------------------------------

function TasksKanban({ scope }: { scope: "incoming" | "outgoing" | "all" }) {
  const { data, isPending } = useQuery({
    queryKey: ["planner-tasks", scope],
    queryFn: async () =>
      (
        await api.get<Page<TaskListItem>>("/api/tasks", {
          params: { scope: scope === "all" ? undefined : scope, per_page: 200 },
        })
      ).data.items,
  });

  const grouped = useMemo(() => {
    const map: Record<string, TaskListItem[]> = {};
    STATUS_ORDER.forEach((s) => (map[s] = []));
    (data || []).forEach((t) => {
      (map[t.status] ||= []).push(t);
    });
    return map;
  }, [data]);

  if (isPending) {
    return (
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {STATUS_ORDER.map((s) => (
          <div key={s} className="h-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<ListTodo size={32} />}
        title="Задач пока нет"
        description={
          scope === "incoming"
            ? "Как только вам назначат задачу — она появится здесь."
            : scope === "outgoing"
            ? "Задачи, которые вы поставили другим, будут собраны в этой ленте."
            : "В компании пока нет задач."
        }
      />
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
      {STATUS_ORDER.map((status) => {
        const items = grouped[status] || [];
        return (
          <div
            key={status}
            className="flex min-h-[140px] flex-col rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/50"
          >
            <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-400">
                {STATUS_LABEL[status]}
              </span>
              <span className="text-xs font-medium text-neutral-500">{items.length}</span>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-2">
              {items.map((t) => (
                <Link
                  key={t.id}
                  to={`/tasks/${t.id}`}
                  className="group block rounded-md border border-neutral-200 bg-white p-2.5 text-sm shadow-sm transition-shadow hover:shadow-md dark:border-neutral-800 dark:bg-neutral-800/70"
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div className="line-clamp-2 font-medium group-hover:text-brand-700 dark:group-hover:text-brand-300">
                      {t.title}
                    </div>
                    <PriorityChip priority={t.priority} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-neutral-500">
                    <StatusChip status={t.status} />
                    {t.deadline && (
                      <span className="tabular-nums">
                        {new Date(t.deadline).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
              {items.length === 0 && (
                <div className="py-3 text-center text-xs text-neutral-400">Пусто</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Недельная сетка часов: собственные назначенные задачи с deadline + события.
// ----------------------------------------------------------------------------

type ScheduleEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  taskId?: number;
  eventId?: number;
  color?: string;
};

function MySchedule() {
  const { me } = useAuth();
  const [date, setDate] = useState(new Date());

  // Задачи с дедлайном (я исполнитель).
  const { data: tasks } = useQuery({
    queryKey: ["planner-schedule-tasks", me?.id],
    queryFn: async () =>
      (
        await api.get<Page<TaskListItem>>("/api/tasks", {
          params: { scope: "incoming", per_page: 500 },
        })
      ).data.items,
  });

  const events: ScheduleEvent[] = useMemo(() => {
    const out: ScheduleEvent[] = [];
    (tasks || []).forEach((t) => {
      if (!t.deadline) return;
      const start = new Date(t.deadline);
      const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 час дефолт
      out.push({
        id: `task-${t.id}`,
        taskId: t.id,
        title: t.title,
        start,
        end,
        color: t.status === "done" ? "#10B981" : t.status === "in_progress" ? "#3B82F6" : "#2A52C4",
      });
    });
    return out;
  }, [tasks]);

  return (
    <div className="card p-3">
      <BigCalendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        defaultView={Views.WEEK}
        views={[Views.WEEK, Views.DAY, Views.AGENDA]}
        date={date}
        onNavigate={(d) => setDate(d)}
        style={{ height: "70vh" }}
        culture="ru"
        step={30}
        timeslots={2}
        min={new Date(1970, 0, 1, 8, 0, 0)}
        max={new Date(1970, 0, 1, 20, 0, 0)}
        eventPropGetter={(event) => {
          const e = event as ScheduleEvent;
          return {
            style: {
              backgroundColor: e.color || "#2A52C4",
              border: "none",
              color: "white",
              fontSize: "12px",
            },
          };
        }}
        onSelectEvent={(event) => {
          const e = event as ScheduleEvent;
          if (e.taskId) window.location.href = `/tasks/${e.taskId}`;
        }}
        messages={{
          week: "Неделя",
          day: "День",
          agenda: "Повестка",
          today: "Сегодня",
          previous: "Назад",
          next: "Вперёд",
          noEventsInRange: "На этой неделе задач с дедлайном нет",
        }}
      />
    </div>
  );
}
