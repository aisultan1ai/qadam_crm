/**
 * Простой словарь UI-строк. Пока только русский — при необходимости масштабируем до
 * полноценной i18next-либы без изменений в вызовах.
 */

export const t = {
  nav: {
    dashboard: "Панель",
    projects: "Проекты",
    tasks: "Задачи",
    analytics: "Аналитика",
    users: "Пользователи",
    settings: "Настройки",
    platform: "Платформа",
    profile: "Профиль",
    logout: "Выйти",
  },
  common: {
    save: "Сохранить",
    cancel: "Отмена",
    delete: "Удалить",
    create: "Создать",
    edit: "Редактировать",
    back: "Назад",
    close: "Закрыть",
    loading: "Загрузка…",
    empty: "Пусто",
  },
} as const;
