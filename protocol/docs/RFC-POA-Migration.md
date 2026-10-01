# RFC-POA: Pure Proof-of-Authority Consensus Migration

**Status:** Draft — §0 ratified 2026-09-25 (PoA-only)  
**Consensus Impact:** **consensus-breaking (hard fork).** This change alters
block *admission* — which keys may produce a block at all — so a legacy PoW
chain and a PoA chain cannot be reconciled and a genesis reset is mandatory
(§0.6). It is **not** a `consensus-safe` change, and must not be described as
one. **What does *not* change:** GHOSTDAG **k=3**, the pure **UTXO** ledger,
**Ed25519** signing, and every RFC-006 tokenomics constant — MAX_SUPPLY 90.2M
KVNC, s₀ 10 KVNC/block, era 2,050,000, α 3/4, maturity 100, fee split 75%
burned / 25% producer.  
**KVP:** KVP-201 (authority set + slot round-robin + authority signature)  
**Related:** RFC-001..RFC-006 (all shipped features preserved), RFC-007/KVP-106 (NFT, client-only), DeFi/RWA (post-PoA)  
**Canonical for:** the PoA-only consensus decision and everything derived from it — see **§0**

---

## One-Line Summary
Replace **both** hybrid PoW+VRF block admission *and* the staked-VRF secondary
path with pure Proof-of-Authority (PoA): fixed authority set, slot-based
round-robin scheduling, Ed25519 authority signatures on blocks, no permissionless
or stake-weighted admission of any kind; keep GHOSTDAG (k=3), UTXO ledger, SPV,
pruning, RFC-005 vaults, and all KVP-1xx features intact.

---

## 0. Consensus decision: PoA-only (canonical)

**Kovanica's consensus is PoA-only. Proof-of-Work is being removed from the
protocol entirely.**

This section is the **canonical source** for the PoA-only decision. Every other
document in the repository cites this section rather than restating the policy.
Where a document here or elsewhere says something incompatible, this section
wins.

**Ratified:** 2026-09-25 by maintainer decision. **Implementation status:**
`[TARGET]` — ratified, not yet implemented. **Consensus impact:**
**consensus-breaking (hard fork)** — block admission changes, so a genesis reset
is mandatory (§0.6). Not `consensus-safe`. GHOSTDAG k=3, the UTXO ledger,
Ed25519 signing and all RFC-006 supply constants are unchanged.

### 0.1 The decision, and what it removes

"PoA-only" means PoW is not merely *disabled by default* — it is **deleted**.
`KOVANICA_CONSENSUS=pow` is a transitional bootstrap affordance, not a supported
end state, and it does not survive the migration. The full removal surface is:

| Component | Where | `[TARGET]` action |
|-----------|-------|-------------------|
| `Dag::set_proof_of_work` | `kovanica-dag/src/dag.rs` ~509 | Remove |
| `Dag::set_difficulty` / `clear_difficulty` | `kovanica-dag/src/dag.rs` ~479 | Remove |
| `Dag::proof_of_work_enabled` | `kovanica-dag/src/dag.rs` ~515 | Remove |
| `DagError::InsufficientProofOfWork` | `kovanica-dag/src/dag.rs` ~166 | Remove |
| `DagError::DifficultyMismatch` | `kovanica-dag/src/dag.rs` ~152 | Remove |
| `pow` module (`mine`, `mine_from`, `meets_target`, `is_mined`) | `kovanica-dag/src/pow.rs` | Remove |
| `difficulty` module (`Retarget`, `TimedWork`, `next_work`) | `kovanica-dag/src/difficulty.rs` | Remove |
| `KOVANICA_POW` env var | `kovanica-node/src/explorer.rs` ~874, ~981; `main.rs` ~37 | Remove; replaced by `KOVANICA_CONSENSUS` |
| Mining loop + `KOVANICA_MINE` / `KOVANICA_MINE_SECS` / `KOVANICA_MINER_ADDRESS` | `kovanica-node` | Remove; replaced by authority production |
| RPC/explorer `kind: "pow"` | `kovanica-node/src/explorer.rs` ~3518 | Remove; `poa` is the only kind |
| FFI `BlockKind::Pow`, `set_miner_seed`, staked-then-PoW `produce_block` | `kovanica-ffi/src/light_node.rs` ~85, ~302, ~367, ~626 | Remove |
| `protocol/mine-kvnc.sh` + `KOVANICA_MINER_ADDRESS` | `protocol/mine-kvnc.sh` | Remove (only consumer of `KOVANICA_MINER_ADDRESS`; no Rust code reads it) |
| `pow` / `pow-vrf` cargo features | `kovanica-dag`, `kovanica-node` | Remove; `poa` is the only build |

There is **no `KOVANICA_DIFFICULTY`-style env var** in the current code — PoW
difficulty is a node-local `Retarget` policy, never operator-tunable. Nothing
needs migrating there.

#### 0.1.1 This is a one-way door

**Removing PoW is irreversible in practice, and that should be said out loud
before it starts.**

Once the rows above are deleted, the codebase contains **no permissionless
admission path at all** — not a disabled one, not a feature-flagged one, not a
config-hidden one. Restoring one later would not be a config change or a
revert-friendly patch: it would be a **second consensus-breaking change**,
with its own activation fork, its own genesis/work-format question, and its own
security review. There is no `KOVANICA_POW=0` to come back to.

The removal also **narrows the evidence base at the same time as the options
do.** The `challenger_*` suites in §0.7.3 are the repository's adversarial
*consensus* coverage; they are written against mining and are part of this
removal. Deleting them without replacement means PoA would ship with **thinner
adversarial coverage than PoW had**, at the exact moment the admission model
becomes the single point of trust (§0.5). Treat "PoA adversarial tests
re-established" as a gate on the removal, not a nice-to-have after it.

Practical reading: if a future maintainer wants permissionless entry back, this
decision must be reversed *deliberately and expensively*, not repaired
incidentally.

### 0.2 What replaces the operator surface

`KOVANICA_POW` is removed and **not** replaced by an equivalent. Operators
configure PoA with these four vars (all shipped, RFC-POA §7):

| Env var | Default | Purpose |
|---------|---------|---------|
| `KOVANICA_CONSENSUS` | `poa` when unset | Admission mode; `poa` is the only `[TARGET]`-supported value |
| `KOVANICA_AUTHORITIES` | *(unset → testnet placeholder; mainnet refuses to boot)* | Comma-separated 64-hex Ed25519 public keys of the authority set |
| `KOVANICA_AUTHORITY_THRESHOLD` | strict majority | Signatures required to execute an `AuthorityUpdateTx` |
| `KOVANICA_SLOT_DURATION` | `3000` (ms) | Slot length; `SLOT_DURATION_MS` constant |

A former miner's replacement role is **authority operator**, not miner: hold an
authority Ed25519 **signing key**, present it to the node via
`set_authority_signing_key`, and sign exactly one block per
`SLOT_DURATION_MS`-derived slot when scheduled. Authority keys are *not* PoW
keys and are not derivable from a seed you choose.

### 0.3 Reading markers

This repository's documentation distinguishes the ratified target from shipped
code with two greppable markers:

- **`[TARGET]`** — ratified direction, **not yet implemented in code.**
- **`[CURRENT]`** — true of the code today.

`[CURRENT]` state as of the ratification commit is: PoW, difficulty/retarget and
the `pow` module are **present and reachable**; `KOVANICA_CONSENSUS` defaults to
`poa` when unset (`consensus_mode_from_env`, `explorer.rs` ~184), so a fresh
boot is PoA, but `KOVANICA_CONSENSUS=pow` still selects legacy PoW admission, and
`KOVANICA_POW=1` is still honoured on the two paths that reach it. The PoA
*mechanism* (authority set, slot round-robin, authority signature, nominal-work
pin) **is shipped** — see the milestone table below. What is not shipped is the
**removal of PoW**.

