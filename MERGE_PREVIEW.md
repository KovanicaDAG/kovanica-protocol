# Multi-Branch Merge Preview & Conflict Analysis

**Status**: HALTED for review  
**Date**: 2026-09-02  
**Branches**: 20 feature branches → main (single PR strategy)  
**Scope**: Phase upgrades (foundation, consensus, performance, mobile, operations) + mobile/explorer enhancements

---

## Executive Summary

Merging all 20 branches creates **high-complexity conflicts** in:
- **Consensus layer** (`crates/kovanica-dag/`): VRF epoch beacon, block pruning, reachability
- **Ledger state** (`crates/kovanica-state/`): UTXO undo-log design, stake registry, hybrid admission
- **Node & persistence** (`crates/kovanica-node/`): Incremental logging, mining, block insertion
- **Explorer API** (`crates/kovanica-node/src/explorer.rs`): Network profiles, light-sync, rate limiting

**Recommendation**: Proceed with **staged merges** (phases 1→2→3→...) + integration tests between each phase.

---

## Phase Dependencies & Merge Order

```
Phase 1: Foundation
├─ Network profiles (mainnet/testnet isolation)
├─ Multisig RFC-001 (P2SH, witness layouts)
├─ Faucet + rate limiting
└─ SPV light-sync + Merkle proofs

Phase 2: Consensus (DEPENDS ON Phase 1)
├─ VRF epoch beacon (anti-grinding)
├─ Block pruning (evict old blocks)
├─ Epoch randomness (reachability oracle changes)
└─ Undo-log state design (per-block deltas)

Phase 3: Performance (DEPENDS ON Phase 2)
├─ Incremental persistence (append-only logs)
├─ API pagination (blocks, history, UTXOs)
└─ log_path() migration from snap_path()

Phase 4: Mobile & Light (DEPENDS ON Phase 3)
├─ FFI mobile packaging
├─ Wallet UX enhancements
└─ Background sync

Phase 5+: Web, Operations, etc. (mostly independent)
```

---

## Critical Conflict Zones

### Zone 1: `crates/kovanica-node/src/explorer.rs` (1000+ lines)

**Files Modified Across Phases**:
- Phase 1: Network profiles, faucet, rate limiting, light-sync, Merkle proofs
- Phase 3: persist_all() signature change, incremental log loading

**Conflict**: `persist_all(&self.mesh)` → `persist_all(&mut self.mesh)`
- Phase 1 adds: faucet tracking, rate-limit buckets, light-sync blob generation
- Phase 3 changes: requires `&mut` for log appends

**Resolution Strategy**:
```rust
// Phase 1 additions (faucet_given: HashMap, rate_limits, etc.) MUST be added
// THEN Phase 3's persist_all() receives &mut mesh
// AND persist_all() calls n.persist_incremental(p) INSTEAD OF n.save(p)

fn persist_all(mesh: &mut Mesh) {
    let _ = fs::create_dir_all(data_dir());
    for name in mesh.names() {
        if let Some(n) = mesh.node_mut(&name) {  // &mut required
            if let Some(p) = log_path(&name).to_str() {
                let _ = n.persist_incremental(p);  // Phase 3: incremental
            }
            if let Some(m) = n.miner() {
                let _ = fs::write(miner_path(&name), m.to_hex());
            }
        }
    }
}
```

---

### Zone 2: `crates/kovanica-node/src/node.rs` (1800+ lines)

**Phase 1 Changes**:
- Import `HybridConfig` (already present)
- `stake_state()` return type changes: `Option<&StakeState>` → `Option<StakeState>`

**Phase 3 Changes**:
- Add `log: Option<LedgerStore>` and `pending: Vec<BlockId>` fields
- Add `note_inserted()` after every `ledger.insert()`
- Add `create_log()`, `load_log()`, `load_log_with_hybrid()`, `persist_incremental()`
- Change `load_log()` signature: returns `(Self, LedgerStore)` → returns `Self`

**Conflict**: Multiple insertion points for block tracking
- Every call to `ledger.insert()` must call `self.note_inserted(id)`
- 6+ locations in `produce_block()`, `send_tx()`, `produce_empty()`, `receive_block()`, etc.

**Resolution Strategy**:
```rust
// All insert callsites must add:
let block = ledger.insert(...)?;
self.note_inserted(block);  // Phase 3 addition
self.evict_mempool();

// Load functions return Self (not tuple):
pub fn load_log(path: &str) -> Result<Self, NodeError> {
    // Phase 3: opens log and keeps it on self.log
    Self::load_log_impl(path, None)
}

pub fn load_log_with_hybrid(path: &str, config: HybridConfig) -> Result<Self, NodeError> {
    // Phase 3: returns Self with log open
    Self::load_log_impl(path, Some(config))
}
```

---

### Zone 3: `crates/kovanica-state/src/ledger.rs` (2000+ lines, most complex)

**Phase 1 Changes**:
- Multisig validation: `verify_threshold_signatures()` helper
- Activation gating: `multisig_activation_score` field + `set_multisig_activation_score()`

