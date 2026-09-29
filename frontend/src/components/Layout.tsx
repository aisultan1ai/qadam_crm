import { Suspense } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, FolderKanban, CheckSquare, BarChart3, Users, Settings,
  Sun, Moon, LogOut, Search, Bell, Menu, X, PanelLeftClose, PanelLeftOpen,
  Shield, Zap, MessageSquare, Workflow, Inbox as InboxIcon, Mail as MailIcon,
  BookOpen, Calendar as CalendarIcon, Timer as TimerIcon,
  Network, Contact2, CalendarClock, BookUser,
  Activity as ActivityIcon, PalmtreeIcon, Coins, PieChart,
  PenSquare, Phone, Boxes,
  FileText, BookText, Palmtree, Puzzle, ChevronDown, Plus, Star, CircleDot,
} from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/store/auth";
import { useTheme } from "@/store/theme";
import { useSidebar } from "@/store/sidebar";
import { Avatar } from "./ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError, onApiEvent } from "@/api/client";
import { useOnline } from "@/hooks/useOnline";
import type { Notification, Page, Project } from "@/types";
import GlobalSearch from "./GlobalSearch";
import { ShortcutsDialog, useGlobalShortcuts } from "./Shortcuts";
import TenantSwitcher from "./TenantSwitcher";
import WelcomeModal from "./WelcomeModal";
import { TimerWidget } from "./TimerWidget";
import { LogoMark } from "./Logo";
import { ErrorBoundary } from "./ErrorBoundary";
import { Button } from "@/components/lib/Button";
import { useRealtimeUpdates } from "@/lib/ws";
import { applyBrandColor } from "@/lib/branding";
import { useToast } from "./Toast";
import { modKey } from "@/lib/platform";
import { fromNow } from "@/lib/date";
import { t } from "@/lib/i18n";
import { useFavorites } from "@/hooks/useFavorites";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  code?: string | string[];
  platformAdminOnly?: boolean;
};

type NavSection = {
  title?: string;
  items: NavItem[];
};

// Структура навигации в стиле Planfix: сгруппирована по секциям —
// Основное (Planner, Projects, Tasks), Коммуникации, Знания/Время, Люди, Настройки.
const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { to: "/", label: t.nav.dashboard, icon: LayoutDashboard, exact: true },
      { to: "/notifications", label: "Входящие", icon: Bell },
      { to: "/planner", label: "Планировщик", icon: CalendarClock },
      { to: "/projects", label: t.nav.projects, icon: FolderKanban, code: "projects.view" },
      { to: "/tasks", label: t.nav.tasks, icon: CheckSquare, code: ["tasks.view_all", "tasks.view_own"] },
    ],
  },
  {
    title: "Коммуникации",
    items: [
      { to: "/messenger", label: "Мессенджер", icon: MessageSquare, code: "messenger.use" },
      { to: "/inbox", label: "Открытые линии", icon: InboxIcon, code: "messengers.reply" },
      { to: "/mail", label: "Почта", icon: MailIcon, code: "mail.use" },
    ],
  },
  {
    title: "Работа",
    items: [
      { to: "/calendar", label: "Календарь", icon: CalendarIcon, code: "calendar.use" },
      { to: "/time", label: "Время", icon: TimerIcon, code: "time.use" },
      { to: "/wiki", label: "База знаний", icon: BookOpen, code: "wiki.use" },
      { to: "/documents", label: "Документы", icon: FileText },
      { to: "/whiteboard", label: "Доски", icon: PenSquare },
      { to: "/objects", label: "Объекты", icon: Boxes },
      { to: "/automations", label: "Автоматизации", icon: Workflow, code: "automations.manage" },
      { to: "/activity", label: "Хроника", icon: ActivityIcon },
      { to: "/reports", label: "Отчёты", icon: PieChart, code: "analytics.reports" },
      { to: "/analytics", label: t.nav.analytics, icon: BarChart3, code: "analytics.reports" },
    ],
  },
  {
    title: "CRM",
    items: [
      { to: "/leads", label: "Лиды", icon: Zap, code: "leads.view" },
      { to: "/deals", label: "Сделки", icon: Coins, code: "deals.view" },
      { to: "/contacts", label: "Контакты", icon: BookUser },
      { to: "/calls", label: "Звонки", icon: Phone },
    ],
  },
  {
    title: "Команда",
    items: [
      { to: "/people", label: "Сотрудники", icon: Contact2, code: "hr.view_profiles" },
      { to: "/org-chart", label: "Оргструктура", icon: Network, code: "hr.view_profiles" },
      { to: "/timeoff", label: "Отпуска", icon: PalmtreeIcon },
      { to: "/holidays", label: "Календарь праздников", icon: Palmtree },
      { to: "/users", label: t.nav.users, icon: Users, code: "users.view" },
    ],
  },
  {
    title: "Система",
    items: [
      { to: "/settings", label: t.nav.settings, icon: Settings, code: ["roles.manage", "settings.dictionaries", "settings.system"] },
      { to: "/admin", label: t.nav.platform, icon: Shield, platformAdminOnly: true },
    ],
  },
];