A prior RFC revision here claimed PoA "ignores" a block's `work` when the code
did not, and that doc/code divergence was a live consensus bug (§6.1(b)). The
`[TARGET]`/`[CURRENT]` split exists to prevent a recurrence: never write a
`[TARGET]` claim as though it were `[CURRENT]`.

### 0.4 What does *not* change: RFC-006 tokenomics

Removing PoW **does not change supply math, by construction.** The emission
curve is **height-indexed** (`subsidy_at(height)`) and issuance is hard-capped
inside `apply_block` (`kovanica-state/src/ledger.rs` ~1617), which rejects any
block whose `cumulative_minted + claimed_native > MAX_SUPPLY`. Neither depends on
*who* produced the block or *how*. All of the following are unchanged by the
PoA-only migration and remain hard consensus rules:

| Constant | Value | Source |
|----------|-------|--------|
| `MAX_SUPPLY` | **90.2M KVNC** (`90_200_000 * ATOM`) | `ledger.rs` ~177 |
| Genesis subsidy s₀ | **10 KVNC / block** (`RFC006_GENESIS_SUBSIDY`) | `ledger.rs` ~174 |
| Era length | **2,050,000 blocks** (`RFC006_ERA_LENGTH`) | `ledger.rs` ~175 |
| Decay α | **3/4 per era** | `subsidy_at`, `ledger.rs` ~148 |
| Coinbase maturity | **100 blocks** (`COINBASE_MATURITY`) | `ledger.rs` ~189 |
| Fee split | **75% burned / 25% producer** (`FEE_PRODUCER_NUM=1`, `FEE_PRODUCER_DEN=4`) | `ledger.rs` ~191 |
| GHOSTDAG **k** | **3** | `dag.rs` |
| Ledger model | pure **UTXO** | `kovanica-state` |
| Signatures | **Ed25519** (64 bytes → 128 hex) | `sig.rs` |
| KVNC precision | **1 KVNC = 100_000_000 atoms** (`ATOM`) | `ledger.rs` ~171 |

**Pace vs. total — the one distinction worth stating.** PoW difficulty was
*adaptive*: block time self-corrected against hash power. PoA has no difficulty
and nothing to retarget — the clock is a fixed `SLOT_DURATION_MS` (default
`3000`) and there is **no gap-fill**: an offline authority simply yields an
empty slot, and the next scheduled authority continues on schedule. So the PoA
migration changes the *pace* of emission in wall-clock terms, **not its
cumulative cap**. 90.2M KVNC is 90.2M KVNC before and after. The 82M KVNC curve /
0.2M premine / 8M treasury allocation is likewise untouched.

### 0.5 Governance consequence: admission becomes permissioned

This is a deliberate governance change and must not be glossed as a pure
optimization.

PoW is what made block admission **permissionless**: anyone could spend CPU to
enter the DAG, and the protocol needed no privileged key set. PoA is a
**permissioned** admission model — block production is restricted to a fixed,
on-chain-committed authority set. Removing PoW therefore **removes the
protocol's permissionless admission path**, and with it the Sybil-resistance
argument that admission cost equals real cost.

**With hybrid also removed (§0.7.1, decided), there is no second admission path
left to fall back on.** A non-authority — a staked validator, a bonded holder, a
miner with capital — **can never produce a block.** The only route into the
selected chain is a signature from an authority scheduled for that slot. That
consequence is stated here rather than buried in the removal list, because it
is the governance-facing part of the decision: Kovanica is committing to a
membership-gated ledger, and the Sybil-resistance story moves from *economic*
(admission cost = real cost) to *social* (the set is small, named, and
collectively accountable).

What replaces PoW's guarantee is a *social* trust assumption. That is a
stronger and more centralized trust base than PoW, and it is a **governance
decision the maintainer has made**, not a security improvement. Security
documentation in this repository (`docs/SECURITY.md`, `docs/AUDIT-PLAN.md`,
`docs/BUG-BOUNTY.md`) is revised against this model rather than papering over
it. The authority-set *mechanism* is settled (§0.7.2); its *governance
inputs* — who may join, and how the first mainnet set is chosen — are not, and
this framing is only as good as that answer.

### 0.6 Operational consequence: the testnet reset is mandatory

`consensus_mode_from_env()` (`explorer.rs` ~184) already **defaults to PoA when
`KOVANICA_CONSENSUS` is unset.** A PoA-only default means the existing testnet
reset documented in `TESTNET-RESET-POLICY.md` §1 is **mandatory**: a legacy PoW
chain and a PoA chain **cannot be reconciled**. Two independent reasons, both
verified in code:

1. **The nominal-work pin is a chain-format constraint, not a runtime toggle.**
   Under PoA every block must carry `work == POA_NOMINAL_WORK = 1`
   (`Dag::check_poa` → `DagError::PoaWorkMismatch`). A pre-activation PoW block
   carries real work orders of magnitude above 1, so it out-competes every PoA
   block in the GHOSTDAG blue-work fold: the selected parent would never advance
   past the activation point and the chain would appear frozen. Replay
   (`Dag::insert_for_replay`) and snapshot restore deliberately skip the check,
   so restoring a pre-pin PoA snapshot is safe — but live re-validating a mixed
   history is not.
2. **Genesis is a different block.** PoA genesis commits the authority set as a
   `KVA1`-tagged coinbase output (`genesis_with_poa`), so the genesis block id
   differs from the pre-reset PoW genesis.

The testnet fallback authority set is derived from the hardcoded public constant
`AUTHORITY_PLACEHOLDER_BASE = 9001` (`explorer.rs` ~196) — publicly derivable
testnet-only keys, mirroring the placeholder treasury keys
(`TREASURY_SEED_BASE`). `kovanica-mainnet` **refuses to boot** without an
explicit `KOVANICA_AUTHORITIES`, the same fail-fast guard as the treasury seed.
A single-node testnet/explorer that booted on the placeholder set loads those
signing keys (`explorer.rs` ~868, ~936) and produces in every slot; an explicit
`KOVANICA_AUTHORITIES` set never loads keys into the node, so each authority
operator supplies their own via `set_authority_signing_key`.

#### 0.6.1 Reset *planning* is authorised; *execution* is not

**Authorised (2026-09-25):** planning the reset — the runbook, the pre-execution
gates below, and the key-ceremony procedure for testnet authority keys.

**Not authorised:** executing the reset. No testnet data directory may be wiped
and no new PoA genesis may be committed until gates 1-3 below are closed (gate 4 gates *mainnet*, not this reset).
This is a deliberate split: the planning artefacts are needed *before* anyone is
in a position to execute, and producing them is not a step that can half-happen
and damage a live chain.

#### 0.6.2 Pre-execution gates (all four must be closed)

| # | Gate | Status | Why it is a gate |
|---|------|--------|-----------------|
| **1** | **Real, random testnet authority keys** — *not* the `AUTHORITY_PLACEHOLDER_BASE = 9001` set | ☐ open | The placeholder set is publicly derivable, so a soak run against it exercises an **unauthenticated** PoA. It cannot detect a real authority compromise, key reuse, or a bad ceremony, because every participant can forge any authority. A green soak on placeholders is **not** evidence for a green soak on real keys. |
| **2** | **24h multi-validator soak** (M6 exit criterion) | ☐ open | Single-node and short-run checks do not exercise authority failover, slot-clock drift, or a rotating authority set over a realistic day. |
| **3** | **PoA resource footprint** (CPU/RAM) | ☑ **closed 2026-09-26** | Reworded from "CPU/RAM-vs-PoW", which is unrecoverable: `1df0114` renamed the test to `resource_profiling_poa_production` and deleted the PoW arm, and the test was `#[ignore]`d in every revision it ever had (`f00c151`, `ddbe469`, `c5db750`, `1df0114`), so no PoW baseline was ever recorded. Baseline from a manual run: **112.7 us/block, +7.4 KiB/block RSS** over 100 blocks. A regression bar against a reintroduced search loop, **not** an efficiency claim — see §0.9.1. |
| **4** | **Mainnet key ceremony** (per §0.7.2 residuals) | ☐ open | Required before *any* mainnet authority set is frozen. Independent of the testnet reset, but listed here because the same ceremony procedure is being written for gate 1 and should not be written twice. |

