#!/usr/bin/env bash
# Exercise the real self-host dependency install and production builds without
# touching the caller's checkout, .env files, home directory, or database.
set -euo pipefail
umask 077

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "This smoke check requires Linux x86_64, matching the self-host target." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" != "24" ]]; then
  echo "This smoke check requires Node.js 24 (found $(node --version))." >&2
  exit 1
fi

PNPM_PACKAGE="$(node -p 'require(process.argv[1]).packageManager' "$REPO_DIR/package.json")"
if [[ ! "$PNPM_PACKAGE" =~ ^pnpm@[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "package.json must specify an exact pnpm packageManager version." >&2
  exit 1
fi
EXPECTED_PNPM_VERSION="${PNPM_PACKAGE#pnpm@}"
ACTUAL_PNPM_VERSION="$(pnpm --version)"
if [[ "$ACTUAL_PNPM_VERSION" != "$EXPECTED_PNPM_VERSION" ]]; then
  echo "This smoke check requires $PNPM_PACKAGE (found pnpm@$ACTUAL_PNPM_VERSION)." >&2
  exit 1
fi

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/portfolio98-linux-smoke.XXXXXX")"
trap 'rm -rf "$TEMP_ROOT"' EXIT
CHECKOUT="$TEMP_ROOT/repo"
SMOKE_HOME="$TEMP_ROOT/home"
mkdir -p "$CHECKOUT" "$SMOKE_HOME"

CONFIG_FILES=(package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc)
repo_config_hashes() {
  local file
  for file in "${CONFIG_FILES[@]}"; do
    if [[ -f "$REPO_DIR/$file" ]]; then
      printf '%s  %s\n' "$(sha256sum "$REPO_DIR/$file" | cut -d ' ' -f 1)" "$file"
    else
      printf 'missing  %s\n' "$file"
    fi
  done
}
BEFORE_REPO_CONFIG="$(repo_config_hashes)"

echo "Copying source to a disposable checkout (local dependencies and environment files excluded)..."
tar \
  --exclude='./.git' \
  --exclude='./node_modules' --exclude='*/node_modules' \
  --exclude='./.cache' --exclude='*/.cache' \
  --exclude='./.env' --exclude='*/.env' \
  --exclude='./.env.*' --exclude='*/.env.*' \
  --exclude='./.npmrc' --exclude='*/.npmrc' \
  --exclude='./selfhost/logs' --exclude='./selfhost/run' \
  --exclude='./artifacts/api-server/dist' \
  --exclude='./artifacts/photo-desktop/dist' \
  -cf - -C "$REPO_DIR" . | tar -xf - -C "$CHECKOUT"

if [[ -e "$CHECKOUT/selfhost/.env" ]]; then
  echo "Refusing to run: selfhost/.env was copied into the smoke checkout." >&2
  exit 1
fi

CHECKOUT_CONFIG_HASHES=""
for file in package.json pnpm-workspace.yaml pnpm-lock.yaml; do
  CHECKOUT_CONFIG_HASHES+="$(
    cd "$CHECKOUT"
    printf '%s  %s\n' "$(sha256sum "$file" | cut -d ' ' -f 1)" "$file"
  )"$'\n'
done

run_isolated() {
  local label="$1"
  shift
  local log_file="$TEMP_ROOT/step.log"

  printf '%s... ' "$label"
  if (
    cd "$CHECKOUT"
    env -i \
      PATH="$PATH" \
      HOME="$SMOKE_HOME" \
      XDG_CONFIG_HOME="$SMOKE_HOME/.config" \
      npm_config_userconfig="$SMOKE_HOME/npmrc" \
      npm_config_globalconfig="$SMOKE_HOME/global-npmrc" \
      npm_config_cache="$SMOKE_HOME/npm-cache" \
      npm_config_auto_install_peers=false \
      npm_config_strict_peer_dependencies=true \
      CI=1 \
      NODE_ENV=production \
      DATABASE_URL=postgresql://smoke:smoke@127.0.0.1:1/portfolio98_smoke \
      "$@"
  ) >"$log_file" 2>&1; then
    echo "passed"
  else
    local status=$?
    echo "FAILED" >&2
    echo "Last output (environment and user config are isolated):" >&2
    tail -n 40 "$log_file" >&2
    return "$status"
  fi
}

run_isolated "Frozen workspace install with pnpm@$EXPECTED_PNPM_VERSION" \
  pnpm install --frozen-lockfile
run_isolated "API server production build" \
  pnpm --filter @workspace/api-server run build
run_isolated "Frontend production build" \
  env PORT=5000 BASE_PATH=/ pnpm --filter @workspace/photo-desktop run build

AFTER_REPO_CONFIG="$(repo_config_hashes)"
if [[ "$BEFORE_REPO_CONFIG" != "$AFTER_REPO_CONFIG" ]]; then
  echo "The source checkout's package/config files changed during the smoke check." >&2
  diff -u <(printf '%s\n' "$BEFORE_REPO_CONFIG") <(printf '%s\n' "$AFTER_REPO_CONFIG") >&2 || true
  exit 1
fi

AFTER_CHECKOUT_CONFIG=""
for file in package.json pnpm-workspace.yaml pnpm-lock.yaml; do
  AFTER_CHECKOUT_CONFIG+="$(
    cd "$CHECKOUT"
    printf '%s  %s\n' "$(sha256sum "$file" | cut -d ' ' -f 1)" "$file"
  )"$'\n'
done
if [[ "$CHECKOUT_CONFIG_HASHES" != "$AFTER_CHECKOUT_CONFIG" ]]; then
  echo "The disposable checkout's package/config files changed during install/build." >&2
  diff -u <(printf '%s' "$CHECKOUT_CONFIG_HASHES") <(printf '%s' "$AFTER_CHECKOUT_CONFIG") >&2 || true
  exit 1
fi

echo "Linux self-host smoke check passed; repository package/config files are unchanged."
