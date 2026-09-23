import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Archive, ArchiveRestore, Check, CheckCheck, Clock3, Link2, Loader2, MessageCircle, Paperclip, Search, Send,
} from "lucide-react";
import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";
import { Modal, Avatar } from "@/components/ui";
import { Button } from "@/components/lib/Button";

import { SearchInput, Segmented } from "@/components/page";
import { Link } from "react-router-dom";
type ChannelKind = "telegram" | "whatsapp" | "instagram";

const KIND_LABEL: Record<ChannelKind, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
};

const KIND_COLOR: Record<ChannelKind, string> = {
  telegram: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25",
  whatsapp: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25",
  instagram: "bg-pink-50 text-pink-700 ring-pink-200 dark:bg-pink-500/10 dark:text-pink-300 dark:ring-pink-500/25",
};

// Цвет метки канала на аватаре (фирменные цвета мессенджеров).
const KIND_DOT: Record<ChannelKind, string> = {
  telegram: "bg-[#229ED9]",
  whatsapp: "bg-[#25D366]",
  instagram: "bg-[#E1306C]",
};

function ContactAvatar({ name, url, kind, size = 36 }: { name: string; url?: string | null; kind?: ChannelKind | null; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0">
      <Avatar name={name} url={url ?? undefined} size={size} />
      {kind && (
        <span
          aria-hidden
          className={clsx("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white dark:ring-[#14171C]", KIND_DOT[kind])}
        />
      )}
    </span>
  );
}

type Contact = {
  id: number;
  external_id: string;
  username: string | null;
  display_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  linked_lead_id: number | null;
  is_blocked: boolean;
};

type Conversation = {
  id: number;
  channel_id: number;
  channel_name: string | null;
  channel_kind: ChannelKind | null;
  contact: Contact | null;
  assignee_id: number | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  is_closed: boolean;
};

type ExtMessage = {
  id: number;
  direction: "inbound" | "outbound";
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  body: string | null;
  media: Record<string, unknown> | null;
  sender_user_id: number | null;
  is_auto: boolean;
  error: string | null;
  created_at: string;
};

type Channel = {
  id: number;
  kind: ChannelKind;
  name: string;
  is_active: boolean;
};

type MessageTemplate = {
  id: number;
  name: string;
  body: string;
  language: string;
};

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 7) return d.toLocaleDateString("ru-RU", { weekday: "short" });
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

