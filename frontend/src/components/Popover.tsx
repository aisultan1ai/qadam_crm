/**
 * Лёгкий поповер через portal: не обрезается overflow-hidden контейнерами (строки списка, карточки).
 * Позиционируется под якорем, прижимается к краям окна, закрывается по клику снаружи, Esc и скроллу.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

export function Popover({
  anchorRef,
  open,
  onClose,
  children,
  width = 220,
  align = "start",
}: {
  anchorRef: RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  align?: "start" | "end";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const h = panelRef.current?.offsetHeight ?? 0;
    let left = align === "end" ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    // Не помещается снизу — открываем вверх.
    let top = r.bottom + 4;
    if (h && top + h > window.innerHeight - 8 && r.top - h - 4 > 8) top = r.top - h - 4;
    setPos({ top, left });
  }, [open, anchorRef, width, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
      className="card fixed z-[70] animate-slide-up p-1 shadow-pop"
    >
      {children}
    </div>,
    document.body,
  );
}

/** Пункт меню внутри Popover. */
export function PopoverItem({
  onClick,
  active,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors " +
        (active
          ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"
          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-[#23262D]")
      }
    >
      {children}
    </button>
  );
}
