/**
 * Рабочая область «список + разговор» для Мессенджера, Открытых линий и Почты.
 * Одна схема на все три раздела: на всю высоту, без внешней рамки, слева список с поиском и тихими
 * вкладками, справа разговор с компактной шапкой. Название раздела уже есть в панели модуля каркаса.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

/** Сетка рабочей области. `detail` — показывать ли на телефоне вторую колонку вместо списка. */
const LIST_MIN = 260;
const LIST_MAX = 560;
const LIST_DEFAULT = 320;

/** Ширина списка, которую пользователь подобрал перетаскиванием границы (своя для каждого раздела). */
function useListWidth(storageKey?: string) {
  const key = storageKey ? `workspace:list-width:${storageKey}` : null;
  const [width, setWidth] = useState(() => {
    if (!key) return LIST_DEFAULT;
    try {
      const v = Number(window.localStorage.getItem(key));
      return v >= LIST_MIN && v <= LIST_MAX ? v : LIST_DEFAULT;
    } catch {
      return LIST_DEFAULT;
    }
  });
  useEffect(() => {
    if (!key) return;
    try {
      window.localStorage.setItem(key, String(width));
    } catch {
      // localStorage недоступен — ширина просто не запомнится.
    }
  }, [key, width]);
  return [width, setWidth] as const;
}