**Gate already closed:** the nominal-work pin. `POA_NOMINAL_WORK = 1` and
`DagError::PoaWorkMismatch` landed in commit `a8b0e82` (`consensus/poa-nominal-work`),
so the §6.1(b) work-inflation exploit is fixed at the admission boundary and is
no longer a reset blocker. This does **not** weaken the mandatory-reset
argument above: the pin is precisely *why* the reset is required, because a
pre-activation PoW block carrying real work out-competes every nominal-work PoA
block in the blue-work fold.

### 0.7 Residual open decisions

The PoA-only decision is a direction plus two settled sub-decisions. This section
records what is **decided** (§0.7.1, §0.7.2-mechanism) and what is **genuinely
still open** (§0.7.2-residual, §0.7.3). No other document may present an
`[OPEN]` item below as decided, or a decided item as open.

#### 0.7.1 **DECIDED** — hybrid / staked-VRF admission is dropped entirely

> **Decided 2026-09-25 (Option A).** PoA is the **only** admission path.
> Implementation status: `[TARGET]` — ratified, not yet implemented; the code
> still ships hybrid (`[CURRENT]`).

`HybridConfig` (`kovanica-state/src/ledger.rs` ~236) was defined as PoW **+**
stake-weighted VRF sortition, and `Ledger::set_hybrid` (~2831) cleared
`require_pow` / `difficulty` / `vrf` before enforcing both paths itself. With
PoW gone its PoW half is meaningless, and **its staked-VRF half is dropped
too** — Option B (a "PoA + staked-VRF secondary tier") was considered and
rejected. There is no secondary tier.

**Removal surface:**

| Component | Where | `[TARGET]` action |
|-----------|-------|-------------------|
| `HybridConfig` | `kovanica-state/src/ledger.rs` ~236 | Remove |
| `StakedVrf` | `kovanica-state` | Remove |
| `Ledger::set_hybrid` / `hybrid_enabled` | `kovanica-state/src/ledger.rs` ~2831 | Remove |
| `set_poa`-vs-hybrid mutual exclusion | `Ledger::set_poa`; asserted by `poa_ledger.rs` | Remove (nothing left to be mutually exclusive with) |
| `stake_nominal_work` (`HybridConfig` field) | `kovanica-state/src/ledger.rs` | Remove. **Note:** `POA_NOMINAL_WORK` (§6.1(b)) is a *separate* dag-level constant and is **not** affected — do not remove the wrong one |
| Staked-block insert path (`insert_with_vrf`) | `kovanica-dag` / `kovanica-state` | Remove |
| `KOVANICA_HYBRID` env var | `kovanica-node/src/explorer.rs` ~873, ~971 | Remove |
| Stake registry `stake.rs` | `kovanica-state/src/stake.rs` | **Retire with it** — see below |
| `Freeze` / `UNBOND_MATURITY` / `UNBOND_PREFIX` unbond path | `kovanica-node/src/node.rs` ~24, ~26; `apply_block_with_stake` | Remove |
| FFI hybrid + staking surface (`enable_hybrid`, `hybrid_enabled`, `set_validator_seed`, `validator_public_key_hex`, `bond_stake`, `unbond`, `pending_unbond_height`, `BlockKind::Staked`, `InsufficientStake`) | `kovanica-ffi/src/light_node.rs` ~86–99, ~347–403; `lib.rs`; `tests/ffi.rs` | Remove; regenerate + commit Kotlin/Swift bindings in the same change |
| `open_with_hybrid` / `_with_hybrid` reader family | `kovanica-state/src/store.rs` ~127 | Remove |
| `apply_block_with_stake` | `kovanica-node/src/node.rs` ~24 | Remove |
| `kind: "staked"` in explorer/RPC | `kovanica-node/src/explorer.rs`; `explorer_detail.rs` ~74 | Remove; `poa` is the only kind |

**The stake registry retires with hybrid.** `covanica-state/src/stake.rs` is
referenced only by `ledger.rs` (`pub use`, `bond_tag`, `StakeState`,
`UNBOND_MATURITY`), `lib.rs` (`pub mod stake`), and `kovanica-node/src/node.rs`
(the unbond path). With `set_hybrid` gone there is no bond source and no
staked block for a frozen output to be spent by, so the registry has no
remaining consumer. It is removed with the rest of the surface, not retained
"in case it is useful later" — dead registry code with no admission path behind
it is a maintenance liability, not an option.

**RFC-005 vault/CSV and the treasury vaults are UNAFFECTED.** This is the one
easy-to-get-wrong consequence, so it was verified directly rather than inferred:
`crates/kovanica-state/src/vault.rs` contains **zero** references to `stake`,
`bond`, `unbond`, `vrf`, or `Freeze`. RFC-005 vaults, CSV time-locks, and the
8 × 1M KVNC treasury tranches do **not** depend on the stake registry and are
**not** part of this removal. Their keys (`TREASURY_SEED_BASE`) are a
*separate* concern from authority signing keys (§0.7.2).

**Test suites to delete** (not adapt):

| Suite | Note |
|-------|------|
| `kovanica-state/tests/hybrid.rs` | Pure hybrid. Delete. |
| `kovanica-node/tests/hybrid_node.rs` | Pure hybrid. Delete. |
| `kovanica-node/tests/unbond_node.rs` | Pure unbond/stake lifecycle. Delete. |
| `kovanica-node/tests/incremental_persistence.rs` | ⚠️ **Also has non-hybrid content** — it references `open_with_hybrid` but tests incremental persistence generally. **Needs splitting or selective removal, not a blind delete.** Flagged for the implementer. |
| `kovanica-state/tests/undo_log_adversarial.rs` | ⚠️ **Also has non-stake content.** Uses `StakeState` / `UNBOND_MATURITY` (line ~16) and `UNBOND_PREFIX` (line ~56) *within* an adversarial undo-log suite. Same treatment: split, don't delete. |
| `kovanica-state/tests/poa_ledger.rs` | ⚠️ **Mostly survives.** Its hybrid content is the `set_poa`/`set_hybrid` mutual-exclusion test (`set_poa_clears_hybrid_and_vice_versa`, line ~122) and the `HybridConfig` import. Delete those, keep the PoA admission tests. |
| `kovanica-node/tests/poa_node.rs` | ⚠️ **Mostly survives.** Only mentions hybrid in a doc comment (line ~7 "mirror the hybrid surface") and a reader-name comment (line ~217). Update the prose; keep every test. |
| `kovanica-node/tests/explorer_detail.rs` | ⚠️ One assertion on `kind == "staked"` (line ~74). Update; keep the rest. |
| `kovanica-ffi/tests/ffi.rs` | ~91 hybrid/stake/bond/validator references. Prune to the surviving FFI surface; regenerate bindings. |
| `kovanica-node/benches/node_hot_paths.rs` | Bench fixture describes "default (PoW, non-hybrid) configuration" (line ~103). Update the fixture comment/flags. |

**Consequence, stated plainly:** after this, a **non-authority can never produce
a block.** There is no permissionless path and no stake-weighted path. A bonded
validator with real capital has no more admission power than any other node.
See §0.5 for the governance framing.

#### 0.7.2 Authority-set governance — **mechanism settled, execution open**

**Decided (2026-09-25).** The authority set is **fixed at genesis** and can
**only ever be rotated by an on-chain M-of-N `AuthorityUpdateTx`** (RFC-POA §3:
the current `KVA1` Authority UTXO is spent and requires ≥ `t` signatures from
the *current* authorities). The mechanism is therefore no longer in doubt:

