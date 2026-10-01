#!/usr/bin/env bash
# Kovanica Protocol — Azure VM Deploy
#
# Usage:
#   ./azure-deploy.sh --location eastus --size Standard_B2s

set -euo pipefail

LOCATION="eastus"
SIZE="Standard_B2s"
NAME="kovanica-node"
RESOURCE_GROUP="kovanica-rg"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
    case $1 in
        --location) LOCATION="$2"; shift 2 ;;
        --size)     SIZE="$2"; shift 2 ;;
        --name)     NAME="$2"; shift 2 ;;
        *)          die "Unknown: $1" ;;
    esac
done

command -v az >/dev/null 2>&1 || die "Install Azure CLI: https://docs.microsoft.com/cli/azure/install-azure-cli"

# Create resource group
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

# Create VM
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

info "Creating Azure VM..."
az vm create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$NAME" \
    --image Ubuntu2204 \
    --size "$SIZE" \
    --admin-username azureuser \
    --generate-ssh-keys \
    --custom-data "$USER_DATA" \
    --output none

# Open ports
az vm open-port --resource-group "$RESOURCE_GROUP" --name "$NAME" --port 9000 --output none
az vm open-port --resource-group "$RESOURCE_GROUP" --name "$NAME" --port 8080 --output none

PUBLIC_IP=$(az vm show --resource-group "$RESOURCE_GROUP" --name "$NAME" --show-details --query publicIps --output tsv)

echo ""
echo -e "${GREEN}  VM ready!${NC}"
echo -e "  SSH:     ${CYAN}ssh azureuser@${PUBLIC_IP}${NC}"
echo -e "  Explorer: ${BLUE}http://${PUBLIC_IP}:8080${NC}"
echo ""
