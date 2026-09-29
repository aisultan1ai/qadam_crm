/**
 * Задача в боковой панели поверх списка (как в ClickUp): контекст списка не теряется,
 * Esc / клик по фону закрывает, «Открыть полностью» ведёт на /tasks/:id.
 */
import { Suspense, lazy, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Maximize2, X } from "lucide-react";

const TaskDetail = lazy(() => import("@/pages/TaskDetail"));

export function TaskDrawer({ taskId, onClose }: { taskId: number; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc внутри поповера/поля ввода обрабатывается там; закрываем панель только «свободный» Esc.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        el.blur();
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Задача">
      <div className="absolute inset-0 bg-zinc-950/25 animate-fade-in dark:bg-black/50" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-[820px] flex-col border-l border-zinc-200 bg-[#F6F7F9] shadow-pop outline-none animate-[qd-drawer-in_.22s_cubic-bezier(.2,.8,.2,1)] dark:border-zinc-800 dark:bg-[#0D0F13]"
      >
        <div className="flex h-12 shrink-0 items-center justify-end gap-1 border-b border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-[#14171C]">
          <Link
            to={`/tasks/${taskId}`}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-[#1B1F26] dark:hover:text-white"
          >
            <Maximize2 size={14} /> Открыть полностью
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть панель"
            title="Закрыть (Esc)"
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-[#1B1F26] dark:hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          <Suspense fallback={<div className="min-h-[200px]" />}>
            <TaskDetail key={taskId} taskId={taskId} embedded />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