- **No election.**
- **No external randomness** (the epoch beacon does not select authorities).
- **No off-chain / maintainer-multisig path** that can change the set.
- **No hardcoded or scheduled rotation.**
- **No local-config change can alter the set on a running chain** — the genesis
  `KOVANICA_AUTHORITIES` override seeds the *genesis* set only; afterwards the
  chain is the sole authority on its own membership.

**Still `[OPEN]`** — these are the residual *inputs and execution* questions.
This document does not choose among any options for them, and no authority
identities, key material, thresholds, schedules or dates may be documented
anywhere until they are settled:

| # | `[OPEN]` residual | Why it matters |
|---|------------------|----------------|
| **1** | **How the initial mainnet authority set is chosen.** RFC-001 §1's 3–4 key launch set is a placeholder *size*, not a selection process. | A set chosen without a stated process is a set chosen by whoever was in the room. |
| **2** | **Who is eligible to join**, and on whose nomination. | Determines whether "authority" means operator, stakeholder, steward, or something else. |
| **3** | **The key ceremony for authority *signing* keys** — generation, custody, and multi-signing. **Distinct from the RFC-005 treasury vault keys** (`TREASURY_SEED_BASE`), which are unaffected by this decision. | Authority keys are consensus-critical: one key is one slot. Treasury vault keys guard funds; a compromised authority key rewrites chain order. |
| **4** | **Threshold `t` per set.** | `t` is the liveness/safety dial. Too high and a single lost key freezes the chain (§0.7.2 residual 5); too low and `t` colluders rotate the set unilaterally. |
| **5** | **Expansion from launch size toward the `n ≤ 16` cap** (RFC-POA §1). | n and t must move together or the threshold maths changes meaning. |
| **6** | **Dissolution / recovery if `t` authorities are lost or collude.** There is **no** on-chain recovery path in the current design. | A permissioned set with no recovery path is a single point of failure. This is the sharpest residual risk and should be closed before mainnet, not at mainnet. |

Note the tension worth stating out loud: the *mechanism* is settled and clean,
but a permissioned set whose **membership policy is undefined** is a launch
single-point-of-failure. §0.5's governance framing is only as good as residual
rows 1–6.

#### 0.7.3 `[OPEN]` — residual gaps

**Fact, not question (for the record).** No gap-fill means an offline
authority's slot produces **no block and therefore no coinbase**. Emission
*pace* is therefore directly coupled to authority liveness. Totals are
unaffected: the curve is height-indexed, so a skipped slot does not shift the
schedule or the cap, and MAX_SUPPLY 90.2M KVNC, s₀ 10 KVNC/block, era 2,050,000,
α 3/4, maturity 100 and the 75%/25% fee split all hold (§0.4).

**The open question is the policy, not the arithmetic:** whether coupling
emission to authority liveness is the *desired long-term* rule, or whether some
other distribution rule is wanted (e.g. rewards to the next scheduled authority,
or a non-emission slot subsidy). `[OPEN]` — do not assume the current behaviour
is the intended end state.

- **Permissionless entry — `[OPEN]`.** PoA-only removes the permissionless
  admission path (§0.5), and §0.7.1 removes the stake-weighted one. Whether
  Kovanica will *ever* offer any permissionless block admission again, and if so
  what, has not been said. See §0.1.1: restoring one would itself be
  consensus-breaking.

- **Future hybrid authority source: PoA signing + delegated pool — `[OPEN]`.**
  The PoA signing/verification layer (`try_produce_poa`, block validation) is
  already a pure consumer of an `AuthoritySet`. A future upgrade could replace
  the *source* of that set (currently: genesis + explicit `AuthorityUpdateTx`)
  with a **delegation-driven epoch selection** while keeping the signing logic
  identical. Three hybrid models were sketched (2026-09-26):
  - **Model A (Governance Core + Delegated Periphery)**: fixed core authorities
    (3–4 keys) + rotating delegated slots (e.g., 2–5 per epoch).
  - **Model B (Delegation with Governance Veto)**: fully permissionless pool,
    governance multisig can veto/replace a malicious selection.
  - **Model C (Phased Transition)**: start with pure PoA; add 2 delegated slots
    after 6–12 months; expand to 7 delegated + 1 emergency core; optionally
    full delegation later. Each phase is a separate hard fork with clear authority-
    set source swap.
  The PoA signing path never changes — only the authority-set source module.
  This is **not** on the current roadmap; it is recorded as an architectural
  option if governance later demands permissionless participation.

- **Removed-module fallout and the adversarial coverage gap — `[OPEN]`.**
  With PoW (§0.1) **and** hybrid (§0.7.1) both being removed, six test binaries
  have no target module left to test and are slated for deletion:

  | Suite | Kind |
  |-------|------|
  | `kovanica-node/tests/mining_api.rs` | mining API |
  | `kovanica-node/tests/mining_stress.rs` | mining stress |
  | `kovanica-node/tests/challenger_1_mining_adversarial.rs` | **adversarial consensus** |
  | `kovanica-node/tests/challenger_external_mining.rs` | **adversarial consensus** |
  | `kovanica-node/tests/challenger_e2e_mining_lifecycle.rs` | **adversarial consensus** |
  | `kovanica-state/tests/difficulty.rs` | difficulty/retarget |

  **The coverage gap this creates is the point, and it should not be waved
  through.** The `challenger_*` suites are this repository's adversarial
  *consensus* coverage — they attack mining as an entry vector. Deleting them
  alongside the mining path would leave **PoA with thinner adversarial coverage
  than PoW had**, at the exact moment admission becomes a small trusted key set
  (§0.5, §0.1.1). Mining-specific assertions obviously have nowhere to go, but
  the *harness* and the adversarial posture should carry over.

  **Recommendation (recorded, not implemented):** re-establish these as **PoA
  adversarial tests** covering authority misbehaviour —
  `wrong_producer` (a valid signature from an authority not scheduled for the
  slot), `double_sign` / slot violation, `stale_slot`,
  `missing_authority_sig`, `work_inflation` (work ≠ `POA_NOMINAL_WORK`, the
  §6.1(b) regression), and `authority_update_abuse` (a malformed, wrongly
  thresholded, or replayed `AuthorityUpdateTx`).

  `[OPEN]` — whether that work happens is a scheduling decision for whoever
  implements the removal. It is listed here because it is a **gate on the
  removal**, not a follow-up to it.

### 0.8 Downstream documents

Every document that mentions proof-of-work, `KOVANICA_POW`, hybrid admission or
difficulty carries a short note pointing here. Canonical list:

`AGENTS.md`, `protocol/AGENTS.md`, `protocol/docs/SPEC-INDEX.md`,
`protocol/docs/RUN-A-NODE.md`, `protocol/docs/TESTNET-RESET-POLICY.md`,
`protocol/docs/AUDIT-PLAN.md`, `protocol/docs/BUG-BOUNTY.md`,
`protocol/OPERATIONS.md`, `protocol/HOWTO_MINE.md` (superseded tombstone),
`protocol/HOWTO_GET_KVNC.md`, `protocol/TESTNET.md`,
`protocol/TESTNET-RFC006.md`, `protocol/README.md`, `protocol/TODO.md`,
`MASTER-ROADMAP.md`, `NETWORK.md`, `web/site/DEPLOY.md`, `node/README.md`,
`node/JOIN.md`, `node/TESTNET.md`, `sdk/COOKBOOK.md`, and the superseded hybrid
plans in `TODO/plans/RFC-008/`.

### 0.9 Phase 0 implementation record — what the removal actually left behind

Phase 0 deletes PoW, difficulty, VRF and hybrid admission from `kovanica-dag`,
`kovanica-state` and `kovanica-node`. Doing so surfaced five things the design
sections above do not cover. They are recorded here rather than fixed in
passing, because two of them are **blockers for any PoA genesis**, and one is a
policy decision this removal is not entitled to make.

