#!/usr/bin/env bash
set -euo pipefail

HOME_DIR=/root
SRC="$HOME_DIR/kovanica-protocol"
DST="$HOME_DIR/kovanica"
BACKUP_DIR="$HOME_DIR/kovanica-restructure-backup-$$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup
cd "$SRC"
tar -czf "$BACKUP_DIR/protocol-full.tar.gz" -C "$HOME_DIR" kovanica-protocol

# Move standalone repos
for repo in kovanica-node kovanica-agent kovanica-installer; do
  if [ -d "$HOME_DIR/$repo" ]; then
    echo "== mv $repo (standalone) =="
    mv "$HOME_DIR/$repo" "$DST/$repo"
  fi
done
[ -d "$HOME_DIR/kovanica-data" ] && mv "$HOME_DIR/kovanica-data" "$DST/kovanica-data"

# Split kovanica-wallet
rm -rf "$DST/kovanica-wallet"
git clone --no-local "$SRC" "$DST/kovanica-wallet"
cd "$DST/kovanica-wallet"

# Filter repo (extract wallet-extension, web, android-light-node)
git filter-repo \
  --path kovanica-wallet \
  --path wallet-extension \
  --path-rename kovanica-wallet/android:android \
  --path-rename kovanica-wallet/ios:ios \
  --path-rename kovanica-wallet/shared:shared \
  --path-rename kovanica-wallet/extension:extension \
  --force

# Clean empty dirs
find . -type d -empty -delete 2>/dev/null || true

# Clean up old dirs
rm -rf kovanica-wallet wallet-extension web web-deploy android-light-node

# Clean Cargo.toml workspace members
if [ -f Cargo.toml ]; then
  sed -i \
    -e '/^\[workspace\]\/,/^\[project\]/d' \
    -e 's/# kovanica-wallet/d//g' \
    Cargo.toml || true
fi

git add -A

echo ""
echo "=== RESTRUCTURE DONE ==="
echo "Layout:"
ls -la "$DST"
echo ""
echo "Backup: $BACKUP_DIR"
echo "Next: run verification script"