**Phase 2 Changes** (MAJOR):
- Undo-log redesign: `states: HashMap<BlockId, UtxoSet>` → `tip_state: UtxoSet` + `deltas: HashMap<BlockId, BlockDelta>`
- New helper types: `BlockDelta`, `StakeDelta`, `diff_utxo()`, `apply_delta()`, `compose_delta()` (150+ LOC)
- Every method that accesses `.states` must call `reconstruct_state()` on demand
- Finality pruning: `prune()` now folds deltas into children (80+ LOC)

**Phase 3 Changes**:
- `Ledger::insert_raw_block()` new method (identity-preserving replay)
- `store.rs`: `LedgerStore::open_with_hybrid()` for hybrid-mode replay

**Conflict**: The undo-log is a **wholesale redesign** of state storage
- Phase 1's `verify_threshold_signatures()` must use reconstructed state, not cached
- All read paths (`state()`, `stake_state()`) must switch to reconstruction
- The delta composition on prune must respect multisig validation

**Resolution Strategy** (CRITICAL):
```rust
// Phase 1: add multisig_activation_score field FIRST
pub struct Ledger {
    dag: Dag,
    // ... existing fields ...
    multisig_activation_score: u64,  // Phase 1
}

// Phase 2: then introduce undo-log fields (remove states/stakes)
pub struct Ledger {
    dag: Dag,
    // ...
    tip_state: UtxoSet,              // Phase 2: single materialized tip
    tip_stake: StakeState,           // Phase 2
    deltas: HashMap<BlockId, BlockDelta>,       // Phase 2: per-block undo
    stake_deltas: HashMap<BlockId, StakeDelta>, // Phase 2
    multisig_activation_score: u64,  // Phase 1 (already present)
}

// reconstruct_state() must call diff_utxo() which is oblivious to multisig
// verify_threshold_signatures() calls on reconstructed state work unchanged
```

---

### Zone 4: `crates/kovanica-dag/src/dag.rs` & reachability (1200+ lines)

**Phase 2 Changes**:
- VRF epoch beacon: `epoch_beacon()`, `epoch_vrf_input()`, `epoch_vrf_input_for_parents()`
- Block pruning: `block_pruning_depth`, `pruning_point()`, `prune_old_blocks()`, `remove_blocks()`
- Reachability updates: `Reachability::remove_blocks()` for pruned blocks
- Ordering: `selected_chain()` must stop at evicted blocks

**Conflict**: None with Phase 1 (isolated consensus layer)

**Dependency**: Phase 2 changes are prerequisite for Phase 3 (incremental persistence needs block IDs preserved)

---

## High-Risk Conflict Areas (MUST RESOLVE)

### 1. **Undo-log Finality Folding** (Phase 2)
   - **Risk**: Delta composition during `prune()` must preserve invariants
   - **Test**: `crates/kovanica-state/tests/undo_log.rs` (335 LOC)
   - **Validation**: Every non-final block must reconstruct identically to reference
   - **Action**: Run `undo_log.rs` tests after Phase 2 merge

### 2. **Multisig State Access** (Phase 1 + Phase 2)
   - **Risk**: `verify_threshold_signatures()` uses reconstructed state in Phase 2
   - **Test**: `crates/kovanica-state/tests/multisig_consensus.rs` (35 tests)
   - **Validation**: All 35 multisig tests must pass after Phase 2 merge
   - **Action**: Merge Phase 1 first, then Phase 2, then run multisig suite

### 3. **VRF Epoch Beacon vs. Legacy Parent-Tip Input** (Phase 2)
   - **Risk**: Consensus VRF now uses epoch beacon, but `kovanica-node` still produces parent-tip VRF
   - **Impact**: Nodes in Phase 2-aware consensus will reject Phase 1 blocks
   - **Mitigation**: Phase 2 includes legacy `Dag::vrf_input()` for backward compat (read-only)
   - **Action**: Document epoch beacon requirement in consensus/RFC

### 4. **Hybrid Mode Replay** (Phase 3 + Phase 2)
   - **Risk**: Hybrid-mode logs must replay with `LedgerStore::open_with_hybrid()`
   - **Test**: `crates/kovanica-node/tests/incremental_persistence.rs` (test_hybrid_log_preserves_staked_block_id)
   - **Validation**: Staked block IDs preserved across restart
   - **Action**: Run incremental_persistence tests after Phase 3 merge

---

## Merge Workflow

### Step 1: Prepare Single PR (CURRENT STATE)
```bash
git checkout main
git pull
```

### Step 2: Create Merge Branch
```bash
git checkout -b merge/all-phases-unified
```

### Step 3: Merge Phases Sequentially

#### 3a. Merge Phase 1 (Foundation)
```bash
git merge claude/upgrade-phase1-foundation
# Expected conflicts: AGENTS.md, .gitignore, explorer.rs (faucet/network profiles)
# Manual resolution: Accept all Phase 1 additions
git add .
git commit -m "Merge phase1-foundation: multisig, faucet, network profiles, light-sync"
```

