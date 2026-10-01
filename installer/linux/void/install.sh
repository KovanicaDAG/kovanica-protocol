#!/usr/bin/env bash
# Kovanica Protocol — Void Linux Installer
#
# Uses xbps package manager. For musl or glibc Void installations.

set -euo pipefail

REPO_URL="https://github.com/KovanicaDAG/kovanica-protocol"
BINARY="kovanica-node"
DATA_DIR="${KOVANICA_DATA:-/var/lib/kovanica}"

info()  { echo -e "\033[0;34m[info]\033[0m  $*"; }
ok()    { echo -e "\033[0;32m[ok]\033[0m    $*"; }
die()   { echo -e "\033[0;31m[error]\033[0m $*" >&2; exit 1; }

[[ $EUID -ne 0 ]] && die "Run as root"

info "Kovanica Protocol Installer (Void Linux)"

# Install dependencies
xbps-install -Sy curl git gcc make pkg-config

# Build from source
if ! command -v rustup >/dev/null 2>&1; then
    info "Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "${HOME}/.cargo/env"
fi

srcdir=$(mktemp -d)
git clone --depth 1 "${REPO_URL}.git" "${srcdir}/kovanica"
cd "${srcdir}/kovanica"
cargo build --release -p kovanica-node

cp target/release/$BINARY /usr/local/bin/
chmod +x /usr/local/bin/$BINARY
rm -rf "${srcdir}"

mkdir -p "$DATA_DIR"

ok "Installed. Run: ${BINARY} serve"
