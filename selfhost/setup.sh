#!/usr/bin/env bash
# ============================================================
# Portfolio98 — One-time setup for Linux Mint / Ubuntu / Debian
# Run once as a normal user (sudo access required for packages).
# ============================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_DIR/selfhost/.env"

echo ""
echo "============================================================"
echo "  Portfolio98 Self-Host Setup"
echo "  Repo: $REPO_DIR"
echo "============================================================"
echo ""

# ---- Node.js 24 via nvm ----
if ! command -v node &>/dev/null || [[ "$(node -e 'process.stdout.write(process.version)' 2>/dev/null)" != v24* ]]; then
  echo "[1/6] Installing Node.js 24 via nvm..."
  if [ ! -d "$HOME/.nvm" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # shellcheck disable=SC1090
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
  nvm install 24
  nvm use 24
  nvm alias default 24
  echo "  ✓ Node.js $(node --version)"
else
  echo "[1/6] Node.js already installed: $(node --version)"
fi

# ---- pnpm ----
if ! command -v pnpm &>/dev/null; then
  echo "[2/6] Installing pnpm..."
  npm install -g pnpm@10
  echo "  ✓ pnpm $(pnpm --version)"
else
  echo "[2/6] pnpm already installed: $(pnpm --version)"
fi

# ---- PostgreSQL ----
if ! command -v psql &>/dev/null; then
  echo "[3/6] Installing PostgreSQL..."
  sudo apt-get update -qq
  sudo apt-get install -y postgresql postgresql-contrib
  sudo systemctl enable postgresql
  sudo systemctl start postgresql
  echo "  ✓ PostgreSQL installed"
else
  echo "[3/6] PostgreSQL already installed"
fi

# Ensure PostgreSQL is running
if ! sudo systemctl is-active --quiet postgresql; then
  sudo systemctl start postgresql
fi

# ---- Create DB + user ----
echo "[4/6] Setting up database..."
DB_USER="portfolio98"
DB_NAME="portfolio98"
DB_PASS=$(openssl rand -hex 16)

# Create user if it doesn't exist
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  echo "  DB user '$DB_USER' already exists — skipping creation"
else
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
  echo "  ✓ Created user '$DB_USER' and database '$DB_NAME'"
  # Write the password to env file (new setup)
  WRITE_ENV=1
fi

# ---- Write .env ----
if [ ! -f "$ENV_FILE" ] || [ "${WRITE_ENV:-0}" = "1" ]; then
  echo "[5/6] Writing $ENV_FILE ..."
  SESSION_SECRET=$(openssl rand -hex 32)
  cat > "$ENV_FILE" <<ENVEOF
# Portfolio98 environment — edit as needed then run start.sh
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
SESSION_SECRET=${SESSION_SECRET}
PORT=3000
SERVE_STATIC=1
NODE_ENV=production
ENVEOF
  echo "  ✓ Wrote $ENV_FILE"
else
  echo "[5/6] $ENV_FILE already exists — not overwriting"
fi

# ---- Install npm dependencies + build ----
echo "[6/6] Installing dependencies and building..."
cd "$REPO_DIR"

# Source nvm in case this is a fresh shell
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

pnpm install --frozen-lockfile 2>&1 | tail -5

echo "  Building API server..."
pnpm --filter @workspace/api-server run build 2>&1 | tail -5

echo "  Building frontend..."
# Frontend build needs BASE_PATH to be "/" for self-hosted single-origin mode
BASE_PATH="/" pnpm --filter @workspace/photo-desktop run build 2>&1 | tail -5

echo ""
echo "============================================================"
echo "  Setup complete!"
echo ""
echo "  Start the site:   ./selfhost/start.sh"
echo "  Stop the site:    ./selfhost/stop.sh"
echo "  GUI launcher:     python3 ./selfhost/launcher.py"
echo ""
echo "  The site will be available at http://localhost:3000"
echo "============================================================"
echo ""
