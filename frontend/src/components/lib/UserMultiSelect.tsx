import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { X, Search, Plus, Check } from "lucide-react";
import { Avatar } from "@/components/ui";
import { Popover } from "@/components/Popover";
import type { UserBrief } from "@/types";

export interface UserOption extends UserBrief {}

/**
 * Выбор нескольких сотрудников. Список открывается в portal (не обрезается модалкой и сам
 * переворачивается вверх, если внизу нет места), навигация: ↑/↓, Enter — выбрать, Esc — закрыть.
 */
export function UserMultiSelect({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "Добавить…",
  emptyText = "Никого не выбрано",
  className,
  size = "md",
}: {
  value: UserOption[];
  options: UserOption[];
  onChange: (users: UserOption[]) => void;
  disabled?: boolean;
  placeholder?: string;
  emptyText?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const fieldRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(280);

  const selectedIds = useMemo(() => new Set(value.map((u) => u.id)), [value]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) => (o.name || "").toLowerCase().includes(s) || (o.email || "").toLowerCase().includes(s));
  }, [options, q]);

  useEffect(() => setActive(0), [q, open]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const openList = () => {
    setWidth(Math.max(240, fieldRef.current?.offsetWidth ?? 280));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setQ("");
  };
  const toggle = (u: UserOption) => {
    if (selectedIds.has(u.id)) onChange(value.filter((v) => v.id !== u.id));
    else onChange([...value, u]);
  };
  const remove = (u: UserOption) => onChange(value.filter((v) => v.id !== u.id));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const u = filtered[active];
      if (u) toggle(u);
    }
  };

  const avatarSize = size === "sm" ? 18 : 22;
  const listId = useMemo(() => `ums-${Math.random().toString(36).slice(2, 8)}`, []);

  return (
    <div className={clsx("relative", className)}>
      <div
        ref={fieldRef}
        className={clsx(
          "flex min-h-[34px] w-full flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[13px]",
          open && "border-brand-500 ring-[3px] ring-brand-500/15",
          "dark:border-zinc-700 dark:bg-[#1B1E23]",
          disabled && "cursor-not-allowed opacity-70",
        )}
      >
        {value.length === 0 && <span className="px-1 text-zinc-400">{emptyText}</span>}
        {value.map((u) => (
          <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pl-0.5 pr-2 text-xs dark:bg-white/5">
            <Avatar name={u.name} url={u.avatar_url} size={avatarSize} />
            <span className="max-w-[120px] truncate">{u.name}</span>
            {!disabled && (
              <button type="button" onClick={() => remove(u)} className="text-zinc-400 hover:text-rose-500" aria-label={`Убрать ${u.name}`}>
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <button
            type="button"
            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5"
            onClick={() => (open ? close() : openList())}
            aria-label="Добавить сотрудника"
            aria-haspopup="listbox"
            aria-expanded={open}
            title={placeholder}
          >
            <Plus size={13} />
          </button>
        )}
      </div>

      <Popover anchorRef={fieldRef} open={open && !disabled} onClose={close} width={width}>
        <div className="relative mb-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Поиск сотрудника…"
            aria-label="Поиск сотрудника"
            aria-controls={listId}
            aria-activedescendant={filtered[active] ? `${listId}-${filtered[active].id}` : undefined}
            className="h-8 w-full rounded-md border border-zinc-200 bg-transparent pl-7 pr-2 text-[13px] outline-none focus:border-brand-400 dark:border-zinc-700"
          />
        </div>
        <div ref={listRef} id={listId} role="listbox" aria-multiselectable="true" className="max-h-56 overflow-y-auto">
          {filtered.length === 0 && <div className="px-2 py-2 text-xs text-zinc-500">Никого не найдено</div>}
          {filtered.map((u, idx) => {
            const selected = selectedIds.has(u.id);
            return (
              <button
                type="button"
                key={u.id}
                id={`${listId}-${u.id}`}
                role="option"
                aria-selected={selected}
                data-idx={idx}
                onMouseMove={() => setActive(idx)}
                onClick={() => toggle(u)}
                className={clsx(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]",
                  idx === active ? "bg-zinc-100 dark:bg-white/5" : "",
                )}
              >
                <Avatar name={u.name} url={u.avatar_url} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{u.name}</span>
                  {u.email && <span className="block truncate text-[11px] text-zinc-500">{u.email}</span>}
                </span>
                {selected && <Check size={14} className="text-brand-600 dark:text-brand-400" />}
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}

export default UserMultiSelect;
