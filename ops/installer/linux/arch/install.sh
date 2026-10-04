#!/usr/bin/env bash
# Kovanica Protocol — Arch Linux Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/KovanicaDAG/kovanica-protocol/main/kovanica-install/linux/arch/install.sh | sudo bash

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

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'
CYAN='\033[0;36m'; NC='\033[0m'

info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

[[ $EUID -ne 0 ]] && die "Run as root: sudo $0"

ARCH=$(uname -m)
case "$ARCH" in
    x86_64)  ARCH_NAME="x86_64" ;;
    aarch64) ARCH_NAME="aarch64" ;;
    *)       die "Unsupported: $ARCH" ;;
esac

info "Kovanica Protocol Installer (Arch Linux)"

# Install dependencies
pacman -Sy --noconfirm --needed base-devel curl git rust

# Download or build
download_binary() {
    local url="${REPO_URL}/releases/download/v${VERSION}/kovanica-node-linux-${ARCH_NAME}.tar.gz"
    local tmpdir
    tmpdir=$(mktemp -d)

    if curl -fsSL --retry 3 -o "${tmpdir}/k.tar.gz" "$url"; then
        tar -xzf "${tmpdir}/k.tar.gz" -C "${tmpdir}"
        local bin
        bin=$(find "${tmpdir}" -name "$BINARY" -type f | head -1)
        if [[ -n "$bin" ]]; then
            cp "$bin" "/usr/local/bin/${BINARY}"
            chmod +x "/usr/local/bin/${BINARY}"
            rm -rf "${tmpdir}"
            ok "Binary installed"
            return 0
        fi
    fi

    rm -rf "${tmpdir}"
    info "Building from source..."
    local srcdir
    srcdir=$(mktemp -d)
    git clone --depth 1 "${REPO_URL}.git" "${srcdir}/kovanica"
    cd "${srcdir}/kovanica"
    makepkg -si --noconfirm --skipinteg 2>/dev/null \
        || (cargo build --release -p kovanica-node && cp target/release/$BINARY /usr/local/bin/)
    rm -rf "${srcdir}"
}

# Systemd service
install_service() {
    if ! id -u kovanica >/dev/null 2>&1; then
        useradd --system --no-create-home --shell /usr/sbin/nologin kovanica
    fi
    mkdir -p "$DATA_DIR"
    chown kovanica:kovanica "$DATA_DIR"

    cat > /etc/systemd/system/kovanica-node.service <<EOF
[Unit]
Description=Kovanica BlockDAG Node
After=network-online.target

[Service]
Type=simple
User=kovanica
Environment=KOVANICA_DATA=${DATA_DIR}
Environment=KOVANICA_P2P_PORT=${P2P_PORT}
Environment=KOVANICA_HTTP_PORT=${HTTP_PORT}
Environment=KOVANICA_PEERS=${PEERS}
ExecStart=/usr/local/bin/${BINARY} serve
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable kovanica-node
    ok "Service installed"
}

main() {
    echo ""
    echo -e "${CYAN}  Kovanica Protocol — Arch Linux Installer${NC}"
    echo ""
    download_binary
    install_service
    echo ""
    echo -e "${GREEN}  Done! ${CYAN}sudo systemctl start kovanica-node${NC}"
    echo ""
}

main "$@"
