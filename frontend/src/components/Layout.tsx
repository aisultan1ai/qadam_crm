/**
 * Каркас платформы: тёмная полоса модулей (с подписями) → панель текущего модуля → верхняя строка → контент.
 * Одинаков на всех экранах: модуль выбирается слева, навигация раздела — в панели, действия страницы — в её шапке.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Activity as ActivityIcon, AlarmClock, ArrowUpCircle, BarChart3, Bell, BookOpen, BookUser, Boxes, Calendar as CalendarIcon,
  CalendarClock, CheckSquare, ChevronDown, Coins, Contact2, Eye, FileText, FolderKanban, Home, Inbox as InboxIcon,
  LayoutGrid, ListChecks, LogOut, Mail as MailIcon, Menu, MessageSquare, MessagesSquare, Moon, Network,
  Palmtree, PanelLeftClose, PanelLeftOpen, PenSquare, Phone, PieChart, Plus, Search, Settings, Shield, Star, Sun,
  Timer as TimerIcon, User as UserIcon, UserCheck, UserPlus, Users, Workflow, X, Zap, CircleDot,
} from "lucide-react";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/store/auth";
import { usePageTitle } from "@/lib/pageTitle";
import { useTheme } from "@/store/theme";
import { useSidebar } from "@/store/sidebar";
import { api, extractApiError, onApiEvent } from "@/api/client";
import { useOnline } from "@/hooks/useOnline";
import { useFavorites } from "@/hooks/useFavorites";
import { useRealtimeUpdates } from "@/lib/ws";
import { applyBrandColor } from "@/lib/branding";
import { modKey } from "@/lib/platform";
import { fromNow } from "@/lib/date";
import type { Notification, Page, Project } from "@/types";
import { Avatar } from "./ui";
import { Popover, PopoverItem } from "./Popover";
import GlobalSearch from "./GlobalSearch";
import { ShortcutsDialog, useGlobalShortcuts } from "./Shortcuts";
import TenantSwitcher from "./TenantSwitcher";
import WelcomeModal from "./WelcomeModal";
import { TimerWidget } from "./TimerWidget";
import { LogoMark } from "./Logo";
import { ErrorBoundary } from "./ErrorBoundary";
import { SETTINGS_TABS } from "@/pages/settings/nav";
import { useToast } from "./Toast";

type Can = ReturnType<typeof useAuth.getState>["can"];
type Icon = typeof Home;

type PanelItem = {
  to: string;
  label: string;
  icon: Icon;
  exact?: boolean;
  code?: string | string[];
  platformAdminOnly?: boolean;
  /** Раздел только для владельца компании. */
  ownerOnly?: boolean;
  /** Владельцу доступно без права code (как в настройках). */
  ownerBypass?: boolean;
  badge?: "notifications" | "messenger" | "overdue" | "feed";
};

type Module = {
  key: string;
  label: string;
  icon: Icon;
  items: PanelItem[];
  /** Дополнительные пути, которые относятся к модулю (детальные страницы и т. п.). */
  paths?: string[];
  /** Блок под основными пунктами панели. */
  extra?: "favorites" | "task-projects" | "spaces";
  /** Показывать внизу полосы модулей, а не в общем списке. */
  bottom?: boolean;
};

