#!/usr/bin/env bash
# Apply KVP-102 HTTP asset_id patch in-tree (from repo root).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PATCH="docs/patches/kvp-102-asset-id.patch"
if [[ ! -f "$PATCH" ]]; then
  echo "missing $PATCH" >&2
  exit 1
fi
if grep -q utxos_detailed_of crates/kovanica-node/src/node.rs 2>/dev/null; then
  echo "already applied (utxos_detailed_of present)"
  exit 0
fi
git apply "$PATCH"
echo "applied $PATCH"
echo "next: cargo test -p kovanica-node && git add crates/kovanica-node/src/*.rs && git commit"
