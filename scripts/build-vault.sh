#!/usr/bin/env bash
# build-vault.sh — regenerate the Obsidian vault from the monorepo docs.
#
#   ./scripts/build-vault.sh                    # build + verify
#   ./scripts/build-vault.sh --include-sensitive  # also vendor infra runbooks
#   ./scripts/build-vault.sh --with-agent-config # also vendor .opencode doctrine
#   ./scripts/build-vault.sh --zip              # build, verify, then emit transfer zips
#   ./scripts/build-vault.sh --no-verify        # skip verification
#
# The vault lives at ./vault, is gitignored by this repo, and is its own git
# repo. Only ./vault/90-Notes/ is hand-maintained; everything else is a
# projection of the docs in this repo and is safe to overwrite.
#
# Docs-only tool: no consensus, ledger, or node behaviour is touched.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$REPO/scripts/build-vault.py"
VERIFY="$REPO/scripts/verify-vault.py"
VAULT="$REPO/vault"
OUT="$REPO/dist"

DO_VERIFY=1
DO_ZIP=0
PASSTHRU=()

for arg in "$@"; do
  case "$arg" in
    --no-verify) DO_VERIFY=0 ;;
    --zip)       DO_ZIP=1 ;;
    *)           PASSTHRU+=("$arg") ;;
  esac
done

echo "==> building vault"
python3 "$BUILD" ${PASSTHRU[@]+"${PASSTHRU[@]}"}

if [ "$DO_VERIFY" -eq 1 ]; then
  echo "==> verifying"
  python3 "$VERIFY"
fi

# Commit before packaging. The -git zip embeds .git, so an uncommitted
# working tree would ship as a dirty repo that conflicts on the phone's first
# pull. Only the vault's own repo is touched here — never the monorepo.
if [ -d "$VAULT/.git" ]; then
  if [ -n "$(git -C "$VAULT" status --porcelain)" ]; then
    echo "==> committing vault"
    git -C "$VAULT" add -A
    git -C "$VAULT" commit -q -m "vault: refresh from monorepo docs"
    echo "    $(git -C "$VAULT" rev-parse --short HEAD)"
  else
    echo "==> vault already clean ($(git -C "$VAULT" rev-parse --short HEAD))"
  fi
fi

if [ "$DO_ZIP" -eq 1 ]; then
  echo "==> packaging"
  mkdir -p "$OUT"
  STAMP="$(date +%Y%m%d)"

  # Clean copy: drop git history, caches and OS noise. For Obsidian Sync,
  # iCloud, or a read-only phone snapshot.
  rm -f "$OUT/kovanica-vault-$STAMP.zip"
  zip -rq "$OUT/kovanica-vault-$STAMP.zip" vault \
    -x 'vault/.git/*' 'vault/.trash/*' '*/.DS_Store' '*/._*'

  # Full copy: keeps .git so the phone can pull/push immediately.
  rm -f "$OUT/kovanica-vault-git-$STAMP.zip"
  zip -rq "$OUT/kovanica-vault-git-$STAMP.zip" vault \
    -x 'vault/.trash/*' '*/.DS_Store' '*/._*'

  echo
  ls -lh "$OUT"/*.zip
  echo
  echo "clean : $OUT/kovanica-vault-$STAMP.zip"
  echo "git   : $OUT/kovanica-vault-git-$STAMP.zip  (includes .git, two-way sync)"
fi
