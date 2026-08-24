#!/usr/bin/env bash
# testnet-seed-deploy.sh — Deploy a Kovanica testnet seed node
#
# Usage:
#   ./testnet-seed-deploy.sh <seed-name> <public-ip> [options]
#
# Options:
#   --region <region>      Cloud region (default: auto-detect)
#   --dns-name <name>      DNS name to register (default: seed-<name>.kovanica.online)
#   --no-dns               Skip DNS registration
#   --prometheus-port <p>  Prometheus metrics port (default: 9090)
#   --explorer-port <p>    Explorer HTTP port (default: 8080)
#   --p2p-port <p>         P2P listen port (default: 9000)
#   --finality-depth <n>   Finality depth (default: 1000)
#   --pruning-depth <n>    Payload pruning depth (default: 2000)
#   --difficulty-window <n> Difficulty window (default: 1440)
#   -h, --help             Show this help

set -euo pipefail

SEED_NAME=""
PUBLIC_IP=""
REGION="auto"
DNS_NAME=""
SKIP_DNS=false
PROMETHEUS_PORT=9090
EXPLORER_PORT=8080
P2P_PORT=9000
FINALITY_DEPTH=1000
PRUNING_DEPTH=2000
DIFFICULTY_WINDOW=1440
BINARY_PATH="./target/release/kovanica-node"

usage() {
    grep '^#' "$0" | cut -c4-
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) usage ;;
        --region) REGION="$2"; shift 2 ;;
        --dns-name) DNS_NAME="$2"; shift 2 ;;
        --no-dns) SKIP_DNS=true; shift ;;
        --prometheus-port) PROMETHEUS_PORT="$2"; shift 2 ;;
        --explorer-port) EXPLORER_PORT="$2"; shift 2 ;;
        --p2p-port) P2P_PORT="$2"; shift 2 ;;
        --finality-depth) FINALITY_DEPTH="$2"; shift 2 ;;
        --pruning-depth) PRUNING_DEPTH="$2"; shift 2 ;;
        --difficulty-window) DIFFICULTY_WINDOW="$2"; shift 2 ;;
        --binary) BINARY_PATH="$2"; shift 2 ;;
        *) 
            if [[ -z "$SEED_NAME" ]]; then SEED_NAME="$1"; 
            elif [[ -z "$PUBLIC_IP" ]]; then PUBLIC_IP="$1";
            else echo "Unknown argument: $1"; usage; fi
            shift ;;
    esac
done

if [[ -z "$SEED_NAME" || -z "$PUBLIC_IP" ]]; then
    echo "Error: seed-name and public-ip are required"
    usage
fi

if [[ -z "$DNS_NAME" ]]; then
    DNS_NAME="seed-${SEED_NAME}.kovanica.online"
fi

echo "=== Deploying testnet seed: ${SEED_NAME} ==="
echo "Public IP: ${PUBLIC_IP}"
echo "DNS Name: ${DNS_NAME}"
echo "P2P Port: ${P2P_PORT}"
echo "Explorer Port: ${EXPLORER_PORT}"
echo "Prometheus Port: ${PROMETHEUS_PORT}"
echo "Finality Depth: ${FINALITY_DEPTH}"
echo "Pruning Depth: ${PRUNING_DEPTH}"
echo "Difficulty Window: ${DIFFICULTY_WINDOW}"
echo "Binary: ${BINARY_PATH}"

# Build release binary
echo "Building release binary..."
cargo build --release -p kovanica-node

# Create systemd service
SERVICE_FILE="/etc/systemd/system/kovanica-seed-${SEED_NAME}.service"
sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Kovanica Testnet Seed ${SEED_NAME}
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=$(pwd)
Environment="KOVANICA_LISTEN=0.0.0.0:${P2P_PORT}"
Environment="KOVANICA_P2P_LISTEN=0.0.0.0:${P2P_PORT}"
Environment="KOVANICA_PEERS=off"
Environment="KOVANICA_POW=1"
Environment="KOVANICA_MINE=1"
Environment="KOVANICA_MINE_SECS=120"
Environment="KOVANICA_TAP=0"
Environment="KOVANICA_FAUCET=0"
Environment="KOVANICA_OPERATOR=1"
Environment="KOVANICA_ALLOW_RESET=0"
Environment="KOVANICA_DATA=/var/lib/kovanica/${SEED_NAME}"
Environment="RUST_LOG=info,kovanica_node=debug"
ExecStart=$(pwd)/target/release/kovanica-node explorer 0.0.0.0:${EXPLORER_PORT}
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

# Create data directory
sudo mkdir -p "/var/lib/kovanica/${SEED_NAME}"
sudo chown -R "${USER}:${USER}" "/var/lib/kovanica/${SEED_NAME}"

# Configure firewall
sudo ufw allow "${P2P_PORT}/tcp" comment "Kovanica P2P"
sudo ufw allow "${EXPLORER_PORT}/tcp" comment "Kovanica Explorer"
sudo ufw allow "${PROMETHEUS_PORT}/tcp" comment "Kovanica Prometheus"

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable --now "kovanica-seed-${SEED_NAME}"

# Wait for service to start
sleep 5

# Check service status
systemctl status "kovanica-seed-${SEED_NAME}" --no-pager

# Register DNS if not skipped
if [[ "$SKIP_DNS" == false ]]; then
    echo "Registering DNS: ${DNS_NAME} -> ${PUBLIC_IP}"
    # This would use your DNS provider's API
    # Example for Cloudflare:
    # curl -X PUT "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/dns_records/<RECORD_ID>" \
    #   -H "Authorization: Bearer <API_TOKEN>" \
    #   -H "Content-Type: application/json" \
    #   --data '{"type":"A","name":"'"${SEED_NAME}"'","content":"'"${PUBLIC_IP}"'","ttl":300,"proxied":false}'
    echo "DNS registration not automated - please add A record: ${DNS_NAME} -> ${PUBLIC_IP}"
fi

echo "=== Seed ${SEED_NAME} deployed ==="
echo "Explorer: http://${PUBLIC_IP}:${EXPLORER_PORT}"
echo "Prometheus: http://${PUBLIC_IP}:${PROMETHEUS_PORT}/metrics"
echo "P2P: ${PUBLIC_IP}:${P2P_PORT}"
echo "DNS: ${DNS_NAME} (A record -> ${PUBLIC_IP})"
echo ""
echo "Logs: journalctl -u kovanica-seed-${SEED_NAME} -f"