# Qadam CRM — трекинг задач компании

**Qadam CRM** — современная CRM с гибкой ролевой моделью (RBAC), Kanban / таблица / список / календарь, комментариями, вложениями, аналитикой и realtime-уведомлениями.

Stack: **React + TypeScript + Tailwind CSS** • **FastAPI + SQLAlchemy 2.0 + Alembic** • **PostgreSQL 16** • **Redis 7** • **JWT (access + refresh)** • **WebSocket** • **Docker Compose**.

## Быстрый старт

```bash
# 1. создайте .env в корне (см. переменные ниже)
cp .env.example .env  # если файл-примера ещё нет, создайте вручную

# 2. поднимите стек
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend / Swagger: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
- PostgreSQL: `localhost:5432` (qadam_crm / qadam_crm / qadam_crm)
- Redis: `localhost:6379`

При первом запуске backend автоматически:
1. Ждёт готовности БД.
2. Приводит схему БД к актуальному состоянию:
   - пустая БД → `Base.metadata.create_all` + `alembic stamp head`;
   - БД без `alembic_version` → `stamp head`;
   - иначе → `alembic upgrade head` (если уже head — no-op).
3. Синхронизирует каталог разрешений (`PERMISSIONS`) в таблицу.
4. Создаёт роли `Администратор`, `Менеджер`, `Сотрудник` (только если их ещё нет).
5. Создаёт **единственного суперпользователя** из `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Если пароль не задан — генерируется случайный и **однократно** печатается в логи backend-контейнера.

Дополнительных демо-пользователей `manager@…` / `employee@…` **не создаётся** — заводите их через раздел «Пользователи» под администратором.

### Переменные окружения

Минимум для запуска (`.env` в корне репозитория):

```env
JWT_SECRET=<не менее 32 символов, не placeholder>
ADMIN_EMAIL=admin@qadam.local
ADMIN_PASSWORD=admin123    # опционально; если пусто — будет сгенерирован
```

