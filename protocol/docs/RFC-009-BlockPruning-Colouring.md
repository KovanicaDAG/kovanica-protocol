# RFC-009 — Block Pruning Corrupts GHOSTDAG Colouring (F1)

**Status:** Draft / Stage-3 — not shipped. Promotion to any other status is a
governance decision, not an authoring one.

**Consensus impact:** **consensus-critical (consensus-unsafe as currently
implemented).** Block pruning, as wired by RFC-008, can change the GHOSTDAG
colouring of a block that is inserted *after* an eviction, and therefore its
`blue_score` / `mergeset_blues` / linearization / UTXO — a chain split. The
interim mitigation described below is operational (client/ops); it restores
correctness by *not running the unsound consensus path*, and does not make the
path itself sound.

**One-line summary:** Evicting a block leaves its id inside the
`GhostdagData.blue_anticone_sizes` maps retained on surviving blocks, so
`Dag::in_anticone` returns `true` for an evicted block that is a **true
ancestor** of a later candidate; every later merging block then sees phantom
anticone blues and is forced red. This RFC records the defect (F1), the adopted
interim mitigation (block pruning disabled network-wide; replay bounded
operationally), and the acceptance criteria for the real consensus redesign.

> ⚠️ **This blocks the testnet reset.** The pending reset must not run
> block-pruning code. Until the interim mitigation is deployed to every seed,
> a reset chain can diverge at the first fork past the pruning point. See
> `TESTNET-RESET-POLICY.md` and `../TASKLIST2.md` §2.5.

---

## Motivation

**Layer:** consensus-critical.

RFC-008 wired the DAG core's existing block-pruning depth through `Ledger` →
`Node` → the explorer `NetworkProfile`, so the reachability oracle's memory
would be bounded by the crown width instead of growing with the chain. It
classified the change as **consensus-safe**. That classification is wrong: the
oracle is not the only consumer of the pruned block ids. The GHOSTDAG colouring
also consults them.

### The mechanism (F1)

1. `GhostdagData.blue_anticone_sizes: HashMap<BlockId, KParam>`
   (`crates/kovanica-dag/src/dag.rs:228`) holds one entry per blue block in a
   block's blue set. `Dag::compute_ghostdag` seeds a new block's map by cloning
   the selected parent's entire map, so it accumulates the whole selected chain
   — O(depth) per retained block, O(N²) across the DAG.
2. `Dag::remove_blocks(&mut self, evicted: &HashSet<BlockId>)`
   (`crates/kovanica-dag/src/dag.rs:661-667`) does only
   `self.reach.remove_blocks(self.genesis, evicted)` and then removes evicted
   ids from `self.nodes` and `self.tips`. It **never strips evicted ids from the
   `blue_anticone_sizes` maps retained on surviving blocks.**
3. `Dag::try_colour_blue` (`crates/kovanica-dag/src/ghostdag.rs`, ~lines
   105-129) iterates **every key** of that map and calls
   `self.in_anticone(&blue, candidate)` to count anticone blues against the k=3
   limit.
4. `Dag::in_anticone` (`crates/kovanica-dag/src/dag.rs:746`) is
   `a != b && !is_ancestor(a,b) && !is_ancestor(b,a)`. `Reachability::is_ancestor`
   (`crates/kovanica-dag/src/reachability.rs:466-478`) returns **false for an
   absent id in both directions** (`tree_reaches` is false and
   `fcs.get(evicted)` is `None`).
5. **Therefore, for an evicted block that is a TRUE ANCESTOR of a later
   candidate, `in_anticone` wrongly returns `true`.** Every later merging
   candidate then sees O(|past(P)|) phantom anticone blues and is forced red
   instead of blue.

### Reproduction (differential test, `block_pruning_depth = 3`)

Construction: a 20-block chain c1..c20; a side block S on c18; n = [c20, S];
then set block pruning depth 3; x = [c20] triggers the prune; then the later
block m = [n, x]. Observed:

