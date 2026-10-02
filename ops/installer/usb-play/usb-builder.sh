#!/usr/bin/env bash
# Kovanica Protocol — USB Plug-and-Play Node Builder
#
# Creates a bootable USB drive that runs a Kovanica node automatically.
# Ideal for: dedicated always-on nodes, airgapped cold storage, gift nodes.
#
# Supports:
#   - Raspberry Pi SD card image (recommended)
#   - x86_64 live ISO (for PC/laptop)
#   - Pre-configured portable node on any USB drive
#
# Usage:
#   ./usb-builder.sh --target pi         # Build RPi SD image
#   ./usb-builder.sh --target live       # Build x86_64 live ISO
#   ./usb-builder.sh --target portable   # Build portable USB node
#   ./usb-builder.sh --target dd         # Direct dd to USB device
#
# Options:
#   --device /dev/sdX    Target device (for --target dd)
#   --wifi-ssid SSID     Pre-configure Wi-Fi
#   --wifi-pass PASS     Wi-Fi password
#   --peers PEERS        Bootstrap peers
#   --mine               Enable mining

set -euo pipefail

VERSION="0.2.0"
REPO_URL="https://github.com/KovanicaDAG/kovanica-protocol"
BINARY="kovanica-node"
TARGET=""
DEVICE=""
WIFI_SSID=""
WIFI_PASS=""
PEERS="seed.kovanica.online:9000,seed2.kovanica.online:9000"
MINE=0
MINE_SECS=60

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
    case $1 in
        --target)       TARGET="$2"; shift 2 ;;
        --device)       DEVICE="$2"; shift 2 ;;
        --wifi-ssid)    WIFI_SSID="$2"; shift 2 ;;
        --wifi-pass)    WIFI_PASS="$2"; shift 2 ;;
        --peers)        PEERS="$2"; shift 2 ;;
        --mine)         MINE=1; shift ;;
        --mine-secs)    MINE_SECS="$2"; shift 2 ;;
        -h|--help)      grep '^#' "$0" | cut -c4-; exit 0 ;;
        *) die "Unknown: $1" ;;
    esac
done

[[ -z "$TARGET" ]] && die "Specify --target [pi|live|portable|dd]"

# ─── Build RPi SD Image ─────────────────────────────────────────────────────

