import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import {
  FolderPlus, Folder, FileText, Upload, Trash2, Share2, Eye, Download, ChevronLeft,
} from "lucide-react";
import { EmptyState, Modal, FieldError, FormError } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { fromNow } from "@/lib/date";

type Folder = { id: number; parent_id: number | null; name: string; created_at: string };
type Doc = {
  id: number;
  folder_id: number | null;
  name: string;
  mime: string | null;
  size: number;
  version_count: number;
  is_public: boolean;
  public_slug: string | null;
  created_at: string;
  updated_at: string;
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [folderId, setFolderId] = useState<number | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Folder[]>([]);
  const [openNewFolder, setOpenNewFolder] = useState(false);
  const [openPreview, setOpenPreview] = useState<Doc | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const { data: folders } = useQuery({
    queryKey: ["doc-folders", folderId],
    queryFn: async () =>
      (await api.get<Folder[]>("/api/documents/folders", { params: { parent_id: folderId ?? undefined } })).data,
  });
  const { data: docs, isPending } = useQuery({
    queryKey: ["docs", folderId],
    queryFn: async () =>
      (await api.get<Doc[]>("/api/documents", { params: { folder_id: folderId ?? undefined } })).data,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      if (folderId != null) fd.append("folder_id", String(folderId));
      return api.post<Doc>("/api/documents/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
    },
    onSuccess: () => {
      toast.success("Файл загружен");
      qc.invalidateQueries({ queryKey: ["docs"] });
    },
    onError: (e) => toast.error("Не удалось загрузить", extractApiError(e).message),
  });

  const publish = useMutation({
    mutationFn: (id: number) => api.post(`/api/documents/${id}/publish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docs"] }),
  });
  const unpublish = useMutation({
    mutationFn: (id: number) => api.post(`/api/documents/${id}/unpublish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docs"] }),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/documents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docs"] });
      toast.success("Документ удалён");
    },
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  const openFolder = (f: Folder) => {
    setBreadcrumbs([...breadcrumbs, f]);
    setFolderId(f.id);
  };
  const goUp = () => {
    if (breadcrumbs.length === 0) return;
    const nb = breadcrumbs.slice(0, -1);
    setBreadcrumbs(nb);
    setFolderId(nb.length > 0 ? nb[nb.length - 1].id : null);
  };
  const goRoot = () => {
    setBreadcrumbs([]);
    setFolderId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Документы</h1>
          <p className="text-sm text-neutral-500">Файловое хранилище с версиями и публичными ссылками</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={() => setOpenNewFolder(true)}>
            <FolderPlus size={15} /> Папка
          </button>
          <input
            ref={uploadRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
          <button className="btn-primary" onClick={() => uploadRef.current?.click()}>
            <Upload size={15} /> Загрузить файл
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        {breadcrumbs.length > 0 && (
          <button onClick={goUp} className="btn-ghost !p-1">
            <ChevronLeft size={14} />
          </button>
        )}
        <button onClick={goRoot} className="hover:text-brand-600">
          Корень
        </button>
        {breadcrumbs.map((b, i) => (
          <span key={b.id}>
            <span className="text-neutral-400"> / </span>
            <button
              onClick={() => {
                setBreadcrumbs(breadcrumbs.slice(0, i + 1));
                setFolderId(b.id);
              }}
              className="hover:text-brand-600"
            >
              {b.name}
            </button>
          </span>
        ))}
      </div>

      {(folders && folders.length > 0) && (
        <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-4">
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => openFolder(f)}
              className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-left hover:border-brand-500 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900/50"
            >
              <Folder size={18} className="text-amber-500" />
              <span className="truncate font-medium">{f.name}</span>
            </button>
          ))}
        </div>
      )}

      {isPending ? (
        <div className="h-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />
      ) : !docs || docs.length === 0 ? (
        <EmptyState icon={<FileText size={32} />} title="В этой папке пусто" description="Загрузите файл или создайте вложенную папку" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500 dark:bg-neutral-900/60">
              <tr>
                <th className="px-3 py-2">Имя</th>
                <th className="px-3 py-2">Размер</th>
                <th className="px-3 py-2">Версий</th>
                <th className="px-3 py-2">Обновлён</th>
                <th className="px-3 py-2 text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-neutral-400" />
                      <span className="truncate font-medium">{d.name}</span>
                      {d.is_public && (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">public</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-500 tabular-nums">{fmtSize(d.size)}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500 tabular-nums">v{d.version_count}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500">{fromNow(d.updated_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button className="btn-ghost !p-1.5" onClick={() => setOpenPreview(d)} title="Просмотр">
                        <Eye size={13} />
                      </button>
                      {d.is_public && d.public_slug && (
                        <a href={`/public/documents/${d.public_slug}/download`} target="_blank" rel="noreferrer" className="btn-ghost !p-1.5" title="Скачать">
                          <Download size={13} />
                        </a>
                      )}
                      {d.is_public ? (
                        <button className="btn-ghost !p-1.5 text-emerald-600" onClick={() => unpublish.mutate(d.id)} title="Убрать публичность">
                          <Share2 size={13} />
                        </button>
                      ) : (
                        <button className="btn-ghost !p-1.5" onClick={() => publish.mutate(d.id)} title="Опубликовать">
                          <Share2 size={13} />
                        </button>
                      )}
                      <button
                        className="btn-ghost !p-1.5 text-rose-500"
                        onClick={() =>
                          confirm({
                            title: "Удалить документ?",
                            message: `«${d.name}» будет удалён.`,
                            danger: true,
                            confirmLabel: "Удалить",
                            onConfirm: () => del.mutateAsync(d.id),
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

      {openNewFolder && (
        <NewFolderModal parentId={folderId} onClose={() => setOpenNewFolder(false)} />
      )}
      {openPreview && <PreviewModal doc={openPreview} onClose={() => setOpenPreview(null)} />}
    </div>
  );
}

function NewFolderModal({ parentId, onClose }: { parentId: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post("/api/documents/folders", { name, parent_id: parentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["doc-folders"] });
      onClose();
    },
    onError: (e) => setErr(extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title="Новая папка" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
        className="space-y-3"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          <FieldError msg={!name.trim() ? "Обязательно" : undefined} />
        </label>
        <FormError msg={err} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn-primary" disabled={!name.trim() || create.isPending}>Создать</button>
        </div>
      </form>
    </Modal>
  );
}

function PreviewModal({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["doc-preview", doc.id],
    queryFn: async () => (await api.get<{ kind: string; url: string | null; message: string | null }>(`/api/documents/${doc.id}/preview-url`)).data,
  });

  return (
    <Modal open onClose={onClose} title={doc.name} size="xl">
      {!data ? (
        <div className="h-96 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/60" />
      ) : data.kind === "download_only" ? (
        <div className="py-8 text-center">
          <FileText size={48} className="mx-auto mb-3 text-neutral-400" />
          <div className="text-sm text-neutral-500">{data.message || "Онлайн-просмотр недоступен"}</div>
          <div className="mt-3 text-xs text-neutral-400">Опубликуйте документ, чтобы получить публичную ссылку для просмотра</div>
        </div>
      ) : data.url ? (
        <iframe src={data.url} className="h-[70vh] w-full rounded border border-neutral-200 dark:border-neutral-800" title={doc.name} />
      ) : (
        <div className="py-8 text-center text-sm text-neutral-500">Не удалось получить preview</div>
      )}
    </Modal>
  );
}