```
UNPRUNED m: blue_score=24 blues=1 reds=0
PRUNED   m: blue_score=23 blues=0 reds=1
pruned dag len=6 ; ref dag len=25 ; is_ancestor(c20,x)=true in both
```

The same block gets a different colouring with pruning on versus off. That
divergence propagates to `blue_score` / `mergeset_blues` / linearization / UTXO
and is a chain split. Note the prune did run: dag length went 25 → 6.

### Why it is latent today

The current testnet chain is ~645 blue score and `TESTNET_BLOCK_PRUNING_DEPTH`
was 1000, so `pruning_point()` is still genesis and nothing is evicted. F1
starts biting once the chain passes ~1000 blue **with any fork**. The existing
`adversarial_wide_fork_pruning` test misses it because it only asserts block
presence/size and never inserts a *merging* block after an eviction.

### What RFC-008 got wrong

RFC-008 §"Consensus impact" (lines 115-122) asserts: *"Reachability answers
unchanged for present blocks. The oracle never inspects evicted blocks: …
`is_ancestor`, `in_anticone`, `mergeset_ordered`, and the GHOSTDAG colouring
produce identical results for all non-final blocks with pruning on or off."*
The last sentence is **false** — the oracle is not the only consumer;
`blue_anticone_sizes` is. RFC-008's **Test plan item 1** was exactly the
differential parity test that would have caught this ("build the same DAG with
pruning on vs off; assert `is_ancestor`, `in_anticone`, `mergeset_ordered`, and
the GHOSTDAG colouring are identical for every non-final block") and it was
never implemented. RFC-008's **Open question 2** considered FCS cross-references
but never `blue_anticone_sizes`. RFC-008 should be moved out of
"consensus-safe" status; this RFC proposes marking it *Draft — corrected by
RFC-009*.

## Specification

**Layer:** mixed — the defect and the required fix are **consensus-critical**;
the adopted interim mitigation is **client/ops** (it changes node policy, not
the consensus rules, and it works by disabling the unsound path).

### 1. Defect statement (F1) — consensus-critical

Block pruning is **unsound** as shipped by RFC-008. `Dag::remove_blocks` must
leave the colouring state of every surviving block consistent with the block's
blue set; today it does not, because evicted ids persist in
`blue_anticone_sizes` and `is_ancestor` answers `false` for absent ids in both
directions. Any node that evicts a block can colour a later block differently
from a node that did not. This is a consensus divergence, not a memory
optimisation.

**Attempted fix, insufficient.** Stripping evicted ids from the retained maps
(`node.ghostdag.blue_anticone_sizes.retain(|id,_| !evicted.contains(id))` in
`remove_blocks`) does restore the unpruned `blue_score`, but it violates the
load-bearing invariant asserted at `ghostdag.rs:77` —
`debug_assert_eq!(blue_anticone_sizes.len() as u64, blue_score, "blue anticone
map must cover exactly the blue set")` — and fails 4 existing tests:
`insert_rejects_builds_on_pruned_history`,
`insert_with_block_pruning_automatically_prunes`, `pruning_point_moves_forward`,
`snapshot_roundtrip_with_pruned_blocks`. The map genuinely must cover the whole
blue set; bounding it requires reworking the k-cluster evaluation so it does not
need the full historical blue map (Kaspa-style), which is a consensus redesign.

### 2. Adopted interim mitigation — client/ops

These changes are **implemented** and are the reason the defect is currently
inert. They are operational: they do not fix F1, they prevent the unsound code
from running and bound the resulting replay memory.

**(a) Disable block pruning everywhere.** `block_pruning_depth = u64::MAX` for
testnet, devnet **and** mainnet. Implemented in
`crates/kovanica-node/src/explorer.rs`: the profile const was renamed
`TESTNET_BLOCK_PRUNING_DEPTH` → `BLOCK_PRUNING_DEPTH` and set to `u64::MAX`; all
three `NetworkProfile`s use it. `u64::MAX` is propagated intact through
`Ledger::apply_block_pruning_depth` (`crates/kovanica-state/src/ledger.rs:2466-2471`,
which only ever clamps *up* to `finality_depth`), so `prune_old_blocks`
early-returns and no eviction can occur. This restores correctness at the cost
of replay/live memory growth (the O(N²) map is retained again).

**(b) Bound replay operationally** so the memory cost cannot OOM-loop a seed:

- A **pre-flight estimate** in the `LoadTier::Log` branch refuses a log
  projected to exceed the memory limit, with actionable guidance (restore from a
  snapshot, or wipe + resync). Consts `REPLAY_PEAK_BYTES_PER_RECORD_SQ = 30` and
  `REPLAY_MEAN_RECORD_BYTES = 296`; fn `estimate_replay_peak_bytes(log_bytes) =
  (log_bytes/296)² × 30` (saturating). Verified: the real 13.5 MB log under a
  4 GiB cap refuses with `projected replay peak is ~59569 MiB but the memory
  limit is 4096 MiB` and exits 1 without growing memory; a 1000-record log loads
  and serves normally.
- A **`replay-watchdog`** thread that samples RSS every 10 s during replay,
  publishes the `kovanica_replay_rss_bytes` gauge, logs progress, and `abort()`s
  with a named diagnostic at 90% of the cgroup/host ceiling instead of being
  silently OOM-killed. Verified with teeth (fired at 3740 MiB vs a 3686 MiB
  ceiling, exit 134 = SIGABRT).

**(c) Regression test committed but `#[ignore]`d** until F1 is fixed:
`crates/kovanica-dag/tests/block_pruning_colouring.rs::block_pruning_preserves_colouring`.

**Why this is not a consensus fix.** The mitigation changes no consensus rule
and adds no rejection surface; it only stops the node from invoking
`Dag::remove_blocks` on a live chain. A node running the mitigation and a node
with block pruning genuinely off behave identically. The defect remains in the
tree and re-activates the moment `block_pruning_depth` is set below `u64::MAX`.

### 3. Required future work — consensus-critical

A consensus redesign of the k-cluster / blue-anticone bookkeeping so that
colouring does not depend on a full historical blue map — i.e. block eviction
becomes sound again and memory returns to O(finality window). This RFC records
the requirements and constraints; it does **not** prescribe a full
implementation.

**Requirements.**

- **R1 — Bounded bookkeeping.** Colouring must not require the full historical
  blue map per retained block. Per-block colouring state must be bounded by the
  finality/pruning window, not the chain length.
- **R2 — Exact GHOSTDAG k=3 semantics.** The redesign must preserve GHOSTDAG
  k=3 semantics exactly: selected parent, mergeset, blue/red set, `blue_score`,
  `blue_work`, and linearization must be identical to an unpruned DAG for every
  non-final block.
- **R3 — Invariant handled deliberately.** Either keep
  `blue_anticone_sizes.len() == blue_score` (asserted at `ghostdag.rs:77`) or
  replace that invariant with a documented, tested alternative. Do not silently
  relax or delete it.
- **R4 — Differential-testable.** The redesign must be testable against
  unpruned colouring: the same DAG built with pruning on vs off must produce
  identical `is_ancestor`, `in_anticone`, `mergeset_ordered`, and GHOSTDAG
  colouring for every non-final block (this is RFC-008 Test plan item 1,
  promoted to a release gate).
- **R5 — Sound eviction.** `Dag::remove_blocks` must leave every surviving
  block's colouring state consistent: either strip evicted ids and maintain a
  valid invariant, or make colouring not consult historical ids at all.
- **R6 — Memory bound restored.** After the fix, block pruning at depth `D`
  must bound retained colouring state to ~O(D × width), not O(chain_length ×
  width); the O(N²) map must not be retained on live blocks.
- **R7 — Rejection equivalence preserved.** `BuildsOnPrunedHistory` must fire
  exactly where the ledger's finality check would already reject
  (RFC-008 Test plan item 2), so a pruning node and a non-pruning node accept
  the same blocks.
- **R8 — Load paths guarded.** No replay/snapshot/checkpoint path may re-enable
  block pruning until R1–R7 hold. The snapshot tier's policy handling (see Open
  question 4) must be resolved in the same change.

