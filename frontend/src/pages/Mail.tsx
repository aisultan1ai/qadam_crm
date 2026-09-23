import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Mail as MailIcon, Send, Loader2, Search, Archive, ArchiveRestore,
  Paperclip, Link2, RefreshCw, Plus, Reply,
} from "lucide-react";
import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/ui";
import { Button } from "@/components/lib/Button";

import { SearchInput, Segmented } from "@/components/page";
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
    return <div className="p-8 text-center text-neutral-500"><Loader2 size={16} className="mx-auto animate-spin" /></div>;
  }

  if (!mailbox) {
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        <MailIcon size={40} className="mx-auto mb-3 text-neutral-400" />
        <h1 className="mb-2 text-xl font-semibold">Настройте почтовый ящик</h1>
        <p className="mb-4 text-sm text-neutral-500">
          Подключите IMAP + SMTP чтобы получать и отправлять письма прямо из CRM.
        </p>
        <Link to="/settings/mailbox" className="btn-primary inline-flex">
          <Plus size={14} /> Настроить mailbox
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            Почта
            {totalUnread > 0 && (
              <span className="ml-2 rounded-md bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white">
                {totalUnread}
              </span>
            )}
          </h1>
          <p className="page-subtitle">
            {mailbox.email}
            {mailbox.last_sync_at && ` · синхр. ${formatWhen(mailbox.last_sync_at)}`}
            {mailbox.last_error && (
              <span className="ml-2 text-rose-500">⚠ {mailbox.last_error.slice(0, 80)}</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => syncMut.mutate()}
            disabled={syncMut.isPending}
          >
            {syncMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Синхронизировать
          </Button>
          <Button variant="primary" onClick={() => setComposeOpen(true)}>
            <Plus size={14} /> Новое письмо
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-200 bg-white md:grid-cols-[340px_1fr] dark:border-zinc-800 dark:bg-[#14171C]">
        {/* Threads list */}
        <div className="flex min-h-0 flex-col overflow-hidden border-b border-zinc-200 md:border-b-0 md:border-r dark:border-zinc-800">
          <div className="space-y-2.5 border-b border-zinc-200 p-3 dark:border-zinc-800">
            <SearchInput value={search} onChange={setSearch} placeholder="Поиск по теме" className="sm:w-full" />
            <Segmented
              label="Какие письма показать"
              value={showArchived ? "archive" : onlyUnread ? "unread" : "all"}
              onChange={(v) => {
                setOnlyUnread(v === "unread");
                setShowArchived(v === "archive");
              }}
              className="w-full [&>button]:flex-1 [&>button]:justify-center"
              items={[
                { key: "all", label: "Входящие" },
                { key: "unread", label: "Непрочитанные" },
                { key: "archive", label: "Архив" },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {threadsLoading && (
              <div className="flex items-center justify-center p-6 text-neutral-500">
                <Loader2 size={16} className="animate-spin" />
              </div>
            )}
            {!threadsLoading && threads.length === 0 && (
              <div className="p-6 text-center text-sm text-neutral-500">
                <MailIcon size={24} className="mx-auto mb-2 text-neutral-400" />
                {onlyUnread ? "Нет непрочитанных" : "Пока нет писем"}
              </div>
            )}
            {threads.map((t) => {
              const isSelected = t.id === selectedId;
              const senders = (t.participants?.from || []).slice(0, 2).join(", ");
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={clsx(
                    "w-full border-b border-zinc-100 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 dark:border-zinc-800/70",
                    isSelected
                      ? "bg-brand-50 shadow-[inset_3px_0_0_rgb(var(--brand-600))] dark:bg-brand-500/10"
                      : "hover:bg-zinc-50 dark:hover:bg-[#1B1F26]",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={clsx("flex min-w-0 items-center gap-2 truncate text-sm", t.unread_count > 0 ? "font-semibold text-zinc-900 dark:text-white" : "font-medium")}>{t.unread_count > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Непрочитано" />}<span className="truncate">{senders || "—"}</span></span>
                    <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                      {formatWhen(t.last_message_at)}
                    </span>
                  </div>
                  <div className={clsx("mt-0.5 truncate text-[13px]", t.unread_count > 0 ? "font-medium text-zinc-800 dark:text-zinc-200" : "text-zinc-700 dark:text-zinc-300")}>{t.subject || "(без темы)"}</div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] text-zinc-500">
                      {t.last_message_preview || "—"}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {t.total_count > 1 && (
                        <span className="rounded bg-zinc-100 px-1 text-[11px] tabular-nums text-zinc-500 dark:bg-[#1B1F26]" title="Писем в цепочке">{t.total_count}</span>
                      )}
                      {t.unread_count > 0 && (
                        <span className="min-w-[18px] rounded-full bg-brand-600 px-1.5 text-center text-[11px] font-semibold leading-[18px] text-white">
                          {t.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                  {(t.linked_lead_id || t.linked_task_id) && (
                    <div className="mt-1 flex gap-1">
                      {t.linked_lead_id && (
                        <span className="chip !px-1.5 !py-0 !text-[11px] bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300">
                          Лид #{t.linked_lead_id}
                        </span>
                      )}
                      {t.linked_task_id && (
                        <span className="chip !px-1.5 !py-0 !text-[11px] bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300">
                          Задача #{t.linked_task_id}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Thread view */}
        <div className="flex min-h-0 flex-col overflow-hidden bg-white dark:bg-[#14171C]">
          {!selected && (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="text-center">
                <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-[#1B1F26]">
                  <MailIcon size={20} />
                </span>
                <div className="text-[15px] font-semibold">Выберите письмо</div>
                <p className="mt-1 text-sm text-zinc-500">Вся переписка по цепочке откроется здесь.</p>
              </div>
            </div>
          )}
          {selected && <ThreadView thread={selected} onChanged={() => qc.invalidateQueries({ queryKey: ["mail-threads"] })} />}
        </div>
      </div>

      {composeOpen && (
        <ComposeModal
          onClose={() => setComposeOpen(false)}
          onSent={() => {
            setComposeOpen(false);
            qc.invalidateQueries({ queryKey: ["mail-threads"] });
          }}
        />
      )}
    </div>
  );
}

function ThreadView({ thread, onChanged }: { thread: ThreadRow; onChanged: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
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
    setReplying(false);
    setReplyText("");
  }, [thread.id, thread.unread_count, qc]);

  const reply = useMutation({
    mutationFn: async () =>
      (await api.post(`/api/mail/threads/${thread.id}/reply`, { body_text: replyText })).data,
    onSuccess: () => {
      setReplyText("");
      setReplying(false);
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
      <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{thread.subject || "(без темы)"}</h2>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-500">
            {(thread.participants?.from || []).map((e) => (
              <span key={e} className="chip bg-neutral-100 dark:bg-neutral-800">
                {e}
              </span>
            ))}
            {thread.linked_lead_id && (
              <span className="chip bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                Лид #{thread.linked_lead_id}
              </span>
            )}
            {thread.linked_task_id && (
              <span className="chip bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300">
                Задача #{thread.linked_task_id}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="sm" className="!py-1 !px-2" onClick={() => setLinkOpen(true)}>
            <Link2 size={14} /> Связать
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="!py-1 !px-2"
            onClick={() => archiveMut.mutate()}
            disabled={archiveMut.isPending}
          >
            {thread.is_archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-neutral-500">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
        <div className="space-y-3">
          {(messages ?? []).map((m) => <MessageCard key={m.id} m={m} />)}
        </div>
      </div>

      <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
        {!replying ? (
          <Button variant="secondary" onClick={() => setReplying(true)}>
            <Reply size={14} /> Ответить
          </Button>
        ) : (
          <div className="space-y-2">
            <textarea
              className="input min-h-[100px] text-sm"
              placeholder="Ваш ответ…"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReplying(false)}>Отмена</Button>
              <Button
                variant="primary"
                disabled={!replyText.trim() || reply.isPending}
                onClick={() => reply.mutate()}
              >
                {reply.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Отправить
              </Button>
            </div>
          </div>
        )}
      </div>

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
        "rounded-lg border p-3",
        isOut
          ? "border-brand-200 bg-brand-50/40 dark:border-brand-900 dark:bg-brand-950/20"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/60",
        m.status === "failed" && "ring-1 ring-rose-400",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm">
            <span className="font-semibold">
              {m.from_name || m.from_addr}
            </span>{" "}
            <span className="text-neutral-500">&lt;{m.from_addr}&gt;</span>
          </div>
          <div className="mt-0.5 text-xs text-neutral-500">
            → {(m.to_addrs || []).join(", ") || "—"}
            {m.cc_addrs?.length ? ` · CC: ${m.cc_addrs.join(", ")}` : ""}
          </div>
        </div>
        <div className="text-xs text-neutral-400">
          {m.sent_at ? new Date(m.sent_at).toLocaleString("ru-RU") : formatWhen(m.created_at)}
          {isOut && (
            <span className="ml-2">
              {m.status === "pending" && "⏳"}
              {m.status === "sent" && "✓"}
              {m.status === "failed" && <span className="text-rose-500">! failed</span>}
            </span>
          )}
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
          <div className="whitespace-pre-wrap text-sm">
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
