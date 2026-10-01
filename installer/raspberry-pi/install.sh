#!/usr/bin/env bash
# Kovanica Protocol — Raspberry Pi Installer
#
# Optimized for RPi 3/4/5 (ARM aarch64 / armv7l).
# Supports: Raspberry Pi OS (Bookworm/Bullseye), DietPi, Ubuntu ARM, Arch ARM.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/KovanicaDAG/kovanica-protocol/main/kovanica-install/raspberry-pi/install.sh | bash
#
# Options:
#   --swap SIZE       Set swap size in MB (default: 1024, recommended for 1GB RPi)
#   --no-swap         Skip swap setup
#   --p2p-port PORT   P2P port (default: 9000)
#   --mine            Enable mining (blocks every 60s)
#   --monitor         Install Prometheus node exporter + Grafana

set -euo pipefail

VERSION="0.2.0"
REPO_URL="https://github.com/KovanicaDAG/kovanica-protocol"
BINARY="kovanica-node"
DATA_DIR="${HOME}/.kovanica-data"
P2P_PORT=9000
HTTP_PORT=8080
PEERS="seed.kovanica.online:9000,seed2.kovanica.online:9000"
MINE=0
MINE_SECS=60
SWAP_SIZE=1024
SETUP_SWAP=1
INSTALL_MONITOR=0

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
    case $1 in
        --swap)         SWAP_SIZE="$2"; shift 2 ;;
        --no-swap)      SETUP_SWAP=0; shift ;;
        --p2p-port)     P2P_PORT="$2"; shift 2 ;;
        --http-port)    HTTP_PORT="$2"; shift 2 ;;
        --peers)        PEERS="$2"; shift 2 ;;
        --mine)         MINE=1; shift ;;
        --mine-secs)    MINE_SECS="$2"; shift 2 ;;
        --monitor)      INSTALL_MONITOR=1; shift ;;
        -h|--help)      grep '^#' "$0" | cut -c4-; exit 0 ;;
        *) die "Unknown: $1" ;;
    esac
done

# ─── Detect Raspberry Pi ────────────────────────────────────────────────────

detect_pi() {
    local model=""
    if [[ -f /proc/device-tree/model ]]; then
        model=$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)
    fi

    if [[ "$model" == *"Raspberry Pi"* ]]; then
        info "Detected: ${model}"
        IS_PI=1
    else
        warn "Not detected as Raspberry Pi — proceeding anyway"
        IS_PI=0
    fi

    ARCH=$(uname -m)
    case "$ARCH" in
        aarch64) ARCH_NAME="aarch64" ;;
        armv7l)  ARCH_NAME="armv7l" ;;
        *)       die "Unsupported Pi architecture: $ARCH" ;;
    esac
    info "Architecture: ${ARCH_NAME}"

    # Detect RAM
    local mem_kb
    mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
    local mem_mb=$((mem_kb / 1024))
    info "RAM: ${mem_mb} MB"

    if [[ $mem_mb -lt 1024 ]]; then
        warn "Less than 1GB RAM — increasing swap recommended"
        [[ "$SETUP_SWAP" -eq 1 && "$SWAP_SIZE" -lt 2048 ]] && SWAP_SIZE=2048
    fi
}

# ─── Swap Setup ─────────────────────────────────────────────────────────────

setup_swap() {
    [[ "$SETUP_SWAP" -eq 0 ]] && return

    local current_swap
    current_swap=$(awk '/SwapTotal/ {print $2}' /proc/meminfo)

    if [[ "$current_swap" -gt 1048576 ]]; then
        info "Swap already configured: $((current_swap / 1024)) MB"
        return
    fi

    info "Setting up ${SWAP_SIZE} MB swap..."

    if command -v dphys-swapfile >/dev/null 2>&1; then
        # Raspberry Pi OS way
        sudo sed -i "s/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=${SWAP_SIZE}/" /etc/dphys-swapfile 2>/dev/null || true
        sudo dphys-swapfile setup 2>/dev/null || true
        sudo dphys-swapfile swapon 2>/dev/null || true
    else
        # Manual swap file
        sudo fallocate -l "${SWAP_SIZE}M" /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count="$SWAP_SIZE" 2>/dev/null
        sudo chmod 600 /swapfile
        sudo mkswap /swapfile
        sudo swapon /swapfile
        echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
    fi

    ok "Swap configured: ${SWAP_SIZE} MB"
}

# ─── GPU Memory Split ──────────────────────────────────────────────────────

optimize_gpu_memory() {
    [[ "$IS_PI" -eq 0 ]] && return

    local config="/boot/config.txt"
    [[ ! -f "$config" ]] && config="/boot/firmware/config.txt"
    [[ ! -f "$config" ]] && return

    # Minimize GPU memory for headless operation
    if ! grep -q "gpu_mem=16" "$config" 2>/dev/null; then
        info "Optimizing GPU memory split for headless node..."
        if grep -q "^gpu_mem=" "$config"; then
            sudo sed -i 's/^gpu_mem=.*/gpu_mem=16/' "$config"
        else
            echo "gpu_mem=16" | sudo tee -a "$config" >/dev/null
        fi
        ok "GPU memory set to 16 MB (reboot to apply)"
    fi
}

# ─── Install ────────────────────────────────────────────────────────────────

