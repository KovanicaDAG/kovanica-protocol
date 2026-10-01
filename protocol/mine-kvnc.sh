#!/bin/sh
# Kovanica public-testnet miner — build (once) and run a mining node.
#
#   ./mine-kvnc.sh                 mine to the address below (60s attempts)
#   KOVANICA_MINE_SECS=0 ./mine-kvnc.sh          mine continuously
#   KOVANICA_DATA=/path ./mine-kvnc.sh           custom data dir
#   ~/.kovanica/data is the default data dir; stop with Ctrl-C.

set -eu

ADDR="${KOVANICA_MINER_ADDRESS:-kvnc1HSoNA1ToYDi8baNKxctmGkH29tiy55nRC7xcRSNqS42ydag}"
MINE_SECS="${KOVANICA_MINE_SECS:-60}"

cd "$(dirname "$0")"

BIN="${KOVANICA_BIN:-target/release/kovanica-node}"
if [ ! -x "$BIN" ]; then
    echo "building kovanica-node (release)..."
    cargo build --release --bin kovanica-node
fi

echo "mining to $ADDR every ${MINE_SECS}s on testnet..."
exec env \
    KOVANICA_MINE=1 \
    KOVANICA_MINE_SECS="$MINE_SECS" \
    KOVANICA_MINER_ADDRESS="$ADDR" \
    KOVANICA_PEERS='seed.kovanica.online:9000,seed2.kovanica.online:9000' \
    KOVANICA_DATA="${KOVANICA_DATA:-$HOME/.kovanica/data}" \
    "$BIN" explorer 127.0.0.1:8080