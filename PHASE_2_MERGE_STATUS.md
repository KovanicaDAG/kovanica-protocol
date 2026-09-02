# Phase 2 Merge Status: Consensus Layer (Complete)

**Status**: ✅ COMPLETE / MERGED
**Date**: 2026-09-02
**Branch**: `merge/phases-1-to-20`

## Phase 2: Consensus Layer Upgrade

Phase 2 introduces critical consensus infrastructure:

### Core Changes

**1. Block Pruning (DAG-level block eviction)**
- `Dag::set_block_pruning_depth(depth)` — evict blocks beyond depth blue-score units
- `Dag::pruning_point()` — compute the lowest selected-chain block above the threshold
- `Dag::prune_old_blocks()` — automatically evicted via insert, or manually
- `DagError::BuildsOnPrunedHistory` — new block's selected parent must be in future(P) ∪ {P}
- Snapshot support: reconstructs pruned parents as stubs during replay
- Reachability oracle updates: `Reachability::remove_blocks()` re-parents present children to genesis

**2. Epoch Randomness Beacon (VRF anti-grinding)**
- `Dag::epoch_beacon(sp)` — Algorand-style boundary block randomness
- `Dag::epoch_vrf_input(sp)` — beacon domain-separated for VRF
- `Dag::epoch_vrf_input_for_parents(parents)` — convenience for producer
- `VrfConfig::epoch_length` — consensus parameter (defaults to 100 blocks)
- `DEFAULT_EPOCH_LENGTH` — exported constant (100)
- **Legacy** `Dag::vrf_input()` retained for backward compat

**3. Topological Ordering Updates**
- `Dag::selected_chain()` — stops at pruning point (genesis first in pruned DAGs)
- `Dag::mergeset_order()` — handles evicted selected parents
- Genesis hoisting in pruned linearizations

### Files Modified

**crates/kovanica-dag/**
- `src/dag.rs` (800+ lines): block pruning, epoch beacon, VRF input changes, insert-time checks
- `src/lib.rs`: exports `DEFAULT_EPOCH_LENGTH`
- `src/ordering.rs`: selected chain stops at eviction, genesis first
- `src/reachability.rs` (70+ lines): `remove_blocks()` for re-parenting to genesis
- `src/snapshot.rs`: stub reconstruction for evicted parents
- `tests/block_pruning.rs` (NEW): 12+ comprehensive pruning tests
- `tests/vrf.rs` (NEW): epoch beacon + anti-grinding tests

### Conflict Resolution

**Zone 1: dag.rs (1200+ lines)**
- ✅ No conflicts with Phase 1 (explorer.rs is independent)
- Phase 2 adds new DAG-level methods, doesn't overwrite Phase 1
- Insert-time pruning check added before block wiring
- VRF enforcement updated to use epoch beacon instead of parent-tip hash

**Zone 2: node.rs → stake_state return type**
- Phase 1 implicit: `stake_state()` returns `Option<&StakeState>`
- Phase 2 implicit: must return `Option<StakeState>` (owned, not ref)
- **ACTION**: Phase 2 code assumes owned return type for undo-log integration
- Will resolve during Phase 3 when node.rs is merged

**Zone 3: Integration points**
- Phase 2 DAG changes are independent consensus upgrades
- Phase 1 multisig activation gating (blue_score-based) compatible with Phase 2 block pruning
- Explorer uses epoch_beacon via `Dag::epoch_vrf_input_for_parents()` (new in Phase 2)
- No direct conflicts — Phase 2 DAG is additive

## Test Suite

**New tests** (100+ lines):
- `block_pruning.rs` (397 lines): 12 tests covering:
  - Pruning disabled by default
  - Eviction of blocks below threshold
  - Genesis never evicted
  - Pruning point movement
  - Auto-pruning on insert
  - Idempotency
  - Oracle consistency after eviction
  - Topological order validity
  - BuildsOnPrunedHistory rejection
  - Snapshot roundtrip with pruned blocks
  - Adversarial wide-fork pruning
  - Directed DAG structure with merges

- `vrf.rs` (NEW): Epoch randomness beacon tests
  - Boundary block selection
  - Epoch boundaries
  - Anti-grinding: parent-set grinding impossible
  - Backward compat: legacy vrf_input preserved

## Critical Integration Points

1. **Multisig + Block Pruning**
   - Activation gating: P2SH activated by blue score threshold
   - Pruning threshold: also blue score based
   - No interaction: multisig validates spend regardless of pruning

2. **VRF + Hybrid Admission**
   - Legacy VRF: `Dag::vrf_input()` still available (parent-tip hash)
   - Epoch VRF: `Dag::epoch_vrf_input()` for consensus enforcement
   - Explorer/node producer: calls `epoch_vrf_input_for_parents()` for staked blocks
   - Phase 3 will adapt explorer to use epoch beacon

3. **Snapshot Loading + Pruning**
   - Snapshot only contains present blocks
   - Evicted parents reconstructed as stubs during replay
   - Stubs evicted again once replay completes
   - Restores pruned DAG's present set exactly

## Estimated Duration

- Merge DAG changes: **1 hour**
- Resolve node.rs integration: **1 hour** (deferred to Phase 3)
- Run block_pruning + vrf tests: **30 min**
- Adapter code (explorer → epoch beacon): **1-2 hours** (Phase 3)
- **Total Phase 2: 2-3 hours** + **Phase 3 integration: 1-2 hours**

## Next Steps

✅ Phase 2 DAG + consensus changes merged (`merge/phases-1-to-20`, #51; plus #49 epoch beacon and #50 undo log)
✅ Node-layer integration landed on main: `stake_state` return-type + insert points wired, and the staked-block producer now uses `epoch_vrf_input_for_parents()` in `node.rs`/`ledger.rs`
🔄 Phase 3 follows in the upgrade plan (incremental on-disk store, incremental sync + API pagination) — no longer gated on Phase 2 integration

---

**Status**: ✅ Phase 2 complete — merged to main with node/explorer integration landed.
