#!/usr/bin/env bash
# sync-vault.sh — Sync kovanica-protocol docs to Obsidian-Vault
# Run from kovanica-protocol root or pass --source /path/to/kovanica-protocol

set -euo pipefail

SRC="${1:-/root/kovanica-protocol}"
DST="/root/Obsidian-Vault/KovanicaDAG"

if [[ ! -d "$SRC" ]]; then
  echo "Source not found: $SRC"
  exit 1
fi

echo "Syncing from $SRC → $DST"

# 1. Root-level docs (authoritative project docs)
cp "$SRC/AGENTS.md" "$DST/AGENTS.md"
cp "$SRC/OPERATIONS.md" "$DST/OPERATIONS.md"
cp "$SRC/TESTNET.md" "$DST/TESTNET.md"
cp "$SRC/README.md" "$DST/README.md"
cp "$SRC/REINDEX_BENCHMARKING.md" "$DST/REINDEX_BENCHMARKING.md" 2>/dev/null || true
cp "$SRC/TODO.md" "$DST/TODO.md"
# PROJECT.md, TEST_INFRA.md, TEST_READY.md are stale planning docs — not synced
# (TODO.md was un-synced until 2026-08-24; it is actively maintained again)

# 2. Config snapshots (context only)
cp "$SRC/Cargo.toml" "$DST/Cargo.toml"
cp "$SRC/Cargo.lock" "$DST/Cargo.lock"
cp "$SRC/ecosystem.config.js" "$DST/ecosystem.config.js"
cp "$SRC/tsconfig.json" "$DST/tsconfig.json"

# 3. Web config snapshots
cp "$SRC/web/package.json" "$DST/package.json" 2>/dev/null || true
cp "$SRC/web/package-lock.json" "$DST/package-lock.json" 2>/dev/null || true
cp "$SRC/web/vite.config.ts" "$DST/vite.config.ts" 2>/dev/null || true
cp "$SRC/web/eslint.config.mjs" "$DST/eslint.config.mjs" 2>/dev/null || true

# 4. Crate READMEs (if they exist)
cp "$SRC/crates/kovanica-dag/README.md" "$DST/kovanica-dag-README.md" 2>/dev/null || true
cp "$SRC/crates/kovanica-state/README.md" "$DST/kovanica-state-README.md" 2>/dev/null || true
cp "$SRC/crates/kovanica-node/README.md" "$DST/kovanica-node-README.md" 2>/dev/null || true
cp "$SRC/crates/kovanica-cli/README.md" "$DST/kovanica-cli-README.md" 2>/dev/null || true

# 5. Web docs
cp "$SRC/web/README.md" "$DST/web-README.md" 2>/dev/null || true
cp "$SRC/web/DEPLOY.md" "$DST/web-DEPLOY.md" 2>/dev/null || true

# 6. Node operator docs from docs/vault (if they exist)
cp "$SRC/docs/vault/kovanica-node/JOIN.md" "$DST/kovanica-node/JOIN.md" 2>/dev/null || true
cp "$SRC/docs/vault/kovanica-node/TESTNET.md" "$DST/kovanica-node/TESTNET.md" 2>/dev/null || true

echo "Sync complete. Review changes:"
cd "$DST/.." && git status --short