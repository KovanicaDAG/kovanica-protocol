#!/usr/bin/env bash
# Kovanica Protocol — GCP Compute Engine Deploy
#
# Usage:
#   ./gcp-deploy.sh --zone us-central1-a --type e2-medium

set -euo pipefail

ZONE="us-central1-a"
MACHINE_TYPE="e2-medium"
NAME="kovanica-node"
IMAGE_FAMILY="debian-12"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
    case $1 in
        --zone)     ZONE="$2"; shift 2 ;;
        --type)     MACHINE_TYPE="$2"; shift 2 ;;
        --name)     NAME="$2"; shift 2 ;;
        *)          die "Unknown: $1" ;;
    esac
done

command -v gcloud >/dev/null 2>&1 || die "Install gcloud CLI: https://cloud.google.com/sdk/docs/install"

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

info "Launching GCP instance..."
gcloud compute instances create "$NAME" \
    --zone="$ZONE" \
    --machine-type="$MACHINE_TYPE" \
    --image-family="$IMAGE_FAMILY" \
    --image-project=debian-cloud \
    --tags=kovanica \
    --metadata=startup-script="$USER_DATA" \
    --scopes=default

EXTERNAL_IP=$(gcloud compute instances describe "$NAME" --zone="$ZONE" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

# Open firewall
gcloud compute firewall-rules create kovanica-p2p --allow=tcp:9000 --source-ranges=0.0.0.0/0 2>/dev/null || true
gcloud compute firewall-rules create kovanica-http --allow=tcp:8080 --source-ranges=0.0.0.0/0 2>/dev/null || true

echo ""
echo -e "${GREEN}  Instance ready!${NC}"
echo -e "  SSH:     ${CYAN}gcloud compute ssh ${NAME} --zone=${ZONE}${NC}"
echo -e "  IP:      ${EXTERNAL_IP}"
echo -e "  Explorer: ${BLUE}http://${EXTERNAL_IP}:8080${NC}"
echo ""
