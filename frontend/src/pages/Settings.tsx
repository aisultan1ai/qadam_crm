import { useEffect, useMemo, useState } from "react";
import { Route, Routes, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "@/api/client";
import type { Role, PermissionGroup } from "@/types";
import { Loader, Modal } from "@/components/ui";
import { Plus, Copy, Trash2, Save } from "lucide-react";
import { useAuth } from "@/store/auth";

export default function Settings() {
  const { can } = useAuth();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Настройки</h1>
        <p className="text-sm text-neutral-500">Роли и права доступа</p>
      </div>

      <Routes>
        <Route index element={<Navigate to="roles" replace />} />
        <Route path="roles" element={can("roles.manage") ? <RolesSettings /> : <Forbid />} />
      </Routes>
    </div>
  );
}

function Forbid() {
  return <div className="card p-8 text-center text-sm text-neutral-500">Недостаточно прав</div>;
}

function RolesSettings() {
  const qc = useQueryClient();
  const { data: roles } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await api.get<Role[]>("/api/roles")).data,
    refetchOnMount: "always",
    staleTime: 0,
  });
  const { data: groups } = useQuery({
    queryKey: ["permissions"],
    queryFn: async () => (await api.get<PermissionGroup[]>("/api/permissions")).data,
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = useMemo(
    () => roles?.find((r) => r.id === selectedId) ?? roles?.[0] ?? null,
    [roles, selectedId],
  );

  const [nameDraft, setNameDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [permSet, setPermSet] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [openNew, setOpenNew] = useState(false);

  useEffect(() => {
    if (selected) {
      setNameDraft(selected.name);
      setDescDraft(selected.description || "");
      setPermSet(new Set(selected.permissions.map((p) => p.code)));
      setDirty(false);
    }
  }, [selected]);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/roles/${selected!.id}`, {
        name: nameDraft,
        description: descDraft,
        permission_codes: Array.from(permSet),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      setDirty(false);
    },
  });
  const copyRole = useMutation({
    mutationFn: (id: number) => api.post(`/api/roles/${id}/copy`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      setSelectedId(r.data.id);
    },
  });
  const delRole = useMutation({
    mutationFn: (id: number) => api.delete(`/api/roles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roles"] }),
    onError: (e: any) => alert(e?.response?.data?.detail || "Ошибка"),
  });

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <div className="card p-2">
        <div className="mb-1 flex items-center justify-between px-2 py-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Роли</span>
          <button className="btn-ghost !p-1" onClick={() => setOpenNew(true)}>
            <Plus size={14} />
          </button>
        </div>
        <div className="space-y-0.5">
          {roles?.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={clsx(
                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                selected?.id === r.id
                  ? "bg-neutral-100 font-medium dark:bg-neutral-800"
                  : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60",
              )}
            >
              <span className="truncate">{r.name}</span>
              <span className="text-xs text-neutral-500">{r.users_count}</span>
            </button>
          ))}
        </div>
      </div>

      {!selected || !groups ? (
        <Loader />
      ) : (
        <div className="card flex max-h-[calc(100vh-12rem)] flex-col p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex-1 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
                <input className="input" value={nameDraft} onChange={(e) => { setNameDraft(e.target.value); setDirty(true); }} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Описание</span>
                <input className="input" value={descDraft} onChange={(e) => { setDescDraft(e.target.value); setDirty(true); }} />
              </label>
            </div>
            <div className="flex gap-1">
              <button className="btn-ghost !p-2" title="Копировать" onClick={() => copyRole.mutate(selected.id)}>
                <Copy size={16} />
              </button>
              <button
                className="btn-ghost !p-2 text-rose-500"
                title="Удалить"
                onClick={() => confirm(`Удалить роль «${selected.name}»?`) && delRole.mutate(selected.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto pr-1">
            {groups.map((g) => {
              const allChecked = g.items.every((p) => permSet.has(p.code));
              const someChecked = g.items.some((p) => permSet.has(p.code));
              return (
                <div key={g.group}>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => el && (el.indeterminate = !allChecked && someChecked)}
                      onChange={(e) => {
                        const next = new Set(permSet);
                        for (const p of g.items) {
                          if (e.target.checked) next.add(p.code);
                          else next.delete(p.code);
                        }
                        setPermSet(next);
                        setDirty(true);
                      }}
                    />
                    {g.group}
                  </label>
                  <div className="grid gap-1 pl-6 sm:grid-cols-2">
                    {g.items.map((p) => (
                      <label key={p.code} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
                        <input
                          type="checkbox"
                          checked={permSet.has(p.code)}
                          onChange={(e) => {
                            const next = new Set(permSet);
                            if (e.target.checked) next.add(p.code);
                            else next.delete(p.code);
                            setPermSet(next);
                            setDirty(true);
                          }}
                        />
                        {p.name}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-4 dark:border-neutral-800">
            <span className="text-xs text-neutral-500">{permSet.size} прав выбрано</span>
            <button className="btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              <Save size={14} /> Сохранить
            </button>
          </div>
        </div>
      )}

      {openNew && <NewRoleModal onClose={() => setOpenNew(false)} onCreated={(id) => setSelectedId(id)} />}
    </div>
  );
}

function NewRoleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () => api.post("/api/roles", { name, description, permission_codes: [] }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      onCreated(r.data.id);
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title="Новая роль">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Описание</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-primary" disabled={!name || create.isPending} onClick={() => create.mutate()}>Создать</button>
        </div>
      </div>
    </Modal>
  );
}

