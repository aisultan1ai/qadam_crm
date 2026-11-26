/**
 * «Спроси CRM» — чат с ИИ-помощником в выезжающей панели справа.
 * История хранится только в состоянии компонента (в браузере); на сервер уходит вся переписка запросом.
 * Кнопка видна только когда ИИ доступен компании (useAi().available).
 *
 * Безопасность отображения: Markdown рендерится без HTML; ссылки — только внутренние пути платформы
 * (сервер и так оставляет лишь ссылки на записи, которые вернули инструменты), картинки не показываются.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, Briefcase, CheckSquare, FileSignature, Loader2, RotateCcw, SendHorizontal, Sparkles, X } from "lucide-react";
import { isAxiosError } from "axios";

import { api, extractApiError } from "@/api/client";
import { useAi } from "@/hooks/useAi";

type LinkType = "task" | "deal" | "contract" | "wiki";
type RecordLink = { type: LinkType; id: number; title: string; url: string };
type AssistantReply = { answer: string; off_topic: boolean; links: RecordLink[] };

type ChatItem =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; links: RecordLink[]; offTopic: boolean }
  | { role: "error"; content: string };

const MAX_MESSAGES = 20;
const MAX_CHARS = 4000;

const EXAMPLES = [
  "Какие у меня просроченные задачи?",
  "Какие сделки без движения больше 14 дней?",
  "Какие договоры истекают в ближайшие 30 дней?",
  "Законтрактованный объём offtake по годам",
  "Что сказано в базе знаний про отпуск?",
];

const LINK_ICON: Record<LinkType, typeof CheckSquare> = {
  task: CheckSquare,
  deal: Briefcase,
  contract: FileSignature,
  wiki: BookOpen,
};

/** Только внутренние пути платформы: «/tasks/1», «/deals?deal=2»… Внешние адреса — обычным текстом. */
function isInternal(href?: string): href is string {
  return !!href && href.startsWith("/") && !href.startsWith("//") && !href.includes("\\");
}

function errorText(err: unknown): string {
  const status = isAxiosError(err) ? err.response?.status : undefined;
  const msg = extractApiError(err).message;
  if (status === 429) return msg || "Исчерпан лимит запросов к ИИ на этот месяц";
  if (status === 403) return "ИИ-помощник выключен для вашей компании. Его может включить владелец в Настройки → «ИИ-помощник»";
  if (status === 402) return "ИИ-помощник недоступен на вашем тарифе";
  if (status === 422) return msg || "ИИ-помощник не может обработать этот запрос. Переформулируйте его";
  return msg || "ИИ-помощник сейчас недоступен. Попробуйте ещё раз через минуту";
}

/** История для сервера: только удачные реплики, чередование user/assistant, начинается и заканчивается вопросом. */
function toPayload(items: ChatItem[]): { role: "user" | "assistant"; content: string }[] {
  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  for (const it of items) {
    if (it.role === "error") continue;
    const content = it.content.slice(0, MAX_CHARS);
    if (msgs.length && msgs[msgs.length - 1].role === it.role) {
      msgs[msgs.length - 1] = { role: it.role, content }; // без ответа на прошлый вопрос — берём последний
    } else {
      msgs.push({ role: it.role, content });
    }
  }
  let tail = msgs.slice(-MAX_MESSAGES);
  while (tail.length && tail[0].role !== "user") tail = tail.slice(1);
  return tail;
}

