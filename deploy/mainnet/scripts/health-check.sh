#!/usr/bin/env bash
# Mainnet health check — run from any machine with curl+jq.
set -euo pipefail

API="${1:-https://mainnet.kovanica.online/api}"

echo "=== Kovanica Mainnet Health Check ==="
echo "API: $API"
echo

# Chain head
echo "--- Chain Head ---"
curl -sf "$API/head" | jq '{height: .height, hash: .hash, timestamp: .timestamp}' 2>/dev/null || echo "FAIL: /api/head"

# Bootstrap
echo "--- Bootstrap ---"
curl -sf "$API/bootstrap" | jq '{network: .network}' 2>/dev/null || echo "FAIL: /api/bootstrap"

echo
echo "=== Done ==="