**Constraints.**

- Must not change RFC-006 constants: MAX_SUPPLY **90.2M KVNC**
  (`9_020_000_000_000_000` atoms), maturity **100 blocks**, fee split
  **75% burned / 25% to producer**, subsidy curve, GHOSTDAG **k=3**.
- Determinism: the colouring iterates a `HashMap` but its outcome must remain
  order-independent; tie-breaks fall back to `BlockId` byte order.
- Prefer no wire-format or checkpoint-format bump; if one is unavoidable it must
  be versioned and documented.

## Consensus impact

**Layer:** consensus-critical.

- **The defect is a consensus bug.** Two honest nodes with different pruning
  settings (or different eviction timing) can compute different `blue_score` /
  `mergeset_blues` for the same block, hence different linearizations and UTXO
  views. That is a chain split.
- **The mitigation is not a consensus change.** Disabling block pruning removes
  no rule and adds no rejection surface; it restores the pre-RFC-008 behaviour
  (no eviction) so every node colours identically. The memory cost is the
  O(N²) map, which is why replay must be bounded operationally (client/ops).
- **Correction to RFC-008.** RFC-008's "consensus-safe" classification and its
  §"Consensus impact" line 115-122 claim are wrong. RFC-008 should be revised
  out of "consensus-safe" status. Its Test plan item 1 (differential parity)
  and Open question 2 (FCS cross-references) were the right instruments and must
  now be implemented, extended to `blue_anticone_sizes`.
