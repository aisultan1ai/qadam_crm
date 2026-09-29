/**
 * Палитра команд (⌘K / Ctrl+K / «/»): быстрые действия, переходы по разделам, избранное и поиск
 * по задачам, проектам и комментариям. Навигация стрелками, Enter — выполнить, Esc — закрыть.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  ArrowRight, Bell, BookOpen, Calendar, CheckSquare, CircleDot, Coins, CornerDownLeft, FolderKanban, Keyboard,
  LayoutDashboard, Mail, MessageSquare, Moon, Plus, Search, Settings, Star,
} from "lucide-react";

import { api } from "@/api/client";
import { useAuth } from "@/store/auth";
import { useTheme } from "@/store/theme";
import { useFavorites } from "@/hooks/useFavorites";

type Hit = {
  tasks: { id: number; title: string; project_id?: number | null }[];
  projects: { id: number; name: string }[];
  users: { id: number; name: string; email: string }[];
  comments: { id: number; task_id: number; body: string }[];
};

type Item = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: typeof Search;
  keywords?: string;
  shortcut?: string;
  run: () => void;
};

export default function GlobalSearch({
  open,
  onClose,
  onShowShortcuts,
}: {
  open: boolean;
  onClose: () => void;
  onShowShortcuts?: () => void;
}) {
  const [q, setQ] = useState("");
  const [hit, setHit] = useState<Hit | null>(null);
  const [active, setActive] = useState(0);
  const nav = useNavigate();
  const { can } = useAuth();
  const { toggle: toggleTheme } = useTheme();
  const { favorites } = useFavorites();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      setHit(null);
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim()) {
      setHit(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get<Hit>("/api/search", { params: { q } });
        setHit(data);
      } catch {
        setHit(null);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const go = (path: string) => () => {
      onClose();
      nav(path);
    };
    const actions: (Item & { show: boolean })[] = [
      { id: "new-task", group: "Действия", label: "Создать задачу", icon: Plus, shortcut: "T", keywords: "новая задача task", run: go("/tasks?new=1"), show: can("tasks.create") },
      { id: "new-project", group: "Действия", label: "Создать проект", icon: Plus, keywords: "новый проект project", run: go("/projects?new=1"), show: can("projects.create") },
      { id: "new-deal", group: "Действия", label: "Создать сделку", icon: Plus, keywords: "новая сделка deal", run: go("/deals?new=1"), show: can("deals.create") },
      {
        id: "theme", group: "Действия", label: "Сменить тему", icon: Moon, keywords: "тёмная светлая dark light", show: true,
        run: () => {
          toggleTheme();
          onClose();
        },
      },
      {
        id: "shortcuts", group: "Действия", label: "Горячие клавиши", icon: Keyboard, shortcut: "?", keywords: "клавиатура shortcuts", show: !!onShowShortcuts,
        run: () => {
          onClose();
          onShowShortcuts?.();
        },
      },
    ];

    const pages: (Item & { show: boolean })[] = [
      { id: "p-home", group: "Перейти", label: "Главная", icon: LayoutDashboard, shortcut: "G H", run: go("/"), show: true },
      { id: "p-inbox", group: "Перейти", label: "Входящие", icon: Bell, shortcut: "G I", keywords: "уведомления", run: go("/notifications"), show: true },
      { id: "p-tasks", group: "Перейти", label: "Задачи", icon: CheckSquare, shortcut: "G T", run: go("/tasks"), show: can(["tasks.view_all", "tasks.view_own"]) },
      { id: "p-projects", group: "Перейти", label: "Проекты", icon: FolderKanban, shortcut: "G P", run: go("/projects"), show: can("projects.view") },
      { id: "p-calendar", group: "Перейти", label: "Календарь", icon: Calendar, shortcut: "G C", run: go("/calendar"), show: can("calendar.use") },
      { id: "p-messenger", group: "Перейти", label: "Мессенджер", icon: MessageSquare, run: go("/messenger"), show: can("messenger.use") },
      { id: "p-mail", group: "Перейти", label: "Почта", icon: Mail, run: go("/mail"), show: can("mail.use") },
      { id: "p-deals", group: "Перейти", label: "Сделки", icon: Coins, run: go("/deals"), show: can("deals.view") },
      { id: "p-wiki", group: "Перейти", label: "База знаний", icon: BookOpen, keywords: "wiki", run: go("/wiki"), show: can("wiki.use") },
      { id: "p-settings", group: "Перейти", label: "Настройки", icon: Settings, run: go("/settings"), show: can(["roles.manage", "settings.dictionaries", "settings.system"]) },
    ];

    const favs: Item[] = favorites.map((f) => ({
      id: `fav-${f.entity}-${f.entity_id}`,
      group: "Избранное",
      label: f.title,
      icon: Star,
      run: go(f.url),
    }));

    const needle = q.trim().toLowerCase();
    const match = (i: Item) => !needle || `${i.label} ${i.keywords ?? ""}`.toLowerCase().includes(needle);
    const base = [...actions.filter((a) => a.show), ...pages.filter((p) => p.show), ...favs].filter(match);

    const found: Item[] = hit
      ? [
          ...hit.tasks.map((t) => ({ id: `t-${t.id}`, group: "Задачи", label: t.title, icon: CircleDot, run: go(`/tasks/${t.id}`) })),
          ...hit.projects.map((p) => ({ id: `pr-${p.id}`, group: "Проекты", label: p.name, icon: FolderKanban, run: go(`/projects/${p.id}`) })),
          ...hit.comments.map((c) => ({
            id: `c-${c.id}`,
            group: "Комментарии",
            label: c.body.length > 90 ? `${c.body.slice(0, 90)}…` : c.body,
            icon: MessageSquare,
            run: go(`/tasks/${c.task_id}`),
          })),
        ]
      : [];
    // При поиске сначала найденное, затем подходящие команды.
    return needle ? [...found, ...base] : base;
  }, [q, hit, favorites, can, nav, onClose, toggleTheme, onShowShortcuts]);

  useEffect(() => setActive(0), [q, hit]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup = "";
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Палитра команд">
      <div className="absolute inset-0 bg-zinc-950/40 animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-pop animate-slide-up dark:border-zinc-700 dark:bg-[#14171C]">
        <div className="flex items-center gap-2.5 border-b border-zinc-200 px-4 dark:border-zinc-800">
          <Search size={17} className="shrink-0 text-zinc-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Поиск или команда…"
            aria-label="Поиск или команда"
            aria-activedescendant={items[active] ? `cmd-${items[active].id}` : undefined}
            className="h-12 w-full bg-transparent text-[15px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
          />
          <span className="kbd shrink-0">Esc</span>
        </div>
        <div ref={listRef} role="listbox" className="max-h-[55vh] overflow-y-auto p-1.5">
          {items.length === 0 && (
            <div className="py-10 text-center text-sm text-zinc-500">{q.trim() && !hit ? "Ищем…" : "Ничего не найдено"}</div>
          )}
          {items.map((it, idx) => {
            const showGroup = it.group !== lastGroup;
            lastGroup = it.group;
            const Icon = it.icon;
            return (
              <div key={it.id}>
                {showGroup && <div className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-400">{it.group}</div>}
                <button
                  id={`cmd-${it.id}`}
                  type="button"
                  role="option"
                  aria-selected={idx === active}
                  data-idx={idx}
                  onMouseMove={() => setActive(idx)}
                  onClick={it.run}
                  className={clsx(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm",
                    idx === active ? "bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-white" : "text-zinc-700 dark:text-zinc-200",
                  )}
                >
                  <Icon size={16} className={clsx("shrink-0", it.group === "Избранное" ? "text-amber-500" : "text-zinc-400")} />
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.shortcut && (
                    <span className="flex shrink-0 gap-1">
                      {it.shortcut.split(" ").map((k) => (
                        <span key={k} className="kbd">
                          {k}
                        </span>
                      ))}
                    </span>
                  )}
                  {idx === active && !it.shortcut && <ArrowRight size={14} className="shrink-0 text-zinc-400" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-400 dark:border-zinc-800">
          <span className="inline-flex items-center gap-1">
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> выбрать
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="kbd">
              <CornerDownLeft size={10} />
            </span>{" "}
            открыть
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
