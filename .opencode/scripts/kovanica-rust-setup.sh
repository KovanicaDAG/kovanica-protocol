#!/usr/bin/env bash
set -euo pipefail

echo "============================================================"
echo " Kovanica Clean Rust + CLI Setup (FIXED)"
echo "============================================================"
echo

# ------------------------------------------------------------
# 0. Build dependencies PRVO (ovo je bilo uzrok greške)
# ------------------------------------------------------------
echo ">>> 0. Instalacija build dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt update -qq
apt install -y \
  build-essential \
  clang \
  mold \
  pkg-config \
  libssl-dev \
  curl \
  git \
  jq \
  ca-certificates 2>/dev/null || true

# Očisti eventualno pokvarene CC/CFLAGS
unset CC CXX CFLAGS CXXFLAGS
export CC=gcc
export CXX=g++

echo ">>> Build tools OK (gcc/clang/mold)."
echo

# ------------------------------------------------------------
# 1. Čišćenje starih instalacija
# ------------------------------------------------------------
echo ">>> 1. Čišćenje starih/apt instalacija..."

apt remove --purge -y rustup rustc cargo 2>/dev/null || true
apt autoremove -y 2>/dev/null || true

rm -rf /root/.cargo /root/.rustup /root/.cache/sccache
rm -rf /tmp/cargo-install* 2>/dev/null || true

echo ">>> Čišćenje gotovo."
echo

# ------------------------------------------------------------
# 2 + 3. Službeni rustup
# ------------------------------------------------------------
echo ">>> 2/3. Instalacija službenog rustupa..."

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source /root/.cargo/env

# Osiguraj PATH
export PATH="/root/.cargo/bin:$PATH"

echo ">>> rustup instaliran."
rustc --version
rustup --version
echo

# ------------------------------------------------------------
# 4. Komponente
# ------------------------------------------------------------
echo ">>> 4. Dodavanje komponenti..."

rustup component add rustfmt clippy rust-analyzer
rustup default stable
rustup update

echo ">>> Komponente OK."
echo

# ------------------------------------------------------------
# 5. Cargo alati (jedan po jedan da se vidi greška)
# ------------------------------------------------------------
echo ">>> 5. Instalacija cargo alata..."

# nextest mora --locked
cargo install --locked cargo-nextest

# ostali
for crate in cargo-edit cargo-watch cargo-expand cargo-outdated \
             cargo-audit cargo-deny bacon sccache hyperfine just; do
  echo "  → installing $crate ..."
  cargo install --locked "$crate" 2>/dev/null || cargo install "$crate" || true
done

echo ">>> Cargo alati gotovi."
echo

# ------------------------------------------------------------
# 6. ~/.cargo/config.toml
# ------------------------------------------------------------
echo ">>> 6. Pisanje ~/.cargo/config.toml..."

mkdir -p /root/.cargo
cat > /root/.cargo/config.toml << 'EOF'
[build]
rustc-wrapper = "sccache"

[target.x86_64-unknown-linux-gnu]
linker = "clang"
rustflags = ["-C", "link-arg=-fuse-ld=mold"]

[alias]
b = "build --release"
t = "nextest run"
c = "clippy --all-targets --all-features -- -D warnings"
f = "fmt --all"
w = "watch -x check -x test"
x = "expand"
EOF

echo ">>> config.toml napisan."
echo

# ------------------------------------------------------------
# 7. Aliasi
# ------------------------------------------------------------
echo ">>> 7. Dodavanje aliasa u ~/.bashrc..."

sed -i '/# >>> Kovanica Dev Setup >>>/,/# <<< Kovanica Dev Setup <<</d' /root/.bashrc 2>/dev/null || true

cat >> /root/.bashrc << 'EOF'

# >>> Kovanica Dev Setup >>>
export CARGO_HOME="$HOME/.cargo"
export RUSTUP_HOME="$HOME/.rustup"
export PATH="$CARGO_HOME/bin:$PATH"
export RUSTC_WRAPPER=sccache
export SCCACHE_DIR="$HOME/.cache/sccache"

export KOVANICA_DATA="${KOVANICA_DATA:-$HOME/kovanica-data}"
export KOVANICA_PEERS="seed.kovanica.online:9000"
export KOVANICA_LISTEN="0.0.0.0:9000"

