#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker compose build --no-cache
docker compose up -d
echo ""
echo "Win for Life Analyzer avviato: http://localhost:8080"
echo "Log: docker compose logs -f winforlife-analyzer"
