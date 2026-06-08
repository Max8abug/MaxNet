#!/usr/bin/env bash
# Start Portfolio98 in the background and write PIDs to selfhost/run/
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$REPO_DIR/selfhost/run"
LOG_DIR="$REPO_DIR/selfhost/logs"
ENV_FILE="$REPO_DIR/selfhost/.env"

mkdir -p "$RUN_DIR" "$LOG_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Run selfhost/setup.sh first."
  exit 1
fi

# Load env vars
set -a; source "$ENV_FILE"; set +a

# Source nvm if needed
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

# ---- PostgreSQL ----
echo "[postgres] Ensuring PostgreSQL is running..."
if command -v systemctl &>/dev/null; then
  if ! sudo systemctl is-active --quiet postgresql 2>/dev/null; then
    sudo systemctl start postgresql
    echo "  started"
  else
    echo "  already running"
  fi
fi

# ---- API + frontend (SERVE_STATIC=1 serves both) ----
API_PID_FILE="$RUN_DIR/api.pid"

if [ -f "$API_PID_FILE" ] && kill -0 "$(cat "$API_PID_FILE")" 2>/dev/null; then
  echo "[api] Already running (PID $(cat "$API_PID_FILE"))"
else
  echo "[api] Starting server on port ${PORT:-3000}..."
  nohup node --enable-source-maps "$REPO_DIR/artifacts/api-server/dist/index.mjs" \
    >"$LOG_DIR/api.log" 2>&1 &
  echo $! > "$API_PID_FILE"
  echo "  PID $!"
fi

sleep 1

# Quick health check
if curl -sf "http://localhost:${PORT:-3000}/api/healthz" >/dev/null 2>&1; then
  echo ""
  echo "✓ Portfolio98 is running at http://localhost:${PORT:-3000}"
else
  echo ""
  echo "⚠ Server started but health check didn't respond yet — check logs:"
  echo "  tail -f $LOG_DIR/api.log"
fi
