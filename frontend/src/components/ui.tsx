import { ReactNode, useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import { X, Circle, Loader2, CheckCircle2, XCircle, Eye, ArrowUp, ArrowDown, Flame, Minus } from "lucide-react";
import type { TaskPriority, TaskStatus } from "@/types";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/types";
import { API_URL } from "@/api/client";

export function resolveMediaUrl(url?: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("blob:")) return url;
  return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function Avatar({
  name,
  size = 28,
  url,
}: {
  name?: string;
  size?: number;
  url?: string | null;
}) {
  const src = resolveMediaUrl(url);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt={name || ""}
        title={name}
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className="inline-block shrink-0 rounded-full object-cover"
      />
    );
  }
  const initials =
    (name || "?")
      .split(" ")
      .map((s) => s[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  const palette = [
    "bg-indigo-500",
    "bg-emerald-500",
    "bg-rose-500",
    "bg-amber-500",
    "bg-sky-500",
    "bg-fuchsia-500",
    "bg-teal-500",
    "bg-violet-500",
    "bg-orange-500",
    "bg-cyan-500",
  ];
  const idx = hashString(name || "?") % palette.length;
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        palette[idx],
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      title={name}
    >
      {initials}
    </span>
  );
}

const STATUS_STYLE: Record<TaskStatus, { chip: string; dot: string; icon: ReactNode }> = {
  new: {
    chip: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
    dot: "bg-neutral-400",
    icon: <Circle size={10} className="fill-current opacity-70" />,
  },
  in_progress: {
    chip: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    dot: "bg-sky-500",
    icon: <Loader2 size={11} />,
  },
  review: {
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    dot: "bg-amber-500",
    icon: <Eye size={11} />,
  },
  done: {
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    dot: "bg-emerald-500",
    icon: <CheckCircle2 size={11} />,
  },
  cancelled: {
    chip: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
    dot: "bg-rose-500",
    icon: <XCircle size={11} />,
  },
};

export function StatusChip({ status, showIcon = false }: { status: TaskStatus; showIcon?: boolean }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={clsx("chip", s.chip)}>
      {showIcon ? s.icon : <span className={clsx("h-1.5 w-1.5 rounded-full", s.dot)} />}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function StatusDot({ status, size = 10 }: { status: TaskStatus; size?: number }) {
  return (
    <span
      className={clsx("inline-block rounded-full", STATUS_STYLE[status].dot)}
      style={{ width: size, height: size }}
    />
  );
}

const PRIORITY_STYLE: Record<TaskPriority, { chip: string; icon: ReactNode }> = {
  low: {
    chip: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
    icon: <ArrowDown size={11} />,
  },
  medium: {
    chip: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    icon: <Minus size={11} />,
  },
  high: {
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    icon: <ArrowUp size={11} />,
  },
  critical: {
    chip: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
    icon: <Flame size={11} />,
  },
};

export function PriorityChip({ priority }: { priority: TaskPriority }) {
  const p = PRIORITY_STYLE[priority];
  return (
    <span className={clsx("chip", p.chip)}>
      {p.icon}
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const contentId = useId();

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute("aria-hidden"));

    const first = focusables()[0];
    (first ?? dialogRef.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !dialogRef.current?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const width = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Диалог"}
        aria-describedby={contentId}
        tabIndex={-1}
        className={clsx("card w-full animate-slide-up p-0 outline-none", width)}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3.5 dark:border-neutral-800">
            <h3 id={titleId} className="text-base font-semibold">{title}</h3>
            <button className="btn-ghost !p-1.5" onClick={onClose} aria-label="Закрыть">
              <X size={18} />
            </button>
          </div>
        )}
        <div id={contentId} className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-3 text-neutral-400 dark:text-neutral-500">{icon}</div>}
      <div className="text-base font-medium">{title}</div>
      {description && <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function FieldError({ msg }: { msg?: string | null }) {
  if (!msg) return null;
  return <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">{msg}</div>;
}

export function FormError({ msg }: { msg?: string | null }) {
  if (!msg) return null;
  return (
    <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
      {msg}
    </div>
  );
}

export function Loader() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-200 border-t-brand-600 dark:border-neutral-800 dark:border-t-brand-500" />
    </div>
  );
}
