#!/usr/bin/env bash
# deploy-seed.sh — Provision a Kovanica seed node on a fresh remote VPS.
#
# Runs FROM an operator machine that can SSH to the target. Ships the current
# source as a tarball (works with private repos — no clone credentials needed),
# builds the release binary on the target (adds swap first so 1GB micro VMs
# survive the build), installs a systemd unit, opens the firewall, and
# verifies the node syncs back to the primary seed.
#
# Usage:
#   ./scripts/deploy-seed.sh <user>@<host> [options]
#
# Options:
#   --name <name>         Seed name (default: seed2; used in unit + data dir)
#   --peers <host:port>   Bootstrap peers (default: seed.kovanica.online:9000;
#                         pass "off" to start a standalone network)
#   --mine                Enable auto-mining (default: off for pure seeds)
#   --mine-secs <s>       Block interval when mining (default: 60)
#   --explorer <port>     Explorer HTTP port (default: 8080)
#   --p2p <port>          P2P listen port (default: 9000)
#   --keep-build          Keep the source tree after building (default: remove)
#
# Example (Oracle Always Free ARM box):
#   ./scripts/deploy-seed.sh ubuntu@130.61.x.x --name seed2 --mine

set -euo pipefail

TARGET=""
NAME="seed2"
PEERS="seed.kovanica.online:9000,seed2.kovanica.online:9000"
MINE=0
MINE_SECS=60
EXPLORER_PORT=8080
P2P_PORT=9000
KEEP_BUILD=0

usage() { grep '^#' "$0" | cut -c4-; exit 0; }

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) usage ;;
        --name) NAME="$2"; shift 2 ;;
        --peers) PEERS="$2"; shift 2 ;;
        --mine) MINE=1; shift ;;
        --mine-secs) MINE_SECS="$2"; shift 2 ;;
        --explorer) EXPLORER_PORT="$2"; shift 2 ;;
        --p2p) P2P_PORT="$2"; shift 2 ;;
        --keep-build) KEEP_BUILD=1; shift ;;
        *)
            if [[ -z "$TARGET" ]]; then TARGET="$1"; else echo "Unknown argument: $1"; usage; fi
            shift ;;
    esac
done