export function Workspace({
  list,
  children,
  aside,
  showDetailOnMobile,
  storageKey,
}: {
  list: ReactNode;
  children: ReactNode;
  /** Необязательная третья колонка (карточка клиента). */
  aside?: ReactNode;
  showDetailOnMobile: boolean;
  /** Ключ для запоминания ширины списка (например, "messenger"). */
  storageKey?: string;
}) {
  const [width, setWidth] = useListWidth(storageKey);
  const listRef = useRef<HTMLDivElement>(null);
  const clamp = (v: number) => Math.min(LIST_MAX, Math.max(LIST_MIN, v));

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const left = listRef.current?.getBoundingClientRect().left ?? 0;
      const move = (ev: PointerEvent) => setWidth(clamp(ev.clientX - left));
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [setWidth],
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-white dark:bg-[#1B1E23]">
      <div
        ref={listRef}
        style={{ ["--list-w" as string]: `${width}px` }}
        className={clsx(
          "relative min-h-0 w-full shrink-0 flex-col border-zinc-200 md:flex md:w-[var(--list-w)] md:border-r dark:border-zinc-800",
          showDetailOnMobile ? "hidden" : "flex",
        )}
      >
        {list}
        {/* Граница-ручка: тянуть мышью, стрелками — с клавиатуры, двойной клик — исходная ширина. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Ширина списка"
          aria-valuemin={LIST_MIN}
          aria-valuemax={LIST_MAX}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onDoubleClick={() => setWidth(LIST_DEFAULT)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setWidth((w) => clamp(w - 16));
            if (e.key === "ArrowRight") setWidth((w) => clamp(w + 16));
          }}
          className="absolute -right-1 top-0 z-10 hidden h-full w-2 cursor-col-resize outline-none transition-colors hover:bg-brand-500/20 focus-visible:bg-brand-500/30 md:block"
        />
      </div>
      <div className={clsx("min-h-0 min-w-0 flex-1 flex-col bg-[#F7F8FA] md:flex dark:bg-[#16181C]", showDetailOnMobile ? "flex" : "hidden")}>
        {children}
      </div>
      {aside}
    </div>
  );
}

/** Верх списка: поиск + действие (одна строка), под ним — вкладки/фильтры. */
export function ListHeader({ search, action, children }: { search: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center gap-1.5 px-3 pt-3 [&_input]:h-8">
        <div className="min-w-0 flex-1">{search}</div>
        {action}
      </div>
      <div className="px-3 pb-0 pt-2 empty:hidden">{children}</div>
      {!children && <div className="h-3" />}
    </div>
  );
}

/** Тихие текстовые вкладки (Все / Непрочитанные / Архив). */
export function ListTabs<K extends string>({
  items,
  value,
  onChange,
  label,
  right,
}: {
  items: { key: K; label: string; count?: number }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4">
      <div role="tablist" aria-label={label} className="flex items-center gap-4">
        {items.map((i) => {
          const active = i.key === value;
          return (
            <button
              key={i.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(i.key)}
              className={clsx(
                "-mb-px flex items-center gap-1 border-b-2 pb-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                active
                  ? "border-brand-600 font-semibold text-zinc-900 dark:border-brand-400 dark:text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
              )}
            >
              {i.label}
              {!!i.count && <span className="text-[11px] font-semibold tabular-nums text-brand-600 dark:text-brand-400">{i.count}</span>}
            </button>
          );
        })}
      </div>
      {right && <div className="-mt-2 ml-auto">{right}</div>}
    </div>
  );
}

/** Строка списка: аватар, имя + время, превью + счётчик, необязательные метки снизу. */
export function ListRow({
  active,
  unread,
  onClick,
  avatar,
  title,
  time,
  preview,
  count,
  meta,
}: {
  active: boolean;
  unread?: boolean;
  onClick: () => void;
  avatar: ReactNode;
  title: ReactNode;
  time?: ReactNode;
  preview?: ReactNode;
  count?: number;
  meta?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={clsx(
        "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500",
        active ? "bg-brand-500/[0.09] dark:bg-brand-400/[0.12]" : "hover:bg-zinc-50 dark:hover:bg-white/[0.03]",
      )}
    >
      <span className="shrink-0">{avatar}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={clsx("truncate text-[13.5px]", unread ? "font-semibold text-zinc-950 dark:text-white" : "font-medium text-zinc-800 dark:text-zinc-200")}>
            {title}
          </span>
          {time && <span className={clsx("shrink-0 text-[11px] tabular-nums", unread ? "font-semibold text-brand-600 dark:text-brand-400" : "text-zinc-400")}>{time}</span>}
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className={clsx("min-w-0 flex-1 truncate text-[12.5px]", unread ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-500")}>{preview}</span>
          {!!count && (
            <span className="min-w-[18px] shrink-0 rounded-full bg-brand-600 px-1.5 text-center text-[10.5px] font-semibold leading-[18px] text-white">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </span>
        {meta && <span className="mt-1 flex flex-wrap items-center gap-1">{meta}</span>}
      </span>
    </button>
  );
}

/** Маленькая метка в строке списка (Лид #12, закрыт). */
export function RowTag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "blue" }) {
  return (
    <span
      className={clsx(
        "rounded px-1.5 text-[10.5px] font-medium leading-[18px]",
        tone === "green" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "blue" && "bg-sky-500/10 text-sky-700 dark:text-sky-300",
        tone === "neutral" && "bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400",
      )}
    >
      {children}
    </span>
  );
}

/** Шапка разговора: слева кто/что, справа действия. */
export function PaneHeader({ back, children, actions }: { back?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-[#1B1E23]">
      {back}
      <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
    </div>
  );
}

/** Иконка-кнопка в шапке разговора / списка. */
export function IconAction({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={clsx(
        "grid h-8 w-8 place-items-center rounded-lg transition-colors disabled:opacity-40",
        active
          ? "bg-brand-500/10 text-brand-700 dark:text-brand-300"
          : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white",
      )}
    >
      <Icon size={16} />
    </button>
  );
}

/** Одно пустое состояние в правой части (ничего не выбрано / пусто). */
export function PaneEmpty({ icon: Icon, title, hint, action }: { icon: LucideIcon; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-xs text-center">
        <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-white text-zinc-400 shadow-[0_0_0_1px_rgb(0_0_0/0.06)] dark:bg-[#1B1E23] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.06)]">
          <Icon size={20} />
        </span>
        <div className="text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">{title}</div>
        {hint && <p className="mt-1 text-[13px] leading-snug text-zinc-500">{hint}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

/** Пустой список слева. */
export function ListEmpty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-[13px] text-zinc-400">{children}</div>;
}

/** Разделитель дат в ленте сообщений. */
export function DayDivider({ label }: { label: string }) {
  return (
    <div className="my-3 flex items-center gap-3 text-[11px] font-medium text-zinc-400">
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      {label}
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Сегодня";
  if (d.toDateString() === y.toDateString()) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

/** Время для строк списка: сегодня — часы, на неделе — день, иначе — дата. */
export function shortWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const diffDays = (now.getTime() - d.getTime()) / 86_400_000;
  if (diffDays < 6) return d.toLocaleDateString("ru-RU", { weekday: "short" });
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

/** Поле ввода сообщения: растущий textarea, слева инструменты, справа отправка. */
export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  sending,
  tools,
  above,
  textareaRef,
  onPaste,
  canSend,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled?: boolean;
  sending?: boolean;
  tools?: ReactNode;
  above?: ReactNode;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  canSend?: boolean;
}) {
  const ok = (canSend ?? !!value.trim()) && !disabled && !sending;
  return (
    <div className="shrink-0 px-4 pb-4 pt-2">
      {above}
      <div className="flex items-end gap-1 rounded-xl border border-zinc-200 bg-white p-1.5 transition-shadow focus-within:border-brand-400 focus-within:ring-[3px] focus-within:ring-brand-500/15 dark:border-zinc-700 dark:bg-[#1B1E23]">
        {tools && <div className="flex shrink-0 items-center">{tools}</div>}
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          aria-label="Сообщение"
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            const ta = e.currentTarget;
            ta.style.height = "auto";
            ta.style.height = Math.min(180, ta.scrollHeight) + "px";
          }}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (ok) onSubmit();
            }
          }}
          className="max-h-[180px] min-h-[34px] flex-1 resize-none border-0 bg-transparent px-2 py-[7px] text-[13.5px] text-zinc-900 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed dark:text-zinc-100"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={!ok}
          aria-label="Отправить"
          title="Отправить (Enter)"
          className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-white/10 dark:disabled:text-zinc-500"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <div className="mt-1 px-1 text-[11px] text-zinc-400">Enter — отправить, Shift+Enter — новая строка</div>
    </div>
  );
}
