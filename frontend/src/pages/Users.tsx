import { useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, Navigate, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import clsx from "clsx";
import { api, extractApiError } from "@/api/client";
import { Plus, Trash2, Search, Pencil, Users as UsersIcon, Layers, UserPlus, ShieldCheck, ShieldAlert } from "lucide-react";
import type { User, Role, Department, Page } from "@/types";
import { Avatar, Loader, Modal, FieldError, FormError, EmptyState } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { VirtualList } from "@/components/VirtualList";
import { departmentSchema, type DepartmentForm, userCreateSchema, userUpdateSchema, type UserCreateForm, type UserUpdateForm } from "@/lib/validation";
import { useAuth } from "@/store/auth";

import { SearchInput } from "@/components/page";
import InvitationsPanel from "./users/Invitations";
import { fetchAllUsers } from "@/lib/users";
const TABS = [
  { to: "list", label: "Сотрудники", icon: UsersIcon },
  { to: "invitations", label: "Приглашения", icon: UserPlus, invite: true },
  { to: "departments", label: "Отделы", icon: Layers },
];

export default function Users() {
  const { can, me } = useAuth();
  // Приглашать может тот, кто создаёт пользователей, и владелец компании (как и было в настройках).
  const canInvite = can("users.create") || !!me?.current_tenant?.is_owner;
  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <div className="mb-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">Команда</div>
          <h1 className="page-title">Пользователи</h1>
        </div>
        <nav className="flex gap-1 card p-1">
          {TABS.filter((t) => !t.invite || canInvite).map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-brand-600 font-medium text-white shadow-sm hover:bg-brand-700"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-white",
                )
              }
            >
              <t.icon size={15} />
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <Routes>
        <Route index element={<Navigate to="list" replace />} />
        <Route path="list" element={<UsersList />} />
        <Route path="invitations" element={canInvite ? <InvitationsPanel /> : <Navigate to="../list" replace />} />
        <Route path="departments" element={<DepartmentsView />} />
      </Routes>
    </div>
  );
}

function UsersList() {
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [qLocal, setQLocal] = useState("");
  const [q, setQ] = useState("");
  const [openForm, setOpenForm] = useState<{ mode: "create" } | { mode: "edit"; user: User } | null>(null);

  useEffect(() => {
    if (qLocal === q) return;
    const t = setTimeout(() => setQ(qLocal), 250);
    return () => clearTimeout(t);
  }, [qLocal, q]);

  const { data: users, isLoading } = useQuery({
    queryKey: ["users", q],
    queryFn: async () => fetchAllUsers({ q: q || undefined }),
  });
  const { data: roles } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await api.get<Role[]>("/api/roles")).data,
    enabled: can("roles.manage"),
  });
  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await api.get<Department[]>("/api/departments")).data,
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput value={qLocal} onChange={setQLocal} placeholder="Поиск по имени или email" />
        {can("users.create") && (
          <div className="flex gap-2">
            {/* Обычный путь — приглашение: человек сам задаёт пароль. Ручное создание — для тех, у кого нет почты. */}
            <Button variant="secondary" onClick={() => setOpenForm({ mode: "create" })}>
              <Plus size={16} /> Создать вручную
            </Button>
            <Button variant="primary" onClick={() => nav("../invitations")}>
              <UserPlus size={16} /> Пригласить
            </Button>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <Loader />
        ) : (
          <UsersGrid
            users={users ?? []}
            can={can}
            onEdit={(u) => setOpenForm({ mode: "edit", user: u })}
            onDelete={(u) =>
              confirm({
                title: "Удалить пользователя?",
                message: `${u.name} (${u.email}) будет удалён.`,
                danger: true,
                confirmLabel: "Удалить",
                onConfirm: () => del.mutateAsync(u.id),
              })
            }
          />
        )}
      </div>

      {openForm && (
        <UserFormModal
          initial={openForm.mode === "edit" ? openForm.user : null}
          roles={roles ?? []}
          departments={departments ?? []}
          onClose={() => setOpenForm(null)}
        />
      )}
    </div>
  );
}

