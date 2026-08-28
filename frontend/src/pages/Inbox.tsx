import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Send, Loader2, MessageCircle, Link2, Archive, ArchiveRestore, Search,
} from "lucide-react";
import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";
import { Modal, Avatar } from "@/components/ui";

type ChannelKind = "telegram" | "whatsapp" | "instagram";

const KIND_LABEL: Record<ChannelKind, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
};

const KIND_COLOR: Record<ChannelKind, string> = {
  telegram: "text-sky-600 bg-sky-50 dark:bg-sky-950/30 dark:text-sky-300",
  whatsapp: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300",
  instagram: "text-pink-600 bg-pink-50 dark:bg-pink-950/30 dark:text-pink-300",
};

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Открытые линии
            {totalUnread > 0 && (
              <span className="ml-2 rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white">
                {totalUnread}
              </span>
            )}
          </h1>
          <p className="text-sm text-neutral-500">
            Единый inbox для Telegram / WhatsApp / Instagram
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[320px_1fr]">
        {/* Left: conversation list */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50">
          <div className="space-y-2 border-b border-neutral-100 p-3 dark:border-neutral-800">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-2.5 text-neutral-400" />
              <input
                className="input !py-1.5 pl-7 text-sm"
                placeholder="Поиск по контакту…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                className={clsx(
                  "chip",
                  !channelFilter ? "bg-brand-500 text-white" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800",
                )}
                onClick={() => setChannelFilter(null)}
              >
                Все
              </button>
              {(channels ?? []).map((c) => (
                <button
                  key={c.id}
                  className={clsx(
                    "chip",
                    channelFilter === c.id
                      ? "bg-brand-500 text-white"
                      : KIND_COLOR[c.kind] || "bg-neutral-100",
                  )}
                  onClick={() => setChannelFilter(channelFilter === c.id ? null : c.id)}
                  title={c.name}
                >
                  {KIND_LABEL[c.kind]}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-brand-600"
                checked={showClosed}
                onChange={(e) => setShowClosed(e.target.checked)}
              />
              Показывать закрытые
            </label>
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
                    "w-full border-b border-neutral-100 px-3 py-2.5 text-left transition-colors dark:border-neutral-800",
                    isSelected
                      ? "bg-brand-50 dark:bg-brand-950/25"
                      : "hover:bg-neutral-50 dark:hover:bg-neutral-800/40",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Avatar name={name} url={contact?.avatar_url ?? undefined} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{name}</span>
                        <span className="shrink-0 text-[10px] text-neutral-400">
                          {formatWhen(c.last_message_at)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-neutral-500">
                          {c.last_message_preview || "—"}
                        </span>
                        {c.unread_count > 0 && (
                          <span className="shrink-0 rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-neutral-400">
                        {c.channel_kind && (
                          <span className={clsx("chip !text-[10px] !px-1.5 !py-0", KIND_COLOR[c.channel_kind])}>
                            {KIND_LABEL[c.channel_kind]}
                          </span>
                        )}
                        {c.is_closed && (
                          <span className="chip !text-[10px] !px-1.5 !py-0 bg-neutral-100 text-neutral-500">
                            закрыт
                          </span>
                        )}
                        {contact?.linked_lead_id && (
                          <span className="chip !text-[10px] !px-1.5 !py-0 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
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
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50">
          {!selected && (
            <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
              <div className="text-center">
                <MessageCircle size={32} className="mx-auto mb-2 text-neutral-400" />
                Выберите диалог слева
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
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={contactName} url={contact?.avatar_url ?? undefined} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">{contactName}</span>
              {conversation.channel_kind && (
                <span className={clsx("chip", KIND_COLOR[conversation.channel_kind])}>
                  {KIND_LABEL[conversation.channel_kind]}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-neutral-500">
              {contact?.username && <>@{contact.username} · </>}
              {contact?.phone && <>{contact.phone} · </>}
              {contact?.external_id && <span className="font-mono">{contact.external_id}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="btn-ghost !py-1 !px-2 text-sm"
            onClick={onLinkLead}
            title={contact?.linked_lead_id ? "Связано с лидом" : "Связать с лидом"}
          >
            <Link2 size={14} />
            {contact?.linked_lead_id ? ` Лид #${contact.linked_lead_id}` : " Лид"}
          </button>
          <button
            className="btn-ghost !py-1 !px-2 text-sm"
            onClick={() => closeMut.mutate()}
            disabled={closeMut.isPending}
            title={conversation.is_closed ? "Открыть" : "Закрыть"}
          >
            {conversation.is_closed ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-neutral-50/50 p-4 dark:bg-neutral-900/20">
        {isPending && (
          <div className="flex items-center justify-center py-8 text-neutral-500">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
        {!isPending && (messages ?? []).length === 0 && (
          <div className="py-8 text-center text-sm text-neutral-500">Пока нет сообщений</div>
        )}
        <div className="space-y-2">
          {(messages ?? []).map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
        </div>
      </div>

      {/* Input */}
      <form
        onSubmit={onSubmit}
        className="border-t border-neutral-200 p-3 dark:border-neutral-800"
      >
        {conversation.is_closed && (
          <div className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            Диалог закрыт. Откройте, чтобы отвечать.
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <textarea
              className="input min-h-[44px] resize-none py-2 text-sm"
              placeholder="Введите сообщение…"
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
          <button
            type="button"
            className="btn-ghost !p-2 shrink-0"
            title="Шаблоны"
            onClick={() => setShowTemplates((v) => !v)}
            disabled={conversation.is_closed || !(templates?.length)}
          >
            <MessageCircle size={16} />
          </button>
          <button
            type="submit"
            className="btn-primary shrink-0"
            disabled={!text.trim() || send.isPending || conversation.is_closed}
          >
            {send.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Отправить
          </button>
        </div>
        {showTemplates && (templates?.length ?? 0) > 0 && (
          <div className="mt-2 grid gap-1 rounded-lg border border-neutral-200 p-2 text-xs dark:border-neutral-800">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">Шаблоны</div>
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
  return (
    <div className={clsx("flex", isOut ? "justify-end" : "justify-start")}>
      <div
        className={clsx(
          "max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm",
          isOut
            ? "bg-brand-500 text-white"
            : "bg-white text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100",
          msg.status === "failed" && "ring-2 ring-rose-500",
        )}
      >
        {msg.is_auto && (
          <div className={clsx("mb-1 text-[10px] uppercase tracking-wide", isOut ? "text-white/70" : "text-neutral-500")}>
            авто
          </div>
        )}
        <div className="whitespace-pre-wrap break-words">{msg.body || "(без текста)"}</div>
        {msg.media && (
          <div className={clsx("mt-1 text-[10px]", isOut ? "text-white/70" : "text-neutral-500")}>
            📎 {String(msg.media.type || "media")}
          </div>
        )}
        <div className={clsx("mt-1 flex items-center gap-1 text-[10px]", isOut ? "text-white/70" : "text-neutral-400")}>
          <span>{new Date(msg.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
          {isOut && (
            <span>
              {msg.status === "pending" && "⏳"}
              {msg.status === "sent" && "✓"}
              {msg.status === "delivered" && "✓✓"}
              {msg.status === "read" && "✓✓"}
              {msg.status === "failed" && (
                <span title={msg.error || ""} className="text-rose-300">
                  ! ошибка
                </span>
              )}
            </span>
          )}
        </div>
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
          <button className="btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn-primary"
            disabled={mut.isPending || (mode === "existing" && !leadId)}
            onClick={() => mut.mutate()}
          >
            Готово
          </button>
        </div>
      </div>
    </Modal>
  );
}
