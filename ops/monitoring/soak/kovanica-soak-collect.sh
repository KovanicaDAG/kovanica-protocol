#!/usr/bin/env bash
# Kovanica testnet soak collector.
#
# Appends one metrics sample per run to /var/log/kovanica/soak-<UTC date>.log and
# writes SEV/STALL lines to the matching .alert file. Read-only with respect to
# the node: it only scrapes the local Prometheus endpoint and reads systemd.
#
# Install: /usr/local/bin/kovanica-soak-collect.sh (0755), driven by
# kovanica-soak-collect.timer. See protocol/docs/TESTNET-SOAK.md.
set -u

LOG_DIR=/var/log/kovanica
mkdir -p "$LOG_DIR"

DAY=$(date -u +%Y%m%d)
LOG="$LOG_DIR/soak-$DAY.log"
ALERT="$LOG_DIR/soak-$DAY.alert"
STATE="$LOG_DIR/soak-state"

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Discover the node unit without hardcoding the instance number.
UNIT=$(systemctl list-units --type=service --no-legend 'kovanica-testnet-seed@*.service' 2>/dev/null | awk '{print $1}' | head -1)
if [ -z "$UNIT" ]; then
    echo "$TS SEV1 no kovanica-testnet-seed unit found" >> "$ALERT"
    exit 0
fi

ACTIVE=$(systemctl is-active "$UNIT" 2>/dev/null || true)
RESTARTS=$(systemctl show -p NRestarts --value "$UNIT" 2>/dev/null || echo "?")
MAINPID=$(systemctl show -p MainPID --value "$UNIT" 2>/dev/null || echo "0")

RSS="?"
if [ -n "$MAINPID" ] && [ "$MAINPID" != "0" ] && [ -r "/proc/$MAINPID/status" ]; then
    RSS=$(awk '/^VmRSS/{print $2}' "/proc/$MAINPID/status" 2>/dev/null || echo "?")
fi

M=$(curl -s --max-time 5 http://127.0.0.1:9090/metrics 2>/dev/null || true)
BH=$(printf '%s\n' "$M" | awk '/^kovanica_block_height /{print $2; exit}')
CH=$(printf '%s\n' "$M" | awk '/^kovanica_chain_height /{print $2; exit}')
PC=$(printf '%s\n' "$M" | awk '/^kovanica_peer_count /{print $2; exit}')
BP=$(printf '%s\n' "$M" | awk '/^kovanica_blocks_produced_total /{print $2; exit}')

# Consensus-safety invariant: block pruning must stay disabled (RFC-009).
# Read from the node API rather than a metric, since this is the authoritative
# value and it is the one an operator would check by hand.
HEAD=$(curl -s --max-time 5 http://127.0.0.1:3001/api/head 2>/dev/null || true)
BPD=$(printf '%s' "$HEAD" | sed -n 's/.*"block_pruning_depth":\([0-9]*\).*/\1/p')
if [ -n "$BPD" ] && [ "$BPD" != "18446744073709551615" ]; then
    echo "$TS SEV1 block pruning ENABLED on $UNIT (block_pruning_depth=$BPD) - consensus-unsafe, see RFC-009" >> "$ALERT"
fi

echo "$TS unit=$UNIT active=$ACTIVE restarts=$RESTARTS block_height=${BH:-?} chain_height=${CH:-?} peers=${PC:-?} produced=${BP:-?} rss_kb=$RSS pruning_depth=${BPD:-?}" >> "$LOG"

# --- Stall / restart detection against the previous sample -------------------
PREV=$(cat "$STATE" 2>/dev/null || true)
if [ -n "$PREV" ]; then
    P_RESTARTS=$(printf '%s\n' "$PREV" | sed -n 's/.*restarts=\([0-9]*\).*/\1/p')
    P_BH=$(printf '%s\n' "$PREV" | sed -n 's/.*block_height=\([0-9]*\).*/\1/p')
    P_STALL=$(printf '%s\n' "$PREV" | sed -n 's/.*stall=\([0-9]*\).*/\1/p')

    if [ "$ACTIVE" != "active" ]; then
        echo "$TS SEV1 $UNIT not active (active=$ACTIVE)" >> "$ALERT"
    fi

    if [ -n "$RESTARTS" ] && [ "$RESTARTS" != "?" ] && [ -n "$P_RESTARTS" ] && [ "$RESTARTS" != "$P_RESTARTS" ]; then
        echo "$TS SEV2 restart detected on $UNIT ($P_RESTARTS -> $RESTARTS)" >> "$ALERT"
    fi

    if [ -n "$BH" ] && [ -n "$P_BH" ] && [ "$BH" = "$P_BH" ]; then
        STALL=$(( ${P_STALL:-0} + 1 ))
    else
        STALL=0
    fi
    if [ "$STALL" -ge 3 ]; then
        echo "$TS STALL block_height unchanged for $STALL samples at ${BH:-?}" >> "$ALERT"
    fi
else
    STALL=0
fi

printf '%s\n' "$TS active=$ACTIVE restarts=$RESTARTS block_height=${BH:-?} chain_height=${CH:-?} peers=${PC:-?} produced=${BP:-?} rss_kb=$RSS stall=$STALL" > "$STATE"