// Grid layout: те же колонки что и раньше, но div-структура для виртуализации.
// Ширины колонок в px + fr для гибких — header и rows используют один и тот же grid-template.
const USERS_GRID_COLS = "minmax(200px,1.5fr) minmax(200px,1.5fr) minmax(160px,2fr) minmax(120px,1fr) 190px 150px 80px";
const USER_ROW_HEIGHT = 56;

function UsersGrid({
  users,
  can,
  onEdit,
  onDelete,
}: {
  users: User[];
  can: (code: string | string[]) => boolean;
  onEdit: (u: User) => void;
  onDelete: (u: User) => void;
}) {
  const showActions = can("users.update") || can("users.delete");
  return (
    <div className="min-w-[900px]">
      <div
        className="grid bg-neutral-50 px-5 py-2.5 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-800/40"
        style={{ gridTemplateColumns: USERS_GRID_COLS }}
      >
        <div>Имя</div>
        <div>Email</div>
        <div>Роли</div>
        <div>Отделы</div>
        <div>Статус</div>
        <div>Последний вход</div>
        <div />
      </div>
      <VirtualList
        items={users}
        itemHeight={USER_ROW_HEIGHT}
        // Больше 50 записей — фиксируем высоту вьюпорта и виртуализируем.
        height={Math.min(users.length, 12) * USER_ROW_HEIGHT + 4}
        getKey={(u) => u.id}
        threshold={50}
        renderItem={(u) => (
          <div
            className="grid items-center border-b border-neutral-100 px-5 text-sm hover:bg-neutral-50/70 dark:border-neutral-800/80 dark:hover:bg-neutral-800/40"
            style={{ gridTemplateColumns: USERS_GRID_COLS, height: USER_ROW_HEIGHT }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Avatar name={u.name} url={u.avatar_url} />
              <span className="font-medium truncate">{u.name}</span>
              {u.is_superuser && (
                <span className="chip bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300 shrink-0">
                  super
                </span>
              )}
            </div>
            <div className="truncate text-neutral-600">{u.email}</div>
            <div className="flex flex-wrap gap-1 overflow-hidden">
              {u.roles.slice(0, 3).map((r) => (
                <span
                  key={r.id}
                  className="chip bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {r.name}
                </span>
              ))}
              {u.roles.length > 3 && (
                <span className="text-xs text-neutral-500">+{u.roles.length - 3}</span>
              )}
            </div>
            <div className="truncate text-neutral-600" title={deptsOf(u).map((d) => d.name).join(", ")}>
              {deptsOf(u).map((d) => d.name).join(", ") || "—"}
            </div>
            <div className="flex flex-col items-start gap-0.5">
              <span
                className={`chip ${
                  u.is_active
                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25"
                    : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
                }`}
              >
                {u.is_active ? "активен" : "заблокирован"}
              </span>
              <TwoFactorBadge user={u} />
            </div>
            <div className="text-xs text-neutral-500 truncate">
              {u.last_login_at ? new Date(u.last_login_at).toLocaleString("ru-RU") : "—"}
            </div>
            <div className="flex items-center justify-end gap-0.5">
              {can("users.update") && (
                <Button variant="ghost" size="icon" onClick={() => onEdit(u)} aria-label="Изменить">
                  <Pencil size={14} />
                </Button>
              )}
              {can("users.delete") && !u.is_superuser && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-rose-500"
                  onClick={() => onDelete(u)}
                  aria-label="Удалить"
                >
                  <Trash2 size={14} />
                </Button>
              )}
              {!showActions && <span />}
            </div>
          </div>
        )}
      />
    </div>
  );
}