- **Reset blocker.** The testnet reset must not run block-pruning code. The
  reset is blocked until the interim mitigation (block pruning disabled at
  `u64::MAX`) is deployed to every seed that will run the reset chain.

## Backwards compatibility

**Layer:** consensus-critical for the rule change; client-only for the policy
plumbing.

- **Wire format: unchanged.** Block records are identical; pruning is a
  retention policy.
- **Snapshot / checkpoint format: unchanged.** Pruned blocks already encode as
  stubs (`Block::new_pruned`); load reconstructs them. No format bump.
- **Replay log format: unchanged.** `block_pruning_depth` is policy, re-applied
  on load. With the mitigation, the applied value is `u64::MAX`, so no eviction
  occurs on replay.
- **Mixed-version network: no fork under the mitigation.** Pre-RFC-008 nodes
  (pruning off) and mitigated nodes (pruning effectively off) accept the same
  blocks and colour identically. A node running RFC-008 with a finite
  `block_pruning_depth` is unsafe and must not be run.
- **RFC-006 constants are untouched:** k=3, MAX_SUPPLY 90.2M KVNC, maturity
  100, fee split 75/25, subsidy curve — none of this RFC's mechanics interact
  with tokenomics.
- **Profile surface.** `block_pruning_depth` remains exposed on
  `/api/bootstrap` and `/api/head`; its live value is `u64::MAX` on all
  profiles. Clients must not assume a finite depth.

## Test plan

**Layer:** consensus-critical.

1. **Differential parity (release gate).** Build the same DAG with pruning on
   vs off; assert `is_ancestor`, `in_anticone`, `mergeset_ordered`, and the
   GHOSTDAG colouring are identical for every non-final block. This is RFC-008
   Test plan item 1 and the test that would have caught F1. Must pass before
   block pruning is re-enabled anywhere.
2. **Un-ignore the regression test.**
   `crates/kovanica-dag/tests/block_pruning_colouring.rs::block_pruning_preserves_colouring`
   must be de-`#[ignore]`d and pass (the 20-block chain + side block + later
   merging block reproduction above).
3. **Rejection equivalence.** At the depth boundary, a block whose selected
   parent is just below the pruning point is rejected with
   `BuildsOnPrunedHistory`; the same block on a no-pruning ledger is rejected
   with `Finality`. Assert the two rejection sets are equal.
