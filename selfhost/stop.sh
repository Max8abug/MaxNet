#!/usr/bin/env bash
# Stop Portfolio98 services started by start.sh
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$REPO_DIR/selfhost/run"

stop_pid() {
  local name="$1" file="$2"
  if [ -f "$file" ]; then
    local pid; pid=$(cat "$file")
    if kill -0 "$pid" 2>/dev/null; then
      echo "  Stopping $name (PID $pid)..."
      kill "$pid" && rm -f "$file"
    else
      echo "  $name not running"
      rm -f "$file"
    fi
  else
    echo "  $name — no PID file"
  fi
}

stop_pid "API server" "$RUN_DIR/api.pid"
echo "Done."