const MODULES: Module[] = [
  {
    key: "home",
    label: "Главная",
    icon: Home,
    paths: ["/profile"],
    extra: "favorites",
    items: [
      { to: "/", label: "Обзор", icon: LayoutGrid, exact: true },
      { to: "/notifications", label: "Входящие", icon: InboxIcon, badge: "notifications" },
      { to: "/planner", label: "Планировщик", icon: CalendarClock },
      { to: "/activity", label: "Хроника", icon: ActivityIcon, badge: "feed" },
    ],
  },
  {
    key: "tasks",
    label: "Задачи",
    icon: CheckSquare,
    extra: "task-projects",
    items: [
      { to: "/tasks", label: "Все задачи", icon: ListChecks, code: ["tasks.view_all", "tasks.view_own"] },
      { to: "/tasks?scope=incoming", label: "Мне назначены", icon: UserCheck, code: ["tasks.view_all", "tasks.view_own"] },
      { to: "/tasks?scope=outgoing", label: "Я поставил", icon: ArrowUpCircle, code: ["tasks.view_all", "tasks.view_own"] },
      { to: "/tasks?scope=audited", label: "Наблюдаю", icon: Eye, code: ["tasks.view_all", "tasks.view_own"] },
      { to: "/tasks?overdue=1", label: "Просроченные", icon: AlarmClock, code: ["tasks.view_all", "tasks.view_own"], badge: "overdue" },
    ],
  },
  {
    key: "projects",
    label: "Проекты",
    icon: FolderKanban,
    extra: "spaces",
    items: [
      { to: "/projects", label: "Все проекты", icon: FolderKanban, code: "projects.view" },
      { to: "/projects?scope=participating", label: "Я участвую", icon: Users, code: "projects.view" },
      { to: "/projects?scope=made_by_me", label: "Созданы мной", icon: UserIcon, code: "projects.view" },
      { to: "/projects?scope=audited_by_me", label: "Наблюдаю", icon: Eye, code: "projects.view" },
    ],
  },
  {
    key: "crm",
    label: "CRM",
    icon: Coins,
    items: [
      { to: "/deals", label: "Сделки", icon: Coins, code: "deals.view" },
      { to: "/leads", label: "Лиды", icon: Zap, code: "leads.view" },
      { to: "/contacts", label: "Контакты", icon: BookUser },
      { to: "/calls", label: "Звонки", icon: Phone },
      { to: "/objects", label: "Объекты", icon: Boxes },
    ],
  },
  {
    key: "comms",
    label: "Чаты",
    icon: MessagesSquare,
    items: [
      { to: "/messenger", label: "Мессенджер", icon: MessageSquare, code: "messenger.use", badge: "messenger" },
      { to: "/inbox", label: "Открытые линии", icon: InboxIcon, code: "messengers.reply" },
      { to: "/mail", label: "Почта", icon: MailIcon, code: "mail.use" },
    ],
  },
  {
    key: "calendar",
    label: "Календарь",
    icon: CalendarIcon,
    items: [
      { to: "/calendar", label: "Календарь", icon: CalendarIcon, code: "calendar.use" },
      { to: "/time", label: "Учёт времени", icon: TimerIcon, code: "time.use" },
      { to: "/timeoff", label: "Отпуска", icon: Palmtree },
      { to: "/holidays", label: "Праздники", icon: CalendarClock },
    ],
  },
  {
    key: "knowledge",
    label: "Знания",
    icon: BookOpen,
    items: [
      { to: "/wiki", label: "База знаний", icon: BookOpen, code: "wiki.use" },
      { to: "/documents", label: "Документы", icon: FileText },
      { to: "/whiteboard", label: "Доски", icon: PenSquare },
    ],
  },
  {
    key: "team",
    label: "Команда",
    icon: Users,
    items: [
      { to: "/people", label: "Сотрудники", icon: Contact2, code: "hr.view_profiles" },
      { to: "/org-chart", label: "Оргструктура", icon: Network, code: "hr.view_profiles" },
      { to: "/users", label: "Пользователи", icon: Users, code: "users.view" },
    ],
  },
  {
    key: "more",
    label: "Ещё",
    icon: LayoutGrid,
    items: [
      { to: "/reports", label: "Отчёты", icon: PieChart, code: "analytics.reports" },
      { to: "/analytics", label: "Аналитика", icon: BarChart3, code: "analytics.reports" },
      { to: "/automations", label: "Автоматизации", icon: Workflow, code: "automations.manage" },
      { to: "/admin", label: "Платформа", icon: Shield, platformAdminOnly: true },
    ],
  },
  {
    key: "settings",
    label: "Настройки",
    icon: Settings,
    bottom: true,
    items: SETTINGS_TABS.map((t) => ({
      to: `/settings/${t.to}`,
      label: t.label,
      icon: t.icon,
      code: t.perm,
      ownerOnly: t.ownerOnly,
      ownerBypass: true,
    })),
  },
];

const splitTo = (to: string) => {
  const [path, query = ""] = to.split("?");
  return { path, params: new URLSearchParams(query) };
};

function pathMatches(pathname: string, path: string, exact?: boolean) {
  if (exact || path === "/") return pathname === path;
  return pathname === path || pathname.startsWith(path + "/");
}

function moduleOf(pathname: string): Module | undefined {
  // Самое длинное совпадение пути: /settings → «Ещё», /tasks/12 → «Задачи».
  let best: { m: Module; len: number } | undefined;
  for (const m of MODULES) {
    const paths = [...m.items.map((i) => splitTo(i.to).path), ...(m.paths ?? [])];
    for (const p of paths) {
      if (pathMatches(pathname, p, p === "/") && (!best || p.length > best.len)) best = { m, len: p.length };
    }
  }
  return best?.m;
}

