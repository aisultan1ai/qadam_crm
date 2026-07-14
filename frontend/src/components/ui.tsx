import { ReactNode, useEffect } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import type { TaskPriority, TaskStatus } from "@/types";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/types";

export function Avatar({ name, size = 28 }: { name?: string; size?: number }) {
  const initials =
    (name || "?")
      .split(" ")
      .map((s) => s[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  const palette = ["bg-indigo-500", "bg-emerald-500", "bg-rose-500", "bg-amber-500", "bg-sky-500", "bg-fuchsia-500"];
  const idx = (name || "?").charCodeAt(0) % palette.length;
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

export function StatusChip({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, string> = {
    new: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
    in_progress: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    review: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    cancelled: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  };
  return <span className={clsx("chip", map[status])}>{STATUS_LABEL[status]}</span>;
}

export function PriorityChip({ priority }: { priority: TaskPriority }) {
  const map: Record<TaskPriority, string> = {
    low: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
    medium: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    high: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    critical: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  };
  return <span className={clsx("chip", map[priority])}>{PRIORITY_LABEL[priority]}</span>;
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const width = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in" onClick={onClose}>
      <div
        className={clsx("card w-full animate-slide-up p-0", width)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3.5 dark:border-neutral-800">
          <h3 className="text-base font-semibold">{title}</h3>
          <button className="btn-ghost !p-1.5" onClick={onClose} aria-label="close">
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ title, description, icon }: { title: string; description?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-3 text-neutral-400">{icon}</div>}
      <div className="text-base font-medium">{title}</div>
      {description && <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{description}</div>}
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
