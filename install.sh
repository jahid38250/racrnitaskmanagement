#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "====================================================================="
echo " RAC R&I Task Management Software - One-Click LAN Deployment Setup"
echo " Environment: Ubuntu Linux + Docker + MySQL 8 + Nginx"
echo "====================================================================="

# ---------------------------------------------------------------------
# 1. Check Docker & Docker Compose installation
# ---------------------------------------------------------------------
echo "[1/7] Checking Docker installation..."
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is not installed on this Ubuntu server."
  echo "Install Docker first with:"
  echo "  curl -fsSL https://get.docker.com | sudo sh"
  echo "  sudo usermod -aG docker \$USER"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon is not running or permission denied."
  echo "Try: sudo systemctl enable --now docker"
  echo "And if needed: sudo usermod -aG docker \$USER (then re-login)"
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "ERROR: Docker Compose is not installed."
  echo "Install plugin: sudo apt-get update && sudo apt-get install -y docker-compose-plugin"
  exit 1
fi
echo "      OK: $(docker --version) | $($COMPOSE_CMD version)"

# ---------------------------------------------------------------------
# 2. Check required system tools & project files
# ---------------------------------------------------------------------
echo "[2/7] Checking required dependencies and project structure..."
MISSING_PKGS=()
for cmd in curl tar gzip openssl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    MISSING_PKGS+=("$cmd")
  fi
done

if [ "${#MISSING_PKGS[@]}" -gt 0 ]; then
  echo "      Installing missing tools: ${MISSING_PKGS[*]}..."
  if command -v apt-get >/dev/null 2>&1 && [ "$(id -u)" -eq 0 -o -n "$(command -v sudo || true)" ]; then
    sudo apt-get update -qq && sudo apt-get install -y -qq "${MISSING_PKGS[@]}"
  else
    echo "ERROR: Please install missing tools: ${MISSING_PKGS[*]}"
    exit 1
  fi
fi

REQUIRED_FILES=(
  "Dockerfile"
  "docker-compose.yml"
  "docker/mysql/init.sql"
  "docker/mysql/my.cnf"
  "docker/nginx/nginx.conf"
  ".env.example"
  "package.json"
  "server.ts"
  "mysqlDb.ts"
)
for rf in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$rf" ]; then
    echo "ERROR: Required deployment file missing: $rf"
    exit 1
  fi
done

