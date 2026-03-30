#!/usr/bin/env bash
# Build Docker images for the given environment.
# Usage: bash deploy/scripts/build.sh [--env prod|stage|local] [--parallel]
#
# VITE_WS_URL and VITE_API_URL are read from the env file and baked into
# the client bundle at build time.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --env=*) export DEPLOY_ENV="${arg#--env=}" ;;
    --parallel) export PARALLEL=true ;;
  esac
done

source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/common.sh"
source "$SCRIPT_DIR/parallel.sh"

_check_repo_root

ENV_FILE="$REPO_ROOT/deploy/environments/.env.${ENV}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Environment file not found: $ENV_FILE"
  echo "       Copy deploy/environments/.env.prod.example and fill in secrets."
  exit 1
fi

# Extract VITE build args from env file (strips inline comments)
VITE_WS_URL="$(grep -E '^VITE_WS_URL=' "$ENV_FILE" | cut -d= -f2- | sed 's/#.*//' | xargs)"
VITE_API_URL="$(grep -E '^VITE_API_URL=' "$ENV_FILE" | cut -d= -f2- | sed 's/#.*//' | xargs)"

echo "[build] ENV=${ENV}  VITE_WS_URL=${VITE_WS_URL}  VITE_API_URL=${VITE_API_URL}"

build_server() {
  echo "[build] Building server image…"
  docker buildx build --progress=plain --load \
    -f apps/server/Dockerfile \
    -t "${PROJECT_NAME}/server:latest" \
    .
  echo "[build] server done."
}

build_client() {
  echo "[build] Building client image…"
  docker buildx build --progress=plain --load \
    -f apps/client/Dockerfile \
    --build-arg "VITE_WS_URL=${VITE_WS_URL}" \
    --build-arg "VITE_API_URL=${VITE_API_URL}" \
    -t "${PROJECT_NAME}/client:latest" \
    .
  echo "[build] client done."
}

run_parallel build_server
run_parallel build_client
wait_all

echo "[build] All images built."
