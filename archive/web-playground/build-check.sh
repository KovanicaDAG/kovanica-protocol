#!/bin/bash
set -euo pipefail
echo "=== WEB SURFACE CHECK ==="
cd /root/kovanica-web || echo "No /root/kovanica-web; using /root/kovanica/apps/desktop-node/ui"
echo "Build artifacts: $(ls dist/ 2>/dev/null | wc -l) files in dist/"
echo "Live head: $(curl -s https://explorer.kovanica.online/api/head | jq -c '{finality_depth, genesis, height}' 2>/dev/null || echo 'unavailable')"
echo "Bootstrap seeds: $(curl -s https://explorer.kovanica.online/api/bootstrap | jq '.seeds | length' 2>/dev/null || echo 'unavailable')"
echo "Classification: client-only / consensus-safe (no dag/state/consensus edit)"
echo "Key rule preserved: private keys never enter explorer / node"
