#!/usr/bin/env bash
# deploy-seed-prebuilt.sh — Deploy a PRE-BUILT kovanica-node binary to a seed VPS.
# 
# Use this for testnet resets where all seeds need the exact same binary.
# Run FROM an operator machine that can SSH to the target.
#
# Usage:
#   ./scripts/deploy-seed-prebuilt.sh <user>@<host> [options]
#
# Options:
#   --name <name>         Seed name (default: seed2; used in unit + data dir)
#   --peers <host:port>   Bootstrap peers (default: seed.kovanica.online:9000,seed2.kovanica.online:9000)
#   --mine                Enable auto-mining (default: off for pure seeds)
#   --mine-secs <n>       Block interval when mining (default: 60)
#   --explorer <port>     Explorer HTTP port (default: 8080)
#   --p2p <port>          P2P listen port (default: 9000)
#   --binary <path>       Path to pre-built kovanica-node binary (default: ./target/release/kovanica-node)
#
# Example:
#   ./scripts/deploy-seed-prebuilt.sh ubuntu@130.61.x.x --name seed2 --mine --binary ./target/release/kovanica-node

set -euo pipefail

TARGET=""
NAME="seed2"
PEERS="seed.kovanica.online:9000,seed2.kovanica.online:9000"
MINE=0
MINE_SECS=60
EXPLORER_PORT=8080
P2P_PORT=9000
BINARY_PATH="./target/release/kovanica-node"

usage() { grep '^#' "$0" | cut -c4-; exit 0; }

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) usage ;;
        --name) NAME="$2"; shift 2 ;;
        --peers) PEERS="$2"; shift 2 ;;
        --mine) MINE=1; shift ;;
        --mine-secs) MINE_SECS="$2"; shift 2 ;;
        --explorer) EXPLORER_PORT="$2"; shift 2 ;;
        --p2p) P2P_PORT="$2"; shift 2 ;;
        --binary) BINARY_PATH="$2"; shift 2 ;;
        *)
            if [[ -z "$TARGET" ]]; then TARGET="$1"; else echo "Unknown argument: $1"; usage; fi
            shift ;;
    esac
done

[[ -z "$TARGET" ]] && { echo "Error: <user>@<host> required"; usage; }
[[ ! -f "$BINARY_PATH" ]] && { echo "Error: binary not found at $BINARY_PATH"; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_DATA="/var/lib/kovanica-$NAME"

echo "=== Kovanica seed deploy (prebuilt): $NAME -> $TARGET ==="
echo "Binary: $BINARY_PATH"
echo "Peers: $PEERS"
echo "Mining: $MINE (${MINE_SECS}s)"
echo "Data dir: $REMOTE_DATA"

# Verify binary architecture
echo "[1/6] Verifying binary..."
file "$BINARY_PATH" | grep -q "ELF 64-bit LSB" || { echo "Error: binary is not 64-bit ELF"; exit 1; }

echo "[2/6] Stopping existing service..."
ssh "$TARGET" "sudo systemctl stop kovanica-$NAME 2>/dev/null || true"
ssh "$TARGET" "sudo systemctl disable kovanica-$NAME 2>/dev/null || true"

echo "[3/6] Wiping data directory for clean genesis..."
ssh "$TARGET" "sudo rm -rf '$REMOTE_DATA' && sudo mkdir -p '$REMOTE_DATA'"

echo "[4/6] Deploying binary..."
ssh "$TARGET" "sudo mkdir -p /usr/local/bin"
scp -q "$BINARY_PATH" "$TARGET:/tmp/kovanica-node"
ssh "$TARGET" "sudo mv /tmp/kovanica-node /usr/local/bin/kovanica-node && sudo chmod 755 /usr/local/bin/kovanica-node"

echo "[5/6] Installing service..."
ssh "$TARGET" "sudo tee /etc/systemd/system/kovanica-$NAME.service >/dev/null <<EOF
[Unit]
Description=Kovanica seed node ($NAME)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DATA
Environment=KOVANICA_LISTEN=0.0.0.0:$P2P_PORT
Environment=KOVANICA_POW=1
Environment=KOVANICA_PEERS=$PEERS
Environment=KOVANICA_OPERATOR=1
Environment=KOVANICA_MINE=$MINE
Environment=KOVANICA_MINE_SECS=$MINE_SECS
Environment=KOVANICA_FAUCET=0
Environment=KOVANICA_ALLOW_RESET=0
Environment=KOVANICA_DATA=$REMOTE_DATA
ExecStart=/usr/local/bin/kovanica-node explorer 127.0.0.1:$EXPLORER_PORT
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now kovanica-$NAME"

echo "[6/6] Firewall (P2P $P2P_PORT open, explorer/metrics loopback-only)..."
ssh "$TARGET" "command -v ufw >/dev/null && sudo ufw allow ${P2P_PORT}/tcp comment 'Kovanica P2P' >/dev/null || true"

echo "Waiting for genesis verification..."
sleep 10

# Verify genesis hash matches expected
EXPECTED_GENESIS="9565fc20cb465eec0198a65c07da6b825e4211c4060d581a2c7dac6c96bafc97"
NEW_HEAD=$(ssh "$TARGET" "curl -sS --max-time 15 http://127.0.0.1:$EXPLORER_PORT/api/head || true")
NEW_GENESIS=$(echo "$NEW_HEAD" | python3 -c "import json,sys; print(json.load(sys.stdin).get('genesis',''))" 2>/dev/null || echo "ERROR")

if [[ "$NEW_GENESIS" == "$EXPECTED_GENESIS" ]]; then
    echo "=== OK: $NAME genesis matches expected ($NEW_GENESIS) ==="
else
    echo "=== WARNING: genesis mismatch! Expected: $EXPECTED_GENESIS, Got: $NEW_GENESIS ==="
    echo "Check logs: ssh $TARGET journalctl -u kovanica-$NAME -n 100"
    exit 1
fi

# Verify peer connectivity
sleep 5
PEER_COUNT=$(ssh "$TARGET" "curl -sS --max-time 10 http://127.0.0.1:$EXPLORER_PORT/api/head | python3 -c \"import json,sys; d=json.load(sys.stdin); print(len(d.get('peers',[])))\" 2>/dev/null || echo 0")
echo "Peer count: $PEER_COUNT"

# Verify block production
sleep 30
HEIGHT=$(ssh "$TARGET" "curl -sS --max-time 10 http://127.0.0.1:$EXPLORER_PORT/api/head | python3 -c \"import json,sys; d=json.load(sys.stdin); print(d.get('blocks',0))\" 2>/dev/null || echo 0")
echo "Block height after 30s: $HEIGHT"

cat <<EOF

=== Seed $NAME deployed successfully ===
  P2P       : ${TARGET#*@}:${P2P_PORT}
  Explorer  : loopback :$EXPLORER_PORT (ssh -L $EXPLORER_PORT:127.0.0.1:$EXPLORER_PORT $TARGET)
  Metrics   : loopback :9090
  Service   : systemctl status kovanica-$NAME
  Data      : $REMOTE_DATA
  Genesis   : $EXPECTED_GENESIS

Next: Deploy to other seeds, then verify cross-seed connectivity.
EOF