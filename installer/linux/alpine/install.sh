#!/usr/bin/env bash
# Kovanica Protocol — Alpine Linux Installer (musl, tiny containers)
#
# Ideal for: Docker base images, VPS with minimal RAM, Raspberry Pi Alpine
#
# Usage:
#   wget -qO- https://raw.githubusercontent.com/KovanicaDAG/kovanica-protocol/main/kovanica-install/linux/alpine/install.sh | sh

set -euo pipefail

REPO_URL="https://github.com/KovanicaDAG/kovanica-protocol"
BINARY="kovanica-node"
DATA_DIR="${KOVANICA_DATA:-/var/lib/kovanica}"

info()  { echo -e "\033[0;34m[info]\033[0m  $*"; }
ok()    { echo -e "\033[0;32m[ok]\033[0m    $*"; }
die()   { echo -e "\033[0;31m[error]\033[0m $*" >&2; exit 1; }

ARCH=$(uname -m)
case "$ARCH" in
    x86_64)  ARCH_NAME="x86_64" ;;
    aarch64) ARCH_NAME="aarch64" ;;
    armv7l)  ARCH_NAME="armv7l" ;;
    *)       die "Unsupported: $ARCH" ;;
esac

info "Kovanica Protocol Installer (Alpine Linux)"

# Install build deps (for musl build from source)
apk add --no-cache curl git build-base pkgconf

# Try pre-built binary first
tmpdir=$(mktemp -d)
url="${REPO_URL}/releases/download/v0.2.0/kovanica-node-linux-${ARCH_NAME}-musl.tar.gz"

if curl -fsSL --retry 3 -o "${tmpdir}/k.tar.gz" "$url" 2>/dev/null; then
    tar -xzf "${tmpdir}/k.tar.gz" -C "${tmpdir}"
    bin=$(find "${tmpdir}" -name "$BINARY" -type f | head -1)
    if [[ -n "$bin" ]]; then
        cp "$bin" "/usr/local/bin/${BINARY}"
        chmod +x "/usr/local/bin/${BINARY}"
        rm -rf "${tmpdir}"
        ok "Musl binary installed"
    fi
else
    rm -rf "${tmpdir}"
    info "No pre-built musl binary, building from source..."

    # Ensure Rust target matches musl
    if ! command -v rustup >/dev/null 2>&1; then
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "${HOME}/.cargo/env"
    fi

    case "$ARCH_NAME" in
        x86_64)  MUSL_TARGET="x86_64-unknown-linux-musl" ;;
        aarch64) MUSL_TARGET="aarch64-unknown-linux-musl" ;;
        armv7l)  MUSL_TARGET="armv7-unknown-linux-musleabihf" ;;
    esac

    rustup target add "$MUSL_TARGET"

    srcdir=$(mktemp -d)
    git clone --depth 1 "${REPO_URL}.git" "${srcdir}/kovanica"
    cd "${srcdir}/kovanica"
    cargo build --release --target "$MUSL_TARGET" -p kovanica-node

    cp "target/${MUSL_TARGET}/release/${BINARY}" "/usr/local/bin/${BINARY}"
    chmod +x "/usr/local/bin/${BINARY}"
    rm -rf "${srcdir}"
    ok "Musl binary built and installed"
fi

# Setup
mkdir -p "$DATA_DIR"

echo ""
echo -e "\033[0;32mInstallation complete!\033[0m"
echo "  ${BINARY} demo"
echo "  ${BINARY} serve"
