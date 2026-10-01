#!/usr/bin/env bash
# Kovanica Protocol — Universal Installer
# Detects OS, installs dependencies, builds from source or downloads pre-built binary.
# Supports: Linux (x86_64, aarch64, armv7l), macOS (arm64, x86_64), Windows (via MSYS2/WSL).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/KovanicaDAG/kovanica-protocol/main/kovanica-install/install.sh | bash
#   # or download and run manually:
#   chmod +x install.sh && ./install.sh [OPTIONS]
#
# Options:
#   --download        Download pre-built binary instead of building (faster, default)
#   --build           Build from source (requires Rust toolchain)
#   --no-service      Don't install systemd/launchd service
#   --data-dir DIR    Chain data directory (default: ~/.kovanica-data)
#   --p2p-port PORT   P2P listen port (default: 9000)
#   --http-port PORT  HTTP/API port (default: 8080)
#   --peers PEERS     Bootstrap peers (default: seed.kovanica.online:9000)
#   --mine            Enable auto-mining
#   --mine-secs SECS  Block interval for mining (default: 60)
#   --explorer        Enable self-hosted explorer
#   --help            Show this help

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

VERSION="0.2.0"
REPO="KovanicaDAG/kovanica-protocol"
REPO_URL="https://github.com/${REPO}"
REQUIREMENTS="curl ca-certificates build-essential pkg-config"
MIN_RUST="1.75"
MIN_CLANG="11"

# Defaults
DATA_DIR="${HOME}/.kovanica-data"
P2P_PORT=9000
HTTP_PORT=8080
PEERS="seed.kovanica.online:9000,seed2.kovanica.online:9000"
MINE=0
MINE_SECS=60
EXPLORER=0
INSTALL_SERVICE=1
MODE="download"  # download or build
BINARY_NAME="kovanica-node"
INSTALL_DIR="/usr/local/bin"

# ─── Colors & Logging ────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
err()   { echo -e "${RED}[error]${NC} $*" >&2; }
die()   { err "$@"; exit 1; }

# ─── Parse Args ──────────────────────────────────────────────────────────────

usage() {
    grep '^#' "$0" | cut -c4- | head -20
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) usage ;;
        --download)     MODE="download"; shift ;;
        --build)        MODE="build"; shift ;;
        --no-service)   INSTALL_SERVICE=0; shift ;;
        --data-dir)     DATA_DIR="$2"; shift 2 ;;
        --p2p-port)     P2P_PORT="$2"; shift 2 ;;
        --http-port)    HTTP_PORT="$2"; shift 2 ;;
        --peers)        PEERS="$2"; shift 2 ;;
        --mine)         MINE=1; shift ;;
        --mine-secs)    MINE_SECS="$2"; shift 2 ;;
        --explorer)     EXPLORER=1; shift ;;
        *) die "Unknown option: $1 (try --help)" ;;
    esac
done

# ─── Platform Detection ──────────────────────────────────────────────────────

detect_platform() {
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)

    case "$OS" in
        linux)  PLATFORM="linux" ;;
        darwin) PLATFORM="macos" ;;
        mingw*|msys*|cygwin*)
            die "Windows detected. Please use windows/install.ps1 or WSL. See README.md."
            ;;
        freebsd) PLATFORM="freebsd" ;;
        *)      die "Unsupported OS: $OS" ;;
    esac

    case "$ARCH" in
        x86_64|amd64)   ARCH_NAME="x86_64" ;;
        aarch64|arm64)   ARCH_NAME="aarch64" ;;
        armv7*|armhf)    ARCH_NAME="armv7l" ;;
        i686|i386)       ARCH_NAME="i686" ;;
        *)               die "Unsupported architecture: $ARCH" ;;
    esac

    # Map to Rust target triple
    case "${PLATFORM}-${ARCH_NAME}" in
        linux-x86_64)    TARGET="x86_64-unknown-linux-gnu" ;;
        linux-aarch64)   TARGET="aarch64-unknown-linux-gnu" ;;
        linux-armv7l)    TARGET="armv7-unknown-linux-gnueabihf" ;;
        linux-i686)      TARGET="i686-unknown-linux-gnu" ;;
        macos-x86_64)    TARGET="x86_64-apple-darwin" ;;
        macos-aarch64)   TARGET="aarch64-apple-darwin" ;;
        freebsd-x86_64)  TARGET="x86_64-unknown-freebsd" ;;
        *)               die "No pre-built binary for ${PLATFORM}-${ARCH_NAME}" ;;
    esac

    info "Platform: ${PLATFORM} / ${ARCH_NAME} (target: ${TARGET})"
}

# ─── Dependency Check ────────────────────────────────────────────────────────

