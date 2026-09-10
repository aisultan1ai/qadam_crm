import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import { Plus, Boxes, Trash2, Pencil, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { EmptyState, Modal, FieldError, FormError } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import type { Page } from "@/types";

type FieldType = "text" | "textarea" | "number" | "date" | "select" | "checkbox" | "user" | "relation";

type SchemaField = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
};

type SchemaOut = {
  id: number;
  code: string;
  label: string;
  icon?: string | null;
  fields: SchemaField[];
  created_at: string;
};

type RecordOut = {
  id: number;
  schema_id: number;
  title?: string | null;
  data: Record<string, any>;
  created_at: string;
  updated_at: string;
};

const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: "Текст (одна строка)",
  textarea: "Текст (многострочный)",
  number: "Число",
  date: "Дата",
  select: "Выбор из списка",
  checkbox: "Флажок",
  user: "Сотрудник",
  relation: "Связь (ID)",
};

export default function ObjectsPage() {
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [openNewSchema, setOpenNewSchema] = useState(false);
  const [editSchema, setEditSchema] = useState<SchemaOut | null>(null);

  const { data: schemas, isPending } = useQuery({
    queryKey: ["object-schemas"],
    queryFn: async () => (await api.get<SchemaOut[]>("/api/objects/schemas")).data,
  });

  const active = schemas?.find((s) => s.code === activeCode) || schemas?.[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Объекты</h1>
          <p className="text-sm text-neutral-500">Конструктор пользовательских сущностей (договоры, тикеты, счета…)</p>
        </div>
        <button className="btn-primary" onClick={() => setOpenNewSchema(true)}>
          <Plus size={16} /> Новая сущность
        </button>
      </div>

      {isPending ? (
        <div className="h-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />
      ) : !schemas || schemas.length === 0 ? (
        <EmptyState icon={<Boxes size={32} />} title="Сущностей пока нет" description="Создайте первую — определите поля, потом заполняйте записями" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-1">
            {schemas.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveCode(s.code)}
                className={clsx(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm",
                  (active?.id === s.id)
                    ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                    : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/60",
                )}
              >
                <span className="truncate"><Boxes size={13} className="mr-1.5 inline" /> {s.label}</span>
                <ChevronRight size={13} className="opacity-50" />
              </button>
            ))}
          </div>

          {active && <SchemaDetail schema={active} onEdit={() => setEditSchema(active)} />}
        </div>
      )}

      {openNewSchema && <SchemaModal onClose={() => setOpenNewSchema(false)} />}
      {editSchema && <SchemaModal initial={editSchema} onClose={() => setEditSchema(null)} />}
    </div>
  );
}

// ============================================================================
// Schema detail (records list)
// ============================================================================

