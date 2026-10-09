#!/usr/bin/env bash
set -euo pipefail

mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S)"

docker compose -f docker-compose.server.yml stop lottery-analyzer || true
tar -czf "backups/lottery-data-${STAMP}.tar.gz" data/
docker compose -f docker-compose.server.yml start lottery-analyzer || true

echo "Creato: backups/lottery-data-${STAMP}.tar.gz"
