from typing import Iterable

PERMISSIONS: dict[str, list[tuple[str, str]]] = {
    "Пользователи": [
        ("users.view", "Просмотр пользователей"),
        ("users.create", "Создание пользователей"),
        ("users.update", "Редактирование пользователей"),
        ("users.delete", "Удаление пользователей"),
        ("roles.manage", "Управление ролями"),
    ],
    "Проекты": [
        ("projects.view", "Просмотр проектов"),
        ("projects.create", "Создание проектов"),
        ("projects.update", "Редактирование проектов"),
        ("projects.delete", "Удаление проектов"),
        ("projects.archive", "Архивирование проектов"),
    ],
    "Задачи": [
        ("tasks.view_all", "Просмотр всех задач"),
        ("tasks.view_own", "Просмотр только своих задач"),
        ("tasks.create", "Создание задач"),
        ("tasks.update", "Редактирование задач"),
        ("tasks.delete", "Удаление задач"),
        ("tasks.assign", "Назначение исполнителей"),
        ("tasks.change_status", "Изменение статусов"),
        ("tasks.change_priority", "Изменение приоритета"),
        ("tasks.bulk_update", "Массовое изменение задач"),
    ],
    "Комментарии": [
        ("comments.view", "Просмотр комментариев"),
        ("comments.create", "Создание комментариев"),
        ("comments.update_own", "Редактирование своих комментариев"),
        ("comments.delete", "Удаление комментариев"),
    ],
    "Файлы": [
        ("files.upload", "Загрузка файлов"),
        ("files.download", "Скачивание файлов"),
        ("files.delete", "Удаление файлов"),
    ],
    "Аналитика": [
        ("analytics.reports", "Просмотр отчетов"),
        ("analytics.employees", "Просмотр статистики сотрудников"),
        ("analytics.export", "Экспорт отчетов"),
    ],
    "Настройки": [
        ("settings.dictionaries", "Управление справочниками"),
        ("settings.statuses", "Управление статусами задач"),
        ("settings.priorities", "Управление приоритетами"),
        ("settings.notifications", "Управление уведомлениями"),
        ("settings.system", "Системные настройки"),
    ],
}


def all_permission_codes() -> list[str]:
    return [code for group in PERMISSIONS.values() for code, _ in group]


def user_has(user, codes: Iterable[str]) -> bool:
    if getattr(user, "is_superuser", False):
        return True
    granted = {p.code for role in user.roles for p in role.permissions}
    return any(c in granted for c in codes)
