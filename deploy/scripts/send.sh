#!/usr/bin/env bash
# Transfer tar files and configs to the remote server, then load images.
# Usage: bash deploy/scripts/send.sh [--env prod|stage]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

for arg in "$@"; do
  case "$arg" in
    --env=*) export DEPLOY_ENV="${arg#--env=}" ;;
  esac
done

source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/common.sh"

# ─── Create remote directory structure ────────────────────────────────────────

setup_remote_dirs() {
  echo "[send] Setting up remote directories…"
  ssh_run_cmd "$SERVER" "
    mkdir -p ${REMOTE_ROOT_DIRECTORY}deploy/configs/nginx
    mkdir -p ${REMOTE_ROOT_DIRECTORY}deploy/environments
    mkdir -p ${REMOTE_ROOT_DIRECTORY}deploy/tars
    mkdir -p ${REMOTE_ROOT_DIRECTORY}deploy/scripts
  "
}

# ─── Transfer a tar and load it into Docker on remote ─────────────────────────

transfer_and_load_tar() {
  local app_name="$1"
  local tar_file="$REPO_ROOT/$TAR_DIR/${app_name}.tar"
  local remote_tars="${REMOTE_ROOT_DIRECTORY}deploy/tars/"
  local remote_tar="${remote_tars}${app_name}.tar"

  if [[ ! -f "$tar_file" ]]; then
    echo "ERROR: $tar_file not found. Run build.sh and save.sh first."
    exit 1
  fi

  echo "[send] Transferring ${app_name}.tar ($(du -sh "$tar_file" | cut -f1))…"
  rsync_file "$SERVER" "$tar_file" "$remote_tars"

  echo "[send] Loading ${app_name} on remote…"
  ssh_run_cmd "$SERVER" "docker load -i ${remote_tar}"
}

# ─── Transfer configs and env file ────────────────────────────────────────────

transfer_configs() {
  local env_file="$REPO_ROOT/deploy/environments/.env.${ENV}"

  if [[ ! -f "$env_file" ]]; then
    echo "ERROR: $env_file not found."
    exit 1
  fi

  echo "[send] Transferring env file (.env.${ENV} → .env.server)…"
  scp_file "$SERVER" "$env_file" "${REMOTE_ROOT_DIRECTORY}deploy/environments/.env.server"

  echo "[send] Transferring nginx config…"
  rsync_file "$SERVER" "$REPO_ROOT/deploy/configs/nginx/nginx.conf" \
    "${REMOTE_ROOT_DIRECTORY}deploy/configs/nginx/"

  echo "[send] Essentinal scripts…"
  rsync_file "$SERVER" "$REPO_ROOT/deploy/scripts/init_certs.sh" \
    "${REMOTE_ROOT_DIRECTORY}deploy/scripts/"

  rsync_file "$SERVER" "$REPO_ROOT/deploy/scripts/common.sh" \
    "${REMOTE_ROOT_DIRECTORY}deploy/scripts/"

  rsync_file "$SERVER" "$REPO_ROOT/deploy/scripts/config.sh" \
    "${REMOTE_ROOT_DIRECTORY}deploy/scripts/"

  echo "[send] Transferring docker-compose.image.yml…"
  rsync_file "$SERVER" "$REPO_ROOT/deploy/docker-compose.image.yml" \
    "${REMOTE_ROOT_DIRECTORY}deploy/"
}

# ─── Run ──────────────────────────────────────────────────────────────────────

setup_remote_dirs
transfer_and_load_tar server
transfer_configs

echo "[send] Done."
