import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Sparkles, X } from "lucide-react";

/** Ответ ИИ-сводки (почта и открытые линии): POST /api/ai/.../summary */
export type AiSummary = {
  topic: string;
  asks: string[];
  next_step: string;
  summary_markdown: string;
};

/**
 * Панель сводки ИИ над перепиской. Markdown рендерится без HTML (react-markdown по умолчанию
 * экранирует разметку), поэтому текст из писем не может внедрить скрипты.
 */
export function AiSummaryPanel({
  summary,
  loading,
  onClose,
}: {
  summary: AiSummary | null;
  loading?: boolean;
  onClose: () => void;
}) {
  return (
    <div className="mx-auto mb-3 max-w-3xl rounded-xl border border-brand-200 bg-brand-50/60 p-3.5 text-[13px] dark:border-brand-500/25 dark:bg-brand-500/5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-brand-700 dark:text-brand-300">
          <Sparkles size={14} /> Кратко
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Скрыть сводку"
          title="Скрыть сводку"
          className="grid h-6 w-6 place-items-center rounded-md text-zinc-400 hover:bg-white/70 hover:text-zinc-700 dark:hover:bg-white/5 dark:hover:text-zinc-200"
        >
          <X size={14} />
        </button>
      </div>
      {loading || !summary ? (
        <div className="flex items-center gap-2 py-2 text-zinc-500">
          <Loader2 size={14} className="animate-spin" /> ИИ читает переписку…
        </div>
      ) : (
        <div className="space-y-2 text-zinc-800 dark:text-zinc-200">
          {summary.topic && <div className="font-medium">{summary.topic}</div>}
          {summary.summary_markdown && (
            <div className="leading-[1.55] [&_ol]:ml-4 [&_ol]:list-decimal [&_p]:my-1 [&_strong]:font-semibold [&_ul]:ml-4 [&_ul]:list-disc">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary.summary_markdown}</ReactMarkdown>
            </div>
          )}
          {summary.asks.length > 0 && (
            <div>
              <div className="text-[12px] font-medium text-zinc-500">Что просят</div>
              <ul className="ml-4 list-disc">
                {summary.asks.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.next_step && (
            <div>
              <span className="text-[12px] font-medium text-zinc-500">Следующий шаг: </span>
              {summary.next_step}
            </div>
          )}
          <div className="text-[11px] text-zinc-400">Сводку составил ИИ — проверяйте важные детали в самих сообщениях.</div>
        </div>
      )}
    </div>
  );
}
