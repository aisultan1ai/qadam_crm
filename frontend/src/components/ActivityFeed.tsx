/**
 * Общие части ленты событий («Хроника» и «Последние события» на дашборде):
 * типы, человекочитаемое описание события, карточка с кнопками «Прочитано» / «Лайк».
 */
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Activity as ActivityIcon, CalendarClock, Check, FolderKanban, MessageSquare, Pencil, Plus,
  Repeat, ThumbsUp, UserPlus, Users, X,
} from "lucide-react";

import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";
import { Avatar } from "@/components/ui";
import { fromNow } from "@/lib/date";
import { fmtDay, useDecideRequest } from "@/components/DeadlineRequest";

type Actor = { id: number; name: string; avatar_url?: string | null };

export type FeedItem = {
  id: number;
  action: string;
  entity?: string | null;
  entity_id?: number | null;
  task_id?: number | null;
  detail?: string | null;
  created_at: string;
  user?: Actor | null;
  target_title?: string | null;
  project_id?: number | null;
  project_name?: string | null;
  is_read: boolean;
  liked: boolean;
  likes_count: number;
  deadline_request?: {
    id: number;
    status: "pending" | "approved" | "rejected" | "cancelled";
    old_deadline?: string | null;
    new_deadline: string;
    reason?: string | null;
    decision_note?: string | null;
    can_decide: boolean;
  } | null;
};

export type FeedPage = {
  items: FeedItem[];
  total: number;
  unread: number;
  page: number;
  per_page: number;
  pages: number;
};


/** Что произошло — человеческой фразой + иконка. Поля detail пишет сервер («срок, исполнитель, статус …»). */
function describe(it: FeedItem): { icon: typeof Plus; tone: string; text: string; quote?: string } {
  const d = (it.detail ?? "").toLowerCase();
  const isTask = !!it.task_id;

  if (it.action === "deadline_request" || it.action === "deadline_approved" || it.action === "deadline_rejected") {
    const r = it.deadline_request;
    const range = r ? `${fmtDay(r.old_deadline)} → ${fmtDay(r.new_deadline)}` : undefined;
    const note = r ? (it.action === "deadline_request" ? r.reason : r.decision_note) : null;
    const quote = [range, note ? `«${note}»` : null].filter(Boolean).join("  ·  ") || undefined;
    if (it.action === "deadline_request") {
      return { icon: CalendarClock, tone: "text-amber-600 dark:text-amber-400", text: "просит перенести срок задачи", quote };
    }
    if (it.action === "deadline_approved") {
      return { icon: CalendarClock, tone: "text-emerald-600 dark:text-emerald-400", text: "одобрил(а) перенос срока задачи", quote };
    }
    return { icon: CalendarClock, tone: "text-rose-600 dark:text-rose-400", text: "отклонил(а) перенос срока задачи", quote };
  }
  if (it.action === "lead_new") {
    return { icon: UserPlus, tone: "text-emerald-600 dark:text-emerald-400", text: "Новый лид" };
  }
  if (it.action === "lead_assigned") {
    return { icon: UserPlus, tone: "text-brand-600 dark:text-brand-300", text: "назначил(а) вам лид" };
  }
  if (it.action === "comment") {
    return {
      icon: MessageSquare, tone: "text-sky-600 dark:text-sky-400",
      text: "прокомментировал(а) задачу", quote: it.detail ?? undefined,
    };
  }
  if (it.entity === "project") {
    if (it.action === "create") return { icon: FolderKanban, tone: "text-emerald-600 dark:text-emerald-400", text: "создал(а) проект" };
    if (it.action === "archive") return { icon: FolderKanban, tone: "text-amber-600 dark:text-amber-400", text: "архивировал(а) проект" };
    return { icon: FolderKanban, tone: "text-sky-600 dark:text-sky-400", text: "обновил(а) проект", quote: it.detail ?? undefined };
  }
  if (isTask && it.action === "create") {
    return { icon: Plus, tone: "text-emerald-600 dark:text-emerald-400", text: "создал(а) задачу" };
  }
  if (isTask && it.action === "update") {
    if (d.includes("срок")) return { icon: CalendarClock, tone: "text-amber-600 dark:text-amber-400", text: "изменил(а) срок задачи" };
    if (d.includes("исполнитель")) return { icon: Users, tone: "text-brand-600 dark:text-brand-300", text: "сменил(а) исполнителя в задаче" };
    if (d.includes("статус")) return { icon: Repeat, tone: "text-sky-600 dark:text-sky-400", text: "изменил(а) статус задачи", quote: it.detail ?? undefined };
    return { icon: Pencil, tone: "text-sky-600 dark:text-sky-400", text: "обновил(а) задачу", quote: it.detail ?? undefined };
  }
  if (it.action === "upload") return { icon: Plus, tone: "text-sky-600 dark:text-sky-400", text: "добавил(а) файл" };
  return { icon: ActivityIcon, tone: "text-neutral-500", text: "обновил(а)" };
}

export function targetLink(it: FeedItem): string | null {
  if (it.task_id) return `/tasks/${it.task_id}`;
  if (it.entity === "project" && it.entity_id) return `/projects/${it.entity_id}`;
  if (it.entity === "lead") return "/leads";
  return null;
}


