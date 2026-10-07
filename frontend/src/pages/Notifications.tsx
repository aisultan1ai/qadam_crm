/**
 * «Входящие» (Inbox в ClickUp): все уведомления на одной странице —
 * Непрочитанные / Упоминания / Все / Отложенные, с «прочитано», «отложить» и открытием задачи в панели.
 */
import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  AtSign, Bell, BellRing, CalendarClock, CheckCheck, CircleDot, Clock, Mail, MailOpen, MessageSquare, Undo2, UserPlus,
} from "lucide-react";

import { api, extractApiError } from "@/api/client";
import { Popover, PopoverItem } from "@/components/Popover";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/lib/Button";
import { PageHeader, Tabs } from "@/components/page";
import { EmptyState, Loader } from "@/components/ui";
import { fromNow } from "@/lib/date";
import type { Notification, Page } from "@/types";
import { TaskDrawer } from "./tasks/TaskDrawer";

type Tab = "unread" | "mentions" | "all" | "snoozed";
const TABS: Tab[] = ["unread", "mentions", "all", "snoozed"];
const PAGE = 50;

const KIND_ICON: Record<string, typeof Bell> = {
  mention: AtSign,
  comment: MessageSquare,
  assigned: UserPlus,
  status: CircleDot,
  reminder: BellRing,
  task_reminder: BellRing,
  calendar_reminder: CalendarClock,
  messenger_digest: Mail,
  deadline_request: CalendarClock,
  deadline_decision: CalendarClock,
};

function at(hours: number, addDays: number) {
  const d = new Date();
  d.setDate(d.getDate() + addDays);
  d.setHours(hours, 0, 0, 0);
  return d;
}

function snoozeOptions() {
  const inThree = new Date(Date.now() + 3 * 3600_000);
  const monday = at(9, (8 - new Date().getDay()) % 7 || 7);
  return [
    { label: "Через 3 часа", until: inThree },
    { label: "Завтра в 9:00", until: at(9, 1) },
    { label: "В понедельник в 9:00", until: monday },
  ];
}

