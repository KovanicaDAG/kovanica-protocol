# Handoff Report — survey_explorer_2

**Task**: Consensus, State, PoW/Difficulty, and SPV Architecture Survey  
**Date**: 2026-08-24  
**Working Directory**: `/root/kovanica-protocol/.agents/survey_explorer_2`  

---

## 1. Observation

1. **`Block` Structure and ID Calculation**:
   - `crates/kovanica-dag/src/block.rs:91-123`:
     ```rust
     pub struct Block {
         id: BlockId,
         parents: Vec<BlockId>,
         work: u128,
         timestamp_ms: u64,
         nonce: u64,
         vrf_public_key: Option<VrfPublicKey>,
         vrf_proof: Option<VrfProof>,
         vrf_output: Option<VrfOutput>,
         payload: Option<Vec<u8>>,
     }
     ```
   - `crates/kovanica-dag/src/block.rs:316-342`: `compute_id` hashes `parents.len()`, `parents`, `work`, `timestamp_ms`, `nonce`, `vrf` fields, and `payload.len()` + raw `payload` bytes using BLAKE3.
   - `Block::prune_payload` (`block.rs:359-361`) sets `payload = None` without altering `id`.

2. **Existing SPV Primitives in `kovanica-state`**:
   - `crates/kovanica-state/src/spv.rs:43-62`: `BlockHeader` for SPV contains `id`, `prev_hash`, `merkle_root`, `work`, `timestamp_ms`, `nonce`, `blue_score`, `chain_blue_work`, `height`.
   - `crates/kovanica-state/src/spv.rs:179-209`: `merkle_root(txs: &[Transaction]) -> [u8; 32]` computes standard BLAKE3 Merkle roots over `tx.id().as_bytes()`, duplicating odd leaves.
   - `crates/kovanica-state/src/spv.rs:213-246`: `MerkleProof` contains `tx_id`, `merkle_root`, `path`, `index`, `tx_count`, and implements `verify(&self) -> bool`.
   - `crates/kovanica-state/src/spv.rs:249-292`: `generate_merkle_proof(txs, index)` generates the Merkle path.
   - `crates/kovanica-state/src/spv.rs:413-512`: `SpvClient` tracks verified headers, validating PoW, height increment, prev_hash linking, timestamp monotonicity, and difficulty retargeting.

3. **Difficulty Retargeting & PoW**:
   - `crates/kovanica-dag/src/difficulty.rs:70-100`: `Retarget::next_work(&self, recent: &[TimedWork]) -> u128` scales average work by `expected / actual` timespan over `window + 1` samples, clamped to `[avg / max_factor, avg * max_factor]` and floored at `min_work`.
   - `crates/kovanica-dag/src/pow.rs:38-82`: `meets_target(id, work)` verifies `H * work < 2^256` via 64-bit limb arithmetic.
   - `crates/kovanica-dag/src/dag.rs:567-596`: `Dag::check_difficulty` enforces that `block.timestamp_ms >= parent.timestamp_ms` for all parents, and `block.work == retarget.next_work(&chain_samples(sp, window))`.

4. **Timestamp Rules & Wall-Clock Future Drift**:
   - `crates/kovanica-node/src/node.rs:29`: `const MAX_FUTURE_DRIFT_MS: u64 = 2 * 60 * 60 * 1000;` (2 hours).
   - `crates/kovanica-node/src/node.rs:884-890`: `Node::receive_block` rejects blocks if `timestamp_ms > now_ms + MAX_FUTURE_DRIFT_MS` (`NodeError::TimestampTooFarInFuture`).
   - `crates/kovanica-node/src/node.rs:243-250`: `Node::next_timestamp` clamps block creation timestamp to `now_ms.max(max(parent.timestamp_ms) + 1)`.

5. **Existing Wire Frames in `kovanica-node`**:
   - `crates/kovanica-node/src/relay.rs:19-39`: `RelayMsg` currently supports `Hello` (tag 0), `Block` (tag 1), `Tx` (tag 2).
   - `crates/kovanica-node/src/net.rs:355-360`: defines tags for `TAG_INVENTORY` (0x10), `TAG_HEADERS` (0x11), `TAG_GETHEADERS` (0x12), `TAG_GETBODIES` (0x13), `TAG_BODIES` (0x14).

