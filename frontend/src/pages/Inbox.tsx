import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Archive, ArchiveRestore, ArrowLeft, Check, CheckCheck, Clock3, FileText, Link2, Loader2, MessageCircle, PanelRight, Paperclip,
} from "lucide-react";
import { api, extractApiError } from "@/api/client";
import { useToast } from "@/components/Toast";
import { Modal, Avatar } from "@/components/ui";
import { Button } from "@/components/lib/Button";

import { SearchInput } from "@/components/page";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Link } from "react-router-dom";
import {
  Composer, DayDivider, IconAction, ListEmpty, ListHeader, ListRow, ListTabs, PaneEmpty, PaneHeader, RowTag, Workspace, dayLabel,
} from "@/components/workspace";
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
          className={clsx("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white dark:ring-[#1B1E23]", KIND_DOT[kind])}
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
  // Карточка клиента: по умолчанию открыта на широком экране и пересчитывается при смене ширины/повороте;
  // как только пользователь переключил её сам — уважаем его выбор.
  const wide = useMediaQuery("(min-width: 1280px)");
  const [cardPref, setCardPref] = useState<boolean | null>(null);
  const cardOpen = cardPref ?? wide;

  return (
    <>
      <Workspace
        storageKey="inbox"
        showDetailOnMobile={!!selected}
        list={
          <>
            <ListHeader
              search={<SearchInput value={search} onChange={setSearch} placeholder="Поиск по клиенту" className="sm:w-full" />}
              action={
                (channels?.length ?? 0) > 1 ? (
                  <select
                    aria-label="Канал"
                    value={channelFilter ?? ""}
                    onChange={(e) => setChannelFilter(e.target.value ? Number(e.target.value) : null)}
                    className="h-8 w-[108px] shrink-0 cursor-pointer rounded-lg border border-zinc-200 bg-white px-2 text-[12.5px] text-zinc-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-zinc-700 dark:bg-[#1B1E23] dark:text-zinc-300"
                  >
                    <option value="">Все каналы</option>
                    {(channels ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name || KIND_LABEL[c.kind]}
                      </option>
                    ))}
                  </select>
                ) : undefined
              }
            >
              <ListTabs
                label="Статус диалогов"
                value={showClosed ? "all" : "open"}
                onChange={(v) => setShowClosed(v === "all")}
                items={[
                  { key: "open", label: "Открытые", count: totalUnread },
                  { key: "all", label: "Все" },
                ]}
              />
            </ListHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {convsLoading ? (
                <div className="flex items-center justify-center p-6 text-zinc-400">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              ) : (convs ?? []).length === 0 ? (
                <ListEmpty>
                  {search ? "Ничего не найдено" : "Диалогов пока нет"}
                </ListEmpty>
              ) : (
                (convs ?? []).map((c) => {
                  const contact = c.contact;
                  const name = contact?.display_name || contact?.username || contact?.phone || contact?.external_id || `#${c.id}`;
                  return (
                    <ListRow
                      key={c.id}
                      active={c.id === selectedId}
                      unread={c.unread_count > 0}
                      onClick={() => setSelectedId(c.id)}
                      avatar={<ContactAvatar name={name} url={contact?.avatar_url} kind={c.channel_kind} />}
                      title={name}
                      time={formatWhen(c.last_message_at)}
                      preview={c.last_message_preview || "—"}
                      count={c.unread_count}
                      meta={
                        (c.is_closed || contact?.linked_lead_id) && (
                          <>
                            {c.is_closed && <RowTag>закрыт</RowTag>}
                            {contact?.linked_lead_id && <RowTag tone="green">Лид #{contact.linked_lead_id}</RowTag>}
                          </>
                        )
                      }
                    />
                  );
                })
              )}
            </div>
          </>
        }
        aside={
          selected && cardOpen ? (
            <aside aria-label="Карточка клиента" className="hidden min-h-0 w-[300px] shrink-0 flex-col overflow-y-auto border-l border-zinc-200 bg-white lg:flex dark:border-zinc-800 dark:bg-[#1B1E23]">
              <ContactPanel conversation={selected} onLinkLead={() => setLinkOpen(true)} />
            </aside>
          ) : undefined
        }
      >
        {selected ? (
          <Chat
            conversation={selected}
            onBack={() => setSelectedId(null)}
            cardOpen={cardOpen}
            onToggleCard={() => setCardPref(!cardOpen)}
            onLinkLead={() => setLinkOpen(true)}
            onChanged={() => {
              qc.invalidateQueries({ queryKey: ["messenger-convs"] });
              qc.invalidateQueries({ queryKey: ["messenger-messages", selected.id] });
            }}
          />
        ) : (
          <PaneEmpty
            icon={MessageCircle}
            title={(channels?.length ?? 0) === 0 ? "Каналы ещё не подключены" : "Выберите диалог"}
            hint={
              (channels?.length ?? 0) === 0
                ? "Сообщения клиентов из Telegram, WhatsApp и Instagram будут приходить сюда."
                : "Переписка с клиентом и его карточка откроются здесь."
            }
            action={
              (channels?.length ?? 0) === 0 ? (
                <Link to="/settings/messengers" className="btn-primary">Подключить канал</Link>
              ) : undefined
            }
          />
        )}
      </Workspace>

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
    </>
  );
}

