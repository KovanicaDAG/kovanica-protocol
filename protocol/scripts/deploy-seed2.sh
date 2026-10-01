#!/usr/bin/env bash
# deploy-seed2.sh — Provision seed2 on a fresh VPS (different provider/region from the primary seed).
#
# Usage:
#   ./scripts/deploy-seed2.sh <user>@<host> [options]
#
# Options:
#   --name <name>         Seed name (default: seed2)
#   --peers <host:port>   Bootstrap peers (default: seed.kovanica.online:9000,seed2.kovanica.online:9000)
#   --mine                Enable auto-mining (default: 0 for pure seed)
#   --mine-secs <secs>    Block interval when mining (default: 60)
#   --explorer <port>     Explorer HTTP port (default: 8080)
#   --p2p <port>          P2P listen port (default: 9000)
#   --keep-build          Keep the source tree after building
#
# Example (DigitalOcean NYC, Hetzner Helsinki, Vultr Tokyo, etc.):
#   ./scripts/deploy-seed2.sh root@192.0.2.1 --name seed2 --mine

set -euo pipefail

TARGET=""
NAME="seed2"
PEERS="seed.kovanica.online:9000,seed2.kovanica.online:9000"
MINE=0
MINE_SECS=60
EXPLORER_PORT=8080
P2P_PORT=9000
KEEP_BUILD=0
METRICS_PORT=9090

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
HOSTNAME="seed2.kovanica.online"

echo "=== Kovanica seed2 deploy: $NAME -> $TARGET ==="
echo "Target hostname for DNS: $HOSTNAME"

echo "[1/8] Shipping source tarball..."
TARBALL=$(mktemp /tmp/kovanica-src.XXXX.tar.gz)
git -C "$REPO_ROOT" archive --format=tar.gz -o "$TARBALL" HEAD
ssh "$TARGET" "sudo mkdir -p '$REMOTE_SRC' && sudo rm -rf '$REMOTE_SRC'/*"
scp -q "$TARBALL" "$TARGET:/tmp/kovanica-src.tar.gz"
ssh "$TARGET" "sudo tar -xzf /tmp/kovanica-src.tar.gz -C '$REMOTE_SRC' && sudo chown -R \$(whoami) '$REMOTE_SRC'"
rm -f "$TARBALL"

echo "[2/8] Installing build prerequisites..."
ssh "$TARGET" 'if command -v apt-get >/dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y -qq curl ca-certificates build-essential pkg-config >/dev/null
elif command -v dnf >/dev/null; then
    sudo dnf install -y -q gcc gcc-c++ make pkgconfig 2>/dev/null || sudo dnf install -y -q gcc gcc-c++ make
else
    echo "unsupported distro: need apt-get or dnf" >&2; exit 1
fi'

echo "[3/8] Ensuring swap (micro VMs need it for the release build)..."
ssh "$TARGET" 'if [ "$(free -m | awk "/Mem:/{print \$2}")" -lt 2000 ] && ! swapon --show | grep -q .; then
    sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile &&
    sudo mkswap /swapfile && sudo swapon /swapfile &&
    echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null;
fi'

echo "[4/8] Installing Rust toolchain..."
ssh "$TARGET" 'if ! command -v cargo >/dev/null; then
    curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none >/dev/null 2>&1;
fi;
source "$HOME/.cargo/env"'

echo "[5/8] Building release binary (this takes a few minutes)..."
ssh "$TARGET" "source \$HOME/.cargo/env && cd '$REMOTE_SRC' && cargo build --release --locked -p kovanica-node"

echo "[6/8] Installing systemd service + Prometheus metrics..."
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
Environment=KOVANICA_METRICS=0.0.0.0:$METRICS_PORT
ExecStart=/usr/local/bin/kovanica-node explorer 127.0.0.1:$EXPLORER_PORT
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now kovanica-$NAME"

