#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "============================================================"
echo " RAC R&I Task Management Software - Starting Services"
echo "============================================================"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is not installed."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "ERROR: Docker Compose is not installed."
  exit 1
fi

mkdir -p data backups/mysql uploads/attachments

if [ ! -f ".env" ]; then
  echo "ERROR: .env file not found. Run ./install.sh first to configure your environment."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

HTTP_PORT_VAL="${HTTP_PORT:-80}"
MYSQL_DB_VAL="${MYSQL_DATABASE:-task_management}"
MYSQL_USER_VAL="${MYSQL_USER:-taskadmin}"

echo "[1/3] Starting MySQL, App, and Nginx containers..."
$COMPOSE_CMD up -d

echo "[2/3] Waiting for database and application health..."
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${HTTP_PORT_VAL}/api/system/db-status" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl -fsS "http://127.0.0.1:${HTTP_PORT_VAL}/api/system/db-status" >/dev/null 2>&1; then
  echo "WARNING: Application did not respond on port ${HTTP_PORT_VAL} within 80s."
  echo "Check logs with: $COMPOSE_CMD logs -f app mysql nginx"
  exit 1
fi

echo "[3/3] Checking MySQL initial data..."
USER_COUNT="$($COMPOSE_CMD exec -T mysql mysql -u"${MYSQL_USER_VAL}" -p"${MYSQL_PASSWORD}" -N -B -e "SELECT COUNT(*) FROM ${MYSQL_DB_VAL}.users;" 2>/dev/null || echo "0")"
if [ "${USER_COUNT:-0}" = "0" ] && [ -f "data/db.json" ]; then
  echo "      Importing initial data from data/db.json into MySQL..."
  $COMPOSE_CMD exec -T app npx tsx scripts/migrate-firestore-to-mysql.ts --source=file --file=data/db.json
fi

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
LAN_IP="${LAN_IP:-127.0.0.1}"

echo "------------------------------------------------------------"
if [ "$HTTP_PORT_VAL" = "80" ]; then
  echo " Office LAN URL : http://${LAN_IP}"
  echo " Local URL      : http://localhost"
else
  echo " Office LAN URL : http://${LAN_IP}:${HTTP_PORT_VAL}"
  echo " Local URL      : http://localhost:${HTTP_PORT_VAL}"
fi
echo " MySQL Database : ${MYSQL_DB_VAL} (Internal Docker network only)"
echo "------------------------------------------------------------"
