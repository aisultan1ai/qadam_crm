import { FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, API_URL } from "@/api/client";
import type { Task, Project, User } from "@/types";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_ORDER } from "@/types";
import { Avatar, Loader, PriorityChip, StatusChip } from "@/components/ui";
import { ArrowLeft, Paperclip, Send, Trash2, Plus, Check, X } from "lucide-react";
import { useAuth } from "@/store/auth";

export default function TaskDetail() {
  const { id } = useParams();
  const taskId = Number(id);
  const { me, can } = useAuth();
  const qc = useQueryClient();

  const { data: task } = useQuery({
    queryKey: ["task", taskId],
    queryFn: async () => (await api.get<Task>(`/api/tasks/${taskId}`)).data,
  });
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await api.get<Project[]>("/api/projects")).data,
  });
  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await api.get<User[]>("/api/users")).data,
  });

  const patch = useMutation({
    mutationFn: (body: any) => api.patch(`/api/tasks/${taskId}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const addComment = useMutation({
    mutationFn: (body: string) => api.post(`/api/tasks/${taskId}/comments`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
  });
  const deleteComment = useMutation({
    mutationFn: (cid: number) => api.delete(`/api/tasks/${taskId}/comments/${cid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const addCheck = useMutation({
    mutationFn: (text: string) => api.post(`/api/tasks/${taskId}/checklist`, { text, done: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
  });
  const toggleCheck = useMutation({
    mutationFn: (item: { id: number; text: string; done: boolean }) =>
      api.patch(`/api/tasks/${taskId}/checklist/${item.id}`, { text: item.text, done: !item.done }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
  });
  const removeCheck = useMutation({
    mutationFn: (cid: number) => api.delete(`/api/tasks/${taskId}/checklist/${cid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const [comment, setComment] = useState("");
  const [newCheck, setNewCheck] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  if (!task) return <Loader />;

  const submitComment = (e: FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    addComment.mutate(comment);
    setComment("");
  };

  const uploadFile = async (f: File) => {
    const fd = new FormData();
    fd.append("file", f);
    await api.post(`/api/tasks/${taskId}/attachments`, fd, { headers: { "Content-Type": "multipart/form-data" } });
    qc.invalidateQueries({ queryKey: ["task", taskId] });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Link to="/tasks" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
          <ArrowLeft size={14} /> Задачи
        </Link>

        <div>
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <input className="input text-xl font-semibold" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} />
              <button className="btn-primary" onClick={() => { patch.mutate({ title: titleDraft }); setEditingTitle(false); }}>Сохранить</button>
              <button className="btn-ghost" onClick={() => setEditingTitle(false)}>Отмена</button>
            </div>
          ) : (
            <h1
              className="cursor-text text-2xl font-semibold tracking-tight"
              onClick={() => can("tasks.update") && (setTitleDraft(task.title), setEditingTitle(true))}
            >
              {task.title}
            </h1>
          )}
          <div className="mt-1 text-xs text-neutral-500">
            Автор: {task.author?.name || "—"} · создано {new Date(task.created_at).toLocaleString("ru-RU")}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="mb-2 text-sm font-semibold">Описание</h3>
          <TextareaAuto
            disabled={!can("tasks.update")}
            initial={task.description || ""}
            onSave={(v) => patch.mutate({ description: v })}
            placeholder="Добавьте описание…"
          />
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Чек-лист</h3>
            <span className="text-xs text-neutral-500">
              {task.checklist.filter((i) => i.done).length}/{task.checklist.length}
            </span>
          </div>
          <div className="space-y-1.5">
            {task.checklist.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
                <button
                  onClick={() => toggleCheck.mutate(item)}
                  className={`grid h-5 w-5 place-items-center rounded border ${item.done ? "border-brand-600 bg-brand-600 text-white" : "border-neutral-300 dark:border-neutral-600"}`}
                >
                  {item.done && <Check size={12} />}
                </button>
                <span className={item.done ? "flex-1 text-sm line-through text-neutral-400" : "flex-1 text-sm"}>{item.text}</span>
                <button className="btn-ghost !p-1 opacity-0 group-hover:opacity-100" onClick={() => removeCheck.mutate(item.id)}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className="input"
              placeholder="Добавить пункт…"
              value={newCheck}
              onChange={(e) => setNewCheck(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newCheck.trim()) {
                  addCheck.mutate(newCheck);
                  setNewCheck("");
                }
              }}
            />
            <button className="btn-secondary" onClick={() => newCheck.trim() && (addCheck.mutate(newCheck), setNewCheck(""))}>
              <Plus size={14} />
            </button>
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Комментарии</h3>
            <span className="text-xs text-neutral-500">{task.comments.length}</span>
          </div>
          <div className="space-y-4">
            {task.comments.map((c) => (
              <div key={c.id} className="group flex gap-3">
                <Avatar name={c.author?.name} url={c.author?.avatar_url} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">{c.author?.name || "—"}</span>
                    <span>{new Date(c.created_at).toLocaleString("ru-RU")}</span>
                    {can("comments.delete") && (
                      <button
                        className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-rose-500"
                        onClick={() => deleteComment.mutate(c.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap text-sm">{c.body}</div>
                </div>
              </div>
            ))}
          </div>
          {can("comments.create") && (
            <form onSubmit={submitComment} className="mt-4 flex gap-2">
              <input
                className="input"
                placeholder="Написать комментарий. Используйте @email для упоминания…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <button type="submit" className="btn-primary" disabled={!comment.trim()}>
                <Send size={14} />
              </button>
            </form>
          )}
        </div>

        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold">История изменений</h3>
          <div className="space-y-2 text-sm">
            {task.activities.length === 0 && <div className="text-neutral-500">Пока пусто</div>}
            {task.activities.map((a) => (
              <div key={a.id} className="flex items-start gap-2 text-neutral-600 dark:text-neutral-400">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-neutral-400" />
                <div>
                  <span className="text-neutral-900 dark:text-neutral-200 font-medium">{a.user?.name || "Система"}</span>
                  {" "}<span>{a.action}</span>
                  {a.detail && <span className="text-neutral-500"> · {a.detail}</span>}
                  <div className="text-[11px] text-neutral-500">{new Date(a.created_at).toLocaleString("ru-RU")}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="card p-5">
          <div className="space-y-3 text-sm">
            <Field label="Статус">
              <select
                className="input"
                disabled={!can("tasks.change_status")}
                value={task.status}
                onChange={(e) => patch.mutate({ status: e.target.value })}
              >
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </Field>

            <Field label="Приоритет">
              <select
                className="input"
                disabled={!can("tasks.change_priority")}
                value={task.priority}
                onChange={(e) => patch.mutate({ priority: e.target.value })}
              >
                {(["low", "medium", "high", "critical"] as const).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </select>
            </Field>

            <Field label="Проект">
              <select
                className="input"
                disabled={!can("tasks.update")}
                value={task.project_id ?? ""}
                onChange={(e) => patch.mutate({ project_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">—</option>
                {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>

            <Field label="Исполнитель">
              <select
                className="input"
                disabled={!can("tasks.assign")}
                value={task.assignee?.id ?? ""}
                onChange={(e) => patch.mutate({ assignee_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">—</option>
                {users?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>

            <Field label="Дедлайн">
              <input
                className="input"
                type="datetime-local"
                disabled={!can("tasks.update")}
                value={task.deadline ? task.deadline.substring(0, 16) : ""}
                onChange={(e) => patch.mutate({ deadline: e.target.value ? new Date(e.target.value).toISOString() : null })}
              />
            </Field>
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Вложения</h3>
            {can("files.upload") && (
              <label className="btn-secondary cursor-pointer !py-1 !px-2 text-xs">
                <Paperclip size={12} /> Загрузить
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => e.target.files && e.target.files[0] && uploadFile(e.target.files[0])}
                />
              </label>
            )}
          </div>
          <div className="space-y-1.5">
            {task.attachments.length === 0 && <div className="text-sm text-neutral-500">Нет вложений</div>}
            {task.attachments.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg px-2 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
                <a
                  href={`${API_URL}/api/tasks/${taskId}/attachments/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm link"
                >
                  {a.filename}
                </a>
                <span className="text-xs text-neutral-500">{formatSize(a.size)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <div className="text-xs text-neutral-500">Текущий статус</div>
          <div className="mt-2 flex gap-2">
            <StatusChip status={task.status} />
            <PriorityChip priority={task.priority} />
          </div>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-neutral-500">{label}</div>
      {children}
    </div>
  );
}

function TextareaAuto({
  initial,
  onSave,
  disabled,
  placeholder,
}: {
  initial: string;
  onSave: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(true);
  return (
    <>
      <textarea
        className="input min-h-[100px]"
        disabled={disabled}
        placeholder={placeholder}
        value={v}
        onChange={(e) => { setV(e.target.value); setSaved(false); }}
        onBlur={() => { if (!saved) { onSave(v); setSaved(true); } }}
      />
      <div className="mt-1 text-[11px] text-neutral-400">{saved ? "Сохранено" : "Изменено — авто-сохранение при потере фокуса"}</div>
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
