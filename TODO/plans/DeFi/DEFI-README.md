# Kovanica DeFi Integration Pack

**Date:** 2026-09-17  
**Status:** Draft design pack  
**Depends on:** KVP-101 (multisig), KVP-102 (multi-asset), KVP-103 (script v2), KVP-104 (HTLC), KVP-105 (vaults), RFC-006 (tokenomics), RFC-007 drafts (RWA / NFT)

## What this pack is

Complete accompanying documentation for building DeFi applications on the Kovanica Protocol (UTXO + GHOSTDAG + Ed25519).

Kovanica has **no EVM / no general-purpose smart contracts**. DeFi is constructed from:

- Native multi-asset tokens (KVP-102)
- HTLC atomic swaps (KVP-104)
- Time-lock vaults + CSV (KVP-105)
- Multisig (KVP-101)
- Off-chain matching, order books and indexers
- Optional RWA / NFT as collateral (RFC-007)

## Documents in this pack

| File | Purpose |
|------|---------|
| `DEFI-README.md` | This index |
| `DEFI-ARCHITECTURE.md` | High-level architecture & design principles |
| `DEFI-TECHNICAL-DESIGN.md` | Concrete transaction patterns, scripts, data structures |
| `DEFI-PROJECT-PLAN.md` | Phased roadmap, milestones, risk register |
| `DEFI-CHECKLIST.md` | Operational & delivery checklist |
| `DEFI-API-AND-CLIENT-NOTES.md` | HTTP surface, client helpers, wallet/explorer integration |
| `DEFI-HTLC-DEX.md` | Detailed HTLC-based atomic swap / DEX design |
| `DEFI-LENDING.md` | Collateralized lending & escrow patterns |

## Recommended reading order

1. `DEFI-ARCHITECTURE.md`
2. `DEFI-HTLC-DEX.md` (fastest path to first product)
3. `DEFI-TECHNICAL-DESIGN.md`
4. `DEFI-PROJECT-PLAN.md`
5. `DEFI-CHECKLIST.md`

## Key principles (non-negotiable)

1. **Ledger-minimal** — only cryptographic ownership and conservation live on-chain.
2. **No consensus oracles** — prices and matchmakers stay off-chain.
3. **Compose existing primitives** — do not invent new consensus rules for v1.
4. **Fee & maturity aware** — after RFC-006 every funding / claim / refund tx respects fee floor and 100-block coinbase maturity.
5. **Client-side safety** — preimage handling, timeout calculation and script verification happen in the wallet.

## Quick start path (MVP)

1. Finish KVP-102 `asset_id` HTTP surface.
2. Implement HTLC swap builder (Rust + TS).
3. Ship CLI + minimal wallet “Atomic Swap” flow.
4. Public testnet demo: KVNC ↔ test token.

See `DEFI-PROJECT-PLAN.md` for full sequencing.

## Related existing docs (already in repo)

- `RFC-007-RWA-INTEGRATION.md` + RWA-* files
- `RFC-007-KVP-106-NFT.md` + NFT-* files
- `KVP-102-HTTP-asset_id-gap.md`
- Tokenomics / RFC-006 materials

---

**Maintainer note:** Keep this pack in sync with any changes to HTLC, vault or multi-asset validation rules.