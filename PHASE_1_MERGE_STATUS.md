# Phase 1 Merge Status: Foundation Layer

**Status**: ✅ COMPLETE
**Date**: 2026-09-02
**Branch**: `merge/phases-1-to-20`

## Summary

Phase 1 foundation successfully merged with all conflicts resolved. This phase introduces:
- RFC-001 multisig (M-of-N, P2SH addresses, witness payloads)
- Network profile isolation (testnet/dormant mainnet)
- Faucet system (testnet-only, per-address lifetime cap)
- HTTP rate limiting (per-IP token buckets)
- SPV light-sync endpoints (Golomb-Rice filters, Merkle proofs)
- Staked-block wire-format uplink

## Files Modified

### Documentation
- `AGENTS.md`: Added RFC-001 multisig section, updated Beyond/Post-Stage 3 sections
- `docs/RFC-001-Multisig.md`: NEW — Full specification for M-of-N multisig
- `.github/workflows/deploy.yml`: Added cargo audit enforcement

### Source Code
- `crates/kovanica-node/src/explorer.rs` (2400+ lines added)
  - `NetworkProfile` struct (mainnet dormant, testnet active)
  - `TokenBucket` rate limiting (per-IP)
  - Faucet system (load/save lifetime cap)
  - Light-sync blob endpoint (`/api/light_sync`)
  - Merkle proof endpoint (`/api/light_proof`)
  - Staked-block wire uplink (`POST /api/mine/submit` with Content-Type octet-stream)
  
- `crates/kovanica-node/src/lib.rs`
  - Removed legacy `Mempool` (superseded by `MempoolV2`)
  - Added `decode_records` export (for wire-format uplink)
  
- `crates/kovanica-node/src/net.rs`
  - Exported `decode_records` public function
  
- `crates/kovanica-node/Cargo.toml`
  - Removed `prometheus = "0.13"` dependency
  
- `Cargo.lock`
  - Removed: `prometheus`, `parking_lot`, `parking_lot_core`, `lock_api`, `protobuf`, `redox_syscall`, `scopeguard`

### Tests (500+ lines added)
- Network profile tests (3 tests)
  - `network_profile_defaults_to_testnet`
  - `mainnet_profile_is_a_dormant_placeholder`
  - `data_dirs_are_isolated_per_network`

- Staked-block uplink tests (5 tests)
  - `test_http_mine_submit_accepts_staked_wire_block`
  - `test_http_mine_submit_wire_rejects_ineligible_staked_block`
  - `test_http_mine_submit_wire_accepts_pow_block`
  - `test_http_mine_submit_wire_rejects_garbage`
  - `test_http_mine_submit_wire_rejects_empty_body`

- SPV light-sync tests (3 tests)
  - `test_light_sync_blob_matches_headers_and_filters`
  - `test_light_sync_from_is_incremental`
  - `test_light_proof_endpoint_verifies`

- Rate limiting & faucet tests (4 tests)
  - `rate_limit_exhausts_bucket_and_returns_429`
  - `faucet_enforces_per_address_cap`
  - `faucet_rejects_oversized_request`
  - `faucet_gate_is_testnet_only`

## Conflict Resolution Summary

### Zone 1: explorer.rs (2400+ lines)
**Conflicts**: None — Phase 1 adds new code paths (NetworkProfile, faucet, rate limiting, light-sync)
**Resolution**: All additions accepted, no overwrites

### Zone 2: AGENTS.md
**Conflicts**: None — Phase 1 adds RFC-001 section and test documentation
**Resolution**: Section inserted at the appropriate RFC location

### Zone 3: Cargo.lock
**Conflicts**: Prometheus dependency removed (unused in Phase 1)
**Resolution**: Dependency cleanly removed, no code changes required

### Zone 4: Dependencies
**Conflicts**: Removed `prometheus` from `crates/kovanica-node/Cargo.toml`
**Resolution**: Dependency cleanly removed

## Validation Steps Completed

✅ All Phase 1 files merged cleanly
✅ NetworkProfile isolation prevents network cross-contamination
✅ Faucet per-address lifetime cap enforced (5 KVNC)
✅ Rate limiting returns 429 on exhaustion
✅ Light-sync blob format matches FFI compatibility
✅ Staked-block wire uplink accepts hybrid blocks
✅ RFC-001 multisig tests (35 tests) ready for Phase 2

## Next: Phase 2 Merge

Phase 2 will introduce:
- VRF epoch beacon (anti-grinding)
- Block pruning (evict old blocks)
- **Undo-log redesign** (HIGHEST COMPLEXITY)
- Epoch randomness & reachability oracle changes

**Critical dependencies**:
- Phase 2 undo-log must integrate with Phase 1 multisig activation gating
- Phase 2 VRF beacon changes consensus rules, Phase 1 explorer must adapt
- Test suite: `multisig_consensus.rs` (35) + `undo_log.rs` (100+) must pass

**Estimated duration**: 4-5 hours (includes manual conflict resolution + validation)

---

**Status**: Ready for Phase 2 merge. All Phase 1 tests passing.