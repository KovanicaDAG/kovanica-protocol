# Kovanica Protocol Test Results

## Workspace Tests

### Checkpoint Restoration
- **Finality Checkpointing (RPC)**: ✅ Passed
  - Fixed tip segment logic: `write_checkpoint` now properly targets the block at exactly the `finality_score` instead of erroneously tracking all the way to the tip of the DAG. 
  - Restored ledger accurately resumes with `[299, 149, 39, 4]` balance states and correctly processes subsequent transactions. 
  - File: `crates/kovanica-node/tests/rpc.rs`

### VRF and Mempool Checkpoints
- **VRF Serialization**: ✅ Passed
- **Mempool Checkpoints**: ✅ Passed
- **SPV Proofs Checkpoints**: ✅ Passed (headers-first sync + Merkle proofs + filters shipped; wire suite green in `crates/kovanica-node/tests/spv_sync.rs`)

All DAG and Ledger invariants have proven completely resilient to full roundtrips and checkpointing!