alias knode='./target/release/kovanica-node'
alias knode-dev='cargo run --release --bin kovanica-node --'
alias kn-participant='KOVANICA_POW=1 KOVANICA_MINE=0 KOVANICA_FAUCET=0 KOVANICA_ALLOW_RESET=0 KOVANICA_OPERATOR=0 KOVANICA_LISTEN=0.0.0.0:9000 KOVANICA_PEERS=seed.kovanica.online:9000 KOVANICA_DATA=$KOVANICA_DATA knode explorer 127.0.0.1:8080'
alias kn-explorer='KOVANICA_POW=1 KOVANICA_MINE=0 KOVANICA_FAUCET=0 KOVANICA_ALLOW_RESET=0 KOVANICA_OPERATOR=0 KOVANICA_LISTEN=0.0.0.0:9000 KOVANICA_PEERS=seed.kovanica.online:9000 KOVANICA_DATA=$KOVANICA_DATA knode explorer 0.0.0.0:8080'
alias kn-miner='KOVANICA_POW=1 KOVANICA_MINE=1 KOVANICA_MINE_SECS=30 KOVANICA_FAUCET=0 KOVANICA_ALLOW_RESET=0 KOVANICA_OPERATOR=0 KOVANICA_LISTEN=0.0.0.0:9000 KOVANICA_PEERS=seed.kovanica.online:9000 KOVANICA_DATA=$KOVANICA_DATA knode explorer 127.0.0.1:8080'

alias khead='curl -s https://api.kovanica.online/api/head | jq'
alias khead-local='curl -s http://127.0.0.1:8080/api/head | jq'
alias ktip='curl -s https://api.kovanica.online/api/head | jq -r ".tip // .hash // .blocks"'
alias ksupply='curl -s https://api.kovanica.online/api/head | jq "{native_minted, circulating, burned, total, max_supply, subsidy}"'
alias ksync='echo "=== LOCAL ===" && khead-local && echo -e "\n=== PUBLIC ===" && khead'

alias c='cargo'
alias cb='cargo build --release'
alias ct='cargo nextest run'
alias cc='cargo clippy --all-targets --all-features -- -D warnings'
alias cf='cargo fmt --all'
alias ccheck='cargo fmt --all && cargo clippy --all-targets --all-features -- -D warnings && cargo nextest run'
alias be='bacon'
alias cw='cargo watch -x check -x "nextest run"'

alias kn-build='cargo build --release -p kovanica-node'
alias kn-test='cargo nextest run -p kovanica-node -p kovanica-dag -p kovanica-state'
alias kn-clippy='cargo clippy -p kovanica-node -p kovanica-dag -p kovanica-state --all-features -- -D warnings'
# <<< Kovanica Dev Setup <<<
EOF

source /root/.bashrc 2>/dev/null || true

echo ">>> Aliasi dodani."
echo

# ------------------------------------------------------------
# 8. Finalna provjera
# ------------------------------------------------------------
echo "============================================================"
echo " FINALNA PROVJERA"
echo "============================================================"
echo

echo "rustc:         $(rustc --version 2>/dev/null || echo FAIL)"
echo "cargo:         $(cargo --version 2>/dev/null || echo FAIL)"
echo "rustup:        $(rustup --version 2>/dev/null || echo FAIL)"
echo "which rustc:   $(which rustc)"
echo "which cargo:   $(which cargo)"
echo "gcc:           $(gcc --version 2>/dev/null | head -1 || echo FAIL)"
echo "clang:         $(clang --version 2>/dev/null | head -1 || echo FAIL)"
echo
echo "cargo-nextest: $(cargo nextest --version 2>/dev/null || echo 'nije instaliran')"
echo "bacon:         $(bacon --version 2>/dev/null || echo 'nije instaliran')"
echo "sccache:       $(sccache --version 2>/dev/null || echo 'nije instaliran')"
echo "just:          $(just --version 2>/dev/null || echo 'nije instaliran')"
echo "hyperfine:     $(hyperfine --version 2>/dev/null || echo 'nije instaliran')"
echo

echo "============================================================"
echo " Setup završen!"
echo "============================================================"
echo
echo "Pokreni još:"
echo "  source ~/.bashrc"
echo