> **Status: superseded in part.** B1, B2, B3 and B4 have since been implemented
> and are **no longer** outstanding blockers — see §0.9.1 for the evidence and
> for the security decision B1 was not entitled to make. The text below is kept
> as the original record of *why* each was a blocker. B5 was resolved in Phase 0.

**B1 — There is no way to give a node its authority signing key. `[BLOCKER → RESOLVED, see §0.9.1]`**

`Node::set_authority_signing_key` exists, but it has exactly three callers, all
of them test scaffolding: the two TESTNET-ONLY placeholder blocks in
`explorer.rs` (`genesis_node`, `restore_poa_policy`) and tests. There is **no**
env var, **no** RPC command and **no** CLI flag that feeds an operator's own
Ed25519 secret to the node. `KOVANICA_AUTHORITIES` carries only *public* keys.

Consequence: today, the only blocks the network can ever produce are placeholder
testnet blocks, signed with keys derived from the publicly known
`AUTHORITY_PLACEHOLDER_BASE = 9001`. A real authority operator cannot start a
producing node at all.

This is deliberately **not** fixed inside Phase 0. The obvious fix is an env var
like `KOVANICA_AUTHORITY_KEY`, but that means deciding *how a consensus signing
key enters a process* — and the standing rule is that seeds and private keys
stay client-side and never enter a node. Whether an authority key is exempt
from that rule (it is arguably a node-side consensus credential, like a miner's
key was), and if so whether it arrives by env var, interactive prompt, a
unattended secret mount, or an external signer, is a **design decision with
security weight** that must be made explicitly. `[OPEN]` — see §0.7.

**B2 — The line-RPC surface cannot start a PoA chain. `[BLOCKER → RESOLVED, see §0.9.1]`**

`rpc::execute_line`'s `genesis` command builds a non-PoA genesis. Since PoA is
the only admission regime (§0.1), `produce` on such a node always fails
`NodeError::NotAuthoritySlot`, and there is no `genesis_poa` or
`authority_key` command to replace it. So `kovanica-cli`/the REPL cannot run a
producing node.

The `mempool` integration suite was migrated off the RPC string surface onto the
`Node` API for this reason; its module doc says so. Adding `genesis_poa` is
mechanical, but it is blocked behind B1 — an operator still has nowhere to put
the key. `[OPEN]`

**B3 — No full-node path applies an `AuthorityUpdateTx`. `[BLOCKER → RESOLVED, see §0.9.1]`**

`apply_authority_update` exists only at `kovanica-state/src/spv.rs` (light
client). On a full node, `Ledger` receives an authority set exactly twice: at
genesis (`set_poa`) or from a snapshot. So the on-chain rotation that §0.7.2
and KVP-201 specify has no full-node implementation, and the authority set is in
practice immutable after genesis. Unchanged by Phase 0, re-recorded because
B1/B2 make it the third face of the same gap: **PoA has no operational
lifecycle yet.**

**B4 — The block reward is credited to `authority_sks[0]`, not to the signer. `[RESOLVED, see §0.9.1]`**

`produce_empty`/`produce_block` compute the coinbase recipient from
`authority_public_key()` — the *first* key pushed into the node — **before**
`try_produce_poa` resolves which authority is scheduled for the slot. For a
correctly configured operator node (exactly one key) the two coincide, so
production behaviour is right. But a node holding several keys — the testnet
placeholder convenience, or a future key-rotating operator — silently pays every
reward to whichever key happens to be first, regardless of who signed.

Not fixed here: choosing the reward rule (signer vs. first key) is a tokenomics
decision with supply-distribution consequences, so it is `[OPEN]`, not a
mechanical fix. It is recorded because it is the reason four `explorer`/`mempool`
assertions had to be restated from "founder" to "authority".

**B5 — No gossip-load test under PoA admission. `[RESOLVED IN PHASE 0]`**

Recorded as a possible gap when
`load_gossip_convergence::pow_mining_preserves_convergence` was deleted, then
closed in the same change: the whole suite's `genesis_node` helper was moved to
a PoA genesis with the full authority set installed, so `p2p.rs`,
`load_gossip_convergence.rs` and `relay.rs` now measure propagation, mempool
pressure and fork churn **with every block's authority signature verified on
every peer** — a stronger posture than the "no admission at all" mesh those
suites previously ran under.

