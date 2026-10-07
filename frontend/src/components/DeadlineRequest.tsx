/**
 * Перенос срока задачи по запросу.
 * Срок напрямую меняют постановщик и аудиторы. Исполнитель/участник жмёт на срок, выбирает день
 * в мини-календаре и отправляет запрос — постановщик/аудитор получает его в «Хронике», во «Входящих»
 * и в карточке задачи и одобряет или отклоняет.
 */
import { useMemo, useRef, useState, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarClock, Check, ChevronLeft, ChevronRight, Send, X } from "lucide-react";

import { api, extractApiError } from "@/api/client";
import { Popover } from "@/components/Popover";
import { useToast } from "@/components/Toast";
import { Avatar } from "@/components/ui";
import type { Me, UserBrief } from "@/types";

export type DeadlineRequestRow = {
  id: number;
  task_id: number;
  requested_by?: UserBrief | null;
  old_deadline?: string | null;
  new_deadline: string;
  reason?: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decision_note?: string | null;
  created_at: string;
  can_decide: boolean;
};

/** Те же правила, что на сервере (core/task_access.py): сервер всё равно проверяет. */
export function canSetDeadline(
  task: { author_id?: number | null; auditor_ids?: number[] },
  me: Me | null | undefined,
): boolean {
  if (!me) return false;
  if (!task.author_id) return true;
  if (task.author_id === me.id || (task.auditor_ids ?? []).includes(me.id)) return true;
  return !!me.current_tenant?.is_owner || !!me.is_platform_admin;
}

export const fmtDay = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) : "без срока";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function MiniCalendar({ value, onSelect }: { value: Date | null; onSelect: (d: Date) => void }) {
  const [view, setView] = useState(() => {
    const base = value ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const today = new Date();

  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // понедельник — первый
    const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    return [
      ...Array.from({ length: offset }, () => null),
      ...Array.from({ length: days }, (_, i) => new Date(view.getFullYear(), view.getMonth(), i + 1)),
    ] as (Date | null)[];
  }, [view]);

  const title = view.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });

  return (
    <div className="p-1.5">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          aria-label="Предыдущий месяц"
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
          className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-[#23262D]"
        >
          <ChevronLeft size={15} />
        </button>
        <div className="text-[13px] font-medium capitalize">{title}</div>
        <button
          type="button"
          aria-label="Следующий месяц"
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
          className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-[#23262D]"
        >
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-zinc-400">
        {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) =>
          d ? (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(d)}
              className={clsx(
                "grid h-8 place-items-center rounded-md text-[13px] tabular-nums transition-colors",
                value && sameDay(d, value)
                  ? "bg-brand-600 font-medium text-white"
                  : sameDay(d, today)
                    ? "font-semibold text-brand-600 ring-1 ring-inset ring-brand-400/50 hover:bg-zinc-100 dark:text-brand-300 dark:hover:bg-[#23262D]"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-[#23262D]",
              )}
            >
              {d.getDate()}
            </button>
          ) : (
            <span key={i} />
          ),
        )}
      </div>
    </div>
  );
}

/** Новый срок = выбранный день + время прежнего срока (если был), иначе конец дня. */
function withDay(day: Date, current?: string | null): string {
  const d = new Date(day);
  if (current) {
    const c = new Date(current);
    d.setHours(c.getHours(), c.getMinutes(), 0, 0);
  } else {
    d.setHours(23, 59, 0, 0);
  }
  return d.toISOString();
}

export function useDeadlineRequests(taskId: number, enabled = true) {
  return useQuery({
    enabled: enabled && taskId > 0,
    queryKey: ["deadline-requests", taskId],
    queryFn: async () => (await api.get<DeadlineRequestRow[]>(`/api/tasks/${taskId}/deadline-requests`)).data,
    staleTime: 15_000,
  });
}

