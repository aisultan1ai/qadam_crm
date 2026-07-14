# Qadam CRM — трекинг задач компании

**Qadam CRM** — современная CRM с гибкой ролевой моделью (RBAC), Kanban / таблица / список / календарь, комментариями, вложениями, аналитикой и уведомлениями.

Stack: **React + TypeScript + Tailwind CSS** • **FastAPI + SQLAlchemy 2.0** • **PostgreSQL** • **JWT** • **Docker Compose**.

## Быстрый старт

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend / Swagger: http://localhost:8000/docs
- PostgreSQL: `localhost:5432` (qadam_crm / qadam_crm / qadam_crm)

При первом запуске backend автоматически:
1. Ждёт готовности БД
2. Создаёт схему (`Base.metadata.create_all`)
3. Синхронизирует список разрешений
4. Создаёт роли `Администратор`, `Менеджер`, `Сотрудник`
5. Создаёт демо-пользователей и демо-проект с задачами

### Демо-аккаунты

| Роль | Email | Пароль |
|------|-------|--------|
| Администратор | `admin@qadam.local` | `admin123` |
| Менеджер | `manager@qadam.local` | `manager123` |
| Сотрудник | `employee@qadam.local` | `employee123` |

## Возможности

- **RBAC** — произвольные роли, чекбоксы прав по группам (Пользователи, Проекты, Задачи, Комментарии, Файлы, Аналитика, Настройки), копирование ролей, удаление только неиспользуемых.
- **Пользователи** — имя, email, пароль, несколько ролей, отдел, активность.
- **Проекты** — описание, ответственный, участники, дедлайн, архивирование.
- **Задачи** — статус (Новая / В работе / На проверке / Завершена / Отменена), приоритет (Низкий / Средний / Высокий / Критический), исполнитель, автор, дедлайн, чек-лист, комментарии, вложения, история изменений.
- **Представления**: Kanban с drag & drop, таблица, список, календарь.
- **Комментарии** с `@email` упоминаниями и уведомлениями.
- **Уведомления** — назначение задачи, смена статуса, новый комментарий, упоминание.
- **Глобальный поиск** (`Ctrl+K`) по задачам, проектам, пользователям, комментариям.
- **Фильтры** — исполнитель, проект, статус, приоритет, только просроченные.
- **Аналитика** — общая сводка, задачи по статусам, эффективность сотрудников, экспорт CSV.
- **Автосохранение** описания задачи (по потере фокуса), inline-редактирование статуса/приоритета/исполнителя/дедлайна.
- **История действий** пользователя (activity log) с последними изменениями на Dashboard.
- **UI/UX** — минималистичный, тёмная и светлая темы, плавные анимации, круглые карточки, аккуратные таблицы, современная типографика.
- **REST API + Swagger** — `/docs` (OpenAPI 3), `/redoc`.

## Структура

```
qadam_crm/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py             — FastAPI + маршруты + CORS
│       ├── bootstrap.py        — авто-создание схемы + seed
│       ├── config.py           — pydantic-settings
│       ├── database.py         — SQLAlchemy Session
│       ├── core/
│       │   ├── security.py     — JWT + bcrypt
│       │   └── permissions.py  — каталог прав + проверка
│       ├── models/             — SQLAlchemy 2.0 модели
│       ├── schemas/            — Pydantic-схемы
│       └── api/
│           ├── deps.py          — get_current_user, require(*codes), log_action
│           ├── auth.py          — login, /me
│           ├── roles.py         — CRUD ролей, permissions, copy
│           ├── users.py         — CRUD пользователей, отделы
│           ├── projects.py      — CRUD проектов + архив
│           ├── tasks.py         — CRUD задач, bulk, checklist
│           ├── comments.py      — комментарии + @упоминания
│           ├── attachments.py   — upload / download / delete
│           ├── notifications.py — список / прочитано
│           ├── analytics.py     — dashboard + сотрудники
│           └── search.py        — глобальный поиск
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    └── src/
        ├── main.tsx / App.tsx
        ├── api/client.ts        — axios + JWT
        ├── store/{auth,theme}.ts — zustand
        ├── components/          — Layout, GlobalSearch, ui.tsx
        └── pages/
            ├── Login.tsx
            ├── Dashboard.tsx
            ├── Projects.tsx / ProjectDetail.tsx
            ├── Tasks.tsx / TaskDetail.tsx (Kanban / Table / List / Calendar)
            ├── Users.tsx
            ├── Analytics.tsx
            └── Settings.tsx
```

## Локальная разработка без Docker

Backend:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql+psycopg://qadam_crm:qadam_crm@localhost:5432/qadam_crm
python -m app.bootstrap
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Расширение

- Список разрешений хранится в `backend/app/core/permissions.py` — добавьте код в `PERMISSIONS`, пересоберите — при старте новые пункты автоматически синхронизируются в БД.
- Для продакшена: замените `Base.metadata.create_all` на Alembic-миграции, вынесите `JWT_SECRET` в secrets manager, включите HTTPS и настройте `CORS_ORIGINS`.
- Хранение файлов вынесено в volume `qadam_crm_uploads`; можно легко заменить на S3/MinIO — трогается только `app/api/attachments.py`.
- Для realtime-уведомлений можно добавить WebSocket-хаб поверх текущего REST.

## Лицензия

MIT
