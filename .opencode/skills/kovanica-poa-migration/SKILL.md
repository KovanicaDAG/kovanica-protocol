---
name: kovanica-poa-migration
description: Implements the PoA-only consensus migration for Kovanica: removes PoW/hybrid code, deploys seed3, fixes metrics, writes PoA adversarial tests. Use when executing the ratified PoA-only migration plan (RFC-POA-Migration §0).
license: MIT
compatibility: opencode
---

# Kovanica PoA Migration Implementation

## When to use
- Executing the ratified PoA-only consensus migration (RFC-POA-Migration §0, ratified 2026-09-25)
- This is a **consensus-breaking hard fork** requiring coordinated implementation across `kovanica-dag`, `kovanica-state`, `kovanica-node`, `kovanica-ffi`

## Steps / Rules

### Phase 1: PoA Code Removal (Consensus-Critical)
1. **Remove PoW surface** (§0.1 table): `Dag::set_proof_of_work`, `set_difficulty`, `proof_of_work_enabled`, `clear_difficulty`, `DagError::InsufficientProofOfWork`/`DifficultyMismatch`, `pow.rs`, `difficulty.rs`, `KOVANICA_POW`, mining loop, RPC `kind: "pow"`, FFI `BlockKind::Pow`, `pow`/`pow-vrf` cargo features
2. **Remove Hybrid/Staked-VRF surface** (§0.7.1 table): `HybridConfig`, `StakedVrf`, `Ledger::set_hybrid`/`hybrid_enabled`, mutual exclusion, `stake_nominal_work`, `insert_with_vrf`, `KOVANICA_HYBRID`, stake registry `stake.rs`, unbond path, FFI hybrid/staking surface, `_with_hybrid` readers, `apply_block_with_stake`, `kind: "staked"`
3. **Delete/split test suites** (§0.7.1 table): Delete pure hybrid suites (`hybrid.rs`, `hybrid_node.rs`, `unbond_node.rs`); split mixed suites (`incremental_persistence.rs`, `undo_log_adversarial.rs`); update surviving suites (`poa_ledger.rs`, `poa_node.rs`, `explorer_detail.rs`, `ffi.rs`, `node_hot_paths.rs`)
4. **Regenerate Kotlin/Swift FFI bindings** after FFI surface changes
5. **Run `cargo check`, `cargo test`, `cargo clippy`** after each crate modification

### Phase 2: Seed3 Deployment (Operations)
1. Re-point `seed3.kovanica.online` DNS A record → `187.7.27.139` (DNS-only/grey-cloud)
2. Provision and start node on `srv2013143` (VPS `187.7.27.139`)
3. Install fail2ban on seed3
4. Verify TCP 9000 serves, P2P peering with seed1/seed2, metrics on :9090

### Phase 3: Metrics Fixes (Observability)
1. Fix `kovanica_peer_count` metric (reports 0 despite mesh peers)
2. Enable DHT/reorg/sync/validation metrics emission
3. Verify all 3 seeds expose `/metrics` publicly with correct data

### Phase 4: PoA Adversarial Tests (Test Coverage Gate)
Per §0.7.3, implement tests covering:
- `wrong_producer` (valid sig from unscheduled authority)
- `double_sign` / slot violation
- `stale_slot`
- `missing_authority_sig`
- `work_inflation` (work ≠ `POA_NOMINAL_WORK` — regression for §6.1(b))
- `authority_update_abuse` (malformed/replayed `AuthorityUpdateTx`)

## Output
- All `[TARGET]` items from RFC-POA-Migration §0.1 and §0.7.1 implemented
- Seed3 live and peering
- Metrics armed and correct
- PoA adversarial test suite passing
- Workspace builds clean: `cargo check && cargo test && cargo clippy --all-targets -D warnings`

## Risk Register
- **Consensus-breaking**: Every removal changes block admission. Test exhaustively.
- **FFI bindings**: Must regenerate Kotlin/Swift in same commit as FFI changes.
- **Test suite splits**: Do not lose non-hybrid coverage when splitting mixed suites.
- **Seed3 DNS**: Must be grey-cloud (DNS-only), not orange-cloud, for P2P port 9000.