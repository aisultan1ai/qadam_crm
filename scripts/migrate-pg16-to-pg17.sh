#!/usr/bin/env bash
# Мигрирует данные существующего deployment'а qadam_crm с PostgreSQL 16 на 17.
#
# Что делает:
#   1. Останавливает всё, кроме db (чтобы никто не писал во время дампа).
#   2. Поднимает одноразовый postgres:16-alpine контейнер, привязанный к
#      существующему pgdata volume, и снимает pg_dumpall.
#   3. Проверяет размер дампа. Если >1 KB — просит подтверждение.
#   4. Удаляет старый pgdata volume.
#   5. Стартует новый db (уже с pg17 из docker-compose.prod.yml).
#   6. Восстанавливает дамп в новый кластер.
#   7. Запускает всё остальное.
#
# Требования:
#   - .env с POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
#   - Docker Compose v2
#   - В docker-compose.prod.yml УЖЕ прописан postgres:17-alpine
#   - Существующий volume от pg16
#
# Usage:
#   ./scripts/migrate-pg16-to-pg17.sh
#   FORCE=1 ./scripts/migrate-pg16-to-pg17.sh   # пропустить интерактивное подтверждение

set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/pg16-dump-${TIMESTAMP}.sql"
TMP_CONTAINER="qadam_crm_pg16_dump_tmp"

# ---------- Проверки окружения ----------

if [ ! -f .env ]; then
    echo "ERROR: .env не найден. Запусти из корня проекта."
    exit 1
fi

# shellcheck disable=SC1091
source .env
: "${POSTGRES_USER:?POSTGRES_USER не задан в .env}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD не задан в .env}"
: "${POSTGRES_DB:?POSTGRES_DB не задан в .env}"

if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: docker compose v2 не найден"
    exit 1
fi

# Проверить что compose уже переведён на pg17 (иначе скрипт не имеет смысла)
if ! grep -q "postgres:17" docker-compose.prod.yml; then
    echo "ERROR: docker-compose.prod.yml не содержит postgres:17"
    echo "       Сначала обнови compose до postgres:17-alpine, потом запусти этот скрипт."
    exit 1
fi

# ---------- Найти существующий pgdata volume ----------

echo "=== 1/7 Поиск существующего pgdata volume ==="
VOLUME_CANDIDATES=$(docker volume ls -q | grep -i pgdata | grep -v backup || true)
if [ -z "$VOLUME_CANDIDATES" ]; then
    echo "  pgdata volume не найден. Возможно, это чистая установка — миграция не нужна."
    echo "  Просто запусти: $COMPOSE up -d"
    exit 0
fi

VOLUME_COUNT=$(echo "$VOLUME_CANDIDATES" | wc -l)
if [ "$VOLUME_COUNT" -gt 1 ]; then
    echo "  Найдено несколько pgdata-volume — уточни вручную и передай через VOLUME_NAME env:"
    echo "$VOLUME_CANDIDATES"
    if [ -n "${VOLUME_NAME:-}" ]; then
        VOLUME=$VOLUME_NAME
    else
        exit 1
    fi
else
    VOLUME=$VOLUME_CANDIDATES
fi
echo "  Используем volume: $VOLUME"

# ---------- Остановка сервисов, кроме db ----------

echo
echo "=== 2/7 Останавливаю backend/celery/nginx ==="
$COMPOSE stop backend celery_worker celery_beat nginx certbot 2>/dev/null || true
$COMPOSE stop db 2>/dev/null || true

# Убедимся что нет висящих контейнеров с этим volume
docker rm -f "$TMP_CONTAINER" 2>/dev/null || true

# ---------- Дамп через одноразовый pg16 ----------

echo
echo "=== 3/7 Запуск временного postgres:16-alpine для дампа ==="
docker run -d --rm --name "$TMP_CONTAINER" \
    -v "$VOLUME":/var/lib/postgresql/data \
    -e POSTGRES_USER="$POSTGRES_USER" \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    -e POSTGRES_DB="$POSTGRES_DB" \
    postgres:16-alpine >/dev/null

echo "  Жду готовности..."
for i in {1..60}; do
    if docker exec "$TMP_CONTAINER" pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done
if ! docker exec "$TMP_CONTAINER" pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then
    echo "ERROR: не удалось поднять временный pg16 за 60с"
    docker logs "$TMP_CONTAINER" | tail -30
    docker rm -f "$TMP_CONTAINER"
    exit 1
fi

# Проверим что там правда PG16
ACTUAL_VER=$(docker exec "$TMP_CONTAINER" psql -U "$POSTGRES_USER" -tAc "SHOW server_version_num;")
if [ "${ACTUAL_VER:0:2}" != "16" ]; then
    echo "WARNING: version_num=$ACTUAL_VER — данные не в pg16."
    echo "  Если они уже в pg17, миграция не нужна. Остановлено."
    docker rm -f "$TMP_CONTAINER"
    exit 1
fi

echo
echo "=== 4/7 pg_dumpall → $BACKUP_FILE ==="
mkdir -p "$BACKUP_DIR"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$TMP_CONTAINER" \
    pg_dumpall -U "$POSTGRES_USER" --clean --if-exists > "$BACKUP_FILE"

# stat -c (GNU) или stat -f (BSD/macOS)
DUMP_SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
echo "  Размер дампа: $DUMP_SIZE байт"
if [ "$DUMP_SIZE" -lt 1024 ]; then
    echo "ERROR: дамп подозрительно маленький — что-то не так. Файл: $BACKUP_FILE"
    docker rm -f "$TMP_CONTAINER"
    exit 1
fi

docker rm -f "$TMP_CONTAINER" >/dev/null

# ---------- Подтверждение ----------

echo
echo "!!! ВНИМАНИЕ !!!"
echo "!!! Сейчас будет УДАЛЁН volume $VOLUME со всеми данными PG16."
echo "!!! Дамп в $BACKUP_FILE — из него восстановим в pg17."
echo "!!! На всякий случай сохрани этот файл в другое место."
echo

if [ "${FORCE:-0}" != "1" ]; then
    read -rp "Продолжить? Напиши 'yes': " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        echo "Отмена. Дамп остался: $BACKUP_FILE"
        exit 0
    fi
fi

# ---------- Удаление volume ----------

echo
echo "=== 5/7 Удаляю старый volume $VOLUME ==="
$COMPOSE rm -f db 2>/dev/null || true
docker volume rm "$VOLUME"

# ---------- Старт pg17 ----------

echo
echo "=== 6/7 Стартую postgres:17-alpine (создаст новый пустой volume) ==="
$COMPOSE up -d db
echo "  Жду готовности..."
for i in {1..60}; do
    if $COMPOSE exec -T db pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done
if ! $COMPOSE exec -T db pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then
    echo "ERROR: pg17 не запустился"
    $COMPOSE logs db | tail -30
    exit 1
fi

# ---------- Restore ----------

echo
echo "=== 7/7 Восстанавливаю дамп ==="
$COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
    psql -U "$POSTGRES_USER" -d postgres < "$BACKUP_FILE"

echo
echo "=== Перезапускаю все сервисы ==="
$COMPOSE up -d

echo
echo "=== ✓ Готово ==="
echo "Проверка версии:"
$COMPOSE exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT version();"
echo
echo "Бэкап сохранён: $BACKUP_FILE"
echo "Проверь работу CRM в браузере, потом можно удалить бэкап."
