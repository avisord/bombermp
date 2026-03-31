#!/usr/bin/env bash
# Deployment configuration.
# Sourced by all deploy scripts — do NOT run directly.
#
# To find your GCE external IP:
#   gcloud compute instances describe instance-20260329-232710 \
#     --zone=asia-south1-a \
#     --format='get(networkInterfaces[0].accessConfigs[0].natIP)'

PROJECT_NAME="bombermp"

# ─── Environment: local | stage | prod ────────────────────────────────────────
# Override: DEPLOY_ENV=stage bash deploy/scripts/deploy.sh
ENV="${DEPLOY_ENV:-prod}"

# ─── Remote server per environment ────────────────────────────────────────────
case "$ENV" in
  prod)
    REMOTE_USER="avinash2002a"
    REMOTE_HOST="34.131.250.230"
    ;;
  stage)
    REMOTE_USER="avinash2002a"
    REMOTE_HOST=""
    ;;
  local)
    REMOTE_USER="localhost"
    REMOTE_HOST="localhost"
    ;;
esac

SERVER="${REMOTE_USER}@${REMOTE_HOST}"
REMOTE_ROOT_DIRECTORY="/home/${REMOTE_USER}/${PROJECT_NAME}/"

# ─── SSH ──────────────────────────────────────────────────────────────────────
SSH_PRIVATE_KEY_PATH="deploy/ssh-keys/${ENV}/id_rsa"

# ─── Build artifacts ──────────────────────────────────────────────────────────
TAR_DIR=".tmp/img-tars"
CACHE_DIR=".tmp/img-cache"

# ─── Parallelism ──────────────────────────────────────────────────────────────
MAX_PARALLEL_JOBS=2  # server + client images
