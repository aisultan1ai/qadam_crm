import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowLeft, MessageSquarePlus, Paperclip, Search, Send, Smile, Users as UsersIcon,
  X, MoreHorizontal, Trash2, Edit3, CornerUpLeft, BarChart3, Check, ChevronsRight,
} from "lucide-react";

import { api, API_URL, extractApiError } from "@/api/client";
import { useAuth } from "@/store/auth";
import { subscribeChannel, unsubscribeChannel } from "@/lib/ws";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { Avatar, EmptyState, Loader, Modal } from "@/components/ui";
import { VirtualList } from "@/components/VirtualList";
import { fromNow } from "@/lib/date";

// =========================================================================
// Types
// =========================================================================

type UserBrief = { id: number; name: string; email: string; avatar_url: string | null };

type ChannelListItem = {
  id: number;
  kind: "project" | "dm" | "group";
  project_id: number | null;
  name: string | null;
  is_archived: boolean;
  last_message_at: string | null;
  unread_count: number;
  last_message_preview: string | null;
  peer: UserBrief | null;
};

type ChannelDetail = ChannelListItem & {
  topic: string | null;
  created_at: string;
  members: {
    user_id: number; role: string; muted: boolean; last_read_message_id: number | null;
    joined_at: string; user: UserBrief | null;
  }[];
};

type ReactionOut = { emoji: string; count: number; user_ids: number[] };
type AttachmentBrief = { id: number; filename: string; content_type: string | null; size: number };
type PollOption = { id: number; text: string; votes: number; voted: boolean };
type Poll = {
  id: number; question: string; allow_multiple: boolean; anonymous: boolean;
  closes_at: string | null; closed_at: string | null;
  options: PollOption[]; my_votes: number[]; total_votes: number;
};

type MessageOut = {
  id: number; channel_id: number; author: UserBrief | null;
  body: string; reply_to_id: number | null; reply_preview: string | null;
  edited_at: string | null; deleted_at: string | null; created_at: string;
  reactions: ReactionOut[]; attachments: AttachmentBrief[]; poll: Poll | null;
};

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "✅"];

// =========================================================================
// Root page
// =========================================================================

export default function Messenger() {
  const { channelId } = useParams();
  const nav = useNavigate();
  const activeId = channelId ? Number(channelId) : null;

  const { data: channels, isPending } = useQuery({
    queryKey: ["messenger", "channels"],
    queryFn: async () => (await api.get<ChannelListItem[]>("/api/messenger/channels")).data,
    staleTime: 30_000,
  });

  const [newDmOpen, setNewDmOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");

  const filteredChannels = useMemo(() => {
    if (!channels) return [];
    const q = searchQ.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((c) => {
      const name = c.name || c.peer?.name || "";
      return name.toLowerCase().includes(q);
    });
  }, [channels, searchQ]);

  return (
    <div className="grid h-[calc(100vh-140px)] gap-3 md:grid-cols-[300px_1fr]">
      <aside
        className={clsx(
          "flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/60",
          activeId ? "hidden md:flex" : "flex",
        )}
      >
        <div className="border-b border-neutral-100 p-3 dark:border-neutral-800">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Чаты</h2>
            <div className="flex gap-1">
              <button className="btn-ghost !p-1.5" title="Новый DM" onClick={() => setNewDmOpen(true)}>
                <MessageSquarePlus size={16} />
              </button>
              <button className="btn-ghost !p-1.5" title="Новая группа" onClick={() => setNewGroupOpen(true)}>
                <UsersIcon size={16} />
              </button>
            </div>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2 text-neutral-400" />
            <input
              className="input pl-7 text-sm"
              placeholder="Поиск чата…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isPending ? (
            <div className="p-4"><Loader /></div>
          ) : filteredChannels.length === 0 ? (
            <EmptyState title="Пока нет чатов" description="Создайте DM или группу" icon={<MessageSquarePlus size={28} />} />
          ) : (
            <ChannelList channels={filteredChannels} activeId={activeId} onOpen={(id) => nav(`/messenger/${id}`)} />
          )}
        </div>
      </aside>

      <section
        className={clsx(
          "flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/60",
          activeId ? "flex" : "hidden md:flex",
        )}
      >
        {activeId ? (
          <ChatWindow channelId={activeId} onBack={() => nav("/messenger")} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <div className="max-w-sm text-neutral-500">
              <MessageSquarePlus size={40} className="mx-auto mb-3 text-neutral-300" />
              <div className="text-sm">Выберите чат слева или создайте новый.</div>
            </div>
          </div>
        )}
      </section>

      {newDmOpen && <NewDmModal onClose={() => setNewDmOpen(false)} />}
      {newGroupOpen && <NewGroupModal onClose={() => setNewGroupOpen(false)} />}
    </div>
  );
}

