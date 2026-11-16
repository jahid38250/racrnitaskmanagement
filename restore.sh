#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

BACKUP_DIR="${PROJECT_DIR}/backups/mysql"

if [ $# -lt 1 ]; then
  echo "Usage: ./restore.sh <path-to-mysql-backup.sql.gz> [path-to-uploads.tar.gz]"
  echo ""
  echo "Available MySQL backups in ${BACKUP_DIR}:"
  ls -lh "${BACKUP_DIR}/"mysql-*.sql.gz 2>/dev/null || echo "  (No backups found yet. Run ./backup.sh to create one.)"
  exit 1
fi

SQL_BACKUP="$1"
UPLOADS_BACKUP="${2:-}"

if [ ! -f "$SQL_BACKUP" ]; then
  echo "ERROR: SQL backup file not found: $SQL_BACKUP"
  exit 1
fi

# Auto-detect matching uploads-<timestamp>.tar.gz if second argument omitted
if [ -z "$UPLOADS_BACKUP" ]; then
  BASE_NAME="$(basename "$SQL_BACKUP")"
  if [[ "$BASE_NAME" =~ ([0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}) ]]; then
    CANDIDATE_UPLOADS="${BACKUP_DIR}/uploads-${BASH_REMATCH[1]}.tar.gz"
    if [ -f "$CANDIDATE_UPLOADS" ]; then
      UPLOADS_BACKUP="$CANDIDATE_UPLOADS"
    fi
  fi
fi

if [ ! -f ".env" ]; then
  echo "ERROR: .env file not found."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "ERROR: Docker Compose is not installed."
  exit 1
fi

MYSQL_DB_VAL="${MYSQL_DATABASE:-task_management}"
MYSQL_USER_VAL="${MYSQL_USER:-taskadmin}"

echo "============================================================"
echo " RAC R&I Task Management - Restoring Backup"
echo "============================================================"

if ! $COMPOSE_CMD exec -T mysql mysqladmin ping -h 127.0.0.1 -u"${MYSQL_USER_VAL}" -p"${MYSQL_PASSWORD}" --silent >/dev/null 2>&1; then
  echo "ERROR: MySQL container is not running. Start services with ./start.sh first."
  exit 1
fi

echo "[1/4] Creating pre-restore safety backup..."
"${PROJECT_DIR}/backup.sh" >/dev/null 2>&1 || echo "      (Skipped pre-restore backup)"

echo "[2/4] Restoring MySQL database (${MYSQL_DB_VAL}) from ${SQL_BACKUP}..."
if [[ "$SQL_BACKUP" == *.gz ]]; then
  gunzip -c "$SQL_BACKUP" | $COMPOSE_CMD exec -T mysql mysql \
    -u"${MYSQL_USER_VAL}" \
    -p"${MYSQL_PASSWORD}" \
    "${MYSQL_DB_VAL}"
else
  cat "$SQL_BACKUP" | $COMPOSE_CMD exec -T mysql mysql \
    -u"${MYSQL_USER_VAL}" \
    -p"${MYSQL_PASSWORD}" \
    "${MYSQL_DB_VAL}"
fi

if [ -n "$UPLOADS_BACKUP" ] && [ -f "$UPLOADS_BACKUP" ]; then
  echo "[3/4] Restoring uploaded files from ${UPLOADS_BACKUP}..."
  tar -xzf "$UPLOADS_BACKUP" -C "${PROJECT_DIR}"
else
  echo "[3/4] No uploads archive specified/matched; keeping current uploads/ directory."
fi

echo "[4/4] Restarting application container to reload restored MySQL state..."
$COMPOSE_CMD restart app

echo "------------------------------------------------------------"
echo " RESTORE COMPLETED SUCCESSFULLY"
echo "   Database Restored : ${SQL_BACKUP}"
if [ -n "$UPLOADS_BACKUP" ] && [ -f "$UPLOADS_BACKUP" ]; then
  echo "   Uploads Restored  : ${UPLOADS_BACKUP}"
fi
echo "------------------------------------------------------------"
