# KVNC tokenomics (code-aligned)

Numbers below match the reference implementation constants used by the node and
the web app (`web/src/lib/api/contract.ts` and `kovanica-state` / `kovanica-node`).
If code and this doc diverge, **code wins** — update this file in the same change.

**Network:** `kovanica-testnet` (mainnet not launched).

---

## Units

| Symbol | Meaning |
|--------|--------|
| **KVNC** | Native currency ticker |
| **atom** | Smallest unit |
| **Decimals** | 8 |
| **1 KVNC** | `100_000_000` atoms (`ATOM`) |

---

## Issuance (subsidy)

| Parameter | Value |
|-----------|--------|
| Initial subsidy | **200 KVNC** per coinbase (`SUBSIDY = 200 * ATOM`) |
| Halving era | every **500_000** blocks (`HALVING_ERA`) |
| Floor | subsidy does not fall below **1 atom** in the web helper `subsidyAt` |

Era formula (web / docs convention):

```text
era = floor(height / 500_000)
subsidy ≈ max(1 atom, 200 KVNC / 2^era)
```

Coinbase may also carry **KVP-102** asset outputs for distribution; the subsidy
*limit* applies to **native KVNC** outputs only (see KVP-102 / RFC-002).

### Founder / bootstrap (testnet constants)

| Parameter | Value |
|-----------|--------|
| `FOUNDER_AMOUNT` | 200 KVNC |
| `FOUNDER_SEED` | `1` (deterministic test actor in some demos) |

These are **implementation constants** for testnet/genesis helpers—not a promise
of mainnet allocation. Mainnet allocation, if any, must be specified separately
before launch.

---

## Fees

| Parameter | Value |
|-----------|--------|
| Minimum fee | **10_000 atoms** (`MIN_FEE`) |
| Fee asset | **KVNC only** |
| Fee effect | burned / not paid to a random third party as “token tax” in the KVP-102 sense — native in − native out |

KVP-102 asset transfers still require enough **native** KVNC to cover the fee.

---

## KVNC vs KVP-102

| | **KVNC** | **KVP-102 asset** |
|--|----------|-------------------|
| Role | Native coin | Ledger multi-asset standard |
| `asset_id` on output | none / native | 32-byte id |
| Pays fees | yes | no |
| Mint in regular tx | via coinbase subsidy rules | coinbase only (no user mint) |
| Burn | fee path + explicit under-pay | allowed (in &gt; out) |

**One line:** *KVNC is native; other assets are KVP-102 (RFC-002).*

---

## Supply

There is **no fixed hard cap** encoded as a single constant in the web contract
file: supply is the cumulative result of coinbase subsidies (and any founder
mint paths) minus burns. Explorers expose running **supply** from node state.

For mainnet, publish an explicit long-term schedule if it differs from testnet
constants.

---

## Consensus parameters (related)

| Parameter | Value |
|-----------|--------|
| GHOSTDAG **k** | 3 |
| PoW | real, opt-in at DAG/node policy |

---

## References

- [KVP-102-NativeTokens.md](./KVP-102-NativeTokens.md)
- [RFC-002-NativeTokens.md](./RFC-002-NativeTokens.md)
- `web/src/lib/api/contract.ts` — `ATOM`, `SUBSIDY`, `HALVING_ERA`, `MIN_FEE`
