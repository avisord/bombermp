#!/usr/bin/env bash
# Deploy BomberMP to a GCE instance via Artifact Registry + docker compose.
#
# Usage:
#   bash scripts/deploy-gcloud.sh
#
# Fill in MONGODB_URI and COOKIE_SECRET in scripts/deploy.env before running.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Load deploy.env ──────────────────────────────────────────────────────────

ENV_FILE="$SCRIPT_DIR/deploy.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found."
  exit 1
fi
# shellcheck source=deploy.env
set -a; source "$ENV_FILE"; set +a

# ─── Validate required vars ───────────────────────────────────────────────────

for var in GCP_PROJECT GCP_REGION GCP_ZONE GCP_INSTANCE MONGODB_URI COOKIE_SECRET; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: $var is not set in deploy.env"
    exit 1
  fi
done

REGISTRY="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/bombermp"
SERVER_IMAGE="${REGISTRY}/server:latest"
CLIENT_IMAGE="${REGISTRY}/client:latest"

# ─── Ensure Artifact Registry repo exists ────────────────────────────────────

echo "[deploy] Ensuring Artifact Registry repository…"
gcloud artifacts repositories describe bombermp \
  --location="$GCP_REGION" --project="$GCP_PROJECT" > /dev/null 2>&1 \
|| gcloud artifacts repositories create bombermp \
  --repository-format=docker \
  --location="$GCP_REGION" \
  --project="$GCP_PROJECT"

gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet

# ─── Build & push server ──────────────────────────────────────────────────────

echo "[deploy] Building server image…"
docker build \
  -f "$REPO_ROOT/apps/server/Dockerfile" \
  -t "$SERVER_IMAGE" \
  "$REPO_ROOT"

echo "[deploy] Pushing server image…"
docker push "$SERVER_IMAGE"

# ─── Build & push client ──────────────────────────────────────────────────────

echo "[deploy] Building client image…"
docker build \
  -f "$REPO_ROOT/apps/client/Dockerfile" \
  --build-arg "VITE_WS_URL=${VITE_WS_URL}" \
  --build-arg "VITE_API_URL=${VITE_API_URL}" \
  -t "$CLIENT_IMAGE" \
  "$REPO_ROOT"

echo "[deploy] Pushing client image…"
docker push "$CLIENT_IMAGE"

# ─── Prepare production compose file ─────────────────────────────────────────

COMPOSE_PROD="$REPO_ROOT/docker/docker-compose.prod.yml"
TMP_COMPOSE="$(mktemp)"

sed \
  -e "s|REGISTRY_SERVER_IMAGE|${SERVER_IMAGE}|g" \
  -e "s|REGISTRY_CLIENT_IMAGE|${CLIENT_IMAGE}|g" \
  -e "s|TMPL_MONGODB_URI|${MONGODB_URI}|g" \
  -e "s|TMPL_CLIENT_URL|${CLIENT_URL}|g" \
  -e "s|TMPL_COOKIE_SECRET|${COOKIE_SECRET}|g" \
  "$COMPOSE_PROD" > "$TMP_COMPOSE"

# ─── Copy compose file to GCE instance ───────────────────────────────────────

echo "[deploy] Copying compose file to ${GCP_INSTANCE}…"
gcloud compute scp "$TMP_COMPOSE" \
  "${REMOTE_USER}@${GCP_INSTANCE}:/home/${REMOTE_USER}/docker-compose.yml" \
  --zone="$GCP_ZONE" \
  --project="$GCP_PROJECT"

rm -f "$TMP_COMPOSE"

# ─── Deploy on GCE instance ───────────────────────────────────────────────────

echo "[deploy] Pulling images and restarting services on ${GCP_INSTANCE}…"
gcloud compute ssh "${REMOTE_USER}@${GCP_INSTANCE}" \
  --zone="$GCP_ZONE" \
  --project="$GCP_PROJECT" \
  --command="
    set -e
    cd ~
    gcloud auth configure-docker ${GCP_REGION}-docker.pkg.dev --quiet
    docker compose pull
    docker compose up -d --remove-orphans
    docker image prune -f
  "

echo ""
echo "[deploy] Done!"
echo "  Client : ${CLIENT_URL}"
echo "  Server : ${SERVER_URL}"
