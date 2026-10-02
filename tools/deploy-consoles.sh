#!/bin/bash
# Deploy Kovanica Web Consoles to VPS
# Usage: ./deploy-consoles.sh [vps-user] [vps-host] [ssh-key-path]

set -euo pipefail

VPS_USER="${1:-kovanica}"
VPS_HOST="${2:-explorer.kovanica.online}"
SSH_KEY="${3:-~/.ssh/kovanica-deploy}"

LOCAL_CONSOLE_DIR="/root/kovanica/mobile/console/kovanica"
LOCAL_ENTERPRISE_DIR="/root/kovanica/mobile/console/enterprise"
REMOTE_BASE="/opt/kovanica"

echo "=== Deploying Kovanica Web Consoles ==="
echo "Target: ${VPS_USER}@${VPS_HOST}"
echo "SSH Key: ${SSH_KEY}"
echo ""

# Build locally first
echo "Building Kovanica Console..."
cd "${LOCAL_CONSOLE_DIR}"
npm run build

echo "Building Enterprise Console..."
cd "${LOCAL_ENTERPRISE_DIR}"
npm run build

# Sync to VPS
echo ""
echo "Syncing to VPS..."

rsync -avz --delete \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no" \
  "${LOCAL_CONSOLE_DIR}/dist/" \
  "${VPS_USER}@${VPS_HOST}:${REMOTE_BASE}/mobile/console/kovanica/dist/"

rsync -avz --delete \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no" \
  "${LOCAL_ENTERPRISE_DIR}/dist/" \
  "${VPS_USER}@${VPS_HOST}:${REMOTE_BASE}/mobile/console/enterprise/dist/"

rsync -avz \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no" \
  "${LOCAL_CONSOLE_DIR}/ecosystem.config.js" \
  "${VPS_USER}@${VPS_HOST}:${REMOTE_BASE}/mobile/console/kovanica/"

rsync -avz \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no" \
  "${LOCAL_ENTERPRISE_DIR}/ecosystem.config.js" \
  "${VPS_USER}@${VPS_HOST}:${REMOTE_BASE}/mobile/console/enterprise/"

# Restart pm2 on VPS
echo ""
echo "Restarting pm2 processes on VPS..."

ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${VPS_USER}@${VPS_HOST}" << 'EOF'
  cd /opt/kovanica/mobile/console/kovanica
  pm2 reload ecosystem.config.js || pm2 start ecosystem.config.js
  
  cd /opt/kovanica/mobile/console/enterprise
  pm2 reload ecosystem.config.js || pm2 start ecosystem.config.js
  
  pm2 save
  pm2 list
EOF

echo ""
echo "=== Deployment Complete ==="
echo "Kovanica Console: http://${VPS_HOST}:3000"
echo "Enterprise Console: http://${VPS_HOST}:3001"