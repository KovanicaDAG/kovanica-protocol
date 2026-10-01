# RFC-008 — Reachability Oracle Pruning (block-pruning depth wiring)

**Status: Draft**

**Consensus impact: consensus-safe** (no new rejection surface; the pruning
point is a pure function of the DAG and every evicted block is already final)

**One-line summary:** Wire the DAG core's existing block-pruning depth
(`Dag::set_block_pruning_depth` / `Dag::prune_old_blocks`, which evicts blocks
— including their reachability-oracle entries — below a blue-score threshold)
through `Ledger` → `Node` → the explorer `NetworkProfile`, so the reachability
oracle's memory is bounded by the crown width instead of growing with the
chain. This is the fix for the live testnet OOM crisis.

---

## Motivation

The reachability oracle (`crates/kovanica-dag/src/reachability.rs`) keeps two
structures per block for the life of the node:

- `intervals`: the block's `[start, end]` interval label in the selected-parent
  tree, and
- `fcs`: the block's future-covering set (the tree-roots of
  `future(b) \ subtree(b)`).

Neither is bounded by any existing pruning knob:

- **Payload pruning** (`payload_pruning_depth`, live testnet value 1000) only
  evicts the opaque `Block.payload` bytes. The oracle never inspects payloads,
  so it is unaffected.
- **Finality pruning** (`finality_depth`, live testnet value 100) only prunes
  per-block UTXO *state* in the ledger. The DAG stays append-only.

Measured on `kovanica-testnet` (2026-09-24): the oracle's interval + FCS maps
reach **~7 GB at 29,316 blocks** and grow with the chain (~337 blocks/min).
Per-node RSS is ~9.5 GB (oracle ~7 GB + runtime ~2.5 GB), which is why the
explorer and seed units OOM-loop as the chain grows.

