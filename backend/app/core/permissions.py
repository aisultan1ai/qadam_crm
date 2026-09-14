import logging
from typing import Iterable, Optional

_log = logging.getLogger("qadam.security.permissions")

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
        ("comments.update_any", "Редактирование любых комментариев (модерация)"),
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
    "Лиды": [
        ("leads.view", "Просмотр лидов"),
        ("leads.create", "Создание лидов вручную и импорт"),
        ("leads.update", "Изменение статуса и заметок"),
        ("leads.delete", "Удаление лидов"),
        ("leads.convert", "Конвертация в задачу"),
        ("leads.manage_forms", "Управление формами захвата"),
    ],
    "Мессенджер": [
        ("messenger.use", "Доступ к мессенджеру"),
        ("messenger.create_group", "Создание групповых чатов"),
        ("messenger.manage_any", "Модерация чужих сообщений"),
    ],
    "Автоматизации": [
        ("automations.manage", "Управление автоматизациями и триггерами"),
    ],
    "Открытые линии": [
        ("messengers.manage", "Управление каналами (Telegram/WhatsApp/Instagram)"),
        ("messengers.reply", "Работа с диалогами и ответы клиентам"),
    ],
    "Почта": [
        ("mail.use", "Использование email-канала (свой ящик)"),
    ],
    "База знаний": [
        ("wiki.use", "Просмотр опубликованных статей"),
        ("wiki.publish", "Создание и редактирование статей"),
        ("wiki.admin", "Управление правами, папками и версиями"),
    ],
    "Календарь": [
        ("calendar.use", "Работа с календарями и событиями"),
    ],
    "Букинг": [
        ("booking.use", "Управление страницами бронирования и встречами"),
    ],
    "Тайм-трекинг": [
        ("time.use", "Учёт своего времени и таймеры"),
        ("time.approve", "Утверждение табелей команды"),
    ],
    "HR-профили": [
        ("hr.view_profiles", "Просмотр расширенных профилей и оргструктуры"),
        ("hr.manage_goals", "Постановка и управление целями сотрудников"),
        ("hr.manage_one_on_ones", "Планирование и проведение 1-on-1"),
        ("hr.manage_skills", "Управление справочником скиллов"),
        ("kudos.give", "Публикация благодарностей коллегам"),
    ],
    "Контакты (CRM)": [
        ("contacts.view", "Просмотр контактов и компаний"),
        ("contacts.create", "Создание контактов и компаний"),
        ("contacts.update", "Редактирование контактов и компаний"),
        ("contacts.delete", "Удаление контактов и компаний"),
    ],
    "Сделки (CRM)": [
        ("deals.view", "Просмотр воронки и сделок"),
        ("deals.create", "Создание сделок"),
        ("deals.update", "Редактирование сделок (в т.ч. перевод по стадиям)"),
        ("deals.delete", "Удаление сделок"),
    ],
}


def all_permission_codes() -> list[str]:
    return [code for group in PERMISSIONS.values() for code, _ in group]


def user_has(user, codes: Iterable[str], tenant_id: Optional[int] = None) -> bool:
    """Проверка permissions пользователя в контексте конкретного tenant'а.

    Раньше функция перебирала ВСЕ user.roles без фильтра, из-за чего
    роль-админ в компании C давала админские права в компании A. Теперь
    учитываются только роли текущего tenant'а плюс системные роли
    (Role.tenant_id IS NULL).

    is_platform_admin/is_superuser — сквозной bypass, но это ПЛАТФОРМЕННЫЕ
    роли, не путать с tenant-owner (последний резолвится через
    TenantContext.membership.is_owner в require()).

    tenant_id=None оставлен для обратной совместимости с местами, где вызов
    делается вне tenant-контекста; в таком случае выводится warning в лог,
    т.к. это потенциальный cross-tenant leak.
    """
    if getattr(user, "is_platform_admin", False) or getattr(user, "is_superuser", False):
        return True
    if tenant_id is None:
        _log.warning("user_has(): tenant_id не передан — cross-tenant риск. Обновите call-site.")
        roles_iter = list(user.roles or [])
    else:
        roles_iter = [
            r for r in (user.roles or [])
            if r.tenant_id is None or r.tenant_id == tenant_id
        ]
    granted = {p.code for role in roles_iter for p in role.permissions}
    return any(c in granted for c in codes)
