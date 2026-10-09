#!/usr/bin/env bash
# One-shot command; never starts the API or installs a schedule.
set -euo pipefail
umask 077
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${1:-}" != "--enabled" || $# != 1 ]]; then
  echo "Usage: bash selfhost/backup.sh --enabled (requires selfhost/backup.conf)" >&2
  exit 1
fi
for config in "$REPO_DIR/selfhost/.env" "$REPO_DIR/selfhost/backup.conf"; do
  if [[ ! -f "$config" ]]; then echo "Missing configuration: $config" >&2; exit 1; fi
  set -a; source "$config"; set +a
done
: "${BACKUP_DESTINATION:?Set BACKUP_DESTINATION in selfhost/backup.conf}"
: "${BACKUP_KEEP:?Set BACKUP_KEEP in selfhost/backup.conf}"
if [[ "$BACKUP_DESTINATION" != /* ]]; then echo "Use an absolute backup destination." >&2; exit 1; fi
destination="$(realpath -m "$BACKUP_DESTINATION")"
case "$destination/" in
  "$REPO_DIR/"*) echo "Backups must be outside the Git checkout and public web roots." >&2; exit 1 ;;
esac
export NVM_DIR="$HOME/.nvm"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then source "$NVM_DIR/nvm.sh"; fi
cd "$REPO_DIR"
args=(--enabled "--destination=$destination" "--keep=$BACKUP_KEEP")
if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then args+=("--recipient=$BACKUP_AGE_RECIPIENT"); fi
exec node --enable-source-maps "$REPO_DIR/artifacts/api-server/dist/scheduled-backup-cli.mjs" "${args[@]}"
