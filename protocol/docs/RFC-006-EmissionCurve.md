# RFC-006 — Tokenomics (emission, supply cap, maturity, fee burn)

Defines KVNC's money supply: the smooth geometric emission curve, the 90.2M hard
cap, 100-block coinbase maturity, and the 75% fee burn. **Live on
`kovanica-testnet`** as of 2026-09-20, where activation was a consensus fork that
reset the chain and wiped all pre-RFC-006 balances.

**Status:** Core Done — activated on `kovanica-testnet` 2026-09-20 (promotion to
"Shipped" is a governance decision, not an authoring one)
**Consensus impact:** consensus-safe (emission/cap are pure functions of height;
maturity and fee split are ledger rules). No format bump to transaction encoding
or checkpoints — the economics ride on existing fields, which is why activation
required a **chain reset rather than a versioned fork**.

> **Code wins.** Every constant below is mirrored in
> `crates/kovanica-state/src/ledger.rs` and exercised by
> `crates/kovanica-state/tests/tokenomics.rs` (18 tests). If this doc and the
> code diverge, the code is correct and this doc is a bug.

---

## 1. Motivation

Pre-RFC-006 testnet ran a placeholder schedule (200 KVNC/block, binary halving,
50 KVNC founder premine, `0.0001 KVNC` min fee) that was never intended to reach
mainnet. Those numbers are **obsolete**; several runbooks still quote them and are
wrong. RFC-006 replaces the schedule with one whose *total* is fixed by
construction, so the supply cap is a property of the curve rather than a
governance promise.

Design goals, in order:

1. **A hard, provable cap.** No mechanism can ever mint past 90.2M KVNC.
2. **No cliff.** A binary halving shocks hashpower at the boundary; a smooth
   geometric decay tapers instead.
3. **Fee sink, not fee market.** Burning 75% of fees makes transaction cost a
   permanent supply-side deflation rather than a transfer to producers.
4. **Short maturity.** 100 blocks keeps validator/faucet economics responsive
   without enabling hash-rate rental.

---

## 2. Units

| Symbol | Meaning |
|--------|---------|
| **KVNC** | Native ticker |
| **atom** | Smallest unit |
| **Decimals** | 8 |
| **1 KVNC** | `100_000_000` atoms (`ATOM` in code) |

`pub const ATOM: u64 = 100_000_000;`

---

## 3. Emission (smooth geometric curve)

| Parameter | Value | Code |
|-----------|-------|------|
| Genesis subsidy \(s_0\) | **10 KVNC** / block | `RFC006_GENESIS_SUBSIDY` |
| Era length \(E\) | **2_050_000** blocks | `RFC006_ERA_LENGTH` |
| Decay \(\alpha\) | **3/4** per era (integer floor) | — |
| Nominal curve total | **80 000 000 KVNC** | — |

```text
era   = height / 2_050_000
s(0)  = 10 KVNC
s(e)  = floor(s(e-1) * 3 / 4)
subsidy_at(height) = s(era),  and 0 for era >= 256
```

Implemented as `HalvingSchedule::subsidy_at` (`ledger.rs`). The type name
`HalvingSchedule` is retained for API stability — **the decay is geometric, not a
binary halving**; do not infer halving semantics from the name.

Worked values (confirmed against `supply-calc_subsidyAt`):

| Era | Height | Subsidy |
|-----|--------|---------|
| 0 | 0 | 10 KVNC |
| 1 | 2 000 000 | 7.5 KVNC |
| 2 | 4 000 000 | 5.625 KVNC |
| 3 | 6 000 000 | 4.21875 KVNC |
| 10 | 22 000 000 | 0.56313513 KVNC |
| ≥256 | ≥512 000 000 | 0 |

### 3.1 The curve total is asymptotic, not exact

Summing `s(e) · E` over all 256 eras with integer flooring at every step yields

```text
realized curve total = 81 999 997.54 KVNC   (2.46 KVNC below the nominal 82M)
```

The shortfall is repeated truncation, not a policy reserve. Consequently the
honest emission ceiling is

```text
0.2M premine + 8M treasury + 79 999 997.6 curve = 88 199 997.8 KVNC
```

i.e. **~2.0M KVNC below `MAX_SUPPLY`** (2 000 002.2 KVNC exactly, of which
2 000 000 is the treasury cut and 2.2 is the pre-existing truncation shortfall).
The cap is a backstop that honest subsidy can never reach; it exists to reject
*malformed or over-claiming* coinbases (§4), not to truncate the curve. Docs that
quote a flat "82M curve" are quoting the asymptotic limit.