Also deleted, without replacement (the subject does not exist under PoA):
`spv_sync::test_spv_difficulty_retarget_enforcement`,
`challenger_consensus_sync::{test_difficulty_retarget_pure_math_clamps,
test_spv_difficulty_upward_and_downward_clamps_boundary_rejections,
test_extreme_difficulty_oscillations_stress}`, and 7 whole binaries
(`mining_api`, `mining_stress`, `challenger_1_mining_adversarial`,
challenger_external_mining`, `challenger_e2e_mining_lifecycle`, `hybrid_node`,
`unbond_node`). The adversarial *harness* gap in §0.7.3 is **not** closed by
this and still stands.

Two further items were deliberately left alone, both consensus-adjacent and both
out of Phase 0's scope: the pre-existing two-decoder flag-1 disagreement in
`net.rs` (wire behaviour), and the remotely-triggerable overflow panic in the
asset registry.

### 0.9.1 B1–B4 status correction, and the gate-3 measurement gap

This subsection corrects §0.9 above, which was accurate when written but no
longer matches the tree. Nothing here changes a consensus rule.

**B1 — resolved.** The env var exists: `KOVANICA_AUTHORITY_KEY` is parsed as 64
hex chars (32 bytes) in `explorer.rs:287` and applied via
`node.set_authority_signing_key(key)` at `explorer.rs:1071`. There is also a
line-RPC `authority_key <64-hex>` command (`rpc.rs:155-163`), so a key can be
installed without an env var at all. `SEED1_POA_DEPLOYMENT.md` documents the env
var, and `examples/generate_authority_keys.rs` generates a set.

> **The decision §0.9 said Phase 0 was "not entitled to make" has been made, and
> is recorded here for ratification rather than quietly blessed.** Putting a
> *consensus signing key* into a node process sits against the standing rule that
> seeds and private keys stay client-side and never enter a node. The defensible
> reading is that an authority key is a node-side consensus credential (like a
> miner's key was), but that is a **security-policy call for the maintainers**,
> not a code detail. What follows is the threat model as implemented, so the
> call can be made deliberately:
>
> - The key enters via environment or a line-RPC command, so it is readable by
>   anything that can read the process environment or the unit file — on the
>   seed hosts, that means root.
> - It is held in memory for the life of the process.
> - **Anyone holding it can sign the blocks the network accepts as canonical.**
>   Loss is not a degradation, it is a chain stall, because production is
>   strict round-robin `authorities[slot % len]` and does not redistribute a lost
>   key's slots.
> - `generate_authority_keys` **on `main` today prints every secret to stdout**
>   (`hex::encode(sk.to_bytes())`), which puts the key into terminal scrollback,
>   any `tmux`/`screen` capture, and any CI log. PR #53 changes it to write one
>   `0600` file per authority so the key never has to pass through a shell or a
>   chat on its way into the unit. Until that merges, do not run the `main`
>   version for a real ceremony.
>
> Open questions this does **not** answer: whether an external signer should be
> supported instead; whether the env-var path should be refused on a
> multi-authority host; whether `KOVANICA_AUTHORITY_KEY` should be wiped from the
> environment after first use.

**B2 — resolved.** The line-RPC surface grew `genesis_poa <k> <subsidy> <amount>
<seed> <finality_depth> <slot_duration> <authorities...>` (`rpc.rs:30`), and
`authority_key` (above) closes the gap B2 was blocked behind.

**B3 — resolved.** `Node::apply_authority_update(&AuthorityUpdateTx)` exists
(`node.rs:983-990`, delegating to `Ledger::apply_authority_update`) and is
reachable from the line-RPC `authority_update <update-tx-hex>` command
(`rpc.rs:165-183`), which parses and validates the update before replacing the
set. On-chain authority rotation therefore has a full-node path.

**B4 — resolved.** `produce_block`/`produce_empty` now resolve the *scheduled*
authority for the slot and select the signing key by matching
`sk.verifying_key() == scheduled` (`node.rs:2049-2054` and `node.rs:2424-2431`),
instead of crediting `authority_sks[0]`. The coinbase recipient is the authority
that actually signed.

**B5 — resolved in Phase 0**, as originally recorded.

So the "three of the five items are blockers for any PoA genesis" claim in the
§0.9 preamble no longer holds: none of B1–B5 is an outstanding code blocker.
§0.10's consequences of B1 (FFI needs the public set; a wallet holding no
authority key is read-only under PoA) are **unchanged** — those follow from PoA
admission itself, not from B1's status.

**Gate 3 was reworded and closed on 2026-09-26 (option 1 below).** It originally
asked for a CPU/RAM-vs-PoW measurement. That comparison is no longer expressible:

- `1df0114` renamed `resource_profiling_poa_vs_pow` to
  `resource_profiling_poa_production` and deleted the PoW arm along with PoW.
- The test carried `#[ignore = "run manually for resource profiling"]` in
  **every** revision it ever existed (`f00c151`, `ddbe469`, `c5db750`,
  `1df0114`), so it never ran and **no PoW baseline figure was ever recorded
  anywhere in the history**.

Running what remains (`cargo test -p kovanica-node --release --test
poa_m6_testing -- --ignored --nocapture resource_profiling`) measures PoA in
isolation: **112.7 us/block, +7.4 KiB/block RSS** over 100 blocks. Its assertion
is `per_block_us < 50_000.0`, a loose tripwire against a reintroduced search
loop rather than a benchmark, so it cannot support an efficiency claim either.

**Decision: option 1, reword.** The gate is now a PoA resource-footprint
measurement with the figures above recorded as the baseline, and the
PoA-vs-PoW ratio is formally accepted as unrecoverable. Options 2 and 3 were
rejected: there is no pre-`1df0114` tag carrying a two-armed test that ever
passed, and retiring the gate outright would have dropped a real footgun
tripwire along with the unrecoverable comparison.

**What this bar is and is not.** It is a *regression* bar: it catches a
reintroduced search loop, an accidentally quadratic path, or a leaked per-block
allocation. It is **not** an efficiency claim, and it no longer says anything
about PoA being cheaper than PoW — that is a design assertion now, not a
measured result. Anyone citing a PoA-vs-PoW number in future must say it is
unmeasured.

The test remains `#[ignore]`d because it writes wallet key files and is a
manual profiling run, not a unit test; the Rust gate in
`.github/workflows/rust-gate.yml` therefore does not execute it. The recorded
figures came from a deliberate manual run.

### 0.10 Phase 0, `kovanica-ffi`: what the wallet surface lost

Removing the staking/mining API from `LightNode` forced three decisions that the
core-crate removal did not, recorded here because two of them are consequences of
B1 rather than independent problems.

**The FFI now needs the authority set to be safe, and it must be *public*
keys.** `LightConfig` gained `authority_public_keys` (hex Ed25519 public keys),
`authority_threshold` and `slot_duration_ms`, and the genesis moved from
`genesis_with_finality` to `genesis_with_poa`. This is not optional: a light
node that cannot name the authority set cannot verify the authority signature on
any block it accepts, and would be trusting whichever peer served it. The
authority set is hashed into the genesis coinbase, so it is part of the chain
identity — a node built with a different set derives a different genesis id and
will not accept the network's blocks. `LightNode::new` now **fails closed** on
an empty set rather than booting a node that admits anything.
`load_snapshot` correspondingly takes the config again: a snapshot stores the
ledger but not the admission config, the same contract as the full node's
`restore_poa_policy`.

**A wallet cannot seal anything, which is B1 reaching the mobile surface.**
Every FFI method that seals a transaction (`send`, `send_asset`, `send_from`,
`send_from_asset`, `send_to_script_v2`, `send_to_stealth`, the HTLC helpers)
inserts a block immediately, and under PoA only the scheduled authority can do
that. With no authority key held — the correct state for a wallet — they fail
with `NodeError::NotAuthoritySlot`. That is a clean, honest refusal, not a
silent no-op, and there is no PoW target left to fall back to. But it does mean
the mobile wallet is currently **read-only**: it syncs, verifies, watches,
queries and proves, and cannot originate a confirmed transaction. Resolving
this is the same B1 decision, applied to a phone. The proper end state is not
"give the wallet an authority key" but a broadcast-only wallet that submits to
an authority network and polls for inclusion — which is Phase 4's SPV wallet,
and is why Phase 4 is not optional.

`set_authority_key_for_tests` exists so the FFI test suite can drive production
at all. It is deliberately **outside `#[uniffi::export]`**, so no mobile caller
can reach it, and it is a test fixture — it does **not** resolve B1, which is
about how an *operator's* secret enters a *running node*.

**A real bug the FFI work surfaced: two send paths minted unsigned blocks.**
`Node::send_to_script_v2` and `Node::send_to_stealth` called `ledger.insert`
directly instead of the PoA-aware `insert_immediate_block` used by every other
immediate-send path. Under PoA the resulting block has no authority signature
and the DAG rejects it — so RFC-003 script-v2 and stealth sends were
*unconditionally broken* the moment PoA became the only admission regime, and
both are FFI-exported. Fixed in the same change by routing them through
`insert_immediate_block`. This was missed by the core-crate removal because
nothing in `kovanica-dag`/`kovanica-state`/`kovanica-node`'s own test suites
exercised those two paths under a PoA genesis; only the FFI's
`send_to_script_v2_and_stealth_over_ffi` test did. Worth noting as a coverage
lesson: the PoA adversarial suites must reach the *client* surfaces too, not
just the DAG.

**`BlockKind` is deleted.** It had exactly two variants, `Pow` and `Staked`, both
of which name an admission path that no longer exists, and `BlockInfo` no longer
carries a `kind` field. What remains to pin is the work invariant — every PoA
block claims `POA_NOMINAL_WORK = 1`, because admission is by signature and not by
meeting a target — which is now asserted directly instead.

---

## Motivation
- **Operational simplicity:** No mining hardware, no VRF key management for validators, deterministic block times (~3s slots).
- **Resource efficiency:** Near-zero CPU/RAM for block production; validators sign one Ed25519 signature per slot.
- **Deterministic finality:** Slot-based scheduling + GHOSTDAG k=3 gives predictable confirmation times.
- **Governance readiness:** On-chain authority set updates via threshold-signed AuthorityUpdateTx (KVP-201).
- **SPV compatibility:** Authority signatures replace PoW checks; light clients need only genesis authority set + update proofs.

---

## Specification

### 1. Authority Set (KVP-201)
- **On-chain representation:** Single live "Authority UTXO" (tag `KVA1` || `authority_set_hash`).
- **Contents:** 3–4 Ed25519 public keys (`authorities`), threshold `t` (2 ≤ t ≤ n, n ≤ 16).
- **Canonical order:** keys are sorted ascending by their 32-byte encoding. The set's
  identity and its slot schedule are therefore properties of *which* keys are in the set,
  never of the order an operator listed them in local config.
- **Genesis:** First Authority UTXO created in genesis block (coinbase output with tag `KVA1`).
- **Update:** `AuthorityUpdateTx` spends current Authority UTXO, requires ≥t distinct signatures from current authorities, creates new Authority UTXO with new set (3–4 keys, n ≤ 16).
- **Maturity:** Authority UTXO spends are subject to 100-block maturity (RFC-005 vault/CSV).

### 2. Block Structure Changes
- **New field:** `authority_sig: [u8; 64]` (Ed25519 signature over `block.hash_without_authority_sig()`).
- **Preserved fields:** `nonce`, `work`, `timestamp_ms`, `parents`, `payload`, `vrf_*` (for wire compatibility). `work` is **pinned to the nominal value `POA_NOMINAL_WORK = 1`** at admission (§4.5), so it is present on the wire and in the hash but carries no weight in chain selection. `vrf_*` is ignored under PoA.
- **Hash:** `block.id()` = BLAKE3(`parents` || `work` || `timestamp_ms` || `nonce` || `payload` || `authority_sig`).

### 3. Slot & Scheduling
- **Slot duration:** `SLOT_DURATION_MS = 3000` (configurable via `KOVANICA_SLOT_DURATION`).
- **Slot number:** `slot = timestamp_ms / SLOT_DURATION_MS`.
- **Active authority:** `authorities[slot % authorities.len()]`, over the canonical order
  defined in §1.
- **Slot consistency:** Block's `timestamp_ms` must fall within its claimed slot; `slot` must be ≥ parent slots.

### 4. Block Validation (replaces PoW/VRF checks)
1. **Structural:** Parents exist, non-empty, no duplicates, timestamp ≥ all parents.
2. **Authority signature:** Verify `authority_sig` against `active_authority(slot).public_key` over `hash_without_authority_sig()`.
3. **Slot consistency:** `slot == timestamp_ms / SLOT_DURATION_MS`; `slot ≥ parent_slots`.
4. **GHOSTDAG:** Compute selected parent, mergeset, blue/red coloring (k=3 unchanged).
5. **Nominal work:** `block.work() == POA_NOMINAL_WORK` (1). Reject otherwise
   (`DagError::PoaWorkMismatch`). `work` is not a proof under PoA, but the
   GHOSTDAG blue-work fold still consumes it, so an unpinned value would let a
   single authority steer the selected parent of every successor by claiming
   arbitrary weight. Pinning it at admission is what makes accumulated blue
   work a plain block count — see §6.1(b).
6. **Transaction validation:** UTXO, signatures, conservation, RFC-001..005 rules (unchanged).

### 5. GHOSTDAG & Consensus (unchanged)
- k=3, blue score/work drive chain selection. Under PoA the work term is
  nominal by construction (§4.5), so selection reduces to blue score plus a
  constant per block.
- Linearization: `order(B) = order(sp) ++ mergeset ++ [B]`.
- Finality: `finality_depth` blue-score depth (default 50, RFC-008).
- Pruning: payload + block pruning per RFC-008 (unchanged).

### 6. SPV / Light Clients
- **Header:** Add `authority_sig` (64 bytes) to block header.
- **Verification:** Check authority signature against known authority set for the slot.
- **Authority set sync:** Genesis includes initial authority set hash; `AuthorityUpdateTx` provides update proofs (Merkle path to Authority UTXO).
- **Finality:** Blue-score depth unchanged; light clients wait for `finality_depth` blue blocks.

### 7. Configuration & Feature Flags
- **Cargo features:** `poa` (default), `pow-vrf` (opt-in for legacy/test).
- **Env vars:**
  - `KOVANICA_CONSENSUS=poa|pow` (default `poa`)
  - `KOVANICA_SLOT_DURATION=3000` (ms)
  - `KOVANICA_AUTHORITIES=<hex_pk1>,<hex_pk2>,...` (genesis override)
  - `KOVANICA_AUTHORITY_THRESHOLD=<t>` (genesis override)
- **Genesis TOML:**
  ```toml
  [consensus]
  mode = "poa"
  slot_duration_ms = 3000
  [authority]
  keys = ["<hex_pk1>", "<hex_pk2>", "<hex_pk3>"]
  threshold = 2
  ```

### 7. Wire Format & Compatibility
- **Block encoding:** `authority_sig` appended after `nonce` (flag byte: 0 = none, 1 = present + 64 bytes).
- **Legacy blocks:** `insert` strips `authority_sig` when `hybrid=None` (replay compatibility).
- **Snapshot/checkpoint:** v6+ includes `authority_sig`; legacy readers strip it.

---

## Backwards Compatibility
- **Consensus-breaking:** Yes (hard fork). Requires coordinated upgrade at activation height.
- **Activation requires a genesis reset; PoA must not be enabled on a live PoW
  chain.** The nominal-work pin (§4 item 5) is a chain-format constraint, not a
  runtime toggle. Turning PoA on for a chain that already contains PoW blocks
  leaves a mixed-work history: pre-activation blocks carry real work (orders of
  magnitude above 1) and out-compete every PoA block, so the selected parent
  would never advance past the activation point and the chain would appear
  frozen. Activation therefore needs a genesis reset (or an explicit
  work-normalising migration), consistent with `TESTNET-RESET-POLICY.md` §1.
  Replay (`Dag::insert_for_replay`) and snapshot restore skip the check, so
  restoring a pre-pin PoA snapshot is safe.
- **RPC/API:** New `authority_sig` field in block JSON; `staking` RPC reports authority set.
- **Explorer:** Shows authority signature, slot, active authority.
- **Wallet/CLI:** No changes to transaction signing. ~~Block production uses `produce_block` (staked path).~~ `[TARGET]`-obsolete: the staked path is removed with hybrid (§0.7.1); block production is the authority slot path only.

---

## Open Questions

The decisions that follow from the PoA-only ratification are recorded in
**§0.7**, which is the canonical list. Note the split:

- **§0.7.1 is DECIDED** — hybrid / staked-VRF admission is dropped entirely.
  Do not re-open it, and do not implement a "secondary tier" reading of it.
- **§0.7.2's mechanism is DECIDED** — genesis-fixed set, rotation only by
  on-chain M-of-N `AuthorityUpdateTx`. Its six *residual* rows (initial set
  choice, eligibility, key ceremony, threshold, expansion, dissolution) remain
  `[OPEN]`.
- **§0.7.3 remains `[OPEN]`** — adversarial coverage replacement, the
  emission-vs-liveness policy, and whether permissionless entry ever returns.

Do not resolve any of these here or elsewhere in the docs by implication. PoW
removal is itself `[TARGET]`-settled, which moots the old `pow-vrf` fallback
question below.

Residual PoA-*design* questions, still open and not covered by §0.7:

1. **Slot duration:** 3s default; should it be configurable per-network?
   (Shipped as `KOVANICA_SLOT_DURATION`; the per-network policy is unset.)
2. **Authority set size:** 3–4 for launch; governance process for expansion to
   16? — *mechanism is specified in §1 (n ≤ 16); the governance policy is
   `[OPEN]` per §0.7.2 residual 5.*
3. **Activation:** Coordinated flag day vs. on-chain signaling (BIP-9 style)?
   Partly pre-empted by §0.6: PoA activation requires a genesis reset, so there
   is no chain to signal on.
4. **Fallback:** *`[TARGET]`-settled* — the `pow` / `pow-vrf` features are
   removed under §0.1; `KOVANICA_CONSENSUS=pow` is transitional only. Note
   §0.1.1: there is no path back.
5. **SPV proofs:** Authority set Merkle proofs vs. full UTXO path for update
   verification? (M4 shipped the Merkle-proof path; whether the full-UTXO
   variant is also retained is undecided.)

---

## Implementation Plan (Milestones)

| Milestone | Deliverable | Exit Criteria |
|-----------|-------------|---------------|
| M1: Core Types ✅ | `AuthoritySet`, `AuthorityUpdateTx`, `Block.authority_sig`, `hash_without_authority_sig()` | Unit tests: sig verify, slot active authority, update tx validation — **done** (`crates/kovanica-dag/src/authority.rs`, 21 tests; snapshot v7 + checkpoint v9 carry the sig; live-parity tests `#[ignore]`d pending the PoA reset) |
| M2: Consensus ✅ | `BlockValidator` authority/slot check in `Dag::insert`; `Dag::insert_for_replay` skips PoW/VRF | Integration: 3-validator round-robin, 4-validator liveness (1 offline), re-org under GHOSTDAG — **done** (`Dag::set_poa` first-class switch + `check_poa` in `dag.rs`; `insert_for_replay` now skips PoW/difficulty/VRF/PoA; `tests/poa.rs`, 11 tests incl. the `POA_NOMINAL_WORK` inflation pin, §6.1(b)) |
| M3: Config/Genesis ✅ | `KOVANICA_CONSENSUS`, `KOVANICA_SLOT_DURATION`, `KOVANICA_AUTHORITIES`, genesis TOML | Genesis block carries authority set; `poa` feature default — **done** (`poa_config_from_env` + `PoaGenesisConfig` in `explorer.rs`; `genesis_with_poa` commits `KVA1 \|\| set_hash`; node PoA production via `try_produce_poa`/`set_authority_signing_key`; wire `BlockRecord.authority_sig` flag byte 2; PoA-aware immediate sends; `load_log_with_poa*` readers; `tests/poa_node.rs` incl. log round-trip, 9 tests) |
| M4: SPV ✅ | Header `authority_sig`; light client authority set sync + update proofs | Light client syncs from genesis, verifies authority sigs, processes update tx — **done** (`BlockHeader` gains `authority_sig` / `authority_set_hash` / `hash_without_authority_sig`; `SpvClient::with_poa` + `add_header` verify the scheduled authority per slot; `apply_authority_update` validates an `AuthorityUpdateTx` + Merkle proof; KVLS v2 blob carries the PoA config; relay `Headers` message encodes the PoA fields; FFI `export_light_sync` v2 / `receive_light_sync` / `apply_authority_update`. Live-parity tests `#[ignore]`d pending the PoA reset) |
| M5: RPC/Explorer ✅ | `staking` RPC; explorer shows authority sig, slot, active authority | Explorer displays authority set, slot, signatures — **done** (`block_detail_json` emits `authority_sig` / `slot` / `active_authority`; `kind` gains `poa` alongside `pow`/`staked`; `staking` RPC reports `slot_duration`, `authorities`, `threshold`; `blockCard` HTML renders the three fields) |
| M6: Testing 🟡 | 3-validator soak (24h), authority update, re-org, SPV, resource (CPU/RAM vs PoW) | **Code suite done, operational gates outstanding** — `tests/poa_m6_testing.rs`: authority update + SPV update proof, GHOSTDAG k=3 re-org, SPV sync over the post-re-org chain (3 tests green, `resource_profiling_poa_production` `#[ignore]`d — renamed from `..._poa_vs_pow` in `1df0114`, which deleted the PoW arm). Still to do before activation: the 24h multi-validator testnet soak and the resource measurement. The soak is straightforwardly outstanding; the measurement is **blocked on a decision, not on work** — the vs-PoW comparison it originally meant is unrecoverable, see §0.9.1 and §0.6.2 gate 3 |

### 6.1 Consensus invariants hardened during M6

Two defects were found while bringing the M6 suite green. Both are
pre-activation, so fixing them now avoids a hard fork later.

**(a) Canonical authority order (`AuthoritySet::new`).** The key list reaches
the node from local config (`KOVANICA_AUTHORITIES`, a comma-separated string),
not from the chain — but `AuthoritySet` stored the keys in the order the
operator supplied them, and both consensus-relevant derivations used that
order: `hash()` (the `KVA1` commitment) and `active_authority(slot)` (the
round-robin). Two nodes holding the same keys in a different order would
therefore compute **different set hashes** → different genesis `KVA1` outputs →
different genesis block ids, i.e. **different chains**; and schedule a
*different* authority per slot → rejecting each other's valid blocks as
`InvalidAuthoritySignature`, halting the chain. `AuthoritySet::new` now sorts
the keys by their 32-byte encoding, so both derivations depend only on *which*
keys are in the set. Guarded by `authority_set_hash_is_permutation_invariant`
and `active_authority_is_permutation_invariant`. This changes the set hash, so
it must land before any PoA genesis is committed.

**(b) RESOLVED — `work` is now pinned to the nominal value under PoA.** §2
claimed `work` was "preserved … for wire compatibility; ignored under PoA", but
`Dag::set_poa` only cleared `require_pow` and `difficulty`; nothing constrained
`work`, and `compute_ghostdag` still accumulates `block.work()` into `blue_work`,
which drives selected-parent choice. An authority could mint an arbitrarily
large `work` and unilaterally capture chain selection — and the M6 re-org test
*relied* on that by forging `work = 2`, so the suite encoded the exploit as
expected behaviour.

Fixed by pinning `work` at admission, mirroring the hybrid path's
`HybridConfig::stake_nominal_work`: `POA_NOMINAL_WORK = 1`
(`kovanica_dag::POA_NOMINAL_WORK`), enforced in `Dag::check_poa` as
`DagError::PoaWorkMismatch { id, expected, actual }`. Because the check runs at
insertion, every block in the DAG provably has nominal work, so accumulated
blue work is a plain block count and **no change to the GHOSTDAG fold is
needed** — the property is established at the admission boundary instead.

`POA_NOMINAL_WORK` is a constant, not a `PoAConfig` field: unlike a staked
block competing against real PoW blocks, there is nothing to tune, since PoA
blocks are one-per-slot and all carry equal weight by construction.

> **Note (2026-09-25):** the hybrid reference above is now historical. Hybrid
> is being removed entirely (§0.7.1), so `HybridConfig::stake_nominal_work`
> goes with it. **`POA_NOMINAL_WORK` stays** — it is an independent dag-level
> constant, not a field of `HybridConfig`, and removing the wrong one would
> reintroduce exactly the exploit this section fixed.

Two corollaries, both now enforced rather than documented:

- **The M6 re-org tests no longer forge work.** `poa_reorg_ghostdag_k3` and
  `spv_sync_under_poa_reorg` built their competing branch at `work = 2`. At
  nominal work a competing branch wins purely by being **longer** — the test
  branch ends at depth 13 against the incumbent's 10 — so both re-org paths are
  now exercised through the rule that actually governs them, with no forged
  weight. The node's `receive_block` path surfaced the second forgery as a
  `PoaWorkMismatch` rejection, confirming the pin holds end-to-end at the
  wire boundary, not just in `Dag`.
- **Genesis and honest production already complied.** `Block::genesis(1, …)`
  and `Node::try_produce_poa` both already emit `work = 1`, so the pin changed
  no legitimate block id. Every PoA producer in the workspace was already
  nominal; the only deviations were the two adversarial tests.

Regression test: `inflated_work_is_rejected_under_poa` — each of
`work ∈ {0, 2, 1_000_000, u128::MAX}` is signed *correctly* by the authority
scheduled for its slot (so the signature is genuinely valid; `work` is inside
the signed hash), and each must be rejected while `POA_NOMINAL_WORK` is still
admitted. Verified to fail against the pre-fix code.

---

## References
- `/root/kovanica-poa-migration/01-RFC-POA.md` (KVP-201)
- `/root/kovanica-poa-migration/02-AUTHORITY-SET.md`
- `/root/kovanica-poa-migration/03-MIGRATION-GUIDE.md`
- `/root/kovanica-poa-migration/04-BLOCK-VALIDATION.md`
- `/root/kovanica-poa-migration/05-SPV-COMPATIBILITY.md`
- `/root/kovanica-poa-migration/06-CONFIG-AND-FLAGS.md`
- `/root/kovanica-poa-migration/07-TESTING-PLAN.md`
- `protocol/docs/RFC-006-Tokenomics.md` (MAX_SUPPLY, maturity, fee burn)
- `protocol/docs/RFC-001..005.md` (shipped features preserved)