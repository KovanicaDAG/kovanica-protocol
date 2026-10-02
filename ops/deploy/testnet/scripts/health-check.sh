#!/usr/bin/env bash
# Testnet health check — run from any machine with curl+jq.
set -euo pipefail

API="${1:-https://testnet.kovanica.online/api}"

echo "=== Kovanica Testnet Health Check ==="
echo "API: $API"
echo

# Chain head
echo "--- Chain Head ---"
curl -sf "$API/head" | jq '{height: .height, hash: .hash, timestamp: .timestamp}' 2>/dev/null || echo "FAIL: /api/head"

# Bootstrap
echo "--- Bootstrap ---"
curl -sf "$API/bootstrap" | jq '{network: .network, genesis: .genesis_hash}' 2>/dev/null || echo "FAIL: /api/bootstrap"

# Supply
echo "--- Supply ---"
curl -sf "$API/supply" | jq '{total: .total_supply, minted: .minted}' 2>/dev/null || echo "FAIL: /api/supply"

echo
echo "=== Done ==="
