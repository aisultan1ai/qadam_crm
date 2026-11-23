import { useEffect, useMemo, useState } from "react";
import { DatePicker } from "@/components/DatePicker";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Boxes, Trash2, Pencil, ChevronRight, Link2 } from "lucide-react";
import clsx from "clsx";

import { api, extractApiError } from "@/api/client";
import { EmptyState, Modal, FieldError, FormError } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { SearchInput } from "@/components/page";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { RecordPicker, RefChip, SYSTEM_TARGETS, type RefItem } from "@/components/RecordPicker";
import { useAuth } from "@/store/auth";
import type { Page } from "@/types";

type FieldType = "text" | "textarea" | "number" | "date" | "select" | "checkbox" | "user" | "relation";

type SchemaField = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[] | null;
  target?: string | null;
  multiple?: boolean;
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
  refs: Record<string, RefItem[]>;
  created_at: string;
  updated_at: string;
};

type Backlink = { schema_code: string; schema_label: string; field_label: string; record: RefItem };

const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: "Текст (одна строка)",
  textarea: "Текст (многострочный)",
  number: "Число",
  date: "Дата",
  select: "Выбор из списка",
  checkbox: "Флажок",
  user: "Сотрудник",
  relation: "Связь с записью",
};

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ы: "y", э: "e", ю: "yu", я: "ya", ә: "a", ғ: "g", қ: "k", ң: "n", ө: "o", ұ: "u", ү: "u", һ: "h", і: "i",
};
/** «Сумма договора» → summa_dogovora: код поля генерируется сам, вручную вводить не нужно. */
function slugify(label: string): string {
  const s = label
    .toLowerCase()
    .split("")
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(s) ? s : s ? `f_${s}` : "";
}

function targetOf(f: SchemaField): string | null {
  return f.type === "user" ? "user" : f.type === "relation" ? f.target ?? null : null;
}

export default function ObjectsPage() {
  const [sp, setSp] = useSearchParams();
  const activeCode = sp.get("code");
  const [openNewSchema, setOpenNewSchema] = useState(false);
  const [editSchema, setEditSchema] = useState<SchemaOut | null>(null);
  const canManage = useAuth((s) => s.can("settings.dictionaries") || !!s.me?.current_tenant?.is_owner);

  const { data: schemas, isPending } = useQuery({
    queryKey: ["object-schemas"],
    queryFn: async () => (await api.get<SchemaOut[]>("/api/objects/schemas")).data,
  });

  const active = schemas?.find((s) => s.code === activeCode) || schemas?.[0];
  const select = (code: string) => setSp({ code }, { replace: true });

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <div className="mb-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">CRM</div>
          <h1 className="page-title">Объекты</h1>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setOpenNewSchema(true)}>
            <Plus size={16} /> Новая сущность
          </Button>
        )}
      </div>

      {isPending ? (
        <div className="h-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />
      ) : !schemas || schemas.length === 0 ? (
        <EmptyState
          icon={<Boxes size={32} />}
          help="objects"
          title="Сущностей пока нет"
          description={
            canManage
              ? "Сущность — это свой реестр: акты, лицензии, заявки, инциденты. Задайте поля (в том числе связи с контрагентами, сделками и задачами), затем ведите записи."
              : "Здесь появятся реестры компании — акты, лицензии, заявки. Их настраивает администратор."
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-1">
            {schemas.map((s) => (
              <button
                key={s.id}
                onClick={() => select(s.code)}
                className={clsx(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm",
                  active?.id === s.id
                    ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                    : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/60",
                )}
              >
                <span className="truncate"><Boxes size={13} className="mr-1.5 inline" /> {s.label}</span>
                <ChevronRight size={13} className="opacity-50" />
              </button>
            ))}
          </div>

          {active && (
            <SchemaDetail
              key={active.id}
              schema={active}
              schemas={schemas}
              canManage={canManage}
              onEdit={() => setEditSchema(active)}
            />
          )}
        </div>
      )}

      {openNewSchema && <SchemaModal schemas={schemas ?? []} onClose={() => setOpenNewSchema(false)} onCreated={select} />}
      {editSchema && <SchemaModal schemas={schemas ?? []} initial={editSchema} onClose={() => setEditSchema(null)} />}
    </div>
  );
}

