# Kovanica Protocol

GHOSTDAG BlockDAG with a pure UTXO ledger, Ed25519 signatures, PoA consensus,
and native multi-asset support.

| Parameter | Value |
|---|---|
| Consensus | **PoA-only** (ratified 2026-09-25) |
| GHOSTDAG | k=3 |
| Ledger | Pure UTXO |
| Signatures | Ed25519 (64-byte / 128 hex) |
| Native token | KVNC (1 KVNC = 100,000,000 atoms) |
| MAX_SUPPLY | 90.2M KVNC (`9_020_000_000_000_000` atoms) |
| Genesis subsidy s₀ | 10 KVNC/block |
| Era length | 2,050,000 blocks, decay α = 3/4 |
| Coinbase maturity | 100 blocks |
| Fee split | 75% burned / 25% producer |
| Fee floor | `max(1, subsidy / 500_000)` atoms/byte |
| P2P | Plaintext TCP **:9000** only (no libp2p) |
| Bootstrap seed | `seed.kovanica.online:9000` (DNS-only, grey-cloud) |

## Layout

```
protocol/          Rust workspace — the consensus and ledger core
  crates/
    kovanica-dag/     GHOSTDAG k=3 ordering, blue-set selection
    kovanica-state/   UTXO ledger, RFC-006 emission, maturity, fee burn
    kovanica-wallet/  BIP-39 + SLIP-0010 Ed25519 derivation
    kovanica-node/    P2P, HTTP API, explorer, PoA producer
    kovanica-cli/     Command line + TUI
    kovanica-ffi/     uniffi bindings for Kotlin/Swift
    kovanica-chat/    E2E encrypted P2P chat (KVP-104)
  docs/             RFCs, KVP specs, operations runbooks
  bindings/         Generated FFI bindings
web/site/           TanStack Start public site + wallet
dashboard/          Operator/dev dashboard (React + Python proxy)
wallet/             Browser extension, Android, iOS
mobile/             Console + FFI integration apps
sdk/                Rust SDK, DEX/HTLC, bridge, airdrop clients
ledger-app/         Hardware wallet integration
node/               Node packaging and release scripts
installer/          Per-platform install scripts
android-light-node/ Android light node
deploy/             Testnet / mainnet deployment config
config/             Network environment definitions
scripts/            Build, vault, and release automation
```

## Consensus rules that are not negotiable

RFC-006 numbers are **hard consensus rules** once activated:

- MAX_SUPPLY is 90.2M KVNC. Emission is enforced in `apply_block`
  (`protocol/crates/kovanica-state/src/ledger.rs`).
- Coinbase maturity is 100 blocks. Immature coinbases are skipped by the
  transaction builder, not rejected by it.
- 75% of every fee is burned. The producer receives 25%.
- The fee floor is `max(1, subsidy / 500_000)` atoms per byte.

P2P is plaintext TCP on port 9000. There is no libp2p, no TLS, and no
WebSocket transport. Never point a peer at a Cloudflare orange-cloud hostname
for TCP 9000 — use the DNS seed or the origin IP.

## Keys never reach the node

Private keys and seeds are strictly client-side. The transaction flow is:

```
POST /api/prepare   ->  offline Ed25519 sign  ->  POST /api/submit
```

A node that accepts a private key over its API is a compromised node. There is
no API endpoint that takes one, and none should ever be added.

## Build

```bash
# Rust core
cd protocol
cargo build --release --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check

# Public site
cd web/site && npm install && npm run build

# Dashboard
cd dashboard/frontend && npm install && npm run build
cd ../backend && python3 server.py
```

All Rust gates must pass. `protocol/rust-toolchain.toml` pins the toolchain.

## RFCs

| RFC | KVP | Topic | Status |
|---|---|---|---|
| RFC-001 | KVP-101 | Multisig (M-of-N P2SH) | Shipped |
| RFC-002 | KVP-102 | Native multi-asset tokens | Shipped |
| RFC-003 | KVP-103 | Stealth + script v2 | Shipped |
| RFC-004 | KVP-104 | HTLC atomic swaps | Shipped |
| RFC-005 | KVP-105 | Time-lock vault + CSV | Shipped |
| RFC-006 | — | Tokenomics | Active |
| RFC-007 | KVP-106 | NFT | Draft |

Full text lives in `protocol/docs/`.

## Operations

`protocol/OPERATIONS.md` and `protocol/NETWORK.md` cover node roles, the
authority ceremony, and network topology. `AGENTS.md` in `protocol/` is the
long-form engineering reference and agent guidance.