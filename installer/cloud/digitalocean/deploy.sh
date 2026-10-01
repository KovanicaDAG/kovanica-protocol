#!/usr/bin/env bash
# Kovanica Protocol — DigitalOcean Droplet Deploy
#
# Usage:
#   ./do-deploy.sh --region nyc3 --size s-2vcpu-4gb

set -euo pipefail

REGION="nyc3"
SIZE="s-2vcpu-4gb"
NAME="kovanica-node"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
    case $1 in
        --region)   REGION="$2"; shift 2 ;;
        --size)     SIZE="$2"; shift 2 ;;
        --name)     NAME="$2"; shift 2 ;;
        *)          die "Unknown: $1" ;;
    esac
done

command -v doctl >/dev/null 2>&1 || die "Install doctl: https://docs.digitalocean.com/reference/doctl/how-to/install/"

USER_DATA=$(cat <<'UDF'
#!/bin/bash
set -euo pipefail
apt-get update -qq && apt-get install -y -qq curl build-essential pkg-config git
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source /root/.cargo/env
git clone --depth 1 https://github.com/KovanicaDAG/kovanica-protocol.git /opt/kovanica
cd /opt/kovanica && cargo build --release -p kovanica-node
cp target/release/kovanica-node /usr/local/bin/
mkdir -p /var/lib/kovanica
cat > /etc/systemd/system/kovanica-node.service <<'EOF'
[Unit]
Description=Kovanica BlockDAG Node
After=network-online.target
[Service]
Type=simple
ExecStart=/usr/local/bin/kovanica-node serve
Restart=on-failure
RestartSec=5
Environment=KOVANICA_DATA=/var/lib/kovanica
Environment=KOVANICA_P2P_PORT=9000
Environment=KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now kovanica-node
UDF
)

info "Creating Droplet..."
DROPLET_ID=$(doctl compute droplet create "$NAME" \
    --region "$REGION" \
    --size "$SIZE" \
    --image ubuntu-22-04-x64 \
    --user-data "$USER_DATA" \
    --format ID \
    --no-header)

info "Waiting for Droplet..."
sleep 30

PUBLIC_IP=$(doctl compute droplet get "$DROPLET_ID" --format PublicIPv4 --no-header)

echo ""
echo -e "${GREEN}  Droplet ready!${NC}"
echo -e "  IP:      ${PUBLIC_IP}"
echo -e "  SSH:     ${CYAN}ssh root@${PUBLIC_IP}${NC}"
echo -e "  Explorer: ${BLUE}http://${PUBLIC_IP}:8080${NC}"
echo ""
