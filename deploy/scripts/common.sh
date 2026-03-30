#!/usr/bin/env bash
# Shared helper functions. Source after config.sh.

_check_repo_root() {
  if [[ ! -f "pnpm-workspace.yaml" ]]; then
    echo "ERROR: Run deploy scripts from the repo root."
    echo "  cd /path/to/bombermp && bash deploy/scripts/deploy.sh"
    exit 1
  fi
}

# Rsync a local file/dir to a remote path
rsync_file() {
  local server="$1"
  local local_path="$2"
  local remote_path="$3"

  rsync -avz \
    -e "ssh -i ${SSH_PRIVATE_KEY_PATH} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null" \
    "$local_path" \
    "${server}:${remote_path}"
}

# SCP a single file to a remote path
scp_file() {
  local server="$1"
  local local_path="$2"
  local remote_path="$3"

  scp -i "$SSH_PRIVATE_KEY_PATH" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    "$local_path" "${server}:${remote_path}"
}

# Run a command on the remote server via SSH
ssh_run_cmd() {
  local server="$1"
  local cmd="$2"

  ssh -i "$SSH_PRIVATE_KEY_PATH" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    "$server" "$cmd"
}

# Run a local command with a log prefix
run_local_cmd() {
  echo "[local] $*"
  "$@"
}