function useVisible(me: ReturnType<typeof useAuth.getState>["me"], can: Can) {
  const isOwner = !!me?.current_tenant?.is_owner || !!me?.is_platform_admin;
  return useCallback(
    (i: PanelItem) => {
      if (i.platformAdminOnly && !me?.is_platform_admin) return false;
      if (i.ownerOnly) return isOwner;
      if (i.code && !can(i.code)) return !!i.ownerBypass && isOwner;
      return true;
    },
    [me?.is_platform_admin, isOwner, can],
  );
}

export default function Layout() {
  usePageTitle();
  // Внутренние страницы — только для вошедших пользователей, в поиске им делать нечего.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  const { me, can, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { collapsed, toggle: togglePanel } = useSidebar();
  const { pathname } = useLocation();
  const toast = useToast();
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const openPalette = useCallback(() => setSearchOpen(true), []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  useGlobalShortcuts({ openPalette, openHelp: openShortcuts, canCreateTask: can("tasks.create") });

  useRealtimeUpdates();
  const online = useOnline();

  useEffect(() => {
    applyBrandColor(me?.current_tenant?.primary_color ?? null);
  }, [me?.current_tenant?.id, me?.current_tenant?.primary_color]);

  useEffect(() => {
    // Глобальные обработчики HTTP-событий: 403 → toast, сетевые ошибки → toast.
    const off403 = onApiEvent("forbidden", (err) => {
      toast.error("Недостаточно прав", extractApiError(err).message || "У вас нет прав на это действие");
    });
    const offNet = onApiEvent("network_error", () => toast.error("Нет соединения", "Проверьте интернет и попробуйте ещё раз"));
    return () => {
      off403();
      offNet();
    };
  }, [toast]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  const visible = useVisible(me, can);
  const modules = useMemo(() => MODULES.filter((m) => m.items.some(visible)), [visible]);
  const active = moduleOf(pathname) ?? modules[0];
  // Мессенджер / Открытые линии / Почта — рабочие области на всю высоту, без отступов контента.
  const fullBleed = /^\/(messenger|inbox|mail)(\/|$)/.test(pathname);

  return (
    <div className={clsx("flex", fullBleed ? "h-screen overflow-hidden" : "min-h-screen")}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-brand-600 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:outline-none"
      >
        Перейти к содержимому
      </a>
      {!online && (
        <div
          role="status"
          className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/50 dark:text-amber-200"
        >
          Нет соединения — работаем в офлайн-режиме
        </div>
      )}

      {/* Десктоп: полоса модулей + панель модуля */}
      <div className="sticky top-0 hidden h-screen shrink-0 md:flex">
        <Rail modules={modules} active={active} me={me} logout={logout} />
        {!collapsed && active && <ModulePanel module={active} visible={visible} onCollapse={togglePanel} can={can} />}
      </div>

      {/* Телефон: то же самое в выезжающем меню */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-zinc-950/50 animate-fade-in" onClick={() => setMobileNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex max-w-[92vw] animate-slide-up">
            <Rail modules={modules} active={active} me={me} logout={logout} />
            {active && <ModulePanel module={active} visible={visible} onCollapse={() => setMobileNavOpen(false)} can={can} mobile />}
          </div>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar
          can={can}
          theme={theme}
          toggleTheme={toggle}
          onOpenMenu={() => setMobileNavOpen(true)}
          onSearch={openPalette}
          panelCollapsed={collapsed}
          onExpandPanel={togglePanel}
          online={online}
        />
        <EmailVerificationBanner />
        <main
          id="main-content"
          tabIndex={-1}
          className={clsx(
            "w-full min-w-0 flex-1 focus:outline-none",
            fullBleed ? "flex min-h-0 flex-col" : "mx-auto max-w-[1560px] px-4 py-4 sm:px-6 lg:py-5",
          )}
        >
          <ErrorBoundary>
            <Suspense fallback={<div className="min-h-[200px]" />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} onShowShortcuts={openShortcuts} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <WelcomeModal />
    </div>
  );
}

/* ============================== Полоса модулей ============================== */

function Rail({
  modules,
  active,
  me,
  logout,
}: {
  modules: Module[];
  active?: Module;
  me: ReturnType<typeof useAuth.getState>["me"];
  logout: () => void;
}) {
  const visible = useVisible(me, useAuth((s) => s.can));
  const nav = useNavigate();
  const meRef = useRef<HTMLButtonElement>(null);
  const [meOpen, setMeOpen] = useState(false);
  const notifCount = useNotifCounts().unread + useFeedUnread();

  return (
    <nav aria-label="Модули" className="flex h-full w-16 shrink-0 flex-col items-center bg-rail py-2.5 text-zinc-400">
      <NavLink to="/" aria-label="Qadam — главная" className="mb-2.5 grid h-9 w-9 place-items-center rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
        {me?.current_tenant?.logo_url ? (
          <img src={me.current_tenant.logo_url} alt="" className="h-8 w-8 rounded-lg bg-white object-contain" />
        ) : (
          <LogoMark size={30} inverted />
        )}
      </NavLink>
      <div className="flex w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto px-1 [scrollbar-width:none]">
        {modules.filter((m) => !m.bottom).map((m) => {
          const Icon = m.icon;
          const on = active?.key === m.key;
          const first = m.items.find(visible);
          return (
            <NavLink
              key={m.key}
              to={first?.to ?? "/"}
              title={m.label}
              aria-current={on ? "page" : undefined}
              className={clsx(
                "relative flex w-full flex-col items-center gap-[3px] rounded-[10px] py-[7px] text-[9.5px] font-medium leading-none tracking-[-0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                // Акцентная полоска слева — активный модуль считывается и боковым зрением.
                on
                  ? "bg-rail-active text-white shadow-[inset_3px_0_0_rgb(var(--brand-400))]"
                  : "hover:bg-rail-hover hover:text-zinc-100",
              )}
            >
              <Icon size={18} strokeWidth={on ? 2.1 : 1.8} className={on ? "text-brand-400" : undefined} />
              <span className="max-w-full truncate">{m.label}</span>
              {m.key === "home" && notifCount > 0 && (
                <span className="absolute right-1.5 top-1 min-w-[15px] rounded-full bg-rose-500 px-1 text-center text-[9px] font-semibold leading-[15px] text-white">
                  {notifCount > 99 ? "99+" : notifCount}
                </span>
              )}
            </NavLink>
          );
        })}
      </div>
      {modules.filter((m) => m.bottom).map((m) => {
        const Icon = m.icon;
        const on = active?.key === m.key;
        return (
          <NavLink
            key={m.key}
            to={m.items.find(visible)?.to ?? "/"}
            title={m.label}
            aria-label={m.label}
            aria-current={on ? "page" : undefined}
            className={clsx(
              "mt-1 grid h-9 w-9 place-items-center rounded-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
              on ? "bg-rail-active text-brand-400" : "hover:bg-rail-hover hover:text-zinc-100",
            )}
          >
            <Icon size={18} strokeWidth={on ? 2.1 : 1.8} />
          </NavLink>
        );
      })}
      <button
        ref={meRef}
        type="button"
        onClick={() => setMeOpen((v) => !v)}
        aria-label="Профиль и выход"
        className="mt-2 rounded-full ring-2 ring-rail transition-shadow hover:ring-brand-400/60 focus-visible:outline-none focus-visible:ring-brand-400"
      >
        <Avatar name={me?.name} url={me?.avatar_url} size={30} />
      </button>
      <Popover anchorRef={meRef} open={meOpen} onClose={() => setMeOpen(false)} width={230}>
        <div className="border-b border-zinc-100 px-2 pb-2 pt-1 dark:border-zinc-800">
          <div className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">{me?.name}</div>
          <div className="truncate text-xs text-zinc-500">{me?.email}</div>
        </div>
        <div className="pt-1">
          <PopoverItem onClick={() => { setMeOpen(false); nav("/profile"); }}>
            <UserIcon size={14} className="text-zinc-400" /> Мой профиль
          </PopoverItem>
          <PopoverItem onClick={() => { setMeOpen(false); nav("/settings/team"); }}>
            <UserPlus size={14} className="text-zinc-400" /> Пригласить сотрудников
          </PopoverItem>
          <PopoverItem onClick={() => { setMeOpen(false); logout(); }}>
            <LogOut size={14} className="text-zinc-400" /> Выйти
          </PopoverItem>
        </div>
      </Popover>
    </nav>
  );
}

/* ============================== Панель модуля ============================== */

function ModulePanel({
  module: m,
  visible,
  onCollapse,
  can,
  mobile = false,
}: {
  module: Module;
  visible: (i: PanelItem) => boolean;
  onCollapse: () => void;
  can: Can;
  mobile?: boolean;
}) {
  const { pathname } = useLocation();
  const [sp] = useSearchParams();
  const items = m.items.filter(visible);
  // Ключи query, которыми отличаются пункты модуля (scope, overdue…) + project для задач.
  const keys = useMemo(() => {
    const s = new Set<string>();
    m.items.forEach((i) => splitTo(i.to).params.forEach((_v, k) => s.add(k)));
    if (m.extra === "task-projects") s.add("project");
    return [...s];
  }, [m]);

  const isActive = (i: PanelItem) => {
    const { path, params } = splitTo(i.to);
    if (!pathMatches(pathname, path, i.exact)) return false;
    // На детальных страницах (/tasks/12) подсвечиваем только «корневой» пункт.
    if (pathname !== path) return [...params.keys()].length === 0;
    for (const k of keys) {
      if ((params.get(k) ?? "") !== (sp.get(k) ?? "")) return false;
    }
    return true;
  };

  return (
    <aside
      className={clsx(
        "flex h-full w-[228px] shrink-0 flex-col border-r border-zinc-200 bg-[#F5F6F8] dark:border-zinc-800 dark:bg-[#1C1F25]",
        mobile && "w-[240px]",
      )}
      aria-label={`Раздел «${m.label}»`}
    >
      <div className="flex h-12 shrink-0 items-center justify-between px-4">
        <span className="text-[14px] font-semibold text-zinc-900 dark:text-white">{m.label}</span>
        <button
          type="button"
          onClick={onCollapse}
          aria-label={mobile ? "Закрыть меню" : "Свернуть панель"}
          title={mobile ? "Закрыть" : "Свернуть панель"}
          className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-700 dark:hover:bg-white/5 dark:hover:text-zinc-200"
        >
          {mobile ? <X size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      <nav className="flex-1 space-y-px overflow-y-auto px-2 pb-3">
        {items.map((i) => (
          <PanelLink key={i.to} item={i} active={isActive(i)} />
        ))}
        {m.extra === "favorites" && <FavoritesBlock />}
        {m.extra === "task-projects" && can("projects.view") && (
          <ProjectsBlock title="Проекты" hrefOf={(p) => `/tasks?project=${p.id}`} activeId={pathname === "/tasks" ? Number(sp.get("project")) || null : null} canCreate={can("projects.create")} />
        )}
        {m.extra === "spaces" && (
          <ProjectsBlock
            title="Пространства"
            hrefOf={(p) => `/projects/${p.id}`}
            activeId={pathname.startsWith("/projects/") ? Number(pathname.split("/")[2]) || null : null}
            canCreate={can("projects.create")}
          />
        )}
      </nav>
    </aside>
  );
}

function PanelLink({ item: i, active }: { item: PanelItem; active: boolean }) {
  const Icon = i.icon;
  return (
    <NavLink
      to={i.to}
      end={i.exact}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
        active
          ? "bg-brand-500/[0.12] font-semibold text-brand-700 dark:bg-brand-400/[0.14] dark:text-brand-300"
          : "text-zinc-700 hover:bg-zinc-200/60 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-white",
      )}
    >
      <Icon size={15} className={active ? "text-brand-600 dark:text-brand-300" : "text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300"} />
      <span className="min-w-0 flex-1 truncate">{i.label}</span>
      {i.badge && <PanelBadge kind={i.badge} active={active} />}
    </NavLink>
  );
}

function PanelBadge({ kind, active }: { kind: NonNullable<PanelItem["badge"]>; active: boolean }) {
  const notif = useNotifCounts().unread;
  const messenger = useMessengerUnread();
  const overdue = useOverdueCount(kind === "overdue");
  const feed = useFeedUnread();
  const n = kind === "notifications" ? notif : kind === "messenger" ? messenger : kind === "feed" ? feed : overdue;
  if (!n) return null;
  return (
    <span
      className={clsx(
        "text-[11px] font-semibold tabular-nums",
        kind === "overdue" ? "text-rose-600 dark:text-rose-400" : active ? "text-brand-700 dark:text-brand-300" : "text-zinc-500 dark:text-zinc-400",
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.05em] text-zinc-400 dark:text-zinc-500">
      <span>{children}</span>
      {action}
    </div>
  );
}

function FavoritesBlock() {
  const { favorites, toggle } = useFavorites();
  return (
    <>
      <SectionTitle>Избранное</SectionTitle>
      {favorites.length === 0 ? (
        <p className="px-2.5 py-1 text-[12px] leading-snug text-zinc-400">Отмечайте задачи, проекты и статьи звёздочкой — они появятся здесь.</p>
      ) : (
        favorites.map((f) => (
          <div key={`${f.entity}:${f.entity_id}`} className="group/fav relative">
            <NavLink
              to={f.url}
              className={({ isActive }) =>
                clsx(
                  "flex h-8 items-center gap-2.5 rounded-lg pl-2.5 pr-8 text-[13px] transition-colors",
                  isActive
                    ? "bg-brand-500/[0.12] font-semibold text-brand-700 dark:text-brand-300"
                    : "text-zinc-700 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-white/5",
                )
              }
            >
              {f.entity === "project" ? (
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px] bg-brand-600" style={f.color ? { backgroundColor: f.color } : undefined} />
              ) : f.entity === "task" ? (
                <CircleDot size={14} className="shrink-0 text-zinc-400" />
              ) : (
                <BookOpen size={14} className="shrink-0 text-zinc-400" />
              )}
              <span className="truncate">{f.title}</span>
            </NavLink>
            <button
              type="button"
              onClick={() => toggle(f.entity, f.entity_id)}
              aria-label={`Убрать «${f.title}» из избранного`}
              title="Убрать из избранного"
              className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-amber-500 opacity-0 hover:bg-zinc-200/70 group-hover/fav:opacity-100 focus:opacity-100 dark:hover:bg-white/10"
            >
              <Star size={12} className="fill-current" />
            </button>
          </div>
        ))
      )}
    </>
  );
}

function ProjectsBlock({
  title,
  hrefOf,
  activeId,
  canCreate,
}: {
  title: string;
  hrefOf: (p: Project) => string;
  activeId: number | null;
  canCreate: boolean;
}) {
  const LIMIT = 12;
  const [all, setAll] = useState(false);
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "sidebar"],
    queryFn: async () => (await api.get<Page<Project>>("/api/projects")).data.items,
    staleTime: 60_000,
  });
  const list = projects.filter((p) => !p.is_archived);
  return (
    <>
      <SectionTitle
        action={
          canCreate && (
            <NavLink
              to="/projects?new=1"
              title="Новый проект"
              aria-label="Новый проект"
              className="grid h-5 w-5 place-items-center rounded text-zinc-400 hover:bg-zinc-200/70 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
            >
              <Plus size={13} />
            </NavLink>
          )
        }
      >
        {title}
      </SectionTitle>
      {list.length === 0 && <p className="px-2.5 py-1 text-[12px] text-zinc-400">Проектов пока нет</p>}
      {(all ? list : list.slice(0, LIMIT)).map((p) => {
        const on = activeId === p.id;
        return (
          <NavLink
            key={p.id}
            to={hrefOf(p)}
            className={clsx(
              "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors",
              on
                ? "bg-brand-500/[0.12] font-semibold text-brand-700 dark:bg-brand-400/[0.14] dark:text-brand-300"
                : "text-zinc-700 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-white/5",
            )}
          >
            <span
              aria-hidden
              className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] bg-brand-600 text-[10px] font-semibold uppercase text-white"
              style={p.color ? { backgroundColor: p.color } : undefined}
            >
              {p.name.trim().charAt(0)}
            </span>
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {p.tasks_count > 0 && <span className="text-[11px] tabular-nums text-zinc-400">{p.tasks_count}</span>}
          </NavLink>
        );
      })}
      {list.length > LIMIT && (
        <button type="button" onClick={() => setAll((v) => !v)} className="flex h-7 items-center gap-1 px-2.5 text-[12px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          <ChevronDown size={13} className={clsx("transition-transform", all && "rotate-180")} />
          {all ? "Свернуть" : `Ещё ${list.length - LIMIT}`}
        </button>
      )}
    </>
  );
}

