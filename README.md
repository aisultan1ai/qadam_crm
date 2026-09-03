# Qadam CRM

Полноценная SaaS-CRM: RBAC, задачи/проекты, лиды и роутинг, омниканал (Telegram/WhatsApp/Instagram), почта, база знаний, календарь, букинг, тайм-трекинг, HR-профили, автоматизации и интеграция с Google Calendar.

**Stack:** React + TypeScript + Tailwind • FastAPI + SQLAlchemy 2 + Alembic • PostgreSQL • Redis + Celery • WebSocket • Nginx • Docker Compose.

Мульти-тенант, per-user WebSocket, Celery Beat, шифрование секретов (Fernet), HTTPS через Let's Encrypt.

## Быстрый старт (Docker)

Проект запускается только в Docker — локальный dev-режим не поддерживается.

```bash
# 1. Скопировать шаблон окружения и сгенерировать сильные секреты
cp .env.example .env
python scripts/gen_secrets.py --merge .env

# 2. Открыть .env и задать значения (CORS_ORIGINS, ADMIN_EMAIL, APP_ENV и т.д.)
#    — все нужные ключи и комментарии уже в .env.example

# 3. Поднять стек
docker compose -f docker-compose.prod.yml up -d

# 4. Смотреть логи первого запуска (миграции + создание админа)
docker compose -f docker-compose.prod.yml logs -f backend
```

После старта:
- Приложение — `http://localhost` (nginx на 80)
- Health-проба — `http://localhost/health`

## Первый вход

При первом старте backend автоматически:
1. Ждёт готовности БД
2. Прогоняет миграции Alembic до последней ревизии
3. Сидит роли и permissions
4. Создаёт единственного суперпользователя из `ADMIN_EMAIL` (пароль — из `ADMIN_PASSWORD`, либо генерируется и **один раз** печатается в лог)

Если пароль не задавали — найдите его в логе:
```bash
docker compose -f docker-compose.prod.yml logs backend | grep -A3 "Создан администратор"
```

После первого входа смените пароль в UI и уберите `ADMIN_PASSWORD` из `.env`.

## Обновление кода

```bash
git pull
docker compose -f docker-compose.prod.yml build backend frontend
docker compose -f docker-compose.prod.yml up -d
# Миграции применятся автоматически при старте backend
```

## Production-развёртывание

Полная инструкция (HTTPS через certbot, wildcard-домен для тенантов на поддоменах, апгрейд PostgreSQL 16→17, апгрейд Python, бэкапы) — в [docs/DEPLOY.md](docs/DEPLOY.md).

## Возможности

**Ядро (RBAC + задачи + проекты)**
- Гибкая ролевая модель с чекбоксами прав по группам, копирование ролей
- Мультитенант с поддоменами, приглашения, брендинг per-tenant (лого, primary color)
- Задачи: Kanban / таблица / список / календарь, чек-листы, вложения, комментарии с @упоминаниями и реакциями
- Realtime через WebSocket (Redis pub/sub)
- Глобальный поиск (Ctrl+K), фильтры, аналитика с экспортом CSV
- History/activity log

**Модули**
- **M1 Автоматизации** — визуальный конструктор (React Flow), 8 типов действий, отложенные шаги через Celery
- **M2 Роутинг лидов** — 4 стратегии распределения, расписание менеджеров
- **M3 Открытые линии** — Telegram / WhatsApp / Instagram: webhook, unified inbox, auto-reply, шаблоны
- **M4 Почта** — IMAP + SMTP per-user, threading, шифрование паролей (Fernet)
- **M6 База знаний** — Markdown-статьи, wiki-ссылки `[[…]]`, версии, комментарии, полнотекстовый поиск (tsvector). **Импорт из Excel/Word** с картинками
- **M7 Календарь** — события, RRULE, участники, напоминания через Celery Beat, ICS-подписка
- **M8 Букинг** — Calendly-style публичные страницы слотов, round-robin/least-busy команды
- **M11 HR-профили** — скиллы / цели / 1-on-1 / кудос, OrgChart (React Flow), виджеты Dashboard. Скиллы и цели — строго персональные (только владелец редактирует)
- **M12 Google Calendar** — OAuth2 per user, автосинхронизация через Celery Beat. **Credentials задаёт owner компании в UI** (per-tenant), не через env

## Структура

```
qadam_crm/
├── docker-compose.prod.yml    — основной prod-стек (nginx + backend + celery + db + redis)
├── docker-compose.tls.yml     — override для HTTPS (certbot)
├── nginx/                     — конфиги (HTTP + HTTPS варианты)
├── scripts/
│   ├── gen_secrets.py             — генерация сильных секретов
│   ├── init-letsencrypt.sh        — первичный TLS-сертификат
│   └── migrate-pg16-to-pg17.sh    — апгрейд PostgreSQL
├── docs/DEPLOY.md             — полная инструкция по деплою
├── backend/
│   ├── Dockerfile
│   ├── alembic/versions/      — миграции 0001…0024
│   ├── requirements.txt
│   └── app/
│       ├── main.py, bootstrap.py, config.py, database.py
│       ├── core/              — security, permissions, celery_app, ws_hub, secrets (Fernet), redis_client
│       ├── models/            — SQLAlchemy 2.0 модели по всем модулям
│       ├── schemas/           — Pydantic
│       ├── services/          — бизнес-логика (mail, wiki, calendar, google_calendar, …)
│       ├── tasks/             — Celery-задачи (email, mail sync, calendar reminders, google sync, …)
│       └── api/               — REST endpoints (auth, users, tasks, wiki, calendar, integrations_google, …)
└── frontend/
    ├── Dockerfile.prod        — multi-stage build с nginx
    ├── vite.config.ts, tailwind.config.js
    └── src/
        ├── App.tsx            — lazy-роуты
        ├── api/client.ts      — axios + JWT + авто-refresh
        ├── store/             — zustand (auth, theme, sidebar)
        ├── components/        — Layout, GlobalSearch, Toast, Confirm, ErrorBoundary, ui.tsx
        └── pages/             — Dashboard, Tasks, Projects, Wiki, Calendar, Mail, Inbox, People, Settings, …
```

## Миграции

Автоматически применяются при старте backend. Для ручных операций (rare):

```bash
# Создать новую миграцию (после изменения моделей)
docker compose -f docker-compose.prod.yml exec backend alembic revision --autogenerate -m "add xyz"

# Применить / откатить
docker compose -f docker-compose.prod.yml exec backend alembic upgrade head
docker compose -f docker-compose.prod.yml exec backend alembic downgrade -1
```

## Расширение

- **Разрешения:** каталог в `backend/app/core/permissions.py` — добавь код в `PERMISSIONS`, пересобери — синхронизируется в БД при старте
- **Новые модули:** модель в `models/`, схемы в `schemas/`, endpoint в `api/`, регистрация в `main.py`, миграция в `alembic/versions/`
- **Celery-задачи:** новый файл в `tasks/`, добавь модуль в `celery_app.include`, для периодических — в `beat_schedule`
- **Storage:** файлы в volume `qadam_crm_uploads` (per-tenant подпапки). Замена на S3/MinIO — точечно в `app/api/attachments.py`

## Лицензия

MIT
