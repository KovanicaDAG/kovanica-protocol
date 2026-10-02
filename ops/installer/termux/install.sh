#!/usr/bin/env bash
# Kovanica Protocol — Termux Installer (Android)
#
# Run Kovanica node directly on Android phones via Termux.
# Uses aarch64 pre-built binary or builds from source.
#
# Install Termux from F-Droid (NOT Google Play — Play version is outdated):
#   https://f-droid.org/en/packages/com.termux/
#
# Then in Termux:
#   pkg update -y
#   curl -fsSL https://raw.githubusercontent.com/KovanicaDAG/kovanica-protocol/main/kovanica-install/termux/install.sh | bash

set -euo pipefail

REPO_URL="https://github.com/KovanicaDAG/kovanica-protocol"
BINARY="kovanica-node"
DATA_DIR="${HOME}/.kovanica-data"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

info "Kovanica Protocol — Termux Installer"
info "Running on Android via Termux"
echo ""

# Check we're in Termux
if [[ -z "${PREFIX:-}" ]]; then
    die "Not running in Termux. Install from F-Droid: https://f-droid.org/en/packages/com.termux/"
fi

# Install dependencies
info "Installing dependencies..."
pkg update -y
pkg install -y curl git build-essential

ARCH=$(uname -m)
info "Architecture: ${ARCH}"

# Try pre-built binary
tmpdir=$(mktemp -d)
url="${REPO_URL}/releases/download/v0.2.0/kovanica-node-linux-aarch64.tar.gz"

if curl -fsSL --retry 3 -o "${tmpdir}/k.tar.gz" "$url"; then
    tar -xzf "${tmpdir}/k.tar.gz" -C "${tmpdir}"
    bin=$(find "${tmpdir}" -name "$BINARY" -type f | head -1)
    if [[ -n "$bin" ]]; then
        cp "$bin" "${PREFIX}/bin/"
        chmod +x "${PREFIX}/bin/${BINARY}"
        rm -rf "${tmpdir}"
        ok "Binary installed"
    fi
else
    rm -rf "${tmpdir}"
    info "Building from source (this may take 30-60 minutes on a phone)..."

    if ! command -v rustup >/dev/null 2>&1; then
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "${HOME}/.cargo/env"
    fi

    srcdir=$(mktemp -d)
    git clone --depth 1 "${REPO_URL}.git" "${srcdir}/kovanica"
    cd "${srcdir}/kovanica"
    cargo build --release -p kovanica-node
    cp target/release/$BINARY "${PREFIX}/bin/"
    chmod +x "${PREFIX}/bin/${BINARY}"
    rm -rf "${srcdir}"
    ok "Built from source"
fi

mkdir -p "$DATA_DIR"

# Wake lock to prevent Android from killing the process
if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock
    ok "Wake lock acquired (node won't sleep)"
fi

# Install Termux:Boot service (auto-start on boot)
BOOT_DIR="${HOME}/.termux/boot"
mkdir -p "$BOOT_DIR"
cat > "${BOOT_DIR}/kovanica-node.sh" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
export PATH="$HOME/.cargo/bin:$PATH"
export KOVANICA_DATA="$HOME/.kovanica-data"
export KOVANICA_PEERS="seed.kovanica.online:9000,seed2.kovanica.online:9000"
kovanica-node serve
BOOT
chmod +x "${BOOT_DIR}/kovanica-node.sh"
ok "Boot service installed (auto-starts on phone boot)"

# Notification setup
if command -v termux-notification >/dev/null 2>&1; then
    termux-notification --id kovanica --title "Kovanica Node" --content "Running — tap to open Termux" --priority low
fi

echo ""
echo -e "${GREEN}  ═══════════════════════════════════════${NC}"
echo -e "${GREEN}  Kovanica node running on Android!${NC}"
echo ""
echo -e "  Quick start:"
echo -e "    ${CYAN}kovanica-node demo${NC}"
echo -e "    ${CYAN}kovanica-node serve${NC}"
echo -e "    ${CYAN}kovanica-node explorer${NC}"
echo ""
echo -e "  Keep phone awake:  ${CYAN}termux-wake-lock${NC}"
echo -e "  Background mode:   Install Termux:Boot from F-Droid"
echo -e "  Explorer:          ${BLUE}http://localhost:8080${NC}"
echo -e "  From other device: ${BLUE}http://<phone-ip>:8080${NC}"
echo ""
echo -e "  ${YELLOW}Tip: Use --no-mining to save battery on phones.${NC}"
echo ""