/* ============================== Верхняя строка ============================== */

function TopBar({
  can,
  theme,
  toggleTheme,
  onOpenMenu,
  onSearch,
  panelCollapsed,
  onExpandPanel,
  online,
}: {
  can: Can;
  theme: string;
  toggleTheme: () => void;
  onOpenMenu: () => void;
  onSearch: () => void;
  panelCollapsed: boolean;
  onExpandPanel: () => void;
  online: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-zinc-200 bg-white px-3 text-zinc-900 sm:px-4 dark:border-zinc-800 dark:bg-[#1C1F25] dark:text-zinc-100">
      <button type="button" onClick={onOpenMenu} aria-label="Открыть меню" className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 md:hidden dark:hover:bg-white/5">
        <Menu size={18} />
      </button>
      {panelCollapsed && (
        <button
          type="button"
          onClick={onExpandPanel}
          aria-label="Показать панель раздела"
          title="Показать панель раздела"
          className="hidden h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 md:grid dark:hover:bg-white/5"
        >
          <PanelLeftOpen size={17} />
        </button>
      )}
      <CreateMenu can={can} />

      <button
        type="button"
        onClick={onSearch}
        className="mx-auto flex h-8 w-full max-w-[420px] items-center gap-2 rounded-lg bg-zinc-100 px-3 text-[13px] text-zinc-500 transition-colors hover:bg-zinc-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:bg-[#23262D] dark:text-zinc-400 dark:hover:bg-[#2A2E36]"
      >
        <Search size={14} />
        <span className="truncate">
          <span className="hidden sm:inline">Поиск задач, людей, проектов…</span>
          <span className="sm:hidden">Поиск…</span>
        </span>
        <span className="ml-auto hidden items-center gap-1 sm:flex">
          <span className="kbd">{modKey}</span>
          <span className="kbd">K</span>
        </span>
      </button>

      <div className="flex items-center gap-1">
        <TimerWidget />
        <TenantSwitcher />
        <NotificationsButton online={online} />
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Переключить тему"
          title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white"
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
    </header>
  );
}

function NotificationsButton({ online }: { online: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const { data: notifs = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api.get<Page<Notification>>("/api/notifications", { params: { per_page: 15 } })).data.items,
    refetchInterval: online ? 30000 : false,
    staleTime: 15000,
  });
  const unread = useNotifCounts(online).unread;
  const [pulseKey, setPulseKey] = useState(0);
  const prev = useRef(unread);
  useEffect(() => {
    if (unread > prev.current) setPulseKey((k) => k + 1);
    prev.current = unread;
  }, [unread]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  const readAll = useMutation({
    mutationFn: () => api.post("/api/notifications/read-all"),
    onSuccess: invalidate,
    onError: (e) => toast.error("Не удалось отметить уведомления", extractApiError(e).message),
  });

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Уведомления"
        aria-expanded={open}
        className="relative grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white"
      >
        <span key={`bell-${pulseKey}`} className={pulseKey ? "inline-flex animate-shake" : "inline-flex"} style={{ transformOrigin: "50% 15%" }}>
          <Bell size={17} />
        </span>
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 min-w-[15px] rounded-full bg-rose-500 px-1 text-center text-[9px] font-semibold leading-[15px] text-white tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={340} align="end">
        <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
          <span className="text-[13px] font-semibold">Уведомления</span>
          <button className="link text-xs disabled:opacity-50" disabled={readAll.isPending || unread === 0} onClick={() => readAll.mutate()}>
            Прочитать все
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifs.length === 0 && <div className="py-8 text-center text-[13px] text-zinc-500">Пусто</div>}
          {notifs.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={async () => {
                try {
                  await api.post(`/api/notifications/${n.id}/read`);
                  setOpen(false);
                  invalidate();
                  if (n.task_id) navigate(`/tasks/${n.task_id}`);
                } catch (e) {
                  toast.error("Не удалось открыть уведомление", extractApiError(e).message);
                }
              }}
              className={clsx(
                "relative flex w-full items-start gap-2 rounded-md px-2 py-2 pl-4 text-left hover:bg-zinc-100 dark:hover:bg-white/5",
              )}
            >
              {!n.is_read && <span aria-label="Непрочитано" className="absolute left-1.5 top-3.5 h-1.5 w-1.5 rounded-full bg-brand-600 dark:bg-brand-400" />}
              <span className="min-w-0 flex-1">
                <span className={clsx("block truncate text-[13px]", !n.is_read ? "font-semibold" : "font-medium")}>{n.title}</span>
                {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-zinc-500">{n.body}</span>}
                <span className="mt-0.5 block text-[11px] text-zinc-400">{fromNow(n.created_at)}</span>
              </span>
            </button>
          ))}
        </div>
        <NavLink
          to="/notifications"
          onClick={() => setOpen(false)}
          className="mt-1 block rounded-md border-t border-zinc-100 px-2 py-2 text-center text-[13px] font-medium text-brand-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-brand-300 dark:hover:bg-white/5"
        >
          Открыть «Входящие»
        </NavLink>
      </Popover>
    </>
  );
}