The freed 2M was **reallocated to the curve**: treasury was cut from 10 × 1M to
8 × 1M on 2026-09-29, and the curve rose from 80M to 82M to match. Curve emission
is derived from `s0`, era length and α, so the 2M was absorbed by moving the era
length `E` from 2_000_000 to **2_050_000** — chosen over `s0` or α because `s0` is
the most widely-quoted tokenomics number and also feeds the fee floor
(`subsidy / 500_000`) and `/api/head`. The only residual gap is the 2.46 KVNC lost
to per-era integer flooring. `MAX_SUPPLY` remains a **ceiling, never a target**:
do not top up to close it, and do not lower the cap either.

---

## 4. Hard cap and distribution

| Component | Amount | Mechanism |
|-----------|--------|-----------|
| Founder premine | 0.2M KVNC | Genesis coinbase (P2PK), `RFC006_PREMINE` |
| Treasury | 8M KVNC | 8 × 1M RFC-005 vaults at genesis |
| Curve emission | 82M KVNC (nominal) | Block subsidies |
| **MAX_SUPPLY** | **90.2M KVNC** = `9_020_000_000_000_000` atoms | enforced per-view |

### 4.1 Enforcement

`MAX_SUPPLY` is a `u64` atom cap applied when a block is applied, not a
post-hoc accounting check. A coinbase whose native outputs would push
cumulative minted past the cap is rejected:

```rust
LedgerError::SupplyCapExceeded { claimed, native_minted, max_supply }
```

Enforcement is **per-view**, so two parallel blocks that each bring cumulative
minted to exactly `MAX_SUPPLY` are *both* valid in their own view; the conflict
resolves only in the merger's view. A block landing exactly on the cap is
accepted; one atom past it is rejected. Genesis may mint premine + treasury up
to the cap, with the curve schedule applying from height 1.

### 4.2 Treasury

Ten RFC-005 vault tranches of 1M KVNC (`RFC006_TREASURY_TRANCHE` ×
`RFC006_TREASURY_TRANCHES`). Tranche *k* (1..=10) unlocks at

```text
unlock_height = k * BLOCKS_PER_YEAR   (BLOCKS_PER_YEAR = 31_536_000)
```

— one tranche per year at 1 block/s, enforced by the RFC-005 absolute lock.

> ⚠️ **Treasury owner keys are testnet placeholders.** Tranche *k* uses
> `KeyPair::from_u64(TREASURY_SEED_BASE + k)` — publicly derivable by design.
> Production **must** supply a real secret `treasury_seed` via key ceremony.
> Never fund a mainnet treasury with the placeholder keys.

---

## 5. Coinbase maturity

| Parameter | Value |
|-----------|-------|
| `COINBASE_MATURITY` | **100** blocks |

A coinbase output is unspendable until 100 blocks after the block that created
it; violation is `LedgerError::CoinbaseImmature`. Genesis is exempt. Maturity is
measured on the **selected-parent chain height**, not blue score (blue score
counts merged blue blocks and exceeds chain height for mergeset blocks), so the
incremental `Ledger` and the batch `apply_dag` path agree — regression-guarded by
`mergeset_coinbase_creation_height_matches_apply_dag`.

Consequence: pruning must retain UTXO creation heights for at least
`COINBASE_MATURITY` blocks
(`pruning_heights_must_survive_for_coinbase_maturity`).

---

## 6. Fees

| Parameter | Value |
|-----------|-------|
| Floor | `max(1, subsidy / 500_000)` atoms per byte |
| Producer share | **25%** — `FEE_PRODUCER_NUM / FEE_PRODUCER_DEN` = 1/4 |
| Burned | **75%** |

The floor tracks the subsidy, so it decays with emission: **2000 atoms/byte at
genesis**, 1500 at height 2 000 000, and never below 1 atom/byte. Fees are paid
in **native KVNC only** (see RFC-002) — a non-native asset cannot pay a fee.

