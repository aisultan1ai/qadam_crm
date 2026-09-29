import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import Gantt from "frappe-gantt";
// @ts-ignore no types for CSS side-effect import in 0.8.1
import "frappe-gantt/dist/frappe-gantt.css";
import type { TaskListItem } from "@/types";
import { EmptyState } from "@/components/ui";
import { CalendarClock } from "lucide-react";

import { Segmented } from "@/components/page";
type ViewMode = "Day" | "Week" | "Month";

/** Старый адрес /projects/:id/gantt → вкладка «Ганта» на странице проекта. */
export default function ProjectGanttPage() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/projects/${id}?view=gantt`} replace />;
}

function localDay(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Диаграмма Ганта по задачам: начало = дата начала (или создания), конец = срок (или +1 день). */
export function GanttView({ tasks, onOpen }: { tasks: TaskListItem[]; onOpen?: (id: number) => void }) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<ViewMode>("Week");

  useEffect(() => {
    if (!containerRef.current || tasks.length === 0) return;
    const items = tasks.map((t) => {
      const start = new Date(t.start_date || t.created_at);
      let end = t.deadline ? new Date(t.deadline) : new Date(start.getTime() + 86_400_000);
      if (end < start) end = start;
      const progress = t.status === "done" ? 100 : t.status === "review" ? 75 : t.status === "in_progress" ? 50 : t.status === "cancelled" ? 0 : 10;
      return {
        id: String(t.id),
        name: t.title,
        start: localDay(start),
        end: localDay(end),
        progress,
        custom_class: t.status === "done" ? "bar-done" : t.status === "cancelled" ? "bar-cancelled" : "bar-active",
      };
    });
    containerRef.current.innerHTML = "";
    new (Gantt as any)(containerRef.current, items, {
      view_mode: view,
      language: "ru",
      on_click: (task: any) => (onOpen ? onOpen(Number(task.id)) : navigate(`/tasks/${task.id}`)),
      readonly: true,
      bar_height: 22,
      padding: 16,
    });
  }, [tasks, view, navigate, onOpen]);

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock size={32} />}
        title="Задач в проекте нет"
        description="Создайте задачи со сроками, чтобы увидеть диаграмму"
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Segmented
          label="Масштаб"
          value={view}
          onChange={setView}
          items={[
            { key: "Day", label: "День" },
            { key: "Week", label: "Неделя" },
            { key: "Month", label: "Месяц" },
          ]}
        />
      </div>
      <div className="card overflow-x-auto p-3">
        <div ref={containerRef} />
      </div>
      <style>{`
        .bar-done .bar { fill: #10B981 !important; }
        .bar-cancelled .bar { fill: #9CA3AF !important; }
        .bar-active .bar { fill: rgb(var(--brand-600)) !important; }
      `}</style>
    </div>
  );
}
