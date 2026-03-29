#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="$(dirname "$0")/../docker/docker-compose.dev.yml"

# ─── Check Docker ─────────────────────────────────────────────────────────────

if ! docker info > /dev/null 2>&1; then
  echo "[dev] ERROR: Docker is not running. Start Docker Desktop (or the Docker daemon) and try again."
  exit 1
fi

# ─── Start MongoDB ────────────────────────────────────────────────────────────

echo "[dev] Starting MongoDB via Docker Compose…"
docker compose -f "$COMPOSE_FILE" up -d --wait

echo "[dev] MongoDB is healthy."

# ─── Teardown trap ────────────────────────────────────────────────────────────

teardown() {
  echo ""
  echo "[dev] Shutting down MongoDB…"
  docker compose -f "$COMPOSE_FILE" down
}
trap teardown EXIT INT TERM

# ─── Dev servers ─────────────────────────────────────────────────────────────

echo "[dev] Starting pnpm dev…"
cd "$(dirname "$0")/.."
pnpm dev
