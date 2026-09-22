import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";
import "@excalidraw/excalidraw/index.css";
import { api, extractApiError } from "@/api/client";
import { Plus, Trash2, Pencil, PenSquare, Save } from "lucide-react";
import { EmptyState, Modal, FieldError, FormError } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";

type WhiteboardBrief = { id: number; title: string; created_at: string; updated_at: string };
type WhiteboardFull = WhiteboardBrief & { data: any };

export default function WhiteboardPage() {
  const [sp, setSp] = useSearchParams();
  const openId = sp.get("id");

  if (openId) return <BoardEditor id={Number(openId)} onBack={() => { const n = new URLSearchParams(sp); n.delete("id"); setSp(n, { replace: true }); }} />;
  return <BoardList onOpen={(id) => { const n = new URLSearchParams(sp); n.set("id", String(id)); setSp(n, { replace: true }); }} />;
}

// ============================================================================
// List of boards
// ============================================================================

function BoardList({ onOpen }: { onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [openNew, setOpenNew] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["whiteboards"],
    queryFn: async () => (await api.get<WhiteboardBrief[]>("/api/whiteboards")).data,
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/whiteboards/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whiteboards"] });
      toast.success("Доска удалена");
    },
    onError: (e) => toast.error("Не удалось удалить", extractApiError(e).message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Доски</h1>
          <p className="text-sm text-neutral-500">Совместные whiteboard-доски на Excalidraw</p>
        </div>
        <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setOpenNew(true)}>
          Новая доска
        </Button>
      </div>

      {isPending ? (
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState icon={<PenSquare size={32} />} title="Досок пока нет" description="Создайте первую — рисуйте схемы, mind-map, wireframes" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {data.map((b) => (
            <div key={b.id} className="card-interactive group flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <button className="flex-1 text-left" onClick={() => onOpen(b.id)}>
                  <div className="font-semibold hover:text-brand-700 dark:hover:text-brand-300">{b.title}</div>
                  <div className="mt-1 text-xs text-neutral-500">
                    Обновлено {new Date(b.updated_at).toLocaleString("ru-RU")}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-rose-500 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() =>
                    confirm({
                      title: "Удалить доску?",
                      message: `«${b.title}» будет удалена без возможности восстановления.`,
                      danger: true,
                      confirmLabel: "Удалить",
                      onConfirm: () => del.mutateAsync(b.id),
                    })
                  }
                  aria-label="Удалить доску"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {openNew && <NewBoardModal onClose={() => setOpenNew(false)} onCreated={(id) => onOpen(id)} />}
    </div>
  );
}

function NewBoardModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("Новая доска");
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<WhiteboardFull>("/api/whiteboards", { title, data: {} }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["whiteboards"] });
      onCreated(r.data.id);
      onClose();
    },
    onError: (e) => setFormError(extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title="Новая доска" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) create.mutate();
        }}
        className="space-y-3"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Название</span>
          <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
          <FieldError msg={!title.trim() ? "Обязательно" : undefined} />
        </label>
        <FormError msg={formError} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={!title.trim()} isLoading={create.isPending}>Создать</Button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================================
// Board editor (Excalidraw)
// ============================================================================

function BoardEditor({ id, onBack }: { id: number; onBack: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [savePending, setSavePending] = useState(false);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const debounceRef = useRef<number | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ["whiteboard", id],
    queryFn: async () => (await api.get<WhiteboardFull>(`/api/whiteboards/${id}`)).data,
  });

  const save = useMutation({
    mutationFn: (payload: { title?: string; data?: any }) => api.patch(`/api/whiteboards/${id}`, payload),
    onMutate: () => setSavePending(true),
    onSuccess: () => {
      setSavedAt(new Date());
      qc.invalidateQueries({ queryKey: ["whiteboards"] });
    },
    onError: (e) => toast.error("Не удалось сохранить", extractApiError(e).message),
    onSettled: () => setSavePending(false),
  });

  const scheduleSave = useCallback((scene: any) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      save.mutate({ data: scene });
    }, 1500);
  }, [save]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, []);

  if (isPending) return <div className="h-96 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />;
  if (!data) return <EmptyState icon={<PenSquare size={32} />} title="Доска не найдена" />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <button className="mb-1 text-xs text-neutral-500 hover:text-brand-600" onClick={onBack}>
            ← К списку досок
          </button>
          <TitleEditor title={data.title} onSave={(t) => save.mutate({ title: t })} />
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          {savePending ? (
            <span className="flex items-center gap-1"><Save size={12} className="animate-pulse" /> Сохранение…</span>
          ) : savedAt ? (
            <span>Сохранено в {savedAt.toLocaleTimeString("ru-RU")}</span>
          ) : (
            <span>Автосохранение через 1.5с после правки</span>
          )}
        </div>
      </div>

      <div className="h-[75vh] overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
        <Excalidraw
          excalidrawAPI={(instance) => { apiRef.current = instance; }}
          initialData={{
            elements: (data.data as any)?.elements || [],
            appState: (data.data as any)?.appState || {},
          }}
          onChange={(elements, appState, files) => {
            // Собираем сцену для сохранения. Только элементы+minimal appState (без viewport).
            const sceneToSave = {
              elements,
              appState: { viewBackgroundColor: appState.viewBackgroundColor, gridSize: appState.gridSize },
              files: files || {},
            };
            scheduleSave(sceneToSave);
          }}
        />
      </div>
    </div>
  );
}

function TitleEditor({ title, onSave }: { title: string; onSave: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);

  useEffect(() => setValue(title), [title]);

  if (editing) {
    return (
      <input
        className="input max-w-md text-lg font-semibold"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => { setEditing(false); if (value.trim() && value !== title) onSave(value.trim()); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setValue(title); setEditing(false); } }}
      />
    );
  }
  return (
    <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xl font-semibold tracking-tight hover:text-brand-700 dark:hover:text-brand-300">
      {title}
      <Pencil size={12} className="opacity-40" />
    </button>
  );
}