function Chat({
  conversation,
  onBack,
  cardOpen,
  onToggleCard,
  onLinkLead,
  onChanged,
}: {
  conversation: Conversation;
  onBack: () => void;
  cardOpen: boolean;
  onToggleCard: () => void;
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

  const submit = () => {
    const t = text.trim();
    if (!t || send.isPending) return;
    send.mutate(t);
  };

  const contact = conversation.contact;
  const contactName =
    contact?.display_name || contact?.username || contact?.phone || contact?.external_id || `#${conversation.id}`;

  const list = messages ?? [];
  return (
    <>
      <PaneHeader
        back={<span className="md:hidden"><IconAction icon={ArrowLeft} label="Назад" onClick={onBack} /></span>}
        actions={
          <>
            <IconAction
              icon={Link2}
              label={contact?.linked_lead_id ? `Связан с лидом #${contact.linked_lead_id}` : "Связать с лидом"}
              active={!!contact?.linked_lead_id}
              onClick={onLinkLead}
            />
            <IconAction
              icon={conversation.is_closed ? ArchiveRestore : Archive}
              label={conversation.is_closed ? "Открыть диалог" : "Закрыть диалог"}
              onClick={() => closeMut.mutate()}
              disabled={closeMut.isPending}
            />
            <span className="hidden lg:inline-flex">
              <IconAction icon={PanelRight} label={cardOpen ? "Скрыть карточку клиента" : "Карточка клиента"} active={cardOpen} onClick={onToggleCard} />
            </span>
          </>
        }
      >
        <ContactAvatar name={contactName} url={contact?.avatar_url} kind={conversation.channel_kind} size={32} />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-zinc-900 dark:text-white">{contactName}</div>
          <div className="truncate text-[12px] text-zinc-500">
            {[conversation.channel_kind ? KIND_LABEL[conversation.channel_kind] : null, contact?.username ? `@${contact.username}` : null, contact?.phone]
              .filter(Boolean)
              .join(" · ")}
            {conversation.is_closed ? " · закрыт" : ""}
          </div>
        </div>
      </PaneHeader>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {isPending ? (
          <div className="flex items-center justify-center py-8 text-zinc-400">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : list.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-zinc-400">Сообщений пока нет</div>
        ) : (
          <div className="space-y-2">
            {list.map((m, idx) => {
              const prev = list[idx - 1];
              const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
              return (
                <div key={m.id}>
                  {newDay && <DayDivider label={dayLabel(m.created_at)} />}
                  <MessageBubble msg={m} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Composer
        value={text}
        onChange={setText}
        onSubmit={submit}
        disabled={conversation.is_closed}
        sending={send.isPending}
        placeholder={
          conversation.is_closed
            ? "Диалог закрыт — откройте его, чтобы ответить"
            : `Ответ в ${conversation.channel_kind ? KIND_LABEL[conversation.channel_kind] : "канал"}…`
        }
        tools={
          (templates?.length ?? 0) > 0 ? (
            <button
              type="button"
              onClick={() => setShowTemplates((v) => !v)}
              disabled={conversation.is_closed}
              aria-expanded={showTemplates}
              aria-label="Шаблоны ответов"
              title="Шаблоны ответов"
              className={clsx(
                "grid h-8 w-8 place-items-center rounded-lg transition-colors disabled:opacity-40",
                showTemplates ? "bg-brand-500/10 text-brand-700 dark:text-brand-300" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/5 dark:hover:text-zinc-200",
              )}
            >
              <FileText size={16} />
            </button>
          ) : undefined
        }
        above={
          showTemplates && (templates?.length ?? 0) > 0 ? (
            <div className="mb-1.5 max-h-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 text-[13px] shadow-pop dark:border-zinc-700 dark:bg-[#1B1E23]">
              {templates!.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="block w-full truncate rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-white/5"
                  onClick={() => {
                    setText(t.body);
                    setShowTemplates(false);
                  }}
                >
                  <span className="font-medium">{t.name}</span> <span className="text-zinc-500">— {t.body}</span>
                </button>
              ))}
            </div>
          ) : undefined
        }
      />
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
          "max-w-[72%] px-3 py-2 text-[13.5px] leading-[1.45]",
          isOut
            ? "rounded-[12px_12px_4px_12px] bg-brand-600 text-white"
            : "rounded-[12px_12px_12px_4px] border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-[#1B1E23] dark:text-zinc-100",
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
      <div className="mt-0.5 flex items-center gap-1.5 px-1 text-[11px] text-zinc-400">
        {msg.is_auto && <span className="rounded bg-zinc-100 px-1 text-[11px] dark:bg-[#23262D]">авто</span>}
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
