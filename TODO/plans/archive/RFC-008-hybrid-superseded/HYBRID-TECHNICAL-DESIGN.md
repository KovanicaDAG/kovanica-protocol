# Hybrid PoW/PoS + VRF — Technical Design (Kovanica)

**Status:** **OBSOLETE — hybrid dropped entirely, PoW removal complete** (decided 2026-09-25, RFC-POA-Migration §0.7.1)  
**Consensus impact:** n/a (obsolete; retained as a historical design record)

> > **Consensus decision (ratified 2026-09-25): Kovanica is PoA-only.**
> > Proof-of-Work is being removed from the protocol. See
> > `protocol/docs/RFC-POA-Migration.md` §0 (canonical). Items marked `[TARGET]`
> > are ratified but not yet implemented; `[CURRENT]` items describe shipped code.
> >
> > **This design is SUPERSEDED. Do not implement from it.**
> >
> > Its load-bearing assumption — *"stake decides who may propose; PoW (real or
> > fixed) decides which chain wins"* — is **`[TARGET]`-obsolete**. Under PoA-only
> > there is no work-based chain selection to protect and no permissionless
> > admission to gate: a fixed authority set produces one block per slot by
> > schedule, and every block carries `POA_NOMINAL_WORK = 1`, so accumulated blue
> > work is a plain block count. The sections below on `FIXED_STAKE_WORK` sizing
> > against live PoW work, on keeping a PoW tip alive against a stake majority,
> > and on the "PoW path vs stake path" admission split are all solving problems
> > the ratified direction removes.
> >
> > **It is resolved: hybrid is dropped entirely.** RFC-POA-Migration
> > **§0.7.1** decided **Option A** (2026-09-25) — PoA is the only admission
> > path, and the "PoA + staked-VRF secondary tier" reading was considered and
> > rejected. Keep this file as a historical record only; nothing below should
> > be implemented. The stake registry retires with hybrid, and **RFC-005
> > vault/CSV plus the treasury vaults are explicitly unaffected** (verified:
> > `vault.rs` has zero stake references).
> >
> > `[CURRENT]`: `HybridConfig` (`crates/kovanica-state/src/ledger.rs` ~236) and
> > `Ledger::set_hybrid` (~2831) are still in the code, and the **staked-VRF half
> > was a genuinely separate feature** from PoW — which is exactly why the
> > decision needed to be made explicitly rather than assumed. Test suites:
> > `crates/kovanica-state/tests/hybrid.rs`,
> > `crates/kovanica-node/tests/hybrid_node.rs`, `unbond_node.rs`,
> > `incremental_persistence.rs`.
> >
> > Note: this is not the same document as
> > `protocol/docs/RFC-008-OraclePruning.md` (Oracle + pruning), which is
> > unaffected by the PoA-only decision.

Companion to **RFC-008**. This document is the engineering blueprint for implementers working in the monorepo (`kovanica-dag`, `kovanica-state`, `kovanica-node`, light-node).

---

## 1. Design principles

1. **Blue-work remains sovereign** — GHOSTDAG(k=3) never changes its selection algorithm; only the work *value* fed into it changes for staked blocks. — **still true, and now stronger than planned:** under PoA every block is pinned to `POA_NOMINAL_WORK = 1`, so blue work is a plain block count (RFC-POA §6.1(b)).
2. **Admission is gated, selection is not** — stake decides *who may propose*; PoW (real or fixed) decides *which chain wins*. — **`[TARGET]`-obsolete.** With PoW removed there is no work source; selection is blue score plus a constant, and who may propose is decided by the **authority set and slot schedule**, not by stake. With hybrid also removed (§0.7.1) there is no stake-based gating at all, so this principle has no live analogue — do not re-state it.
3. **Determinism** — every full node must reach identical conclusions about eligibility and work from the same selected-parent view. — **still true**, and the analogue under PoA is already enforced (canonical authority ordering, RFC-POA §6.1(a)).
4. **Light-client first-class** — header format and proofs must allow a resource-constrained client (mobile UniFFI light-node) to verify the selected tip without the full anticone or UTXO set. — **still true; delivered** under RFC-POA M4.
5. **Reuse existing primitives** — Ed25519, RFC-005 vaults, RFC-006 supply rules, current P2P framing. — **still true.**

---

## 2. VRF construction

### 2.1 Recommended primitive

