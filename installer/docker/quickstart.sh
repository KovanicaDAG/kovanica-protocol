#!/usr/bin/env bash
# Kovanica Protocol — Docker Quick Start
#
# One-liner to run a Kovanica node in Docker:
#
#   docker run -d --name kovanica-node \
#     -p 9000:9000 -p 8080:8080 \
#     -v kovanica-data:/var/lib/kovanica \
#     kovanica/kovanica-node:latest
#
# Or build locally:
#
#   docker compose up -d

set -euo pipefail

cd "$(dirname "$0")"

echo "=== Kovanica Docker Node ==="
echo ""

# Option 1: Pull from registry
if docker pull kovanica/kovanica-node:latest 2>/dev/null; then
    echo "Using official image..."
    docker compose up -d
else
    echo "Official image not available, building locally..."
    docker compose up -d --build
fi

echo ""
echo "Node starting..."
echo "  Explorer:  http://localhost:8080"
echo "  P2P:       localhost:9000"
echo "  Logs:      docker compose logs -f kovanica-node"
echo "  Status:    docker compose ps"
echo "  Stop:      docker compose down"
echo ""