function SchemaDetail({ schema, onEdit }: { schema: SchemaOut; onEdit: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [openRec, setOpenRec] = useState<RecordOut | "new" | null>(null);

  const { data: records, isPending } = useQuery({
    queryKey: ["object-records", schema.code],
    queryFn: async () => (await api.get<Page<RecordOut>>(`/api/objects/schemas/${schema.code}/records`, { params: { per_page: 200 } })).data.items,
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/objects/records/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["object-records", schema.code] });
      toast.success("Запись удалена");
    },
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{schema.label} <span className="text-xs font-normal text-neutral-500">/{schema.code}</span></h2>
          <p className="text-xs text-neutral-500">{schema.fields.length} полей · {records?.length ?? 0} записей</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={onEdit}><Pencil size={13} /> Схема</button>
          <button className="btn-primary" onClick={() => setOpenRec("new")}><Plus size={14} /> Запись</button>
        </div>
      </div>

      {isPending ? (
        <div className="h-32 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/60" />
      ) : !records || records.length === 0 ? (
        <div className="py-8 text-center text-sm text-neutral-500">Записей пока нет</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500 dark:bg-neutral-900/40">
              <tr>
                <th className="px-3 py-2">Название</th>
                {schema.fields.slice(0, 4).map((f) => (
                  <th key={f.name} className="px-3 py-2">{f.label}</th>
                ))}
                <th className="px-3 py-2">Создана</th>
                <th className="px-3 py-2 text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2 font-medium">{r.title || `#${r.id}`}</td>
                  {schema.fields.slice(0, 4).map((f) => (
                    <td key={f.name} className="px-3 py-2 text-neutral-600 dark:text-neutral-400">
                      {formatValue(r.data[f.name], f.type)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-xs text-neutral-500">
                    {new Date(r.created_at).toLocaleDateString("ru-RU")}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost !p-1.5" onClick={() => setOpenRec(r)}><Pencil size={13} /></button>
                      <button
                        className="btn-ghost !p-1.5 text-rose-500"
                        onClick={() =>
                          confirm({
                            title: "Удалить запись?",
                            danger: true,
                            confirmLabel: "Удалить",
                            onConfirm: () => del.mutateAsync(r.id),
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openRec && (
        <RecordModal
          schema={schema}
          initial={openRec === "new" ? null : openRec}
          onClose={() => setOpenRec(null)}
        />
      )}
    </div>
  );
}

function formatValue(v: any, type: FieldType): string {
  if (v == null || v === "") return "—";
  if (type === "checkbox") return v ? "✓" : "—";
  if (type === "date" && typeof v === "string") return new Date(v).toLocaleDateString("ru-RU");
  return String(v).slice(0, 100);
}

// ============================================================================
// Schema modal (create / edit)
// ============================================================================

function SchemaModal({ initial, onClose }: { initial?: SchemaOut; onClose: () => void }) {
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [code, setCode] = useState(initial?.code || "");
  const [label, setLabel] = useState(initial?.label || "");
  const [fields, setFields] = useState<SchemaField[]>(initial?.fields || []);
  const [newField, setNewField] = useState<SchemaField>({ name: "", label: "", type: "text", required: false });

  const save = useMutation({
    mutationFn: () => {
      const body = { label, fields, code: initial ? undefined : code };
      if (initial) return api.patch(`/api/objects/schemas/${initial.id}`, { label, fields });
      return api.post("/api/objects/schemas", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["object-schemas"] });
      onClose();
    },
    onError: (e) => setFormError(extractApiError(e).message),
  });

  const invalid = !label.trim() || (!initial && !/^[a-z][a-z0-9_]*$/.test(code));

  const addField = () => {
    if (!newField.name.trim() || !newField.label.trim()) return;
    if (fields.some((f) => f.name === newField.name)) return;
    setFields([...fields, { ...newField }]);
    setNewField({ name: "", label: "", type: "text", required: false });
  };

  return (
    <Modal open onClose={onClose} title={initial ? `Схема: ${initial.label}` : "Новая сущность"} size="lg">
      <form onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate(); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Договоры" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Код (snake_case)</span>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="contract" disabled={!!initial} />
            <FieldError msg={!initial && code && !/^[a-z][a-z0-9_]*$/.test(code) ? "Только маленькие латинские буквы, цифры, _" : undefined} />
          </label>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Поля</div>
          <div className="space-y-1">
            {fields.map((f, i) => (
              <div key={i} className="flex items-center gap-2 rounded border border-neutral-200 p-2 dark:border-neutral-800">
                <span className="font-mono text-xs text-neutral-500">{f.name}</span>
                <span className="text-sm flex-1">{f.label}</span>
                <span className="text-xs text-neutral-500">{FIELD_TYPE_LABEL[f.type]}</span>
                {f.required && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700">обяз.</span>}
                <button type="button" className="btn-ghost !p-1 text-rose-500" onClick={() => setFields(fields.filter((_, j) => j !== i))}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-[100px_1fr_140px_60px_auto] gap-2">
            <input className="input !text-xs" placeholder="имя_поля" value={newField.name} onChange={(e) => setNewField({ ...newField, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} />
            <input className="input !text-xs" placeholder="Метка" value={newField.label} onChange={(e) => setNewField({ ...newField, label: e.target.value })} />
            <select className="input !text-xs" value={newField.type} onChange={(e) => setNewField({ ...newField, type: e.target.value as FieldType })}>
              {(Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map((t) => (
                <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>
              ))}
            </select>
            <label className="flex items-center justify-center text-xs">
              <input type="checkbox" checked={newField.required} onChange={(e) => setNewField({ ...newField, required: e.target.checked })} /> обяз
            </label>
            <button type="button" className="btn-ghost !px-2" onClick={addField}><Plus size={13} /></button>
          </div>
        </div>

        <FormError msg={formError} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn-primary" disabled={invalid || save.isPending}>{initial ? "Сохранить" : "Создать"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================================
// Record modal
// ============================================================================

function RecordModal({ schema, initial, onClose }: { schema: SchemaOut; initial: RecordOut | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [title, setTitle] = useState(initial?.title || "");
  const [data, setData] = useState<Record<string, any>>(initial?.data || {});

  const save = useMutation({
    mutationFn: () => {
      const body = { title: title || null, data };
      if (initial) return api.patch(`/api/objects/records/${initial.id}`, body);
      return api.post(`/api/objects/schemas/${schema.code}/records`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["object-records", schema.code] });
      onClose();
    },
    onError: (e) => setFormError(extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title={initial ? `Изменить: ${initial.title || "запись"}` : `Новая запись: ${schema.label}`} size="md">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {schema.fields.map((f) => (
          <label key={f.name} className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              {f.label} {f.required && <span className="text-rose-500">*</span>}
            </span>
            {f.type === "textarea" ? (
              <textarea className="input min-h-[70px]" value={data[f.name] || ""} onChange={(e) => setData({ ...data, [f.name]: e.target.value })} />
            ) : f.type === "checkbox" ? (
              <input type="checkbox" checked={!!data[f.name]} onChange={(e) => setData({ ...data, [f.name]: e.target.checked })} />
            ) : f.type === "select" ? (
              <select className="input" value={data[f.name] || ""} onChange={(e) => setData({ ...data, [f.name]: e.target.value })}>
                <option value="">— выберите —</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                className="input"
                type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                value={data[f.name] || ""}
                onChange={(e) => setData({ ...data, [f.name]: f.type === "number" ? (e.target.value ? Number(e.target.value) : "") : e.target.value })}
              />
            )}
          </label>
        ))}
        <FormError msg={formError} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn-primary" disabled={save.isPending}>{initial ? "Сохранить" : "Создать"}</button>
        </div>
      </form>
    </Modal>
  );
}
