/**
 * Карточка документа: номер, дата, статус, связи с записями (проекты, сделки, записи Объектов…)
 * и версии файла — загрузка новой версии с комментарием, скачивание любой версии, возврат к прежней.
 */
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, RotateCcw, Upload, X } from "lucide-react";
import clsx from "clsx";

import { api, extractApiError } from "@/api/client";
import { Modal, FormError } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { FormField } from "@/components/lib/FormField";
import { DatePicker } from "@/components/DatePicker";
import { RecordPicker, SYSTEM_TARGETS } from "@/components/RecordPicker";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { useAuth } from "@/store/auth";

type LinkOut = { target: string; id: number; kind: string; label: string; url: string | null; accessible: boolean };
type VersionOut = {
  id: number;
  version_no: number;
  filename: string | null;
  size: number;
  sha256: string | null;
  comment: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  is_current: boolean;
};
type CardOut = {
  document: {
    id: number;
    name: string;
    doc_number: string | null;
    doc_date: string | null;
    doc_status: string | null;
    contract_id?: number | null;
    created_by?: number | null;
  };
  links: LinkOut[];
  versions: VersionOut[];
  statuses: Record<string, string>;
  can_upload_version: boolean;
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export async function downloadDocumentVersion(docId: number, v: { id: number; filename: string | null }, fallbackName: string) {
  const res = await api.get<Blob>(`/api/documents/${docId}/versions/${v.id}/download`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = v.filename || fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** canManageAll — право менять любые документы; автор свой документ меняет всегда (как и на сервере). */
export function DocumentCard({ docId, canManageAll, onClose }: { docId: number; canManageAll: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const myId = useAuth((s) => s.me?.id);
  const { data, isPending, error } = useQuery({
    queryKey: ["doc-card", docId],
    queryFn: async () => (await api.get<CardOut>(`/api/documents/${docId}/card`)).data,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["doc-card", docId] });
    qc.invalidateQueries({ queryKey: ["docs"] });
    qc.invalidateQueries({ queryKey: ["company-docs"] });
  };

  return (
    <Modal open onClose={onClose} title={data?.document.name ?? "Документ"} size="lg">
      {isPending ? (
        <div className="h-48 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/60" />
      ) : error || !data ? (
        <FormError msg={extractApiError(error).message} />
      ) : (
        <div className="space-y-5">
          <Properties card={data} canEdit={canManageAll || data.document.created_by === myId} onSaved={refresh} onNavigate={onClose} />
          <Versions card={data} onChanged={refresh} />
        </div>
      )}
    </Modal>
  );
}

function Properties({ card, canEdit, onSaved, onNavigate }: { card: CardOut; canEdit: boolean; onSaved: () => void; onNavigate: () => void }) {
  const toast = useToast();
  const d = card.document;
  const [number, setNumber] = useState(d.doc_number ?? "");
  const [date, setDate] = useState(d.doc_date ?? "");
  const [status, setStatus] = useState(d.doc_status ?? "");
  const [links, setLinks] = useState<LinkOut[]>(card.links);
  const [addTarget, setAddTarget] = useState("project");

  const { data: objectSchemas } = useQuery({
    enabled: canEdit,
    queryKey: ["object-schemas"],
    queryFn: async () => (await api.get<{ code: string; label: string }[]>("/api/objects/schemas")).data,
    staleTime: 60_000,
  });
  const targets = [
    ...SYSTEM_TARGETS.filter((t) => t.key !== "user"),
    ...(objectSchemas ?? []).map((s) => ({ key: `object:${s.code}`, label: `Объекты · ${s.label}` })),
  ];

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/documents/${d.id}`, {
        doc_number: number.trim(),
        doc_date: date || null,
        doc_status: status,
        links: links.map((l) => ({ target: l.target, id: l.id })),
      }),
    onSuccess: () => {
      toast.success("Карточка сохранена");
      onSaved();
    },
    onError: (e) => toast.error("Не удалось сохранить", extractApiError(e).message),
  });

  if (!canEdit) {
    return (
      <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <Prop label="Номер">{d.doc_number || "—"}</Prop>
        <Prop label="Дата">{d.doc_date ? new Date(d.doc_date).toLocaleDateString("ru-RU") : "—"}</Prop>
        <Prop label="Статус">{(d.doc_status && card.statuses[d.doc_status]) || "—"}</Prop>
        <div className="sm:col-span-3">
          <Prop label="Связи">
            <LinkList links={card.links} onNavigate={onNavigate} />
          </Prop>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Номер">
          <input className="input" value={number} maxLength={100} onChange={(e) => setNumber(e.target.value)} placeholder="Номер документа" />
        </FormField>
        <FormField label="Дата">
          <DatePicker value={date} onChange={(v) => setDate(v || "")} aria-label="Дата документа" />
        </FormField>
        <FormField label="Статус">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Без статуса</option>
            {Object.entries(card.statuses).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </FormField>
      </div>
      <FormField label="Связи с записями">
        <div className="space-y-2">
          <LinkList links={links} onNavigate={onNavigate} onRemove={(l) => setLinks(links.filter((x) => !(x.target === l.target && x.id === l.id)))} />
          <div className="flex flex-wrap items-start gap-2">
            <select className="input w-auto" value={addTarget} onChange={(e) => setAddTarget(e.target.value)} aria-label="К чему привязать">
              {targets.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
            <div className="min-w-[220px] flex-1">
              <RecordPicker
                key={addTarget}
                target={addTarget}
                value={null}
                placeholder="Найдите запись, чтобы привязать"
                onChange={(_v, items) => {
                  const it = items[0];
                  if (!it || links.some((l) => l.target === addTarget && l.id === it.id)) return;
                  const kind = targets.find((t) => t.key === addTarget)?.label ?? addTarget;
                  setLinks([...links, { target: addTarget, id: it.id, kind, label: it.label, url: it.url ?? null, accessible: true }]);
                }}
              />
            </div>
          </div>
        </div>
      </FormField>
      <div className="flex justify-end">
        <Button variant="primary" isLoading={save.isPending} onClick={() => save.mutate()}>
          Сохранить карточку
        </Button>
      </div>
    </div>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function LinkList({ links, onRemove, onNavigate }: { links: LinkOut[]; onRemove?: (l: LinkOut) => void; onNavigate: () => void }) {
  if (!links.length) return <div className="text-sm text-neutral-400">Не привязан ни к одной записи</div>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {links.map((l) => (
        <span
          key={`${l.target}-${l.id}`}
          className="inline-flex max-w-full items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-[12.5px] text-brand-800 dark:bg-brand-500/15 dark:text-brand-200"
        >
          <span className="shrink-0 text-brand-600/70 dark:text-brand-300/70">{l.kind}:</span>
          {l.url && l.accessible ? (
            <Link to={l.url} className="truncate hover:underline" onClick={onNavigate}>{l.label}</Link>
          ) : (
            <span className="truncate" title={l.accessible ? undefined : "Нет доступа к записи"}>{l.label}</span>
          )}
          {onRemove && (
            <button type="button" className="opacity-60 hover:opacity-100" onClick={() => onRemove(l)} aria-label={`Отвязать ${l.label}`}>
              <X size={11} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

function Versions({ card, onChanged }: { card: CardOut; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [comment, setComment] = useState("");
  const d = card.document;

  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("file", file!);
      if (comment.trim()) fd.append("comment", comment.trim());
      return api.post(`/api/documents/${d.id}/versions`, fd, { headers: { "Content-Type": "multipart/form-data" } });
    },
    onSuccess: () => {
      toast.success("Новая версия загружена");
      setFile(null);
      setComment("");
      onChanged();
    },
    onError: (e) => toast.error("Не удалось загрузить", extractApiError(e).message),
  });
  const restore = useMutation({
    mutationFn: (vid: number) => api.post(`/api/documents/${d.id}/versions/${vid}/restore`),
    onSuccess: () => {
      toast.success("Версия восстановлена");
      onChanged();
    },
    onError: (e) => toast.error("Не удалось вернуть версию", extractApiError(e).message),
  });
  const download = async (v: VersionOut) => {
    try {
      await downloadDocumentVersion(d.id, v, d.name);
      if (!v.sha256) onChanged(); // хэш посчитан при выгрузке
    } catch (e) {
      toast.error("Не удалось скачать", extractApiError(e).message);
    }
  };

  return (
    <div>
      <div className="mb-2 text-sm font-semibold">Версии</div>
      {card.can_upload_version && (
        <div className="mb-3 rounded-lg border border-dashed border-neutral-300 p-3 dark:border-neutral-700">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          {file ? (
            <div className="space-y-2">
              <div className="truncate text-sm font-medium">{file.name} <span className="font-normal text-neutral-500">· {fmtSize(file.size)}</span></div>
              <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder="Что изменилось в этой версии" />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setFile(null)}>Отмена</Button>
                <Button variant="primary" isLoading={upload.isPending} onClick={() => upload.mutate()}>
                  Загрузить версию
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" leftIcon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>
              Загрузить новую версию
            </Button>
          )}
        </div>
      )}
      <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {card.versions.map((v) => (
          <li key={v.id} className={clsx("flex items-start gap-3 px-3 py-2.5", v.is_current && "bg-brand-50/50 dark:bg-brand-500/5")}>
            <span className="mt-0.5 w-9 shrink-0 text-sm font-semibold tabular-nums">v{v.version_no}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="truncate">{v.filename || d.name}</span>
                {v.is_current && (
                  <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10.5px] font-medium text-brand-800 dark:bg-brand-500/20 dark:text-brand-200">текущая</span>
                )}
              </div>
              <div className="text-xs text-neutral-500">
                {new Date(v.created_at).toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                {v.uploaded_by_name && ` · ${v.uploaded_by_name}`} · {fmtSize(v.size)}
              </div>
              {v.comment && <div className="mt-0.5 text-[13px] text-neutral-700 dark:text-neutral-300">{v.comment}</div>}
              {v.sha256 && (
                <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-400" title={`SHA-256: ${v.sha256}`}>
                  SHA-256: {v.sha256}
                </div>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={() => download(v)} title="Скачать эту версию" aria-label="Скачать эту версию">
              <Download size={13} />
            </Button>
            {card.can_upload_version && !v.is_current && (
              <Button
                variant="ghost"
                size="icon"
                title="Сделать текущей"
                aria-label="Сделать текущей"
                disabled={restore.isPending}
                onClick={() =>
                  confirm({
                    title: `Вернуть версию ${v.version_no}?`,
                    message: "Она станет текущей. Остальные версии сохранятся в истории.",
                    confirmLabel: "Вернуть",
                    onConfirm: () => restore.mutateAsync(v.id),
                  })
                }
              >
                {restore.isPending ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