check_deps() {
    local missing=()

    for cmd in curl tar; do
        command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        warn "Missing required tools: ${missing[*]}"
        install_system_deps "${missing[@]}"
    fi
}

install_system_deps() {
    info "Installing system dependencies..."
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update -qq
        sudo apt-get install -y -qq curl build-essential pkg-config ca-certificates >/dev/null
    elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y -q gcc gcc-c++ make pkgconfig curl ca-certificates
    elif command -v yum >/dev/null 2>&1; then
        sudo yum install -y -q gcc gcc-c++ make pkgconfig curl ca-certificates
    elif command -v pacman >/dev/null 2>&1; then
        sudo pacman -Sy --noconfirm --needed curl base-devel pkgconf
    elif command -v zypper >/dev/null 2>&1; then
        sudo zypper install -y -n gcc gcc-c++ make pkg-config curl ca-certificates
    elif command -v apk >/dev/null 2>&1; then
        sudo apk add --no-cache build-base pkgconf curl
    else
        die "Cannot auto-install deps. Install manually: ${REQUIREMENTS}"
    fi
    ok "System dependencies installed"
}

# ─── Rust Toolchain ──────────────────────────────────────────────────────────

ensure_rust() {
    if command -v rustup >/dev/null 2>&1; then
        local current
        current=$(rustc --version | grep -oP '\d+\.\d+\.\d+' | head -1)
        info "Rust ${current} found"
    elif command -v rustc >/dev/null 2>&1; then
        warn "rustc found but no rustup — installing rustup for toolchain management"
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "${HOME}/.cargo/env"
    else
        info "Installing Rust toolchain..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "${HOME}/.cargo/env"
    fi

    # Ensure components
    rustup component add rustfmt clippy 2>/dev/null || true
    ok "Rust toolchain ready"
}

# ─── Download Pre-built Binary ──────────────────────────────────────────────

download_binary() {
    info "Downloading pre-built binary for ${TARGET}..."
    local base_url="${REPO_URL}/releases/download/v${VERSION}"
    local archive

    case "$PLATFORM" in
        linux)
            archive="kovanica-node-linux-${ARCH_NAME}.tar.gz"
            ;;
        macos)
            archive="kovanica-node-macos-${ARCH_NAME}.tar.gz"
            ;;
        freebsd)
            archive="kovanica-node-freebsd-${ARCH_NAME}.tar.gz"
            ;;
    esac

    local url="${base_url}/${archive}"
    local tmpdir
    tmpdir=$(mktemp -d)

    if curl -fsSL --retry 3 -o "${tmpdir}/${archive}" "$url" 2>/dev/null; then
        tar -xzf "${tmpdir}/${archive}" -C "${tmpdir}"
        # Find the binary (may be nested in a directory)
        local bin
        bin=$(find "${tmpdir}" -name "$BINARY_NAME" -type f -executable 2>/dev/null | head -1)
        if [[ -z "$bin" ]]; then
            bin=$(find "${tmpdir}" -name "$BINARY_NAME" -type f 2>/dev/null | head -1)
        fi
        if [[ -n "$bin" ]]; then
            install_binary "$bin"
            rm -rf "${tmpdir}"
            return 0
        fi
    fi

    rm -rf "${tmpdir}"
    warn "Pre-built binary not available for ${TARGET}"
    info "Falling back to build from source..."
    MODE="build"
}

# ─── Build from Source ──────────────────────────────────────────────────────

build_from_source() {
    info "Building kovanica-protocol from source..."
    ensure_rust

    local tmpdir
    tmpdir=$(mktemp -d)

    info "Cloning repository..."
    git clone --depth 1 --branch "v${VERSION}" "${REPO_URL}.git" "${tmpdir}/kovanica-protocol" 2>/dev/null \
        || git clone --depth 1 "${REPO_URL}.git" "${tmpdir}/kovanica-protocol"

    info "Building release binary (this may take several minutes)..."
    (cd "${tmpdir}/kovanica-protocol" && cargo build --release -p kovanica-node)

    local bin="${tmpdir}/kovanica-protocol/target/release/${BINARY_NAME}"
    [[ -f "$bin" ]] || die "Build failed — binary not found at ${bin}"

    install_binary "$bin"
    rm -rf "${tmpdir}"
}

# ─── Install Binary ──────────────────────────────────────────────────────────

install_binary() {
    local src="$1"

    if [[ -w "$INSTALL_DIR" ]]; then
        cp "$src" "${INSTALL_DIR}/${BINARY_NAME}"
    else
        sudo cp "$src" "${INSTALL_DIR}/${BINARY_NAME}"
    fi
    chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

    ok "Installed ${BINARY_NAME} to ${INSTALL_DIR}/${BINARY_NAME}"
    "${INSTALL_DIR}/${BINARY_NAME}" --version 2>/dev/null || true
}