export default function Notifications() {
  const qc = useQueryClient();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const rawTab = sp.get("tab") as Tab | null;
  const tab: Tab = rawTab && TABS.includes(rawTab) ? rawTab : "unread";
  const [limit, setLimit] = useState(PAGE);

  const setTab = (t: Tab) => {
    const next = new URLSearchParams(sp);
    if (t === "unread") next.delete("tab");
    else next.set("tab", t);
    setSp(next, { replace: true });
    setLimit(PAGE);
  };

  const { data: counts } = useQuery({
    queryKey: ["notifications", "counts"],
    queryFn: async () => (await api.get<{ unread: number; mentions: number }>("/api/notifications/unread-count")).data,
  });
  const { data, isPending } = useQuery({
    queryKey: ["notifications", "inbox", tab, limit],
    queryFn: async () => (await api.get<Page<Notification>>("/api/notifications", { params: { tab, per_page: limit } })).data,
    placeholderData: (prev) => prev,
  });
  const items = data?.items ?? [];

  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  const onError = (title: string) => (e: unknown) => toast.error(title, extractApiError(e).message);
  const setRead = useMutation({
    mutationFn: ({ id, read }: { id: number; read: boolean }) => api.post(`/api/notifications/${id}/${read ? "read" : "unread"}`),
    onSuccess: refresh,
    onError: onError("Не удалось обновить уведомление"),
  });
  const snooze = useMutation({
    mutationFn: ({ id, until }: { id: number; until: Date | null }) =>
      api.post(`/api/notifications/${id}/snooze`, { until: until ? until.toISOString() : null }),
    onSuccess: (_d, v) => {
      refresh();
      if (v.until) toast.success(`Отложено до ${v.until.toLocaleString("ru-RU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`);
    },
    onError: onError("Не удалось отложить"),
  });
  const readAll = useMutation({
    mutationFn: () => api.post("/api/notifications/read-all"),
    onSuccess: refresh,
    onError: onError("Не удалось отметить все"),
  });

  const openTaskId = Number(sp.get("task")) || null;
  const openTask = (id: number) => {
    const next = new URLSearchParams(sp);
    next.set("task", String(id));
    setSp(next);
  };
  const closeTask = useCallback(() => {
    const next = new URLSearchParams(sp);
    next.delete("task");
    setSp(next, { replace: true });
  }, [sp, setSp]);

  const open = (n: Notification) => {
    if (!n.is_read) setRead.mutate({ id: n.id, read: true });
    if (n.task_id) openTask(n.task_id);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        className="border-b-0 pb-0"
        eyebrow="Главная"
        title="Входящие"
        actions={
          <Button variant="secondary" onClick={() => readAll.mutate()} disabled={readAll.isPending || !counts?.unread}>
            <CheckCheck size={15} /> Прочитать все
          </Button>
        }
      />
      <Tabs<Tab>
        label="Раздел входящих"
        value={tab}
        onChange={setTab}
        items={[
          { key: "unread", label: "Непрочитанные", count: counts?.unread ?? null },
          { key: "mentions", label: "Упоминания", count: counts?.mentions || null },
          { key: "all", label: "Все" },
          { key: "snoozed", label: "Отложенные", icon: Clock },
        ]}
      />

      {isPending ? (
        <Loader />
      ) : items.length === 0 ? (
        <EmptyState
          icon={tab === "snoozed" ? <Clock size={20} /> : <Bell size={20} />}
          title={
            tab === "unread" ? "Всё прочитано" : tab === "mentions" ? "Упоминаний нет" : tab === "snoozed" ? "Отложенных нет" : "Уведомлений пока нет"
          }
          description={
            tab === "snoozed"
              ? "Отложите уведомление — оно вернётся в непрочитанные в выбранное время."
              : "Здесь появятся назначения, упоминания и напоминания."
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {items.map((n) => (
              <Item
                key={n.id}
                n={n}
                snoozedTab={tab === "snoozed"}
                onOpen={() => open(n)}
                onToggleRead={() => setRead.mutate({ id: n.id, read: !n.is_read })}
                onSnooze={(until) => snooze.mutate({ id: n.id, until })}
              />
            ))}
          </ul>
          {(data?.total ?? 0) > items.length && (
            <button
              type="button"
              onClick={() => setLimit((l) => Math.min(l + PAGE, 200))}
              disabled={limit >= 200}
              className="w-full border-t border-zinc-100 py-2.5 text-[13px] text-zinc-600 hover:bg-zinc-50 disabled:text-zinc-400 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-[#23262D]"
            >
              {limit >= 200 ? `Показаны последние 200 из ${data?.total}` : `Показать ещё (${(data?.total ?? 0) - items.length})`}
            </button>
          )}
        </div>
      )}
      {openTaskId && <TaskDrawer taskId={openTaskId} onClose={closeTask} />}
    </div>
  );
}

function Item({
  n,
  snoozedTab,
  onOpen,
  onToggleRead,
  onSnooze,
}: {
  n: Notification;
  snoozedTab: boolean;
  onOpen: () => void;
  onToggleRead: () => void;
  onSnooze: (until: Date | null) => void;
}) {
  const Icon = KIND_ICON[n.kind] ?? Bell;
  const snoozeRef = useRef<HTMLButtonElement>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  return (
    <li className={clsx("group relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-[#23262D]", !n.is_read && "bg-brand-50/40 dark:bg-brand-500/5")}>
      {!n.is_read && <span aria-label="Непрочитано" className="absolute left-1.5 top-5 h-1.5 w-1.5 rounded-full bg-brand-600 dark:bg-brand-400" />}
      <span
        className={clsx(
          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
          n.kind === "mention" ? "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300",
        )}
      >
        <Icon size={15} />
      </span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className={clsx("text-sm text-zinc-900 dark:text-zinc-100", !n.is_read ? "font-semibold" : "font-medium")}>{n.title}</div>
        {n.body && <div className="mt-0.5 line-clamp-2 text-[13px] text-zinc-500 dark:text-zinc-400">{n.body}</div>}
        <div className="mt-1 text-xs text-zinc-400" title={new Date(n.created_at).toLocaleString("ru-RU")}>
          {fromNow(n.created_at)}
          {snoozedTab && n.snoozed_until && (
            <span className="ml-2 inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <Clock size={11} /> вернётся {new Date(n.snoozed_until).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        {snoozedTab ? (
          <IconBtn label="Вернуть сейчас" onClick={() => onSnooze(null)}>
            <Undo2 size={15} />
          </IconBtn>
        ) : (
          <>
            <IconBtn label={n.is_read ? "Отметить непрочитанным" : "Отметить прочитанным"} onClick={onToggleRead}>
              {n.is_read ? <Mail size={15} /> : <MailOpen size={15} />}
            </IconBtn>
            <IconBtn label="Отложить" onClick={() => setSnoozeOpen((v) => !v)} btnRef={snoozeRef}>
              <Clock size={15} />
            </IconBtn>
            <Popover anchorRef={snoozeRef} open={snoozeOpen} onClose={() => setSnoozeOpen(false)} width={200} align="end">
              {snoozeOptions().map((o) => (
                <PopoverItem
                  key={o.label}
                  onClick={() => {
                    setSnoozeOpen(false);
                    onSnooze(o.until);
                  }}
                >
                  {o.label}
                </PopoverItem>
              ))}
            </Popover>
          </>
        )}
      </div>
    </li>
  );
}

function IconBtn({
  label,
  onClick,
  children,
  btnRef,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  btnRef?: React.RefObject<HTMLButtonElement>;
}) {
  return (
    <button
      ref={btnRef}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-200/60 hover:text-zinc-900 dark:hover:bg-zinc-700/50 dark:hover:text-white"
    >
      {children}
    </button>
  );
}