mkdir -p data backups/mysql uploads/attachments
chmod +x "$PROJECT_DIR"/*.sh "$PROJECT_DIR"/scripts/*.sh 2>/dev/null || true
echo "      OK: All dependencies and project files verified."

# ---------------------------------------------------------------------
# 3. Configure environment (.env) with secure generated passwords
# ---------------------------------------------------------------------
echo "[3/7] Configuring environment (.env)..."
generate_pw() {
  openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c "${1:-28}"
}

if [ ! -f ".env" ]; then
  MYSQL_PW_GEN="$(generate_pw 28)"
  MYSQL_ROOT_GEN="$(generate_pw 32)"
  JWT_GEN="$(openssl rand -hex 32)"
  cat > .env <<EOF
SERVER_HOST=0.0.0.0
HTTP_PORT=80
PORT=3000
APP_URL=http://0.0.0.0:80
TZ=Asia/Dhaka
JWT_SECRET=${JWT_GEN}
MYSQL_HOST=mysql
MYSQL_PORT=3306
MYSQL_DATABASE=task_management
MYSQL_USER=taskadmin
MYSQL_PASSWORD=${MYSQL_PW_GEN}
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_GEN}
BACKUP_RETENTION_DAYS=30
EOF
  chmod 600 .env
  echo "      Created .env with cryptographically generated credentials."
else
  echo "      Using existing .env configuration."
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

HTTP_PORT_VAL="${HTTP_PORT:-80}"
SERVER_HOST_VAL="${SERVER_HOST:-0.0.0.0}"
MYSQL_DB_VAL="${MYSQL_DATABASE:-task_management}"
MYSQL_USER_VAL="${MYSQL_USER:-taskadmin}"

if [ -z "${MYSQL_PASSWORD:-}" ] || [[ "${MYSQL_PASSWORD}" == *"replace-with"* ]]; then
  echo "ERROR: MYSQL_PASSWORD in .env is missing or still a placeholder."
  exit 1
fi

# Validate Compose config cleanly
$COMPOSE_CMD config -q
echo "      OK: Environment and docker-compose.yml validated."

# ---------------------------------------------------------------------
# 4. Build application Docker image
# ---------------------------------------------------------------------
echo "[4/7] Building application container image..."
$COMPOSE_CMD build

# ---------------------------------------------------------------------
# 5. Start all Docker containers (MySQL, App, Nginx)
# ---------------------------------------------------------------------
echo "[5/7] Starting MySQL, Node.js Application, and Nginx containers..."
$COMPOSE_CMD up -d

echo "      Waiting for MySQL container to become healthy..."
for i in $(seq 1 45); do
  if $COMPOSE_CMD exec -T mysql mysqladmin ping -h 127.0.0.1 -u"${MYSQL_USER_VAL}" -p"${MYSQL_PASSWORD}" --silent >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! $COMPOSE_CMD exec -T mysql mysqladmin ping -h 127.0.0.1 -u"${MYSQL_USER_VAL}" -p"${MYSQL_PASSWORD}" --silent >/dev/null 2>&1; then
  echo "ERROR: MySQL container failed health check. Inspect logs with: $COMPOSE_CMD logs mysql"
  exit 1
fi

echo "      Waiting for web service on port ${HTTP_PORT_VAL}..."
for i in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:${HTTP_PORT_VAL}/api/system/db-status" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl -fsS "http://127.0.0.1:${HTTP_PORT_VAL}/api/system/db-status" >/dev/null 2>&1; then
  echo "ERROR: Web service did not become ready on port ${HTTP_PORT_VAL}. Inspect logs with: $COMPOSE_CMD logs app nginx"
  exit 1
fi

# ---------------------------------------------------------------------
# 6. Initialize MySQL schema & migrate initial production records
# ---------------------------------------------------------------------
echo "[6/7] Initializing MySQL database (${MYSQL_DB_VAL})..."
$COMPOSE_CMD exec -T app npx tsx scripts/init-mysql-db.ts

USER_COUNT="$($COMPOSE_CMD exec -T mysql mysql -u"${MYSQL_USER_VAL}" -p"${MYSQL_PASSWORD}" -N -B -e "SELECT COUNT(*) FROM ${MYSQL_DB_VAL}.users;" 2>/dev/null || echo "0")"
if [ "${USER_COUNT:-0}" = "0" ]; then
  if [ -f "data/db.json" ] || [ -f "backups/latest-backup.json" ]; then
    echo "      Importing existing employees, tasks, shifts, and attendance records into MySQL..."
    $COMPOSE_CMD exec -T app npx tsx scripts/migrate-firestore-to-mysql.ts --source=file
    $COMPOSE_CMD restart app
    for i in $(seq 1 30); do
      if curl -fsS "http://127.0.0.1:${HTTP_PORT_VAL}/api/system/db-status" >/dev/null 2>&1; then
        break
      fi
      sleep 2
    done
  fi
else
  echo "      MySQL already contains ${USER_COUNT} user account(s); preserving existing records."
fi

# ---------------------------------------------------------------------
# 7. Configure & verify Office LAN access
# ---------------------------------------------------------------------
echo "[7/7] Configuring Office LAN access..."
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
LAN_IP="${LAN_IP:-127.0.0.1}"

if command -v ufw >/dev/null 2>&1; then
  UFW_STATUS="$(sudo -n ufw status 2>/dev/null | head -n 1 || true)"
  if [[ "$UFW_STATUS" == *"Status: active"* ]]; then
    sudo -n ufw allow "${HTTP_PORT_VAL}/tcp" >/dev/null 2>&1 || true
    sudo -n ufw deny 3306/tcp >/dev/null 2>&1 || true
    echo "      UFW firewall updated: allowed port ${HTTP_PORT_VAL}/tcp, blocked external 3306/tcp."
  else
    echo "      UFW tip (run once if enabling firewall):"
    echo "        sudo ufw allow ${HTTP_PORT_VAL}/tcp && sudo ufw deny 3306/tcp"
  fi
fi

echo ""
echo "====================================================================="
echo " DEPLOYMENT COMPLETE - RAC R&I Task Management Software is LIVE!"
echo "====================================================================="
if [ "$HTTP_PORT_VAL" = "80" ]; then
  echo " Office LAN URL : http://${LAN_IP}"
  echo " Local URL      : http://localhost"
else
  echo " Office LAN URL : http://${LAN_IP}:${HTTP_PORT_VAL}"
  echo " Local URL      : http://localhost:${HTTP_PORT_VAL}"
fi
echo " Database       : MySQL (${MYSQL_DB_VAL}) - Internal Docker network only"
echo " File Uploads   : ${PROJECT_DIR}/uploads"
echo " Backups        : ${PROJECT_DIR}/backups"
echo "---------------------------------------------------------------------"
echo " Quick Commands:"
echo "   ./status.sh   - View container & database status"
echo "   ./backup.sh   - Create MySQL + uploads backup"
echo "   ./restore.sh  - Restore from backup"
echo "   ./restart.sh  - Restart all services"
echo "   ./stop.sh     - Stop all services safely"
echo "====================================================================="