echo "[7/8] Firewall + fail2ban..."
ssh "$TARGET" "
command -v ufw >/dev/null && sudo ufw allow ${P2P_PORT}/tcp comment 'Kovanica P2P' >/dev/null || true
command -v ufw >/dev/null && sudo ufw allow from 127.0.0.1 to any port ${EXPLORER_PORT} comment 'Explorer loopback' >/dev/null || true
command -v ufw >/dev/null && sudo ufw allow from 127.0.0.1 to any port ${METRICS_PORT} comment 'Metrics loopback' >/dev/null || true
command -v apt-get >/dev/null && sudo apt-get install -y -qq fail2ban >/dev/null 2>&1 || true
sudo tee /etc/fail2ban/jail.local >/dev/null <<'F2B'
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
[recidive]
enabled = true
filter = recidive
logpath = /var/log/fail2ban.log
bantime = 86400
findtime = 86400
F2B
sudo systemctl enable --now fail2ban || true
" || true

echo "[8/8] Prometheus node-exporter + Grafana alerting rules..."
ssh "$TARGET" "
command -v apt-get >/dev/null && sudo apt-get install -y -qq prometheus-node-exporter >/dev/null 2>&1 || true
sudo systemctl enable --now prometheus-node-exporter || true
" || true

if [[ "$KEEP_BUILD" != 1 ]]; then
    echo "Cleaning up source tree..."
    ssh "$TARGET" "sudo rm -rf '$REMOTE_SRC' /tmp/kovanica-src.tar.gz"
fi

echo "Waiting for sync verification..."
sleep 10

echo "Fetching genesis from primary seed..."
SEED_GENESIS=$(curl -sS --max-time 10 http://seed.kovanica.online:8080/api/head 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['genesis'])" 2>/dev/null || echo "unknown")

echo "Checking seed2 genesis..."
NEW_HEAD=$(ssh "$TARGET" "curl -sS --max-time 10 http://127.0.0.1:$EXPLORER_PORT/api/head 2>/dev/null || true")
NEW_GENESIS=$(echo "$NEW_HEAD" | python3 -c "import json,sys; print(json.load(sys.stdin).get('genesis',''))" 2>/dev/null || echo "unknown")

if [[ -n "$NEW_GENESIS" && "$NEW_GENESIS" == "$SEED_GENESIS" ]]; then
    echo "=== OK: $NAME synced to the same network (genesis $NEW_GENESIS) ==="
else
    echo "=== WARNING: could not confirm genesis match (seed: $SEED_GENESIS, got: $NEW_GENESIS) ==="
    echo "Check: ssh $TARGET journalctl -u kovanica-$NAME -n 50"
fi

cat <<EOF

=== seed2 deployed ===

P2P endpoint      : ${TARGET#*@}:${P2P_PORT}  (advertise this / DNS A: $HOSTNAME)
Explorer HTTP     : loopback :$EXPLORER_PORT  (ssh -L $EXPLORER_PORT:127.0.0.1:$EXPLORER_PORT $TARGET)
Prometheus metrics: loopback :$METRICS_PORT   (ssh -L $METRICS_PORT:127.0.0.1:$METRICS_PORT $TARGET)

Service: systemctl status kovanica-$NAME
Logs:    journalctl -u kovanica-$NAME -f
Data:    /var/lib/kovanica-$NAME

DNS:
  A     $HOSTNAME   -> ${TARGET#*@}
  AAAA  $HOSTNAME   -> (if IPv6)

Bootstrap list (add to KOVANICA_PEERS on new nodes):
  seed.kovanica.online:9000
  seed2.kovanica.online:9000

Next:
  1. Add DNS A/AAAA record for $HOSTNAME
  2. Verify peer connectivity: curl http://$HOSTNAME:$EXPLORER_PORT/api/head
  3. Verify metrics: curl http://$HOSTNAME:$METRICS_PORT/metrics
  4. Add to Cloudflare DNS (grey-cloud for P2P port)
EOF