export default function Layout() {
  const { me, can, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { collapsed, toggle: toggleCollapsed } = useSidebar();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const toast = useToast();
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const openPalette = useCallback(() => setSearchOpen(true), []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  useGlobalShortcuts({ openPalette, openHelp: openShortcuts, canCreateTask: can("tasks.create") });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);

  useRealtimeUpdates();
  const online = useOnline();

  useEffect(() => {
    applyBrandColor(me?.current_tenant?.primary_color ?? null);
  }, [me?.current_tenant?.id, me?.current_tenant?.primary_color]);

  useEffect(() => {
    // Глобальные обработчики HTTP-событий: 403 → toast, сетевые ошибки → toast.
    // Refresh 401 уже перекинет на /login — сюда не долетает.
    const off403 = onApiEvent("forbidden", (err) => {
      const msg = extractApiError(err).message || "У вас нет прав на это действие";
      toast.error("Недостаточно прав", msg);
    });
    const offNet = onApiEvent("network_error", () => {
      toast.error("Нет соединения", "Проверьте интернет и попробуйте ещё раз");
    });
    return () => {
      off403();
      offNet();
    };
  }, [toast]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    setMobileNavOpen(false);
    setNotifOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (mobileNavOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileNavOpen]);

  const { data: notifs = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api.get<Page<Notification>>("/api/notifications")).data.items,
    // 60s было слишком редко на случай падения WS. 30s — компромисс.
    // Когда сеть офлайн — не долбим сервер (networkMode="online" — дефолт).
    refetchInterval: online ? 30000 : false,
    staleTime: 15000,
  });

  useEffect(() => {
    if (!notifOpen) return;
    const onClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNotifOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [notifOpen]);

  const { data: notifCounts } = useQuery({
    queryKey: ["notifications", "counts"],
    queryFn: async () => (await api.get<{ unread: number; mentions: number }>("/api/notifications/unread-count")).data,
    refetchInterval: online ? 30000 : false,
    staleTime: 15000,
  });
  const unread = notifCounts?.unread ?? notifs.filter((n) => !n.is_read).length;
  const [pulseKey, setPulseKey] = useState(0);
  const prevUnread = useRef(unread);
  useEffect(() => {
    if (unread > prevUnread.current) setPulseKey((k) => k + 1);
    prevUnread.current = unread;
  }, [unread]);

  const invalidateNotifs = () => qc.invalidateQueries({ queryKey: ["notifications"] });

  const readAll = useMutation({
    mutationFn: () => api.post("/api/notifications/read-all"),
    onSuccess: invalidateNotifs,
    onError: (e) => toast.error("Не удалось отметить уведомления", extractApiError(e).message),
  });

  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-brand-600 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-lg focus:outline-none"
      >
        Перейти к содержимому
      </a>
      {!online && (
        <div
          role="status"
          className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 shadow-soft dark:border-amber-800/60 dark:bg-amber-900/50 dark:text-amber-200"
        >
          Нет соединения — работаем в офлайн-режиме
        </div>
      )}
      <Sidebar
        onLinkClick={() => setMobileNavOpen(false)}
        me={me}
        can={can}
        logout={logout}
        variant="desktop"
        collapsed={collapsed}
      />

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-zinc-950/50 animate-fade-in"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64 max-w-[80vw] animate-slide-up">
            <Sidebar
              onLinkClick={() => setMobileNavOpen(false)}
              me={me}
              can={can}
              logout={logout}
              variant="mobile"
              collapsed={false}
              onClose={() => setMobileNavOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-zinc-200 bg-white px-3 text-zinc-900 sm:gap-2.5 sm:px-5 dark:border-zinc-800 dark:bg-[#0D0F13] dark:text-zinc-100">
          <Button
            variant="ghost"
            className="!p-2 md:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Открыть меню"
          >
            <Menu size={18} />
          </Button>

          <Button
            variant="ghost"
            className="hidden !p-2 md:inline-flex"
            onClick={toggleCollapsed}
            title={collapsed ? "Развернуть сайдбар" : "Свернуть сайдбар"}
            aria-label={collapsed ? "Развернуть сайдбар" : "Свернуть сайдбар"}
            aria-pressed={collapsed}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </Button>

          <button
            className="group flex flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-zinc-800 dark:bg-[#14171C] dark:hover:border-zinc-700 max-w-md"
            onClick={() => setSearchOpen(true)}
          >
            <Search size={15} />
            <span className="hidden truncate text-zinc-500 sm:inline">Поиск или команда…</span>
            <span className="truncate text-neutral-500 sm:hidden">Поиск…</span>
            <span className="ml-auto flex items-center gap-1">
              <span className="kbd">{modKey}</span>
              <span className="kbd">K</span>
            </span>
          </button>

          <CreateMenu can={can} />

          <TimerWidget />

          <TenantSwitcher />

          <Button variant="ghost" className="!p-2" onClick={toggle} title="Тема" aria-label="Переключить тему">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </Button>

          <div className="relative" ref={notifRef}>
            <Button
              variant="ghost"
              className="relative !p-2"
              onClick={() => setNotifOpen((v) => !v)}
              aria-label="Уведомления"
              aria-expanded={notifOpen}
            >
              <span
                key={`bell-${pulseKey}`}
                className={pulseKey ? "inline-flex animate-shake" : "inline-flex"}
                style={{ transformOrigin: "50% 15%" }}
              >
                <Bell size={18} />
              </span>
              {unread > 0 && (
                <>
                  <span
                    key={`badge-${pulseKey}`}
                    className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white tabular-nums animate-pop"
                  >
                    {unread}
                  </span>
                  {pulseKey > 0 && (
                    <span
                      key={`ring-${pulseKey}`}
                      aria-hidden
                      className="pointer-events-none absolute right-1 top-1 h-4 w-4 rounded-full bg-brand-600 animate-ping2"
                    />
                  )}
                </>
              )}
            </Button>
            {notifOpen && (
              <div
                className="card absolute right-0 mt-2 w-80 max-w-[calc(100vw-1rem)] animate-slide-up p-0 shadow-pop"
                role="menu"
              >
                <div className="flex items-center justify-between border-b border-neutral-100 p-3 dark:border-neutral-800">
                  <span className="text-sm font-semibold">Уведомления</span>
                  <button
                    className="text-xs link disabled:opacity-50"
                    disabled={readAll.isPending || unread === 0}
                    onClick={() => readAll.mutate()}
                  >
                    Отметить все
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {notifs.length === 0 && (
                    <div className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">Пусто</div>
                  )}
                  {notifs.map((n) => (
                    <div
                      key={n.id}
                      onClick={async () => {
                        try {
                          await api.post(`/api/notifications/${n.id}/read`);
                          if (n.task_id) navigate(`/tasks/${n.task_id}`);
                          setNotifOpen(false);
                          invalidateNotifs();
                        } catch (e) {
                          toast.error("Не удалось открыть уведомление", extractApiError(e).message);
                        }
                      }}
                      className={clsx(
                        "relative cursor-pointer border-b border-neutral-100 px-4 py-3 pl-5 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60",
                        !n.is_read
                          ? "bg-brand-50/60 before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r before:bg-brand-600 dark:bg-brand-900/20 dark:before:bg-brand-400"
                          : undefined,
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className={clsx("text-sm", !n.is_read ? "font-semibold" : "font-medium")}>{n.title}</div>
                          {n.body && <div className="mt-0.5 text-xs text-neutral-500 line-clamp-2 dark:text-neutral-400">{n.body}</div>}
                          <div className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500" title={new Date(n.created_at).toLocaleString("ru-RU")}>
                            {fromNow(n.created_at)}
                          </div>
                        </div>
                        {!n.is_read && (
                          <span
                            aria-label="Непрочитано"
                            className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-brand-600 dark:bg-brand-400"
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <NavLink
                  to="/notifications"
                  onClick={() => setNotifOpen(false)}
                  className="block border-t border-neutral-100 px-4 py-2.5 text-center text-[13px] font-medium text-brand-700 hover:bg-zinc-50 dark:border-neutral-800 dark:text-brand-300 dark:hover:bg-[#1B1F26]"
                >
                  Открыть «Входящие»
                </NavLink>
              </div>
            )}
          </div>

        </header>

        <EmailVerificationBanner />

        <main id="main-content" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-[1440px] flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7 focus:outline-none">
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

function Sidebar({
  me,
  can,
  logout,
  onLinkClick,
  variant,
  onClose,
  collapsed,
}: {
  me: ReturnType<typeof useAuth.getState>["me"];
  can: ReturnType<typeof useAuth.getState>["can"];
  logout: ReturnType<typeof useAuth.getState>["logout"];
  onLinkClick: () => void;
  variant: "desktop" | "mobile";
  onClose?: () => void;
  collapsed: boolean;
}) {
  const desktop = variant === "desktop";
  const showLabels = !(desktop && collapsed);
  const { pathname } = useLocation();
  const [closedSections, toggleSection] = useClosedSections();
  const { data: notifCounts } = useQuery({
    queryKey: ["notifications", "counts"],
    queryFn: async () => (await api.get<{ unread: number; mentions: number }>("/api/notifications/unread-count")).data,
    staleTime: 15000,
  });
  const notifCount = notifCounts?.unread ?? 0;
  const isActivePath = (n: NavItem) => pathname === n.to || (!n.exact && pathname.startsWith(n.to + "/"));
  return (
    <aside
      className={clsx(
        // Графитовый сайдбар — одинаковый в обеих темах, держит структуру продукта.
        "flex shrink-0 flex-col border-r border-zinc-200 bg-white text-zinc-700 transition-[width] duration-200 ease-out-soft dark:border-zinc-800 dark:bg-[#111419] dark:text-zinc-300",
        desktop
          ? clsx(
              "sticky top-0 hidden h-screen self-start overflow-hidden md:flex",
              collapsed ? "md:w-16" : "md:w-60",
            )
          : "h-full w-64",
      )}
    >
      <div
        className={clsx(
          "flex h-14 items-center gap-2.5 border-b border-zinc-200 dark:border-zinc-800",
          showLabels ? "px-4" : "justify-center px-2",
        )}
      >
        {me?.current_tenant?.logo_url ? (
          <img
            src={me.current_tenant.logo_url}
            alt=""
            className="h-7 w-7 rounded-md bg-white object-contain"
          />
        ) : (
          <LogoMark size={28} className="shrink-0" />
        )}
        {showLabels && (
          <span className="truncate text-sm font-semibold text-zinc-900 dark:text-white">
            {me?.current_tenant?.company_display_name || me?.current_tenant?.name || "Qadam CRM"}
          </span>
        )}
        {!desktop && onClose && (
          <button className="ml-auto rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-[#1B1F26] dark:hover:text-white" onClick={onClose} aria-label="Закрыть меню">
            <X size={16} />
          </button>
        )}
      </div>

      <nav className={clsx("flex-1 overflow-y-auto py-3", showLabels ? "px-2.5" : "px-2")} aria-label="Основная навигация">
        {NAV_SECTIONS.map((section, sIdx) => {
          const visible = section.items.filter((n) => {
            if (n.platformAdminOnly && !me?.is_platform_admin) return false;
            if (n.code && !can(n.code)) return false;
            return true;
          });
          if (visible.length === 0) return null;
          // Свёрнутая секция (как в ClickUp) оставляет видимым только активный пункт.
          const title = section.title;
          const isClosed = showLabels && !!title && closedSections.has(title);
          const shown = isClosed ? visible.filter(isActivePath) : visible;
          return (
            <div key={sIdx} className={clsx(sIdx > 0 && "mt-3")}>
              {title && showLabels && (
                <SectionToggle title={title} closed={isClosed} onToggle={() => toggleSection(title)} />
              )}
              <div className="space-y-0.5">
                {shown.map((n) => {
                  const Icon = n.icon;
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.exact}
                      onClick={onLinkClick}
                      title={showLabels ? undefined : n.label}
                      className={({ isActive }) =>
                        clsx(
                          "relative flex items-center rounded-md text-[13.5px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                          showLabels ? "gap-2.5 px-2.5 py-[7px]" : "justify-center px-2 py-2",
                          isActive
                            ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-white"
                            : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-[#1B1F26] dark:hover:text-white",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            aria-hidden
                            className={clsx(
                              "absolute inset-y-1.5 w-[3px] rounded-r bg-brand-600 transition-opacity duration-150 dark:bg-brand-400",
                              showLabels ? "-left-2.5" : "-left-2",
                              isActive ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <Icon size={16} strokeWidth={1.9} className="shrink-0" />
                          {showLabels && <span className="truncate">{n.label}</span>}
                          {n.to === "/messenger" && <MessengerUnreadBadge collapsed={!showLabels} />}
                          {n.to === "/notifications" && <CountBadge count={notifCount} collapsed={!showLabels} />}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
              {sIdx === 0 && showLabels && (
                <FavoritesBlock
                  closed={closedSections.has(FAVORITES_KEY)}
                  onToggle={() => toggleSection(FAVORITES_KEY)}
                  onLinkClick={onLinkClick}
                />
              )}
              {sIdx === 0 && showLabels && can("projects.view") && (
                <SpacesBlock
                  closed={closedSections.has(SPACES_KEY)}
                  onToggle={() => toggleSection(SPACES_KEY)}
                  canCreate={can("projects.create")}
                  onLinkClick={onLinkClick}
                />
              )}
            </div>
          );
        })}
      </nav>

      <div
        className={clsx(
          "border-t border-zinc-200 dark:border-zinc-800",
          showLabels ? "p-3" : "p-2",
        )}
      >
        {showLabels ? (
          <div className="flex items-center gap-2">
            <NavLink
              to="/profile"
              onClick={onLinkClick}
              className={({ isActive }) =>
                clsx(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 transition-colors text-zinc-900 dark:text-white",
                  isActive
                    ? "bg-zinc-100 dark:bg-[#1B1F26]"
                    : "hover:bg-zinc-100 dark:hover:bg-[#1B1F26]",
                )
              }
              title="Открыть профиль"
            >
              <Avatar name={me?.name} url={me?.avatar_url} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{me?.name}</div>
                <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">{me?.email}</div>
              </div>
            </NavLink>
            <button
              className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-[#1B1F26] dark:hover:text-white"
              onClick={logout}
              title="Выйти"
            >
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <NavLink
              to="/profile"
              onClick={onLinkClick}
              className={({ isActive }) =>
                clsx(
                  "flex items-center justify-center rounded-lg p-1 transition-colors text-zinc-900 dark:text-white",
                  isActive
                    ? "bg-zinc-100 dark:bg-[#1B1F26]"
                    : "hover:bg-zinc-100 dark:hover:bg-[#1B1F26]",
                )
              }
              title={me?.name ? `${me.name} — открыть профиль` : "Открыть профиль"}
            >
              <Avatar name={me?.name} url={me?.avatar_url} />
            </NavLink>
            <button
              className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-[#1B1F26] dark:hover:text-white"
              onClick={logout}
              title="Выйти"
              aria-label="Выйти"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

const SPACES_KEY = "Пространства";
const FAVORITES_KEY = "Избранное";

// «Избранное» — закреплённые проекты, задачи и статьи (звёздочка в шапке их страниц).
function FavoritesBlock({ closed, onToggle, onLinkClick }: { closed: boolean; onToggle: () => void; onLinkClick: () => void }) {
  const { favorites, toggle } = useFavorites();
  if (favorites.length === 0) return null;
  return (
    <div className="mt-3">
      <SectionToggle title={FAVORITES_KEY} closed={closed} onToggle={onToggle} />
      {!closed && (
        <div className="space-y-0.5">
          {favorites.map((f) => (
            <div key={`${f.entity}:${f.entity_id}`} className="group/fav relative">
              <NavLink
                to={f.url}
                onClick={onLinkClick}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-2.5 rounded-md py-[6px] pl-2.5 pr-7 text-[13.5px] transition-colors",
                    isActive
                      ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-white"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-[#1B1F26] dark:hover:text-white",
                  )
                }
              >
                {f.entity === "project" ? (
                  <span aria-hidden className="h-[10px] w-[10px] shrink-0 rounded-[3px] bg-brand-600" style={f.color ? { backgroundColor: f.color } : undefined} />
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
                className="absolute right-1 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-amber-500 opacity-0 hover:bg-zinc-200/70 group-hover/fav:opacity-100 focus:opacity-100 dark:hover:bg-zinc-700/60"
              >
                <Star size={12} className="fill-current" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
const CLOSED_SECTIONS_KEY = "sidebar:closed-sections";

function useClosedSections(): [Set<string>, (key: string) => void] {
  const [closed, setClosed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(window.localStorage.getItem(CLOSED_SECTIONS_KEY) || "[]"));
    } catch {
      return new Set();
    }
  });
  const toggle = (key: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      try {
        window.localStorage.setItem(CLOSED_SECTIONS_KEY, JSON.stringify([...next]));
      } catch {
        // localStorage недоступен (private mode) — просто не запоминаем.
      }
      return next;
    });
  return [closed, toggle];
}

function SectionToggle({ title, closed, onToggle, action }: { title: string; closed: boolean; onToggle: () => void; action?: React.ReactNode }) {
  return (
    <div className="group/sec mb-1 flex items-center pr-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!closed}
        className="flex flex-1 items-center gap-1 rounded px-2.5 py-1 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        {title}
        <ChevronDown
          size={12}
          className={clsx("opacity-0 transition-[transform,opacity] group-hover/sec:opacity-100", closed && "-rotate-90 opacity-100")}
        />
      </button>
      {action}
    </div>
  );
}

// «Пространства» — проекты прямо в сайдбаре, как Spaces в ClickUp.
function SpacesBlock({
  closed,
  onToggle,
  canCreate,
  onLinkClick,
}: {
  closed: boolean;
  onToggle: () => void;
  canCreate: boolean;
  onLinkClick: () => void;
}) {
  const LIMIT = 8;
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "sidebar"],
    queryFn: async () => (await api.get<Page<Project>>("/api/projects")).data.items,
    staleTime: 60_000,
  });
  const list = projects.filter((p) => !p.is_archived);
  return (
    <div className="mt-3">
      <SectionToggle
        title={SPACES_KEY}
        closed={closed}
        onToggle={onToggle}
        action={
          canCreate && (
            <NavLink
              to="/projects?new=1"
              onClick={onLinkClick}
              title="Новый проект"
              aria-label="Новый проект"
              className="grid h-5 w-5 place-items-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-[#1B1F26] dark:hover:text-white"
            >
              <Plus size={13} />
            </NavLink>
          )
        }
      />
      {!closed && (
        <div className="space-y-0.5">
          {list.length === 0 && <div className="px-2.5 py-1 text-[12.5px] text-zinc-400">Проектов пока нет</div>}
          {list.slice(0, LIMIT).map((p) => (
            <NavLink
              key={p.id}
              to={`/projects/${p.id}`}
              onClick={onLinkClick}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-[6px] text-[13.5px] transition-colors",
                  isActive
                    ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-white"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-[#1B1F26] dark:hover:text-white",
                )
              }
            >
              <span
                aria-hidden
                className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] bg-brand-600 text-[10px] font-semibold uppercase text-white"
                style={p.color ? { backgroundColor: p.color } : undefined}
              >
                {p.name.trim().charAt(0)}
              </span>
              <span className="truncate">{p.name}</span>
              {p.tasks_count > 0 && <span className="ml-auto text-[11px] tabular-nums text-zinc-400">{p.tasks_count}</span>}
            </NavLink>
          ))}
          {list.length > LIMIT && (
            <NavLink to="/projects" onClick={onLinkClick} className="block px-2.5 py-1 text-[12.5px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
              Все проекты ({list.length})
            </NavLink>
          )}
        </div>
      )}
    </div>
  );
}

// «+ Создать» в шапке: быстрый вход в создание задачи / проекта / сделки из любого экрана.
function CreateMenu({ can }: { can: ReturnType<typeof useAuth.getState>["can"] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const items = [
    { label: "Задача", hint: "в список задач", icon: CheckSquare, to: "/tasks?new=1", show: can("tasks.create") },
    { label: "Проект", hint: "новое пространство", icon: FolderKanban, to: "/projects?new=1", show: can("projects.create") },
    { label: "Сделка", hint: "в воронку продаж", icon: Coins, to: "/deals?new=1", show: can("deals.create") },
  ].filter((i) => i.show);
  if (items.length === 0) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="btn-primary !px-2.5 !py-1.5 sm:!px-3"
      >
        <Plus size={16} />
        <span className="hidden sm:inline">Создать</span>
      </button>
      {open && (
        <div role="menu" className="card absolute left-0 z-50 mt-2 w-60 animate-slide-up p-1.5 shadow-pop sm:left-auto sm:right-0">
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
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-[#1B1F26]"
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                  <Icon size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{i.label}</span>
                  <span className="block text-xs text-zinc-500">{i.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CountBadge({ count, collapsed }: { count: number; collapsed: boolean }) {
  if (count <= 0) return null;
  const label = count > 99 ? "99+" : String(count);
  if (collapsed) {
    return (
      <span
        aria-label={`Непрочитано: ${label}`}
        className="absolute right-1 top-1 min-w-[16px] rounded-full bg-brand-600 px-1 py-0.5 text-center text-[9px] font-medium leading-none text-white"
      >
        {label}
      </span>
    );
  }
  return (
    <span className="ml-auto min-w-[18px] rounded-md bg-brand-600 px-1.5 py-0.5 text-center text-[10px] font-medium leading-none text-white">
      {label}
    </span>
  );
}

function MessengerUnreadBadge({ collapsed }: { collapsed: boolean }) {
  const { can } = useAuth();
  const enabled = can("messenger.use");
  const { data } = useQuery({
    enabled,
    queryKey: ["messenger", "channels"],
    queryFn: async () => (await api.get<{ unread_count: number }[]>("/api/messenger/channels")).data,
    staleTime: 15_000,
  });
  const total = (data || []).reduce((sum, c) => sum + (c.unread_count || 0), 0);
  if (!enabled || total <= 0) return null;
  const label = total > 99 ? "99+" : String(total);
  if (collapsed) {
    return (
      <span
        aria-label={`Непрочитано: ${label}`}
        className="absolute right-1 top-1 min-w-[16px] rounded-full bg-brand-600 px-1 py-0.5 text-center text-[9px] font-medium leading-none text-white"
      >
        {label}
      </span>
    );
  }
  return (
    <span className="ml-auto min-w-[18px] rounded-md bg-brand-600 px-1.5 py-0.5 text-center text-[10px] font-medium leading-none text-white">
      {label}
    </span>
  );
}

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
    <div
      role="alert"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3">
        <span>
          Подтвердите email <b>{me.email}</b> — мы отправили ссылку. Не пришло?{" "}
          <button
            type="button"
            onClick={resend}
            disabled={sending}
            className="underline underline-offset-2 disabled:opacity-60"
          >
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
