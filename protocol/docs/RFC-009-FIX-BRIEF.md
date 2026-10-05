# RFC-009 F1 Fix Brief — make GHOSTDAG colouring independent of the historical blue map

**Status:** Ready to execute (design brief, not an RFC)
**Implements:** [RFC-009](RFC-009-BlockPruning-Colouring.md) requirements **R1-R8**
**Supersedes the mitigation in:** `6d0581e` (`BLOCK_PRUNING_DEPTH = u64::MAX`)
**Classification:** **consensus-critical** (changes GHOSTDAG colouring internals)
**Gate:** do not land before the current testnet reset; do not re-enable a finite
`block_pruning_depth` until R1-R7 hold and R4's differential test is green.

---

## 1. Mission

Make `compute_ghostdag` decide blue/red **without consulting a full historical
blue map**, so that evicting old blocks is sound, block pruning can be turned
back on, and replay memory returns to ~O(finality window) instead of O(chain²).

Right now the O(N²) memory growth and the F1 correctness bug are **the same
problem**: the map is retained per block *and* the eviction path corrupts it.
Fixing the representation fixes both.

## 2. The defect (F1), precisely

`GhostdagData.blue_anticone_sizes: HashMap<BlockId, KParam>` (`crates/kovanica-dag/src/dag.rs:228`)
holds one entry per blue block in that block's blue set, so it is O(depth) per
retained block and O(N²) across the DAG. Measured: ~461 KB retained per block at
N=11,776, extrapolating to ~62 GB for the real 45,638-record log.

The correctness half:

1. `compute_ghostdag` (`crates/kovanica-dag/src/ghostdag.rs:31`) seeds a new
   block's map by **cloning the selected parent's whole map** (line 47), then
   `insert(selected_parent, 0)`.
2. `try_colour_blue` (`ghostdag.rs:105`) iterates **every key** and asks
   `self.in_anticone(&blue, candidate)`; that is the only oracle query.
3. `Dag::remove_blocks` (`dag.rs:661`) drops evicted ids from the reachability
   oracle, `nodes` and `tips` — but **never** from the `blue_anticone_sizes`
   maps retained on surviving blocks.
4. `Reachability::is_ancestor` (`crates/kovanica-dag/src/reachability.rs:466-478`)
   returns `false` for an absent id in **both** directions. So
   `in_anticone(evicted, x)` returns `true` **even when `evicted` is a true
   ancestor of `x`** — a phantom anticone blue.
5. Every later merging candidate then sees O(|past(P)|) phantom anticone blues
   and is forced red, diverging from an unpruned node's
   `blue_score` / `mergeset_blues` / linearization ⇒ **chain split**.

The invariant at `ghostdag.rs:77` —
`debug_assert_eq!(blue_anticone_sizes.len() as u64, blue_score, "blue anticone map must cover exactly the blue set")` —
is load-bearing: a naive "strip evicted ids" patch restores the colouring but
violates it (fired with `left: 6, right: 24`) and fails four existing pruning
tests. That is why this is a redesign, not a patch.

### Reproduction (differential, already encoded)

```
chain c1..c20 ; S on c18 ; n=[c20,S] ; set_block_pruning_depth(3) ; x=[c20] ; m=[n,x]
UNPRUNED m: blue_score=24 blues=1 reds=0
PRUNED   m: blue_score=23 blues=0 reds=1
```

The same later block is blue unpruned and red pruned. Note the construction must
insert `m` **after** the eviction — `compute_ghostdag` runs at the *start* of an
insert, so a prune at the end of the same insert cannot affect that block's own
colouring.

There is an `#[ignore]`d regression test waiting to be un-ignored:
`crates/kovanica-dag/tests/block_pruning_colouring.rs::block_pruning_preserves_colouring`
(`#[ignore = "F1 open: block pruning corrupts later GHOSTDAG colouring (TASKLIST2 §2.5)"]`).

## 3. What has already been tried and disproven — do not repeat

- **Shrinking the map** by dropping its selected-chain ("spine") entries. Failed:
  a spine ancestor of the selected parent need not be an ancestor of a mergeset
  candidate, so those entries genuinely participate in `try_colour_blue`. It
  changed derived `blue_score`/`blue_work` and broke
  `block_pruning::adversarial_wide_fork_pruning`.
