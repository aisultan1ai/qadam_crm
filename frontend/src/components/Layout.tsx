import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, FolderKanban, CheckSquare, BarChart3, Users, Settings,
  Sun, Moon, LogOut, Search, Bell,
} from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/store/auth";
import { useTheme } from "@/store/theme";
import { Avatar } from "./ui";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Notification, Page } from "@/types";
import GlobalSearch from "./GlobalSearch";
import { useRealtimeUpdates } from "@/lib/ws";

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
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useRealtimeUpdates();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);

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

  const unread = notifs.filter((n) => !n.is_read).length;

  const invalidateNotifs = () => qc.invalidateQueries({ queryKey: ["notifications"] });

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-neutral-200 bg-white/60 backdrop-blur md:flex md:flex-col dark:border-neutral-800 dark:bg-neutral-950/60">
        <div className="flex h-14 items-center gap-2 px-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white shadow-soft">
            <LayoutDashboard size={16} />
          </div>
          <span className="text-base font-semibold tracking-tight">Qadam CRM</span>
        </div>

        <nav className="flex-1 space-y-0.5 px-2">
          {NAV.map((n) => {
            if (n.code && !can(n.code as any)) return null;
            const Icon = n.icon;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.exact}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-white"
                      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-white",
                  )
                }
              >
                <Icon size={16} />
                {n.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <NavLink
              to="/profile"
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
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-neutral-200 bg-white/70 px-4 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/70">
          <button
            className="flex flex-1 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-500 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700 max-w-md"
            onClick={() => setSearchOpen(true)}
          >
            <Search size={15} />
            Поиск по всему CRM…
            <span className="ml-auto rounded border border-neutral-200 px-1.5 text-[10px] dark:border-neutral-700">Ctrl K</span>
          </button>

          <button className="btn-ghost !p-2" onClick={toggle} title="Тема">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <div className="relative">
            <button className="btn-ghost relative !p-2" onClick={() => setNotifOpen((v) => !v)}>
              <Bell size={18} />
              {unread > 0 && (
                <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
                  {unread}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="card absolute right-0 mt-2 w-80 animate-slide-up p-0" onMouseLeave={() => setNotifOpen(false)}>
                <div className="flex items-center justify-between border-b border-neutral-100 p-3 dark:border-neutral-800">
                  <span className="text-sm font-semibold">Уведомления</span>
                  <button
                    className="text-xs link"
                    onClick={async () => {
                      await api.post("/api/notifications/read-all");
                      invalidateNotifs();
                    }}
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
                        await api.post(`/api/notifications/${n.id}/read`);
                        if (n.task_id) navigate(`/tasks/${n.task_id}`);
                        setNotifOpen(false);
                        invalidateNotifs();
                      }}
                      className={clsx(
                        "cursor-pointer border-b border-neutral-100 px-4 py-3 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60",
                        !n.is_read && "bg-brand-50/40 dark:bg-brand-900/10",
                      )}
                    >
                      <div className="text-sm font-medium">{n.title}</div>
                      {n.body && <div className="mt-0.5 text-xs text-neutral-500 line-clamp-2">{n.body}</div>}
                      <div className="mt-1 text-[11px] text-neutral-400">
                        {new Date(n.created_at).toLocaleString("ru-RU")}
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
