/**
 * Шаблоны экранов Qadam (см. дизайн-макеты «Qadam — шаблоны экранов»):
 * список, карточка объекта, настройки, рабочий экран.
 * Все страницы собираются из этих блоков — разметка и отступы задаются здесь, а не в каждой странице.
 */
import { ReactNode, useId } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ChevronLeft, Search, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Page: вертикальный ритм страницы
// ---------------------------------------------------------------------------

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("flex flex-col gap-5", className)}>{children}</div>;
}

// ---------------------------------------------------------------------------
// PageHeader: заголовок, подзаголовок, действия, опционально «назад» и мета-строка
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
  back,
  meta,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** мелкая строка над заголовком (дата, номер, раздел) */
  eyebrow?: ReactNode;
  /** ссылка «назад» — { to, label } */
  back?: { to: string; label: string };
  /** строка под заголовком (статусы, чипы) */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex flex-wrap items-end justify-between gap-4 border-b border-zinc-200 pb-5 dark:border-zinc-800",
        className,
      )}
    >
      <div className="min-w-0">
        {back && (
          <Link
            to={back.to}
            className="mb-2 inline-flex items-center gap-1 text-[13px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
          >
            <ChevronLeft size={15} /> {back.label}
          </Link>
        )}
        {eyebrow && <div className="section-label mb-1">{eyebrow}</div>}
        <h1 className="page-title flex flex-wrap items-center gap-2">{title}</h1>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs: подчёркнутые вкладки (разделы/области) и сегменты (режимы)
// ---------------------------------------------------------------------------

export type TabItem<K extends string> = {
  key: K;
  label: ReactNode;
  icon?: LucideIcon;
  count?: number | null;
  hidden?: boolean;
};

