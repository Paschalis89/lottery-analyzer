#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.server.yml}"

mkdir -p data

echo "[1/4] Arresto container precedente (se presente)"
docker compose -f "$COMPOSE_FILE" down || true

echo "[2/4] Build pulita"
docker compose -f "$COMPOSE_FILE" build --no-cache

echo "[3/4] Avvio"
docker compose -f "$COMPOSE_FILE" up -d

echo "[4/4] Stato"
docker compose -f "$COMPOSE_FILE" ps

echo
echo "Health:"
sleep 2
curl -fsS "http://127.0.0.1:${LOTTERY_HOST_PORT:-8092}/api/health" || true
echo