function Answer({ text }: { text: string }) {
  return (
    <div className="leading-[1.55] [&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 dark:[&_code]:bg-white/10 [&_ol]:ml-4 [&_ol]:list-decimal [&_p]:my-1 [&_strong]:font-semibold [&_table]:my-1 [&_td]:border [&_td]:border-zinc-200 [&_td]:px-1.5 [&_th]:border [&_th]:border-zinc-200 [&_th]:px-1.5 [&_ul]:ml-4 [&_ul]:list-disc dark:[&_td]:border-zinc-700 dark:[&_th]:border-zinc-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) =>
            isInternal(href) ? (
              <Link to={href} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
                {children}
              </Link>
            ) : (
              <span>{children}</span>
            ),
          img: () => null,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function Bubble({ item }: { item: ChatItem }) {
  if (item.role === "user") {
    return (
      <div className="ml-8 self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-600 px-3 py-2 text-white">{item.content}</div>
    );
  }
  if (item.role === "error") {
    return (
      <div className="mr-8 rounded-2xl rounded-bl-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
        {item.content}
      </div>
    );
  }
  return (
    <div className="mr-6 rounded-2xl rounded-bl-md bg-zinc-100 px-3 py-2 text-zinc-800 dark:bg-white/5 dark:text-zinc-200">
      {item.offTopic ? <p>{item.content}</p> : <Answer text={item.content} />}
      {item.links.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.links.map((l) => {
            const Icon = LINK_ICON[l.type] ?? CheckSquare;
            return isInternal(l.url) ? (
              <Link
                key={`${l.type}-${l.id}`}
                to={l.url}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[12px] text-zinc-700 hover:border-brand-300 hover:text-brand-700 dark:border-zinc-700 dark:bg-[#23262D] dark:text-zinc-300 dark:hover:text-brand-300"
              >
                <Icon size={12} className="shrink-0" />
                <span className="truncate">{l.title}</span>
              </Link>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

function Panel({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [items, busy]);

  const ask = async (question: string) => {
    const q = question.trim().slice(0, MAX_CHARS);
    if (!q || busy) return;
    const next: ChatItem[] = [...items, { role: "user", content: q }];
    setItems(next);
    setInput("");
    setBusy(true);
    try {
      const { data } = await api.post<AssistantReply>(
        "/api/ai/assistant",
        { messages: toPayload(next) },
        { timeout: 180_000 },
      );
      setItems((cur) => [...cur, { role: "assistant", content: data.answer, links: data.links ?? [], offTopic: data.off_topic }]);
    } catch (err) {
      setItems((cur) => [...cur, { role: "error", content: errorText(err) }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void ask(input);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Спросить ИИ">
      <div className="absolute inset-0 bg-zinc-950/30 animate-fade-in" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[440px] flex-col border-l border-zinc-200 bg-white text-[13px] text-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-[#1C1F25] dark:text-zinc-100">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
          <Sparkles size={16} className="text-brand-600 dark:text-brand-300" />
          <div className="font-semibold">Спросить ИИ</div>
          <div className="ml-auto flex items-center gap-1">
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => setItems([])}
                disabled={busy}
                title="Новый разговор"
                aria-label="Новый разговор"
                className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-white/5"
              >
                <RotateCcw size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Закрыть"
              aria-label="Закрыть"
              className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-3" aria-live="polite">
          {items.length === 0 ? (
            <Intro onPick={(q) => void ask(q)} />
          ) : (
            items.map((it, i) => <Bubble key={i} item={it} />)
          )}
          {busy && (
            <div className="mr-8 flex items-center gap-2 rounded-2xl rounded-bl-md bg-zinc-100 px-3 py-2 text-zinc-500 dark:bg-white/5">
              <Loader2 size={14} className="animate-spin" /> Ищу в данных компании…
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
              onKeyDown={onKeyDown}
              rows={2}
              maxLength={MAX_CHARS}
              placeholder="Вопрос о задачах, сделках, договорах или базе знаний"
              className="min-h-[44px] flex-1 resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-[#23262D]"
            />
            <button
              type="button"
              onClick={() => void ask(input)}
              disabled={busy || !input.trim()}
              title="Отправить (Enter)"
              aria-label="Отправить"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <SendHorizontal size={16} />}
            </button>
          </div>
          <div className="mt-1.5 text-[11px] text-zinc-400">
            ИИ видит только данные вашей компании, доступные вам. Проверяйте важные детали в самих записях.
          </div>
        </div>
      </aside>
    </div>
  );
}

function Intro({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="space-y-3 py-2">
      <div className="text-zinc-600 dark:text-zinc-400">
        Спросите о задачах, сделках, договорах или о том, что написано в базе знаний компании. Помощник ищет только в
        тех разделах, к которым у вас есть доступ.
      </div>
      <div className="space-y-1.5">
        {EXAMPLES.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="block w-full rounded-lg border border-zinc-200 px-3 py-2 text-left text-zinc-700 hover:border-brand-300 hover:bg-brand-50/50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-white/5"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Кнопка «Спросить ИИ» для шапки. Ничего не рисует, если ИИ недоступен компании. */
export function AiAssistantButton() {
  const { available } = useAi();
  const [open, setOpen] = useState(false);
  if (!available) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Спросить ИИ"
        aria-label="Спросить ИИ"
        className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-white"
      >
        <Sparkles size={16} className="text-brand-600 dark:text-brand-300" />
        <span className="hidden lg:inline">Спросить ИИ</span>
      </button>
      {open && <Panel onClose={() => setOpen(false)} />}
    </>
  );
}

export default AiAssistantButton;
