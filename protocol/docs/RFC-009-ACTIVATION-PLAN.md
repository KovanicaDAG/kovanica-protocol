# RFC-009 Activation Plan — re-enabling a finite `block_pruning_depth`

**Status:** Draft / planning (this document changes no code)
**Scope:** RFC-009 block pruning (GHOSTDAG colouring under eviction), after R1-R8
**Audience:** core, node-ops, genesis-testnet

---

## 0. What changes consensus — and what does not

RFC-009 ships **two independent things**:

1. **(A+) admission rule.** A block is rejected unless **every parent and every
   mergeset candidate** lies in `future(P_finality) ∪ {P_finality}`
   (`Dag::insert_with_id_inner`, plus the ledger-side twin in
   `Ledger::apply_new_block`). This is a **consensus-rule change**: it rejects
   blocks the pre-RFC-009 code accepted. The ledger-side check is gated only on a
   finite `finality_depth` and `!replay_mode` — **not** on `block_pruning_depth` —
   so it becomes active on testnet (`finality_depth=100`) and mainnet
   (`finality_depth=1000`) the moment the RFC-009 binaries run.
2. **Eviction** (`block_pruning_depth` finite). Soundness now holds (R1-R7); this
   is a **memory / performance** choice only, and is reversible.

**Consequence.** *Deploying the RFC-009 code is itself a consensus change.* It
must land at the **testnet reset** (fresh genesis), so no old-node block is
rejected mid-chain, or behind an explicit activation height. The eviction depth
is then chosen independently.

---

## 1. Depth selection

Constraint (asserted in `NetworkProfile`, `explorer.rs:294-297`):
`block_pruning_depth >= finality_depth`.

| Network | `finality_depth` | proposed depth | retained colouring state (R6) |
|---|---|---|---|
| testnet | 100 | **1000** (proposal: RFC-009-FIX-BRIEF §7 Q3) | ~1e6 entries ≈ 40 MB |
| mainnet | 1000 | same note proposed **10,000** | ~1e8 entries ≈ 4 GB — **not viable** |
| mainnet (fallback) | 1000 | **1000** | ~1e6 entries ≈ 40 MB |

R6 measured total retained `blue_anticone_sizes` ≈ **O(D²)** for a chain
(`RFC-009-DESIGN-ANALYSIS.md` §15). The strict O(D×width) target needs the
Kaspa-style **sparse** map (per-block O(k × mergeset)) — a follow-up, not a
soundness requirement. Until that lands, **mainnet depth 10,000 is infeasible**;
use 1000 (== finality) or finish the sparse map first.

> **Decision (A2, ratified 2026-10-06).** Testnet activates at **1000**.
> Mainnet activates at **1000** too; raising it to **10,000** is gated on landing
> the Kaspa-style sparse map (the R6 follow-up), not on this RFC. The original
> `1000` / `10,000` figures came from `RFC-009-FIX-BRIEF.md` §7 open question 3
> and were **not** re-verified against RFC-008 (not present at
> `docs/RFC-008-OraclePruning.md`); this note supersedes them as the recorded
> decision.

---

## 2. Milestones

| # | Milestone | Exit criteria |
|---|---|---|
| A0 | RFC-009 code merged on `consensus/poa-only-migration` | R1-R8 tests green; full suite 944/0/7; clippy 0/0 ✅ |
| A1 | 24h soak window closes | no SEV-1 (closes 2026-10-06T20:56:41Z) |
| A2 | Depth decision recorded | ✅ testnet 1000; mainnet 1000 (10,000 gated on the sparse map) — ratified 2026-10-06 |
| A3 | Testnet reset | `TESTNET-RESET-POLICY.md` §3.2 followed; seed1 first; new genesis |
| A4 | RFC-009 binaries on all seeds | `/api/bootstrap` shows the new genesis **and** `block_pruning_depth=1000` on all three |
| A5 | Post-activation soak (testnet, 72h) | `/api/head` height monotone; no `BuildsOnPrunedHistory` in logs; RSS bounded; no stall |
| A6 | Differential + memory evidence | R4 gate green; `estimate_replay_peak_bytes` sane; `replay-watchdog` silent |
| A7 | Mainnet decision | sparse map done (→ 10,000) or fallback (→ 1000); reset/activation scheduled |

---

## 3. Verification gates

**At A4 (per seed, before moving on):**
- `/api/bootstrap`: `genesis` == the reset genesis; `block_pruning_depth == 1000`.
- `/api/head`: `blocks` advancing; `authority_set` == the intended PoA set.
- Node logs: no `BuildsOnPrunedHistory` / `MissingParent` / `Finality` rejections.
- RSS after a bounded replay: `replay-watchdog` (`kovanica_replay_rss_bytes`)
  silent; `estimate_replay_peak_bytes` under the host budget.

**At A5 (ongoing):**
- Height monotonicity across all three seeds.
- No peer divergence on `/api/head` tip.
- `native_minted` ≤ `max_supply` (`9_020_000_000_000_000` atoms).

---

## 4. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| **Partial upgrade** — old nodes accept a block (A+) rejects | chain fork | reset + mandatory upgrade; new genesis only on RFC-009 binaries |
| **False (A+) rejection** stalls the chain | liveness | rule is tight (§14); R4 differential gate; canary seed1 first |
| **Memory blow-up** at large D (O(D²)) | OOM | depth cap; sparse-map follow-up; RSS watchdog |
| **Snapshot tier unusable with pruning** | ops surprise | `write_snapshot` now returns `BlockPruningUnsupported`; use checkpoint/log tier |
| **P2P / seed** — reset changes genesis | peers split | move seed1/2/3 together; DNS-only seeds; never point TCP 8000 at orange-cloud hostnames |
| **Supply accounting** — reset re-emits premine/treasury | cap breach | verify `/api/bootstrap` `native_minted`/`max_supply` after reset; fee floor `max(1, subsidy/500_000)` unchanged |
| **Rollback** — setting depth back to `u64::MAX` | (A+) stays on | a full rollback needs the previous binaries **and** a reset |

---

## 5. Rollback

- **Eviction only:** set `block_pruning_depth = u64::MAX` — disables eviction.
  (A+) remains active; this is safe and non-forking.
- **Full RFC-009 rollback:** restore the previous binaries and reset (a new
  genesis), because (A+) cannot be un-activated without reverting code.

---

## 6. Non-goals

- No change to RFC-006 constants (MAX_SUPPLY 90.2M KVNC, maturity 100, 75% fee
  burn, subsidy curve) or GHOSTDAG `k=3`.
- No change to the checkpoint format (block pruning intentionally not persisted;
  the caller re-applies the profile depth).
- No new wire format beyond the snapshot v3 header.