Полный список (со значениями по умолчанию) — в `backend/app/config.py`. Наиболее важные:

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://qadam_crm:qadam_crm@db:5432/qadam_crm` | Подключение к Postgres |
| `REDIS_URL` | `redis://redis:6379/0` | Redis для rate limit, JWT blacklist, WS pub/sub |
| `JWT_SECRET` | — (**обязательно**, ≥ 32 символов) | Подпись JWT |
| `JWT_ACCESS_MINUTES` | `30` | TTL access-токена |
| `JWT_REFRESH_DAYS` | `30` | TTL refresh-токена |
| `LOGIN_RATE_LIMIT` | `5/minute` | Лимит попыток `/api/auth/login` |
| `CORS_ORIGINS` | `http://localhost:5173` | Через запятую |
| `UPLOAD_DIR` | `/app/uploads` | Каталог вложений (в контейнере) |
| `MAX_UPLOAD_BYTES` | `10 MiB` | Лимит на файл |
| `MAX_AVATAR_BYTES` | `5 MiB` | Лимит на аватар |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@qadam.local` / `None` | Начальный супер-админ |

### Первый вход

Если `ADMIN_PASSWORD` был задан — используйте его. Иначе смотрите в логи backend:

```bash
docker compose logs backend | grep -A3 "Создан администратор"
```

Дальше администратор создаёт пользователей и назначает им роли в веб-интерфейсе.

## Возможности

- **RBAC** — произвольные роли, чекбоксы прав по группам (Пользователи, Проекты, Задачи, Комментарии, Файлы, Аналитика, Настройки), копирование ролей, удаление только неиспользуемых.
- **Пользователи** — имя, email, пароль, несколько ролей, отдел, аватар, активация.
- **Проекты** — описание, ответственный, участники, дедлайн, архивирование.
- **Задачи** — статус (Новая / В работе / На проверке / Завершена / Отменена), приоритет (Низкий / Средний / Высокий / Критический), исполнитель, автор, дедлайн, чек-лист, комментарии, вложения, история изменений.
- **Представления**: Kanban с drag & drop, таблица, список, календарь.
- **Комментарии** с `@email` упоминаниями и уведомлениями, реакции-эмодзи.
- **Realtime-уведомления** через WebSocket (Redis pub/sub): назначение задачи, смена статуса, новый комментарий, упоминание.
- **Глобальный поиск** (`Ctrl+K`) по задачам, проектам, пользователям, комментариям.
- **Фильтры** — исполнитель, проект, статус, приоритет, только просроченные.
- **Аналитика** — общая сводка, задачи по статусам, эффективность сотрудников, экспорт CSV.
- **Автосохранение** описания задачи (по потере фокуса), inline-редактирование статуса/приоритета/исполнителя/дедлайна.
- **История действий** пользователя (activity log) — записывается для create/update/delete/bulk_update, отображается на Dashboard.
- **JWT-безопасность** — access + refresh с ротацией, blacklist через Redis, rate limit на логине/refresh.
- **HTTP security** — CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy.
- **UI/UX** — минималистичный, тёмная и светлая темы, плавные анимации, круглые карточки, аккуратные таблицы.
- **REST API + Swagger** — `/docs` (OpenAPI 3), `/redoc`.

## Структура

```
qadam_crm/
├── docker-compose.yml
├── docker-compose.prod.yml
├── nginx/
├── backend/
│   ├── Dockerfile
│   ├── alembic.ini
│   ├── alembic/               — миграции
│   ├── requirements.txt
│   └── app/
│       ├── main.py            — FastAPI, CORS, security headers (включая CSP), роутеры
│       ├── bootstrap.py       — wait_for_db + миграции + seed permissions/roles/admin
│       ├── config.py          — pydantic-settings
│       ├── database.py        — SQLAlchemy Session
│       ├── core/
│       │   ├── security.py    — JWT access/refresh, bcrypt, blacklist
│       │   ├── permissions.py — каталог прав + проверка
│       │   ├── errors.py      — централизованные обработчики
│       │   ├── limiter.py     — SlowAPI (Redis-backed)
│       │   ├── redis_client.py
│       │   ├── scheduler.py   — APScheduler (напоминания и т.п.)
│       │   └── ws_hub.py      — WebSocket-хаб поверх Redis pub/sub
│       ├── models/            — SQLAlchemy 2.0 модели
│       ├── schemas/           — Pydantic-схемы
│       └── api/
│           ├── deps.py          — get_current_user, require(*codes), log_action
│           ├── auth.py          — login, refresh, logout, /me
│           ├── roles.py         — CRUD ролей, permissions, copy
│           ├── users.py         — CRUD пользователей, отделы, аватары
│           ├── projects.py      — CRUD проектов + архив
│           ├── tasks.py         — CRUD задач, bulk, checklist
│           ├── comments.py      — комментарии + @упоминания + реакции
│           ├── attachments.py   — upload / download / delete
│           ├── notifications.py — список / прочитано
│           ├── analytics.py     — dashboard + сотрудники
│           ├── search.py        — глобальный поиск
│           └── ws.py            — WebSocket-эндпоинт
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    └── src/
        ├── main.tsx / App.tsx     — lazy-роуты, Protected
        ├── api/client.ts          — axios + JWT + авто-refresh
        ├── store/{auth,theme}.ts  — zustand
        ├── components/            — Layout, GlobalSearch, Toast, Skeleton, Logo, ui.tsx
        └── pages/
            ├── Login.tsx
            ├── Dashboard.tsx
            ├── Projects.tsx / ProjectDetail.tsx
            ├── Tasks.tsx / TaskDetail.tsx (Kanban / Table / List / Calendar)
            ├── Users.tsx
            ├── Analytics.tsx
            ├── Settings.tsx
            └── Profile.tsx
```

## Локальная разработка без Docker

Backend:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export DATABASE_URL=postgresql+psycopg://qadam_crm:qadam_crm@localhost:5432/qadam_crm
export REDIS_URL=redis://localhost:6379/0
export JWT_SECRET=$(python -c "import secrets;print(secrets.token_urlsafe(48))")
export ADMIN_EMAIL=admin@qadam.local
export ADMIN_PASSWORD=admin123

python -m app.bootstrap
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Для полноценной работы нужны запущенные локально Postgres и Redis (проще всего поднять только их через `docker compose up db redis`).

## Миграции

Схема хранится в `backend/alembic/`. При обычном запуске `bootstrap.py` сам делает `upgrade head`. Для ручной работы:

```bash
cd backend
alembic revision --autogenerate -m "add xyz"
alembic upgrade head
alembic downgrade -1
```

## Расширение

- Список разрешений хранится в `backend/app/core/permissions.py` — добавьте код в `PERMISSIONS`, пересоберите — при старте новые пункты автоматически синхронизируются в БД.
- Для продакшена: используйте `docker-compose.prod.yml` + `nginx/`, вынесите `JWT_SECRET` и `ADMIN_PASSWORD` в secrets manager, включите HTTPS, ужесточите CSP (убрать `'unsafe-inline'` после отключения Swagger UI в prod), настройте `CORS_ORIGINS`.
- Хранение файлов вынесено в volume `qadam_crm_uploads`; можно легко заменить на S3/MinIO — трогается только `app/api/attachments.py`.
- Realtime-уведомления уже реализованы через WebSocket + Redis pub/sub (`core/ws_hub.py`, `api/ws.py`).

## Лицензия

MIT
