#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "Restarting all RAC R&I Task Management services..."
"$PROJECT_DIR/stop.sh"
"$PROJECT_DIR/start.sh"
