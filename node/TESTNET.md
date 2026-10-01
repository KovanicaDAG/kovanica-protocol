# kovanica-testnet

Public BlockDAG testnet. Native token **KVNC** (8 decimals).

> **Consensus decision (ratified 2026-09-25): Kovanica is PoA-only.**
> Proof-of-Work is being removed from the protocol. See
> `protocol/docs/RFC-POA-Migration.md` §0 (canonical). Items marked `[TARGET]`
> are ratified but not yet implemented; `[CURRENT]` items describe shipped code.
>
> ⚠️ **This table is stale on tokenomics, independently of the PoA decision.**
> The `Premine`, `Subsidy cap` and `Min fee` rows below are pre-RFC-006 values
> and do **not** match the code. `protocol/TESTNET.md` and
> `protocol/TESTNET-RFC006.md` carry the canonical values. See
> "Stale rows" below.
>
> **The canonical RFC-006 values are unchanged by the PoA-only decision**: the
> curve is height-indexed and `cumulative_minted` is hard-capped at
> `MAX_SUPPLY` in `apply_block`, so supply math does not depend on admission.
> Only the wall-clock *pace* changes (fixed 3000 ms slots, no retarget, no
> gap-fill); the 90.2M cap does not.

| | |
| --- | --- |
| Explorer | https://explorer.kovanica.online |
| Wallet | https://wallet.kovanica.online |
| Network | `kovanica-testnet` |
| Subsidy | **10 KVNC / block** at genesis, geometric decay ×3/4 every **2 000 000** blocks |
| Max supply | **90.2M KVNC** hard cap |
| Coinbase maturity | **100 blocks** |
| k | 3 (GHOSTDAG) |
| PoW | `[CURRENT]` on (`KOVANICA_POW=1`) — pre-reset chain / **`[TARGET]`-removed** |
| PoA | `[CURRENT]` available, **default when `KOVANICA_CONSENSUS` is unset** · `[TARGET]` the only admission model |
| Slot duration | `[CURRENT]` `KOVANICA_SLOT_DURATION`, default 3000 ms · no gap-fill |
| P2P | **TCP only** `KOVANICA_LISTEN` (default `0.0.0.0:9000`) |
| Bootstrap | DNS-only `seed.kovanica.online:9000` (not the Cloudflare hostname) |

### Stale rows (pre-RFC-006 — do not use)

The three struck-through rows above predate RFC-006 and contradict
`kovanica-state/src/ledger.rs`. The canonical values, which the PoA-only
decision leaves **untouched**, are:

| Parameter | Canonical value | Source |
| --- | --- | --- |
| Premine | **0.2M KVNC** (founder), plus **10M KVNC** in 10 × 1M RFC-005 treasury vaults | `RFC006_PREMINE`, `RFC006_TREASURY_TOTAL` |
| Genesis subsidy s₀ | **10 KVNC / block** | `RFC006_GENESIS_SUBSIDY` |
| Decay | geometric ×3/4 every **2 000 000** blocks (`RFC006_ERA_LENGTH`) — **not** a halving every 1000 blocks | `subsidy_at()` |
| Max supply | **90.2M KVNC** hard cap | `MAX_SUPPLY` |
| Coinbase maturity | **100 blocks** | `COINBASE_MATURITY` |
| Fee | floor `max(1, subsidy/500_000)` atoms/byte; **75% burned / 25% producer** | `FEE_PRODUCER_NUM`/`FEE_PRODUCER_DEN` |
| Precision | **1 KVNC = 100_000_000 atoms** | `ATOM` |

This file was left in place rather than rewritten so the discrepancy stays
visible; it should be reconciled with `protocol/TESTNET.md` by the `node-ops`
role.

Live genesis and tip: `GET https://explorer.kovanica.online/api/head`  
P2P status on a running node: `GET /api/p2p`  
Block dump (same bytes a clone pulls over TCP): `GET /api/blocks`  
Bootstrap blob: `GET https://explorer.kovanica.online/api/bootstrap`

See also: [`protocol/docs/RFC-006-EmissionCurve.md`](../protocol/docs/RFC-006-EmissionCurve.md)
(full tokenomics spec) and [`protocol/TESTNET-RFC006.md`](../protocol/TESTNET-RFC006.md)
(activation record).

Join a clone: [JOIN.md](./JOIN.md) (one-click install, Windows/Linux/macOS, USB stick).

## Run

See [README.md](./README.md).
