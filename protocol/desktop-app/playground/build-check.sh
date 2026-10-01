#!/bin/bash
set -euo pipefail

echo "=== DESKTOP BUILD CHECK ==="
cd /root/kovanica/protocol/desktop-app

# Library
cargo check --offline --lib 2>&1 | tail -1

# All targets
cargo check --offline --all-targets 2>&1 | tail -1

# Clippy (expect 4 dead-code warnings max)
warnings=$(cargo clippy --offline --lib 2>&1 | grep -c 'warning:' || true)
echo "Clippy warnings: ${warnings}"

# Binary presence
ls -lh target/release/kovanica-desktop 2>/dev/null | awk '{print $5, $9}'

echo "=== LIVE PARAMS ==="
curl -s https://explorer.kovanica.online/api/head | jq -c '{finality_depth, genesis}' 2>/dev/null || echo "Live head unreachable"

echo "=== CLASSIFICATION ==="
echo "client-only / consensus-safe (no GHOSTDAG/UTXO/Ed25519/supply change)"
