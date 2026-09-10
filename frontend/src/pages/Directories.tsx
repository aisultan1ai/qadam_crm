import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { Plus, BookText, Trash2, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { EmptyState, Modal, FieldError, FormError } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";

type Dir = { id: number; code: string; label: string; icon: string | null; fields: any[] };
type Entry = { id: number; label: string | null; values: Record<string, any> };

export default function DirectoriesPage() {
  const [active, setActive] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);

  const { data: dirs, isPending } = useQuery({
    queryKey: ["directories"],
    queryFn: async () => (await api.get<Dir[]>("/api/directories")).data,
  });

  const current = dirs?.find((d) => d.code === active) || dirs?.[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Справочники</h1>
          <p className="text-sm text-neutral-500">Пользовательские lookup-таблицы (страны, продукты, статусы...)</p>
        </div>
        <button className="btn-primary" onClick={() => setOpenNew(true)}>
          <Plus size={16} /> Справочник
        </button>
      </div>

      {isPending ? (
        <div className="h-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />
      ) : !dirs || dirs.length === 0 ? (
        <EmptyState icon={<BookText size={32} />} title="Справочников нет" description="Создайте свой первый справочник — набор полей + записи" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-1">
            {dirs.map((d) => (
              <button
                key={d.id}
                onClick={() => setActive(d.code)}
                className={clsx(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm",
                  current?.id === d.id
                    ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                    : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/60",
                )}
              >
                <span className="truncate"><BookText size={13} className="mr-1.5 inline" /> {d.label}</span>
                <ChevronRight size={13} className="opacity-50" />
              </button>
            ))}
          </div>

          {current && <EntriesPanel dir={current} />}
        </div>
      )}

      {openNew && <NewDirModal onClose={() => setOpenNew(false)} />}
    </div>
  );
}

function EntriesPanel({ dir }: { dir: Dir }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [openNew, setOpenNew] = useState(false);

  const { data } = useQuery({
    queryKey: ["dir-entries", dir.code],
    queryFn: async () => (await api.get<Entry[]>(`/api/directories/${dir.code}/entries`)).data,
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/directory-entries/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dir-entries", dir.code] }),
  });

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{dir.label} <span className="text-xs text-neutral-500">/{dir.code}</span></h2>
          <p className="text-xs text-neutral-500">{dir.fields.length} полей · {data?.length ?? 0} записей</p>
        </div>
        <button className="btn-primary" onClick={() => setOpenNew(true)}>
          <Plus size={14} /> Запись
        </button>
      </div>

      {!data || data.length === 0 ? (
        <div className="py-8 text-center text-sm text-neutral-500">Записей нет</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500 dark:bg-neutral-900/40">
              <tr>
                <th className="px-3 py-2">Название</th>
                {dir.fields.slice(0, 4).map((f: any) => (
                  <th key={f.name} className="px-3 py-2">{f.label}</th>
                ))}
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2 font-medium">{e.label || `#${e.id}`}</td>
                  {dir.fields.slice(0, 4).map((f: any) => (
                    <td key={f.name} className="px-3 py-2 text-neutral-600 dark:text-neutral-400">
                      {String(e.values[f.name] ?? "—").slice(0, 60)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">
                    <button
                      className="btn-ghost !p-1.5 text-rose-500"
                      onClick={() =>
                        confirm({
                          title: "Удалить запись?",
                          danger: true,
                          confirmLabel: "Удалить",
                          onConfirm: () => del.mutateAsync(e.id),
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openNew && <NewEntryModal dir={dir} onClose={() => setOpenNew(false)} />}
    </div>
  );
}

function NewDirModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<{ name: string; label: string; type: string }[]>([]);
  const [nf, setNf] = useState({ name: "", label: "", type: "text" });
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.post("/api/directories", { code, label, fields }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["directories"] });
      onClose();
    },
    onError: (e) => setErr(extractApiError(e).message),
  });

  const invalid = !label.trim() || !/^[a-z][a-z0-9_]*$/.test(code);

  return (
    <Modal open onClose={onClose} title="Новый справочник" size="md">
      <form onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate(); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Страны" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Код (snake_case)</span>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="countries" />
            <FieldError msg={code && !/^[a-z][a-z0-9_]*$/.test(code) ? "Только маленькие латинские, цифры, _" : undefined} />
          </label>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Поля</div>
          <div className="space-y-1">
            {fields.map((f, i) => (
              <div key={i} className="flex items-center gap-2 rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
                <span className="font-mono text-xs text-neutral-500">{f.name}</span>
                <span className="flex-1">{f.label}</span>
                <span className="text-xs text-neutral-500">{f.type}</span>
                <button type="button" className="btn-ghost !p-1 text-rose-500" onClick={() => setFields(fields.filter((_, j) => j !== i))}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-[100px_1fr_100px_auto] gap-2">
            <input className="input !text-xs" placeholder="имя" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} />
            <input className="input !text-xs" placeholder="Метка" value={nf.label} onChange={(e) => setNf({ ...nf, label: e.target.value })} />
            <select className="input !text-xs" value={nf.type} onChange={(e) => setNf({ ...nf, type: e.target.value })}>
              <option value="text">text</option>
              <option value="number">number</option>
              <option value="date">date</option>
              <option value="checkbox">bool</option>
            </select>
            <button type="button" className="btn-ghost !px-2" onClick={() => { if (nf.name && nf.label) { setFields([...fields, nf]); setNf({ name: "", label: "", type: "text" }); } }}>
              <Plus size={13} />
            </button>
          </div>
        </div>

        <FormError msg={err} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn-primary" disabled={invalid || save.isPending}>Создать</button>
        </div>
      </form>
    </Modal>
  );
}

function NewEntryModal({ dir, onClose }: { dir: Dir; onClose: () => void }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [values, setValues] = useState<Record<string, any>>({});
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.post(`/api/directories/${dir.code}/entries`, { label: label || null, values }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dir-entries", dir.code] });
      onClose();
    },
    onError: (e) => setErr(extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title={`Новая запись: ${dir.label}`} size="md">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        {dir.fields.map((f: any) => (
          <label key={f.name} className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{f.label}</span>
            <input
              className="input"
              type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
              value={values[f.name] ?? ""}
              onChange={(e) => setValues({ ...values, [f.name]: f.type === "number" ? Number(e.target.value) : e.target.value })}
            />
          </label>
        ))}
        <FormError msg={err} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn-primary" disabled={save.isPending}>Создать</button>
        </div>
      </form>
    </Modal>
  );
}