export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  className,
  size = "md",
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** aria-label группы */
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={clsx(
        "flex items-center gap-6 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800",
        size === "sm" && "gap-5",
        className,
      )}
    >
      {items
        .filter((t) => !t.hidden)
        .map((t) => {
          const active = t.key === value;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.key)}
              className={clsx(
                "-mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500",
                size === "sm" ? "py-2.5" : "py-3",
                active
                  ? "border-brand-600 font-medium text-zinc-900 dark:border-brand-400 dark:text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
              )}
            >
              {Icon && <Icon size={15} />}
              {t.label}
              {t.count != null && (
                <span
                  className={clsx(
                    "rounded-md px-1.5 text-xs font-medium tabular-nums",
                    active
                      ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                      : "bg-zinc-100 text-zinc-500 dark:bg-[#1B1F26] dark:text-zinc-400",
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
    </div>
  );
}

/** Сегментированный переключатель режимов (Таблица / Канбан, Мои / Все). */
export function Segmented<K extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: { key: K; label?: ReactNode; icon?: LucideIcon; title?: string; hidden?: boolean }[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={clsx(
        "inline-flex shrink-0 rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-[#1B1F26]",
        className,
      )}
    >
      {items
        .filter((i) => !i.hidden)
        .map((i) => {
          const active = i.key === value;
          const Icon = i.icon;
          return (
            <button
              key={i.key}
              type="button"
              aria-pressed={active}
              aria-label={i.label ? undefined : i.title}
              title={i.title}
              onClick={() => onChange(i.key)}
              className={clsx(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                active
                  ? "bg-white font-medium text-zinc-900 shadow-[0_1px_2px_rgb(13_15_19/0.08)] dark:bg-[#14171C] dark:text-white"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
              )}
            >
              {Icon && <Icon size={14} />}
              {i.label}
            </button>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar: поиск + фильтры слева, сортировка/вид справа
// ---------------------------------------------------------------------------

export function Toolbar({ children, right, className }: { children?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-wrap items-center gap-2", className)}>
      {children}
      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Поиск…",
  className,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
}) {
  const id = useId();
  return (
    <div className={clsx("relative w-full min-w-[200px] sm:w-72", className)}>
      <label htmlFor={id} className="sr-only">
        {label || placeholder}
      </label>
      <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
      <input
        id={id}
        type="search"
        className="input !h-8 !py-0 pl-8 pr-8 text-[13px]"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          aria-label="Очистить поиск"
          onClick={() => onChange("")}
          className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-[#1B1F26]"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/** Компактный select в стиле фильтра тулбара. */
export function FilterSelect({
  value,
  onChange,
  label,
  children,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const active = value !== "";
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={clsx(
        "h-8 max-w-[220px] cursor-pointer rounded-lg border bg-white px-2.5 pr-7 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:bg-[#14171C]",
        active
          ? "border-brand-500 bg-brand-50 font-medium text-brand-700 dark:border-brand-400 dark:bg-brand-500/10 dark:text-brand-300"
          : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300",
        className,
      )}
    >
      {children}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Panel: карточка с заголовком (секция контента)
// ---------------------------------------------------------------------------

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  flush,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** без внутренних отступов (для списков и таблиц во всю ширину) */
  flush?: boolean;
}) {
  return (
    <section className={clsx("card overflow-hidden", className)}>
      {(title || actions) && (
        <div className="card-header">
          {title && <h2 className="card-title flex items-center gap-2">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={clsx(!flush && "p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Карточка объекта: основная колонка + панель свойств
// ---------------------------------------------------------------------------

export function DetailLayout({ main, aside, className }: { main: ReactNode; aside: ReactNode; className?: string }) {
  return (
    <div className={clsx("grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]", className)}>
      <div className="flex min-w-0 flex-col gap-6">{main}</div>
      <aside className="flex flex-col gap-4 lg:sticky lg:top-[4.5rem]">{aside}</aside>
    </div>
  );
}

export function PropertyList({ title = "Свойства", children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-5">
      <div className="section-label mb-3">{title}</div>
      <dl className="flex flex-col gap-1">{children}</dl>
    </section>
  );
}

export function PropertyRow({ icon: Icon, label, children }: { icon?: LucideIcon; label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-9 grid-cols-[120px_minmax(0,1fr)] items-center gap-3 py-0.5">
      <dt className="flex items-center gap-2 text-[13px] text-zinc-500 dark:text-zinc-400">
        {Icon && <Icon size={15} className="shrink-0" />}
        {label}
      </dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 text-sm">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Настройки: меню разделов слева, контент справа
// ---------------------------------------------------------------------------

export type SettingsNavItem<K extends string> = { key: K; label: string; icon?: LucideIcon; hidden?: boolean };

export function SettingsLayout<K extends string>({
  title = "Настройки",
  items,
  value,
  onChange,
  children,
}: {
  title?: string;
  items: SettingsNavItem<K>[];
  value: K;
  onChange: (k: K) => void;
  children: ReactNode;
}) {
  const visible = items.filter((i) => !i.hidden);
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Разделы настроек" className="lg:sticky lg:top-[4.5rem]">
        <div className="mb-3 px-2.5 text-lg font-semibold tracking-tight">{title}</div>
        {/* Мобилка: select, десктоп: вертикальное меню */}
        <select
          aria-label="Раздел настроек"
          className="input lg:hidden"
          value={value}
          onChange={(e) => onChange(e.target.value as K)}
        >
          {visible.map((i) => (
            <option key={i.key} value={i.key}>
              {i.label}
            </option>
          ))}
        </select>
        <ul className="hidden flex-col gap-0.5 lg:flex">
          {visible.map((i) => {
            const Icon = i.icon;
            const active = i.key === value;
            return (
              <li key={i.key}>
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onChange(i.key)}
                  className={clsx(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                    active
                      ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-[#1B1F26] dark:hover:text-white",
                  )}
                >
                  {Icon && <Icon size={16} className="shrink-0" />}
                  <span className="truncate">{i.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Настройки с разделами-маршрутами (NavLink): меню слева, <Routes> справа. */
export function SettingsRouteLayout({
  title = "Настройки",
  subtitle,
  items,
  children,
}: {
  title?: string;
  subtitle?: string;
  items: { to: string; label: string; icon?: LucideIcon; hidden?: boolean }[];
  children: ReactNode;
}) {
  const visible = items.filter((i) => !i.hidden);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const current = visible.find((i) => pathname.endsWith("/" + i.to))?.to ?? "";
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[232px_minmax(0,1fr)]">
      <nav aria-label="Разделы настроек" className="lg:sticky lg:top-[4.5rem]">
        <div className="mb-1 px-2.5 text-lg font-semibold tracking-tight">{title}</div>
        {subtitle && <p className="mb-4 px-2.5 text-[13px] text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
        <select
          aria-label="Раздел настроек"
          className="input lg:hidden"
          value={current}
          onChange={(e) => navigate(e.target.value)}
        >
          {visible.map((i) => (
            <option key={i.to} value={i.to}>
              {i.label}
            </option>
          ))}
        </select>
        <ul className="hidden flex-col gap-0.5 lg:flex">
          {visible.map((i) => {
            const Icon = i.icon;
            return (
              <li key={i.to}>
                <NavLink
                  to={i.to}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                      isActive
                        ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-[#1B1F26] dark:hover:text-white",
                    )
                  }
                >
                  {Icon && <Icon size={16} className="shrink-0" />}
                  <span className="truncate">{i.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Группа полей настроек: заголовок-метка и строки «подпись слева — поле справа». */
export function SettingsSection({
  title,
  description,
  children,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="divide-y divide-zinc-100 px-5 dark:divide-zinc-800/70">{children}</div>
    </section>
  );
}

export function SettingsRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2 py-4 md:grid-cols-[240px_minmax(0,1fr)] md:gap-8">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">{hint}</div>}
      </div>
      <div className="max-w-xl">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Рабочий экран: список | контент | инфо-панель на всю высоту под шапкой
// ---------------------------------------------------------------------------

export function WorkspaceLayout({
  list,
  main,
  aside,
  className,
}: {
  list: ReactNode;
  main: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "-mx-4 -my-5 flex h-[calc(100vh-3.5rem)] min-h-0 overflow-hidden border-zinc-200 bg-white sm:-mx-6 lg:-mx-8 lg:-my-7 dark:border-zinc-800 dark:bg-[#14171C]",
        className,
      )}
    >
      <div className="flex w-full min-w-0 flex-col border-r border-zinc-200 md:w-80 md:shrink-0 dark:border-zinc-800">{list}</div>
      <div className="hidden min-w-0 flex-1 flex-col bg-[#F6F7F9] md:flex dark:bg-[#0D0F13]">{main}</div>
      {aside && (
        <div className="hidden w-80 shrink-0 flex-col border-l border-zinc-200 xl:flex dark:border-zinc-800">{aside}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Панель массовых действий
// ---------------------------------------------------------------------------

export function BulkBar({ count, children, onClear }: { count: number; children: ReactNode; onClear: () => void }) {
  if (count <= 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-sidebar px-3 py-2 text-[13px] text-white">
      <span className="font-medium tabular-nums">Выбрано: {count}</span>
      <span className="h-4 w-px bg-white/15" />
      <div className="flex flex-wrap items-center gap-1 [&_button]:text-zinc-200 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
        {children}
      </div>
      <button type="button" onClick={onClear} className="ml-auto rounded px-2 py-1 text-zinc-300 hover:bg-white/10 hover:text-white">
        Снять выделение
      </button>
    </div>
  );
}
