#!/usr/bin/env bash
# Kovanica Protocol — macOS Installer
#
# Installs on macOS (Apple Silicon or Intel) via:
# 1. Pre-built binary (fastest)
# 2. Homebrew build
# 3. Build from source
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/KovanicaDAG/kovanica-protocol/main/kovanica-install/macos/install.sh | bash
#   chmod +x install.sh && ./install.sh [OPTIONS]
#
# Options:
#   --download        Download pre-built binary (default)
#   --build           Build from source
#   --homebrew        Install via Homebrew tap
#   --no-service      Don't install launchd service
#   --data-dir DIR    Chain data directory
#   --p2p-port PORT   P2P listen port (default: 9000)
#   --http-port PORT  HTTP/API port (default: 8080)
#   --peers PEERS     Bootstrap peers
#   --mine            Enable auto-mining
#   --explorer        Enable self-hosted explorer

set -euo pipefail

VERSION="0.2.0"
REPO="KovanicaDAG/kovanica-protocol"
REPO_URL="https://github.com/${REPO}"

# Defaults
DATA_DIR="${HOME}/.kovanica-data"
P2P_PORT=9000
HTTP_PORT=8080
PEERS="seed.kovanica.online:9000,seed2.kovanica.online:9000"
MINE=0
MINE_SECS=60
EXPLORER=0
INSTALL_SERVICE=1
MODE="download"
INSTALL_DIR="/usr/local/bin"
BINARY="kovanica-node"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --download)     MODE="download"; shift ;;
        --build)        MODE="build"; shift ;;
        --homebrew)     MODE="homebrew"; shift ;;
        --no-service)   INSTALL_SERVICE=0; shift ;;
        --data-dir)     DATA_DIR="$2"; shift 2 ;;
        --p2p-port)     P2P_PORT="$2"; shift 2 ;;
        --http-port)    HTTP_PORT="$2"; shift 2 ;;
        --peers)        PEERS="$2"; shift 2 ;;
        --mine)         MINE=1; shift ;;
        --mine-secs)    MINE_SECS="$2"; shift 2 ;;
        --explorer)     EXPLORER=1; shift ;;
        -h|--help)      grep '^#' "$0" | cut -c4-; exit 0 ;;
        *) die "Unknown option: $1" ;;
    esac
done

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
    arm64)   ARCH_NAME="aarch64"; echo "Apple Silicon detected" ;;
    x86_64)  ARCH_NAME="x86_64"; echo "Intel Mac detected" ;;
    *)       die "Unsupported architecture: $ARCH" ;;
esac

# ─── Method 1: Download ──────────────────────────────────────────────────────

download_binary() {
    info "Downloading pre-built binary..."
    local url="${REPO_URL}/releases/download/v${VERSION}/kovanica-node-macos-${ARCH_NAME}.tar.gz"
    local tmpdir
    tmpdir=$(mktemp -d)

    if curl -fsSL --retry 3 -o "${tmpdir}/kovanica.tar.gz" "$url"; then
        tar -xzf "${tmpdir}/kovanica.tar.gz" -C "${tmpdir}"
        local bin
        bin=$(find "${tmpdir}" -name "$BINARY" -type f 2>/dev/null | head -1)
        if [[ -n "$bin" ]]; then
            install_binary "$bin"
            rm -rf "${tmpdir}"
            return 0
        fi
    fi

    rm -rf "${tmpdir}"
    warn "Pre-built binary not available, falling back to build"
    MODE="build"
}

# ─── Method 2: Homebrew ──────────────────────────────────────────────────────

install_homebrew() {
    info "Installing via Homebrew..."

    if ! command -v brew >/dev/null 2>&1; then
        info "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi

    # Create a local tap
    info "Setting up Homebrew tap..."
    mkdir -p "${HOME}/.local/share/Homebrew/Library/Taps/kovanica/homebrew-kovanica"

    cat > "${HOME}/.local/share/Homebrew/Library/Taps/kovanica/homebrew-kovanica/kovanica-node.rb" <<RUBY
class KovanicaNode < Formula
  desc "Kovanica BlockDAG node — GHOSTDAG consensus"
  homepage "https://kovanica.online"
  version "${VERSION}"
  license "MIT OR Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "${REPO_URL}/releases/download/v${VERSION}/kovanica-node-macos-aarch64.tar.gz"
    else
      url "${REPO_URL}/releases/download/v${VERSION}/kovanica-node-macos-x86_64.tar.gz"
    end
  end

  def install
    bin.install "kovanica-node"
  end

  test do
    system "#{bin}/kovanica-node", "--version"
  end
end
RUBY

    brew install --local-tap kovanica/kovanica-node/kovanica-node 2>/dev/null \
        || brew reinstall --local-tap kovanica/kovanica-node/kovanica-node 2>/dev/null \
        || { warn "Homebrew tap install failed, building from source"; build_from_source; return; }

    ok "Installed via Homebrew"
}

# ─── Method 3: Build from Source ─────────────────────────────────────────────

