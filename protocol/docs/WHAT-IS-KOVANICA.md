# What is Kovanica?

**Kovanica** is a **BlockDAG** ledger: blocks may reference multiple parents, so the network can produce blocks in parallel and still agree on one order. Consensus follows **GHOSTDAG** (parameter **k = 3**). The native currency is **KVNC**.

**Status**: Draft / Stage-3 — the "Work" row below is `[CURRENT]` and is
superseded by the ratified PoA-only decision.  
**Consensus impact**: none (explainer document; changes no protocol rule).

> **Consensus decision (ratified 2026-09-25): Kovanica is PoA-only.**
> Proof-of-Work is being **removed**, not merely disabled. Items marked
> `[TARGET]` are ratified but not yet implemented; `[CURRENT]` items describe
> shipped code. Policy lives in
> [`RFC-POA-Migration.md` §0](./RFC-POA-Migration.md).
>
> In one line: block production moves from "anyone who can do hash work" to
> "a configured authority set, on a slot schedule" — a permissioned network.
> This document is public-facing, so it should say the plain consequence out
> loud: **permissionless entry is being given up.** That is a real trade, not
> a neutral refactor, and this page is where a reader will go looking for it.
>
> Unchanged: GHOSTDAG **k=3**, UTXO + Ed25519 spends, 1 KVNC = 10⁸ atoms, and
> every RFC-006 tokenomics figure — MAX_SUPPLY **90.2M KVNC**, s₀ **10
> KVNC/block**, era **2 050 000**, **α 3/4**, maturity **100**, fee **75%
> burned / 25% to producer**.

The name *kovanica* is Serbo-Croatian for a coin / mint.

## In one minute

| | |
|--|--|
| **Data structure** | BlockDAG (not a single linear chain) |
| **Consensus** | GHOSTDAG linearization + blue/red colouring |
| **State** | UTXO, Ed25519 spends |
| **Work** | Optional real PoW on block ids (`nonce` + work target) — `[CURRENT]`; `[TARGET]` PoA authority set instead |
| **Native asset** | **KVNC** (8 decimals; 1 KVNC = 10⁸ atoms) |
| **Token standard** | **[KVP-102](./KVP-102-NativeTokens.md)** — multi-asset outputs (not ERC-20) |
| **Network today** | **kovanica-testnet** — public HTTP explorer + P2P seed |

## What you can do on testnet

- Explore the DAG and selected chain: [explorer](https://explorer.kovanica.online) / [kovanica.online](https://kovanica.online)
- Use a browser wallet, multisig (KVP-101), network status, origins map
- Run or peer with a node (TCP **9000**; prefer DNS seed, not Cloudflare-proxied HTTP host for P2P)

## Protocol standards (KVP)

Public names map to RFCs:

| Standard | Means |
|----------|--------|
| **KVP-101** | Multisig M-of-N (P2SH) |
| **KVP-102** | Native multi-asset tokens |
| **KVP-103** | Stealth addresses + script v2 |
| **KVP-104** | HTLC atomic swaps (in progress) |

See [KVP.md](./KVP.md).

## What Kovanica is not

- Not an EVM chain and not an ERC-20 contract platform
- Not mainnet yet — treat balances as test-only
- Not financial advice; software may contain bugs
- **Not permissionless, going forward** `[TARGET]` — PoA-only means only the
  configured authority set can propose blocks, and the staked-VRF path is
  removed too (decided 2026-09-25, RFC-POA-Migration §0.7.1), so there is no
  route in for a staker or a miner either. If "anyone can help secure the
  chain by mining" was part of your mental model of Kovanica, that stops being
  true. See RFC-POA-Migration §0.5 for the honest trade-off, and §0.7.2 for
  the still-`[OPEN]` question of who may sit in the mainnet authority set.

⚠️ **And there is no going back.** Once the mining path is deleted, restoring
any permissionless admission would itself be a consensus-breaking change
(§0.1.1). This is a one-way door, not a setting.

## Go deeper

- [TOKENOMICS.md](./TOKENOMICS.md) — subsidy, fees, KVNC vs KVP-102
- [LEGIT-BOARD.md](./LEGIT-BOARD.md) — public roadmap to a credible project
- [RFC-POA-Migration.md](./RFC-POA-Migration.md) — the PoA-only decision, §0 first
- RFCs under `docs/RFC-*.md` — normative wire and consensus detail
