"""Отраслевые наборы: структура отделов и готовые реестры (сущности «Объектов»).

Ставятся одной кнопкой в мастере первого запуска. Реестры — обычные сущности Объектов:
клиент сам меняет поля, добавляет свои. Повторная установка не дублирует (по коду сущности).
"""
from __future__ import annotations

CONTRACT_STATUSES = ["Черновик", "На согласовании", "На подписании", "Действует", "Исполнен", "Расторгнут"]

SCHEMAS: dict[str, dict] = {
    "contract": {
        "label": "Договоры",
        "fields": [
            {"name": "number", "label": "Номер договора", "type": "text"},
            {"name": "counterparty", "label": "Контрагент", "type": "relation", "target": "company", "required": True},
            {"name": "contract_type", "label": "Тип", "type": "select",
             "options": ["Поставка", "Подряд", "Услуги", "Аренда", "Агентский", "Прочее"]},
            {"name": "amount", "label": "Сумма, ₸", "type": "number"},
            {"name": "signed_at", "label": "Дата заключения", "type": "date"},
            {"name": "valid_until", "label": "Действует до", "type": "date"},
            {"name": "curator", "label": "Куратор", "type": "user"},
            {"name": "deal", "label": "Сделка", "type": "relation", "target": "deal"},
            {"name": "status", "label": "Статус", "type": "select", "options": CONTRACT_STATUSES},
        ],
    },
    "act": {
        "label": "Акты выполненных работ",
        "fields": [
            {"name": "contract", "label": "Договор", "type": "relation", "target": "object:contract", "required": True},
            {"name": "period", "label": "Период", "type": "text"},
            {"name": "amount", "label": "Сумма, ₸", "type": "number"},
            {"name": "act_date", "label": "Дата акта", "type": "date"},
            {"name": "status", "label": "Статус", "type": "select", "options": ["Подготовлен", "На проверке", "Подписан", "Отклонён"]},
        ],
    },
    "service_act": {
        "label": "Акты оказанных услуг",
        "fields": [
            {"name": "contract", "label": "Договор", "type": "relation", "target": "object:contract", "required": True},
            {"name": "period", "label": "Период", "type": "text"},
            {"name": "amount", "label": "Сумма, ₸", "type": "number"},
            {"name": "act_date", "label": "Дата акта", "type": "date"},
            {"name": "signed", "label": "Подписан", "type": "checkbox"},
        ],
    },
    "permit": {
        "label": "Лицензии и разрешения",
        "fields": [
            {"name": "number", "label": "Номер", "type": "text"},
            {"name": "kind", "label": "Вид", "type": "select",
             "options": ["Лицензия", "Разрешение", "Сертификат", "Доверенность", "Аттестат"]},
            {"name": "issuer", "label": "Кем выдан", "type": "text"},
            {"name": "issued_at", "label": "Дата выдачи", "type": "date"},
            {"name": "valid_until", "label": "Действует до", "type": "date", "required": True},
            {"name": "responsible", "label": "Ответственный", "type": "user"},
        ],
    },
    "mtr_request": {
        "label": "Заявки на МТР",
        "fields": [
            {"name": "description", "label": "Что нужно", "type": "textarea", "required": True},
            {"name": "quantity", "label": "Количество", "type": "number"},
            {"name": "unit", "label": "Ед. изм.", "type": "select", "options": ["шт", "кг", "т", "м", "м²", "м³", "л", "компл."]},
            {"name": "needed_by", "label": "Нужно к", "type": "date"},
            {"name": "project", "label": "Объект / проект", "type": "relation", "target": "project"},
            {"name": "requester", "label": "Заявитель", "type": "user"},
            {"name": "status", "label": "Статус", "type": "select", "options": ["Новая", "Согласована", "Закуплена", "Выдана", "Отклонена"]},
        ],
    },
    "hse_incident": {
        "label": "Инциденты ОТ и ТБ",
        "fields": [
            {"name": "happened_at", "label": "Дата", "type": "date", "required": True},
            {"name": "place", "label": "Место", "type": "text"},
            {"name": "kind", "label": "Тип", "type": "select",
             "options": ["Потенциальная опасность", "Инцидент", "Несчастный случай", "Нарушение"]},
            {"name": "description", "label": "Что произошло", "type": "textarea", "required": True},
            {"name": "responsible", "label": "Ответственный", "type": "user"},
            {"name": "measures", "label": "Принятые меры", "type": "textarea"},
            {"name": "closed", "label": "Закрыт", "type": "checkbox"},
        ],
    },
    "site_remark": {
        "label": "Предписания и замечания",
        "fields": [
            {"name": "project", "label": "Объект / проект", "type": "relation", "target": "project"},
            {"name": "contractor", "label": "Подрядчик", "type": "relation", "target": "company"},
            {"name": "description", "label": "Замечание", "type": "textarea", "required": True},
            {"name": "due", "label": "Срок устранения", "type": "date"},
            {"name": "responsible", "label": "Ответственный", "type": "user"},
            {"name": "status", "label": "Статус", "type": "select", "options": ["Открыто", "Устранено", "Принято", "Просрочено"]},
        ],
    },
    "purchase_request": {
        "label": "Заявки на закупку",
        "fields": [
            {"name": "item", "label": "Позиция", "type": "text", "required": True},
            {"name": "quantity", "label": "Количество", "type": "number"},
            {"name": "amount", "label": "Сумма, ₸", "type": "number"},
            {"name": "supplier", "label": "Поставщик", "type": "relation", "target": "company"},
            {"name": "status", "label": "Статус", "type": "select", "options": ["Новая", "Согласована", "Заказана", "Получена", "Отклонена"]},
        ],
    },
    "client_claim": {
        "label": "Рекламации",
        "fields": [
            {"name": "client", "label": "Клиент", "type": "relation", "target": "company", "required": True},
            {"name": "contract", "label": "Договор", "type": "relation", "target": "object:contract"},
            {"name": "description", "label": "Суть претензии", "type": "textarea", "required": True},
            {"name": "responsible", "label": "Ответственный", "type": "user"},
            {"name": "status", "label": "Статус", "type": "select", "options": ["Новая", "В работе", "Удовлетворена", "Отклонена"]},
        ],
    },
    "support_ticket": {
        "label": "Обращения клиентов",
        "fields": [
            {"name": "client", "label": "Клиент", "type": "relation", "target": "company"},
            {"name": "subject", "label": "Тема", "type": "text", "required": True},
            {"name": "priority", "label": "Приоритет", "type": "select", "options": ["Низкий", "Средний", "Высокий", "Критичный"]},
            {"name": "description", "label": "Описание", "type": "textarea"},
            {"name": "responsible", "label": "Ответственный", "type": "user"},
            {"name": "status", "label": "Статус", "type": "select", "options": ["Новое", "В работе", "Ждём клиента", "Решено"]},
        ],
    },
}

