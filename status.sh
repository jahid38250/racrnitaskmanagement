#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "ERROR: Docker Compose is not installed."
  exit 1
fi

HTTP_PORT_VAL="${HTTP_PORT:-80}"
MYSQL_DB_VAL="${MYSQL_DATABASE:-task_management}"
MYSQL_USER_VAL="${MYSQL_USER:-taskadmin}"
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
LAN_IP="${LAN_IP:-127.0.0.1}"

echo "====================================================================="
echo " RAC R&I Task Management Software - System Status"
echo "====================================================================="

echo ""
echo "[1] Docker Containers:"
$COMPOSE_CMD ps

echo ""
echo "[2] Web Application & LAN URLs:"
if [ "$HTTP_PORT_VAL" = "80" ]; then
  echo "    Office LAN URL : http://${LAN_IP}"
  echo "    Local URL      : http://localhost"
else
  echo "    Office LAN URL : http://${LAN_IP}:${HTTP_PORT_VAL}"
  echo "    Local URL      : http://localhost:${HTTP_PORT_VAL}"
fi

HEALTH_JSON="$(curl -fsS "http://127.0.0.1:${HTTP_PORT_VAL}/api/system/db-status" 2>/dev/null || true)"
if [ -n "$HEALTH_JSON" ]; then
  echo "    Health API     : OK (${HEALTH_JSON})"
else
  echo "    Health API     : NOT RESPONDING on port ${HTTP_PORT_VAL}"
fi

echo ""
echo "[3] MySQL Database (${MYSQL_DB_VAL}):"
if [ -n "${MYSQL_PASSWORD:-}" ] && $COMPOSE_CMD exec -T mysql mysqladmin ping -h 127.0.0.1 -u"${MYSQL_USER_VAL}" -p"${MYSQL_PASSWORD}" --silent >/dev/null 2>&1; then
  echo "    MySQL Status   : HEALTHY (Internal network only)"
  COUNTS="$($COMPOSE_CMD exec -T mysql mysql -u"${MYSQL_USER_VAL}" -p"${MYSQL_PASSWORD}" -N -B -e "
    SELECT CONCAT(
      'users=', (SELECT COUNT(*) FROM ${MYSQL_DB_VAL}.users),
      ', tasks=', (SELECT COUNT(*) FROM ${MYSQL_DB_VAL}.tasks),
      ', attendance=', (SELECT COUNT(*) FROM ${MYSQL_DB_VAL}.attendance_records),
      ', attachments=', (SELECT COUNT(*) FROM ${MYSQL_DB_VAL}.task_attachments),
      ', departments=', (SELECT COUNT(*) FROM ${MYSQL_DB_VAL}.departments),
      ', projects=', (SELECT COUNT(*) FROM ${MYSQL_DB_VAL}.projects)
    );" 2>/dev/null || echo "unavailable")"
  echo "    Record Counts  : ${COUNTS}"
else
  echo "    MySQL Status   : STOPPED or UNREACHABLE"
fi

echo ""
echo "[4] Storage & Latest Backup:"
echo "    Uploads size   : $(du -sh uploads 2>/dev/null | awk '{print $1}' || echo '0')"
echo "    Backups size   : $(du -sh backups 2>/dev/null | awk '{print $1}' || echo '0')"
LATEST_SQL="$(ls -t backups/mysql/mysql-*.sql.gz 2>/dev/null | head -n 1 || true)"
if [ -n "$LATEST_SQL" ]; then
  echo "    Latest SQL Bak : ${LATEST_SQL} ($(du -h "$LATEST_SQL" | awk '{print $1}'))"
else
  echo "    Latest SQL Bak : None yet (run ./backup.sh)"
fi
echo "====================================================================="
