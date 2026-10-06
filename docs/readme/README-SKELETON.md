# Kovanica Protocol

[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-1.7x+-orange)](https://www.rust-lang.org)
[![Network](https://img.shields.io/badge/testnet-live-success)](https://explorer.kovanica.online)

**GHOSTDAG k=3 BlockDAG** with UTXO ledger, Ed25519 signatures, native multi-asset tokens, stealth, HTLC and time-lock vaults.
Native token: **KVNC** (1 KVNC = 100 000 000 atoms).
Consensus: **PoA-only** (ratified 2026-09-25) — PoW/difficulty/staked-VRF being removed per RFC-POA-Migration.

Preferred monorepo for all protocol work (`kovanica-dag` · `kovanica-state` · `kovanica-node` · `kovanica-cli`).

## Networks

| Network   | Status  | Genesis                                                              | P2P  | Explorer                          |
|-----------|---------|----------------------------------------------------------------------|------|-----------------------------------|
| testnet   | Live    | See /api/head                                                        | 8000 | https://explorer.kovanica.online |
| mainnet   | Prepped | TBD                                                                  | 9000 | TBD                               |

Bootstrap: `seed.kovanica.online:8000` (testnet) / `seed.kovanica.online:9000` (mainnet) — DNS-only / grey-cloud

## Tokenomics (RFC-006)

| Parameter            | Value                                      |
|----------------------|--------------------------------------------|
| Max supply           | 90.2M KVNC                                 |
| Curve emission       | 82M KVNC (geometric decay)                 |
| Founder premine      | 0.2M KVNC                                  |
| Treasury (vested)    | 8M KVNC (8 × 1M RFC-005 vaults)          |
| Genesis subsidy s₀   | 10 KVNC / block                            |
| Era length           | 2 050 000 blocks                           |
| Decay α              | 3/4 per era                                |
| Coinbase maturity    | 100 blocks                                 |
| Fee split            | 75 % burned / 25 % to producer             |
| Fee floor            | `max(1, subsidy / 500_000)` atoms per byte |

> Always verify live parameters via `GET /api/head`.

## Architecture

```
kovanica-protocol/
├── kovanica-dag/      # GHOSTDAG consensus (k=3)
├── kovanica-state/    # UTXO ledger
├── kovanica-node/     # Node binary + HTTP API
└── kovanica-cli/      # CLI wallet tools
```

Consensus: PoA-only GHOSTDAG · Ledger: UTXO · Signatures: Ed25519 (64-byte → 128 hex)

## Quick Start (participant node — testnet)

```sh
export KOVANICA_POW=1
export KOVANICA_MINE=0
export KOVANICA_MINE_SECS=120
export KOVANICA_FAUCET=0
export KOVANICA_ALLOW_RESET=0
export KOVANICA_OPERATOR=0
export KOVANICA_LISTEN=0.0.0.0:8000
export KOVANICA_PEERS=seed.kovanica.online:8000,seed2.kovanica.online:8000
export KOVANICA_DATA="$PWD/data"

cargo build --release -p kovanica-node
./target/release/kovanica-node explorer 127.0.0.1:8080
```

Critical:
- Use DNS-only bootstrap name. Never point peers at the Cloudflare orange-cloud explorer hostname for TCP 8000/9000.
- Preserve `KOVANICA_DATA` after first genesis write.
- After sync, local `/api/head` must match public genesis + tip.
- Testnet P2P port is **8000**, mainnet is **9000**.

## Build & Deploy

```sh
cargo build --release
# see deploy/ for testnet/mainnet configs + systemd units
./deploy/preflight.sh   # always run before enabling any unit
```

## RFC / KVP Status

| RFC     | KVP    | Feature                        | Status   |
|---------|--------|--------------------------------|----------|
| RFC-001 | KVP-101| Multisig (M-of-N P2SH)          | Shipped  |
| RFC-002 | KVP-102| Native multi-asset tokens      | Shipped  |
| RFC-003 | KVP-103| Stealth + script v2            | Shipped  |
| RFC-004 | KVP-104| HTLC atomic swaps              | Shipped  |
| RFC-005 | KVP-105| Time-lock vault + CSV          | Shipped  |
| RFC-006 | —      | Tokenomics (emission + cap)    | Shipped  |

## Safety Rules

1. Private keys stay **client-side** (node never sees seeds)
2. P2P: plaintext TCP only (port 8000 testnet / 9000 mainnet)
3. RFC-006 hard caps enforced
4. `ALLOW_RESET=1` only for seed1 genesis
5. No faucet on mainnet
6. Authority keys mode `0600`

## Development Workflow

1. Prefer this monorepo for any change to dag / state / node / cli
2. Always verify live parameters via `/api/head` and `/api/bootstrap`
3. Keep all private key material strictly client-side
4. Target the documented HTTP API + Ed25519 sighash for any new client

## Links

- Site: https://kovanica.online
- Explorer: https://explorer.kovanica.online
- Wallet: https://wallet.kovanica.online
- Node binary: https://github.com/KovanicaDAG/kovanica-node
- One-click install: `curl -sSfL https://raw.githubusercontent.com/KovanicaDAG/kovanica-node/main/scripts/install.sh | bash`

## License

MIT OR Apache-2.0