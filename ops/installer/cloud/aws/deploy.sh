#!/usr/bin/env bash
# Kovanica Protocol — AWS EC2 Deploy
#
# Launches a Kovanica node on AWS EC2.
#
# Usage:
#   ./aws-deploy.sh --region us-east-1 --type t3.medium
#   ./aws-deploy.sh --region eu-north-1 --type t4g.medium  # ARM (Graviton, cheaper)

set -euo pipefail

REGION="us-east-1"
INSTANCE_TYPE="t3.medium"
AMI=""  # Auto-detect
KEY_NAME="kovanica-node"
SECURITY_GROUP="kovanica-sg"
NAME="kovanica-seed"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
    case $1 in
        --region)   REGION="$2"; shift 2 ;;
        --type)     INSTANCE_TYPE="$2"; shift 2 ;;
        --name)     NAME="$2"; shift 2 ;;
        --key)      KEY_NAME="$2"; shift 2 ;;
        -h|--help)  grep '^#' "$0" | cut -c4-; exit 0 ;;
        *) die "Unknown: $1" ;;
    esac
done

# Check AWS CLI
command -v aws >/dev/null 2>&1 || die "Install AWS CLI: https://aws.amazon.com/cli/"

# Auto-detect AMI
detect_ami() {
    local arch
    case "$INSTANCE_TYPE" in
        t4g*|m6g*|c6g*|r6g*)  arch="arm64" ;;
        *)                     arch="x86_64" ;;
    esac

    AMI=$(aws ec2 describe-images \
        --region "$REGION" \
        --owners 137112412989 \
        --filters "Name=name,Values=al2023-ami-*" \
                  "Name=architecture,Values=${arch}" \
                  "Name=state,Values=available" \
        --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
        --output text 2>/dev/null)

    [[ -z "$AMI" || "$AMI" == "None" ]] && die "Could not find Amazon Linux 2023 AMI"
    info "AMI: ${AMI}"
}

# Create security group
setup_security_group() {
    if ! aws ec2 describe-security-groups --region "$REGION" --group-names "$SECURITY_GROUP" >/dev/null 2>&1; then
        info "Creating security group..."
        VPC_ID=$(aws ec2 describe-vpcs --region "$REGION" --filters "Name=isDefault,Values=true" --query 'Vpcs[0].VpcId' --output text)
        SG_ID=$(aws ec2 create-security-group --region "$REGION" --group-name "$SECURITY_GROUP" --description "Kovanica node" --vpc-id "$VPC_ID" --query 'GroupId' --output text)

        # SSH
        aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" --protocol tcp --port 22 --cidr 0.0.0.0/0
        # P2P
        aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" --protocol tcp --port 9000 --cidr 0.0.0.0/0
        # HTTP
        aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" --protocol tcp --port 8080 --cidr 0.0.0.0/0

        ok "Security group created: ${SG_ID}"
    else
        SG_ID=$(aws ec2 describe-security-groups --region "$REGION" --group-names "$SECURITY_GROUP" --query 'SecurityGroups[0].GroupId' --output text)
        info "Using existing security group: ${SG_ID}"
    fi
}

# Create key pair
setup_key() {
    if ! aws ec2 describe-key-pairs --region "$REGION" --key-names "$KEY_NAME" >/dev/null 2>&1; then
        info "Creating key pair..."
        aws ec2 create-key-pair --region "$REGION" --key-name "$KEY_NAME" --query 'KeyMaterial' --output text > "${KEY_NAME}.pem"
        chmod 600 "${KEY_NAME}.pem"
        ok "Key pair saved: ${KEY_NAME}.pem"
    fi
}

# Launch instance
launch_instance() {
    info "Launching EC2 instance..."

    USER_DATA=$(cat <<'UDF'
#!/bin/bash
set -euo pipefail

# System deps
dnf install -y -q gcc gcc-c++ make pkgconfig curl git

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source /root/.cargo/env

# Clone & build
git clone --depth 1 https://github.com/KovanicaDAG/kovanica-protocol.git /opt/kovanica
cd /opt/kovanica
cargo build --release -p kovanica-node

# Install
cp target/release/kovanica-node /usr/local/bin/
chmod +x /usr/local/bin/kovanica-node

# Systemd service
cat > /etc/systemd/system/kovanica-node.service <<'EOF'
[Unit]
Description=Kovanica BlockDAG Node
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
ExecStart=/usr/local/bin/kovanica-node serve
Restart=on-failure
RestartSec=5
Environment=KOVANICA_DATA=/var/lib/kovanica
Environment=KOVANICA_P2P_PORT=9000
Environment=KOVANICA_HTTP_PORT=8080
Environment=KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000
[Install]
WantedBy=multi-user.target
EOF

mkdir -p /var/lib/kovanica
systemctl daemon-reload
systemctl enable --now kovanica-node
UDF
    )

    INSTANCE_ID=$(aws ec2 run-instances \
        --region "$REGION" \
        --image-id "$AMI" \
        --instance-type "$INSTANCE_TYPE" \
        --key-name "$KEY_NAME" \
        --security-group-ids "$SG_ID" \
        --user-data "$USER_DATA" \
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${NAME}},{Key=Project,Value=kovanica}]" \
        --query 'Instances[0].InstanceId' \
        --output text)

    ok "Instance launched: ${INSTANCE_ID}"

    # Wait for it to be running
    info "Waiting for instance to start..."
    aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"

    PUBLIC_IP=$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

    echo ""
    echo -e "${GREEN}  Instance ready!${NC}"
    echo -e "  Instance ID: ${INSTANCE_ID}"
    echo -e "  Public IP:   ${PUBLIC_IP}"
    echo -e "  SSH:         ${CYAN}ssh -i ${KEY_NAME}.pem ec2-user@${PUBLIC_IP}${NC}"
    echo -e "  Explorer:    ${BLUE}http://${PUBLIC_IP}:8080${NC}"
    echo ""
}

# ─── Main ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}  Kovanica AWS EC2 Deploy${NC}"
echo -e "  Region: ${REGION}  Type: ${INSTANCE_TYPE}"
echo ""

detect_ami
setup_security_group
setup_key
launch_instance