The DAG core already contains the mechanism that bounds the oracle: **block
pruning** (`Dag::set_block_pruning_depth`, `Dag::prune_old_blocks`,
`Dag::pruning_point`, `DagError::BuildsOnPrunedHistory`, and
`Reachability::remove_blocks`), shipped with the reachability oracle itself
(see the `dag.rs` module docs and the Stage 2 roadmap item "DAG-level pruning
behind the reachability oracle"). It is **not exposed** at the `Ledger` or
`Node` layer and **not enabled** in the explorer profile, so no live node uses
it. This RFC is the wiring + operationalization slice, plus the memory-bound
analysis and the consensus-safety argument.

## Specification

### 1. Ledger layer (`kovanica-state`)

Mirror the existing `payload_pruning_depth` plumbing in `ledger.rs`:

- `Ledger::with_block_pruning(k, schedule, coinbase, block_pruning_depth)` —
  builder that calls `dag.set_block_pruning_depth(depth)`.
- `Ledger::with_finality_and_block_pruning(k, schedule, coinbase,
  finality_depth, block_pruning_depth)` — the combined constructor the node
  profile uses.
- `Ledger::set_block_pruning_depth(&mut self, depth: u64)` — setter that
  threads through to `self.dag.set_block_pruning_depth(depth)` and calls
  `self.dag.prune_old_blocks()` immediately (same shape as
  `Ledger::set_finality_depth` from PR #37).
- `Ledger::block_pruning_depth(&self) -> u64` — getter (default `u64::MAX`).

### 2. Node layer (`kovanica-node`)

- `Node::set_block_pruning_depth(&mut self, depth: u64)` + getter, mirroring
  `Node::set_payload_pruning_depth` (node.rs ~933).
- `Node::genesis_with_finality` gains the depth (or a new
  `genesis_with_pruning` constructor); the combined builder passes both depths
  to `Ledger::with_finality_and_block_pruning`.

### 3. Explorer profile (`explorer.rs`)

- `NetworkProfile` gains `block_pruning_depth`.
- Testnet: `block_pruning_depth = 1000` (same as `payload_pruning_depth`).
- Mainnet: `block_pruning_depth = 10_000` (same as `payload_pruning_depth`).
- **Invariant (enforced at profile construction):**
  `block_pruning_depth >= finality_depth`. This is what makes the change
  consensus-safe — see below.
- `restore_miner_and_policy` re-applies `block_pruning_depth` on the load path
  (extends the PR #37 finality/payload re-application; the replay log does not
  persist the policy).
- `/api/bootstrap` and `/api/head` expose `block_pruning_depth` alongside
  `finality_depth` / `payload_pruning_depth`.

### 4. Memory bound

With block pruning at depth `D`, the oracle retains only the **crown**: blocks
within `D` blue score of the selected tip. The evicted set `past(P)` is
downward-closed in the reachability tree, so:

- oracle memory ≈ `O(D × width)` instead of `O(chain_length × width)`;
- at `D = 1000` and current testnet width, the oracle drops from ~7 GB to an
  estimated ~100–200 MB, and stops growing with the chain.

## Consensus impact

**Consensus-safe.** The argument has three parts:

1. **Deterministic pruning point.** `block_pruning_score()` =
   `tip.blue_score.saturating_sub(block_pruning_depth)` and the pruning point
   `P` is the lowest selected-parent-chain block with `blue_score >= threshold`
   — both pure functions of the DAG. Every node prunes the identical set.

2. **No new rejection surface.** With `block_pruning_depth >= finality_depth`,
   every evicted block is already final: the ledger's finality check already
   rejects any block whose selected parent is more than `finality_depth` blue
   below the tip. `DagError::BuildsOnPrunedHistory` therefore fires only for
   blocks that `LedgerInsertError::Finality` would already reject. A node with
   pruning on and a node with pruning off accept exactly the same blocks.

3. **Reachability answers unchanged for present blocks.** The oracle never
   inspects evicted blocks: `Reachability::remove_blocks` drops the evicted
   entries and re-parents present tree-children to genesis (their intervals
   already lie inside genesis's allocated region — no re-layout), and the
   insert-time invariant (`sp ∈ future(P) ∪ {P}`) keeps evicted blocks out of
   every mergeset walk. `is_ancestor`, `in_anticone`, `mergeset_ordered`, and
   the GHOSTDAG colouring produce identical results for all non-final blocks
   with pruning on or off.

**Sync safety:** `block_pruning_score()` returns 0 (no eviction) until the
selected tip is more than `D` blue deep, so a syncing node never prunes before
it has the full past.

## Backwards compatibility

- **Wire format: unchanged.** Block records are identical; pruning is a
  retention policy.
- **Snapshot / checkpoint format: unchanged.** Pruned blocks already encode as
  stubs (empty payload, `Block::new_pruned`); load reconstructs them and
  `prune_old_blocks` re-evicts (dag.rs module docs, "Snapshots").
- **Replay log format: unchanged.** `block_pruning_depth` is policy, re-applied
  on load exactly like `finality_depth` (PR #37).
- **Mixed-version network: no fork.** Old nodes (pruning off) and new nodes
  (pruning on) accept the same blocks; the new node merely retains less. The
  eviction is invisible to consensus output.
- **RFC-006 constants are untouched:** k=3, MAX_SUPPLY 90.2M KVNC, maturity
  100, fee split 75/25, subsidy curve — none of this RFC's mechanics interact
  with tokenomics.

## Test plan

1. **Parity (differential):** build the same DAG with pruning on vs off; assert
   `is_ancestor`, `in_anticone`, `mergeset_ordered`, and the GHOSTDAG colouring
   are identical for every non-final block (extend
   `crates/kovanica-dag/tests/reachability.rs`).
2. **Rejection equivalence:** at the depth boundary, a block whose selected
   parent is just below the pruning point is rejected with
   `BuildsOnPrunedHistory`; the same block on a no-pruning ledger is rejected
   with `Finality`. Assert the two rejection sets are equal.
3. **Wide-fork adversarial:** reorgs above the pruning boundary must not move
   the pruning point backwards or evict a block that a competing branch builds
   on (extend `crates/kovanica-dag/tests/consensus.rs`).
4. **Snapshot/checkpoint roundtrip** with pruned blocks (state recomputed by
   replay; stub reconstruction; re-eviction on load).
5. **Load-path re-application:** extend
   `crates/kovanica-node/tests/incremental_persistence.rs` — a log-loaded node
   starts with `block_pruning_depth == u64::MAX`, re-applying the profile depth
   prunes without corrupting the current state, and the chain continues.
6. **Memory assertion:** with pruning on, the oracle's entry count is bounded
   after N inserts (assert `intervals.len() <= crown_size + slack`).

## Open questions

1. **Exact testnet depth.** 1000 (== payload depth) is the proposal; a smaller
   value (e.g. 200) bounds memory harder but evicts blocks that peers may still
   want to sync. The payload depth is the natural ceiling — a node cannot serve
   a block body it has pruned anyway.
2. **FCS cross-references.** Confirm the invariant that a present block's FCS
   never contains an evicted block (the evicted set is downward-closed and
   present blocks' futures are present blocks). `remove_blocks` drops evicted
   entries wholesale; a differential test (item 1) is the guard.
3. **Interaction with checkpoint restore.** `read_checkpoint` reconstructs the
   tip segment; confirm `prune_old_blocks` is invoked after restore so the
   oracle is bounded immediately rather than on the first insert.

## Cross-links

- `crates/kovanica-dag/src/dag.rs` module docs — the shipped block-pruning
  core this RFC wires up (payload pruning, block pruning, snapshots).
- `crates/kovanica-dag/src/reachability.rs` — the oracle being bounded.
- PR #37 (`ledger/finality-after-load`) — the load-path policy re-application
  this RFC extends to `block_pruning_depth`.
- RFC-006 / `docs/TOKENOMICS.md` — live testnet economy (untouched by this
  RFC; the OOM crisis it fixes is operational, not economic).
- `protocol/TESTNET-RFC006.md` — live testnet run env and profile values.