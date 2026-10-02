#!/usr/bin/env bash
# Kovanica Protocol — Fedora/RHEL/CentOS Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/KovanicaDAG/kovanica-protocol/main/kovanica-install/linux/fedora/install.sh | sudo bash

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

info "Kovanica Protocol Installer (Fedora/RHEL/CentOS)"

# ─── System Dependencies ─────────────────────────────────────────────────────

info "Installing system dependencies..."

# Detect package manager
if command -v dnf >/dev/null 2>&1; then
    PKG_MGR="dnf"
    dnf install -y -q gcc gcc-c++ make pkgconfig curl ca-certificates git systemd
elif command -v yum >/dev/null 2>&1; then
    PKG_MGR="yum"
    yum install -y -q gcc gcc-c++ make pkgconfig curl ca-certificates git systemd
elif command -v zypper >/dev/null 2>&1; then
    PKG_MGR="zypper"
    zypper install -y gcc gcc-c++ make pkg-config curl ca-certificates git systemd
else
    die "No supported package manager found (need dnf, yum, or zypper)"
fi

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
    if ! command -v rustup >/dev/null 2>&1; then
        info "Installing Rust..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "${HOME}/.cargo/env"
    fi

    local tmpdir
    tmpdir=$(mktemp -d)
    git clone --depth 1 "${REPO_URL}.git" "${tmpdir}/kovanica"

    info "Building release binary..."
    cd "${tmpdir}/kovanica"
    source "${HOME}/.cargo/env"
    cargo build --release -p kovanica-node

    cp target/release/$BINARY "/usr/local/bin/${BINARY}"
    chmod +x "/usr/local/bin/${BINARY}"
    rm -rf "${tmpdir}"
    ok "Binary built and installed"
}

# ─── Systemd Service ────────────────────────────────────────────────────────

install_service() {
    info "Installing systemd service..."

    if ! id -u kovanica >/dev/null 2>&1; then
        useradd --system --no-create-home --shell /usr/sbin/nologin kovanica
    fi

    mkdir -p "$DATA_DIR"
    chown kovanica:kovanica "$DATA_DIR"

    cat > /etc/default/kovanica-node <<EOF
KOVANICA_DATA=${DATA_DIR}
KOVANICA_P2P_PORT=${P2P_PORT}
KOVANICA_HTTP_PORT=${HTTP_PORT}
KOVANICA_PEERS=${PEERS}
KOVANICA_MINE=${MINE}
KOVANICA_MINE_SECS=${MINE_SECS}
KOVANICA_EXPLORER=${EXPLORER}
EOF

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

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
EOF

    # Firewalld
    if command -v firewall-cmd >/dev/null 2>&1; then
        firewall-cmd --permanent --add-port="${P2P_PORT}/tcp" 2>/dev/null || true
        firewall-cmd --permanent --add-port="${HTTP_PORT}/tcp" 2>/dev/null || true
        firewall-cmd --reload 2>/dev/null || true
        ok "Firewalld rules added"
    fi

    systemctl daemon-reload
    systemctl enable kovanica-node
    ok "Systemd service installed"
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
    echo ""
    echo -e "${CYAN}  ╔═══════════════════════════════════════╗${NC}"
    echo -e "${CYAN}  ║   Kovanica Protocol Fedora Installer  ║${NC}"
    echo -e "${CYAN}  ╚═══════════════════════════════════════╝${NC}"
    echo ""

    download_binary
    install_service

    echo ""
    echo -e "${GREEN}  Installation complete!${NC}"
    echo -e "  ${CYAN}sudo systemctl start kovanica-node${NC}"
    echo -e "  ${CYAN}sudo journalctl -u kovanica-node -f${NC}"
    echo ""
}

main "$@"