- **Evicting DAG blocks during replay** gated on `remaining[id] == 0` +
  finality. Rejected by review and reproduced first-hand: it hits F1 (the evicted
  ids stay in retained maps), and its early-`break` walk violated
  `remove_blocks`' documented ancestor-closure precondition (105 violations in a
  simulation).
- **Stripping evicted ids from retained maps.** Restores the colouring but
  violates the `len == blue_score` invariant and fails
  `insert_rejects_builds_on_pruned_history`,
  `insert_with_block_pruning_automatically_prunes`,
  `pruning_point_moves_forward`, `snapshot_roundtrip_with_pruned_blocks`.

## 4. Requirements (RFC-009 R1-R8)

- **R1 — Bounded bookkeeping.** Colouring must not require the full historical
  blue map per retained block. Per-block colouring state must be bounded by the
  finality/pruning window, not by chain length.
- **R2 — Exact GHOSTDAG k=3 semantics.** Selected parent, mergeset, blue/red set,
  `blue_score`, `blue_work` and linearization must be **identical to an unpruned
  DAG** for every non-final block.
- **R3 — Invariant handled deliberately.** Either keep
  `blue_anticone_sizes.len() == blue_score` (`ghostdag.rs:77`) or replace it with
  a documented, tested alternative. Do not silently relax or delete it.
- **R4 — Differential-testable.** The same DAG built with pruning on vs off must
  produce identical `is_ancestor`, `in_anticone`, `mergeset_ordered` and GHOSTDAG
  colouring for every non-final block. This is RFC-008 Test plan item 1, promoted
  to a **release gate**; it is the test whose absence hid F1.
- **R5 — Sound eviction.** `Dag::remove_blocks` must leave every surviving
  block's colouring state consistent: either strip evicted ids while maintaining
  a valid invariant, or make colouring not consult historical ids at all.
  *(2026-10-06: the eviction path is now sound — `prune_old_blocks` collects each
  chain block's mergeset before stopping and `mergeset_ordered` treats genesis as
  an unconditional boundary, so the evicted set is genesis-free and
  downward-closed. See `RFC-009-DESIGN-ANALYSIS.md` §12 and
  `crates/kovanica-dag/tests/block_pruning_eviction.rs`.)*
- **R6 — Memory bound restored.** With block pruning at depth `D`, retained
  colouring state must be ~O(D × width), not O(chain_length × width). The O(N²)
  map must not be retained on live blocks.
- **R7 — Rejection equivalence preserved.** `BuildsOnPrunedHistory` must fire
  exactly where the ledger's finality check would already reject (RFC-008 Test
  plan item 2), so a pruning node and a non-pruning node accept the same blocks.
- **R8 — Load paths guarded.** No replay/snapshot/checkpoint path may re-enable
  block pruning until R1-R7 hold. Resolve the snapshot tier's missing
  `block_pruning_depth` handling in the same change (see §7).

## 5. Constraints

- **Do not change RFC-006 constants**: MAX_SUPPLY 90.2M KVNC
  (`9_020_000_000_000_000` atoms), coinbase maturity 100 blocks, fee split
  75% burned / 25% to producer, subsidy curve, GHOSTDAG k=3.
- **Determinism**: the colouring iterates a `HashMap`, but its outcome must stay
  order-independent; tie-breaks fall back to `BlockId` byte order.
- **Prefer no wire-format or checkpoint-format bump.** If one is unavoidable it
  must be versioned and documented.
- Match existing error types and module layout; minimise clones on the insert hot
  path (the clone at `ghostdag.rs:47` is the O(depth) per-insert *time* cost as
  well as the memory cost).

## 6. Non-goals / do not touch

- Do **not** re-enable a finite `block_pruning_depth` as part of this change's
  first landing. Land the redesign with pruning still disabled
  (`BLOCK_PRUNING_DEPTH = u64::MAX`), prove R4 green, *then* flip the depth in a
  separate, clearly-labelled commit.