// «+ Создать»: быстрый вход в создание задачи / проекта / сделки из любого экрана.
function CreateMenu({ can }: { can: Can }) {
  const navigate = useNavigate();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const items = [
    { label: "Задача", hint: "в список задач", icon: CheckSquare, to: "/tasks?new=1", show: can("tasks.create") },
    { label: "Проект", hint: "новое пространство", icon: FolderKanban, to: "/projects?new=1", show: can("projects.create") },
    { label: "Сделка", hint: "в воронку продаж", icon: Coins, to: "/deals?new=1", show: can("deals.create") },
  ].filter((i) => i.show);
  if (items.length === 0) return null;
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" className="btn-primary shrink-0 !px-2.5 sm:!px-3">
        <Plus size={15} strokeWidth={2.4} />
        <span className="hidden sm:inline">Создать</span>
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={236}>
        {items.map((i) => {
          const Icon = i.icon;
          return (
            <button
              key={i.to}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                navigate(i.to);
              }}
              className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-white/5"
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500/10 text-brand-700 dark:text-brand-300">
                <Icon size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{i.label}</span>
                <span className="block text-xs text-zinc-500">{i.hint}</span>
              </span>
            </button>
          );
        })}
      </Popover>
    </>
  );
}

/* ============================== Счётчики ============================== */

