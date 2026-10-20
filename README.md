# Kovanica Protocol

> **PRE-TESTNET DRAFT · NOT AUDITED · values marked `pending` in
> [`protocol-params.toml`](./protocol-params.toml) will change.**

Kovanica is a Layer-1 blockDAG. This repository is the **public specification
and parameter set** — it contains no node code, no keys, and no operational
material.

## What Kovanica is

- **DAG Layer 1.** Blocks are ordered by a Mysticeti-style uncertified DAG
  (waves of three rounds), not a single chain.
- **Leader election: round-robin today.** VRF leader election (RFC 9381) is
  specified and being finalized (pending).
- **MysticGhost ordering.** A GHOSTDAG-style greedy ordering with parameter
  `k = 3` (MysticGhost) turns the DAG into a deterministic sequence.
- **Account-based ledger with staked validators.** Active validators are chosen
  by stake; a native asset funds staking and rewards. Mainnet genesis will
  require 15–21 validators (planned, not yet enforced; `MAX_ACTIVE = 21` caps
  the committee). **Pending.**
- **WASM smart contracts.** A deterministic WASM runtime (wasmi) executes
  contract calls. HTLC, vault, multisig and fungible token are implemented as
  WASM contract crates (`crates/kovanica-htlc`, `crates/kovanica-vault`,
  `crates/kovanica-multisig`, `crates/kovanica-token`, dispatched through
  `crates/kovanica-execution/src/contracts.rs`); only the token contract
  currently has a WASM end-to-end test.
- **Native asset `KUNA`**, 9 decimals.

## Where the numbers live

Every published parameter — supply, emission, staking bounds, consensus
constants, wire domains, default ports (no live endpoints) — is in a single
machine-readable file:
[`protocol-params.toml`](./protocol-params.toml).

Each entry carries:

- `value`, `unit`,
- `source` — `path:line@<commit>` in the reference implementation the value was
  read from,
- `status` — `frozen` (stable for the public testnet) or `pending` (expected to
  change; with a `pending_reason`).

Do not read parameter values out of this README; read them from the TOML file.
Changes are recorded append-only in
[`PROTOCOL-CHANGES.md`](./PROTOCOL-CHANGES.md).

## Networks

| Network | chain_id | Version | Planned | Genesis hash |
|---------|----------|---------|---------|--------------|
| Public testnet (chain 4) | 4  | `v1.0.0` | 2026-11-25 | pending |
| Mainnet (chain 1)        | 1  | `v2.0.0` | 2027-01-01 | pending |

Genesis hashes are **pending**. See
[`docs/13-networks-versions.md`](./docs/13-networks-versions.md).

## Specification documents

| Document | Topic |
|----------|-------|
| [`docs/01-overview.md`](./docs/01-overview.md) | System overview |
| [`docs/02-consensus.md`](./docs/02-consensus.md) | DAG, VRF leaders, MysticGhost, votes |
| [`docs/04-validators-staking.md`](./docs/04-validators-staking.md) | Validator lifecycle and staking |
| [`docs/06-tokenomics.md`](./docs/06-tokenomics.md) | Supply, emission, treasury |
| [`docs/08-addresses-keys.md`](./docs/08-addresses-keys.md) | Addresses, keys, signing |
| [`docs/13-networks-versions.md`](./docs/13-networks-versions.md) | Networks and versions |

## Status and safety

- Not audited. See [`SECURITY.md`](./SECURITY.md) for private reporting.
- Everything marked `pending` is subject to change.
- This repository must never contain private keys, mnemonics, VRF/p2p secrets,
  keystores, `.env` files, IP addresses, hostnames, or live ports.

## License

Licensed under the Apache License, Version 2.0 — see [`LICENSE`](./LICENSE).
