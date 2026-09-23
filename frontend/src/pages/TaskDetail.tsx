import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api, API_URL, extractApiError } from "@/api/client";
import type { Task, TaskStatus, TaskPriority, Project, User, Page, Comment as CommentT } from "@/types";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_ORDER } from "@/types";

const ACTION_LABEL: Record<string, string> = {
  create: "создал(а)",
  update: "обновил(а)",
  delete: "удалил(а)",
  bulk_update: "массовое обновление",
};

const isTaskStatus = (v: string): v is TaskStatus =>
  v === "new" || v === "in_progress" || v === "review" || v === "done" || v === "cancelled";
const isTaskPriority = (v: string): v is TaskPriority =>
  v === "low" || v === "medium" || v === "high" || v === "critical";

function localizeChange(chunk: string): string {
  const trimmed = chunk.trim();
  const statusMatch = trimmed.match(/^статус\s+(\S+)\s*→\s*(\S+)$/);
  if (statusMatch) {
    const [, from, to] = statusMatch;
    const l = (s: string) => (isTaskStatus(s) ? STATUS_LABEL[s] : s);
    return `статус ${l(from)} → ${l(to)}`;
  }
  const prioMatch = trimmed.match(/^приоритет\s+(\S+)\s*→\s*(\S+)$/);
  if (prioMatch) {
    const [, from, to] = prioMatch;
    const l = (p: string) => (isTaskPriority(p) ? PRIORITY_LABEL[p] : p);
    return `приоритет ${l(from)} → ${l(to)}`;
  }
  return trimmed;
}

function formatActivityDetail(detail: string | null | undefined): string {
  if (!detail) return "";
  return detail.split(",").map(localizeChange).join(", ");
}
import { Avatar, Loader, PriorityChip, StatusChip } from "@/components/ui";
import { Button } from "@/components/lib/Button";
import {
  ArrowLeft, Paperclip, Send, Trash2, Plus, Check, X, Smile, Pencil,
  ChevronRight, Calendar, User as UserIcon, Flag, FolderKanban, UserCircle2,
  AlertTriangle, Clock, Flame, Eye, Users, BellRing, CircleDot,
} from "lucide-react";
import { useAuth } from "@/store/auth";
import { useToast } from "@/components/Toast";
import { TaskTimerButton } from "@/components/TaskTimerButton";
import { SaveIndicator } from "@/components/lib/SaveIndicator";
import { useAutoSave } from "@/hooks/useAutoSave";
import { fromNow } from "@/lib/date";
import { UserMultiSelect } from "@/components/lib/UserMultiSelect";
import type { TaskReminder, UserBrief } from "@/types";

type RoleName = "assignees" | "auditors" | "participants";

const REMINDER_PRESETS: { label: string; kind: "before_deadline" | "before_start"; offset_minutes: number }[] = [
  { label: "За 1 день до завершения", kind: "before_deadline", offset_minutes: 24 * 60 },
  { label: "За 3 часа до завершения", kind: "before_deadline", offset_minutes: 3 * 60 },
  { label: "За 1 час до завершения", kind: "before_deadline", offset_minutes: 60 },
  { label: "За 1 день до начала", kind: "before_start", offset_minutes: 24 * 60 },
  { label: "За 1 час до начала", kind: "before_start", offset_minutes: 60 },
];

function reminderLabel(r: TaskReminder): string {
  const preset = REMINDER_PRESETS.find((p) => p.kind === r.kind && p.offset_minutes === r.offset_minutes);
  if (preset) return preset.label;
  const h = Math.floor(r.offset_minutes / 60);
  const m = r.offset_minutes % 60;
  const suffix = r.kind === "before_deadline" ? "до завершения" : "до начала";
  if (h && m) return `За ${h} ч ${m} мин ${suffix}`;
  if (h) return `За ${h} ч ${suffix}`;
  return `За ${m} мин ${suffix}`;
}

type DeadlineTone = "neutral" | "warning" | "danger" | "muted";

function deadlineInfo(deadline: string | null | undefined): { text: string; tone: DeadlineTone } {
  if (!deadline) return { text: "Без срока", tone: "muted" };
  const d = new Date(deadline);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const days = Math.round(diffMs / 86_400_000);
  if (days < 0) return { text: `Просрочено на ${Math.abs(days)} дн.`, tone: "danger" };
  if (days === 0) return { text: "Сегодня — последний день", tone: "warning" };
  if (days === 1) return { text: "Остался 1 день", tone: "warning" };
  if (days <= 3) return { text: `Осталось ${days} дн.`, tone: "warning" };
  return { text: `Осталось ${days} дн.`, tone: "neutral" };
}