Per-block burn is computed as `fees - fees / 4`. Because that subtraction is not
additive, cumulative burn is tracked as an explicit per-block sum
(`Ledger::fees_burned`, carried in each block's view) rather than recomputed as
`total - total/4`; the naive form drifts from the true sum.

---

## 7. Activation semantics

> RFC-006 is **active from genesis** on `kovanica-testnet`. The curve, the cap,
> the 100-block maturity, and the 75/25 fee split are **unconditional hard
> rules**, deliberately *not* gated by a blue-score activation knob.

`TOKENOMICS_ACTIVATION_SCORE = 0` is retained **only as a documented marker**.
There is no pre-activation schedule to fall back to — the ledger holds a single
emission schedule — so **do not branch on it**. This is the structural
difference from RFC-001…005, which are all blue-score gated and therefore
backward-compatible upgrades; RFC-006 cannot be, which is why it required a
genesis reset instead.

| | RFC-001…005 | RFC-006 |
|---|---|---|
| Gating | blue score (`*_ACTIVATION_SCORE`) | none — genesis |
| Pre-activation behaviour | old rules apply | none exists |
| Rollout | fork on live chain | **chain reset** |
| Backward compat | yes | no |

---

## 8. Supply metrics

| Metric | Definition |
|--------|------------|
| `total` / `native_minted` | cumulative minted |
| `circulating` | tip UTXO native total (approximate) |
| `burned` | cumulative 75% fee burn |
| `max_supply` | `MAX_SUPPLY` |

From `Ledger::supply()` → `SupplyMetrics`, exposed on `GET /api/bootstrap`
(`native_minted`, `total`, `circulating`, `burned`, `max_supply`).

`circulating` is an **approximation** (live UTXO total), not a
maturity-aware spendable balance. Clients that need "spendable now" must filter
immature coinbases themselves — the transaction builder already does.

---

## 9. Backwards compatibility

- **No wire-format bump.** Transaction encoding, snapshot framing and the `kvnc…dag`
  address rendering are unchanged. Checkpoint versions are shared with RFC-001…005
  (v6, the last bump being RFC-005's creation heights) — RFC-006 adds no new
  persisted field.
- **Breaking at the economic layer only.** A pre-RFC-006 chain and an RFC-006
  chain are mutually unreadable *economically* (different subsidy, maturity, fee
  split) even though the blocks parse. Treat any pre-2026-09-20 testnet data as
  disposable.
- **Client requirement.** Any client computing fees or balances must read
  `subsidy` and the fee floor from the node rather than hard-coding them, since
  both decay with height.

### 9.1 Interaction with the PoA-only decision

Kovanica is **PoA-only** (ratified 2026-09-25; see
[`RFC-POA-Migration.md`](./RFC-POA-Migration.md) §0, canonical). PoW,
difficulty and the staked-VRF hybrid tier are being removed. **None of that
changes the numbers in this RFC**, and it is worth being explicit about why,
because "emission depends on who produces blocks" is a natural thing to assume:

- **The curve is height-indexed.** `subsidy_at(height)` is a pure function of
  height. It reads nothing about admission, so it is invariant under any choice
  of block producer.
- **The cap is enforced in `apply_block`.** `cumulative_minted` is compared
  against `MAX_SUPPLY` per block, so it cannot be evaded by producing blocks
  through a different path.
- **`work` is pinned.** Under PoA every block carries `POA_NOMINAL_WORK = 1`
  (`kovanica-dag/src/dag.rs`), enforced at insertion, so accumulated blue work
  is a plain block count. GHOSTDAG chain selection is unchanged in mechanism.

What *does* change is the **pace**, never the cap:

| | pre-PoA (PoW retarget) | PoA |
| --- | --- | --- |
| Block interval | retargeted, variable | fixed `SLOT_DURATION_MS = 3000` |
| Gap fill | possible | none |
| Coinbase maturity 100 blocks | variable wall-clock | ≈ 5 minutes |
| Genesis emission rate | retarget-dependent | 10 KVNC per 3 s slot |

Two consequences worth flagging:

1. **Coinbase maturity becomes a wall-clock guarantee.** 100 blocks at a fixed
   3 s slot is ~5 minutes, where under variable PoW difficulty it was not
   bounded. Wallets and pool operators can now rely on it; scripts that assumed
   "maturity takes a while" should be re-checked.
2. **The 25 % producer share now accrues to the authority** that produced the
   block, not to whoever won a hash race. The 75 % burn is unchanged. Note that
   under a fixed slot with no gap fill, authority reward is a function of
   uptime, not of hashrate — there is no hashrate to compete with.

A non-authority can never produce a block, so `cumulative_minted` growth rate is
now bounded by the authority set's aggregate uptime rather than by miner
distribution. This is a *pace* bound. `MAX_SUPPLY` remains the hard ceiling.

---

## 10. Open questions

- **Treasury key ceremony** is the blocking item for any real treasury funding —
  placeholder keys are testnet-only (§4.2).
- **Curve total rounding**: should the ~2.4 KVNC truncation be recovered by a
  final top-up tranche, or is the asymptotic total the intended statement? Current
  code does neither.
- **Fee floor floor**: `max(1, …)` is a hard 1 atom/byte. Under sustained fee
  pressure the floor is the only thing preventing spam, and it decays toward
  that 1 atom/byte asymptote.
- **RWA/NFT supply** is orthogonal and independent of this cap: RFC-002 assets
  carry their own `max_supply`/`minted` accounting and are not counted against
  `MAX_SUPPLY`.

---

## 11. Cross-references

- `docs/TOKENOMICS.md` — short operator-facing numbers table
- `docs/RFC-002-NativeTokens.md` — multi-asset conservation; fees are native-only
- `docs/RFC-005-Vault.md` — the treasury vesting mechanism
- `docs/RFC-POA-Migration.md` — PoA-only consensus; §9.1 above covers the interaction
- `crates/kovanica-state/src/ledger.rs` — constants, `subsidy_at`, supply metrics
- `crates/kovanica-state/tests/tokenomics.rs` — 18 adversarial tests
- `NETWORK.md` — genesis hash and per-network parameter table

---

## Appendix A: Operator Quick Reference (from TOKENOMICS.md)

> This appendix mirrors the operator-facing numbers table from `TOKENOMICS.md`.
> The RFC above carries the full rationale, design goals, and worked examples.

### Units

| Symbol | Meaning |
|--------|---------|
| **KVNC** | Native currency ticker |
| **atom** | Smallest unit |
| **Decimals** | 8 |
| **1 KVNC** | `100_000_000` atoms (`ATOM` in code) |

### Emission (smooth geometric curve)

| Parameter | Value |
|-----------|--------|
| Genesis subsidy \(s_0\) | **10 KVNC** per block |
| Era length \(E\) | **2_050_000** blocks |
| Decay \(\alpha\) | **3/4** per era (integer floor) |
| Curve total | **80_000_000 KVNC** |

```text
era = floor(height / 2_050_000)
s(era) = floor(s(era-1) * 3/4)   with s(0) = 10 KVNC
```

### Hard cap & distribution

| Component | Amount | Mechanism |
|-----------|--------|-----------|
| Founder premine | 0.2M KVNC | Genesis coinbase (P2PK) |
| Treasury | 8M KVNC | 8 × 1M RFC-005 vaults at genesis |
| Curve emission | 82M KVNC | Block subsidies |
| **MAX_SUPPLY** | **90.2M KVNC** | Enforced via `native_minted` |

Treasury tranche *k* (1..=10) unlocks at height `k * 31_536_000`.
Owner keys are **placeholders** (`TREASURY_SEED_BASE + k`) until ceremony.

### Coinbase maturity

| Parameter | Value |
|-----------|--------|
| `COINBASE_MATURITY` | **100** blocks |
| Error | `LedgerError::CoinbaseImmature` |

### Fees

| Parameter | Value |
|-----------|--------|
| Floor | `max(1, subsidy / 500_000)` atoms per byte |
| Producer share | **25%** (`fee / 4`) |
| Burned | **75%** |

### Supply metrics

| Metric | Definition |
|--------|------------|
| `total` / `native_minted` | cumulative minted |
| `circulating` | tip UTXO native total (approx.) |
| `burned` | cumulative 75% fee burn |
| `max_supply` | `MAX_SUPPLY` |

Exposed via `Ledger::supply()` and HTTP snapshot JSON fields.

### Consensus parameters (related)

| Parameter | Value | Status |
|-----------|--------|--------|
| GHOSTDAG **k** | 3 | `[CURRENT]` — unchanged by the PoA decision |
| PoW | real, opt-in | `[TARGET]`-for-removal (being deleted, not just off). Replaced by an authority set: `KOVANICA_CONSENSUS=poa` + `KOVANICA_AUTHORITIES` + `KOVANICA_AUTHORITY_THRESHOLD` + `KOVANICA_SLOT_DURATION`. See RFC-POA-Migration §0.2 |
| Difficulty / retarget | exists, `H*work < 2^256` | `[TARGET]`-for-removal — **there is no retune knob to mis-set**, so any pre-transition "don't retune the difficulty window" advice is void. Block pace becomes a fixed slot |
| Emission index | block **height** | `[CURRENT]` — *the reason tokenomics survives PoA removal* |

### References

- `crates/kovanica-state/src/ledger.rs`
- `crates/kovanica-node/src/explorer.rs` — `NetworkProfile`
- RFC-005 `VaultScript`