function DepartmentsView() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [editMembers, setEditMembers] = useState(false);
  const canManageMembers = can("settings.dictionaries") || can("users.update");

  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await api.get<Department[]>("/api/departments")).data,
  });
  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: async () => fetchAllUsers(),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/departments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      setSelectedId(null);
    },
    onError: (e) => toast.error("Не удалось удалить отдел", extractApiError(e).message),
  });

  const counts = useMemo(() => {
    const m = new Map<number, number>();
    let noDept = 0;
    for (const u of users ?? []) {
      const ds = deptsOf(u);
      if (ds.length === 0) noDept += 1;
      for (const d of ds) m.set(d.id, (m.get(d.id) ?? 0) + 1);
    }
    return { byDept: m, noDept };
  }, [users]);

  const selected =
    selectedId === -1
      ? { id: -1 as const, name: "Без отдела" }
      : departments?.find((d) => d.id === selectedId) ?? null;

  const employees = useMemo(() => {
    if (!users) return [];
    if (selected?.id === -1) return users.filter((u) => deptsOf(u).length === 0);
    if (selected) return users.filter((u) => deptsOf(u).some((d) => d.id === selected.id));
    return [];
  }, [users, selected]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">
          Всего отделов: {departments?.length ?? 0}
        </p>
        {can("settings.dictionaries") && (
          <Button variant="primary" onClick={() => setOpenNew(true)}>
            <Plus size={16} /> Новый отдел
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-[300px_1fr]">
      <div className="card p-2">
        <div className="mb-1 flex items-center justify-between px-3 py-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Отделы</span>
          <span className="text-xs text-neutral-500">{departments?.length ?? 0}</span>
        </div>
        <div className="space-y-0.5">
          {departments?.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedId(d.id)}
              className={clsx(
                "group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                selected?.id === d.id
                  ? "bg-neutral-100 font-medium dark:bg-neutral-800"
                  : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60",
              )}
            >
              <span className="truncate">{d.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">{counts.byDept.get(d.id) ?? 0}</span>
                {can("settings.dictionaries") && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      confirm({
                        title: "Удалить отдел?",
                        message: `Отдел «${d.name}» будет удалён.`,
                        danger: true,
                        confirmLabel: "Удалить",
                        onConfirm: () => del.mutateAsync(d.id),
                      });
                    }}
                    className="opacity-0 text-rose-500 group-hover:opacity-100"
                    title="Удалить"
                  >
                    <Trash2 size={14} />
                  </span>
                )}
              </span>
            </button>
          ))}
          <button
            onClick={() => setSelectedId(-1)}
            className={clsx(
              "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
              selected?.id === -1
                ? "bg-neutral-100 font-medium dark:bg-neutral-800"
                : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60",
            )}
          >
            <span className="italic text-neutral-500">Без отдела</span>
            <span className="text-xs text-neutral-500">{counts.noDept}</span>
          </button>
          {(!departments || departments.length === 0) && (
            <EmptyState
              icon={<Layers size={22} />}
              title="Отделов пока нет"
              description="Создайте отдел, чтобы группировать сотрудников."
            />
          )}
        </div>
      </div>

      <div className="card p-5">
        {!selected ? (
          <div className="py-16 text-center text-sm text-neutral-500">
            Выберите отдел слева, чтобы увидеть сотрудников
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                <p className="text-xs text-neutral-500">Сотрудников: {employees.length}</p>
              </div>
              {selected.id !== -1 && canManageMembers && (
                <Button variant="secondary" onClick={() => setEditMembers(true)}>
                  <UsersIcon size={15} /> Участники
                </Button>
              )}
            </div>
            {employees.length === 0 ? (
              <EmptyState
                icon={<UsersIcon size={26} />}
                title="Здесь пока никого нет"
                description={selected.id === -1 ? "Все сотрудники распределены по отделам." : "Нажмите «Участники», чтобы добавить сотрудников в отдел."}
              />
            ) : (
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {employees.map((u) => (
                  <div key={u.id} className="flex items-center gap-3 py-2.5">
                    <Avatar name={u.name} url={u.avatar_url} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                        {u.name}
                        {u.is_superuser && (
                          <span className="chip bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                            super
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-neutral-500">
                        {u.email}
                        {selected.id !== -1 && deptsOf(u).length > 1 && (
                          <span className="ml-1.5">
                            · {u.department?.id === selected.id ? "основной отдел" : `основной: ${u.department?.name ?? "—"}`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <span key={r.id} className="chip bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                          {r.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      </div>

      {openNew && (
        <NewDepartmentModal users={users ?? []} onClose={() => setOpenNew(false)} onCreated={(id) => setSelectedId(id)} />
      )}
      {editMembers && selected && selected.id !== -1 && (
        <DepartmentMembersModal
          department={selected as Department}
          users={users ?? []}
          initial={employees.map((u) => u.id)}
          onClose={() => setEditMembers(false)}
        />
      )}
    </div>
  );
}

function NewDepartmentModal({
  users,
  onClose,
  onCreated,
}: {
  users: User[];
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<number[]>([]);

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<DepartmentForm>({
    resolver: zodResolver(departmentSchema),
    mode: "onChange",
    defaultValues: { name: "" },
  });

  const create = useMutation({
    mutationFn: async (data: DepartmentForm) =>
      (await api.post<Department>("/api/departments", { name: data.name, member_ids: memberIds })).data,
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      onCreated(d.id);
      onClose();
    },
    onError: (e) => setFormError(extractApiError(e).message || "Не удалось создать"),
  });

  return (
    <Modal open onClose={onClose} title="Новый отдел" size="md">
      <form onSubmit={handleSubmit((d) => create.mutate(d))} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
          <input className="input" autoFocus placeholder="Например, Маркетинг" {...register("name")} />
          <FieldError msg={errors.name?.message} />
        </label>
        <div>
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            Участники {memberIds.length > 0 && `· ${memberIds.length}`}
          </span>
          <MemberPicker users={users} value={memberIds} onChange={setMemberIds} />
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

function UserFormModal({
  initial,
  roles,
  departments,
  onClose,
}: {
  initial: User | null;
  roles: Role[];
  departments: Department[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!initial;
  const [formError, setFormError] = useState<string | null>(null);
  // Требовать 2FA решает только владелец компании (сервер проверяет то же самое).
  const canManage2fa = useAuth((s) => !!s.me?.current_tenant?.is_owner || !!s.me?.is_platform_admin);
  const [require2fa, setRequire2fa] = useState<boolean>(!!initial?.require_2fa);

  // UserUpdateForm — supertype: те же поля, но password optional.
  // Для create-формы валидация userCreateSchema гарантирует, что password непустой.
  type FormData = UserUpdateForm;
  const resolver: Resolver<FormData> = isEdit
    ? zodResolver(userUpdateSchema)
    : (zodResolver(userCreateSchema) as unknown as Resolver<FormData>);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isValid },
  } = useForm<FormData>({
    resolver,
    mode: "onChange",
    defaultValues: {
      name: initial?.name || "",
      email: initial?.email || "",
      password: "",
      is_active: initial?.is_active ?? true,
      department_id: initial?.department?.id ?? "",
      role_ids: initial?.roles.map((r) => r.id) ?? [],
    },
  });
  const roleIds = watch("role_ids") || [];

  const save = useMutation({
    mutationFn: (data: FormData) => {
      const body: Record<string, unknown> = {
        email: data.email,
        name: data.name,
        is_active: data.is_active,
        role_ids: data.role_ids,
        department_id: data.department_id || null,
      };
      if (data.password) body.password = data.password;
      if (isEdit && canManage2fa && require2fa !== !!initial?.require_2fa) body.require_2fa = require2fa;
      if (isEdit) return api.patch(`/api/users/${initial!.id}`, body);
      return api.post("/api/users", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
    onError: (e) => setFormError(extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title={isEdit ? "Изменить пользователя" : "Новый пользователь"} size="md">
      <form onSubmit={handleSubmit((d) => save.mutate(d))} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Имя</span>
            <input className="input" {...register("name")} />
            <FieldError msg={errors.name?.message as string} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Email</span>
            <input className="input" type="email" {...register("email")} />
            <FieldError msg={errors.email?.message as string} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Пароль</span>
            <input
              className="input"
              type="password"
              placeholder={isEdit ? "Оставьте пустым, чтобы не менять" : ""}
              {...register("password")}
            />
            <FieldError msg={errors.password?.message as string} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Основной отдел <span className="font-normal text-neutral-400">· доп. отделы — в разделе «Отделы»</span>
            </span>
            <select className="input" {...register("department_id", { setValueAs: (v) => (v ? Number(v) : "") })}>
              <option value="">—</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Роли</span>
          <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
            {roles.map((r) => (
              <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800">
                <input
                  type="checkbox"
                  checked={roleIds.includes(r.id)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...roleIds, r.id] : roleIds.filter((x) => x !== r.id);
                    setValue("role_ids", next, { shouldValidate: true });
                  }}
                />
                <span className="text-sm">{r.name}</span>
                <span className="text-xs text-neutral-500">— {r.permissions.length} прав</span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("is_active")} />
          Активен
        </label>

        {isEdit && canManage2fa && (
          <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={require2fa} onChange={(e) => setRequire2fa(e.target.checked)} />
              Требовать двухфакторный вход
            </label>
            <p className="mt-1 pl-6 text-xs text-neutral-500">
              При входе сотрудник будет вводить ещё и код из приложения на телефоне. Пока он не настроит
              двухфакторную защиту, ему будет открыта только страница её настройки.
              {initial?.two_factor_enabled === true && " У сотрудника она уже включена."}
              {initial?.two_factor_enabled === false && " Сейчас у сотрудника она не включена."}
            </p>
          </div>
        )}

        <FormError msg={formError} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={!isValid || save.isPending}>
            Сохранить
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Состояние 2FA сотрудника — сервер присылает его только владельцу (иначе two_factor_enabled = null). */
function TwoFactorBadge({ user }: { user: User }) {
  if (user.two_factor_enabled == null) return null;
  if (user.two_factor_enabled) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300" title="Двухфакторная защита включена">
        <ShieldCheck size={12} /> 2FA включена
      </span>
    );
  }
  if (!user.require_2fa) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300"
      title="Вы требуете от сотрудника двухфакторный вход, но он её ещё не настроил"
    >
      <ShieldAlert size={12} /> 2FA обязательна, не настроена
    </span>
  );
}

/** Отделы сотрудника в текущей компании: все (если сервер прислал) или хотя бы основной. */
function deptsOf(u: User): Department[] {
  if (u.departments && u.departments.length > 0) return u.departments;
  return u.department ? [u.department] : [];
}

/** Список сотрудников с галочками и поиском. */
function MemberPicker({ users, value, onChange }: { users: User[]; value: number[]; onChange: (ids: number[]) => void }) {
  const [q, setQ] = useState("");
  const selected = new Set(value);
  const shown = users.filter((u) => {
    const t = q.trim().toLowerCase();
    return !t || u.name.toLowerCase().includes(t) || u.email.toLowerCase().includes(t);
  });
  const toggle = (id: number) => onChange(selected.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800">
      <div className="border-b border-neutral-200 p-2 dark:border-neutral-800">
        <input className="input !h-8 text-[13px]" placeholder="Поиск по имени или email" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="max-h-64 overflow-y-auto p-1">
        {shown.length === 0 && <div className="px-2 py-3 text-center text-xs text-neutral-500">Никого не найдено</div>}
        {shown.map((u) => (
          <label key={u.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
            <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
            <Avatar name={u.name} url={u.avatar_url} size={22} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{u.name}</span>
              {deptsOf(u).length > 0 && (
                <span className="block truncate text-[11px] text-neutral-500">{deptsOf(u).map((d) => d.name).join(", ")}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Состав отдела: отметить / снять сотрудников. Человек может быть сразу в нескольких отделах. */
function DepartmentMembersModal({
  department, users, initial, onClose,
}: {
  department: Department; users: User[]; initial: number[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [ids, setIds] = useState<number[]>(initial);
  const save = useMutation({
    mutationFn: () => api.put(`/api/departments/${department.id}/members`, { user_ids: ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["departments"] });
      toast.success("Состав отдела сохранён");
      onClose();
    },
    onError: (e) => toast.error("Не удалось сохранить", extractApiError(e).message),
  });
  return (
    <Modal open onClose={onClose} title={`Участники: ${department.name}`} size="md">
      <div className="space-y-3">
        <p className="text-xs text-neutral-500">
          Отметьте, кто работает в отделе. Сотрудник может состоять в нескольких отделах — снимать его из других не нужно.
        </p>
        <MemberPicker users={users} value={ids} onChange={setIds} />
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-neutral-500">Выбрано: {ids.length}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Отмена</Button>
            <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>Сохранить</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