// =========================================================================
// Channel list
// =========================================================================

function ChannelList({
  channels,
  activeId,
  onOpen,
}: {
  channels: ChannelListItem[];
  activeId: number | null;
  onOpen: (id: number) => void;
}) {
  const groups: Record<string, ChannelListItem[]> = { project: [], dm: [], group: [] };
  for (const c of channels) groups[c.kind]?.push(c);

  const renderSection = (label: string, kind: "project" | "dm" | "group") => {
    const list = groups[kind];
    if (!list?.length) return null;
    return (
      <div key={kind}>
        <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{label}</div>
        {list.map((c) => (
          <ChannelListRow key={c.id} channel={c} active={c.id === activeId} onOpen={onOpen} />
        ))}
      </div>
    );
  };

  return (
    <>
      {renderSection("Проекты", "project")}
      {renderSection("Личные", "dm")}
      {renderSection("Группы", "group")}
    </>
  );
}

function ChannelListRow({
  channel,
  active,
  onOpen,
}: {
  channel: ChannelListItem;
  active: boolean;
  onOpen: (id: number) => void;
}) {
  const displayName = channel.name || channel.peer?.name || `Канал #${channel.id}`;
  return (
    <button
      type="button"
      onClick={() => onOpen(channel.id)}
      className={clsx(
        "flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors",
        active ? "bg-brand-50 text-brand-800 dark:bg-brand-900/25 dark:text-brand-200" : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60",
      )}
    >
      {channel.peer ? (
        <Avatar name={channel.peer.name} url={channel.peer.avatar_url} size={30} />
      ) : (
        <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200">
          {channel.kind === "project" ? "#" : displayName.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate font-medium">{displayName}</span>
          {channel.last_message_at && (
            <span className="shrink-0 text-[10px] text-neutral-400">
              {fromNow(channel.last_message_at)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-neutral-500">
            {channel.last_message_preview || <em className="text-neutral-400">Нет сообщений</em>}
          </span>
          {channel.unread_count > 0 && (
            <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {channel.unread_count > 99 ? "99+" : channel.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// =========================================================================
// Chat window
// =========================================================================

function ChatWindow({ channelId, onBack }: { channelId: number; onBack: () => void }) {
  const qc = useQueryClient();
  const { me } = useAuth();

  const { data: channel } = useQuery({
    queryKey: ["messenger", "channel", channelId],
    queryFn: async () =>
      (await api.get<ChannelDetail>(`/api/messenger/channels/${channelId}`)).data,
    staleTime: 30_000,
  });

  const { data: messages = [], isPending: messagesPending } = useQuery({
    queryKey: ["messenger", "messages", channelId],
    queryFn: async () =>
      (await api.get<MessageOut[]>(`/api/messenger/channels/${channelId}/messages`, { params: { limit: 100 } })).data,
    staleTime: 15_000,
  });

  // Подписка на per-channel WS-события — только пока чат открыт.
  useEffect(() => {
    subscribeChannel(channelId);
    // Ретрай при переподключении WS — при первом успешном handshake событий не будет,
    // так что дублируем подписку через 1с (после reconnect activeWs готов).
    const t = window.setTimeout(() => subscribeChannel(channelId), 1000);
    return () => {
      window.clearTimeout(t);
      unsubscribeChannel(channelId);
    };
  }, [channelId]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [replyTo, setReplyTo] = useState<MessageOut | null>(null);
  const [editing, setEditing] = useState<MessageOut | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [pendingReplyMsgId, setPendingReplyMsgId] = useState<number | null>(null);

  // Scroll to bottom при смене канала (всегда) и при новом сообщении (только если юзер у нижнего края).
  const prevChannelIdRef = useRef<number | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const isChannelChange = prevChannelIdRef.current !== channelId;
    prevChannelIdRef.current = channelId;
    if (isChannelChange) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    // Новое сообщение — прокручиваем только если и так у низа (иначе не мешаем чтению истории).
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, channelId]);

  // Mark read when scrolled to bottom
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || messages.length === 0) return;
    const last = messages[messages.length - 1];
    const isBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (isBottom) {
      api.post(`/api/messenger/channels/${channelId}/read`, { message_id: last.id }).catch(() => {});
    }
  }, [messages, channelId]);

  const channelName = channel?.name || channel?.peer?.name || `Канал #${channelId}`;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-neutral-100 p-3 dark:border-neutral-800">
        <div className="flex min-w-0 items-center gap-2">
          <button className="btn-ghost !p-1.5 md:hidden" onClick={onBack} title="Назад">
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{channelName}</div>
            <div className="truncate text-xs text-neutral-500">
              {channel?.kind === "dm" ? channel.peer?.email : `${channel?.members.length ?? 0} участников`}
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          <button className="btn-ghost !p-1.5" title="Поиск" onClick={() => setSearch(search === null ? "" : null)}>
            <Search size={16} />
          </button>
        </div>
      </header>

      {search !== null && (
        <SearchPanel channelId={channelId} q={search} setQ={setSearch} onClose={() => setSearch(null)} />
      )}

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-3 py-3">
        {messagesPending ? (
          <Loader />
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            Пусто. Напишите первое сообщение.
          </div>
        ) : (
          <VirtualList
            items={messages}
            itemHeight={80}
            height="100%"
            className="space-y-1"
            threshold={100}
            getKey={(m) => (m as MessageOut).id}
            renderItem={(m, idx) => {
              const prev = messages[idx - 1];
              const message = m as MessageOut;
              const grouped =
                !!prev && prev.author?.id === message.author?.id && !prev.deleted_at && !message.deleted_at;
              return (
                <MessageRow
                  message={message}
                  grouped={grouped}
                  highlighted={pendingReplyMsgId === message.id}
                  meId={me?.id}
                  channelId={channelId}
                  onReply={() => setReplyTo(message)}
                  onEdit={() => setEditing(message)}
                />
              );
            }}
          />
        )}
      </div>

      <MessageComposer
        channelId={channelId}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onSent={() => {
          setReplyTo(null);
          setEditing(null);
        }}
        onOpenPoll={() => setPollOpen(true)}
        onJumpToMessage={(id) => {
          setPendingReplyMsgId(id);
          const el = document.getElementById(`msg-${id}`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
          setTimeout(() => setPendingReplyMsgId(null), 1500);
        }}
      />

      {pollOpen && (
        <CreatePollModal channelId={channelId} onClose={() => setPollOpen(false)} />
      )}
    </div>
  );
}

// =========================================================================
// Message row
// =========================================================================

function MessageRow({
  message: m,
  grouped,
  highlighted,
  meId,
  channelId,
  onReply,
  onEdit,
}: {
  message: MessageOut;
  grouped: boolean;
  highlighted: boolean;
  meId?: number;
  channelId: number;
  onReply: () => void;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isMe = meId && m.author?.id === meId;

  const reactMut = useMutation({
    mutationFn: async ({ emoji, add }: { emoji: string; add: boolean }) => {
      if (add) {
        await api.post(`/api/messenger/messages/${m.id}/reactions`, { emoji });
      } else {
        await api.delete(`/api/messenger/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messenger", "messages", channelId] }),
    onError: (e) => toast.error("Ошибка реакции", extractApiError(e).message),
  });

  const del = useMutation({
    mutationFn: () => api.delete(`/api/messenger/channels/${channelId}/messages/${m.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messenger", "messages", channelId] }),
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const bodyHtml = useMemo(() => renderInlineMarkdown(m.body || ""), [m.body]);

  return (
    <div id={`msg-${m.id}`} className={clsx("group relative", highlighted && "rounded-lg bg-brand-50 dark:bg-brand-900/20")}>
      <div className={clsx("flex gap-2 px-1", grouped ? "pt-0.5" : "pt-3")}>
        <div className="w-8 shrink-0">
          {!grouped && m.author && <Avatar name={m.author.name} url={m.author.avatar_url} size={28} />}
        </div>
        <div className="min-w-0 flex-1">
          {!grouped && (
            <div className="mb-0.5 flex items-baseline gap-2">
              <span className="text-sm font-semibold">{m.author?.name || "—"}</span>
              <span className="text-[10px] text-neutral-400" title={new Date(m.created_at).toLocaleString("ru-RU")}>
                {fromNow(m.created_at)}
              </span>
              {m.edited_at && <span className="text-[10px] text-neutral-400">(изм.)</span>}
            </div>
          )}
          {m.reply_preview && m.reply_to_id && (
            <div className="mb-1 border-l-2 border-neutral-300 pl-2 text-xs text-neutral-500 dark:border-neutral-700">
              <CornerUpLeft size={10} className="inline" /> {m.reply_preview}
            </div>
          )}
          {m.deleted_at ? (
            <div className="text-sm italic text-neutral-400">сообщение удалено</div>
          ) : (
            <div className="whitespace-pre-wrap break-words text-sm" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          )}
          {m.poll && (
            <PollView poll={m.poll} channelId={channelId} />
          )}
          {m.attachments.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {m.attachments.map((a) => (
                <a
                  key={a.id}
                  href={`${API_URL}/api/messenger/attachments/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800/60"
                  title={`${a.filename} · ${(a.size / 1024).toFixed(1)} КБ`}
                >
                  <Paperclip size={11} /> <span className="max-w-[180px] truncate">{a.filename}</span>
                </a>
              ))}
            </div>
          )}
          {m.reactions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {m.reactions.map((r) => {
                const mine = meId ? r.user_ids.includes(meId) : false;
                return (
                  <button
                    key={r.emoji}
                    className={clsx(
                      "rounded-full border px-1.5 py-0.5 text-[11px] transition-colors",
                      mine
                        ? "border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-900/30 dark:text-brand-200"
                        : "border-neutral-200 bg-neutral-50 hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800/50",
                    )}
                    onClick={() => reactMut.mutate({ emoji: r.emoji, add: !mine })}
                  >
                    {r.emoji} {r.count}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="absolute right-2 top-1 hidden gap-1 rounded-md border border-neutral-200 bg-white p-1 shadow-sm group-hover:flex dark:border-neutral-700 dark:bg-neutral-900">
          <button className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" title="Реакция" onClick={() => setEmojiOpen((v) => !v)}>
            <Smile size={13} />
          </button>
          <button className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" title="Ответить" onClick={onReply}>
            <CornerUpLeft size={13} />
          </button>
          {isMe && !m.deleted_at && (
            <>
              <button className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" title="Редактировать" onClick={onEdit}>
                <Edit3 size={13} />
              </button>
              <button
                className="rounded p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                title="Удалить"
                onClick={async () => {
                  if (await confirm({ title: "Удалить сообщение?", message: "Восстановить нельзя.", confirmLabel: "Удалить" })) {
                    del.mutate();
                  }
                }}
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>

        {emojiOpen && (
          <div className="absolute right-2 top-9 z-10 flex gap-1 rounded-lg border border-neutral-200 bg-white p-1.5 shadow-md dark:border-neutral-700 dark:bg-neutral-900">
            {REACTIONS.map((e) => (
              <button
                key={e}
                className="rounded p-1 text-base hover:bg-neutral-100 dark:hover:bg-neutral-800"
                onClick={() => {
                  reactMut.mutate({ emoji: e, add: true });
                  setEmojiOpen(false);
                }}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Простой inline-markdown: **bold**, _italic_, `code`, автоссылки. Экранируем HTML.
function renderInlineMarkdown(input: string): string {
  const esc = input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return esc
    .replace(/`([^`]+)`/g, '<code class="rounded bg-neutral-100 px-1 text-[13px] dark:bg-neutral-800">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|\W)_([^_]+)_(?!\w)/g, "$1<i>$2</i>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noreferrer" class="link">$1</a>')
    .replace(/@([\wа-яё-]+)/gi, '<span class="text-brand-600 dark:text-brand-400">@$1</span>');
}

// =========================================================================
// Composer
// =========================================================================

function MessageComposer({
  channelId,
  replyTo,
  onCancelReply,
  editing,
  onCancelEdit,
  onSent,
  onOpenPoll,
  onJumpToMessage,
}: {
  channelId: number;
  replyTo: MessageOut | null;
  onCancelReply: () => void;
  editing: MessageOut | null;
  onCancelEdit: () => void;
  onSent: () => void;
  onOpenPoll: () => void;
  onJumpToMessage: (id: number) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [attachmentIds, setAttachmentIds] = useState<AttachmentBrief[]>([]);

  useEffect(() => {
    if (editing) {
      setText(editing.body);
      taRef.current?.focus();
    }
  }, [editing]);

  const autoResize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(200, ta.scrollHeight) + "px";
  };
  useEffect(autoResize, [text]);

  const send = useMutation({
    mutationFn: async (body: string) => {
      if (editing) {
        return api.patch(`/api/messenger/channels/${channelId}/messages/${editing.id}`, { body });
      }
      return api.post(`/api/messenger/channels/${channelId}/messages`, {
        body,
        reply_to_id: replyTo?.id ?? null,
        attachment_ids: attachmentIds.map((a) => a.id),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messenger", "messages", channelId] });
      qc.invalidateQueries({ queryKey: ["messenger", "channels"] });
      setText("");
      setAttachmentIds([]);
      onSent();
    },
    onError: (e) => toast.error("Ошибка отправки", extractApiError(e).message),
  });

  const submit = () => {
    const body = text.trim();
    if (!body && attachmentIds.length === 0) return;
    send.mutate(body);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post<AttachmentBrief>(`/api/messenger/channels/${channelId}/upload`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setAttachmentIds((prev) => [...prev, res.data]);
    } catch (e) {
      toast.error("Не удалось загрузить", extractApiError(e).message);
    } finally {
      setUploading(false);
    }
  };

  const onPickFile = (ev: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(ev.target.files || []);
    files.forEach(uploadFile);
    ev.target.value = "";
  };

  const onPaste = (ev: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(ev.clipboardData.files);
    if (files.length > 0) {
      ev.preventDefault();
      files.forEach(uploadFile);
    }
  };

  const onDrop = (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    const files = Array.from(ev.dataTransfer.files);
    files.forEach(uploadFile);
  };

  return (
    <div
      className="border-t border-neutral-100 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {(replyTo || editing) && (
        <div className="mb-1 flex items-start justify-between rounded-md bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">
              {editing ? "Редактирование" : `Ответ ${replyTo?.author?.name || "…"}`}
            </div>
            {(editing || replyTo) && (
              <button
                type="button"
                className="line-clamp-1 truncate text-left hover:underline"
                onClick={() => {
                  const id = editing?.id ?? replyTo?.id;
                  if (id) onJumpToMessage(id);
                }}
              >
                {editing?.body || replyTo?.body}
              </button>
            )}
          </div>
          <button
            className="p-1 text-neutral-400 hover:text-neutral-700"
            onClick={editing ? onCancelEdit : onCancelReply}
            aria-label="Отменить"
          >
            <X size={12} />
          </button>
        </div>
      )}
      {attachmentIds.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {attachmentIds.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
              <Paperclip size={10} /> {a.filename}
              <button className="text-neutral-400 hover:text-rose-500" onClick={() => setAttachmentIds((p) => p.filter((x) => x.id !== a.id))}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <label className="cursor-pointer rounded-md p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" title="Прикрепить">
          <Paperclip size={16} />
          <input type="file" multiple className="hidden" onChange={onPickFile} disabled={uploading} />
        </label>
        <button
          type="button"
          className="rounded-md p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          title="Создать опрос"
          onClick={onOpenPoll}
        >
          <BarChart3 size={16} />
        </button>
        <textarea
          ref={taRef}
          className="input flex-1 resize-none text-sm"
          rows={1}
          placeholder={editing ? "Редактируйте…" : "Написать сообщение… (Shift+Enter — новая строка)"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <button
          type="button"
          className="btn-primary !px-3"
          disabled={send.isPending || uploading || (!text.trim() && attachmentIds.length === 0)}
          onClick={submit}
        >
          {editing ? <Check size={16} /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}

// =========================================================================
// Poll UI
// =========================================================================

function PollView({ poll, channelId }: { poll: Poll; channelId: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<number[]>(poll.my_votes);

  useEffect(() => setSelected(poll.my_votes), [poll.id, poll.my_votes.join(",")]);

  const vote = useMutation({
    mutationFn: (option_ids: number[]) => api.post(`/api/messenger/polls/${poll.id}/vote`, { option_ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messenger", "messages", channelId] }),
    onError: (e) => toast.error("Ошибка голосования", extractApiError(e).message),
  });

  const closed = !!poll.closed_at;
  const toggle = (id: number) => {
    if (closed) return;
    if (poll.allow_multiple) {
      setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    } else {
      setSelected([id]);
    }
  };

  return (
    <div className="mt-2 max-w-md rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2 text-sm font-medium">{poll.question}</div>
      <div className="space-y-1.5">
        {poll.options.map((o) => {
          const pct = poll.total_votes > 0 ? Math.round((o.votes / poll.total_votes) * 100) : 0;
          const mine = selected.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => toggle(o.id)}
              disabled={closed}
              className={clsx(
                "relative w-full overflow-hidden rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
                mine
                  ? "border-brand-400 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/30"
                  : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-700",
                closed && "cursor-default",
              )}
            >
              <div
                className="absolute inset-y-0 left-0 bg-brand-500/10"
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  {mine && <Check size={12} className="text-brand-600" />}
                  {o.text}
                </span>
                <span className="text-xs text-neutral-500">{o.votes} · {pct}%</span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500">
        <span>{poll.total_votes} голосов{closed && " · закрыт"}</span>
        {!closed && (
          <button
            className="btn-primary !px-2 !py-0.5 text-xs"
            disabled={selected.length === 0 || vote.isPending || selected.sort().join(",") === poll.my_votes.slice().sort().join(",")}
            onClick={() => vote.mutate(selected)}
          >
            Голосовать
          </button>
        )}
      </div>
    </div>
  );
}

function CreatePollModal({ channelId, onClose }: { channelId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(false);

  const create = useMutation({
    mutationFn: async () => {
      const msg = await api.post<MessageOut>(`/api/messenger/channels/${channelId}/messages`, {
        body: `📊 ${question.trim()}`,
      });
      await api.post(`/api/messenger/messages/${msg.data.id}/polls`, {
        question: question.trim(),
        options: options.map((o) => o.trim()).filter(Boolean),
        allow_multiple: allowMultiple,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messenger", "messages", channelId] });
      onClose();
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
  const canCreate = question.trim().length > 0 && cleanOptions.length >= 2;

  return (
    <Modal open onClose={onClose} title="Новый опрос" size="md">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">Вопрос</span>
          <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Например: куда пойдём на обед?" />
        </label>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500">Варианты</span>
            {options.length < 10 && (
              <button className="text-xs text-brand-600 hover:underline" onClick={() => setOptions((o) => [...o, ""])}>+ Ещё вариант</button>
            )}
          </div>
          <div className="space-y-1.5">
            {options.map((v, i) => (
              <div key={i} className="flex gap-1">
                <input
                  className="input flex-1"
                  value={v}
                  placeholder={`Вариант ${i + 1}`}
                  onChange={(e) => setOptions((o) => o.map((x, idx) => (idx === i ? e.target.value : x)))}
                />
                {options.length > 2 && (
                  <button className="btn-ghost !px-2" onClick={() => setOptions((o) => o.filter((_, idx) => idx !== i))}>
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allowMultiple} onChange={(e) => setAllowMultiple(e.target.checked)} />
          Можно выбрать несколько вариантов
        </label>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-primary" onClick={() => create.mutate()} disabled={!canCreate || create.isPending}>
            Создать
          </button>
        </div>
      </div>
    </Modal>
  );
}

// =========================================================================
// New DM / New Group modals
// =========================================================================

function NewDmModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");

  const { data: users } = useQuery({
    queryKey: ["users-brief-search", q],
    queryFn: async () =>
      (await api.get<{ items: UserBrief[] }>("/api/users", { params: { q, per_page: 20 } })).data.items,
  });

  const create = useMutation({
    mutationFn: (userId: number) => api.post<ChannelDetail>(`/api/messenger/channels/dm/${userId}`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["messenger", "channels"] });
      onClose();
      nav(`/messenger/${r.data.id}`);
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  return (
    <Modal open onClose={onClose} title="Новый личный чат" size="sm">
      <div className="space-y-2">
        <input
          className="input"
          placeholder="Поиск сотрудника…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <div className="max-h-72 overflow-y-auto">
          {(users || []).map((u) => (
            <button
              key={u.id}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
              onClick={() => create.mutate(u.id)}
            >
              <Avatar name={u.name} url={u.avatar_url} size={26} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{u.name}</div>
                <div className="truncate text-xs text-neutral-500">{u.email}</div>
              </div>
              <ChevronsRight size={14} className="text-neutral-400" />
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function NewGroupModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number[]>([]);

  const { data: users } = useQuery({
    queryKey: ["users-brief-group", q],
    queryFn: async () =>
      (await api.get<{ items: UserBrief[] }>("/api/users", { params: { q, per_page: 30 } })).data.items,
  });

  const create = useMutation({
    mutationFn: () => api.post<ChannelDetail>("/api/messenger/channels/group", { name: name.trim(), member_ids: selected }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["messenger", "channels"] });
      onClose();
      nav(`/messenger/${r.data.id}`);
    },
    onError: (e) => toast.error("Ошибка", extractApiError(e).message),
  });

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Modal open onClose={onClose} title="Новая группа" size="md">
      <div className="space-y-3">
        <input className="input" placeholder="Название группы" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <input className="input" placeholder="Поиск участников…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-64 overflow-y-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          {(users || []).map((u) => {
            const active = selected.includes(u.id);
            return (
              <button
                key={u.id}
                type="button"
                className={clsx(
                  "flex w-full items-center gap-2 px-2 py-2 text-left text-sm transition-colors",
                  active ? "bg-brand-50 dark:bg-brand-900/25" : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60",
                )}
                onClick={() => toggle(u.id)}
              >
                <Avatar name={u.name} url={u.avatar_url} size={24} />
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                {active && <Check size={13} className="text-brand-600" />}
              </button>
            );
          })}
        </div>
        <div className="text-xs text-neutral-500">Выбрано: {selected.length}</div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-primary" disabled={!name.trim() || selected.length === 0 || create.isPending} onClick={() => create.mutate()}>
            Создать
          </button>
        </div>
      </div>
    </Modal>
  );
}

// =========================================================================
// Search
// =========================================================================

function SearchPanel({ channelId, q, setQ, onClose }: { channelId: number; q: string; setQ: (s: string) => void; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["messenger", "search", channelId, q],
    queryFn: async () =>
      (await api.get("/api/messenger/search", { params: { q, channel_id: channelId, limit: 20 } })).data,
    enabled: q.trim().length >= 2,
  });

  return (
    <div className="border-b border-neutral-100 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="mb-1 flex items-center gap-2">
        <Search size={14} className="text-neutral-400" />
        <input
          className="input flex-1 text-sm"
          placeholder="Поиск в этом канале…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <button className="btn-ghost !p-1.5" onClick={onClose} title="Закрыть поиск" aria-label="Закрыть поиск"><X size={14} /></button>
      </div>
      {q.trim().length >= 2 && data && (
        <div className="max-h-40 overflow-y-auto text-xs">
          {(data as { message_id: number; snippet: string; author: UserBrief | null; created_at: string }[]).map((h) => (
            <a
              key={h.message_id}
              href={`#msg-${h.message_id}`}
              className="block rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              onClick={() => setTimeout(() => document.getElementById(`msg-${h.message_id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0)}
            >
              <span className="font-medium">{h.author?.name || "—"}:</span> {h.snippet}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
