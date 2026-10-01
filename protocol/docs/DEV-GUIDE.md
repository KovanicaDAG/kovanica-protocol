# Kovanica Development Guide

Canonical repo: `https://github.com/KovanicaDAG/kovanica` (monorepo)
Current network: `kovanica-testnet`

## Core Architecture (never change without RFC)
- Consensus: GHOSTDAG BlockDAG, **k=3**
- Ledger: pure UTXO
- Signatures: Ed25519 (64-byte → 128 hex)
- Token: KVNC (1 KVNC = 100_000_000 atoms)
- P2P: plaintext TCP only, port **9000**; seed `seed.kovanica.online:9000` (DNS-only)
- Explorer / API: `https://explorer.kovanica.online`

## RFC-006 Tokenomics (hard rules, activated)
- MAX_SUPPLY: **90.2M KVNC** (`9_020_000_000_000_000` atoms)
- Emission curve: 82M KVNC geometric decay (s₀=10 KVNC, era=2_050_000, α=3/4)
- Coinbase maturity: **100 blocks**
- Fee split: **75% burned / 25% to producer**
- Fee floor: `max(1, subsidy / 500_000)` atoms/byte
- Founder premine: 0.2M KVNC; Treasury: 8M KVNC (8 × 1M vaults)

## Phase Milestones
| Phase | Topic | Status | Key Doc |
|---|---|---|---|
| 0 | PoA Migration | Active (Gate 2 soak open; Gate 4 deferred) | `SW-PoA-SPV-CONSENSUS.md` |
| 1 | Hardening (metrics, pruning) | Done | — |
| 2 | P2P (TCP 9000 mesh) | Done | — |
| 3 | SPV / M4 | Done | `docs/` guides |
| 4 | Wallet / DeFi (TUI HTLC/Offer/RWA/NFT) | Done | `crates/kovanica-cli/src/tui.rs` |
| 5 | Mainnet Ceremony (Gate 4) | **Deferred** — requires isolated mainnet host + ceremony agreement | `AUTHORITY-KEY-CEREMONY.md` |

## Security / Consensus Rules
- **Private keys never enter the node** — client-side only (`prepare → sign → submit`)
- **Environment variables**: `KOVANICA_DATA` must be preserved after first genesis write; never `KOVANICA_ALLOW_RESET=1` on public nodes
- **P2P seed policy**: use DNS seed or origin IP; never point peers at explorer hostnames for TCP 9000
- **Consensus impact**: any change to GHOSTDAG k, UTXO rules, Ed25519, fee split, maturity, or supply cap is **consensus-critical** — requires RFC and gate confirmation

## Build / Test / Lint
```sh
cd protocol
cargo check -p kovanica-dag -p kovanica-state -p kovanica-node -p kovanica-cli
cargo test -p kovanica-cli
cargo clippy -p kovanica-dag -p kovanica-state --tests
```

## Key Files
- Consensus spec: `protocol/docs/SW-PoA-SPV-CONSENSUS.md`
- Tokenomics: `protocol/docs/RFC-006-EmissionCurve.md` (includes TOKENOMICS Appendix A)
- Ceremony doc: `protocol/docs/AUTHORITY-KEY-CEREMONY.md`
- Security rules: `docs/AGENTS.md`
- Authority keys: `protocol/authority-keys/` (testnet); `protocol/mainnet-authority-keys/` (mainnet, deferred)
- Secret exclusions: `.gitignore` excludes `authority-*.env`

## Next Immediate Work
1. Complete 24h multi-validator soak (Gate 2) on seed1/seed2
2. Confirm isolated mainnet host + backup + ceremony agreement → execute Gate 4
3. Client/docs: explorer dual-balance, wallet UX, docs cleanup