- Do not touch the replay pre-flight / `replay-watchdog`
  (`crates/kovanica-node/src/explorer.rs`) — those are guards, orthogonal to this.
- Do not "fix" `Node::chain_height()`'s blue-score semantics (it is documented,
  and the maturity gate was already corrected in `c015aab`).
- Do not re-derive the rejected stake-weighted election direction
  (RFC-POA-Migration §0.7.1).

## 7. Known open design questions (the brief does not answer these)

1. **Redesign shape** — Kaspa-style k-cluster/past-based evaluation vs an
   incremental blue-anticone structure. This is the main genuinely-open decision.
   *(2026-10-06: design (B1) is now a confirmed counterexample — it diverges from
   an unpruned node at every finite depth, k=3 included; see
   `RFC-009-DESIGN-ANALYSIS.md` §13. The concrete path is option **(A+)**: reject
   any block with a parent **or a mergeset candidate** outside `future(P) ∪ {P}`
   — a consensus-rule change, reset/activation gated. The parent-only form of (A)
   is *insufficient* (§14: 344/8000 random (A)-compliant DAGs still diverge; the
   candidate check drives it to 0/8000). Implemented in `Dag::insert_with_id_inner`;
   enforced tests in `block_pruning_colouring.rs`.)*
2. **Invariant replacement** — whether `len == blue_score` survives (R3).
3. **Re-enable depths** — RFC-008's testnet 1000 / mainnet 10,000 are prior
   proposals, not decisions.
4. **Snapshot tier** — `Ledger::read_snapshot_impl`
   (`crates/kovanica-state/src/ledger.rs:3192-3237`) rebuilds the whole DAG via
   `insert_raw_block` and its 38-byte header stores only `finality_depth` and
   `payload_pruning_depth`, **not** `block_pruning_depth`. `Node::load_with_poa`
   therefore has no way to apply a pruning policy. Resolve under R8.

## 8. Verification (acceptance evidence)

Required before this is called done:

1. **Un-ignore and pass** `block_pruning_preserves_colouring` (the differential
   repro above).
2. **R4 differential test**: build the same DAG with pruning on vs off; assert
   identical `is_ancestor`, `in_anticone`, `mergeset_ordered` and colouring for
   every non-final block — across a DAG with **merges**, not just a linear chain.
3. **R6 memory evidence**: replay a long log with a finite pruning depth and show
   retained colouring state bounded by the window (the existing
   `estimate_replay_peak_bytes` model and the `replay-watchdog` RSS series are
   the instruments).
4. **R7 rejection equivalence**: a pruning node and a non-pruning node accept the
   same block set.
5. Full gates: `cargo fmt --all`, `cargo clippy --workspace --all-targets` (0/0),
   `cargo test --workspace`.
6. Live soak evidence after a finite depth is re-enabled: `block_pruning_depth`
   reported correctly on `/api/head`, RSS flat rather than climbing.

## 9. Safety rails

- Branch `consensus/poa-only-migration` (or a dedicated `consensus/rfc-009-*`);
  **never commit to `main`**.
- Call out consensus impact in the commit body and classify the change.
- Any doc-comment change to a `#[uniffi::export]`ed type/method requires a
  bindings regen in the same commit.
- Do not run a reset to "fix" F1 — the mitigation removes the *cause*; the reset
  is gated separately on the soak window (`TESTNET-RESET-POLICY.md` §3).

## 10. Starting points

- `crates/kovanica-dag/src/ghostdag.rs` — `compute_ghostdag` (31),
  `try_colour_blue` (105), `select_parent` (94).
- `crates/kovanica-dag/src/dag.rs` — `remove_blocks` (661), `prune_old_blocks`
  (603), `pruning_point` (569), `mergeset_ordered` (768), `in_anticone` (746).
- `crates/kovanica-dag/src/reachability.rs` — `is_ancestor` (466),
  `remove_blocks`.
- `crates/kovanica-state/src/store.rs` — replay passes and
  `prune_replay_final`.
- Prior art to study: Kaspa's `ghostdag` module (the same
  `blues_anticone_sizes` shape, but with pruning that is sound — understand *how*
  before adapting).