/** Поповер «выберите новый день → отправить запрос». */
export function DeadlineRequestPopover({
  anchorRef, open, onClose, taskId, currentDeadline,
}: {
  anchorRef: RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  taskId: number;
  currentDeadline?: string | null;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<Date | null>(null);
  const [reason, setReason] = useState("");

  const send = useMutation({
    mutationFn: async () =>
      (await api.post(`/api/tasks/${taskId}/deadline-request`, {
        deadline: withDay(picked!, currentDeadline),
        reason: reason.trim() || null,
      })).data,
    onSuccess: () => {
      toast.success("Запрос отправлен", "Постановщик получит уведомление и решит, переносить ли срок");
      qc.invalidateQueries({ queryKey: ["deadline-requests", taskId] });
      setPicked(null);
      setReason("");
      onClose();
    },
    onError: (e) => toast.error("Не удалось отправить запрос", extractApiError(e).message),
  });

  return (
    <Popover anchorRef={anchorRef} open={open} onClose={onClose} width={268}>
      <div className="px-1.5 pt-1.5 text-[12px] text-zinc-500">
        <div className="flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-200">
          <CalendarClock size={13} /> Запросить перенос срока
        </div>
        <div className="mt-0.5">Сейчас: {fmtDay(currentDeadline)}</div>
      </div>
      <MiniCalendar value={picked ?? (currentDeadline ? new Date(currentDeadline) : null)} onSelect={setPicked} />
      <div className="space-y-2 px-1.5 pb-1.5">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="Причина (необязательно)"
          className="h-8 w-full rounded-md border border-zinc-200 bg-transparent px-2 text-[13px] outline-none focus:border-brand-400 dark:border-zinc-700"
        />
        <button
          type="button"
          disabled={!picked || send.isPending}
          onClick={() => send.mutate()}
          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-brand-600 text-[13px] font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <Send size={13} />
          {picked ? `Запросить на ${fmtDay(picked.toISOString())}` : "Выберите день"}
        </button>
      </div>
    </Popover>
  );
}

/** Кнопка «срок» для тех, кто напрямую менять его не может: показывает дату и открывает поповер запроса. */
export function DeadlineRequestButton({
  taskId, deadline, className, children,
}: {
  taskId: number; deadline?: string | null; className?: string; children?: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { data } = useDeadlineRequests(taskId);
  const mine = (data ?? []).find((r) => r.status === "pending");
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={mine ? `Запрос на ${fmtDay(mine.new_deadline)} ожидает решения` : "Запросить перенос срока"}
        className={className}
      >
        {children ?? fmtDay(deadline)}
        {mine && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />}
      </button>
      <DeadlineRequestPopover anchorRef={ref} open={open} onClose={() => setOpen(false)} taskId={taskId} currentDeadline={deadline} />
    </>
  );
}

export function useDecideRequest() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async ({ id, approve, note }: { id: number; approve: boolean; note?: string }) =>
      (await api.post<DeadlineRequestRow>(`/api/deadline-requests/${id}/${approve ? "approve" : "reject"}`, { note: note || null })).data,
    onSuccess: (r, v) => {
      toast.success(v.approve ? "Срок перенесён" : "Запрос отклонён");
      qc.invalidateQueries({ queryKey: ["deadline-requests"] });
      qc.invalidateQueries({ queryKey: ["task", r.task_id] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["activity-feed"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e) => toast.error("Не удалось обработать запрос", extractApiError(e).message),
  });
}

/** Блок в карточке задачи: решающему — запросы на одобрение; автору запроса — статус его заявки. */
export function DeadlineRequestsPanel({ taskId }: { taskId: number }) {
  const { data } = useDeadlineRequests(taskId);
  const decide = useDecideRequest();
  const rows = data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="space-y-2 rounded-xl border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      {rows.map((r) =>
        r.can_decide ? (
          <div key={r.id} className="flex flex-wrap items-center gap-3">
            <Avatar name={r.requested_by?.name} url={r.requested_by?.avatar_url} size={28} />
            <div className="min-w-0 flex-1 text-[13px]">
              <div>
                <b>{r.requested_by?.name ?? "Сотрудник"}</b> просит перенести срок:{" "}
                <span className="tabular-nums">{fmtDay(r.old_deadline)} → <b>{fmtDay(r.new_deadline)}</b></span>
              </div>
              {r.reason && <div className="mt-0.5 text-zinc-600 dark:text-zinc-400">«{r.reason}»</div>}
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: r.id, approve: true })}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                <Check size={14} /> Одобрить
              </button>
              <button
                type="button"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: r.id, approve: false })}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-300 px-3 text-xs font-medium hover:bg-white/60 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-white/5"
              >
                <X size={14} /> Отклонить
              </button>
            </div>
          </div>
        ) : (
          <div key={r.id} className="flex items-center gap-2 text-[13px]">
            <CalendarClock size={15} className="shrink-0 text-amber-600" />
            <span>
              Запрос на перенос срока на <b>{fmtDay(r.new_deadline)}</b> отправлен — ждёт решения постановщика
            </span>
          </div>
        ),
      )}
    </div>
  );
}
