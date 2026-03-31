#!/usr/bin/env bash
# Initialize Let's Encrypt SSL certificates on the remote server.
#
# Run this ONCE on a fresh instance, BEFORE the first deploy.
# Both DNS A records must already point to REMOTE_HOST when you run this.
#
# Usage:
#   bash deploy/scripts/init_certs.sh              # prod
#   bash deploy/scripts/init_certs.sh --env=stage  # stage
#
# What it does:
#   1. Installs certbot on the remote VM (if missing)
#   2. Stops nginx (frees port 80 for certbot standalone challenge)
#   3. Issues certs for all domains
#   4. Sets up a cron job for auto-renewal

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
source "$SCRIPT_DIR/common.sh"

CERTBOT_EMAIL="avinash2002a@gmail.com"

# Domains per environment
case "$ENV" in
  prod)
    DOMAINS=(
      "bombermp.avinashjha.space"
      "bombermpapi.avinashjha.space"
    )
    ;;
  stage)
    DOMAINS=(
      "stage.bombermp.avinashjha.space"
      "stage.bombermpapi.avinashjha.space"
    )
    ;;
  *)
    echo "ERROR: init_certs only runs for stage or prod, not '${ENV}'."
    exit 1
    ;;
esac

if [[ ! -f "$SSH_PRIVATE_KEY_PATH" ]]; then
  echo "ERROR: SSH key not found at $SSH_PRIVATE_KEY_PATH"
  exit 1
fi

eval "$(ssh-agent -s)" > /dev/null
ssh-add "$SSH_PRIVATE_KEY_PATH"
trap 'ssh-agent -k > /dev/null 2>&1' EXIT

echo "[certs] Connecting to ${SERVER} (ENV=${ENV})…"

# ─── Stop nginx to free port 80 ───────────────────────────────────────────────
echo "[certs] Stopping nginx on remote (if running)…"
ssh_run_cmd "$SERVER" "
  cd ${REMOTE_ROOT_DIRECTORY}deploy 2>/dev/null || true
  docker compose -f docker-compose.image.yml stop nginx 2>/dev/null || true
"

# ─── Install certbot ──────────────────────────────────────────────────────────
echo "[certs] Installing certbot (if not present)…"
ssh_run_cmd "$SERVER" "
  which certbot > /dev/null 2>&1 || (
    sudo apt-get update -qq &&
    sudo apt-get install -y certbot
  )
"

# ─── Issue certificates ───────────────────────────────────────────────────────
for DOMAIN in "${DOMAINS[@]}"; do
  echo "[certs] Requesting certificate for ${DOMAIN}…"
  ssh_run_cmd "$SERVER" "
    sudo certbot certonly \
      --standalone \
      --non-interactive \
      --agree-tos \
      --email ${CERTBOT_EMAIL} \
      --no-eff-email \
      -d ${DOMAIN} \
      --keep-until-expiring
  "
  echo "[certs] ✓ ${DOMAIN}"
done

# ─── Auto-renewal cron ────────────────────────────────────────────────────────
echo "[certs] Setting up auto-renewal cron…"
ssh_run_cmd "$SERVER" "
  # Dry-run to verify renewal works
  sudo certbot renew --dry-run

  # Add cron: run twice daily (certbot best practice)
  # On renewal, restart nginx so it picks up new certs
  CRON_JOB='0 0,12 * * * certbot renew --quiet --deploy-hook \"docker restart ${PROJECT_NAME}_nginx_1 2>/dev/null || docker restart ${PROJECT_NAME}-nginx-1\"'

  # Add only if not already present
  ( crontab -l 2>/dev/null | grep -v certbot; echo \"\$CRON_JOB\" ) | crontab -
  echo '[certs] Cron job installed.'
"

echo ""
echo "[certs] Done! Certificates are at:"
for DOMAIN in "${DOMAINS[@]}"; do
  echo "  /etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
done
echo ""
echo "  Next step: bash deploy/scripts/deploy.sh --env=${ENV}"