Use an ECVRF based on Ed25519 (same curve already used for signatures):

- Suite: ECVRF-ED25519-SHA512-Elligator2 (or the closest IETF/draft that maps cleanly onto existing `ed25519-dalek` / `curve25519-dalek` stack).
- Output: 64-byte proof + 16–32-byte VRF output (hash-to-scalar or truncated).
- Verification must be constant-time and side-channel resistant where possible.

### 2.2 Sortition formula (consensus)

```text
let parent   = selected_parent of the candidate block
let slot     = parent.blue_score / SLOT_LENGTH          // integer division
let seed     = H("KovanicaVRF" || parent.header_hash || epoch_rand)
let (out, π) = VRF_prove(sk, seed || slot.to_le_bytes())
let y        = interpret(out) as integer in [0, 2^256)
eligible     = y * total_active_stake < stake_weight(validator) * THRESHOLD
```

- `epoch_rand` can be a rolling randomness beacon derived from previous VRF outputs or a simpler hash chain for v1.
- `total_active_stake` and `stake_weight` are computed from the UTXO set (or a committed stake tree) as of `parent`.

### 2.3 Header fields (staked block)

```rust
// Conceptual layout – exact bincode / custom codec in kovanica-dag
pub struct StakeProof {
    pub pubkey: [u8; 32],       // validator Ed25519
    pub proof:  Vec<u8>,        // VRF proof bytes
    pub slot:   u64,
    // optional: stake_amount claim (must match ledger view)
}
```

Full node validation order:

1. Deserialize header, detect presence of `StakeProof`.
2. If present → look up active stake for `pubkey` at parent view.
3. Recompute seed & slot from parent.
4. `VRF_verify(pubkey, seed||slot, proof) == Ok(out)`.
5. Check eligibility inequality.
6. Assign `work = FIXED_STAKE_WORK`.
7. Continue with normal GHOSTDAG + ledger checks (coinbase, MAX_SUPPLY, etc.).

PoW blocks simply omit the proof and follow the existing difficulty target. — **`[TARGET]`-obsolete:** both branches of this sentence disappear. There is no difficulty target (removed with PoW) and, under PoA, the "omit the proof" branch is the normal case — a plain block is validated by its **authority signature and slot schedule**, not by any work target.

---

## 3. Fixed nominal work

> ⚠️ `[TARGET]` **entirely obsolete — do not implement.** Kept for the record.
> The calibration below measures **live average PoW work**, and that quantity
> ceases to exist when PoW is removed. Under PoA the analogue is the fixed
> `POA_NOMINAL_WORK = 1` — a constant, not a calibrated value, because PoA blocks
> are one-per-slot and equal by construction. Hybrid is now removed entirely
> (§0.7.1), so there is nothing to calibrate **for**; this section is not to be
> re-derived or re-scaled.

```rust
pub const FIXED_STAKE_WORK: u128 = /* calibrated value */;
```

Calibration methodology (testnet):

- Measure average real PoW work of honest miners over a window. — `[TARGET]`-obsolete; nothing to measure.
- Set `FIXED_STAKE_WORK` to a small fraction (1–5 %) of that average so that a pure-stake majority cannot cheaply overtake a live PoW tip under normal network conditions. — `[TARGET]`-obsolete; there is no PoW tip to overtake. Under PoA the equivalent invariant is the one the shipped hybrid code already uses: keep the nominal value tiny so cheaply-inflatable weight stays out of chain selection (`HybridConfig::stake_nominal_work`).
- Document the measurement script; treat the constant as consensus-critical after activation.

GHOSTDAG receives this value exactly as it receives real PoW work today. No other changes to blue-set calculation.

---

## 4. Stake accounting (ledger)

### 4.1 Representation

Preferred v1 approach — reuse **RFC-005 vault**:

- Special vault template flagged as “staking vault”.
- Owner key = validator hot/cold key.
- Relative locktime / CSV for unbonding.
- Optional: secondary “slash” path that can burn or redirect to treasury on evidence.

Alternative (cleaner long-term): dedicated staking output type with explicit `stake_weight` and activation height, still enforced by the same script version machinery introduced in KVP-103/105.

### 4.2 Active stake view

At any selected parent, the node must be able to answer:

```rust
fn active_stake(pubkey: &[u8; 32], at: &BlockView) -> u64;
fn total_active_stake(at: &BlockView) -> u64;
```

