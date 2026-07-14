import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Link } from "react-router-dom";
import { Plus, Archive, ArchiveRestore, Trash2, Search } from "lucide-react";
import type { Project, UserBrief } from "@/types";
import { useAuth } from "@/store/auth";
import { Modal, Avatar, Loader, EmptyState } from "@/components/ui";

export default function Projects() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [openNew, setOpenNew] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["projects", q, showArchived],
    queryFn: async () =>
      (await api.get<Project[]>("/api/projects", { params: { q: q || undefined, archived: showArchived } })).data,
  });

  const archive = useMutation({
    mutationFn: (id: number) => api.post(`/api/projects/${id}/archive`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/projects/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Проекты</h1>
          <p className="text-sm text-neutral-500">{data?.length ?? 0} проектов</p>
        </div>
        {can("projects.create") && (
          <button className="btn-primary" onClick={() => setOpenNew(true)}>
            <Plus size={16} /> Новый проект
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={15} className="absolute left-3 top-2.5 text-neutral-400" />
          <input className="input pl-8" placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Архивные
        </label>
      </div>

      {isLoading ? (
        <Loader />
      ) : !data || data.length === 0 ? (
        <EmptyState title="Проектов пока нет" description="Создайте первый проект, чтобы начать" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => (
            <div key={p.id} className="card group flex flex-col p-5 transition-all hover:-translate-y-0.5 hover:shadow-md">
              <div className="mb-2 flex items-start justify-between">
                <Link to={`/projects/${p.id}`} className="text-base font-semibold hover:text-brand-600">
                  <span
                    className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                    style={{ background: p.color || "#6366f1" }}
                  />
                  {p.name}
                </Link>
                <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                  {can("projects.archive") && (
                    <button className="btn-ghost !p-1.5" title={p.is_archived ? "Вернуть" : "Архивировать"} onClick={() => archive.mutate(p.id)}>
                      {p.is_archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                    </button>
                  )}
                  {can("projects.delete") && (
                    <button className="btn-ghost !p-1.5 text-rose-500" title="Удалить" onClick={() => confirm("Удалить проект?") && del.mutate(p.id)}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
              <p className="mb-4 line-clamp-2 min-h-[2.5rem] text-sm text-neutral-500">{p.description || "—"}</p>
              <div className="mt-auto flex items-center justify-between">
                <MembersRow members={p.members} />
                <span className="text-xs text-neutral-500">{p.tasks_count} задач</span>
              </div>
              {p.is_archived && (
                <span className="mt-3 self-start chip bg-neutral-100 text-neutral-500 dark:bg-neutral-800">архив</span>
              )}
            </div>
          ))}
        </div>
      )}

      {openNew && <ProjectFormModal onClose={() => setOpenNew(false)} />}
    </div>
  );
}

function MembersRow({ members }: { members: UserBrief[] }) {
  return (
    <div className="flex -space-x-2">
      {members.slice(0, 4).map((m) => (
        <div key={m.id} className="rounded-full ring-2 ring-white dark:ring-neutral-900">
          <Avatar name={m.name} size={24} />
        </div>
      ))}
      {members.length > 4 && (
        <div className="grid h-6 w-6 place-items-center rounded-full bg-neutral-100 text-[10px] font-medium ring-2 ring-white dark:bg-neutral-800 dark:ring-neutral-900">
          +{members.length - 4}
        </div>
      )}
    </div>
  );
}

function ProjectFormModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [deadline, setDeadline] = useState("");
  const [memberIds, setMemberIds] = useState<number[]>([]);

  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await api.get<any[]>("/api/users")).data,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/projects", {
        name,
        description: description || null,
        color,
        deadline: deadline || null,
        member_ids: memberIds,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title="Новый проект" size="md">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Описание</span>
          <textarea className="input min-h-[90px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Цвет</span>
            <input type="color" className="h-10 w-full rounded-lg border border-neutral-200 dark:border-neutral-800" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Дедлайн</span>
            <input type="date" className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Участники</span>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
            {users?.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800">
                <input
                  type="checkbox"
                  checked={memberIds.includes(u.id)}
                  onChange={(e) =>
                    setMemberIds((v) => (e.target.checked ? [...v, u.id] : v.filter((x) => x !== u.id)))
                  }
                />
                <Avatar name={u.name} size={22} />
                <span className="text-sm">{u.name}</span>
                <span className="text-xs text-neutral-500">{u.email}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-primary" disabled={!name || create.isPending} onClick={() => create.mutate()}>
            Создать
          </button>
        </div>
      </div>
    </Modal>
  );
}