const DEADLINE_TONE: Record<DeadlineTone, string> = {
  neutral: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25",
  warning: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25",
  danger: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25",
  muted: "bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-500/10 dark:text-zinc-400 dark:ring-zinc-500/25",
};

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

type TaskPatch = {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  project_id?: number | null;
  assignee_id?: number | null;
  start_date?: string | null;
  deadline?: string | null;
};

const AVAILABLE_EMOJIS = ["👍", "❤️", "🎉", "🚀", "😂", "🔥", "👀", "🙏", "✅", "❌"];

export default function TaskDetail() {
  const { id } = useParams();
  const taskId = Number(id);
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const { data: task } = useQuery({
    queryKey: ["task", taskId],
    queryFn: async () => (await api.get<Task>(`/api/tasks/${taskId}`)).data,
  });
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await api.get<Page<Project>>("/api/projects")).data.items,
  });
  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await api.get<Page<User>>("/api/users")).data.items,
  });

  const patch = useMutation({
    mutationFn: (body: TaskPatch) => api.patch(`/api/tasks/${taskId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toast.error("Не удалось сохранить", extractApiError(e).message),
  });

  const setRole = useMutation({
    mutationFn: ({ role, user_ids }: { role: RoleName; user_ids: number[] }) =>
      api.put(`/api/tasks/${taskId}/${role}`, { user_ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
    onError: (e) => toast.error("Не удалось изменить участников", extractApiError(e).message),
  });

  const addReminder = useMutation({
    mutationFn: (body: { kind: "before_deadline" | "before_start"; offset_minutes: number }) =>
      api.post(`/api/tasks/${taskId}/reminders`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
    onError: (e) => toast.error("Не удалось добавить напоминание", extractApiError(e).message),
  });
  const delReminder = useMutation({
    mutationFn: (rid: number) => api.delete(`/api/tasks/${taskId}/reminders/${rid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
    onError: (e) => toast.error("Не удалось удалить напоминание", extractApiError(e).message),
  });

  const addComment = useMutation({
    mutationFn: (body: string) => api.post(`/api/tasks/${taskId}/comments`, { body }),
    // Оптимистично добавляем комментарий с временным id < 0, чтобы UI не ждал refetch.
    // На слабой сети (спутник/мобильный интернет) задержка 500-1500ms заметна.
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ["task", taskId] });
      const prev = qc.getQueryData<Task>(["task", taskId]);
      if (prev) {
        const now = new Date().toISOString();
        const optimistic: CommentT = {
          id: -Date.now(),
          body,
          created_at: now,
          updated_at: now,
          author: me
            ? { id: me.id, name: me.name, email: me.email, avatar_url: me.avatar_url }
            : null,
          reactions: [],
        };
        qc.setQueryData<Task>(["task", taskId], {
          ...prev,
          comments: [...prev.comments, optimistic],
        });
      }
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["task", taskId], ctx.prev);
      toast.error("Не удалось отправить комментарий", extractApiError(e).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
  });
  const deleteComment = useMutation({
    mutationFn: (cid: number) => api.delete(`/api/tasks/${taskId}/comments/${cid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
  });
  const editComment = useMutation({
    mutationFn: ({ cid, body }: { cid: number; body: string }) =>
      api.patch(`/api/tasks/${taskId}/comments/${cid}`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
    onError: (e) => toast.error("Не удалось изменить комментарий", extractApiError(e).message),
  });
  const toggleReaction = useMutation({
    mutationFn: ({ commentId, emoji }: { commentId: number; emoji: string }) =>
      api.post(`/api/tasks/${taskId}/comments/${commentId}/reactions`, { emoji }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const addCheck = useMutation({
    mutationFn: (text: string) => api.post(`/api/tasks/${taskId}/checklist`, { text, done: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
    onError: (e) => toast.error("Не удалось добавить пункт", extractApiError(e).message),
  });
  const toggleCheck = useMutation({
    mutationFn: (item: { id: number; text: string; done: boolean }) =>
      api.patch(`/api/tasks/${taskId}/checklist/${item.id}`, { text: item.text, done: !item.done }),
    // Optimistic: toggle визуально мгновенный, потом сверяем с сервером.
    onMutate: async (item) => {
      await qc.cancelQueries({ queryKey: ["task", taskId] });
      const prev = qc.getQueryData<Task>(["task", taskId]);
      if (prev) {
        qc.setQueryData<Task>(["task", taskId], {
          ...prev,
          checklist: prev.checklist.map((c) => (c.id === item.id ? { ...c, done: !item.done } : c)),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["task", taskId], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
  });
  const editCheck = useMutation({
    mutationFn: (item: { id: number; text: string; done: boolean }) =>
      api.patch(`/api/tasks/${taskId}/checklist/${item.id}`, { text: item.text, done: item.done }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
    onError: (e) => toast.error("Не удалось изменить пункт", extractApiError(e).message),
  });
  const removeCheck = useMutation({
    mutationFn: (cid: number) => api.delete(`/api/tasks/${taskId}/checklist/${cid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const [comment, setComment] = useState("");
  const [newCheck, setNewCheck] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [titleInitialized, setTitleInitialized] = useState(false);

  useEffect(() => {
    if (task && !titleInitialized) {
      setTitleDraft(task.title);
      setTitleInitialized(true);
    }
  }, [task, titleInitialized]);

  const canEditTitle = can("tasks.update");
  const titleSave = useAutoSave({
    value: titleDraft,
    enabled: titleInitialized && canEditTitle,
    delay: 700,
    onSave: async (v) => {
      const trimmed = v.trim();
      if (!trimmed || trimmed === task?.title) return;
      await patch.mutateAsync({ title: trimmed });
    },
  });

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
    try {
      await api.post(`/api/tasks/${taskId}/attachments`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      toast.success("Файл загружен");
    } catch (e) {
      toast.error("Не удалось загрузить файл", extractApiError(e).message);
    }
  };

  const currentProject = projects?.find((p) => p.id === task.project_id) ?? null;
  const dl = deadlineInfo(task.deadline);
  const isUrgent = task.priority === "critical" || task.priority === "high";

  return (
    <div className="space-y-5">
      {/* ============ HEADER: breadcrumbs + title + status + deadline ============ */}
      <div className="border-b border-zinc-200 pb-5 dark:border-zinc-800">
        <nav aria-label="Хлебные крошки" className="mb-2 flex items-center gap-1.5 text-[13px] text-zinc-500">
          <Link to="/tasks" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft size={12} /> Задачи
          </Link>
          {currentProject && (
            <>
              <ChevronRight size={12} className="opacity-50" />
              <Link to={`/projects/${currentProject.id}`} className="hover:text-brand-600">
                {currentProject.name}
              </Link>
            </>
          )}
          <ChevronRight size={12} className="opacity-50" />
          <span className="truncate font-medium text-neutral-700 dark:text-neutral-300">
            {task.title}
          </span>
        </nav>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              {isUrgent && (
                <span
                  className="mt-1.5 inline-flex shrink-0 items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25"
                  title={task.priority === "critical" ? "Критический приоритет" : "Высокий приоритет"}
                >
                  <Flame size={11} /> Срочная
                </span>
              )}
              <input
                className="min-w-0 flex-1 rounded-md border-0 bg-transparent px-1 py-0.5 -mx-1 text-[22px] font-semibold tracking-[-0.01em] outline-none hover:bg-zinc-100 focus:bg-white focus:ring-2 focus:ring-brand-500/30 disabled:cursor-default disabled:opacity-100 disabled:hover:bg-transparent dark:hover:bg-[#1B1F26] dark:focus:bg-[#14171C]"
                value={titleDraft}
                disabled={!canEditTitle}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => titleSave.flush()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                  if (e.key === "Escape") setTitleDraft(task.title);
                }}
                placeholder="Название задачи"
                aria-label="Название задачи"
              />
            </div>
          </div>
          <TaskTimerButton taskId={taskId} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <StatusChip status={task.status} showIcon />
          {task.deadline && (
            <span className="inline-flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
              <Calendar size={13} />
              <span className="tabular-nums">
                {fmtDateShort(task.created_at)} — {fmtDateShort(task.deadline)}
              </span>
            </span>
          )}
          <span
            className={clsx(
              "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
              DEADLINE_TONE[dl.tone],
            )}
          >
            {dl.tone === "danger" && <AlertTriangle size={11} />}
            {dl.tone === "warning" && <Clock size={11} />}
            {dl.text}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-3 text-xs text-neutral-500">
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={task.author?.name} size={16} url={task.author?.avatar_url} />
            {task.author?.name || "—"}
            <span className="opacity-70">· создано {fromNow(task.created_at)}</span>
          </span>
          <SaveIndicator
            state={titleSave.state}
            errorMsg={titleSave.errorMsg}
            onRetry={titleSave.retry}
          />
        </div>
      </div>

      {/* ============ GRID: left (description/checklist/comments) + right sidebar ============ */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <div className="card p-5">
          <h3 className="card-title mb-3">Общее описание задачи</h3>
          <TextareaAuto
            disabled={!can("tasks.update")}
            initial={task.description || ""}
            onSave={(v) => patch.mutate({ description: v })}
            placeholder="Добавьте описание…"
          />
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="card-title">Чек-лист</h3>
            <span className="text-xs text-neutral-500 tabular-nums">
              {task.checklist.filter((i) => i.done).length}/{task.checklist.length}
            </span>
          </div>
          {task.checklist.length > 0 && (
            <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div
                className="h-full rounded-full bg-brand-600 transition-all duration-300"
                style={{
                  width: `${Math.round(
                    (task.checklist.filter((i) => i.done).length / task.checklist.length) * 100,
                  )}%`,
                }}
              />
            </div>
          )}
          <div className="space-y-1.5">
            {task.checklist.map((item) => (
              <ChecklistRow
                key={item.id}
                item={item}
                canEdit={can("tasks.update")}
                onToggle={() => toggleCheck.mutate(item)}
                onRename={(text) => editCheck.mutate({ ...item, text })}
                onRemove={() => removeCheck.mutate(item.id)}
              />
            ))}
          </div>
          {can("tasks.update") && (
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
              <Button
                variant="secondary"
                onClick={() => newCheck.trim() && (addCheck.mutate(newCheck), setNewCheck(""))}
                aria-label="Добавить пункт"
              >
                <Plus size={14} />
              </Button>
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="card-title">Комментарии</h3>
            <span className="text-xs text-neutral-500">{task.comments.length}</span>
          </div>
          <div className="space-y-4">
            {task.comments.map((c) => (
              <CommentRow
                key={c.id}
                comment={c}
                meId={me?.id}
                canDelete={can("comments.delete")}
                canReact={can("comments.create")}
                canEditOwn={can("comments.update_own")}
                canEditAny={can("comments.update_any")}
                onDelete={() => deleteComment.mutate(c.id)}
                onToggle={(emoji) => toggleReaction.mutate({ commentId: c.id, emoji })}
                onSave={(body) => editComment.mutate({ cid: c.id, body })}
                isSaving={editComment.isPending}
              />
            ))}
          </div>
          {can("comments.create") && (
            <form onSubmit={submitComment} className="mt-4">
              <div className="relative">
                <textarea
                  className="input min-h-[72px] resize-y pr-12"
                  placeholder="Написать комментарий. Используйте @email для упоминания…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      if (comment.trim()) {
                        addComment.mutate(comment);
                        setComment("");
                      }
                    }
                  }}
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  className="absolute bottom-2 right-2 !px-2.5"
                  disabled={!comment.trim() || addComment.isPending}
                  aria-label="Отправить комментарий"
                  title="Отправить (⌘⏎)"
                >
                  <Send size={14} />
                </Button>
              </div>
              <div className="mt-1 text-[11px] text-neutral-400">
                Enter — новая строка · <span className="kbd">⌘</span>+<span className="kbd">⏎</span> — отправить
              </div>
            </form>
          )}
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="card-title">История изменений</h3>
            {task.activities.length > 0 && (
              <span className="text-xs text-neutral-500 tabular-nums">{task.activities.length}</span>
            )}
          </div>
          <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1 text-sm">
            {task.activities.length === 0 && <div className="text-neutral-500">Пока пусто</div>}
            {task.activities.map((a) => (
              <div key={a.id} className="flex items-start gap-2 text-neutral-600 dark:text-neutral-400">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-400" />
                <div className="min-w-0 flex-1 break-words">
                  <span className="text-neutral-900 dark:text-neutral-200 font-medium">{a.user?.name || "Система"}</span>
                  {" "}<span>{ACTION_LABEL[a.action] ?? a.action}</span>
                  {a.detail && <span className="text-neutral-500"> · {formatActivityDetail(a.detail)}</span>}
                  <div className="text-[11px] text-neutral-500">{new Date(a.created_at).toLocaleString("ru-RU")}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <aside className="min-w-0 space-y-4 lg:sticky lg:top-[4.5rem] lg:self-start">
        <div className="card p-5">
          <h3 className="section-label mb-3">
            Свойства
          </h3>
          <dl className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            <SidebarField icon={<CircleDot size={15} />} label="Статус">
              <select
                className="input !h-8 !py-0 text-[13px]"
                disabled={!can("tasks.change_status")}
                value={task.status}
                onChange={(e) => patch.mutate({ status: e.target.value as TaskStatus })}
              >
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </SidebarField>

            <SidebarField icon={<Calendar size={14} />} label="Дата начала">
              <input
                className="input !h-8 !py-0 text-[13px]"
                type="datetime-local"
                disabled={!can("tasks.update")}
                value={task.start_date ? task.start_date.substring(0, 16) : ""}
                onChange={(e) => patch.mutate({ start_date: e.target.value ? new Date(e.target.value).toISOString() : null })}
              />
            </SidebarField>

            <SidebarField icon={<Calendar size={14} />} label="Дата завершения">
              <input
                className="input !h-8 !py-0 text-[13px]"
                type="datetime-local"
                disabled={!can("tasks.update")}
                value={task.deadline ? task.deadline.substring(0, 16) : ""}
                onChange={(e) => patch.mutate({ deadline: e.target.value ? new Date(e.target.value).toISOString() : null })}
              />
            </SidebarField>

            <SidebarField icon={<FolderKanban size={14} />} label="Проект">
              <select
                className="input !h-8 !py-0 text-[13px]"
                disabled={!can("tasks.update")}
                value={task.project_id ?? ""}
                onChange={(e) => patch.mutate({ project_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">—</option>
                {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </SidebarField>

            <SidebarField icon={<UserIcon size={14} />} label="Исполнители">
              <UserMultiSelect
                value={(task.assignees ?? []) as UserBrief[]}
                options={(users ?? []) as UserBrief[]}
                disabled={!can("tasks.assign")}
                onChange={(list) => setRole.mutate({ role: "assignees", user_ids: list.map((u) => u.id) })}
                placeholder="Добавить исполнителя"
                emptyText="Не назначено"
              />
            </SidebarField>

            <SidebarField icon={<Eye size={14} />} label="Аудиторы">
              <UserMultiSelect
                value={(task.auditors ?? []) as UserBrief[]}
                options={(users ?? []) as UserBrief[]}
                disabled={!can("tasks.assign")}
                onChange={(list) => setRole.mutate({ role: "auditors", user_ids: list.map((u) => u.id) })}
                placeholder="Добавить аудитора"
                emptyText="—"
                size="sm"
              />
            </SidebarField>

            <SidebarField icon={<Users size={14} />} label="Участники">
              <UserMultiSelect
                value={(task.participants ?? []) as UserBrief[]}
                options={(users ?? []) as UserBrief[]}
                disabled={!can("tasks.assign")}
                onChange={(list) => setRole.mutate({ role: "participants", user_ids: list.map((u) => u.id) })}
                placeholder="Добавить участника"
                emptyText="—"
                size="sm"
              />
            </SidebarField>

            <SidebarField icon={<Flag size={14} />} label="Приоритет">
              <div className="flex items-center gap-2">
                <select
                  className="input !h-8 !py-0 flex-1 text-[13px]"
                  disabled={!can("tasks.change_priority")}
                  value={task.priority}
                  onChange={(e) => patch.mutate({ priority: e.target.value as TaskPriority })}
                >
                  {(["low", "medium", "high", "critical"] as const).map((p) => (
                    <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                  ))}
                </select>
                <PriorityChip priority={task.priority} />
              </div>
            </SidebarField>

            <SidebarField icon={<UserCircle2 size={14} />} label="Постановщик">
              <div className="inline-flex items-center gap-1.5">
                {task.author ? (
                  <>
                    <Avatar name={task.author.name} url={task.author.avatar_url} size={20} />
                    <span>{task.author.name}</span>
                  </>
                ) : (
                  <span className="text-neutral-400">—</span>
                )}
              </div>
            </SidebarField>
          </dl>
        </div>

        <div className="card p-5">
          <div className="mb-2 flex items-center gap-2">
            <BellRing size={14} className="text-neutral-400" />
            <h3 className="card-title">Напоминания</h3>
          </div>
          {task.reminders.length === 0 ? (
            <div className="mb-2 text-[13px] text-zinc-500">Напоминаний нет</div>
          ) : (
            <ul className="mb-2 space-y-1">
              {task.reminders.map((r) => (
                <li
                  key={r.id}
                  className="group flex items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-zinc-50 dark:hover:bg-[#1B1F26]"
                >
                  <BellRing size={12} className="shrink-0 text-neutral-400" />
                  <span className="flex-1 truncate">{reminderLabel(r)}</span>
                  {r.fired_at && (
                    <span className="text-[10px] text-emerald-600" title={new Date(r.fired_at).toLocaleString("ru-RU")}>
                      отправлено
                    </span>
                  )}
                  {can("tasks.update") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => delReminder.mutate(r.id)}
                      aria-label="Удалить напоминание"
                    >
                      <X size={12} />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {can("tasks.update") && (
            <select
              className="input !h-8 !py-0 text-[13px]"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const preset = REMINDER_PRESETS[Number(e.target.value)];
                if (preset) addReminder.mutate({ kind: preset.kind, offset_minutes: preset.offset_minutes });
                e.target.value = "";
              }}
              aria-label="Добавить напоминание"
            >
              <option value="">+ Добавить напоминание…</option>
              {REMINDER_PRESETS.map((p, i) => {
                const already = task.reminders.some((r) => r.kind === p.kind && r.offset_minutes === p.offset_minutes);
                return (
                  <option key={i} value={i} disabled={already}>
                    {p.label}{already ? " · уже добавлено" : ""}
                  </option>
                );
              })}
            </select>
          )}
        </div>

        <div className="card p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="card-title">Вложения</h3>
            {can("files.upload") && (
              <label className="btn-secondary cursor-pointer !py-1 !px-2 text-xs">
                {/* label — не button; используем класс напрямую */}
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
            {task.attachments.length === 0 && <div className="text-[13px] text-zinc-500">Нет вложений</div>}
            {task.attachments.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-zinc-50 dark:hover:bg-[#1B1F26]">
                <a
                  href={`${API_URL}/api/tasks/${taskId}/attachments/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-sm link"
                  title={a.filename}
                >
                  {a.filename}
                </a>
                <span className="shrink-0 text-xs text-neutral-500 tabular-nums">{formatSize(a.size)}</span>
              </div>
            ))}
          </div>
        </div>

      </aside>
      </div>
    </div>
  );
}

function SidebarField({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  // Строка панели свойств по шаблону карточки: подпись слева, значение справа.
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3 py-1.5">
      <dt className="flex items-center gap-2 text-[13px] text-zinc-500 dark:text-zinc-400">
        {icon}
        <span className="truncate">{label}</span>
      </dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function ChecklistRow({
  item,
  canEdit,
  onToggle,
  onRename,
  onRemove,
}: {
  item: { id: number; text: string; done: boolean };
  canEdit: boolean;
  onToggle: () => void;
  onRename: (text: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);

  const commit = () => {
    const t = draft.trim();
    if (!t || t === item.text) {
      setEditing(false);
      return;
    }
    onRename(t);
    setEditing(false);
  };

  return (
    <div className="group flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
      <button
        onClick={onToggle}
        className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${
          item.done ? "border-brand-600 bg-brand-600 text-white" : "border-neutral-300 dark:border-neutral-600"
        }`}
        aria-label={item.done ? "Отметить как невыполненный" : "Отметить как выполненный"}
      >
        {item.done && <Check size={12} />}
      </button>
      {editing ? (
        <input
          className="input !py-1 flex-1 text-sm"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(item.text);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span
          className={
            item.done
              ? "flex-1 cursor-text text-sm text-neutral-400 line-through"
              : "flex-1 cursor-text text-sm"
          }
          onDoubleClick={() => canEdit && setEditing(true)}
          title={canEdit ? "Двойной клик — редактировать" : undefined}
        >
          {item.text}
        </span>
      )}
      {canEdit && !editing && (
        <Button
          variant="ghost"
          size="icon"
          className="!p-1 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={onRemove}
          aria-label="Удалить пункт"
        >
          <X size={14} />
        </Button>
      )}
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
  onSave: (v: string) => Promise<unknown> | void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [v, setV] = useState(initial);

  useEffect(() => {
    setV(initial);
  }, [initial]);

  const auto = useAutoSave({
    value: v,
    enabled: !disabled,
    delay: 800,
    onSave: async (val) => {
      await onSave(val);
    },
  });

  return (
    <>
      <textarea
        className="input min-h-[100px]"
        disabled={disabled}
        placeholder={placeholder}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => auto.flush()}
      />
      <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-400">
        <SaveIndicator state={auto.state} errorMsg={auto.errorMsg} onRetry={auto.retry} />
        {auto.state === "idle" && <span>Авто-сохранение при вводе</span>}
      </div>
    </>
  );
}

function CommentRow({
  comment,
  meId,
  canDelete,
  canReact,
  canEditOwn,
  canEditAny,
  onDelete,
  onToggle,
  onSave,
  isSaving,
}: {
  comment: CommentT;
  meId?: number;
  canDelete: boolean;
  canReact: boolean;
  canEditOwn: boolean;
  canEditAny: boolean;
  onDelete: () => void;
  onToggle: (emoji: string) => void;
  onSave: (body: string) => void;
  isSaving: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const isOwn = !!(meId && comment.author?.id === meId);
  const canEdit = (isOwn && canEditOwn) || canEditAny;
  const edited =
    comment.updated_at && comment.created_at &&
    Math.abs(new Date(comment.updated_at).getTime() - new Date(comment.created_at).getTime()) > 1500;

  const startEdit = () => {
    setDraft(comment.body);
    setEditing(true);
  };
  const save = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === comment.body) {
      setEditing(false);
      return;
    }
    onSave(trimmed);
    setEditing(false);
  };

  return (
    <div className="group flex gap-3">
      <Avatar name={comment.author?.name} url={comment.author?.avatar_url} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span className="font-medium text-neutral-900 dark:text-neutral-100">{comment.author?.name || "—"}</span>
          <span>{new Date(comment.created_at).toLocaleString("ru-RU")}</span>
          {edited && !editing && (
            <span className="text-neutral-400" title={`Изменено ${new Date(comment.updated_at).toLocaleString("ru-RU")}`}>
              (изменено)
            </span>
          )}
          {canEdit && !editing && (
            <button
              className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-brand-600"
              onClick={startEdit}
              title="Редактировать"
              aria-label="Редактировать комментарий"
            >
              <Pencil size={12} />
            </button>
          )}
          {canDelete && !editing && (
            <button
              className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-rose-500"
              onClick={onDelete}
              title="Удалить"
              aria-label="Удалить комментарий"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
        {editing ? (
          <div className="mt-1">
            <textarea
              className="input min-h-[72px] resize-y"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <div className="mt-1 flex items-center gap-2">
              <Button variant="primary" size="sm" className="!py-1 !px-2.5" onClick={save} disabled={isSaving || !draft.trim()}>
                Сохранить
              </Button>
              <Button variant="ghost" size="sm" className="!py-1 !px-2.5" onClick={() => setEditing(false)}>
                Отмена
              </Button>
              <span className="text-[11px] text-neutral-400">⌘⏎ сохранить · Esc отменить</span>
            </div>
          </div>
        ) : (
          <div className="mt-0.5 whitespace-pre-wrap break-words text-sm">{comment.body}</div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {comment.reactions?.map((r) => {
            const reacted = !!(meId && r.users.some((u) => u.id === meId));
            return (
              <button
                key={r.emoji}
                disabled={!canReact}
                onClick={() => onToggle(r.emoji)}
                title={r.users.map((u) => u.name).join(", ")}
                className={clsx(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                  reacted
                    ? "border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-200"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300",
                )}
              >
                <span>{r.emoji}</span>
                <span>{r.count}</span>
              </button>
            );
          })}
          {canReact && (
            <div className="relative">
              <Button
                onClick={() => setPickerOpen((v) => !v)}
                className="!p-1 opacity-0 group-hover:opacity-100"
                variant="ghost"
                title="Реакция"
              >
                <Smile size={14} />
              </Button>
              {pickerOpen && (
                <div
                  className="absolute left-0 top-full z-10 mt-1 flex flex-wrap gap-1 rounded-lg border border-neutral-200 bg-white p-2 shadow-md dark:border-neutral-800 dark:bg-neutral-900"
                  onMouseLeave={() => setPickerOpen(false)}
                >
                  {AVAILABLE_EMOJIS.map((e) => (
                    <button
                      key={e}
                      className="grid h-7 w-7 place-items-center rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      onClick={() => {
                        onToggle(e);
                        setPickerOpen(false);
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
