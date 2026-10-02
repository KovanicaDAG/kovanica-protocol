#!/usr/bin/env bash
# Kovanica Protocol — Ubuntu/Debian Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/KovanicaDAG/kovanica-protocol/main/kovanica-install/linux/ubuntu/install.sh | sudo bash

set -euo pipefail

VERSION="0.2.0"
REPO_URL="https://github.com/KovanicaDAG/kovanica-protocol"
BINARY="kovanica-node"
DATA_DIR="${KOVANICA_DATA:-/var/lib/kovanica}"
P2P_PORT="${KOVANICA_P2P_PORT:-9000}"
HTTP_PORT="${KOVANICA_HTTP_PORT:-8080}"
PEERS="${KOVANICA_PEERS:-seed.kovanica.online:9000,seed2.kovanica.online:9000}"
MINE="${KOVANICA_MINE:-0}"
MINE_SECS="${KOVANICA_MINE_SECS:-60}"
EXPLORER="${KOVANICA_EXPLORER:-0}"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

[[ $EUID -ne 0 ]] && die "Run as root: sudo $0"

ARCH=$(uname -m)
case "$ARCH" in
    x86_64)  ARCH_NAME="x86_64" ;;
    aarch64) ARCH_NAME="aarch64" ;;
    armv7l)  ARCH_NAME="armv7l" ;;
    *)       die "Unsupported architecture: $ARCH" ;;
esac

info "Kovanica Protocol Installer (Ubuntu/Debian)"
info "Architecture: ${ARCH_NAME}"

# ─── System Dependencies ─────────────────────────────────────────────────────

info "Installing system dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
    curl ca-certificates gnupg lsb-release \
    build-essential pkg-config \
    systemd dbus >/dev/null

# ─── Install Rust (for build mode) ──────────────────────────────────────────

install_rust() {
    if command -v rustup >/dev/null 2>&1; then
        ok "Rust already installed: $(rustc --version)"
        return
    fi
    info "Installing Rust toolchain..."
    sudo -u "$SUDO_USER" bash -c '
        curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "$HOME/.cargo/env"
        rustup component add rustfmt clippy
    '
    ok "Rust installed"
}

# ─── Download Binary ────────────────────────────────────────────────────────

download_binary() {
    info "Downloading pre-built binary for ${ARCH_NAME}..."
    local url="${REPO_URL}/releases/download/v${VERSION}/kovanica-node-linux-${ARCH_NAME}.tar.gz"
    local tmpdir
    tmpdir=$(mktemp -d)

    if curl -fsSL --retry 3 -o "${tmpdir}/kovanica.tar.gz" "$url"; then
        tar -xzf "${tmpdir}/kovanica.tar.gz" -C "${tmpdir}"
        local bin
        bin=$(find "${tmpdir}" -name "$BINARY" -type f 2>/dev/null | head -1)
        if [[ -n "$bin" ]]; then
            cp "$bin" "/usr/local/bin/${BINARY}"
            chmod +x "/usr/local/bin/${BINARY}"
            rm -rf "${tmpdir}"
            ok "Binary installed"
            return 0
        fi
    fi

    rm -rf "${tmpdir}"
    warn "Pre-built binary not available, building from source..."
    build_from_source
}

# ─── Build from Source ──────────────────────────────────────────────────────

build_from_source() {
    install_rust

    local tmpdir
    tmpdir=$(mktemp -d)

    info "Cloning repository..."
    git clone --depth 1 "${REPO_URL}.git" "${tmpdir}/kovanica"

    info "Building release binary (this may take several minutes)..."
    cd "${tmpdir}/kovanica"
    sudo -u "$SUDO_USER" bash -c '
        source "$HOME/.cargo/env"
        cargo build --release -p kovanica-node
    '

    local bin="${tmpdir}/kovanica/target/release/${BINARY}"
    [[ -f "$bin" ]] || die "Build failed"

    cp "$bin" "/usr/local/bin/${BINARY}"
    chmod +x "/usr/local/bin/${BINARY}"
    rm -rf "${tmpdir}"
    ok "Binary built and installed"
}

# ─── Systemd Service ────────────────────────────────────────────────────────

install_service() {
    info "Installing systemd service..."

    # Create kovanica user
    if ! id -u kovanica >/dev/null 2>&1; then
        useradd --system --no-create-home --shell /usr/sbin/nologin kovanica
        ok "Created 'kovanica' system user"
    fi

    # Data directory
    mkdir -p "$DATA_DIR"
    chown kovanica:kovanica "$DATA_DIR"

    # Environment file
    cat > /etc/default/kovanica-node <<EOF
KOVANICA_DATA=${DATA_DIR}
KOVANICA_P2P_PORT=${P2P_PORT}
KOVANICA_HTTP_PORT=${HTTP_PORT}
KOVANICA_PEERS=${PEERS}
KOVANICA_MINE=${MINE}
KOVANICA_MINE_SECS=${MINE_SECS}
KOVANICA_EXPLORER=${EXPLORER}
EOF

    # Service file
    cat > /etc/systemd/system/kovanica-node.service <<EOF
[Unit]
Description=Kovanica BlockDAG Node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=kovanica
Group=kovanica
EnvironmentFile=/etc/default/kovanica-node
ExecStart=/usr/local/bin/${BINARY} serve
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${DATA_DIR}
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

    # Firewall
    if command -v ufw >/dev/null 2>&1; then
        ufw allow "${P2P_PORT}/tcp" comment "Kovanica P2P" 2>/dev/null || true
        ufw allow "${HTTP_PORT}/tcp" comment "Kovanica HTTP" 2>/dev/null || true
        ok "Firewall rules added"
    fi

    systemctl daemon-reload
    systemctl enable kovanica-node

    ok "Systemd service installed"
    echo ""
    echo -e "  Start:   ${CYAN}sudo systemctl start kovanica-node${NC}"
    echo -e "  Logs:    ${CYAN}sudo journalctl -u kovanica-node -f${NC}"
    echo -e "  Status:  ${CYAN}sudo systemctl status kovanica-node${NC}"
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
    echo ""
    echo -e "${CYAN}  ╔═══════════════════════════════════════╗${NC}"
    echo -e "${CYAN}  ║   Kovanica Protocol Ubuntu Installer  ║${NC}"
    echo -e "${CYAN}  ╚═══════════════════════════════════════╝${NC}"
    echo ""

    download_binary
    install_service

    echo ""
    echo -e "${GREEN}  ═══════════════════════════════════════${NC}"
    echo -e "${GREEN}  Installation complete!${NC}"
    echo ""
    echo -e "  ${CYAN}kovanica-node demo${NC}          # Quick demo"
    echo -e "  ${CYAN}kovanica-node serve${NC}         # Interactive REPL"
    echo -e "  ${CYAN}kovanica-node explorer${NC}      # Web explorer"
    echo -e "  ${BLUE}https://explorer.kovanica.online${NC}"
    echo ""
}

main "$@"