install_node() {
    # Try pre-built binary first
    info "Downloading pre-built binary for Pi (${ARCH_NAME})..."
    local tmpdir
    tmpdir=$(mktemp -d)

    local url="${REPO_URL}/releases/download/v${VERSION}/kovanica-node-linux-${ARCH_NAME}.tar.gz"

    if curl -fsSL --retry 3 --connect-timeout 10 -o "${tmpdir}/k.tar.gz" "$url"; then
        tar -xzf "${tmpdir}/k.tar.gz" -C "${tmpdir}"
        local bin
        bin=$(find "${tmpdir}" -name "$BINARY" -type f 2>/dev/null | head -1)
        if [[ -n "$bin" ]]; then
            cp "$bin" "${HOME}/.local/bin/${BINARY}" 2>/dev/null \
                || { mkdir -p "${HOME}/.local/bin"; cp "$bin" "${HOME}/.local/bin/${BINARY}"; }
            chmod +x "${HOME}/.local/bin/${BINARY}"
            rm -rf "${tmpdir}"
            ok "Binary installed to ~/.local/bin/${BINARY}"
            return 0
        fi
    fi

    rm -rf "${tmpdir}"
    warn "Pre-built binary not available, building on the Pi..."
    warn "This will take 20-60 minutes on a Pi 4, longer on Pi 3."

    # Install dependencies
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update -qq
        sudo apt-get install -y -qq curl build-essential pkg-config git
    fi

    # Install Rust
    if ! command -v rustup >/dev/null 2>&1; then
        info "Installing Rust toolchain..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "${HOME}/.cargo/env"
    fi

    # Build with optimizations for the Pi
    local srcdir
    srcdir=$(mktemp -d)
    git clone --depth 1 "${REPO_URL}.git" "${srcdir}/kovanica"

    info "Building release binary (optimized for ${ARCH_NAME})..."
    cd "${srcdir}/kovanica"
    source "${HOME}/.cargo/env"

    # Use codegen-units=1 for better optimization on constrained hardware
    CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 \
    CARGO_PROFILE_RELEASE_LTO=fat \
    cargo build --release -p kovanica-node

    mkdir -p "${HOME}/.local/bin"
    cp target/release/$BINARY "${HOME}/.local/bin/"
    chmod +x "${HOME}/.local/bin/${BINARY}"
    rm -rf "${srcdir}"
    ok "Binary built and installed"
}

# ─── Systemd User Service ──────────────────────────────────────────────────

install_service() {
    info "Installing systemd user service..."

    mkdir -p "${HOME}/.config/systemd/user"

    cat > "${HOME}/.config/systemd/user/kovanica-node.service" <<EOF
[Unit]
Description=Kovanica BlockDAG Node
After=network-online.target

[Service]
Type=simple
ExecStart=${HOME}/.local/bin/${BINARY} serve
Restart=on-failure
RestartSec=10
Environment=KOVANICA_DATA=${DATA_DIR}
Environment=KOVANICA_P2P_PORT=${P2P_PORT}
Environment=KOVANICA_HTTP_PORT=${HTTP_PORT}
Environment=KOVANICA_PEERS=${PEERS}
Environment=KOVANICA_MINE=${MINE}
Environment=KOVANICA_MINE_SECS=${MINE_SECS}

[Install]
WantedBy=default.target
EOF

    systemctl --user daemon-reload
    systemctl --user enable kovanica-node

    # Enable lingering so service runs without login
    sudo loginctl enable-linger "$(whoami)" 2>/dev/null || true

    ok "User service installed"
    echo -e "  Start:   ${CYAN}systemctl --user start kovanica-node${NC}"
    echo -e "  Logs:    ${CYAN}journalctl --user -u kovanica-node -f${NC}"
    echo -e "  Status:  ${CYAN}systemctl --user status kovanica-node${NC}"
}

# ─── Shell Profile ──────────────────────────────────────────────────────────

add_to_path() {
    local rc="${HOME}/.bashrc"
    if ! grep -q "\.local/bin" "$rc" 2>/dev/null; then
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$rc"
        ok "Added ~/.local/bin to PATH"
    fi
}

# ─── Monitoring (optional) ──────────────────────────────────────────────────

install_monitoring() {
    [[ "$INSTALL_MONITOR" -eq 0 ]] && return

    info "Installing Prometheus node exporter + Grafana..."

    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get install -y -qq prometheus-node-exporter
        sudo apt-get install -y -qq apt-transport-https software-properties-common
        wget -qO- https://apt.grafana.com/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/grafana.gpg
        echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list
        sudo apt-get update -qq
        sudo apt-get install -y -qq grafana
        sudo systemctl enable --now grafana-server
    fi

    ok "Monitoring installed"
    info "  Node exporter: http://localhost:9100/metrics"
    info "  Grafana:       http://localhost:3000 (admin/admin)"
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
    echo ""
    echo -e "${CYAN}  ╔═══════════════════════════════════════╗${NC}"
    echo -e "${CYAN}  ║  Kovanica Protocol Raspberry Pi Setup ║${NC}"
    echo -e "${CYAN}  ║  BlockDAG Node · GHOSTDAG Consensus   ║${NC}"
    echo -e "${CYAN}  ╚═══════════════════════════════════════╝${NC}"
    echo ""

    detect_pi
    setup_swap
    optimize_gpu_memory
    mkdir -p "$DATA_DIR"
    install_node
    add_to_path
    install_service
    install_monitoring

    echo ""
    echo -e "${GREEN}  ═══════════════════════════════════════${NC}"
    echo -e "${GREEN}  Raspberry Pi node ready!${NC}"
    echo ""
    echo -e "  Quick start:"
    echo -e "    ${CYAN}kovanica-node demo${NC}           # Test run"
    echo -e "    ${CYAN}kovanica-node serve${NC}          # Start node"
    echo -e "    ${CYAN}kovanica-node explorer${NC}       # Web explorer"
    echo ""
    echo -e "  Testnet: ${BLUE}https://explorer.kovanica.online${NC}"
    echo ""
}

main "$@"
