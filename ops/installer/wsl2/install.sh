#!/usr/bin/env bash
# Kovanica Protocol — WSL2 Installer (Windows Subsystem for Linux)
#
# Run from PowerShell or Windows Terminal:
#   wsl -d Ubuntu -- bash -c "curl -fsSL https://raw.githubusercontent.com/KovanicaDAG/kovanica-protocol/main/kovanica-install/wsl2/install.sh | bash"
#
# Or download and run locally:
#   chmod +x install.sh && ./install.sh

set -euo pipefail

REPO_URL="https://github.com/KovanicaDAG/kovanica-protocol"
BINARY="kovanica-node"
DATA_DIR="${HOME}/.kovanica-data"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

info "Kovanica Protocol — WSL2 Installer"
echo ""

# Verify we're in WSL
if ! grep -qi microsoft /proc/version 2>/dev/null; then
    die "Not running inside WSL. Use: wsl -d Ubuntu -- bash $0"
fi

ARCH=$(uname -m)
case "$ARCH" in
    x86_64)  ARCH_NAME="x86_64" ;;
    aarch64) ARCH_NAME="aarch64" ;;
    *)       die "Unsupported: $ARCH" ;;
esac

# Install deps
info "Installing build dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq curl build-essential pkg-config

# Try pre-built binary
tmpdir=$(mktemp -d)
url="${REPO_URL}/releases/download/v0.2.0/kovanica-node-linux-${ARCH_NAME}.tar.gz"

if curl -fsSL --retry 3 -o "${tmpdir}/k.tar.gz" "$url"; then
    tar -xzf "${tmpdir}/k.tar.gz" -C "${tmpdir}"
    bin=$(find "${tmpdir}" -name "$BINARY" -type f | head -1)
    if [[ -n "$bin" ]]; then
        sudo cp "$bin" "/usr/local/bin/${BINARY}"
        sudo chmod +x "/usr/local/bin/${BINARY}"
        rm -rf "${tmpdir}"
        ok "Binary installed"
    fi
else
    rm -rf "${tmpdir}"
    info "Pre-built binary not available, building from source..."

    if ! command -v rustup >/dev/null 2>&1; then
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "${HOME}/.cargo/env"
    fi

    srcdir=$(mktemp -d)
    git clone --depth 1 "${REPO_URL}.git" "${srcdir}/kovanica"
    cd "${srcdir}/kovanica"
    cargo build --release -p kovanica-node
    sudo cp target/release/$BINARY /usr/local/bin/
    sudo chmod +x /usr/local/bin/$BINARY
    rm -rf "${srcdir}"
    ok "Built and installed from source"
fi

# Setup
mkdir -p "$DATA_DIR"

# Add Windows exe path (for accessing from Windows cmd/PowerShell)
if ! grep -q "cargo/bin" "${HOME}/.bashrc" 2>/dev/null; then
    cat >> "${HOME}/.bashrc" <<'RC'

# Kovanica Node (WSL2)
export KOVANICA_DATA="${HOME}/.kovanica-data"
export KOVANICA_PEERS="seed.kovanica.online:9000,seed2.kovanica.online:9000"
RC
fi

echo ""
echo -e "${GREEN}  Installation complete!${NC}"
echo ""
echo -e "  From WSL:"
echo -e "    ${CYAN}kovanica-node demo${NC}"
echo -e "    ${CYAN}kovanica-node serve${NC}"
echo -e "    ${CYAN}kovanica-node explorer${NC}"
echo ""
echo -e "  From Windows PowerShell:"
echo -e "    ${CYAN}wsl kovanica-node demo${NC}"
echo -e "    ${CYAN}wsl kovanica-node serve${NC}"
echo ""
echo -e "  Explorer: ${BLUE}http://localhost:8080${NC}"
echo -e "  Data dir: ${DATA_DIR} (accessible from Windows at \\\\wsl$\\Ubuntu\\home\\$(whoami)\\.kovanica-data)"
echo ""