function useNotifCounts(online = true) {
  const { data } = useQuery({
    queryKey: ["notifications", "counts"],
    queryFn: async () => (await api.get<{ unread: number; mentions: number }>("/api/notifications/unread-count")).data,
    refetchInterval: online ? 30000 : false,
    staleTime: 15000,
  });
  return { unread: data?.unread ?? 0, mentions: data?.mentions ?? 0 };
}

/** Непрочитанные события «Хроники». Ключ под ["activity-feed"], чтобы «прочитано» на странице обновляло счётчик. */
function useFeedUnread(online = true) {
  const { data } = useQuery({
    queryKey: ["activity-feed", "unread-count"],
    queryFn: async () => (await api.get<{ unread: number }>("/api/activity/feed/unread-count")).data,
    refetchInterval: online ? 60000 : false,
    staleTime: 30000,
  });
  return data?.unread ?? 0;
}

function useMessengerUnread() {
  const { can } = useAuth();
  const enabled = can("messenger.use");
  const { data } = useQuery({
    enabled,
    queryKey: ["messenger", "channels"],
    queryFn: async () => (await api.get<{ unread_count: number }[]>("/api/messenger/channels")).data,
    staleTime: 15_000,
  });
  return enabled ? (data || []).reduce((sum, c) => sum + (c.unread_count || 0), 0) : 0;
}

