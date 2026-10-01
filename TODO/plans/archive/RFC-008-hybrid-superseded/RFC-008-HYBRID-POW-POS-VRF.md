# RFC-008 — Hybrid PoW/PoS Admission with VRF + Light-Client (SPV) Path

**Status:** **SUPERSEDED — hybrid dropped entirely** (decided 2026-09-25, RFC-POA-Migration §0.7.1)  
**Public name (proposed):** KVP-107 Hybrid Consensus  
**Depends on:** RFC-006 (tokenomics, MAX_SUPPLY, maturity), GHOSTDAG k=3, RFC-005 (vaults for stake)  
**Affects:** `kovanica-dag`, `kovanica-state`, `kovanica-node`, light-node / UniFFI, explorer, wallet  
**Consensus impact:** **Hard fork** (admission rules + header extension). Requires testnet reset or carefully gated activation height.

> > **Consensus decision (ratified 2026-09-25): Kovanica is PoA-only.**
> > Proof-of-Work is being removed from the protocol. See
> > `protocol/docs/RFC-POA-Migration.md` §0 (canonical). Items marked `[TARGET]`
> > are ratified but not yet implemented; `[CURRENT]` items describe shipped code.
> >
> > **This plan is SUPERSEDED. Do not implement from it.**
> >
> > Its central premise — PoW as the "ultimate work source" with stake gating only
> > a cheap secondary admission path — is **`[TARGET]`-obsolete**. It assumes a
> > permissionless, work-based admission model, and PoA-only deliberately removes
> > the protocol's permissionless admission path (RFC-POA-Migration §0.5). Most of
> > this document is written to solve problems that no longer exist: sizing
> > `FIXED_STAKE_WORK` as a fraction of live PoW work, keeping a PoW tip alive
> > against a stake majority, and the pre/post-activation coexistence of "PoW-only"
> > and "PoW+staked" header formats.
> >
> > **It is resolved: hybrid is dropped entirely.** RFC-POA-Migration
> > **§0.7.1** decided **Option A** (2026-09-25) — PoA is the only admission
> > path, and the "PoA + staked-VRF secondary tier" reading was considered and
> > rejected. Keep this file as a historical record only. **Every parameter,
> > threshold and schedule proposed below is dead** and must not be
> > implemented; the stake registry retires with hybrid, and RFC-005
> > vault/CSV and the treasury vaults are explicitly **unaffected**.
> >
> > `[CURRENT]`: the hybrid machinery described here is still in the code —
> > `HybridConfig` (`crates/kovanica-state/src/ledger.rs` ~236) and
> > `Ledger::set_hybrid` (~2831) — and its **staked-VRF half is a genuinely
> > separate feature** from PoW, which is precisely why removing PoW alone did
> > not decide it — the maintainer had to decide it separately (and did: drop)
> > rather than automatic. Test suites that depend on it:
> > `crates/kovanica-state/tests/hybrid.rs`,
> > `crates/kovanica-node/tests/hybrid_node.rs`, `unbond_node.rs`,
> > `incremental_persistence.rs`.
> >
> > Note: this RFC-008 is **not** the same document as
> > `protocol/docs/RFC-008-OraclePruning.md` (Oracle + pruning), which is
> > unaffected by the PoA-only decision.

---

## 1. Motivation

Kovanica currently relies solely on Proof-of-Work for block admission and GHOSTDAG blue-work for chain selection. As subsidy decays (RFC-006 geometric curve), long-term security budget must be supplemented. Stage-3 vision (already noted in internal GHOSTDAG notes) is:

- Keep **GHOSTDAG blue-work** as the sole chain-selection signal.
- Add **VRF-based stake admission** so that staked blocks can be proposed without requiring expensive PoW.
- Enable **light-nodes / SPV-style clients** that verify the selected chain + eligibility proofs without a full DAG or full UTXO set.

Goals:

1. Hybrid security: PoW remains the ultimate work source; stake gates cheap admission. — **`[TARGET]`-obsolete premise.** Under PoA-only there is no work source and no "ultimate"; blue work is a plain block count because every block is pinned to `POA_NOMINAL_WORK = 1` (RFC-POA §6.1(b)). This goal cannot be met and is replaced by the authority-set trust assumption (§0.5).
2. Light-client friendliness: compact headers + VRF proofs + blue-score finality. — **survives**, and the SPV path was separately delivered under RFC-POA M4.
3. No inflation of blue weight by low-cost staked blocks (fixed nominal work). — **survives** in spirit, and is already true under PoA by construction.
4. Clean interaction with existing MAX_SUPPLY, coinbase maturity, and fee-burn rules. — **survives unchanged; see §5 below.**

Non-goals (this RFC):

- Replacing GHOSTDAG with pure PoS.
- Full account-model staking rewards distribution (can be later KVP).
- On-chain governance voting.

---

## 2. High-level design

### 2.1 Block types