# ─── Systemd Service ─────────────────────────────────────────────────────────

install_systemd_service() {
    [[ "$INSTALL_SERVICE" -eq 0 ]] && return
    [[ "$PLATFORM" != "linux" ]] && return
    command -v systemctl >/dev/null 2>&1 || return

    local unit_name="kovanica-node"
    local unit_file="/etc/systemd/system/${unit_name}.service"
    local user="${SUDO_USER:-$USER}"

    info "Installing systemd service..."

    # Build environment file
    local env_file="/etc/default/${unit_name}"
    sudo mkdir -p /etc/default
    sudo tee "$env_file" >/dev/null <<ENVEOF
# Kovanica Node Configuration
KOVANICA_DATA=${DATA_DIR}
KOVANICA_P2P_PORT=${P2P_PORT}
KOVANICA_HTTP_PORT=${HTTP_PORT}
KOVANICA_PEERS=${PEERS}
KOVANICA_MINE=${MINE}
KOVANICA_MINE_SECS=${MINE_SECS}
KOVANICA_EXPLORER=${EXPLORER}
ENVEOF

    sudo tee "$unit_file" >/dev/null <<EOF
[Unit]
Description=Kovanica Node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${env_file}
ExecStart=${INSTALL_DIR}/${BINARY_NAME} serve
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${DATA_DIR}
ProtectHome=false

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable "${unit_name}"

    ok "Systemd service installed: ${unit_name}"
    info "  Start:   sudo systemctl start ${unit_name}"
    info "  Logs:    sudo journalctl -u ${unit_name} -f"
    info "  Status:  sudo systemctl status ${unit_name}"
}

# ─── Data Directory ──────────────────────────────────────────────────────────

setup_data_dir() {
    mkdir -p "${DATA_DIR}"
    ok "Data directory: ${DATA_DIR}"
}

# ─── Shell Profile ───────────────────────────────────────────────────────────

add_to_path() {
    local shell_rc=""

    case "$SHELL" in
        */bash)  shell_rc="${HOME}/.bashrc" ;;
        */zsh)   shell_rc="${HOME}/.zshrc" ;;
        */fish)  shell_rc="${HOME}/.config/fish/config.fish" ;;
        */dash|*/sh) shell_rc="${HOME}/.profile" ;;
    esac

    if [[ -n "$shell_rc" ]] && [[ -f "$shell_rc" ]]; then
        if ! grep -q "KOVANICA_DATA" "$shell_rc" 2>/dev/null; then
            cat >> "$shell_rc" <<'RC'

# Kovanica Node
export KOVANICA_DATA="${HOME}/.kovanica-data"
export KOVANICA_PEERS="seed.kovanica.online:9000,seed2.kovanica.online:9000"
RC
            ok "Added environment variables to ${shell_rc}"
        fi
    fi
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
    echo ""
    echo -e "${CYAN}  ╔═══════════════════════════════════════╗${NC}"
    echo -e "${CYAN}  ║   Kovanica Protocol Installer v${VERSION}  ║${NC}"
    echo -e "${CYAN}  ║   BlockDAG Node · GHOSTDAG Consensus  ║${NC}"
    echo -e "${CYAN}  ╚═══════════════════════════════════════╝${NC}"
    echo ""

    detect_platform
    check_deps
    setup_data_dir

    case "$MODE" in
        download) download_binary ;;
        build)    build_from_source ;;
    esac

    add_to_path
    install_systemd_service

    echo ""
    echo -e "${GREEN}  ═══════════════════════════════════════${NC}"
    echo -e "${GREEN}  Installation complete!${NC}"
    echo ""
    echo -e "  Quick start:"
    echo -e "    ${CYAN}kovanica-node demo${NC}          # Run scripted demo"
    echo -e "    ${CYAN}kovanica-node serve${NC}         # Start interactive REPL"
    echo -e "    ${CYAN}kovanica-node explorer${NC}      # Start with web explorer"
    echo ""
    echo -e "  Options:"
    echo -e "    --data-dir ${DATA_DIR}"
    echo -e "    --p2p-port ${P2P_PORT}"
    echo -e "    --peers ${PEERS}"
    [[ "$MINE" -eq 1 ]] && echo -e "    --mine (every ${MINE_SECS}s)"
    [[ "$EXPLORER" -eq 1 ]] && echo -e "    --explorer enabled"
    echo ""
    echo -e "  Testnet explorer: ${BLUE}https://explorer.kovanica.online${NC}"
    echo -e "  Documentation:    ${BLUE}${REPO_URL}#readme${NC}"
    echo ""
}

main "$@"