function useOverdueCount(enabled: boolean) {
  const { data } = useQuery({
    enabled,
    queryKey: ["tasks", "overdue-count"],
    queryFn: async () => (await api.get<Page<unknown>>("/api/tasks", { params: { overdue: true, per_page: 1 } })).data.total,
    staleTime: 60_000,
  });
  return data ?? 0;
}

/* ============================== Баннер email ============================== */

function EmailVerificationBanner() {
  const { me } = useAuth();
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (!me || me.email_verified !== false || dismissed) return null;

  const resend = async () => {
    if (sending) return;
    setSending(true);
    try {
      await api.post("/api/auth/resend-verification");
      toast.success("Письмо отправлено", `Проверьте почту ${me.email}`);
    } catch (e) {
      toast.error("Не удалось отправить", extractApiError(e).message || "Попробуйте позже");
    } finally {
      setSending(false);
    }
  };

  return (
    <div role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          Подтвердите email <b>{me.email}</b> — мы отправили ссылку. Не пришло?{" "}
          <button type="button" onClick={resend} disabled={sending} className="underline underline-offset-2 disabled:opacity-60">
            {sending ? "Отправляем…" : "Отправить ещё раз"}
          </button>
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded p-1 hover:bg-amber-100 dark:hover:bg-amber-900/50"
          aria-label="Скрыть напоминание"
          title="Скрыть до перезагрузки"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