#### 3b. Merge Phase 2 (Consensus)
```bash
git merge claude/upgrade-phase2-consensus
# Expected conflicts: dag.rs (merge with VRF/pruning), ledger.rs (undo-log), node.rs (stake_state return type)
# Manual resolution: Apply undo-log design, keep multisig, add VRF beacon
git add .
git commit -m "Merge phase2-consensus: epoch beacon, block pruning, undo-log state"
```

**RUN TESTS**:
```bash
cargo test -p kovanica-state multisig_consensus
cargo test -p kovanica-state undo_log
```

#### 3c. Merge Phase 3 (Performance)
```bash
git merge claude/upgrade-phase3-performance
# Expected conflicts: explorer.rs (persist_all signature), node.rs (load_log), store.rs (open_with_hybrid)
# Manual resolution: &mut mesh, identity-preserving replay
git add .
git commit -m "Merge phase3-performance: incremental persistence, API pagination"
```

**RUN TESTS**:
```bash
cargo test -p kovanica-node incremental_persistence
cargo test -p kovanica-node explorer
```

#### 3d-3t. Remaining Phases
```bash
# Merge remaining branches in dependency order
git merge claude/upgrade-phase4-mobile-light
git merge claude/phase5-multisig-node
# ... etc
```

---

## Conflict Resolution Checklist

- [ ] **Phase 1 + Main**: Merge foundation (low conflicts expected)
  - [ ] AGENTS.md: Verify multisig RFC section added
  - [ ] explorer.rs: faucet_given, rate_limits added
  - [ ] `.gitignore`: .slim/deepwork and faucet.txt entries
  - [ ] Tests: Run all Phase 1 tests

- [ ] **Phase 2 + Phase 1**: Merge consensus (HIGH COMPLEXITY)
  - [ ] dag.rs: Keep VRF epoch beacon + block pruning (don't lose Phase 1's explorer.rs faucet)
  - [ ] ledger.rs: Undo-log replaces per-block states (CRITICAL)
    - [ ] `tip_state` + `tip_stake` materialized
    - [ ] `deltas` + `stake_deltas` per-block
    - [ ] `reconstruct_state()` / `reconstruct_stake()` added
    - [ ] `prune()` folds deltas into children
  - [ ] node.rs: `stake_state()` return type fixed (`Option<StakeState>` not `Option<&StakeState>`)
  - [ ] Tests: `multisig_consensus.rs` (35 tests), `undo_log.rs` (100+ tests)

- [ ] **Phase 3 + Phase 2**: Merge performance (MODERATE COMPLEXITY)
  - [ ] explorer.rs: `persist_all(&mut mesh)` + incremental log calls
  - [ ] node.rs: `log` + `pending` fields, `note_inserted()` everywhere
  - [ ] store.rs: `open_with_hybrid()`, `insert_raw_block()` replay
  - [ ] Tests: `incremental_persistence.rs` (roundtrip, hybrid mode)

- [ ] **Phase 4+**: Remaining branches (verify no new conflicts)

---

## Testing Strategy

After each phase merge:

```bash
# Unit tests (run all crate tests)
cargo test --all

# Integration tests (full stack)
cargo test -p kovanica-node --test incremental_persistence
cargo test -p kovanica-node --test explorer
cargo test -p kovanica-state --test undo_log
cargo test -p kovanica-state --test multisig_consensus
cargo test -p kovanica-dag --test block_pruning
cargo test -p kovanica-dag --test vrf

# Fuzzing (optional, long-running)
cargo test --test fuzz --release
```

---

## Estimated Merge Complexity

| Phase | Branches | Conflicts | Complexity | Est. Time |
|-------|----------|-----------|-----------|-----------|
| 1 | 1 | Low (docs, explorer) | 30 min | 1 hour |
| 2 | 1 | **HIGH** (dag, ledger) | 3-4 hours | 4-5 hours |
| 3 | 1 | Medium (node, store) | 1-2 hours | 2-3 hours |
| 4-5 | 5+ | Low-Medium | 1-2 hours | 2-3 hours |
| Integration tests | - | - | - | 2-3 hours |
| **TOTAL** | **20** | **~10-15** | **Multi-phase** | **11-17 hours** |

---

## Next Steps

1. **User Approval** (required): Confirm staged merge + testing workflow
2. **Create PR Branch**: `git checkout -b merge/phases-1-to-20`
3. **Execute Phase 1 Merge**: Resolve doc/explorer conflicts
4. **Run Phase 1 Tests**: Verify no regressions
5. **Execute Phase 2 Merge**: Resolve consensus/state conflicts (MOST COMPLEX)
6. **Run Phase 2 Tests**: `undo_log.rs` + `multisig_consensus.rs`
7. **Continue Phases 3+**: Following the dependency order
8. **Final Integration Tests**: Full test suite on merged main
9. **Create PR**: Link to this preview, request review

---

## Risk Mitigation

- **Backup**: Tag current `main` as `backup/pre-multi-phase-merge`
- **Reversibility**: Each phase is a separate commit; can revert if tests fail
- **Validation**: Integration tests run after every phase
- **Documentation**: This preview serves as conflict resolution guide
- **Fallback**: If merge fails, can re-merge phases individually into PRs

---

**Status**: ⏸ **HALTED** — Awaiting user confirmation to proceed with Phase 1 merge.
