import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, extractApiError } from "@/api/client";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Archive, ArchiveRestore, Trash2, Search, FolderKanban } from "lucide-react";
import clsx from "clsx";
import type { Project, UserBrief, Page, User } from "@/types";
import { useAuth } from "@/store/auth";
import { Modal, Avatar, EmptyState, FieldError, FormError } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { SkeletonTable } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { projectSchema, type ProjectForm } from "@/lib/validation";

import { SearchInput } from "@/components/page";
import { useNewParam } from "@/hooks/useNewParam";
type ProjectScope = "all" | "participating" | "made_by_me" | "audited_by_me";

// Область задаёт панель модуля (?scope=…); заголовок страницы — по ней.
const SCOPE_TITLE: Record<ProjectScope, string> = {
  all: "Все проекты",
  participating: "Я участвую",
  made_by_me: "Созданы мной",
  audited_by_me: "Наблюдаю",
};

export default function Projects() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [openNew, setOpenNew] = useState(false);
  useNewParam(() => setOpenNew(true), can("projects.create"));
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const rawScope = sp.get("scope") as ProjectScope | null;
  const scope: ProjectScope = rawScope && rawScope in SCOPE_TITLE ? rawScope : "all";

  const { data, isPending } = useQuery({
    queryKey: ["projects", q, showArchived, scope],
    queryFn: async () =>
      (await api.get<Page<Project>>("/api/projects", {
        params: { q: q || undefined, archived: showArchived, scope: scope === "all" ? undefined : scope },
      })).data.items,
  });

  const archive = useMutation({
    mutationFn: (id: number) => api.post(`/api/projects/${id}/archive`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
    onError: (e) => toast.error("Не удалось изменить архив", extractApiError(e).message),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/projects/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Проект удалён");
    },
    onError: (e) => toast.error("Не удалось удалить проект", extractApiError(e).message),
  });

  const canCreate = can("projects.create");

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div className="min-w-0">
          <div className="mb-0.5 text-[12px] text-zinc-500">Проекты</div>
          <h1 className="page-title flex items-baseline gap-2">
            {SCOPE_TITLE[scope]}
            <span className="text-[13px] font-medium tabular-nums text-zinc-400">{data?.length ?? 0}</span>
          </h1>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setOpenNew(true)}>
            <Plus size={15} /> Новый проект
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Поиск проекта" />
        <label className="flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-[13px] text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5">
          <input type="checkbox" className="accent-brand-600" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Показать архивные
        </label>
      </div>

      {isPending ? (
        <SkeletonTable />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={<FolderKanban size={32} />}
          title={q ? "По запросу ничего не найдено" : "Проектов пока нет"}
          description={q ? "Попробуйте другой запрос или сбросьте поиск" : "Создайте первый проект, чтобы начать работу"}
          action={q ? (
            <Button variant="secondary" onClick={() => setQ("")}>
              Сбросить поиск
            </Button>
          ) : canCreate ? (
            <Button variant="primary" onClick={() => setOpenNew(true)}>
              <Plus size={16} /> Новый проект
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="table-container">
          <div className="table-scroll">
            <table className="w-full min-w-[760px]" aria-label="Проекты">
              <thead className="table-head">
                <tr>
                  <th className="table-head-cell">Проект</th>
                  <th className="table-head-cell w-44">Руководитель</th>
                  <th className="table-head-cell w-36">Участники</th>
                  <th className="table-head-cell w-24 text-right">Задачи</th>
                  <th className="table-head-cell w-28">Статус</th>
                  <th className="table-head-cell w-20" />
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id} className="table-row group cursor-pointer" onClick={() => nav(`/projects/${p.id}`)}>
                    <td className="table-cell">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          aria-hidden
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold uppercase text-white"
                          style={{ background: p.color || "rgb(var(--brand-600))" }}
                        >
                          {p.name.trim().charAt(0)}
                        </span>
                        <div className="min-w-0">
                          <Link
                            to={`/projects/${p.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="block truncate font-medium text-zinc-900 hover:text-brand-700 dark:text-zinc-100 dark:hover:text-brand-300"
                          >
                            {p.name}
                          </Link>
                          {p.description && <div className="truncate text-[12px] text-zinc-500">{p.description}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="table-cell">
                      {p.owner ? (
                        <span className="flex items-center gap-2">
                          <Avatar name={p.owner.name} url={p.owner.avatar_url} size={22} />
                          <span className="truncate">{p.owner.name}</span>
                        </span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="table-cell">
                      {p.members.length ? <MembersRow members={p.members} /> : <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="table-cell text-right tabular-nums">{p.tasks_count}</td>
                    <td className="table-cell">
                      {p.is_archived ? (
                        <span className="chip bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400">Архив</span>
                      ) : (
                        <span className="chip bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Активен
                        </span>
                      )}
                    </td>
                    <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        {can("projects.archive") && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title={p.is_archived ? "Вернуть" : "Архивировать"}
                            aria-label={p.is_archived ? `Вернуть проект «${p.name}» из архива` : `Архивировать проект «${p.name}»`}
                            onClick={() => archive.mutate(p.id)}
                          >
                            {p.is_archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                          </Button>
                        )}
                        {can("projects.delete") && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-rose-500"
                            title="Удалить"
                            aria-label={`Удалить проект «${p.name}»`}
                            onClick={() =>
                              confirm({
                                title: "Удалить проект?",
                                message: `«${p.name}» будет удалён вместе с задачами.`,
                                danger: true,
                                confirmLabel: "Удалить",
                                onConfirm: () => del.mutateAsync(p.id),
                              })
                            }
                          >
                            <Trash2 size={15} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        <div key={m.id} className="rounded-full ring-2 ring-white dark:ring-[#1B1E23]">
          <Avatar name={m.name} size={24} url={m.avatar_url} />
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
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isValid },
    watch,
    setValue,
  } = useForm<ProjectForm>({
    resolver: zodResolver(projectSchema),
    mode: "onChange",
    defaultValues: { name: "", description: "", color: "#2A52C4", member_ids: [] },
  });
  const memberIds = watch("member_ids");

  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await api.get<Page<User>>("/api/users")).data.items,
  });

  const create = useMutation({
    mutationFn: (data: ProjectForm) =>
      api.post("/api/projects", {
        name: data.name,
        description: data.description || null,
        color: data.color,
        member_ids: data.member_ids,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
    onError: (e) => setFormError(extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title="Новый проект" size="md">
      <form onSubmit={handleSubmit((d) => create.mutate(d))} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
          <input className="input" autoFocus {...register("name")} />
          <FieldError msg={errors.name?.message} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Описание</span>
          <textarea className="input min-h-[90px]" {...register("description")} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Цвет</span>
            <Controller
              control={control}
              name="color"
              render={({ field }) => (
                <input
                  type="color"
                  className="h-10 w-full rounded-lg border border-neutral-200 dark:border-neutral-800"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <FieldError msg={errors.color?.message} />
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
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...memberIds, u.id]
                      : memberIds.filter((x) => x !== u.id);
                    setValue("member_ids", next, { shouldValidate: true });
                  }}
                />
                <Avatar name={u.name} size={22} url={u.avatar_url} />
                <span className="text-sm">{u.name}</span>
                <span className="text-xs text-neutral-500">{u.email}</span>
              </label>
            ))}
          </div>
        </div>
        <FormError msg={formError} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={!isValid || create.isPending}>
            Создать
          </Button>
        </div>
      </form>
    </Modal>
  );
}
