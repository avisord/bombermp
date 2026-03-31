#!/usr/bin/env bash
# Master deployment orchestration script.
#
# Usage:
#   bash deploy/scripts/deploy.sh                     # deploy to prod
#   bash deploy/scripts/deploy.sh --env=stage         # deploy to stage
#   bash deploy/scripts/deploy.sh --parallel          # build images in parallel
#   bash deploy/scripts/deploy.sh --skip-build        # skip build+save steps
#
# Prerequisites:
#   1. deploy/ssh-keys/{prod|stage}/id_rsa — SSH private key with access to REMOTE_HOST
#   2. deploy/environments/.env.{prod|stage} — secrets filled in
#   3. REMOTE_HOST set in deploy/scripts/config.sh
#   4. Remote server has Docker + docker compose installed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# ─── Parse flags ──────────────────────────────────────────────────────────────
SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --env=*)     export DEPLOY_ENV="${arg#--env=}" ;;
    --parallel)  export PARALLEL=true ;;
    --skip-build) SKIP_BUILD=true ;;
  esac
done

export DEPLOY_ENV="${DEPLOY_ENV:-prod}"

source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/common.sh"

_check_repo_root

# ─── Validate ─────────────────────────────────────────────────────────────────
if [[ -z "${REMOTE_HOST:-}" ]]; then
  echo "ERROR: REMOTE_HOST is not set in deploy/scripts/config.sh for env '${ENV}'."
  echo "       Add the GCE external IP and re-run."
  exit 1
fi

if [[ ! -f "deploy/environments/.env.${ENV}" ]]; then
  echo "ERROR: deploy/environments/.env.${ENV} not found."
  echo "       Copy deploy/environments/.env.prod.example and fill in secrets."
  exit 1
fi

if [[ ! -f "$SSH_PRIVATE_KEY_PATH" ]]; then
  echo "ERROR: SSH key not found at $SSH_PRIVATE_KEY_PATH"
  echo "       Place your GCE private key there (chmod 600)."
  exit 1
fi

# ─── Setup SSH agent ──────────────────────────────────────────────────────────
eval "$(ssh-agent -s)" > /dev/null
ssh-add "$SSH_PRIVATE_KEY_PATH"
trap 'ssh-agent -k > /dev/null 2>&1' EXIT

# ─── Pipeline ─────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  BomberMP  →  ENV=${ENV}  →  ${SERVER}"
echo "╚══════════════════════════════════════════╝"
echo ""

if [[ "$SKIP_BUILD" != "true" ]]; then
  echo "── [1/4] Build images ──────────────────────"
  bash "$SCRIPT_DIR/build.sh" "$@"

  echo "── [2/4] Save to tar ───────────────────────"
  bash "$SCRIPT_DIR/save.sh"
else
  echo "── Skipping build + save (--skip-build) ────"
fi

echo "── [3/4] Transfer & load on remote ────────"
bash "$SCRIPT_DIR/send.sh" "$@"

echo "── [4/4] Restart containers ────────────────"
ssh_run_cmd "$SERVER" "
  set -e
  cd ${REMOTE_ROOT_DIRECTORY}deploy

  docker compose -f docker-compose.image.yml down --remove-orphans
  docker compose -f docker-compose.image.yml up -d
  docker image prune -f
  docker compose -f docker-compose.image.yml ps
"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Deploy complete!                        ║"
echo "║  Client : https://bombermb.avinashjha.space"
echo "║  API    : https://bombermbapi.avinashjha.space"
echo "╚══════════════════════════════════════════╝"
