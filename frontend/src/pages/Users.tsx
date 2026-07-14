import { useMemo, useState } from "react";
import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "@/api/client";
import { Plus, Trash2, Search, Pencil, Users as UsersIcon, Layers } from "lucide-react";
import type { User, Role, Department } from "@/types";
import { Avatar, Loader, Modal } from "@/components/ui";
import { useAuth } from "@/store/auth";

const TABS = [
  { to: "list", label: "Сотрудники", icon: UsersIcon },
  { to: "departments", label: "Отделы", icon: Layers },
];

export default function Users() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Пользователи</h1>
          <p className="text-sm text-neutral-500">Сотрудники компании и отделы</p>
        </div>
        <nav className="flex gap-1 rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900/60">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-white"
                    : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white",
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
        <Route path="departments" element={<DepartmentsView />} />
      </Routes>
    </div>
  );
}

function UsersList() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [openForm, setOpenForm] = useState<{ mode: "create" } | { mode: "edit"; user: User } | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ["users", q],
    queryFn: async () => (await api.get<User[]>("/api/users", { params: { q: q || undefined } })).data,
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
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-md flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-neutral-400" />
          <input className="input pl-8" placeholder="Поиск по имени или email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {can("users.create") && (
          <button className="btn-primary" onClick={() => setOpenForm({ mode: "create" })}>
            <Plus size={16} /> Новый пользователь
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <Loader />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-800/40">
              <tr>
                <th className="px-5 py-2.5 text-left">Имя</th>
                <th className="px-5 py-2.5 text-left">Email</th>
                <th className="px-5 py-2.5 text-left">Роли</th>
                <th className="px-5 py-2.5 text-left">Отдел</th>
                <th className="px-5 py-2.5 text-left">Статус</th>
                <th className="px-5 py-2.5 text-left">Последний вход</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {users?.map((u) => (
                <tr key={u.id} className="table-row">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar name={u.name} url={u.avatar_url} />
                      <span className="font-medium">{u.name}</span>
                      {u.is_superuser && <span className="chip bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">super</span>}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-neutral-600">{u.email}</td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <span key={r.id} className="chip bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                          {r.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-neutral-600">{u.department?.name || "—"}</td>
                  <td className="px-5 py-3">
                    <span className={`chip ${u.is_active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"}`}>
                      {u.is_active ? "активен" : "заблокирован"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-neutral-500">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString("ru-RU") : "—"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {can("users.update") && (
                      <button className="btn-ghost !p-1.5" onClick={() => setOpenForm({ mode: "edit", user: u })}>
                        <Pencil size={14} />
                      </button>
                    )}
                    {can("users.delete") && !u.is_superuser && (
                      <button className="btn-ghost !p-1.5 text-rose-500" onClick={() => confirm("Удалить пользователя?") && del.mutate(u.id)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

function DepartmentsView() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [openNew, setOpenNew] = useState(false);

  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await api.get<Department[]>("/api/departments")).data,
  });
  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get<User[]>("/api/users")).data,
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/departments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      setSelectedId(null);
    },
    onError: (e: any) => alert(e?.response?.data?.detail || "Ошибка"),
  });

  const counts = useMemo(() => {
    const m = new Map<number, number>();
    let noDept = 0;
    for (const u of users ?? []) {
      if (u.department?.id) m.set(u.department.id, (m.get(u.department.id) ?? 0) + 1);
      else noDept += 1;
    }
    return { byDept: m, noDept };
  }, [users]);

  const selected =
    selectedId === -1
      ? { id: -1 as const, name: "Без отдела" }
      : departments?.find((d) => d.id === selectedId) ?? null;

  const employees = useMemo(() => {
    if (!users) return [];
    if (selected?.id === -1) return users.filter((u) => !u.department);
    if (selected) return users.filter((u) => u.department?.id === selected.id);
    return [];
  }, [users, selected]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">
          Всего отделов: {departments?.length ?? 0}
        </p>
        {can("settings.dictionaries") && (
          <button className="btn-primary" onClick={() => setOpenNew(true)}>
            <Plus size={16} /> Новый отдел
          </button>
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
                      if (confirm(`Удалить отдел «${d.name}»?`)) del.mutate(d.id);
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
            <div className="py-6 text-center text-xs text-neutral-500">Отделов пока нет</div>
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
            </div>
            {employees.length === 0 ? (
              <div className="py-10 text-center text-sm text-neutral-500">Здесь пока никого нет</div>
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
                      <div className="truncate text-xs text-neutral-500">{u.email}</div>
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

      {openNew && <NewDepartmentModal onClose={() => setOpenNew(false)} onCreated={(id) => setSelectedId(id)} />}
    </div>
  );
}

function NewDepartmentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => (await api.post<Department>("/api/departments", { name })).data,
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["departments"] });
      onCreated(d.id);
      onClose();
    },
    onError: (e: any) => setError(e?.response?.data?.detail || "Не удалось создать"),
  });

  return (
    <Modal open onClose={onClose} title="Новый отдел" size="sm">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
          <input
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name) create.mutate();
            }}
            autoFocus
            placeholder="Например, Маркетинг"
          />
        </label>
        {error && <div className="text-xs text-rose-500">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button
            className="btn-primary"
            disabled={!name || create.isPending}
            onClick={() => create.mutate()}
          >
            Создать
          </button>
        </div>
      </div>
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
  const [name, setName] = useState(initial?.name || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [password, setPassword] = useState("");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [departmentId, setDepartmentId] = useState<number | "">(initial?.department?.id ?? "");
  const [roleIds, setRoleIds] = useState<number[]>(initial?.roles.map((r) => r.id) ?? []);

  const save = useMutation({
    mutationFn: () => {
      const body: any = {
        email, name,
        is_active: isActive,
        role_ids: roleIds,
        department_id: departmentId || null,
      };
      if (password) body.password = password;
      if (initial) return api.patch(`/api/users/${initial.id}`, body);
      return api.post("/api/users", { ...body, password });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={initial ? "Изменить пользователя" : "Новый пользователь"} size="md">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Имя</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Email</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Пароль</span>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={initial ? "Оставьте пустым, чтобы не менять" : ""} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Отдел</span>
            <select className="input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : "")}>
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
                  onChange={(e) =>
                    setRoleIds((v) => (e.target.checked ? [...v, r.id] : v.filter((x) => x !== r.id)))
                  }
                />
                <span className="text-sm">{r.name}</span>
                <span className="text-xs text-neutral-500">— {r.permissions.length} прав</span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Активен
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-primary" disabled={!name || !email || (!initial && !password) || save.isPending} onClick={() => save.mutate()}>
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}
