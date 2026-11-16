#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

if [ ! -f ".env" ]; then
  echo "ERROR: .env file not found. Run ./install.sh first."
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

BACKUP_DIR="${PROJECT_DIR}/backups/mysql"
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
MYSQL_DB_VAL="${MYSQL_DATABASE:-task_management}"
MYSQL_USER_VAL="${MYSQL_USER:-taskadmin}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

SQL_GZ="${BACKUP_DIR}/mysql-${MYSQL_DB_VAL}-${STAMP}.sql.gz"
UPLOADS_TGZ="${BACKUP_DIR}/uploads-${STAMP}.tar.gz"
DATA_TGZ="${BACKUP_DIR}/data-${STAMP}.tar.gz"

echo "============================================================"
echo " RAC R&I Task Management - Creating Backup (${STAMP})"
echo "============================================================"

if ! $COMPOSE_CMD exec -T mysql mysqladmin ping -h 127.0.0.1 -u"${MYSQL_USER_VAL}" -p"${MYSQL_PASSWORD}" --silent >/dev/null 2>&1; then
  echo "ERROR: MySQL container is not running. Start services with ./start.sh first."
  exit 1
fi

echo "[1/4] Dumping MySQL database (${MYSQL_DB_VAL})..."
$COMPOSE_CMD exec -T mysql mysqldump \
  --single-transaction \
  --routines \
  --triggers \
  --no-tablespaces \
  -u"${MYSQL_USER_VAL}" \
  -p"${MYSQL_PASSWORD}" \
  "${MYSQL_DB_VAL}" | gzip > "$SQL_GZ"

if [ ! -s "$SQL_GZ" ] || ! gzip -t "$SQL_GZ" 2>/dev/null; then
  echo "ERROR: MySQL SQL backup failed or produced a corrupt archive!"
  rm -f "$SQL_GZ"
  exit 1
fi

if [ -d "${PROJECT_DIR}/uploads" ]; then
  echo "[2/4] Archiving uploaded files (attachments, themes, backgrounds)..."
  tar -czf "$UPLOADS_TGZ" -C "${PROJECT_DIR}" uploads
fi

if [ -d "${PROJECT_DIR}/data" ]; then
  echo "[3/4] Archiving local JSON mirror & permanent staff data..."
  tar -czf "$DATA_TGZ" -C "${PROJECT_DIR}" data
fi

echo "[4/4] Cleaning backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -type f \( -name "*.sql.gz" -o -name "*.tar.gz" \) -mtime +"${RETENTION_DAYS}" -delete || true

echo "------------------------------------------------------------"
echo " BACKUP COMPLETED SUCCESSFULLY"
echo "   MySQL Backup   : $SQL_GZ ($(du -h "$SQL_GZ" | awk '{print $1}'))"
if [ -f "$UPLOADS_TGZ" ]; then
  echo "   Uploads Backup : $UPLOADS_TGZ ($(du -h "$UPLOADS_TGZ" | awk '{print $1}'))"
fi
if [ -f "$DATA_TGZ" ]; then
  echo "   Data Backup    : $DATA_TGZ ($(du -h "$DATA_TGZ" | awk '{print $1}'))"
fi
echo "------------------------------------------------------------"
