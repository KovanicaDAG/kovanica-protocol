#!/usr/bin/env bash
# tuning-review.sh — Run on VPS to collect soak data for tuning review.
# Captures: block rate, peer count, disk usage, difficulty, process info.
# After 1-2 weeks of soak, run this and share output for tuning decisions.
#
# Usage: bash scripts/testnet/tuning-review.sh
# Output: prints JSON summary to stdout

set -euo pipefail

EXPLORER="${EXPLORER_URL:-http://127.0.0.1:8080}"
DATA_DIR=""

# --- Discover data directory ---
for candidate in \
  /root/.kovanica \
  /var/lib/kovanica \
  "$(getent passwd kovanica 2>/dev/null | cut -d: -f6)/.kovanica" \
  /opt/kovanica; do
  if [ -d "$candidate" ] 2>/dev/null; then
    DATA_DIR="$candidate"
    break
  fi
done
# Fallback: find from running process
if [ -z "$DATA_DIR" ]; then
  PID=$(pgrep -n kovanica-node 2>/dev/null || true)
  if [ -n "$PID" ]; then
    DATA_DIR=$(strings /proc/"$PID"/environ 2>/dev/null | grep '^KOVANICA_DATA=' | cut -d= -f2 || true)
  fi
fi

echo "=== Kovanica Tuning Review — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo ""

# --- API data ---
echo "--- /api/head ---"
HEAD=$(curl -s --connect-timeout 5 "$EXPLORER/api/head" 2>/dev/null || echo "{}")
echo "$HEAD" | python3 -m json.tool 2>/dev/null || echo "$HEAD"

echo ""
echo "--- /api/p2p ---"
P2P=$(curl -s --connect-timeout 5 "$EXPLORER/api/p2p" 2>/dev/null || echo "{}")
echo "$P2P" | python3 -m json.tool 2>/dev/null || echo "$P2P"

echo ""
echo "--- Wallets & Tips (from /api/state) ---"
STATE=$(curl -s --connect-timeout 5 "$EXPLORER/api/state" 2>/dev/null || echo "{}")
echo "$STATE" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    wallets = d.get('wallets', [])
    tips = d.get('tips', [])
    pending = d.get('pending', [])
    active_wallets = sum(1 for w in wallets if w.get('balance', 0) > 0)
    total_balance = sum(w.get('balance', 0) for w in wallets)
    print(f'Active wallets: {active_wallets}')
    print(f'Total balance: {total_balance:,} uK ({total_balance/1e8:.4f} K)')
    print(f'Tips: {len(tips)}')
    print(f'Pending txs: {len(pending)}')
except Exception as e:
    print(f'Parse error: {e}')
"

# --- Process info ---
echo ""
echo "--- Processes ---"
ps aux | grep kovanica | grep -v grep || true

echo ""
echo "--- Systemd units ---"
systemctl list-units --type=service --all 2>/dev/null | grep kovanica || true

# --- Disk usage ---
echo ""
echo "--- Disk usage ---"
if [ -n "$DATA_DIR" ]; then
  echo "Data dir: $DATA_DIR"
  du -sh "$DATA_DIR" 2>/dev/null || echo "Cannot measure"
else
  echo "Data dir: UNKNOWN"
  echo "Find it: find / -name 'genesis.bin' -path '*kovanica*' 2>/dev/null"
fi
# Overall disk
echo "Root filesystem:"
df -h / | tail -1

# --- Block rate estimate ---
echo ""
echo "--- Block rate estimate ---"
HEIGHT=$(echo "$HEAD" | python3 -c "import json,sys; print(json.load(sys.stdin).get('blocks',0))" 2>/dev/null || echo "0")
echo "Current height: $HEIGHT"
echo "Expected at 1 block/min since genesis (2026-08-24): ~$(($(date +%s) - $(date -d '2026-08-24' +%s 2>/dev/null || echo $(($(date +%s)-259200))) / 60)) blocks"

# --- System resources ---
echo ""
echo "--- System resources ---"
echo "Uptime:"
uptime
echo "Memory:"
free -h | head -2
echo "CPU cores: $(nproc)"

# --- Go pool status ---
echo ""
echo "--- Mining pool ---"
pgrep -a kovanica-pool 2>/dev/null || echo "go-pool not running"

echo ""
echo "=== End tuning review ==="
echo "Send this output to orchestrator for tuning decisions."