| Type        | Admission requirement          | Work contribution to blue-score | Coinbase allowed |
|-------------|--------------------------------|---------------------------------|------------------|
| PoW block   | Valid PoW (current rules)      | Real PoW work                   | Yes              |
| Staked block| Valid VRF proof + sufficient stake | **Fixed nominal work** (constant) | Yes (same rules) |

Both types are full blocks in the DAG. GHOSTDAG ordering and blue/red classification remain unchanged. Only the *admission* gate and the *work value* assigned to a staked block differ.

### 2.2 Chain selection (unchanged principle)

```
selected_parent = GHOSTDAG(k=3) using blue-work
blue-work(staked_block) = FIXED_STAKE_WORK   // consensus constant
blue-work(pow_block)    = actual_pow_work
```

`FIXED_STAKE_WORK` must be chosen so that a realistic number of staked blocks cannot dominate a well-mined PoW tip. Exact value is a consensus parameter (see §6).

### 2.3 VRF sortition (eligibility)

For a given slot derived from blue-score:

```
slot          = blue_score_of_selected_parent / SLOT_LENGTH
seed          = H(selected_parent_header || epoch_randomness)
vrf_out       = VRF_prove(sk_validator, seed || slot)
eligible      = (vrf_out * total_active_stake) < (stake_of_validator * THRESHOLD)
```

- `VRF` is a verifiable random function (recommended: ECVRF-ED25519-SHA512-Elligator2 or equivalent that re-uses Ed25519 keys already in the protocol).
- `THRESHOLD` and `SLOT_LENGTH` are consensus constants.
- Only validators with locked stake (see §4) may produce a valid proof.

A staked block header **must** contain the VRF proof, the stake public key (or commitment), and the claimed slot. Full nodes reject the block if the proof does not verify or the validator is not eligible for that slot.

### 2.4 Light-node / SPV path

A light-node needs only:

1. Selected-parent header chain (or a compact proof of the current tip’s ancestry).
2. Blue-score / selected-chain depth.
3. VRF eligibility proofs for recent staked blocks (optional for pure PoW tips).
4. (Future) UTXO commitment or sparse-Merkle root if transaction inclusion proofs are required.

Finality signal for wallets: **blue-score advance** of N windows (same recommendation as current GHOSTDAG notes), not raw height.

---

## 3. Header extension (consensus-critical)

Current header fields remain. New optional / versioned fields (activated at fork height):

```rust
// Conceptual – exact serialization in technical design
struct BlockHeaderV2 {
    // … existing fields …
    version: u32,                    // bump for hybrid
    // Staked-block only (absent or zero for pure PoW)
    stake_pubkey: Option<[u8; 32]>,  // Ed25519
    vrf_proof: Option<VrfProof>,     // variable or fixed-size
    slot: Option<u64>,
    // Optional for light clients
    utxo_commitment: Option<[u8; 32]>, // future
}
```

Validation rules:

- If `vrf_proof` is present → treat as staked block → enforce eligibility + assign `FIXED_STAKE_WORK`.
- If absent → treat as PoW block → enforce current PoW difficulty / target.
- Mixed DAG is legal; GHOSTDAG runs on the resulting blue-work values.

---

## 4. Staking model (ledger-safe)

Stake is locked via existing **RFC-005 vault** machinery (or a thin staking script that re-uses CSV + time-lock semantics):

- Deposit: KVNC (or approved KVP-102 asset) into a staking vault controlled by the validator’s Ed25519 key.
- Activation delay: stake becomes active after `STAKE_ACTIVATION_BLOCKS`.
- Unbonding: `UNBONDING_PERIOD` (must be ≥ practical reorg depth under k=3).
- Slashed stake: burned or sent to treasury vault on proven misbehaviour (double-sign, invalid VRF, etc.).

Exact script templates and slash conditions are specified in the companion technical design. This RFC only requires that active stake weight is deterministically computable from the UTXO set (or a committed stake root) at the selected parent.

---

## 5. Interaction with RFC-006 tokenomics

> **These bullets survive the PoA-only decision and should be read as still
> accurate.** The emission curve is **height-indexed** (`subsidy_at(height)`) and
> issuance is hard-capped inside `apply_block` (`crates/kovanica-state/src/ledger.rs` ~1617), which rejects any block where `cumulative_minted + claimed_native > MAX_SUPPLY`. Neither depends on who produced a block or how. MAX_SUPPLY **90.2M KVNC**, s₀ **10 KVNC/block**, era **2,000,000 blocks**, α **3/4**, maturity **100 blocks**, fee split **75% burned / 25% producer**, GHOSTDAG **k=3**, UTXO, Ed25519, **1 KVNC = 100_000_000 atoms** — all unchanged. The admission model moved; supply math did not. The only thing that shifts is the *pace* (fixed `SLOT_DURATION_MS` = 3000 ms default, no retarget, no gap-fill), never the cap.