// ============================================================================
// Schema detail (records list)
// ============================================================================

function SchemaDetail({
  schema,
  schemas,
  canManage,
  onEdit,
}: {
  schema: SchemaOut;
  schemas: SchemaOut[];
  canManage: boolean;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [sp, setSp] = useSearchParams();
  const [openRec, setOpenRec] = useState<RecordOut | "new" | null>(null);
  const [q, setQ] = useState("");

  const { data: records, isPending } = useQuery({
    queryKey: ["object-records", schema.code, q],
    queryFn: async () =>
      (await api.get<Page<RecordOut>>(`/api/objects/schemas/${schema.code}/records`, { params: { per_page: 200, q: q || undefined } })).data.items,
  });

  // Открытие записи по ссылке (/objects?code=contract&record=12) — из превью связей и обратных ссылок.
  const recordParam = sp.get("record");
  useEffect(() => {
    if (!recordParam) return;
    api
      .get<RecordOut>(`/api/objects/records/${recordParam}`)
      .then((r) => setOpenRec(r.data))
      .catch(() => toast.error("Запись не найдена"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordParam]);
  const closeRec = () => {
    setOpenRec(null);
    if (recordParam) setSp({ code: schema.code }, { replace: true });
  };

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/objects/records/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["object-records", schema.code] });
      toast.success("Запись удалена");
    },
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  const cols = schema.fields.filter((f) => f.type !== "textarea").slice(0, 4);

  return (
    <div className="card min-w-0 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{schema.label}</h2>
          <p className="text-xs text-neutral-500">{schema.fields.length} полей · {records?.length ?? 0} записей</p>
        </div>
        <div className="flex gap-2">
          {canManage && <Button variant="ghost" onClick={onEdit}><Pencil size={13} /> Поля</Button>}
          <Button variant="primary" onClick={() => setOpenRec("new")}><Plus size={14} /> Запись</Button>
        </div>
      </div>
      <div className="mb-3 max-w-xs">
        <SearchInput value={q} onChange={setQ} placeholder="Поиск по записям" />
      </div>

      {isPending ? (
        <div className="h-32 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/60" />
      ) : !records || records.length === 0 ? (
        <div className="py-8 text-center text-sm text-neutral-500">{q ? "Ничего не найдено" : "Записей пока нет"}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="table-head">
              <tr>
                <th className="table-head-cell">Название</th>
                {cols.map((f) => (
                  <th key={f.name} className="table-head-cell">{f.label}</th>
                ))}
                <th className="table-head-cell">Создана</th>
                <th className="table-head-cell text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="table-row">
                  <td className="table-cell font-medium">
                    <button type="button" className="hover:underline" onClick={() => setOpenRec(r)}>
                      {r.title || `#${r.id}`}
                    </button>
                  </td>
                  {cols.map((f) => (
                    <td key={f.name} className="table-cell text-neutral-600 dark:text-neutral-400">
                      <FieldValue field={f} record={r} />
                    </td>
                  ))}
                  <td className="table-cell text-xs text-neutral-500">
                    {new Date(r.created_at).toLocaleDateString("ru-RU")}
                  </td>
                  <td className="table-cell">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setOpenRec(r)} aria-label="Изменить"><Pencil size={13} /></Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-rose-500"
                        aria-label="Удалить"
                        onClick={() =>
                          confirm({
                            title: "Удалить запись?",
                            message: "Запись будет удалена без возможности восстановления.",
                            danger: true,
                            confirmLabel: "Удалить",
                            onConfirm: () => del.mutateAsync(r.id),
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </Button>
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
          schemas={schemas}
          initial={openRec === "new" ? null : openRec}
          onClose={closeRec}
        />
      )}
    </div>
  );
}

function FieldValue({ field, record }: { field: SchemaField; record: RecordOut }) {
  const target = targetOf(field);
  if (target) {
    const refs = record.refs?.[field.name] ?? [];
    if (!refs.length) return <>—</>;
    return (
      <span className="flex flex-wrap gap-x-2 gap-y-0.5">
        {refs.map((r) => <RefChip key={r.id} target={target} item={r} />)}
      </span>
    );
  }
  const v = record.data[field.name];
  if (v == null || v === "") return <>—</>;
  if (field.type === "checkbox") return <>{v ? "✓" : "—"}</>;
  if (field.type === "date" && typeof v === "string") return <>{new Date(v).toLocaleDateString("ru-RU")}</>;
  if (field.type === "number" && typeof v === "number") return <span className="tabular-nums">{v.toLocaleString("ru-RU")}</span>;
  return <>{String(v).slice(0, 100)}</>;
}

// ============================================================================
// Schema modal (create / edit)
// ============================================================================

const EMPTY_FIELD: SchemaField = { name: "", label: "", type: "text", required: false, options: null, target: null, multiple: false };

function SchemaModal({
  initial,
  schemas,
  onClose,
  onCreated,
}: {
  initial?: SchemaOut;
  schemas: SchemaOut[];
  onClose: () => void;
  onCreated?: (code: string) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const [label, setLabel] = useState(initial?.label || "");
  const [code, setCode] = useState(initial?.code || "");
  const [codeTouched, setCodeTouched] = useState(!!initial);
  const [fields, setFields] = useState<SchemaField[]>(initial?.fields || []);
  const [nf, setNf] = useState<SchemaField>(EMPTY_FIELD);
  const [optionsText, setOptionsText] = useState("");
  const [fieldErr, setFieldErr] = useState<string | null>(null);

  useEffect(() => {
    if (!codeTouched) setCode(slugify(label));
  }, [label, codeTouched]);

  const targets = useMemo(
    () => [
      ...SYSTEM_TARGETS,
      ...schemas.map((s) => ({ key: `object:${s.code}`, label: `Объект: ${s.label}` })),
      ...(!initial && code ? [{ key: `object:${code}`, label: `Объект: ${label || "эта сущность"}` }] : []),
    ],
    [schemas, initial, code, label],
  );
  const targetLabel = (t?: string | null) => targets.find((x) => x.key === t)?.label ?? t ?? "";

  const save = useMutation({
    mutationFn: async () => {
      if (initial) return (await api.patch<SchemaOut>(`/api/objects/schemas/${initial.id}`, { label, fields })).data;
      return (await api.post<SchemaOut>("/api/objects/schemas", { label, fields, code })).data;
    },
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["object-schemas"] });
      qc.invalidateQueries({ queryKey: ["object-records"] });
      toast.success(initial ? "Поля сохранены" : "Сущность создана");
      if (!initial) onCreated?.(s.code);
      onClose();
    },
    onError: (e) => setFormError(extractApiError(e).message),
  });

  const del = useMutation({
    mutationFn: () => api.delete(`/api/objects/schemas/${initial!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["object-schemas"] });
      toast.success("Сущность удалена");
      onClose();
    },
    onError: (e) => setFormError(extractApiError(e).message),
  });
  const confirm = useConfirm();

  const invalid = !label.trim() || (!initial && !/^[a-z][a-z0-9_]*$/.test(code));

  const addField = () => {
    setFieldErr(null);
    const lbl = nf.label.trim();
    if (!lbl) return setFieldErr("Введите название поля");
    let name = slugify(lbl) || "field";
    let n = 2;
    while (fields.some((f) => f.name === name)) name = `${slugify(lbl) || "field"}_${n++}`;
    const options = optionsText.split(/[\n,;]/).map((x) => x.trim()).filter(Boolean);
    if (nf.type === "select" && !options.length) return setFieldErr("Перечислите варианты через запятую");
    if (nf.type === "relation" && !nf.target) return setFieldErr("Выберите, с чем связывать");
    setFields([
      ...fields,
      {
        ...nf,
        name,
        label: lbl,
        options: nf.type === "select" ? options : null,
        target: nf.type === "relation" ? nf.target : null,
        multiple: nf.type === "relation" || nf.type === "user" ? !!nf.multiple : false,
      },
    ]);
    setNf(EMPTY_FIELD);
    setOptionsText("");
  };

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    setFields(next);
  };

  return (
    <Modal open onClose={onClose} title={initial ? `Поля: ${initial.label}` : "Новая сущность"} size="lg">
      <form onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate(); }} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Название</span>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Договоры" autoFocus />
          </label>
          <label className="block">
            <span className="label">Код (для API)</span>
            <input
              className="input font-mono text-[13px]"
              value={code}
              onChange={(e) => {
                setCodeTouched(true);
                setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""));
              }}
              placeholder="dogovory"
              disabled={!!initial}
            />
            <FieldError msg={!initial && code && !/^[a-z][a-z0-9_]*$/.test(code) ? "Код начинается с латинской буквы" : undefined} />
          </label>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Поля</div>
          {fields.length === 0 && <p className="text-[13px] text-neutral-500">Полей пока нет — добавьте ниже.</p>}
          <div className="space-y-1">
            {fields.map((f, i) => (
              <div key={f.name} className="flex items-center gap-2 rounded-lg border border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
                <div className="flex flex-col">
                  <button type="button" className="text-[10px] leading-none text-neutral-400 hover:text-neutral-700 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Выше">▲</button>
                  <button type="button" className="text-[10px] leading-none text-neutral-400 hover:text-neutral-700 disabled:opacity-30" disabled={i === fields.length - 1} onClick={() => move(i, 1)} aria-label="Ниже">▼</button>
                </div>
                <span className="min-w-0 flex-1 truncate text-sm">{f.label}</span>
                <span className="truncate text-xs text-neutral-500">
                  {FIELD_TYPE_LABEL[f.type]}
                  {f.type === "relation" && ` → ${targetLabel(f.target)}`}
                  {f.multiple && " · несколько"}
                  {f.type === "select" && f.options?.length ? ` · ${f.options.length} вар.` : ""}
                </span>
                <label className="flex items-center gap-1 text-[11px] text-neutral-500" title="Обязательное поле">
                  <input
                    type="checkbox"
                    checked={!!f.required}
                    onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))}
                  />
                  обяз.
                </label>
                <Button variant="ghost" size="icon" className="!p-1 text-rose-500" onClick={() => setFields(fields.filter((_, j) => j !== i))} aria-label="Удалить поле">
                  <Trash2 size={12} />
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-3 space-y-2 rounded-lg bg-neutral-50 p-3 dark:bg-white/[0.03]">
            <div className="grid gap-2 sm:grid-cols-[1fr_190px]">
              <input className="input" placeholder="Название поля, например «Сумма договора»" value={nf.label} onChange={(e) => setNf({ ...nf, label: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addField(); } }} />
              <select className="input" value={nf.type} onChange={(e) => setNf({ ...nf, type: e.target.value as FieldType })}>
                {(Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map((t) => (
                  <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
            {nf.type === "select" && (
              <input className="input" placeholder="Варианты через запятую: Поставка, Услуги, Подряд" value={optionsText} onChange={(e) => setOptionsText(e.target.value)} />
            )}
            {nf.type === "relation" && (
              <select className="input" value={nf.target ?? ""} onChange={(e) => setNf({ ...nf, target: e.target.value || null })}>
                <option value="">С чем связывать…</option>
                {targets.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-4 text-[13px]">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={!!nf.required} onChange={(e) => setNf({ ...nf, required: e.target.checked })} /> Обязательное
                </label>
                {(nf.type === "relation" || nf.type === "user") && (
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={!!nf.multiple} onChange={(e) => setNf({ ...nf, multiple: e.target.checked })} /> Несколько значений
                  </label>
                )}
              </div>
              <Button variant="secondary" size="sm" onClick={addField}><Plus size={13} /> Добавить поле</Button>
            </div>
            <FieldError msg={fieldErr} />
          </div>
        </div>

        <FormError msg={formError} />
        <div className="flex items-center justify-between gap-2 pt-1">
          {initial ? (
            <Button
              variant="ghost"
              className="text-rose-600"
              onClick={() =>
                confirm({
                  title: `Удалить «${initial.label}»?`,
                  message: "Будут удалены сущность и все её записи. Отменить нельзя.",
                  danger: true,
                  confirmLabel: "Удалить",
                  onConfirm: () => del.mutateAsync(),
                })
              }
            >
              <Trash2 size={13} /> Удалить сущность
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Отмена</Button>
            <Button type="submit" variant="primary" disabled={invalid} isLoading={save.isPending}>{initial ? "Сохранить" : "Создать"}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================================
// Record modal
// ============================================================================

function RecordModal({
  schema,
  schemas,
  initial,
  onClose,
}: {
  schema: SchemaOut;
  schemas: SchemaOut[];
  initial: RecordOut | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
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
      toast.success(initial ? "Запись сохранена" : "Запись создана");
      onClose();
    },
    onError: (e) => setFormError(extractApiError(e).message),
  });

  const backlinks = useQuery({
    enabled: !!initial,
    queryKey: ["object-backlinks", schema.code, initial?.id],
    queryFn: async () =>
      (await api.get<Backlink[]>("/api/objects/backlinks", { params: { target: `object:${schema.code}`, id: initial!.id } })).data,
  });
  const set = (name: string, v: any) => setData((d) => ({ ...d, [name]: v }));

  return (
    <Modal open onClose={onClose} title={initial ? initial.title || `${schema.label} #${initial.id}` : `Новая запись: ${schema.label}`} size="md">
      <form onSubmit={(e) => { e.preventDefault(); setFormError(null); save.mutate(); }} className="space-y-3">
        <label className="block">
          <span className="label">Название</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </label>
        {schema.fields.map((f) => {
          const target = targetOf(f);
          return (
            <div key={f.name}>
              <span className="label">
                {f.label} {f.required && <span className="text-rose-500">*</span>}
              </span>
              {target ? (
                <RecordPicker
                  target={target}
                  multiple={f.multiple}
                  value={data[f.name] ?? null}
                  known={initial?.refs?.[f.name]}
                  onChange={(v) => set(f.name, v)}
                  placeholder={f.type === "user" ? "Найдите сотрудника…" : "Найдите по названию…"}
                />
              ) : f.type === "textarea" ? (
                <textarea className="input min-h-[70px]" value={data[f.name] || ""} onChange={(e) => set(f.name, e.target.value)} />
              ) : f.type === "checkbox" ? (
                <input type="checkbox" checked={!!data[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
              ) : f.type === "select" ? (
                <select className="input" value={data[f.name] || ""} onChange={(e) => set(f.name, e.target.value)}>
                  <option value="">— выберите —</option>
                  {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.type === "date" ? (
                <DatePicker value={data[f.name] ?? ""} onChange={(v) => set(f.name, v)} aria-label={f.label} />
              ) : (
                <input
                  className="input"
                  type={f.type === "number" ? "number" : "text"}
                  step={f.type === "number" ? "any" : undefined}
                  value={data[f.name] ?? ""}
                  onChange={(e) => set(f.name, f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
                />
              )}
            </div>
          );
        })}

        {initial && (backlinks.data?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              <Link2 size={12} /> Ссылаются на эту запись
            </div>
            <ul className="space-y-1 text-[13px]">
              {backlinks.data!.map((b) => (
                <li key={`${b.schema_code}-${b.record.id}-${b.field_label}`} className="flex gap-2">
                  <span className="shrink-0 text-neutral-500">{b.schema_label} · {b.field_label}:</span>
                  <Link className="truncate text-brand-700 hover:underline dark:text-brand-300" to={b.record.url ?? "#"} onClick={onClose}>
                    {b.record.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <FormError msg={formError} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" isLoading={save.isPending}>{initial ? "Сохранить" : "Создать"}</Button>
        </div>
      </form>
    </Modal>
  );
}
