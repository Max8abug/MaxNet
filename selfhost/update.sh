#!/usr/bin/env bash
# ============================================================
# Portfolio98 — Pull latest code from git and rebuild/restart.
# Safe to run while the site is live; it stops first, rebuilds,
# then restarts automatically.
# ============================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_DIR/selfhost/logs"
mkdir -p "$LOG_DIR"

# Timestamp helper
ts() { date '+%Y-%m-%d %H:%M:%S'; }

log() { echo "[$(ts)] $*" | tee -a "$LOG_DIR/update.log"; }

log "============================================================"
log "  Portfolio98 Update"
log "  Repo: $REPO_DIR"
log "============================================================"

cd "$REPO_DIR"

# Source nvm if needed
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

# ── 1. Check we're inside a git repo ────────────────────────
if ! git -C "$REPO_DIR" rev-parse --is-inside-work-tree &>/dev/null; then
  log "ERROR: $REPO_DIR is not a git repository."
  log "If you downloaded a zip instead of cloning, updates must be done manually."
  exit 1
fi

# ── 2. Show current state ────────────────────────────────────
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
BEFORE_SHA=$(git rev-parse --short HEAD)
log "Current branch : $CURRENT_BRANCH"
log "Current commit : $BEFORE_SHA"

# Warn about local changes
if ! git diff --quiet || ! git diff --cached --quiet; then
  log "WARNING: You have uncommitted local changes."
  read -rp "         Continue anyway? (y/N) " answer
  [[ "$answer" =~ ^[Yy]$ ]] || { log "Aborted."; exit 0; }
fi

# ── 3. Pull ──────────────────────────────────────────────────
log "Pulling from origin/$CURRENT_BRANCH ..."
git pull --ff-only origin "$CURRENT_BRANCH" 2>&1 | tee -a "$LOG_DIR/update.log"

AFTER_SHA=$(git rev-parse --short HEAD)
if [ "$BEFORE_SHA" = "$AFTER_SHA" ]; then
  log "Already up to date (commit $AFTER_SHA). Nothing to do."
  read -rp "Force rebuild anyway? (y/N) " rebuild_anyway
  [[ "$rebuild_anyway" =~ ^[Yy]$ ]] || { log "Done."; exit 0; }
fi

log "Updated: $BEFORE_SHA → $AFTER_SHA"
git log --oneline "$BEFORE_SHA..$AFTER_SHA" | tee -a "$LOG_DIR/update.log" || true

# ── 4. Stop services ─────────────────────────────────────────
log "Stopping services..."
bash "$REPO_DIR/selfhost/stop.sh" 2>&1 | tee -a "$LOG_DIR/update.log"

# ── 5. Install dependencies ──────────────────────────────────
log "Installing / updating dependencies..."
pnpm install --frozen-lockfile 2>&1 | tee -a "$LOG_DIR/update.log"

# ── 6. Build ─────────────────────────────────────────────────
log "Building API server..."
pnpm --filter @workspace/api-server run build 2>&1 | tee -a "$LOG_DIR/update.log"

log "Building frontend..."
BASE_PATH="/" pnpm --filter @workspace/photo-desktop run build 2>&1 | tee -a "$LOG_DIR/update.log"

# ── 7. Restart ───────────────────────────────────────────────
log "Starting services..."
bash "$REPO_DIR/selfhost/start.sh" 2>&1 | tee -a "$LOG_DIR/update.log"

log "============================================================"
log "  Update complete! Running commit: $AFTER_SHA"
log "  Log saved to: $LOG_DIR/update.log"
log "============================================================"
