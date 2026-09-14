#!/usr/bin/env bash
set -euo pipefail

DST="/root/kovanica"

for repo in kovanica-protocol kovanica-wallet kovanica-web kovanica-mobile kovanica-agent kovanica-installer; do
  d="$DST/$repo"
  if [ -d "$d/.git" ]; then
    echo "----- $repo -----"
    (cd "$d" && git log --oneline -3 && git status --short && echo "OK")
  else
    echo "----- $repo (no .git) -----"
  fi
done

echo ""
echo "=== VERIFICATION COMPLETE ==="
