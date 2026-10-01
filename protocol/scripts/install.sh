#!/usr/bin/env bash
# install.sh — Install kovanica-node from prebuilt GitHub release.
#
# Usage:
#   curl -sSfL https://raw.githubusercontent.com/KovanicaDAG/kovanica-node/main/scripts/install.sh | bash
#   # or with custom version:
#   curl -sSfL https://raw.githubusercontent.com/KovanicaDAG/kovanica-node/main/scripts/install.sh | bash -s -- --version v0.1.0
#
# Options:
#   --version <tag>    Release tag to install (default: latest)
#   --prefix <dir>     Install prefix (default: /usr/local/bin)
#   --no-verify        Skip sha256 verification
#   --help             Show this help

set -euo pipefail

REPO="KovanicaDAG/kovanica-node"
VERSION=""
PREFIX="/usr/local/bin"
VERIFY=1

usage() {
    grep '^#' "$0" | cut -c4-
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) usage ;;
        --version) VERSION="$2"; shift 2 ;;
        --prefix) PREFIX="$2"; shift 2 ;;
        --no-verify) VERIFY=0; shift ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

# Detect platform
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS-$ARCH" in
    linux-x86_64) ASSET="kovanica-node-x86_64-linux" ;;
    linux-aarch64|linux-arm64) ASSET="kovanica-node-aarch64-linux" ;;
    darwin-x86_64) ASSET="kovanica-node-x86_64-macos" ;;
    darwin-arm64|darwin-aarch64) ASSET="kovanica-node-aarch64-macos" ;;
    *) echo "Unsupported platform: $OS-$ARCH"; exit 1 ;;
esac

# Get release info
if [[ -z "$VERSION" ]]; then
    VERSION=$(curl -sSfL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
fi

echo "Installing $REPO@$VERSION ($ASSET)..."

# Download
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

curl -sSfL "https://github.com/$REPO/releases/download/$VERSION/$ASSET.tar.gz" -o "$TMPDIR/$ASSET.tar.gz"
curl -sSfL "https://github.com/$REPO/releases/download/$VERSION/$ASSET.tar.gz.sha256" -o "$TMPDIR/$ASSET.tar.gz.sha256"

# Verify
if [[ $VERIFY -eq 1 ]]; then
    echo "Verifying sha256..."
    (cd "$TMPDIR" && sha256sum -c "$ASSET.tar.gz.sha256")
fi

# Extract and install
tar -xzf "$TMPDIR/$ASSET.tar.gz" -C "$TMPDIR"
sudo install -m755 "$TMPDIR/kovanica-node" "$PREFIX/kovanica-node"
if [[ -f "$TMPDIR/kovanica-cli" ]]; then
    sudo install -m755 "$TMPDIR/kovanica-cli" "$PREFIX/kovanica-cli"
elif [[ -f "$TMPDIR/kovanica-cli.exe" ]]; then
    sudo install -m755 "$TMPDIR/kovanica-cli.exe" "$PREFIX/kovanica-cli"
fi

echo "Installed to $PREFIX/kovanica-node"
echo ""
echo "Quick start (explorer + P2P):"
echo "  KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000 \\"
echo "  KOVANICA_LISTEN=0.0.0.0:9000 KOVANICA_POW=1 \\"
echo "  $PREFIX/kovanica-node explorer 127.0.0.1:8080"
echo ""
echo "Run 'kovanica-node help' for all commands."