#!/usr/bin/env bash
# Save Docker images to tar files with layer-hash caching.
# Skips saving an image if its top layer hasn't changed since the last save.
# Usage: bash deploy/scripts/save.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

source "$SCRIPT_DIR/config.sh"

mkdir -p "$REPO_ROOT/$TAR_DIR" "$REPO_ROOT/$CACHE_DIR"

save_image() {
  local app_name="$1"
  local image="${PROJECT_NAME}/${app_name}:latest"
  local tar_file="$REPO_ROOT/$TAR_DIR/${app_name}.tar"
  local cache_file="$REPO_ROOT/$CACHE_DIR/${app_name}.layer"

  # Get the top layer hash of the image
  local layer_count
  layer_count=$(docker image inspect "$image" --format='{{len .RootFS.Layers}}')
  local last_idx=$(( layer_count - 1 ))
  local current_id
  current_id=$(docker image inspect "$image" --format="{{index .RootFS.Layers $last_idx}}")

  if [[ -f "$cache_file" && "$(cat "$cache_file")" == "$current_id" ]]; then
    echo "[save] ${app_name} — unchanged, skipping ($(du -sh "$tar_file" | cut -f1))."
    return
  fi

  echo "[save] Saving ${app_name}…"
  docker save "$image" -o "$tar_file"
  echo "$current_id" > "$cache_file"
  echo "[save] ${app_name} saved ($(du -sh "$tar_file" | cut -f1))."
}

save_image server

echo "[save] Done."
