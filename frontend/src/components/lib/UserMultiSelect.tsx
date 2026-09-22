import { useMemo, useRef, useState, useEffect } from "react";
import clsx from "clsx";
import { X, Search, Plus, Check } from "lucide-react";
import { Avatar } from "@/components/ui";
import type { UserBrief } from "@/types";

export interface UserOption extends UserBrief {}

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
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedIds = useMemo(() => new Set(value.map((u) => u.id)), [value]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter(
      (o) =>
        (o.name || "").toLowerCase().includes(s) ||
        (o.email || "").toLowerCase().includes(s),
    );
  }, [options, q]);

  const toggle = (u: UserOption) => {
    if (selectedIds.has(u.id)) onChange(value.filter((v) => v.id !== u.id));
    else onChange([...value, u]);
  };
  const remove = (u: UserOption) => {
    onChange(value.filter((v) => v.id !== u.id));
  };

  const avatarSize = size === "sm" ? 18 : 22;

  return (
    <div ref={rootRef} className={clsx("relative", className)}>
      <div
        className={clsx(
          "flex min-h-[36px] w-full flex-wrap items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-2 py-1.5 text-sm",
          "focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/15",
          "dark:border-zinc-700/60 dark:bg-[#17171F]",
          disabled && "cursor-not-allowed opacity-70",
        )}
      >
        {value.length === 0 && (
          <span className="px-1 text-neutral-400">{emptyText}</span>
        )}
        {value.map((u) => (
          <span
            key={u.id}
            className="inline-flex items-center gap-1 rounded-full bg-neutral-100 py-0.5 pl-0.5 pr-2 text-xs dark:bg-neutral-800"
          >
            <Avatar name={u.name} url={u.avatar_url} size={avatarSize} />
            <span className="max-w-[120px] truncate">{u.name}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(u)}
                className="text-neutral-400 hover:text-rose-500"
                aria-label={`Удалить ${u.name}`}
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <button
            type="button"
            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            onClick={() => setOpen((v) => !v)}
            aria-label="Добавить пользователя"
            title={placeholder}
          >
            <Plus size={13} />
          </button>
        )}
      </div>

      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-[#1c1c25]">
          <div className="relative border-b border-zinc-100 p-2 dark:border-zinc-800">
            <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск сотрудника…"
              className="w-full rounded-md bg-neutral-50 px-2 py-1 pl-6 text-sm outline-none dark:bg-neutral-800"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-neutral-500">Никого не найдено</div>
            )}
            {filtered.map((u) => {
              const selected = selectedIds.has(u.id);
              return (
                <button
                  type="button"
                  key={u.id}
                  onClick={() => toggle(u)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                >
                  <Avatar name={u.name} url={u.avatar_url} size={22} />
                  <span className="flex-1 truncate">
                    <span className="block truncate">{u.name}</span>
                    {u.email && (
                      <span className="block truncate text-[11px] text-neutral-500">{u.email}</span>
                    )}
                  </span>
                  {selected && <Check size={14} className="text-brand-600" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default UserMultiSelect;
