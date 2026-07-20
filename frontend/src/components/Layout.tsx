import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, FolderKanban, CheckSquare, BarChart3, Users, Settings,
  Sun, Moon, LogOut, Search, Bell, Menu, X, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/store/auth";
import { useTheme } from "@/store/theme";
import { useSidebar } from "@/store/sidebar";
import { Avatar } from "./ui";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, extractApiError } from "@/api/client";
import type { Notification, Page } from "@/types";
import GlobalSearch from "./GlobalSearch";
import { LogoMark } from "./Logo";
import { useRealtimeUpdates } from "@/lib/ws";
import { useToast } from "./Toast";
import { modKey } from "@/lib/platform";
import { fromNow } from "@/lib/date";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/projects", label: "Проекты", icon: FolderKanban, code: "projects.view" },
  { to: "/tasks", label: "Задачи", icon: CheckSquare, code: ["tasks.view_all", "tasks.view_own"] },
  { to: "/analytics", label: "Аналитика", icon: BarChart3, code: "analytics.reports" },
  { to: "/users", label: "Пользователи", icon: Users, code: "users.view" },
  { to: "/settings", label: "Настройки", icon: Settings, code: ["roles.manage", "settings.dictionaries", "settings.system"] },
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);

  useRealtimeUpdates();

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
    refetchInterval: 60000,
    staleTime: 15000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  const unread = notifs.filter((n) => !n.is_read).length;

  const invalidateNotifs = () => qc.invalidateQueries({ queryKey: ["notifications"] });

  const readAll = useMutation({
    mutationFn: () => api.post("/api/notifications/read-all"),
    onSuccess: invalidateNotifs,
    onError: (e) => toast.error("Не удалось отметить уведомления", extractApiError(e).message),
  });

  return (
    <div className="flex min-h-screen">
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
            className="absolute inset-0 bg-black/40 animate-fade-in"
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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-neutral-200 px-3 sm:gap-3 sm:px-4 dark:border-neutral-800 surface-blur">
          <button
            className="btn-ghost !p-2 md:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Открыть меню"
          >
            <Menu size={18} />
          </button>

          <button
            className="btn-ghost hidden !p-2 md:inline-flex"
            onClick={toggleCollapsed}
            title={collapsed ? "Развернуть сайдбар" : "Свернуть сайдбар"}
            aria-label={collapsed ? "Развернуть сайдбар" : "Свернуть сайдбар"}
            aria-pressed={collapsed}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>

          <button
            className="group flex flex-1 items-center gap-2 rounded-lg border border-neutral-200 bg-white/70 px-2.5 py-1.5 text-sm text-neutral-500 transition-colors hover:border-neutral-300 hover:bg-white dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:border-neutral-700 dark:hover:bg-neutral-900 max-w-md"
            onClick={() => setSearchOpen(true)}
          >
            <Search size={15} />
            <span className="hidden truncate text-neutral-500 sm:inline">Поиск по всему CRM…</span>
            <span className="truncate text-neutral-500 sm:hidden">Поиск…</span>
            <span className="ml-auto flex items-center gap-1">
              <span className="kbd">{modKey}</span>
              <span className="kbd">K</span>
            </span>
          </button>

          <button className="btn-ghost !p-2" onClick={toggle} title="Тема" aria-label="Переключить тему">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <div className="relative" ref={notifRef}>
            <button
              className="btn-ghost relative !p-2"
              onClick={() => setNotifOpen((v) => !v)}
              aria-label="Уведомления"
              aria-expanded={notifOpen}
            >
              <Bell size={18} />
              {unread > 0 && (
                <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
                  {unread}
                </span>
              )}
            </button>
            {notifOpen && (
              <div
                className="card absolute right-0 mt-2 w-80 max-w-[calc(100vw-1rem)] animate-slide-up p-0"
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
                    <div className="py-8 text-center text-sm text-neutral-500">Пусто</div>
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
                          {n.body && <div className="mt-0.5 text-xs text-neutral-500 line-clamp-2">{n.body}</div>}
                          <div className="mt-1 text-[11px] text-neutral-400" title={new Date(n.created_at).toLocaleString("ru-RU")}>
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
              </div>
            )}
          </div>

        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
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
  return (
    <aside
      className={clsx(
        "flex shrink-0 flex-col border-r border-neutral-200 bg-white/60 backdrop-blur transition-[width] duration-200 dark:border-neutral-800 dark:bg-neutral-900/70",
        desktop
          ? clsx("hidden md:flex", collapsed ? "md:w-16" : "md:w-60")
          : "h-full w-64",
      )}
    >
      <div
        className={clsx(
          "flex h-14 items-center gap-2",
          showLabels ? "px-5" : "justify-center px-2",
        )}
      >
        <LogoMark size={32} className="shadow-soft rounded-lg" />
        {showLabels && <span className="text-base font-semibold tracking-tight">Qadam CRM</span>}
        {!desktop && onClose && (
          <button className="btn-ghost ml-auto !p-1.5" onClick={onClose} aria-label="Закрыть меню">
            <X size={16} />
          </button>
        )}
      </div>

      <nav className={clsx("flex-1 space-y-0.5", showLabels ? "px-2" : "px-1.5")}>
        {NAV.map((n) => {
          if (n.code && !can(n.code as any)) return null;
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
                  "relative flex items-center rounded-lg text-sm transition-colors",
                  showLabels ? "gap-2.5 px-3 py-2" : "justify-center px-2 py-2",
                  isActive
                    ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/25 dark:text-brand-300"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-white",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-brand-600 dark:bg-brand-400"
                    />
                  )}
                  <Icon size={16} />
                  {showLabels && n.label}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div
        className={clsx(
          "border-t border-neutral-200 dark:border-neutral-800",
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
                  "flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 transition-colors",
                  isActive
                    ? "bg-neutral-100 dark:bg-neutral-800"
                    : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60",
                )
              }
              title="Открыть профиль"
            >
              <Avatar name={me?.name} url={me?.avatar_url} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{me?.name}</div>
                <div className="truncate text-xs text-neutral-500">{me?.email}</div>
              </div>
            </NavLink>
            <button className="btn-ghost !p-1.5" onClick={logout} title="Выйти">
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
                  "flex items-center justify-center rounded-lg p-1 transition-colors",
                  isActive
                    ? "bg-neutral-100 dark:bg-neutral-800"
                    : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60",
                )
              }
              title={me?.name ? `${me.name} — открыть профиль` : "Открыть профиль"}
            >
              <Avatar name={me?.name} url={me?.avatar_url} />
            </NavLink>
            <button className="btn-ghost !p-1.5" onClick={logout} title="Выйти" aria-label="Выйти">
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
