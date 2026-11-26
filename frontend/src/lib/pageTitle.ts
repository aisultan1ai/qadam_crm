import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const BASE = "Qadam CRM";

// Первый сегмент пути → название вкладки.
const TITLES: Record<string, string> = {
  "": "Мой день",
  incoming: "Все входящие",
  help: "Центр помощи",
  tasks: "Задачи",
  projects: "Проекты",
  deals: "Сделки",
  leads: "Лиды",
  contacts: "Компании и контакты",
  planner: "Планировщик",
  calendar: "Календарь",
  notifications: "Уведомления",
  activity: "Хроника",
  messenger: "Мессенджер",
  inbox: "Открытые линии",
  mail: "Почта",
  wiki: "База знаний",
  documents: "Документы",
  whiteboard: "Доски",
  time: "Учёт времени",
  timeoff: "Отсутствия",
  people: "Сотрудники",
  "org-chart": "Оргструктура",
  profile: "Профиль",
  users: "Сотрудники",
  analytics: "Дашборды",
  reports: "Отчёты",
  automations: "Автоматизации",
  calls: "Звонки",
  objects: "Объекты",
  settings: "Настройки",
  admin: "Администрирование",
};

export function titleFor(pathname: string, overrides?: Record<string, string>): string {
  const seg = pathname.split("/").filter(Boolean)[0] ?? "";
  const name = overrides?.[seg] ?? TITLES[seg];
  return name ? `${name} — ${BASE}` : BASE;
}

// Публичные страницы (вне Layout). Лендинг, /privacy и /terms ставят заголовок сами.
const PUBLIC_TITLES: Record<string, string> = {
  login: "Вход",
  register: "Регистрация",
  "forgot-password": "Восстановление пароля",
  "reset-password": "Новый пароль",
  invite: "Приглашение в компанию",
  "verify-email": "Подтверждение email",
};

/** Заголовок публичной страницы и canonical-адрес — чтобы в поиске каждая страница была отдельной. */
export function usePublicPageMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const seg = pathname.split("/").filter(Boolean)[0] ?? "";
    const name = PUBLIC_TITLES[seg];
    if (name) document.title = `${name} — ${BASE}`;
    const url = `https://qcrm.kz${pathname === "/" ? "/" : pathname.replace(/\/+$/, "")}`;
    document.querySelector('link[rel="canonical"]')?.setAttribute("href", url);
    document.querySelector('meta[property="og:url"]')?.setAttribute("content", url);
  }, [pathname]);
}

/** Название вкладки по текущему разделу (чтобы вкладки в браузере различались). */
export function usePageTitle(overrides?: Record<string, string>) {
  const { pathname } = useLocation();
  const key = JSON.stringify(overrides ?? {});
  useEffect(() => {
    document.title = titleFor(pathname, JSON.parse(key));
  }, [pathname, key]);
}
