import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Project, TaskListItem, Page, User } from "@/types";
import { Loader, Avatar, StatusChip, PriorityChip, EmptyState } from "@/components/ui";
import { DetailLayout, PageHeader, Panel, PropertyList, PropertyRow } from "@/components/page";
import { Button } from "@/components/lib/Button";
import { Calendar, Plus, ListTodo, CheckCircle2, AlertTriangle, MessageSquare, GanttChart, Users } from "lucide-react";
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
      <PageHeader
        back={{ to: "/projects", label: "Проекты" }}
        title={
          <>
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: project.color || "#2A52C4" }} />
            {project.name}
          </>
        }
        subtitle={project.description || "Без описания"}
        actions={
          <>
            {projectChannel && (
              <Button variant="secondary" onClick={() => nav(`/messenger/${projectChannel.id}`)}>
                <MessageSquare size={15} /> Чат проекта
              </Button>
            )}
            <Link to={`/projects/${projectId}/gantt`} className="btn-secondary">
              <GanttChart size={15} /> Диаграмма Ганта
            </Link>
            {canCreate && (
              <Button variant="primary" onClick={() => setOpenNew(true)}>
                <Plus size={15} /> Новая задача
              </Button>
            )}
          </>
        }
      />

      <DetailLayout
        main={
          <Panel title="Задачи проекта" flush actions={<span className="text-xs tabular-nums text-zinc-500">{stats.total}</span>}>
            {isLoading ? (
              <Loader />
            ) : !tasks || tasks.length === 0 ? (
              <EmptyState
                icon={<ListTodo size={20} />}
                title="Задач пока нет"
                description="Создайте первую задачу — она появится здесь и на канбан-доске."
                action={
                  canCreate ? (
                    <Button variant="primary" onClick={() => setOpenNew(true)}>
                      <Plus size={15} /> Новая задача
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="table-scroll">
                <table className="w-full min-w-[640px]" aria-label={`Задачи проекта «${project.name}»`}>
                  <thead className="table-head">
                    <tr>
                      <th className="table-head-cell">Задача</th>
                      <th className="table-head-cell">Статус</th>
                      <th className="table-head-cell">Приоритет</th>
                      <th className="table-head-cell">Исполнитель</th>
                      <th className="table-head-cell">Срок</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t) => (
                      <tr
                        key={t.id}
                        className="table-row cursor-pointer"
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
                        <td className="table-cell font-medium text-zinc-900 dark:text-zinc-100">{t.title}</td>
                        <td className="table-cell"><StatusChip status={t.status} /></td>
                        <td className="table-cell"><PriorityChip priority={t.priority} /></td>
                        <td className="table-cell">
                          {t.assignee ? (
                            <div className="flex items-center gap-2">
                              <Avatar name={t.assignee.name} size={22} url={t.assignee.avatar_url} />
                              {t.assignee.name}
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="table-cell tabular-nums text-zinc-500">
                          {t.deadline ? new Date(t.deadline).toLocaleDateString("ru-RU") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        }
        aside={
          <PropertyList>
            <PropertyRow icon={Calendar} label="Срок">
              {project.deadline ? new Date(project.deadline).toLocaleDateString("ru-RU") : <span className="text-zinc-500">Не задан</span>}
            </PropertyRow>
            <PropertyRow icon={Users} label="Участники">
              {project.members.length === 0 ? (
                <span className="text-zinc-500">Нет</span>
              ) : (
                <div className="flex -space-x-1.5">
                  {project.members.map((m) => (
                    <span key={m.id} className="rounded-full ring-2 ring-white dark:ring-[#14171C]" title={m.name}>
                      <Avatar name={m.name} size={24} url={m.avatar_url} />
                    </span>
                  ))}
                </div>
              )}
            </PropertyRow>
            <div className="my-2 h-px bg-zinc-100 dark:bg-zinc-800" />
            <PropertyRow icon={ListTodo} label="Всего задач">
              <span className="font-medium tabular-nums">{stats.total}</span>
            </PropertyRow>
            <PropertyRow icon={CheckCircle2} label="Завершено">
              <span className="font-medium tabular-nums text-emerald-700 dark:text-emerald-400">{stats.done}</span>
            </PropertyRow>
            <PropertyRow icon={AlertTriangle} label="Просрочено">
              <span className={stats.overdue > 0 ? "font-medium tabular-nums text-rose-600 dark:text-rose-400" : "tabular-nums text-zinc-500"}>
                {stats.overdue}
              </span>
            </PropertyRow>
            {stats.total > 0 && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-[#1B1F26]">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.round((stats.done / stats.total) * 100)}%` }} />
              </div>
            )}
          </PropertyList>
        }
      />

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