build_pi_image() {
    info "Building Raspberry Pi SD card image..."
    info "This creates a headless node that boots and syncs automatically."

    local imgsize="4G"
    local imgfile="kovanica-node-rpi-${VERSION}.img"
    local tmpdir
    tmpdir=$(mktemp -d)

    # Download Raspberry Pi OS Lite (minimal, no desktop)
    info "Downloading Raspberry Pi OS Lite (Bookworm arm64)..."
    local rpi_url="https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2024-11-19/2024-11-19-raspios-bookworm-arm64-lite.img.xz"
    curl -fsSL --retry 3 -o "${tmpdir}/rpi-os.img.xz" "$rpi_url" 2>/dev/null || {
        warn "Could not download RPi OS. Using local image if available."
        warn "Alternatively, use: rpi-imager to flash, then run install.sh on the Pi."
        return 1
    }

    info "Extracting image..."
    xz -d "${tmpdir}/rpi-os.img.xz"

    # Expand image
    info "Expanding image to ${imgsize}..."
    truncate -s "$imgsize" "${tmpdir}/rpi-os.img"

    # Create partitions (boot + root)
    # Note: This requires losetup + kpartx or similar
    info "Creating partitions..."
    sudo parted -s "${tmpdir}/rpi-os.img" -- \
        resizepart 2 100% \
        resizepart 1 256MiB

    # Mount and customize
    local loopdev
    loopdev=$(sudo losetup -fP --show "${tmpdir}/rpi-os.img")

    sudo mkfs.ext4 -F "${loopdev}p2"
    local rootmnt=$(mktemp -d)
    sudo mount "${loopdev}p2" "$rootmnt"

    local bootmnt=$(mktemp -d)
    sudo mount "${loopdev}p1" "$bootmnt"

    # Enable SSH
    sudo touch "${bootmnt}/ssh"

    # Pre-configure Wi-Fi (if provided)
    if [[ -n "$WIFI_SSID" ]]; then
        cat > "${bootmnt}/wpa_supplicant.conf" <<EOF
country=US
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
    ssid="${WIFI_SSID}"
    psk="${WIFI_PASS}"
    key_mgmt=WPA-PSK
}
EOF
        ok "Wi-Fi pre-configured: ${WIFI_SSID}"
    fi

    # Install Kovanica node in chroot
    info "Installing Kovanica node in image..."

    # Copy binary (pre-built for arm64)
    sudo mkdir -p "${rootmnt}/usr/local/bin"
    local url="${REPO_URL}/releases/download/v${VERSION}/kovanica-node-linux-aarch64.tar.gz"
    sudo curl -fsSL -o "/tmp/kovanica.tar.gz" "$url" 2>/dev/null && \
        sudo tar -xzf "/tmp/kovanica.tar.gz" -C "${rootmnt}/usr/local/bin/" || {
            warn "Pre-built binary not available — node will build on first boot"
            cat > "${rootmnt}/usr/local/bin/kovanica-first-boot.sh" <<'FB'
#!/bin/bash
# First-boot script: build kovanica-node from source
apt-get update && apt-get install -y curl build-essential pkg-config git
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env
git clone --depth 1 https://github.com/KovanicaDAG/kovanica-protocol.git /opt/kovanica-src
cd /opt/kovanica-src && cargo build --release -p kovanica-node
cp target/release/kovanica-node /usr/local/bin/
chmod +x /usr/local/bin/kovanica-node
rm -rf /opt/kovanica-src
systemctl start kovanica-node
FB
            chmod +x "${rootmnt}/usr/local/bin/kovanica-first-boot.sh"
        }

    # Create systemd service
    sudo mkdir -p "${rootmnt}/etc/systemd/system"
    sudo tee "${rootmnt}/etc/systemd/system/kovanica-node.service" >/dev/null <<EOF
[Unit]
Description=Kovanica BlockDAG Node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/${BINARY} serve
Restart=on-failure
RestartSec=10
Environment=KOVANICA_DATA=/var/lib/kovanica
Environment=KOVANICA_P2P_PORT=9000
Environment=KOVANICA_HTTP_PORT=8080
Environment=KOVANICA_PEERS=${PEERS}
Environment=KOVANICA_MINE=${MINE}
Environment=KOVANICA_MINE_SECS=${MINE_SECS}

[Install]
WantedBy=multi-user.target
EOF

    sudo ln -sf /etc/systemd/system/kovanica-node.service "${rootmnt}/etc/systemd/system/multi-user.target.wants/kovanica-node.service"
    sudo mkdir -p "${rootmnt}/var/lib/kovanica"

    # Cleanup script on first boot
    cat > "${rootmnt}/etc/rc.local" <<'RC'
#!/bin/bash
# Kovanica first-boot: build if binary missing
if [ ! -f /usr/local/bin/kovanica-node ]; then
    /usr/local/bin/kovanica-first-boot.sh &
fi
exit 0
RC
    sudo chmod +x "${rootmnt}/etc/rc.local"

    # Unmount
    sudo umount "$bootmnt"
    sudo umount "$rootmnt"
    sudo losetup -d "$loopdev"

    # Compress
    info "Compressing image..."
    xz -9 "${tmpdir}/rpi-os.img"
    mv "${tmpdir}/rpi-os.img.xz" "./${imgfile}.img.xz"

    rm -rf "${tmpdir}"
    ok "Image ready: ${imgfile}.img.xz"
    echo ""
    echo "  Flash to SD card:"
    echo "    sudo dd if=${imgfile}.img.xz of=/dev/sdX bs=4M status=progress"
    echo "  Or use Raspberry Pi Imager"
    echo ""
}

