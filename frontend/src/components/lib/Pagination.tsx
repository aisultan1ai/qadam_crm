import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface PaginationProps {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
  onPerPageChange?: (perPage: number) => void;
  perPageOptions?: number[];
  className?: string;
  compact?: boolean;
}

const DEFAULT_OPTIONS = [25, 50, 100];

export function Pagination({
  page,
  perPage,
  total,
  onPageChange,
  onPerPageChange,
  perPageOptions = DEFAULT_OPTIONS,
  className,
  compact = false,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  const prev = () => onPageChange(Math.max(1, page - 1));
  const next = () => onPageChange(Math.min(totalPages, page + 1));

  if (total === 0) return null;

  return (
    <div
      className={clsx(
        "flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-600 dark:text-neutral-400",
        className,
      )}
    >
      <div className="tabular-nums">
        {compact ? (
          <>
            {from}–{to} из {total}
          </>
        ) : (
          <>
            Показано <span className="font-medium text-neutral-900 dark:text-neutral-100">{from}–{to}</span> из{" "}
            <span className="font-medium text-neutral-900 dark:text-neutral-100">{total}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        {onPerPageChange && (
          <label className="flex items-center gap-1.5 text-xs">
            <span className="hidden sm:inline">На странице:</span>
            <select
              className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              value={perPage}
              onChange={(e) => onPerPageChange(Number(e.target.value))}
            >
              {perPageOptions.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-ghost !p-1.5 disabled:opacity-30"
            onClick={prev}
            disabled={page <= 1}
            aria-label="Предыдущая страница"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[70px] text-center tabular-nums text-xs">
            стр. {page} / {totalPages}
          </span>
          <button
            type="button"
            className="btn-ghost !p-1.5 disabled:opacity-30"
            onClick={next}
            disabled={page >= totalPages}
            aria-label="Следующая страница"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default Pagination;
