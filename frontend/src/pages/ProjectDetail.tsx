import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Project, TaskListItem, Page, User } from "@/types";
import { Loader, Avatar, StatusChip, PriorityChip } from "@/components/ui";
import { ArrowLeft, Calendar, Plus, ListTodo, CheckCircle2, AlertTriangle, MessageSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/store/auth";
import { TaskFormModal } from "./Tasks";

type ProjectChannelInfo = { id: number; kind: string; project_id: number | null };

export default function ProjectDetail() {
  const { id } = useParams();
  const projectId = Number(id);
  const { can } = useAuth();
  const nav = useNavigate();
  const [openNew, setOpenNew] = useState(false);
  const canCreate = can("tasks.create");

  const { data: channels } = useQuery({
    enabled: can("messenger.use"),
    queryKey: ["messenger", "channels"],
    queryFn: async () => (await api.get<ProjectChannelInfo[]>("/api/messenger/channels")).data,
  });
  const projectChannel = (channels || []).find((c) => c.kind === "project" && c.project_id === projectId);

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => (await api.get<Project>(`/api/projects/${projectId}`)).data,
    refetchOnMount: "always",
    staleTime: 0,
  });
  const { data: tasks, isLoading } = useQuery({
    queryKey: ["project-tasks", projectId],
    queryFn: async () => (await api.get<Page<TaskListItem>>(`/api/tasks`, { params: { project_id: projectId } })).data.items,
    refetchOnMount: "always",
    staleTime: 0,
  });
  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await api.get<Page<User>>("/api/users")).data.items,
    enabled: openNew,
  });

  const stats = useMemo(() => {
    const list = tasks ?? [];
    const now = Date.now();
    let done = 0;
    let overdue = 0;
    for (const t of list) {
      if (t.status === "done") done += 1;
      if (
        t.deadline &&
        t.status !== "done" &&
        t.status !== "cancelled" &&
        new Date(t.deadline).getTime() < now
      ) {
        overdue += 1;
      }
    }
    return { total: list.length, done, overdue };
  }, [tasks]);

  if (!project) return <Loader />;

  return (
    <div className="space-y-5">
      <Link to="/projects" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
        <ArrowLeft size={14} /> Проекты
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <span
              className="mr-2 inline-block h-3 w-3 rounded-full align-middle"
              style={{ background: project.color || "#0F67FD" }}
            />
            {project.name}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">{project.description || "Без описания"}</p>
        </div>
        <div className="flex items-center gap-3">
          {projectChannel && (
            <button
              type="button"
              onClick={() => nav(`/messenger/${projectChannel.id}`)}
              className="btn-ghost inline-flex items-center gap-1.5"
              title="Открыть чат проекта"
            >
              <MessageSquare size={14} /> Чат
            </button>
          )}
          {project.deadline && (
            <div className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-300">
              <Calendar size={14} /> {new Date(project.deadline).toLocaleDateString("ru-RU")}
            </div>
          )}
          <div className="flex -space-x-2">
            {project.members.map((m) => (
              <div key={m.id} className="ring-2 ring-white rounded-full dark:ring-neutral-900">
                <Avatar name={m.name} size={26} url={m.avatar_url} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {!isLoading && tasks && tasks.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <MiniStat icon={<ListTodo size={16} />} label="Всего" value={stats.total} />
          <MiniStat
            icon={<CheckCircle2 size={16} />}
            label="Завершено"
            value={stats.done}
            accent="text-emerald-600 dark:text-emerald-400"
          />
          <MiniStat
            icon={<AlertTriangle size={16} />}
            label="Просрочено"
            value={stats.overdue}
            accent={stats.overdue > 0 ? "text-rose-600 dark:text-rose-400" : undefined}
          />
        </div>
      )}

      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3 dark:border-neutral-800">
          <h2 className="text-sm font-semibold">Задачи проекта</h2>
          {canCreate && (
            <button className="btn-primary !py-1.5 !px-3 text-xs" onClick={() => setOpenNew(true)}>
              <Plus size={14} /> Новая задача
            </button>
          )}
        </div>
        {isLoading ? (
          <Loader />
        ) : !tasks || tasks.length === 0 ? (
          <div className="py-10 text-center text-sm text-neutral-500">Задач пока нет</div>
        ) : (
          <table className="w-full min-w-[720px] text-sm" aria-label={`Задачи проекта «${project.name}»`}>
            <caption className="sr-only">Задачи проекта {project.name}: название, статус, приоритет, исполнитель, дедлайн.</caption>
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
                <tr
                  key={t.id}
                  className="table-row cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                  onClick={() => nav(`/tasks/${t.id}`)}
                  role="link"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      nav(`/tasks/${t.id}`);
                    }
                  }}
                >
                  <td className="px-5 py-3">
                    <span className="font-medium">{t.title}</span>
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
        )}
      </div>

      {openNew && (
        <TaskFormModal
          projects={[project]}
          users={users ?? []}
          defaultProjectId={projectId}
          onClose={() => setOpenNew(false)}
        />
      )}
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="card p-3 sm:p-4">
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <span className={accent}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${accent ?? ""}`}>{value}</div>
    </div>
  );
}
