import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const BASE = "Qadam CRM";

// Первый сегмент пути → название вкладки.
const TITLES: Record<string, string> = {
  "": "Обзор",
  tasks: "Задачи",
  projects: "Проекты",
  deals: "Сделки",
  leads: "Лиды",
  contacts: "Контакты",
  planner: "Планировщик",
  calendar: "Календарь",
  notifications: "Входящие",
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
  users: "Пользователи",
  analytics: "Аналитика",
  reports: "Отчёты",
  automations: "Автоматизации",
  calls: "Звонки",
  objects: "Объекты",
  holidays: "Праздники",
  settings: "Настройки",
  admin: "Администрирование",
};

export function titleFor(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean)[0] ?? "";
  const name = TITLES[seg];
  return name ? `${name} — ${BASE}` : BASE;
}

/** Название вкладки по текущему разделу (чтобы вкладки в браузере различались). */
export function usePageTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titleFor(pathname);
  }, [pathname]);
}
