#!/usr/bin/env bash
# Kovanica Protocol — Fly.io Deploy
#
# Deploys a Kovanica node to Fly.io (container-based).
# Free tier available (3 shared VMs).
#
# Usage:
#   fly deploy
#   # or:
#   ./fly-deploy.sh

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

command -v flyctl >/dev/null 2>&1 || command -v fly >/dev/null 2>&1 || die "Install flyctl: https://fly.io/docs/hands-on/install-flyctl/"

FLY="flyctl"
command -v flyctl >/dev/null 2>&1 || FLY="fly"

cd "$(dirname "$0")"

# Check if app exists
if ! $FLY apps list 2>/dev/null | grep -q "kovanica"; then
    info "Creating Fly.io app..."
    $FLY launch --no-deploy --name kovanica-node 2>/dev/null || true
fi

# Create volume for chain data
info "Creating persistent volume..."
$FLY volumes create kovanica_data --region ord --size 5 2>/dev/null || true

# Deploy
info "Deploying..."
$FLY deploy

echo ""
echo -e "${GREEN}  Deployed to Fly.io!${NC}"
$FLY status
echo ""
echo -e "  Logs:     ${CYAN}$FLY logs${NC}"
echo -e "  SSH:      ${CYAN}$FLY ssh console${NC}"
echo -e "  Explorer: ${BLUE}https://kovanica-node.fly.dev${NC}"
echo ""
