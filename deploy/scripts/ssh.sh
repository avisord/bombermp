#!/usr/bin/env bash
# Open an interactive SSH shell to the remote server.
# Usage: bash deploy/scripts/ssh.sh [--env=prod|stage]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

for arg in "$@"; do
  case "$arg" in
    --env=*) export DEPLOY_ENV="${arg#--env=}" ;;
  esac
done

export DEPLOY_ENV="${DEPLOY_ENV:-prod}"

source "$SCRIPT_DIR/config.sh"

echo "[ssh] Connecting to ${SERVER} (ENV=${ENV})…"
exec ssh -i "$SSH_PRIVATE_KEY_PATH" \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  "$SERVER"
