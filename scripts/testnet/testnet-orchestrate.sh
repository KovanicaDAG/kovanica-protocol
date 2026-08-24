#!/usr/bin/env bash
# testnet-orchestrate.sh — Orchestrate multi-seed testnet deployment
#
# Usage:
#   ./testnet-orchestrate.sh <config-file>
#
# Config file format (JSON):
# {
#   "seeds": [
#     {"name": "seed1", "ip": "1.2.3.4", "region": "us-east"},
#     {"name": "seed2", "ip": "5.6.7.8", "region": "eu-west"},
#     {"name": "seed3", "ip": "9.10.11.12", "region": "ap-south"}
#   ],
#   "testnet": {
#     "k": 3,
#     "finality_depth": 1000,
#     "pruning_depth": 2000,
#     "difficulty_window": 1440,
#     "pow": true,
#     "mine_secs": 120
#   }
# }

set -euo pipefail

CONFIG_FILE="${1:-}"

if [[ -z "$CONFIG_FILE" || ! -f "$CONFIG_FILE" ]]; then
    echo "Usage: $0 <config-file>"
    exit 1
fi

# Parse config
SEEDS=$(jq -c '.seeds[]' "$CONFIG_FILE")
K=$(jq -r '.testnet.k // 3' "$CONFIG_FILE")
FINALITY_DEPTH=$(jq -r '.testnet.finality_depth // 1000' "$CONFIG_FILE")
PRUNING_DEPTH=$(jq -r '.testnet.pruning_depth // 2000' "$CONFIG_FILE")
DIFFICULTY_WINDOW=$(jq -r '.testnet.difficulty_window // 1440' "$CONFIG_FILE")
POW=$(jq -r '.testnet.pow // true' "$CONFIG_FILE")
MINE_SECS=$(jq -r '.testnet.mine_secs // 120' "$CONFIG_FILE")

echo "=== Testnet Orchestration ==="
echo "Config: $CONFIG_FILE"
echo "Parameters: k=$K, finality=$FINALITY_DEPTH, pruning=$PRUNING_DEPTH, window=$DIFFICULTY_WINDOW, pow=$POW, mine_secs=$MINE_SECS"

# Build release
echo "Building release binary..."
cargo build --release -p kovanica-node

BINARY="./target/release/kovanica-node"

# Deploy each seed
echo "$SEEDS" | while IFS= read -r seed; do
    NAME=$(echo "$seed" | jq -r '.name')
    IP=$(echo "$seed" | jq -r '.ip')
    REGION=$(echo "$seed" | jq -r '.region // "unknown"')
    
    echo "Deploying $NAME at $IP ($REGION)..."
    
    # SSH deploy
    ssh "$IP" "mkdir -p ~/kovanica"
    scp target/release/kovanica-node "$IP:~/kovanica/"
    
    # Create remote service
    ssh "$IP" bash <<EOF
        cat > /etc/systemd/system/kovanica-seed.service <<SVC
[Unit]
Description=Kovanica Testnet Seed
After=network.target

[Service]
Type=simple
User=\$USER
WorkingDirectory=/home/\$USER/kovanica
Environment="KOVANICA_LISTEN=0.0.0.0:9000"
Environment="KOVANICA_P2P_LISTEN=0.0.0.0:9000"
Environment="KOVANICA_PEERS=off"
Environment="KOVANICA_POW=1"
Environment="KOVANICA_MINE=1"
Environment="KOVANICA_MINE_SECS=120"
Environment="KOVANICA_TAP=0"
Environment="KOVANICA_FAUCET=0"
Environment="KOVANICA_OPERATOR=1"
Environment="KOVANICA_ALLOW_RESET=0"
Environment="KOVANICA_DATA=/var/lib/kovanica/seed"
Environment="KOVANICA_K=$K"
Environment="KOVANICA_FINALITY_DEPTH=$FINALITY_DEPTH"
Environment="KOVANICA_PRUNING_DEPTH=$PRUNING_DEPTH"
Environment="KOVANICA_DIFFICULTY_WINDOW=$DIFFICULTY_WINDOW"
ExecStart=/home/\$USER/kovanica/kovanica-node explorer 0.0.0.0:8080
Restart=always
RestartSec=10
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
SVC

        sudo mkdir -p /var/lib/kovanica/seed
        sudo chown -R \$USER:\$USER /var/lib/kovanica/seed
        sudo systemctl daemon-reload
        sudo systemctl enable --now kovanica-seed
        sudo ufw allow 9000/tcp comment "Kovanica P2P"
        sudo ufw allow 8080/tcp comment "Kovanica Explorer"
        sudo ufw allow 9090/tcp comment "Kovanica Prometheus"
EOF

    echo "Seed $NAME deployed"
done

echo ""
echo "=== All seeds deployed ==="
echo ""
echo "Next steps:"
echo "1. Register DNS A records for each seed:"
jq -r '.seeds[] | "  \(.name).kovanica.online -> \(.ip)"' "$CONFIG_FILE"
echo ""
echo "2. Verify seeds are running:"
jq -r '.seeds[] | "  ssh \(.ip) \"systemctl status kovanica-seed\"' "$CONFIG_FILE"
echo ""
echo "3. Start monitoring:"
echo "  python3 scripts/testnet/testnet-measure.py --explorer http://seed1:8080 --duration 3600 --output metrics.json"
echo ""
echo "4. Run parameter tuning:"
echo "  python3 scripts/testnet/testnet-tune.py --duration 600"