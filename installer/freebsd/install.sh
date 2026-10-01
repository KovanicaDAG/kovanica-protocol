#!/usr/bin/env bash
# Kovanica Protocol — FreeBSD Installer
#
# Usage:
#   sudo pkg install -y git curl bash
#   curl -fsSL https://raw.githubusercontent.com/KovanicaDAG/kovanica-protocol/main/kovanica-install/freebsd/install.sh | sudo bash

set -euo pipefail

REPO_URL="https://github.com/KovanicaDAG/kovanica-protocol"
BINARY="kovanica-node"
DATA_DIR="/var/lib/kovanica"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

[[ $EUID -ne 0 ]] && die "Run as root: sudo $0"

ARCH=$(uname -m)
case "$ARCH" in
    amd64)  ARCH_NAME="x86_64" ;;
    arm64)  ARCH_NAME="aarch64" ;;
    *)      die "Unsupported: $ARCH" ;;
esac

info "Kovanica Protocol Installer (FreeBSD)"

# Install dependencies
pkg install -y git curl bash pkgconf

# Try pre-built binary
tmpdir=$(mktemp -d)
url="${REPO_URL}/releases/download/v0.2.0/kovanica-node-freebsd-${ARCH_NAME}.tar.gz"

if curl -fsSL --retry 3 -o "${tmpdir}/k.tar.gz" "$url" 2>/dev/null; then
    tar -xzf "${tmpdir}/k.tar.gz" -C "${tmpdir}"
    bin=$(find "${tmpdir}" -name "$BINARY" -type f | head -1)
    if [[ -n "$bin" ]]; then
        cp "$bin" "/usr/local/bin/${BINARY}"
        chmod +x "/usr/local/bin/${BINARY}"
        rm -rf "${tmpdir}"
        ok "Binary installed"
    fi
else
    rm -rf "${tmpdir}"
    info "No pre-built binary, building from source..."

    if ! command -v rustup >/dev/null 2>&1; then
        pkg install -y rust
    fi

    srcdir=$(mktemp -d)
    git clone --depth 1 "${REPO_URL}.git" "${srcdir}/kovanica"
    cd "${srcdir}/kovanica"
    cargo build --release -p kovanica-node
    cp target/release/$BINARY /usr/local/bin/
    chmod +x /usr/local/bin/$BINARY
    rm -rf "${srcdir}"
    ok "Built and installed"
fi

# Systemd-like service (FreeBSD uses rc.d)
mkdir -p "$DATA_DIR"

cat > /usr/local/etc/rc.d/kovanica-node <<'RCSCRIPT'
#!/bin/sh
#
# Kovanica BlockDAG Node
#

 PROVIDE: kovanica-node
 REQUIRE: NETWORKING
 BEFORE: DAEMON

. /etc/rc.subr

name="kovanica_node"
rcvar="${name}_enable"

command="/usr/local/bin/kovanica-node"
command_args="serve"
pidfile="/var/run/${name}.pid"

export KOVANICA_DATA="/var/lib/kovanica"
export KOVANICA_P2P_PORT="9000"
export KOVANICA_HTTP_PORT="8080"
export KOVANICA_PEERS="seed.kovanica.online:9000,seed2.kovanica.online:9000"

load_rc_config $name
run_rc_command "$1"
RCSCRIPT

chmod +x /usr/local/etc/rc.d/kovanica-node

# Enable in rc.conf
grep -q "kovanica_node_enable" /etc/rc.conf 2>/dev/null || \
    echo 'kovanica_node_enable="YES"' >> /etc/rc.conf

# Firewall (pf)
if [[ -f /etc/pf.conf ]]; then
    echo 'pass in on eproto proto tcp from any to any port { 9000, 8080 } keep state' | \
        tee -a /etc/pf.conf >/dev/null 2>/dev/null || true
fi

ok "FreeBSD service installed"
echo "  Start:   service kovanica-node start"
echo "  Stop:    service kovanica-node stop"
echo "  Logs:    tail -f /var/log/kovanica-node.log"