/** Действия над событиями ленты: прочитано / лайк / открыть. Меняют карточку в кэше сразу, не ожидая сервера. */
export function useFeedActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();

  const refresh = () => qc.invalidateQueries({ queryKey: ["activity-feed"] });
  const patchItem = (id: number, patch: Partial<FeedItem>) => {
    qc.setQueriesData<FeedPage>({ queryKey: ["activity-feed"] }, (old) =>
      old && Array.isArray(old.items) ? { ...old, items: old.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) } : old,
    );
  };

  const setRead = useMutation({
    mutationFn: async ({ id, value }: { id: number; value: boolean }) =>
      (await api.post(`/api/activity/feed/${id}/read`, { value })).data,
    onMutate: ({ id, value }) => patchItem(id, { is_read: value }),
    onSettled: refresh,
    onError: (e) => toast.error("Не удалось отметить", extractApiError(e).message),
  });

  const setLike = useMutation({
    mutationFn: async ({ id, value }: { id: number; value: boolean; it: FeedItem }) =>
      (await api.post<{ liked: boolean; is_read: boolean; likes_count: number }>(`/api/activity/feed/${id}/like`, { value })).data,
    onMutate: ({ id, value, it }) =>
      patchItem(id, {
        liked: value,
        is_read: value ? true : it.is_read,
        likes_count: Math.max(0, it.likes_count + (value ? 1 : -1)),
      }),
    onSettled: refresh,
    onError: (e) => toast.error("Не удалось поставить лайк", extractApiError(e).message),
  });

  return {
    toggleRead: (it: FeedItem) => setRead.mutate({ id: it.id, value: !it.is_read }),
    toggleLike: (it: FeedItem) => setLike.mutate({ id: it.id, value: !it.liked, it }),
    open: (it: FeedItem) => {
      const link = targetLink(it);
      if (!it.is_read) setRead.mutate({ id: it.id, value: true });
      if (link) nav(link);
    },
  };
}

export function FeedRow({
  it, onOpen, onToggleRead, onToggleLike,
}: {
  it: FeedItem; onOpen: () => void; onToggleRead: () => void; onToggleLike: () => void;
}) {
  const decide = useDecideRequest();
  const meta = describe(it);
  const Icon = meta.icon;
  const clickable = !!targetLink(it);
  const isLead = it.action === "lead_new";

  return (
    <div
      className={clsx(
        "group relative flex items-start gap-3 p-3 sm:p-4",
        !it.is_read && "bg-brand-500/[0.04]",
        clickable && "cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/40",
      )}
      onClick={clickable ? onOpen : undefined}
    >
      {!it.is_read && <span className="absolute left-1.5 top-5 h-1.5 w-1.5 rounded-full bg-brand-500" aria-label="Не прочитано" />}

      {isLead || !it.user ? (
        <span className={clsx("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-neutral-100 dark:bg-neutral-800", meta.tone)}>
          <Icon size={16} />
        </span>
      ) : (
        <div className="relative shrink-0">
          <Avatar name={it.user.name} url={it.user.avatar_url} size={32} />
          <span className={clsx("absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-white dark:bg-[#1B1E23]", meta.tone)}>
            <Icon size={10} />
          </span>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="text-sm leading-snug">
          {it.user && !isLead && <span className="font-medium">{it.user.name} </span>}
          <span className="text-neutral-600 dark:text-neutral-400">{meta.text}</span>
          {it.target_title && <span className="font-medium"> «{it.target_title}»</span>}
        </div>
        {it.project_name && it.entity !== "project" && (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500">
            <FolderKanban size={12} /> {it.project_name}
          </div>
        )}
        {meta.quote && (
          <div className="mt-1.5 line-clamp-3 rounded-lg border-l-2 border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-[13px] text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800/50 dark:text-neutral-300">
            {meta.quote}
          </div>
        )}
        {it.deadline_request?.can_decide && (
          <div className="mt-2 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ id: it.deadline_request!.id, approve: true })}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              <Check size={14} /> Одобрить
            </button>
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ id: it.deadline_request!.id, approve: false })}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-neutral-300 px-3 text-xs font-medium hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-600 dark:hover:bg-neutral-800"
            >
              <X size={14} /> Отклонить
            </button>
          </div>
        )}
        {it.action === "deadline_request" && it.deadline_request && !it.deadline_request.can_decide && it.deadline_request.status !== "pending" && (
          <div className="mt-1.5 text-xs text-neutral-500">
            {it.deadline_request.status === "approved" ? "Одобрено" : it.deadline_request.status === "rejected" ? "Отклонено" : "Отменено"}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
          <span title={new Date(it.created_at).toLocaleString("ru-RU")}>{fromNow(it.created_at)}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onToggleLike}
          aria-pressed={it.liked}
          title={it.liked ? "Убрать лайк" : "Нравится"}
          className={clsx(
            "inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs transition-colors",
            it.liked
              ? "bg-brand-500/10 text-brand-600 dark:text-brand-300"
              : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800",
          )}
        >
          <ThumbsUp size={14} className={it.liked ? "fill-current" : undefined} />
          {it.likes_count > 0 && <span className="tabular-nums">{it.likes_count}</span>}
        </button>
        <button
          type="button"
          onClick={onToggleRead}
          title={it.is_read ? "Отметить непрочитанным" : "Прочитано"}
          className={clsx(
            "inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs transition-colors",
            it.is_read
              ? "text-emerald-600 hover:bg-neutral-100 dark:text-emerald-400 dark:hover:bg-neutral-800"
              : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800",
          )}
        >
          <Check size={14} />
          <span className="hidden sm:inline">{it.is_read ? "Прочитано" : "Прочитать"}</span>
        </button>
      </div>
    </div>
  );
}
