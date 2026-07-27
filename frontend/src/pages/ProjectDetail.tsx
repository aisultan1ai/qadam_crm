import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Project, TaskListItem, Page, User } from "@/types";
import { Loader, Avatar, StatusChip, PriorityChip } from "@/components/ui";
import { ArrowLeft, Calendar, Plus } from "lucide-react";
import { useAuth } from "@/store/auth";
import { TaskFormModal } from "./Tasks";

export default function ProjectDetail() {
  const { id } = useParams();
  const projectId = Number(id);
  const { can } = useAuth();
  const [openNew, setOpenNew] = useState(false);
  const canCreate = can("tasks.create");

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
              style={{ background: project.color || "#6366f1" }}
            />
            {project.name}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">{project.description || "Без описания"}</p>
        </div>
        <div className="flex items-center gap-4">
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