[[ -z "$TARGET" ]] && { echo "Error: <user>@<host> required"; usage; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_SRC="/opt/kovanica-src"
REMOTE_DATA="/var/lib/kovanica-$NAME"

echo "=== Kovanica seed deploy: $NAME -> $TARGET ==="

echo "[1/7] Shipping source tarball..."
TARBALL=$(mktemp /tmp/kovanica-src.XXXX.tar.gz)
git -C "$REPO_ROOT" archive --format=tar.gz -o "$TARBALL" HEAD
ssh "$TARGET" "sudo mkdir -p '$REMOTE_SRC' && sudo rm -rf '$REMOTE_SRC'/*"
scp -q "$TARBALL" "$TARGET:/tmp/kovanica-src.tar.gz"
ssh "$TARGET" "sudo tar -xzf /tmp/kovanica-src.tar.gz -C '$REMOTE_SRC' && sudo chown -R \$(whoami) '$REMOTE_SRC'"
rm -f "$TARBALL"

echo "[2/7] Installing build prerequisites..."
# Debian/Ubuntu vs RHEL-family (Amazon Linux, Fedora): same toolset, two managers.
ssh "$TARGET" 'if command -v apt-get >/dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y -qq curl ca-certificates build-essential pkg-config >/dev/null
elif command -v dnf >/dev/null; then
    # AL2023 ships curl(-minimal); installing `curl` beside it conflicts.
    sudo dnf install -y -q gcc gcc-c++ make pkgconfig 2>/dev/null \
      || sudo dnf install -y -q gcc gcc-c++ make
else
    echo "unsupported distro: need apt-get or dnf" >&2; exit 1
fi'

echo "[3/7] Ensuring swap (micro VMs need it for the release build)..."
ssh "$TARGET" 'if [ "$(free -m | awk "/Mem:/{print \$2}")" -lt 2000 ] && ! swapon --show | grep -q .; then
    sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile &&
    sudo mkswap /swapfile && sudo swapon /swapfile &&
    echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null;
fi'

echo "[4/7] Installing Rust toolchain..."
ssh "$TARGET" 'if ! command -v cargo >/dev/null; then
    # Install rustup with no default toolchain; rust-toolchain.toml pins the version.
    curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none >/dev/null 2>&1;
fi;
source "$HOME/.cargo/env"'

echo "[5/7] Building release binary (this takes a few minutes)..."
ssh "$TARGET" "source \$HOME/.cargo/env && cd '$REMOTE_SRC' && cargo build --release --locked -p kovanica-node"

echo "[6/7] Installing service..."
ssh "$TARGET" "sudo mkdir -p '$REMOTE_DATA' && \
sudo cp '$REMOTE_SRC/target/release/kovanica-node' /usr/local/bin/kovanica-node && \
sudo tee /etc/systemd/system/kovanica-$NAME.service >/dev/null <<EOF
[Unit]
Description=Kovanica seed node ($NAME)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DATA
Environment=KOVANICA_LISTEN=0.0.0.0:$P2P_PORT
Environment=KOVANICA_POW=1
Environment=KOVANICA_PEERS=$PEERS
Environment=KOVANICA_OPERATOR=1
Environment=KOVANICA_MINE=$MINE
Environment=KOVANICA_MINE_SECS=$MINE_SECS
Environment=KOVANICA_FAUCET=0
Environment=KOVANICA_ALLOW_RESET=0
Environment=KOVANICA_DATA=$REMOTE_DATA
ExecStart=/usr/local/bin/kovanica-node explorer 127.0.0.1:$EXPLORER_PORT
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now kovanica-$NAME"

echo "[7/7] Firewall (P2P $P2P_PORT open, explorer/metrics loopback-only)..."
ssh "$TARGET" "command -v ufw >/dev/null && sudo ufw allow ${P2P_PORT}/tcp comment 'Kovanica P2P' >/dev/null || true"

if [[ "$KEEP_BUILD" != 1 ]]; then
    echo "Cleaning up source tree..."
    ssh "$TARGET" "sudo rm -rf '$REMOTE_SRC' /tmp/kovanica-src.tar.gz"
fi

echo "Waiting for sync verification..."
sleep 8
SEED_GENESIS=$(curl -sS --max-time 10 http://127.0.0.1:8080/api/head | python3 -c "import json,sys; print(json.load(sys.stdin)['genesis'])")
NEW_HEAD=$(ssh "$TARGET" "curl -sS --max-time 10 http://127.0.0.1:$EXPLORER_PORT/api/head || true")
NEW_GENESIS=$(echo "$NEW_HEAD" | python3 -c "import json,sys; print(json.load(sys.stdin).get('genesis',''))" 2>/dev/null || true)

if [[ -n "$NEW_GENESIS" && "$NEW_GENESIS" == "$SEED_GENESIS" ]]; then
    echo "=== OK: $NAME synced to the same network (genesis $NEW_GENESIS) ==="
else
    echo "=== WARNING: could not confirm genesis match (got: '${NEW_GENESIS:-none}') ==="
    echo "Check: ssh $TARGET journalctl -u kovanica-$NAME -n 50"
fi

cat <<EOF

Deployed:
  P2P       : ${TARGET#*@}:${P2P_PORT}  <- advertise this / point DNS A record at the host
  Explorer  : loopback :$EXPLORER_PORT (ssh -L $EXPLORER_PORT:127.0.0.1:$EXPLORER_PORT $TARGET)
  Metrics   : loopback :9090
  Service   : systemctl status kovanica-$NAME
  Data      : $REMOTE_DATA
EOF