Implementation options (choose one and stick to it):

- A. Linear scan of staking UTXOs (acceptable while validator set is small).
- B. Maintained in-memory stake map updated on every accepted block (preferred for performance).
- C. Sparse Merkle / Verkle stake tree whose root is optionally committed in headers (best for light clients, more work).

For light-nodes, option C (or at least a stake root in the header) is highly desirable later.

### 4.3 Unbonding & slashing

- Unbonding period ≥ several k-windows of practical finality (recommendation: start at 2 000–5 000 blocks and tune).
- Slashable offences (v1 minimum):
  - Two conflicting staked blocks at the same slot with the same key (equivocation).
  - Invalid VRF proof that somehow passed (should be impossible if verification is correct).
- Evidence is a short proof that can be included in a later transaction or special “evidence” transaction type.

---

## 5. Block production loops (node)

### 5.1 PoW path (existing)

Unchanged: solve PoW target, build block on current selected tips, broadcast.

### 5.2 Staking path (new)

```text
loop {
    let tip = current_selected_tip();
    let slot = tip.blue_score / SLOT_LENGTH;
    if already_produced_for(slot) { sleep; continue; }
    if !eligible(my_key, tip) { sleep; continue; }
    let proof = vrf_prove(...);
    let block = build_block(parents = tips, stake_proof = Some(proof), ...);
    // no PoW needed
    broadcast(block);
}
```

Both paths share the same transaction selection, coinbase construction, and MAX_SUPPLY checks.

---

## 6. P2P & propagation

- Existing block inventory / body messages are sufficient; the new fields ride inside the header.
- Nodes that have not upgraded will reject post-fork blocks (hard fork).
- Optional: new capability bit in handshake so peers can prefer hybrid-aware connections.

---

## 7. Light-node / SPV design (summary)

See dedicated document `LIGHT-NODE-SPV-AND-VRF.md`. Core requirements on the consensus side:

- Headers must be self-contained enough to verify:
  - parent linkage
  - blue-score progression (or enough data to recompute it for the selected chain)
  - VRF proof for any staked header
- Optional `utxo_commitment` / `stake_root` fields prepare the ground for inclusion proofs and stake proofs without full state.

---

## 8. Testing strategy

1. **Unit**: VRF prove/verify, eligibility math, work assignment.
2. **DAG**: mixed PoW + staked blocks, GHOSTDAG blue-set correctness, anticone of width ≤ k.
3. **Ledger**: stake activation, unbonding, MAX_SUPPLY still enforced on staked coinbases.
4. **Fork choice**: pure-stake tip vs honest PoW tip under various `FIXED_STAKE_WORK` values.
5. **Light**: header-only sync + VRF verification against a known tip.
6. **Adversarial**: grinding attempts, equivocation, delayed stake withdrawal around reorgs.

All tests must be deterministic and runnable in CI without network.

---

## 9. File / crate layout suggestion

```
kovanica-vrf/           # new crate – pure crypto
kovanica-dag/
  src/header.rs         # versioned header + StakeProof
  src/admission.rs      # PoW vs stake path
  src/ghostdag.rs       # only receives work value (no logic change)
kovanica-state/
  src/stake.rs          # active stake view, vault recognition
kovanica-node/
  src/staker.rs         # production loop
  src/miner.rs          # existing
```

---

## 10. Backward compatibility & activation

- Pre-activation height: any block containing `StakeProof` is invalid.
- At activation height (or new genesis on testnet): rules switch.
- Clients and explorers must understand both header versions.
- Document the exact activation height / genesis hash in the release notes and `/api/head` (network magic or version field).

---

## 11. Open implementation choices (decide before coding)

| Choice                        | Options                              | Recommendation for v1          |
|-------------------------------|--------------------------------------|--------------------------------|
| VRF library                   | dalek-based ECVRF vs external crate  | Prefer audited dalek path      |
| Stake representation          | RFC-005 vault flag vs new script     | Vault flag (faster)            |
| Stake root in header          | Yes / No                             | No for first merge; add later  |
| Delegation                    | None / simple nominators             | None                           |
| Staking rewards               | None (only residual subsidy) / new   | None in RFC-008                |

---

**Document status:** Living technical design. Update in lock-step with RFC-008 and the reference implementation PRs.