---

## 2. Logic Chain

1. **Header Representation & SPV Scope**:
   - From Observation 1 & 2, `Block` in `kovanica-dag` hashes the full payload directly into `BlockId`, while `kovanica-state::spv::BlockHeader` commits to the transactions via `merkle_root: [u8; 32]`.
   - Light clients / SPV nodes only download `BlockHeader`s and can verify transaction inclusion against the header's `merkle_root` without downloading the full transaction payload.
2. **Merkle Proof Generation & Verification Readiness**:
   - From Observation 2, `kovanica-state::spv` already provides complete, tested implementations for `merkle_root`, `MerkleProof`, `generate_merkle_proof`, and `SpvClient`.
   - Therefore, implementing SPV wire support does not require building new cryptographic hashing or Merkle tree primitives from scratch; it requires wiring these existing primitives into the P2P messages (`getheaders`, `headers`, `getblocks`, `merkleblock`) in `kovanica-node`.
3. **Verification Constraints for SPV Clients**:
   - From Observation 3 & 4, an SPV client verifying headers must check:
     a) PoW target compliance (`meets_target(&header.id, header.work)`).
     b) Difficulty retargeting against the historical window (`retarget.next_work(&window)`).
     c) Timestamp monotonicity (`header.timestamp_ms >= prev_header.timestamp_ms`).
     d) Wall-clock future drift (`header.timestamp_ms <= now_ms + MAX_FUTURE_DRIFT_MS`).
4. **Integration with Relay & Mesh**:
   - From Observation 5, `RelaySession` and `Mesh` currently only frame `Hello`, `Block`, and `Tx`. Extending them with `GetHeaders`, `Headers`, `GetBlocks`, and `MerkleBlock` completes the SPV wire protocol requirement.

---

## 3. Caveats

1. **DAG vs. Selected Chain SPV**:
   - The current `kovanica-state::spv::SpvClient` focuses on linear selected-chain headers (`prev_hash`, `height`). For a full BlockDAG, headers carry `parents: Vec<BlockId>`. The SPV client can verify headers along DAG parent paths or along the GHOSTDAG selected chain.
2. **VRF Verification in SPV**:
   - VRF proofs are present in `Block` when VRF is enabled, but `spv::BlockHeader` currently omits VRF fields. If VRF consensus enforcement is enabled, header verification could optionally include VRF fields.
3. **No Existing Wire `merkleblock`**:
   - No `merkleblock` wire format exists yet in `relay.rs` or `net.rs`. It must be added as a new message variant.

---

## 4. Conclusion

- The cryptographic and data structure foundations for SPV (`merkle_root`, `MerkleProof`, `generate_merkle_proof`, `SpvClient`, `Retarget`, `meets_target`) are already implemented and tested in `kovanica-state::spv` and `kovanica-dag`.
- The consensus difficulty rules (`Retarget::next_work`) and timestamp monotonicity (`block.ts >= parent.ts`) are strictly deterministic. The 2-hour future drift limit (`MAX_FUTURE_DRIFT_MS`) is node policy and must be checked against the client/node clock.
- To fulfill the project requirements, `kovanica-node` must:
  1. Add `GetHeaders`, `Headers`, `GetBlocks`, and `MerkleBlock` messages to `RelayMsg` and `Mesh`.
  2. Implement full-node responders that construct `MerkleProof`s and `merkleblock` payloads from requested block IDs and transactions.
  3. Implement an SPV client wire handler and integration test (`tests/spv_sync.rs`).

---

## 5. Verification Method

- Inspect analysis and code locations:
  - `crates/kovanica-dag/src/block.rs` (Block struct & compute_id)
  - `crates/kovanica-dag/src/difficulty.rs` (Retarget::next_work)
  - `crates/kovanica-dag/src/pow.rs` (meets_target & mine)
  - `crates/kovanica-state/src/spv.rs` (merkle_root, MerkleProof, SpvClient)
  - `crates/kovanica-node/src/node.rs` (MAX_FUTURE_DRIFT_MS & timestamp checks)
- Verify workspace tests:
  ```bash
  cargo test
  cargo clippy --all-targets
  ```
