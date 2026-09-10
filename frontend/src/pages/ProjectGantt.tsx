import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Gantt from "frappe-gantt";
import "frappe-gantt/dist/frappe-gantt.css";
import { api } from "@/api/client";
import type { TaskListItem, Project, Page } from "@/types";
import { EmptyState } from "@/components/ui";
import { CalendarClock, ArrowLeft } from "lucide-react";

type ViewMode = "Day" | "Week" | "Month";

export default function ProjectGanttPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ganttRef = useRef<any>(null);
  const [view, setView] = useState<ViewMode>("Week");

  const projectId = id ? Number(id) : null;

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => (await api.get<Project>(`/api/projects/${projectId}`)).data,
    enabled: !!projectId,
  });

  const { data: tasks, isPending } = useQuery({
    queryKey: ["project-tasks-gantt", projectId],
    queryFn: async () =>
      (await api.get<Page<TaskListItem>>("/api/tasks", { params: { project_id: projectId, per_page: 500 } })).data.items,
    enabled: !!projectId,
  });

  useEffect(() => {
    if (!containerRef.current || !tasks) return;

    // frappe-gantt требует start/end. У задачи есть только deadline —
    // используем: start = created_at, end = deadline. Если deadline нет — end = start + 1d.
    const items = tasks
      .filter((t) => t.deadline || t.created_at)
      .map((t) => {
        const startISO = t.created_at ? new Date(t.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
        const endBase = t.deadline ? new Date(t.deadline) : new Date(new Date(startISO).getTime() + 24 * 60 * 60 * 1000);
        const endISO = endBase.toISOString().slice(0, 10);
        const progress = t.status === "done" ? 100 : t.status === "review" ? 75 : t.status === "in_progress" ? 50 : t.status === "cancelled" ? 0 : 10;
        return {
          id: String(t.id),
          name: t.title,
          start: startISO,
          end: endISO,
          progress,
          custom_class: t.status === "done" ? "bar-done" : t.status === "cancelled" ? "bar-cancelled" : "bar-active",
        };
      });

    if (items.length === 0) return;

    containerRef.current.innerHTML = "";
    const gantt = new (Gantt as any)(containerRef.current, items, {
      view_mode: view,
      language: "ru",
      on_click: (task: any) => navigate(`/tasks/${task.id}`),
      readonly: true,
      bar_height: 22,
      padding: 16,
    });
    ganttRef.current = gantt;
  }, [tasks, view, navigate]);

  if (!projectId) {
    return <EmptyState icon={<CalendarClock size={32} />} title="Проект не выбран" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to={`/projects/${projectId}`} className="mb-1 inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-brand-600">
            <ArrowLeft size={12} /> К проекту
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Диаграмма Ганта</h1>
          <p className="text-sm text-neutral-500">{project?.name || `Проект #${projectId}`}</p>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
          {(["Day", "Week", "Month"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={
                view === v
                  ? "bg-brand-500 px-3 py-1.5 text-xs font-medium text-white"
                  : "px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-800/50"
              }
            >
              {v === "Day" ? "День" : v === "Week" ? "Неделя" : "Месяц"}
            </button>
          ))}
        </div>
      </div>

      {isPending ? (
        <div className="h-96 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />
      ) : !tasks || tasks.length === 0 ? (
        <EmptyState icon={<CalendarClock size={32} />} title="Задач в проекте нет" description="Создайте задачи с дедлайнами, чтобы увидеть диаграмму" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/50">
          <div ref={containerRef} />
        </div>
      )}

      <style>{`
        .bar-done .bar { fill: #10B981 !important; }
        .bar-cancelled .bar { fill: #9CA3AF !important; }
        .bar-active .bar { fill: #7C5CFF !important; }
      `}</style>
    </div>
  );
}
