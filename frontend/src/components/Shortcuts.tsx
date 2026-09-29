/**
 * Горячие клавиши (как в ClickUp): ⌘K / «/» — палитра, T — новая задача, ? — справка,
 * G затем H/I/T/P/C — переходы. Не срабатывают, пока фокус в поле ввода.
 */
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { Modal } from "./ui";
import { modKey } from "@/lib/platform";

const GOTO: Record<string, string> = { h: "/", i: "/notifications", t: "/tasks", p: "/projects", c: "/calendar" };

function isTyping(el: EventTarget | null) {
  const n = el as HTMLElement | null;
  if (!n) return false;
  return n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "SELECT" || n.isContentEditable;
}

export function useGlobalShortcuts({
  openPalette,
  openHelp,
  canCreateTask,
}: {
  openPalette: () => void;
  openHelp: () => void;
  canCreateTask: boolean;
}) {
  const nav = useNavigate();
  const gPressedAt = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return;
      // Открыт диалог/панель — не мешаем его собственным клавишам.
      if (document.querySelector('[aria-modal="true"]')) return;

      const key = e.key.toLowerCase();
      if (gPressedAt.current && Date.now() - gPressedAt.current < 1200) {
        gPressedAt.current = 0;
        const to = GOTO[key];
        if (to) {
          e.preventDefault();
          nav(to);
        }
        return;
      }
      if (key === "g") {
        gPressedAt.current = Date.now();
      } else if (e.key === "/") {
        e.preventDefault();
        openPalette();
      } else if (e.key === "?") {
        e.preventDefault();
        openHelp();
      } else if (key === "t" && canCreateTask) {
        e.preventDefault();
        nav("/tasks?new=1");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, openPalette, openHelp, canCreateTask]);
}

const ROWS: { keys: string[]; label: string }[] = [
  { keys: [modKey, "K"], label: "Палитра команд и поиск" },
  { keys: ["/"], label: "Палитра команд и поиск" },
  { keys: ["T"], label: "Новая задача" },
  { keys: ["G", "H"], label: "Главная" },
  { keys: ["G", "I"], label: "Входящие" },
  { keys: ["G", "T"], label: "Задачи" },
  { keys: ["G", "P"], label: "Проекты" },
  { keys: ["G", "C"], label: "Календарь" },
  { keys: ["Esc"], label: "Закрыть панель задачи или диалог" },
  { keys: ["?"], label: "Эта справка" },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Горячие клавиши" size="sm">
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {ROWS.map((r) => (
          <li key={r.keys.join("+") + r.label} className="flex items-center justify-between py-2 text-sm">
            <span className="text-zinc-700 dark:text-zinc-300">{r.label}</span>
            <span className="flex items-center gap-1">
              {r.keys.map((k, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && r.keys[0] === "G" && <span className="text-[11px] text-zinc-400">затем</span>}
                  <span className="kbd">{k}</span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-zinc-500">Клавиши не срабатывают, пока вы печатаете в поле ввода.</p>
    </Modal>
  );
}
