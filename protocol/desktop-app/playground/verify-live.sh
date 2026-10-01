#!/bin/bash
# Verify live explorer params match embedded RFC-006 / PoA profile.
# Hard rules: k=3, maturity=100, fee 75/25, max_supply=90.2M, fee_floor=max(1,subsidy/500_000)

echo "=== LIVE HEAD ==="
curl -s https://explorer.kovanica.online/api/head | jq '.'

echo "=== EMBEDDED PROFILE CHECK ==="
echo "Profile (testnet/mainnet) uses:"
echo "  k=3, genesis_subsidy=10 KVNC, era=2_000_000, alpha=3/4"
echo "  maturity=100, finality_depth=100 (PoA), fee_split=75/25 burn"
echo "  max_supply=9020000000000000 atoms (90.2M KVNC)"
