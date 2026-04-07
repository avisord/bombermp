#!/usr/bin/env bash
# Build Docker images for the given environment.
# Usage: bash deploy/scripts/build.sh [--env prod|stage|local]
#
# Frontend is deployed via GitHub Pages — only the server image is built here.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --env=*) export DEPLOY_ENV="${arg#--env=}" ;;
  esac
done

source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/common.sh"

_check_repo_root

echo "[build] ENV=${ENV}"

echo "[build] Building server image…"
docker buildx build --progress=plain --load \
  -f apps/server/Dockerfile \
  -t "${PROJECT_NAME}/server:latest" \
  .
echo "[build] server done."

echo "[build] All images built."