build_from_source() {
    info "Building from source..."

    # Install Xcode Command Line Tools if needed
    if ! xcode-select -p >/dev/null 2>&1; then
        info "Installing Xcode Command Line Tools..."
        xcode-select --install
        echo "Please wait for Xcode CLT installation to complete, then re-run."
        exit 1
    fi

    # Install Rust
    if ! command -v rustup >/dev/null 2>&1; then
        info "Installing Rust toolchain..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "${HOME}/.cargo/env"
    fi

    local tmpdir
    tmpdir=$(mktemp -d)

    info "Cloning repository..."
    git clone --depth 1 --branch "v${VERSION}" "${REPO_URL}.git" "${tmpdir}/kovanica" 2>/dev/null \
        || git clone --depth 1 "${REPO_URL}.git" "${tmpdir}/kovanica"

    info "Building release binary..."
    (cd "${tmpdir}/kovanica" && cargo build --release -p kovanica-node)

    local bin="${tmpdir}/kovanica/target/release/${BINARY}"
    [[ -f "$bin" ]] || die "Build failed"

    install_binary "$bin"
    rm -rf "${tmpdir}"
}

# ─── Install Binary ──────────────────────────────────────────────────────────

install_binary() {
    local src="$1"

    if [[ -w "$INSTALL_DIR" ]]; then
        cp "$src" "${INSTALL_DIR}/${BINARY}"
    else
        sudo cp "$src" "${INSTALL_DIR}/${BINARY}"
    fi
    chmod +x "${INSTALL_DIR}/${BINARY}"

    # Notarize on macOS (ad-hoc signature for Gatekeeper)
    if command -v codesign >/dev/null 2>&1; then
        codesign --force --sign - "${INSTALL_DIR}/${BINARY}" 2>/dev/null || true
    fi

    ok "Installed ${BINARY} to ${INSTALL_DIR}/${BINARY}"
}

# ─── Launchd Service ────────────────────────────────────────────────────────

install_launchd() {
    [[ "$INSTALL_SERVICE" -eq 0 ]] && return

    local plist_path="${HOME}/Library/LaunchAgents/com.kovanica.node.plist"
    local env_file="${HOME}/.kovanica-env"

    info "Installing launchd agent..."

    mkdir -p "${HOME}/Library/LaunchAgents"

    # Environment file
    cat > "$env_file" <<EOF
KOVANICA_DATA=${DATA_DIR}
KOVANICA_P2P_PORT=${P2P_PORT}
KOVANICA_HTTP_PORT=${HTTP_PORT}
KOVANICA_PEERS=${PEERS}
KOVANICA_MINE=${MINE}
KOVANICA_MINE_SECS=${MINE_SECS}
KOVANICA_EXPLORER=${EXPLORER}
EOF

    cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.kovanica.node</string>
    <key>ProgramArguments</key>
    <array>
        <string>${INSTALL_DIR}/${BINARY}</string>
        <string>serve</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>KOVANICA_DATA</key>
        <string>${DATA_DIR}</string>
        <key>KOVANICA_P2P_PORT</key>
        <string>${P2P_PORT}</string>
        <key>KOVANICA_HTTP_PORT</key>
        <string>${HTTP_PORT}</string>
        <key>KOVANICA_PEERS</key>
        <string>${PEERS}</string>
        <key>KOVANICA_MINE</key>
        <string>${MINE}</string>
        <key>KOVANICA_MINE_SECS</key>
        <string>${MINE_SECS}</string>
        <key>KOVANICA_EXPLORER</key>
        <string>${EXPLORER}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${DATA_DIR}</string>
    <key>StandardOutPath</key>
    <string>${DATA_DIR}/node.log</string>
    <key>StandardErrorPath</key>
    <string>${DATA_DIR}/node.err</string>
</dict>
</plist>
PLIST

    launchctl load "$plist_path" 2>/dev/null || true

    ok "Launchd agent installed"
    info "  Start:   launchctl start com.kovanica.node"
    info "  Stop:    launchctl stop com.kovanica.node"
    info "  Logs:    tail -f ${DATA_DIR}/node.log"
    info "  Boot:    launchctl unload ~/Library/LaunchAgents/com.kovanica.node.plist"
}

# ─── Shell Profile ───────────────────────────────────────────────────────────

add_to_path() {
    local shell_rc=""
    case "$SHELL" in
        */zsh)   shell_rc="${HOME}/.zshrc" ;;
        */bash)  shell_rc="${HOME}/.bashrc" ;;
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
    echo -e "${CYAN}  ║   Kovanica Protocol macOS Installer   ║${NC}"
    echo -e "${CYAN}  ║   BlockDAG Node · GHOSTDAG Consensus  ║${NC}"
    echo -e "${CYAN}  ╚═══════════════════════════════════════╝${NC}"
    echo ""

    mkdir -p "$DATA_DIR"

    case "$MODE" in
        download)  download_binary ;;
        homebrew)  install_homebrew ;;
        build)     build_from_source ;;
    esac

    add_to_path
    install_launchd

    echo ""
    echo -e "${GREEN}  ═══════════════════════════════════════${NC}"
    echo -e "${GREEN}  Installation complete!${NC}"
    echo ""
    echo -e "  Quick start:"
    echo -e "    ${CYAN}kovanica-node demo${NC}          # Run scripted demo"
    echo -e "    ${CYAN}kovanica-node serve${NC}         # Start interactive REPL"
    echo -e "    ${CYAN}kovanica-node explorer${NC}      # Start with web explorer"
    echo ""
    echo -e "  Testnet explorer: ${BLUE}https://explorer.kovanica.online${NC}"
    echo ""
}

main "$@"