export default function Inbox() {
  const qc = useQueryClient();
  const toast = useToast();
  const [channelFilter, setChannelFilter] = useState<number | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  const { data: channels } = useQuery({
    queryKey: ["messenger-channels"],
    queryFn: async () => (await api.get<Channel[]>("/api/messengers/channels")).data,
    staleTime: 30_000,
  });

  const { data: convs, isPending: convsLoading } = useQuery({
    queryKey: ["messenger-convs", channelFilter, showClosed, search],
    queryFn: async () => {
      const params: Record<string, unknown> = { per_page: 100 };
      if (channelFilter) params.channel_id = channelFilter;
      if (!showClosed) params.is_closed = false;
      if (search.trim()) params.q = search.trim();
      return (await api.get<{ items: Conversation[]; total: number }>("/api/messengers/conversations", { params }))
        .data.items;
    },
    refetchInterval: 15_000,
  });

  // Realtime приходит через useRealtimeUpdates() в Layout — там уже маршрутизация
  // events "messenger.message.new" → invalidate queries. Дополнительной подписки не нужно.

  const selected = useMemo(
    () => convs?.find((c) => c.id === selectedId) ?? null,
    [convs, selectedId],
  );

  const totalUnread = useMemo(
    () => (convs ?? []).reduce((s, c) => s + (c.unread_count || 0), 0),
    [convs],
  );

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            Открытые линии
            {totalUnread > 0 && (
              <span className="rounded-md bg-brand-600 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
                {totalUnread}
              </span>
            )}
          </h1>
          <p className="page-subtitle">Telegram, WhatsApp и Instagram в одном окне</p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-200 bg-white md:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_300px] dark:border-zinc-800 dark:bg-[#14171C]">
        {/* Left: conversation list */}
        <div className="flex min-h-0 flex-col overflow-hidden border-b border-zinc-200 md:border-b-0 md:border-r dark:border-zinc-800">
          <div className="space-y-2.5 border-b border-zinc-200 p-3 dark:border-zinc-800">
            <SearchInput value={search} onChange={setSearch} placeholder="Поиск по контакту" className="sm:w-full" />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={!channelFilter}
                className={clsx(
                  "chip",
                  !channelFilter ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50 dark:bg-transparent dark:text-zinc-300 dark:ring-zinc-700",
                )}
                onClick={() => setChannelFilter(null)}
              >
                Все каналы
              </button>
              {(channels ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={channelFilter === c.id}
                  className={clsx(
                    "chip",
                    channelFilter === c.id
                      ? "bg-brand-600 text-white ring-brand-600"
                      : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50 dark:bg-transparent dark:text-zinc-300 dark:ring-zinc-700",
                  )}
                  onClick={() => setChannelFilter(channelFilter === c.id ? null : c.id)}
                  title={c.name}
                >
                  <span className={clsx("h-2 w-2 rounded-full", KIND_DOT[c.kind])} />
                  {KIND_LABEL[c.kind]}
                </button>
              ))}
            </div>
            <Segmented
              label="Статус диалогов"
              value={showClosed ? "all" : "open"}
              onChange={(v) => setShowClosed(v === "all")}
              className="w-full [&>button]:flex-1 [&>button]:justify-center"
              items={[
                { key: "open", label: "Открытые" },
                { key: "all", label: "Все, включая закрытые" },
              ]}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {convsLoading && (
              <div className="flex items-center justify-center p-6 text-neutral-500">
                <Loader2 size={16} className="animate-spin" />
              </div>
            )}
            {!convsLoading && (convs ?? []).length === 0 && (
              <div className="p-6 text-center text-sm text-neutral-500">
                <MessageCircle size={24} className="mx-auto mb-2 text-neutral-400" />
                Пока нет диалогов
              </div>
            )}
            {(convs ?? []).map((c) => {
              const isSelected = c.id === selectedId;
              const contact = c.contact;
              const name = contact?.display_name || contact?.username || contact?.phone || contact?.external_id || `#${c.id}`;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={clsx(
                    "relative w-full border-b border-zinc-100 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 dark:border-zinc-800/70",
                    isSelected
                      ? "bg-brand-50 shadow-[inset_3px_0_0_rgb(var(--brand-600))] dark:bg-brand-500/10"
                      : "hover:bg-zinc-50 dark:hover:bg-[#1B1F26]",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <ContactAvatar name={name} url={contact?.avatar_url} kind={c.channel_kind} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={clsx("truncate text-sm", c.unread_count > 0 ? "font-semibold text-zinc-900 dark:text-white" : "font-medium")}>{name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                          {formatWhen(c.last_message_at)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className={clsx("truncate text-[13px]", c.unread_count > 0 ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-500")}>
                          {c.last_message_preview || "—"}
                        </span>
                        {c.unread_count > 0 && (
                          <span className="min-w-[18px] shrink-0 rounded-full bg-brand-600 px-1.5 text-center text-[11px] font-semibold leading-[18px] text-white">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-1 empty:hidden">
                        {c.is_closed && (
                          <span className="chip !px-1.5 !py-0 !text-[11px] bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-500/10 dark:text-zinc-400">
                            закрыт
                          </span>
                        )}
                        {contact?.linked_lead_id && (
                          <span className="chip !px-1.5 !py-0 !text-[11px] bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300">
                            Лид #{contact.linked_lead_id}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: chat */}
        <div className="flex min-h-0 flex-col overflow-hidden bg-[#F6F7F9] dark:bg-[#0D0F13]">
          {!selected && (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="text-center">
                <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-500 dark:border-zinc-800 dark:bg-[#14171C]">
                  <MessageCircle size={20} />
                </span>
                <div className="text-[15px] font-semibold">Выберите диалог</div>
                <p className="mt-1 text-sm text-zinc-500">Переписка и карточка клиента откроются здесь.</p>
              </div>
            </div>
          )}
          {selected && (
            <Chat
              conversation={selected}
              onLinkLead={() => setLinkOpen(true)}
              onChanged={() => {
                qc.invalidateQueries({ queryKey: ["messenger-convs"] });
                qc.invalidateQueries({ queryKey: ["messenger-messages", selected.id] });
              }}
            />
          )}
        </div>

        {/* Right: client card */}
        <aside aria-label="Карточка клиента" className="hidden min-h-0 flex-col overflow-y-auto border-l border-zinc-200 xl:flex dark:border-zinc-800">
          {selected ? (
            <ContactPanel conversation={selected} onLinkLead={() => setLinkOpen(true)} />
          ) : (
            <div className="p-5 text-sm text-zinc-500">Карточка клиента появится после выбора диалога.</div>
          )}
        </aside>
      </div>

      {selected && linkOpen && (
        <LinkLeadModal
          conversation={selected}
          onClose={() => setLinkOpen(false)}
          onDone={() => {
            setLinkOpen(false);
            qc.invalidateQueries({ queryKey: ["messenger-convs"] });
          }}
        />
      )}
    </div>
  );
}

function Chat({
  conversation,
  onLinkLead,
  onChanged,
}: {
  conversation: Conversation;
  onLinkLead: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  const { data: messages, isPending } = useQuery({
    queryKey: ["messenger-messages", conversation.id],
    queryFn: async () =>
      (await api.get<ExtMessage[]>(`/api/messengers/conversations/${conversation.id}/messages`)).data,
    refetchInterval: 10_000,
  });

  const { data: templates } = useQuery({
    queryKey: ["messenger-templates"],
    queryFn: async () => (await api.get<MessageTemplate[]>("/api/messengers/templates")).data,
    staleTime: 60_000,
  });

  // Mark read при открытии
  useEffect(() => {
    if (conversation.unread_count > 0) {
      api.post(`/api/messengers/conversations/${conversation.id}/read`).then(() => {
        qc.invalidateQueries({ queryKey: ["messenger-convs"] });
      });
    }
  }, [conversation.id, conversation.unread_count, qc]);

  // Автоскролл вниз при новых сообщениях
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = useMutation({
    mutationFn: async (body: string) => {
      return (
        await api.post<ExtMessage>(`/api/messengers/conversations/${conversation.id}/messages`, {
          body,
        })
      ).data;
    },
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["messenger-messages", conversation.id] });
      qc.invalidateQueries({ queryKey: ["messenger-convs"] });
    },
    onError: (e) => toast.error("Ошибка отправки", extractApiError(e).message),
  });

  const closeMut = useMutation({
    mutationFn: async () =>
      api.post(`/api/messengers/conversations/${conversation.id}/${conversation.is_closed ? "reopen" : "close"}`),
    onSuccess: () => {
      onChanged();
      toast.success(conversation.is_closed ? "Диалог открыт" : "Диалог закрыт");
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || send.isPending) return;
    send.mutate(t);
  };

  const contact = conversation.contact;
  const contactName =
    contact?.display_name || contact?.username || contact?.phone || contact?.external_id || `#${conversation.id}`;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-5 py-3 dark:border-zinc-800 dark:bg-[#14171C]">
        <div className="flex min-w-0 items-center gap-3">
          <ContactAvatar name={contactName} url={contact?.avatar_url} kind={conversation.channel_kind} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">{contactName}</span>
              {conversation.channel_kind && (
                <span className={clsx("chip", KIND_COLOR[conversation.channel_kind])}>
                  {KIND_LABEL[conversation.channel_kind]}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-xs text-zinc-500">
              {contact?.username && <>@{contact.username} · </>}
              {contact?.phone && <>{contact.phone} · </>}
              {contact?.external_id && <span className="font-mono">{contact.external_id}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={onLinkLead}>
            <Link2 size={14} />
            {contact?.linked_lead_id ? `Лид #${contact.linked_lead_id}` : "Связать с лидом"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => closeMut.mutate()} disabled={closeMut.isPending}>
            {conversation.is_closed ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            {conversation.is_closed ? "Открыть диалог" : "Закрыть диалог"}
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {isPending && (
          <div className="flex items-center justify-center py-8 text-neutral-500">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
        {!isPending && (messages ?? []).length === 0 && (
          <div className="py-8 text-center text-sm text-neutral-500">Пока нет сообщений</div>
        )}
        <div className="space-y-3">
          {(messages ?? []).map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
        </div>
      </div>

      {/* Input */}
      <form
        onSubmit={onSubmit}
        className="px-5 pb-4 pt-1"
      >
        {conversation.is_closed && (
          <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
            Диалог закрыт. Откройте, чтобы отвечать.
          </div>
        )}
        <div className="rounded-xl border border-zinc-300 bg-white shadow-soft focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-500/15 dark:border-zinc-700 dark:bg-[#14171C]">
          <div>
            <textarea
              aria-label="Ответ клиенту"
              className="block min-h-[64px] w-full resize-none border-0 bg-transparent px-3.5 py-3 text-sm outline-none placeholder:text-zinc-400"
              placeholder={`Ответ в ${conversation.channel_kind ? KIND_LABEL[conversation.channel_kind] : "канал"}… (Ctrl+Enter — отправить)`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={conversation.is_closed}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  onSubmit(e as unknown as React.FormEvent);
                }
              }}
            />
          </div>
          <div className="flex items-center gap-1 border-t border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowTemplates((v) => !v)}
              disabled={conversation.is_closed || !(templates?.length)}
              aria-expanded={showTemplates}
            >
              <MessageCircle size={14} /> Шаблоны
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="ml-auto"
              disabled={!text.trim() || send.isPending || conversation.is_closed}
            >
              {send.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Отправить
            </Button>
          </div>
        </div>
        {showTemplates && (templates?.length ?? 0) > 0 && (
          <div className="mt-2 grid gap-0.5 rounded-lg border border-zinc-200 bg-white p-1.5 text-[13px] shadow-pop dark:border-zinc-800 dark:bg-[#14171C]">
            <div className="section-label px-2 py-1">Шаблоны ответов</div>
            {templates!.map((t) => (
              <button
                key={t.id}
                type="button"
                className="rounded px-2 py-1 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                onClick={() => {
                  setText(t.body);
                  setShowTemplates(false);
                }}
              >
                <span className="font-medium">{t.name}</span>{" "}
                <span className="text-neutral-500 line-clamp-1">— {t.body}</span>
              </button>
            ))}
          </div>
        )}
      </form>
    </>
  );
}

function MessageBubble({ msg }: { msg: ExtMessage }) {
  const isOut = msg.direction === "outbound";
  const time = new Date(msg.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={clsx("flex flex-col", isOut ? "items-end" : "items-start")}>
      <div
        className={clsx(
          "max-w-[72%] px-3.5 py-2.5 text-sm",
          isOut
            ? "rounded-[12px_12px_4px_12px] bg-brand-600 text-white"
            : "rounded-[12px_12px_12px_4px] border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-[#14171C] dark:text-zinc-100",
          msg.status === "failed" && "ring-2 ring-rose-500",
        )}
      >
        <div className="whitespace-pre-wrap break-words">{msg.body || "(без текста)"}</div>
        {msg.media && (
          <div className={clsx("mt-1 inline-flex items-center gap-1 text-xs", isOut ? "text-white/80" : "text-zinc-500")}>
            <Paperclip size={12} /> {String(msg.media.type || "вложение")}
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5 px-1 text-xs text-zinc-500">
        {msg.is_auto && <span className="rounded bg-zinc-100 px-1 text-[11px] dark:bg-[#1B1F26]">авто</span>}
        <span className="tabular-nums">{time}</span>
        {isOut && msg.status === "pending" && <Clock3 size={12} aria-label="Отправляется" />}
        {isOut && msg.status === "sent" && <Check size={13} aria-label="Отправлено" />}
        {isOut && (msg.status === "delivered" || msg.status === "read") && (
          <CheckCheck size={13} className={msg.status === "read" ? "text-brand-600 dark:text-brand-400" : undefined} aria-label={msg.status === "read" ? "Прочитано" : "Доставлено"} />
        )}
        {isOut && msg.status === "failed" && (
          <span title={msg.error || ""} className="font-medium text-rose-600">Не доставлено</span>
        )}
      </div>
    </div>
  );
}

/** Правая панель: кто клиент и что с ним связано. */
function ContactPanel({ conversation, onLinkLead }: { conversation: Conversation; onLinkLead: () => void }) {
  const c = conversation.contact;
  const name = c?.display_name || c?.username || c?.phone || c?.external_id || `#${conversation.id}`;
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Канал", value: conversation.channel_kind ? KIND_LABEL[conversation.channel_kind] : "—" },
    { label: "Линия", value: conversation.channel_name || "—" },
    { label: "Телефон", value: c?.phone || "—" },
    { label: "Username", value: c?.username ? `@${c.username}` : "—" },
    { label: "ID в канале", value: c?.external_id ? <span className="font-mono text-xs">{c.external_id}</span> : "—" },
  ];
  return (
    <div className="flex flex-col">
      <div className="flex flex-col items-center gap-3 border-b border-zinc-200 px-5 py-6 text-center dark:border-zinc-800">
        <ContactAvatar name={name} url={c?.avatar_url} kind={conversation.channel_kind} size={56} />
        <div>
          <div className="text-base font-semibold">{name}</div>
          <div className="mt-0.5 text-[13px] text-zinc-500">
            {conversation.is_closed ? "Диалог закрыт" : "Диалог открыт"}
            {c?.is_blocked ? " · заблокирован" : ""}
          </div>
        </div>
      </div>
      <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div className="section-label mb-2">Контакты</div>
        <dl className="space-y-2 text-[13px]">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-3">
              <dt className="text-zinc-500">{r.label}</dt>
              <dd className="min-w-0 truncate text-right">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="px-5 py-4">
        <div className="section-label mb-2">CRM</div>
        {c?.linked_lead_id ? (
          <Link to="/leads" className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2.5 text-sm hover:border-zinc-300 dark:border-zinc-800">
            <span className="font-medium">Лид #{c.linked_lead_id}</span>
            <span className="chip bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300">связан</span>
          </Link>
        ) : (
          <div className="space-y-2">
            <p className="text-[13px] text-zinc-500">Клиент ещё не связан с лидом.</p>
            <Button variant="secondary" size="sm" fullWidth onClick={onLinkLead}>
              <Link2 size={14} /> Связать с лидом
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function LinkLeadModal({
  conversation,
  onClose,
  onDone,
}: {
  conversation: Conversation;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [leadId, setLeadId] = useState("");
  const [mode, setMode] = useState<"create" | "existing" | "unlink">(
    conversation.contact?.linked_lead_id ? "unlink" : "create",
  );

  const mut = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (mode === "create") body.create_new = true;
      else if (mode === "existing") body.lead_id = Number(leadId) || null;
      else body.lead_id = null;
      return (
        await api.post(`/api/messengers/conversations/${conversation.id}/link-lead`, body)
      ).data;
    },
    onSuccess: () => {
      toast.success(mode === "unlink" ? "Связь удалена" : "Связано с лидом");
      onDone();
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title="Связать с лидом" size="md">
      <div className="space-y-3">
        <label className="flex items-center gap-2 rounded-lg border border-neutral-200 p-2 text-sm dark:border-neutral-800">
          <input type="radio" checked={mode === "create"} onChange={() => setMode("create")} />
          <div>
            <div className="font-medium">Создать нового лида</div>
            <div className="text-xs text-neutral-500">
              Из контактных данных клиента: {conversation.contact?.display_name || conversation.contact?.username}
            </div>
          </div>
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-neutral-200 p-2 text-sm dark:border-neutral-800">
          <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} />
          <div className="flex-1">
            <div className="font-medium">Связать с существующим</div>
            <input
              type="number"
              className="input mt-1 !py-1.5"
              placeholder="ID лида"
              value={leadId}
              onChange={(e) => {
                setLeadId(e.target.value);
                setMode("existing");
              }}
            />
          </div>
        </label>
        {conversation.contact?.linked_lead_id && (
          <label className="flex items-center gap-2 rounded-lg border border-neutral-200 p-2 text-sm dark:border-neutral-800">
            <input type="radio" checked={mode === "unlink"} onChange={() => setMode("unlink")} />
            <span>Убрать связь (текущий: Лид #{conversation.contact.linked_lead_id})</span>
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            disabled={mut.isPending || (mode === "existing" && !leadId)}
            onClick={() => mut.mutate()}
          >
            Готово
          </Button>
        </div>
      </div>
    </Modal>
  );
}