- Coinbase rules, `native_minted`, `MAX_SUPPLY`, 100-block maturity, and 75/25 fee burn apply **identically** to both PoW and staked blocks.
- A staked block that would push `native_minted` over the hard cap is rejected exactly as a PoW block would be.
- Security budget note: as subsidy → 0, the combination of remaining fees + economic value of stake (and future staking rewards if introduced) becomes the dominant incentive. — `[OPEN]` the PoA migration raises a related question this does not answer: with a fixed slot clock and no gap-fill, an unscheduled/offline slot emits no subsidy, so emission pace and its distribution depend on authority liveness (RFC-POA-Migration §0.7.3).

---

## 6. Consensus parameters (initial proposal)

> ⚠️ `[TARGET]` **entirely obsolete — do not implement any row.** The table
> below is kept for the record. `FIXED_STAKE_WORK` is specified as a
> *fraction of live average PoW work*, and that reference point disappears with
> PoW. Hybrid itself is now removed (§0.7.1), so there is no slot to allocate
> and no `FIXED_STAKE_WORK` to size: the analogue `POA_NOMINAL_WORK = 1` is
> the PoA admission pin and is **not** a hybrid field. Do not carry the 1–5 %
> figure over, and do not re-derive this table — there is nothing to derive it
> for.

| Parameter              | Suggested starting value          | Notes |
|------------------------|-----------------------------------|-------|
| `SLOT_LENGTH`          | 10 blue-score units               | Tunable |
| `FIXED_STAKE_WORK`     | Equivalent to ~1–5 % of current average PoW work | Must not let pure-stake tips overtake honest PoW — `[TARGET]`-obsolete basis |
| `THRESHOLD`            | 1 / expected_validators_per_slot  | Classic sortition |
| `STAKE_ACTIVATION_BLOCKS` | 100–500                        | After deposit |
| `UNBONDING_PERIOD`     | ≥ 2–4× practical finality depth   | k=3 aware |
| `MIN_STAKE`            | TBD (economic)                    | Prevent dust validators |

All values are consensus constants; changing them after activation requires another fork.

---

## 7. Activation & migration

- New consensus version / fork height (or genesis reset on testnet).
- Pre-activation: only PoW blocks valid. — **`[TARGET]`-obsolete:** the PoW
  pre-activation phase cannot exist under PoA-only, and the mandatory reset means
  there is no pre-activation phase to gate against (RFC-POA-Migration §0.6).
- Post-activation: both types accepted under the rules above. — **`[TARGET]`-dead.**
  "Both types" presupposes a PoW type, and neither type exists: PoW is removed
  (§0.1) and hybrid is removed (§0.7.1). PoA is the only admission path.
- Testnet **must** reset or clear all prior state that assumed pure-PoW headers (same discipline as RFC-006). — **still true, and now unconditionally required**, not conditional on this RFC shipping.
- Light-node clients must be updated before or at activation; old light clients that ignore the new fields will be unsafe.

---

## 8. Security considerations

- **Work inflation attack**: mitigated by fixed nominal work for staked blocks.
- **Stake grinding / adaptive VRF**: use proper ECVRF; seed must be unpredictable until the parent is fixed.
- **Nothing-at-stake**: GHOSTDAG + slashable double-sign + unbonding period.
- **Long-range attacks on light clients**: rely on weak subjectivity / checkpointing from trusted sources or social consensus for deep history (standard PoS light-client issue). Document clearly.
- **Centralisation**: monitor stake distribution; consider progressive thresholds or delegation limits in later KVPs.

---

## 9. Implementation sketch (Rust crates)

- `kovanica-vrf` — pure VRF prove/verify + test vectors (no DAG dependency).
- `kovanica-dag` — header version, admission, work assignment, GHOSTDAG unchanged.
- `kovanica-state` — stake weight calculation, vault recognition, slash.
- `kovanica-node` — mining / staking loops, P2P propagation of both block types.
- Light / UniFFI — header sync + VRF verify path.

---

## 10. Open questions (to resolve before Final)

1. Exact VRF construction and serialization size.
2. Whether stake root is committed in every header or only periodically.
3. Initial `FIXED_STAKE_WORK` calibration methodology (testnet experiment).
4. Whether staking rewards (beyond residual subsidy) are in-scope for this RFC or a follow-up.
5. Delegation / nominator model (yes/no for v1).

---

## 11. References

- Internal: `ghostdag-notes.md` (Stage-3 hybrid admission vision)
- RFC-005 — Time-lock vault + CSV
- RFC-006 — Tokenomics, MAX_SUPPLY, maturity, fee burn
- Classic literature: Ouroboros / Praos VRF, GHOSTDAG papers, Bitcoin SPV, weak subjectivity

---

**Authors / editors:** Kovanica core (draft for review)  
**Next step:** Technical design document + test vectors before any consensus code lands.
