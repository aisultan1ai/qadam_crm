import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Mail as MailIcon, Send, Loader2, Archive, ArchiveRestore, ArrowLeft, AlertTriangle,
  Paperclip, Link2, RefreshCw, Plus, PenSquare,
} from "lucide-react";
import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/ui";
import { Button } from "@/components/lib/Button";

import { SearchInput } from "@/components/page";
import {
  Composer, IconAction, ListEmpty, ListHeader, ListRow, ListTabs, PaneEmpty, PaneHeader, RowTag, Workspace,
} from "@/components/workspace";
type MailboxRow = {
  id: number;
  email: string;
  name: string;
  is_active: boolean;
  imap_password_set: boolean;
  smtp_password_set: boolean;
  last_sync_at: string | null;
  last_error: string | null;
};

type ThreadRow = {
  id: number;
  mailbox_id: number;
  subject: string | null;
  participants: { from?: string[]; to?: string[]; cc?: string[] };
  linked_lead_id: number | null;
  linked_task_id: number | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  total_count: number;
  is_archived: boolean;
};

type MailMsg = {
  id: number;
  direction: "inbound" | "outbound";
  status: "pending" | "sent" | "failed" | "received";
  from_addr: string;
  from_name: string | null;
  to_addrs: string[];
  cc_addrs: string[];
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  is_read: boolean;
  error: string | null;
  sent_at: string | null;
  created_at: string;
  attachments: Array<{ id: number; filename: string; content_type: string | null; size: number }>;
};

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 7) return d.toLocaleDateString("ru-RU", { weekday: "short" });
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export default function Mail() {
  const qc = useQueryClient();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  const { data: mailbox, isLoading: mbLoading } = useQuery({
    queryKey: ["my-mailbox"],
    queryFn: async () => (await api.get<MailboxRow | null>("/api/mail/mailboxes/me")).data,
  });

  const { data: threadsData, isLoading: threadsLoading } = useQuery({
    enabled: !!mailbox,
    queryKey: ["mail-threads", search, showArchived, onlyUnread],
    queryFn: async () => {
      const params: Record<string, unknown> = { per_page: 100 };
      if (search.trim()) params.q = search.trim();
      if (showArchived) params.is_archived = true;
      else params.is_archived = false;
      if (onlyUnread) params.only_unread = true;
      return (
        await api.get<{ items: ThreadRow[]; total: number }>("/api/mail/threads", { params })
      ).data;
    },
    refetchInterval: 30_000,
  });

  const syncMut = useMutation({
    mutationFn: async () => (await api.post("/api/mail/mailboxes/me/sync-now")).data,
    onSuccess: () => {
      toast.success("Синхронизация запущена");
      setTimeout(() => qc.invalidateQueries({ queryKey: ["mail-threads"] }), 3000);
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const threads = threadsData?.items ?? [];
  const totalUnread = useMemo(
    () => threads.reduce((s, t) => s + (t.unread_count || 0), 0),
    [threads],
  );
  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId],
  );

  if (mbLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-zinc-400">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (!mailbox) {
    return (
      <div className="flex min-h-0 flex-1 bg-[#F7F8FA] dark:bg-[#16181C]">
        <PaneEmpty
          icon={MailIcon}
          title="Подключите почтовый ящик"
          hint="Письма клиентов будут приходить сюда, а отвечать можно прямо из CRM — с привязкой к лидам и задачам."
          action={
            <Link to="/settings/mailbox" className="btn-primary">
              <Plus size={15} /> Подключить почту
            </Link>
          }
        />
      </div>
    );
  }

  const view: "all" | "unread" | "archive" = showArchived ? "archive" : onlyUnread ? "unread" : "all";
  return (
    <>
      <Workspace
        showDetailOnMobile={!!selected}
        list={
          <>
            <ListHeader
              search={<SearchInput value={search} onChange={setSearch} placeholder="Поиск по теме" className="sm:w-full" />}
              action={
                <button
                  type="button"
                  onClick={() => setComposeOpen(true)}
                  aria-label="Новое письмо"
                  title="Новое письмо"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                >
                  <PenSquare size={15} />
                </button>
              }
            >
              <ListTabs
                label="Какие письма показать"
                value={view}
                onChange={(v) => {
                  setOnlyUnread(v === "unread");
                  setShowArchived(v === "archive");
                }}
                items={[
                  { key: "all", label: "Входящие", count: totalUnread },
                  { key: "unread", label: "Непрочитанные" },
                  { key: "archive", label: "Архив" },
                ]}
                right={
                  <IconAction
                    icon={RefreshCw}
                    label={mailbox.last_sync_at ? `Синхронизировать (последняя: ${formatWhen(mailbox.last_sync_at)})` : "Синхронизировать"}
                    onClick={() => syncMut.mutate()}
                    disabled={syncMut.isPending}
                  />
                }
              />
            </ListHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {threadsLoading ? (
                <div className="flex items-center justify-center p-6 text-zinc-400">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              ) : threads.length === 0 ? (
                <ListEmpty>{search ? "Ничего не найдено" : onlyUnread ? "Непрочитанных нет" : showArchived ? "Архив пуст" : "Писем пока нет"}</ListEmpty>
              ) : (
                threads.map((t) => {
                  const senders = (t.participants?.from || []).slice(0, 2).join(", ");
                  return (
                    <ListRow
                      key={t.id}
                      active={t.id === selectedId}
                      unread={t.unread_count > 0}
                      onClick={() => setSelectedId(t.id)}
                      avatar={
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-zinc-100 text-[13px] font-semibold uppercase text-zinc-600 dark:bg-white/5 dark:text-zinc-300">
                          {(senders || "?").charAt(0)}
                        </span>
                      }
                      title={senders || "—"}
                      time={formatWhen(t.last_message_at)}
                      preview={
                        <>
                          <span className={clsx(t.unread_count > 0 ? "font-medium text-zinc-800 dark:text-zinc-200" : "text-zinc-600 dark:text-zinc-400")}>
                            {t.subject || "(без темы)"}
                          </span>
                          {t.last_message_preview && <span className="text-zinc-400"> — {t.last_message_preview}</span>}
                        </>
                      }
                      count={t.unread_count}
                      meta={
                        (t.total_count > 1 || t.linked_lead_id || t.linked_task_id) && (
                          <>
                            {t.total_count > 1 && <RowTag>{t.total_count} писем</RowTag>}
                            {t.linked_lead_id && <RowTag tone="green">Лид #{t.linked_lead_id}</RowTag>}
                            {t.linked_task_id && <RowTag tone="blue">Задача #{t.linked_task_id}</RowTag>}
                          </>
                        )
                      }
                    />
                  );
                })
              )}
            </div>
            <div className="shrink-0 truncate border-t border-zinc-200 px-3 py-2 text-[11.5px] text-zinc-400 dark:border-zinc-800" title={mailbox.last_error || undefined}>
              {mailbox.last_error ? (
                <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                  <AlertTriangle size={12} /> Ошибка синхронизации — проверьте настройки ящика
                </span>
              ) : (
                <>
                  {mailbox.email}
                  {mailbox.last_sync_at && ` · обновлено ${formatWhen(mailbox.last_sync_at)}`}
                </>
              )}
            </div>
          </>
        }
      >
        {selected ? (
          <ThreadView
            thread={selected}
            onBack={() => setSelectedId(null)}
            onChanged={() => qc.invalidateQueries({ queryKey: ["mail-threads"] })}
          />
        ) : (
          <PaneEmpty icon={MailIcon} title="Выберите письмо" hint="Вся переписка по цепочке откроется здесь." />
        )}
      </Workspace>

      {composeOpen && (
        <ComposeModal
          onClose={() => setComposeOpen(false)}
          onSent={() => {
            setComposeOpen(false);
            qc.invalidateQueries({ queryKey: ["mail-threads"] });
          }}
        />
      )}
    </>
  );
}

function ThreadView({ thread, onBack, onChanged }: { thread: ThreadRow; onBack: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [replyText, setReplyText] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["mail-thread-messages", thread.id],
    queryFn: async () =>
      (await api.get<MailMsg[]>(`/api/mail/threads/${thread.id}/messages`)).data,
  });

  useEffect(() => {
    if (thread.unread_count > 0) {
      api.post(`/api/mail/threads/${thread.id}/read`).then(() => {
        qc.invalidateQueries({ queryKey: ["mail-threads"] });
      });
    }
    setReplyText("");
  }, [thread.id, thread.unread_count, qc]);

  const reply = useMutation({
    mutationFn: async () =>
      (await api.post(`/api/mail/threads/${thread.id}/reply`, { body_text: replyText })).data,
    onSuccess: () => {
      setReplyText("");
      qc.invalidateQueries({ queryKey: ["mail-thread-messages", thread.id] });
      qc.invalidateQueries({ queryKey: ["mail-threads"] });
      toast.success("Ответ отправлен");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const archiveMut = useMutation({
    mutationFn: async () => (await api.post(`/api/mail/threads/${thread.id}/archive`)).data,
    onSuccess: () => {
      onChanged();
      toast.success(thread.is_archived ? "Тред восстановлен" : "Тред в архиве");
    },
  });

  return (
    <>
      <PaneHeader
        back={<span className="md:hidden"><IconAction icon={ArrowLeft} label="Назад" onClick={onBack} /></span>}
        actions={
          <>
            <IconAction icon={Link2} label="Связать с лидом или задачей" active={!!(thread.linked_lead_id || thread.linked_task_id)} onClick={() => setLinkOpen(true)} />
            <IconAction
              icon={thread.is_archived ? ArchiveRestore : Archive}
              label={thread.is_archived ? "Вернуть из архива" : "В архив"}
              onClick={() => archiveMut.mutate()}
              disabled={archiveMut.isPending}
            />
          </>
        }
      >
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-zinc-900 dark:text-white">{thread.subject || "(без темы)"}</div>
          <div className="flex items-center gap-1.5 truncate text-[12px] text-zinc-500">
            <span className="truncate">{(thread.participants?.from || []).join(", ") || "—"}</span>
            {thread.linked_lead_id && <RowTag tone="green">Лид #{thread.linked_lead_id}</RowTag>}
            {thread.linked_task_id && <RowTag tone="blue">Задача #{thread.linked_task_id}</RowTag>}
          </div>
        </div>
      </PaneHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-zinc-400">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-3">
            {(messages ?? []).map((m) => <MessageCard key={m.id} m={m} />)}
          </div>
        )}
      </div>

      <Composer
        value={replyText}
        onChange={setReplyText}
        onSubmit={() => reply.mutate()}
        sending={reply.isPending}
        placeholder="Ответить в этой цепочке…"
      />

      {linkOpen && (
        <LinkModal thread={thread} onClose={() => setLinkOpen(false)} onDone={() => {
          setLinkOpen(false);
          onChanged();
        }} />
      )}
    </>
  );
}

function MessageCard({ m }: { m: MailMsg }) {
  const [showHtml, setShowHtml] = useState(false);
  const isOut = m.direction === "outbound";
  return (
    <div
      className={clsx(
        "rounded-xl border bg-white p-4 dark:bg-[#1B1E23]",
        isOut ? "border-brand-200 dark:border-brand-500/25" : "border-zinc-200 dark:border-zinc-800",
        m.status === "failed" && "ring-1 ring-rose-400",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[13.5px]">
            <span className="font-semibold text-zinc-900 dark:text-white">
              {m.from_name || m.from_addr}
            </span>{" "}
            <span className="text-zinc-400">&lt;{m.from_addr}&gt;</span>
          </div>
          <div className="mt-0.5 text-[12px] text-zinc-500">
            → {(m.to_addrs || []).join(", ") || "—"}
            {m.cc_addrs?.length ? ` · CC: ${m.cc_addrs.join(", ")}` : ""}
          </div>
        </div>
        <div className="shrink-0 text-[11.5px] tabular-nums text-zinc-400">
          {m.sent_at
            ? new Date(m.sent_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
            : formatWhen(m.created_at)}
          {isOut && m.status === "pending" && <span className="ml-2">отправляется…</span>}
          {isOut && m.status === "failed" && <span className="ml-2 font-medium text-rose-600">не отправлено</span>}
        </div>
      </div>
      {m.error && (
        <div className="mt-2 rounded bg-rose-50 p-2 text-xs text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
          {m.error}
        </div>
      )}
      <div className="mt-3">
        {m.body_html && showHtml ? (
          // HTML от внешних отправителей приходит уже очищенным на сервере
          // (backend/app/core/html_sanitize.py: без script/style/on*/javascript:).
          <div
            className="prose prose-sm max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: m.body_html }}
          />
        ) : (
          <div className="whitespace-pre-wrap text-[13.5px] leading-[1.55] text-zinc-800 dark:text-zinc-200">
            {m.body_text || (m.body_html ? "(письмо в HTML — переключите вид)" : "")}
          </div>
        )}
        {m.body_html && m.body_text && (
          <button
            className="mt-2 text-xs link"
            onClick={() => setShowHtml((v) => !v)}
          >
            {showHtml ? "Показать текст" : "Показать HTML"}
          </button>
        )}
      </div>
      {m.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {m.attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-1.5 rounded-lg bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800"
            >
              <Paperclip size={12} />
              <span>{a.filename}</span>
              <span className="text-neutral-400">{formatSize(a.size)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LinkModal({
  thread,
  onClose,
  onDone,
}: {
  thread: ThreadRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [leadId, setLeadId] = useState(String(thread.linked_lead_id ?? ""));
  const [taskId, setTaskId] = useState(String(thread.linked_task_id ?? ""));

  const mut = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/api/mail/threads/${thread.id}/link`, {
          lead_id: leadId === "" ? 0 : Number(leadId) || null,
          task_id: taskId === "" ? 0 : Number(taskId) || null,
        })
      ).data,
    onSuccess: () => {
      toast.success("Связано");
      onDone();
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title="Связать тред с CRM" size="md">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">ID лида (пусто — отвязать)</span>
          <input type="number" className="input" value={leadId} onChange={(e) => setLeadId(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">ID задачи (пусто — отвязать)</span>
          <input type="number" className="input" value={taskId} onChange={(e) => setTaskId(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={mut.isPending} onClick={() => mut.mutate()}>
            Сохранить
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ComposeModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const send = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/api/mail/messages`, {
          to: to.split(",").map((s) => s.trim()).filter(Boolean),
          cc: cc.split(",").map((s) => s.trim()).filter(Boolean),
          subject,
          body_text: body,
        })
      ).data,
    onSuccess: () => {
      toast.success("Письмо отправлено");
      onSent();
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title="Новое письмо" size="lg">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Кому (через запятую)</span>
          <input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Копия</span>
          <input className="input" value={cc} onChange={(e) => setCc(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Тема</span>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Текст</span>
          <textarea className="input min-h-[180px]" value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            disabled={!to || !subject || !body || send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Отправить
          </Button>
        </div>
      </div>
    </Modal>
  );
}