# ─── Build Portable USB Node ────────────────────────────────────────────────

build_portable() {
    info "Building portable USB node..."
    info "This creates a directory you can copy to any USB drive."

    local outdir="kovanica-portable-${VERSION}"
    mkdir -p "${outdir}/bin" "${outdir}/data" "${outdir}/config"

    # Download binary
    local arch
    arch=$(uname -m)
    case "$arch" in
        x86_64)  arch_name="x86_64" ;;
        aarch64) arch_name="aarch64" ;;
        armv7l)  arch_name="armv7l" ;;
        *)       die "Unsupported: $arch" ;;
    esac

    local url="${REPO_URL}/releases/download/v${VERSION}/kovanica-node-linux-${arch_name}.tar.gz"
    local tmpdir
    tmpdir=$(mktemp -d)

    if curl -fsSL --retry 3 -o "${tmpdir}/k.tar.gz" "$url"; then
        tar -xzf "${tmpdir}/k.tar.gz" -C "${tmpdir}"
        local bin
        bin=$(find "${tmpdir}" -name "$BINARY" -type f | head -1)
        [[ -n "$bin" ]] && cp "$bin" "${outdir}/bin/"
    fi
    rm -rf "${tmpdir}"

    [[ ! -f "${outdir}/bin/${BINARY}" ]] && die "Could not download binary"

    # Create launch scripts
    cat > "${outdir}/start.sh" <<'LAUNCH'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export KOVANICA_DATA="${DIR}/data"
export KOVANICA_PEERS="seed.kovanica.online:9000,seed2.kovanica.online:9000"
exec "${DIR}/bin/kovanica-node" serve
LAUNCH
    chmod +x "${outdir}/start.sh"

    cat > "${outdir}/README.txt" <<README
Kovanica Node — Portable USB Edition
=====================================

Quick start:
  ./start.sh

This will start a Kovanica BlockDAG node that syncs with the testnet.
Chain data is stored in the ./data/ directory on this drive.

Explorer: https://explorer.kovanica.online
Docs: https://github.com/KovanicaDAG/kovanica-protocol#readme
README

    ok "Portable node ready: ${outdir}/"
    echo "  Copy to USB:  cp -r ${outdir} /media/usb/"
    echo "  Run from USB: /media/usb/${outdir}/start.sh"
}

# ─── Direct dd to USB ──────────────────────────────────────────────────────

dd_to_usb() {
    [[ -z "$DEVICE" ]] && die "Specify --device /dev/sdX"

    info "WARNING: This will ERASE all data on ${DEVICE}"
    echo -e "${RED}  Are you sure? This cannot be undone.${NC}"
    read -p "  Type YES to continue: " confirm
    [[ "$confirm" != "YES" ]] && die "Aborted"

    build_pi_image
    local img
    img=$(ls kovanica-node-rpi-*.img.xz 2>/dev/null | head -1)
    [[ -z "$img" ]] && die "No image found"

    info "Writing ${img} to ${DEVICE}..."
    xz -dc "$img" | sudo dd of="$DEVICE" bs=4M status=progress conv=fsync

    ok "USB drive ready! Plug into Raspberry Pi and power on."
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
    echo ""
    echo -e "${CYAN}  ╔═══════════════════════════════════════╗${NC}"
    echo -e "${CYAN}  ║   Kovanica USB Plug-and-Play Builder  ║${NC}"
    echo -e "${CYAN}  ║   Dedicated Node · Zero Config        ║${NC}"
    echo -e "${CYAN}  ╚═══════════════════════════════════════╝${NC}"
    echo ""

    case "$TARGET" in
        pi|raspberry)   build_pi_image ;;
        live)           die "Live ISO builder coming soon" ;;
        portable)       build_portable ;;
        dd)             dd_to_usb ;;
        *)              die "Unknown target: $TARGET" ;;
    esac
}

main "$@"
