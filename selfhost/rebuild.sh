#!/usr/bin/env bash
# Rebuild after pulling new code, then restart
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

cd "$REPO_DIR"
echo "Preparing selected self-hosted game assets..."
python3 "$REPO_DIR/selfhost/install-game-assets.py"

echo "Stopping services..."
"$REPO_DIR/selfhost/stop.sh"

echo "Installing dependencies..."
pnpm install --frozen-lockfile

echo "Building API server..."
pnpm --filter @workspace/api-server run build

echo "Building frontend..."
PORT=5000 BASE_PATH="/" pnpm --filter @workspace/photo-desktop run build

echo "Starting services..."
"$REPO_DIR/selfhost/start.sh"
