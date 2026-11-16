#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "ERROR: Docker Compose is not installed."
  exit 1
fi

echo "Stopping RAC R&I Task Management containers safely..."
$COMPOSE_CMD down
echo "All containers stopped cleanly."
echo "All persistent data in MySQL volume, ./data, ./uploads, and ./backups is preserved."
