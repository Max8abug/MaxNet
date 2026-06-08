#!/usr/bin/env bash
# Start Portfolio98 in the background and write PIDs to selfhost/run/
# stdout → logs/api.log   stderr → logs/error.log
# A lightweight crash-watcher restarts the process if it exits unexpectedly.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$REPO_DIR/selfhost/run"
LOG_DIR="$REPO_DIR/selfhost/logs"
ENV_FILE="$REPO_DIR/selfhost/.env"

mkdir -p "$RUN_DIR" "$LOG_DIR"

# Timestamp helper
ts() { date '+%Y-%m-%d %H:%M:%S'; }

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
echo "[$(ts)] [postgres] Ensuring PostgreSQL is running..."
if command -v systemctl &>/dev/null; then
  if ! sudo systemctl is-active --quiet postgresql 2>/dev/null; then
    sudo systemctl start postgresql
    echo "[$(ts)] [postgres]   started"
  else
    echo "[$(ts)] [postgres]   already running"
  fi
fi

# ---- API + frontend (SERVE_STATIC=1 serves both) ----
API_PID_FILE="$RUN_DIR/api.pid"
WATCHER_PID_FILE="$RUN_DIR/watcher.pid"

if [ -f "$API_PID_FILE" ] && kill -0 "$(cat "$API_PID_FILE")" 2>/dev/null; then
  echo "[$(ts)] [api] Already running (PID $(cat "$API_PID_FILE"))"
  exit 0
fi

echo "[$(ts)] [api] Starting server on port ${PORT:-3000}..."

# Launch node; stdout → api.log, stderr → error.log (separate so errors are easy to find)
nohup node --enable-source-maps "$REPO_DIR/artifacts/api-server/dist/index.mjs" \
  >>"$LOG_DIR/api.log" 2>>"$LOG_DIR/error.log" &
API_PID=$!
echo "$API_PID" > "$API_PID_FILE"
echo "[$(ts)] [api]   PID $API_PID"

# ---- Crash-watcher ----
# Runs in the background; if the API process dies unexpectedly it logs the
# exit code and time to error.log so you have a clear record of when and why.
(
  wait "$API_PID" 2>/dev/null
  EXIT_CODE=$?
  if [ -f "$API_PID_FILE" ] && [ "$(cat "$API_PID_FILE")" = "$API_PID" ]; then
    # PID file still present → process died without a controlled stop
    MSG="[$(ts)] [CRASH] API process (PID $API_PID) exited with code $EXIT_CODE"
    echo "$MSG" | tee -a "$LOG_DIR/error.log" >> "$LOG_DIR/api.log"
    rm -f "$API_PID_FILE"
  fi
) &
echo $! > "$WATCHER_PID_FILE"

sleep 1

# Quick health check
if curl -sf "http://localhost:${PORT:-3000}/api/healthz" >/dev/null 2>&1; then
  echo "[$(ts)]"
  echo "[$(ts)] ✓ Portfolio98 is running at http://localhost:${PORT:-3000}"
else
  echo "[$(ts)]"
  echo "[$(ts)] ⚠ Server started but health check hasn't responded yet."
  echo "[$(ts)]   Check error log: tail -f $LOG_DIR/error.log"
  echo "[$(ts)]   Check full log:  tail -f $LOG_DIR/api.log"
fi
