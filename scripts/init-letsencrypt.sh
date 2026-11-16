#!/usr/bin/env bash
# Первичное получение TLS-сертификата Let's Encrypt для qadam_crm.
# Запускается ОДИН РАЗ на новом сервере перед первым `docker compose up`.
#
# Требования:
#   - Домен уже указывает A/AAAA-записями на этот сервер
#   - Порты 80 и 443 открыты
#   - .env создан (для docker-compose переменных)
#
# Usage:
#   DOMAIN=qadam.kz EMAIL=admin@qadam.kz ./scripts/init-letsencrypt.sh
#   DOMAIN=qadam.kz EMAIL=admin@qadam.kz STAGING=1 ./scripts/init-letsencrypt.sh   # тест на staging Let's Encrypt

set -euo pipefail

DOMAIN="${DOMAIN:-qadam.kz}"
EMAIL="${EMAIL:?EMAIL is required for Let's Encrypt registration}"
STAGING="${STAGING:-0}"

# Основной домен + wildcard для тенантов (*.qadam.kz).
# Wildcard требует DNS-01 challenge — Let's Encrypt HTTP-01 wildcard'ы не выдаёт.
# Для MVP берём только apex + www; wildcard — отдельная задача с DNS-провайдером.
DOMAINS=(-d "$DOMAIN" -d "www.$DOMAIN")

DATA_PATH="./certbot-init"
COMPOSE="docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml"

echo "### Проверка docker compose доступности..."
$COMPOSE version >/dev/null

echo "### Создание dummy-сертификата (чтобы nginx стартовал до реального сертификата)..."
mkdir -p "$DATA_PATH/conf/live/$DOMAIN"
$COMPOSE run --rm --entrypoint "sh -c '\
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
    -out    /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
    -subj \"/CN=localhost\"'" certbot

echo "### Запуск nginx с dummy-сертификатом..."
$COMPOSE up -d nginx
sleep 5

echo "### Удаление dummy-сертификата..."
$COMPOSE run --rm --entrypoint "sh -c '\
  rm -rf /etc/letsencrypt/live/$DOMAIN && \
  rm -rf /etc/letsencrypt/archive/$DOMAIN && \
  rm -rf /etc/letsencrypt/renewal/$DOMAIN.conf'" certbot

echo "### Запрос настоящего сертификата от Let's Encrypt..."
STAGING_ARG=""
if [ "$STAGING" != "0" ]; then
  echo "  (STAGING mode — сертификат будет от staging Let's Encrypt, не доверенный)"
  STAGING_ARG="--staging"
fi

$COMPOSE run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    $STAGING_ARG \
    --email $EMAIL \
    ${DOMAINS[@]} \
    --rsa-key-size 4096 \
    --agree-tos \
    --no-eff-email \
    --force-renewal" certbot

echo "### Reload nginx с реальным сертификатом..."
$COMPOSE exec nginx nginx -s reload

echo ""
echo "### Готово. Сертификат для $DOMAIN получен."
echo "### Обнови .env: APP_ENV=production, COOKIE_SECURE=true, CORS_ORIGINS=https://$DOMAIN"
echo "### Убери ALLOW_INSECURE_PROD=true если он был."
echo "### Полный перезапуск: $COMPOSE up -d"
