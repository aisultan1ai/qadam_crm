import clsx from "clsx";
import { Loader2, Check, AlertTriangle } from "lucide-react";

export type SaveState = "idle" | "saving" | "saved" | "error";

export function SaveIndicator({
  state,
  errorMsg,
  onRetry,
  className,
}: {
  state: SaveState;
  errorMsg?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  if (state === "idle") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "inline-flex items-center gap-1.5 text-xs font-medium transition-opacity",
        state === "saved" && "text-emerald-600 dark:text-emerald-400",
        state === "saving" && "text-neutral-500 dark:text-neutral-400",
        state === "error" && "text-rose-600 dark:text-rose-400",
        className,
      )}
    >
      {state === "saving" && (
        <>
          <Loader2 size={12} className="animate-spin" />
          <span>Сохранение…</span>
        </>
      )}
      {state === "saved" && (
        <>
          <Check size={13} />
          <span>Сохранено</span>
        </>
      )}
      {state === "error" && (
        <>
          <AlertTriangle size={12} />
          <span>{errorMsg || "Ошибка сохранения"}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="ml-1 underline underline-offset-2 hover:no-underline"
            >
              Повторить
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default SaveIndicator;
