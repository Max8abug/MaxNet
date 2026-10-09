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
PNPM_PACKAGE="$(node -p 'require(process.argv[1]).packageManager' "$REPO_DIR/package.json")"
if [[ ! "$PNPM_PACKAGE" =~ ^pnpm@[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: package.json must specify an exact pnpm packageManager version."
  exit 1
fi
PNPM_VERSION="${PNPM_PACKAGE#pnpm@}"
CURRENT_PNPM_VERSION="$(pnpm --version 2>/dev/null || true)"
if [[ "$CURRENT_PNPM_VERSION" != "$PNPM_VERSION" ]]; then
  echo "[2/6] Installing the required $PNPM_PACKAGE (current: ${CURRENT_PNPM_VERSION:-not installed})..."
  npm install -g "$PNPM_PACKAGE"
  echo "  ✓ pnpm $(pnpm --version)"
else
  echo "[2/6] Required pnpm already installed: $PNPM_VERSION"
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
  ENV_TMP="$(mktemp "$REPO_DIR/selfhost/.env.tmp.XXXXXX")"
  trap 'rm -f -- "$ENV_TMP"' EXIT
  {
  cat <<ENVEOF
# Portfolio98 environment — edit as needed then run start.sh
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
SESSION_SECRET=${SESSION_SECRET}
PORT=3000
SERVE_STATIC=1
STORAGE_BACKEND=local
NODE_ENV=production
# Set to "true" ONLY when serving over HTTPS (nginx + Certbot).
# Leave false for plain HTTP — a Secure cookie over HTTP silently breaks login.
COOKIE_SECURE=false
ENVEOF
    # Setup can regenerate database/session settings, but launcher-managed API
    # keys belong to the owner and must survive that rewrite.
    if [ -f "$ENV_FILE" ]; then
      grep -E '^(SPOTIFY_CLIENT_ID|SPOTIFY_CLIENT_SECRET|YOUTUBE_DATA_API_KEY)=' "$ENV_FILE" || true
    fi
  } > "$ENV_TMP"
  chmod 600 "$ENV_TMP"
  mv -f -- "$ENV_TMP" "$ENV_FILE"
  trap - EXIT
  echo "  ✓ Wrote $ENV_FILE"
else
  echo "[5/6] $ENV_FILE already exists — not overwriting"
fi
if [ -f "$ENV_FILE" ]; then
  chmod 600 "$ENV_FILE"
fi

# ---- Install npm dependencies + build ----
echo "[6/6] Installing dependencies and building..."
cd "$REPO_DIR"

# Source nvm in case this is a fresh shell
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

pnpm install --frozen-lockfile 2>&1 | tail -5

echo "  Installing selected self-hosted game ports (about 1 GB on first setup)..."
python3 "$REPO_DIR/selfhost/install-game-assets.py"

echo "  Building API server..."
pnpm --filter @workspace/api-server run build 2>&1 | tail -5

echo "  Building frontend..."
PORT=5000 BASE_PATH="/" pnpm --filter @workspace/photo-desktop run build 2>&1 | tail -5

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