INDUSTRIES: list[dict] = [
    {
        "key": "mining", "label": "Горнодобывающая компания",
        "description": "Рудник, обогащение, геология, охрана труда",
        "departments": ["Руководство", "Производство", "Геология", "Охрана труда и ТБ", "Снабжение (МТР)",
                        "Финансы и бухгалтерия", "Юридический отдел", "Персонал"],
        "schemas": ["contract", "permit", "mtr_request", "hse_incident"],
    },
    {
        "key": "epc", "label": "EPC / строительство",
        "description": "Проектирование, строительство, технадзор, подрядчики",
        "departments": ["Руководство", "Управление проектами", "Проектирование", "Строительство", "Технадзор",
                        "ПТО", "Снабжение", "Финансы", "Юридический отдел"],
        "schemas": ["contract", "act", "site_remark", "mtr_request"],
    },
    {
        "key": "trade", "label": "Торговля и дистрибуция",
        "description": "Продажи, закупки, склад, логистика",
        "departments": ["Руководство", "Продажи", "Закупки", "Склад и логистика", "Финансы", "Маркетинг"],
        "schemas": ["contract", "purchase_request", "client_claim"],
    },
    {
        "key": "services", "label": "Услуги и консалтинг",
        "description": "Проекты для клиентов, акты, договоры",
        "departments": ["Руководство", "Продажи", "Проекты", "Финансы", "Персонал"],
        "schemas": ["contract", "service_act"],
    },
    {
        "key": "it", "label": "IT и разработка",
        "description": "Разработка, продукт, поддержка клиентов",
        "departments": ["Руководство", "Разработка", "Продукт", "Продажи", "Поддержка", "Персонал"],
        "schemas": ["contract", "support_ticket"],
    },
    {
        "key": "other", "label": "Другая отрасль",
        "description": "Базовая структура — дальше настроите под себя",
        "departments": ["Руководство", "Продажи", "Финансы", "Персонал"],
        "schemas": ["contract"],
    },
]

INDUSTRY_BY_KEY = {i["key"]: i for i in INDUSTRIES}


def ordered_schema_codes(codes: list[str]) -> list[str]:
    """Сначала то, на что ссылаются другие (договоры раньше актов)."""
    deps = {c: {f["target"][7:] for f in SCHEMAS[c]["fields"] if str(f.get("target", "")).startswith("object:")} for c in codes}
    out: list[str] = []
    while len(out) < len(codes):
        progressed = False
        for c in codes:
            if c not in out and deps[c] <= set(out) | (deps[c] - set(codes)):
                out.append(c)
                progressed = True
        if not progressed:
            out += [c for c in codes if c not in out]
    return out