4. **Wide-fork adversarial.** Reorgs above the pruning boundary must not move
   the pruning point backwards or evict a block that a competing branch builds
   on. Extend `adversarial_wide_fork_pruning` so it **inserts a merging block
   after an eviction** — the gap that let F1 through.
5. **Snapshot / checkpoint roundtrip** with pruned blocks (state recomputed by
   replay; stub reconstruction; re-eviction on load).
6. **Load-path re-application.** A log-loaded node starts with
   `block_pruning_depth == u64::MAX`; re-applying a finite profile depth prunes
   without corrupting the current state, and the chain continues.
7. **Memory bound assertion.** After the real fix, with pruning on, the
   colouring state is bounded after N inserts (assert the retained
   blue-anticone entry count is within the crown bound, not O(N)).
8. **Mitigation guard.** Assert that all three `NetworkProfile`s resolve
   `block_pruning_depth == u64::MAX`, and that the replay pre-flight refuses an
   over-budget log while the watchdog is installed only around the replay
   window.

## Open questions

**Layer:** consensus-critical.

1. **Redesign shape.** Which bounded k-cluster bookkeeping replaces the full
   historical map — Kaspa-style k-cluster/past-based evaluation, an incremental
   blue-anticone structure, or another scheme? Not settled; this RFC records
   requirements, not a design.
2. **Invariant replacement.** Does `blue_anticone_sizes.len() == blue_score`
   survive, or is it replaced? If replaced, what is the new invariant and which
   tests assert it?
3. **Re-enable depths.** RFC-008 proposed testnet 1000 / mainnet 10_000. After
   the fix, what depth per network, and what evidence gates re-enabling?
4. **Snapshot-tier replay policy.** `Node::load_with_poa` (used by the
   `LoadTier::Snapshot` branch) passes **no** pruning policy, so the snapshot
   tier replays unbounded too — a secondary gap noted in `../TASKLIST2.md` §2.5.
   Resolve alongside R8.
5. **Interaction with the reset and PoA-only migration.** The reset must not run
   block-pruning code; confirm the mitigation is deployed before reset and that
   the PoA cutover does not re-introduce a finite pruning depth.
6. **Adversarial coverage.** What additional adversarial cases (equivocating
   parents, deep+wide mixes, eviction at the pruning point boundary) are needed
   before block pruning can be trusted again?

## Cross-links

**Layer:** client-only (documentation only — no code surface).

- **RFC-008 — Reachability Oracle Pruning** (`RFC-008-OraclePruning.md`) — the
  RFC this one corrects; its "consensus-safe" status and §"Consensus impact"
  claim are superseded here. Test plan item 1 and Open question 2 are promoted
  to gates.
- **`../TASKLIST2.md` §2.5** — the operator-facing tracking item for this defect
  (live impact, measured curve, mitigation decisions, reset blocking).
- `crates/kovanica-dag/src/dag.rs` — `GhostdagData.blue_anticone_sizes`,
  `Dag::compute_ghostdag`, `Dag::remove_blocks`, `Dag::in_anticone`.
- `crates/kovanica-dag/src/ghostdag.rs` — `Dag::try_colour_blue` and the
  `blue_anticone_sizes.len() == blue_score` invariant (line 77).
- `crates/kovanica-dag/src/reachability.rs` — `Reachability::is_ancestor`
  (returns `false` for absent ids in both directions).
- `crates/kovanica-dag/tests/block_pruning_colouring.rs` — the `#[ignore]`d
  regression test `block_pruning_preserves_colouring`.
- `crates/kovanica-node/src/explorer.rs` — `BLOCK_PRUNING_DEPTH = u64::MAX`, the
  replay pre-flight estimate, and the `replay-watchdog`.
- `crates/kovanica-state/src/ledger.rs` — `apply_block_pruning_depth`
  (clamps up to `finality_depth`).
- `TESTNET-RESET-POLICY.md` — the reset is blocked on deploying the mitigation.
- `RFC-006-EmissionCurve.md` — tokenomics constants untouched by this RFC
  (k=3, MAX_SUPPLY 90.2M KVNC, maturity 100, fee split 75/25).
