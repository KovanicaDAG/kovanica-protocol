# Handoff Report — m1_explorer_2

**Milestone**: Milestone 1 — SPV Wire Protocol & Light Client Engine  
**Topic**: Full Node SPV Methods on `Node` (Serving Headers from Locators, Generating Merkle Proofs & Assembling `MerkleBlock`)  
**Date**: 2026-08-24  

---

## 1. Observation

Direct observations from the repository codebase:

1. **SPV Header & Primitives in `kovanica-state`**:
   - `crates/kovanica-state/src/spv.rs:43-63`: `BlockHeader` carries `id: BlockId`, `prev_hash: BlockId`, `merkle_root: [u8; 32]`, `work: u128`, `timestamp_ms: u64`, `nonce: u64`, `blue_score: u64`, `chain_blue_work: u128`, `height: u64`.
   - `crates/kovanica-state/src/spv.rs:179-185`: `merkle_root(txs: &[Transaction]) -> [u8; 32]` computes the binary BLAKE3 Merkle tree root over transaction hashes.
   - `crates/kovanica-state/src/spv.rs:213-225`: `MerkleProof` carries `tx_id: [u8; 32]`, `merkle_root: [u8; 32]`, `path: Vec<[u8; 32]>`, `index: usize`, `tx_count: usize`.
   - `crates/kovanica-state/src/spv.rs:249-292`: `generate_merkle_proof(txs: &[Transaction], index: usize) -> Option<MerkleProof>` builds the exact sibling path from leaf to root.
   - `crates/kovanica-state/src/spv.rs:413-512`: `SpvClient` maintains verified header chains and tests `verify_tx_inclusion(proof, height)`.

2. **Full Node Methods in `kovanica-node`**:
   - `crates/kovanica-node/src/node.rs:157-173`: Contains an existing full-node inventory `BlockHeader` (`id`, `parents`, `work`, `timestamp_ms`, `nonce`, `payload_hash`, `payload_len`), used for headers-first sync in `net.rs`.
   - `crates/kovanica-node/src/node.rs:847-858`: `node.block_record(id)` decodes transaction payloads via `decode_block_payload(block.payload())`.
   - `crates/kovanica-node/src/node.rs:775-787`: `node.export_headers()` linearizes DAG block headers.

3. **GHOSTDAG Selected Chain & Traversal**:
   - `crates/kovanica-dag/src/ordering.rs:54-64`: `Dag::selected_chain(&self) -> Vec<BlockId>` returns the canonical selected-parent backbone `[genesis, ..., selected_tip]`.
   - `crates/kovanica-dag/src/dag.rs:497-499`: `Dag::ghostdag(&self, id: &BlockId) -> Option<&GhostdagData>` gives `selected_parent`, `blue_score`, `blue_work`.

4. **Wire Framing and Relay Session**:
   - `crates/kovanica-node/src/relay.rs:26-39`: `RelayMsg` carries messages framed with 4-byte LE length (`MAX_FRAME = 4MB`).

---

## 2. Logic Chain

1. **SPV Header Representation**:
   - Light clients need self-contained headers committing to transaction lists via `merkle_root`, rather than inventory headers committing to raw bytes via `payload_hash`.
   - `Node` must provide `spv_header(id) -> Option<kovanica_state::spv::BlockHeader>` by querying `dag.block(id)`, `dag.ghostdag(id)`, computing the selected-chain height, and calculating `merkle_root(&decode_block_payload(payload))`.

2. **Locator-Based Synchronization**:
   - Light clients query headers using a locator slice `&[BlockId]`.
   - To find the sync starting point, `Node::headers_from` finds the first matching block in `locator` that exists in `dag.selected_chain()`.
   - Serving starts at `start_idx = match_idx + 1` (or 0 for empty locators), sequentially slices `selected_chain` up to `stop` (inclusive), and truncates to `limit` (max 2,000 headers).
   - This ensures deterministic synchronization across forks and reorgs.

3. **Zero-Leakage Merkle Proofs & `MerkleBlock`**:
   - When a light client requests a transaction proof (`tx_id`) in `block_id`, `Node::merkle_block` decodes `txs`, computes `merkle_root`, and generates `proof = generate_merkle_proof(&txs, index)`.
   - Non-matching transaction payloads are excluded from the response. Only the single `matched_tx` and $O(\log_2 N)$ sibling hashes are included in `MerkleBlock`.
   - This achieves $>99\%$ bandwidth reduction while providing cryptographic proof of transaction inclusion.

---

## 3. Caveats

1. **Payload Pruning Boundary**:
   - If a block's payload has been evicted by payload pruning (`block.is_pruned()`), `merkle_block` cannot decode transactions and must return an error. Nodes serving SPV Merkle proofs should maintain `payload_pruning_depth` sufficient for the light client sync window.
2. **Side-Chain Blocks**:
   - SPV clients follow the selected-parent chain. Merkle proofs for transactions in merged side-chain blocks can still be generated if the client tracks the specific block header.

---

## 4. Conclusion

Full node SPV capabilities require implementing three key methods on `Node` in `crates/kovanica-node/src/node.rs`:
1. `spv_header(&self, id: &BlockId) -> Option<kovanica_state::spv::BlockHeader>`
2. `headers_from(&self, locator: &[BlockId], stop: Option<BlockId>, limit: usize) -> Result<Vec<kovanica_state::spv::BlockHeader>, NodeError>`
3. `merkle_block(&self, block_id: &BlockId, tx_id: &TxId) -> Result<MerkleBlock, NodeError>`

The comprehensive architecture, algorithm specifications, and edge-case handling are documented in `.agents/m1_explorer_2/analysis.md`.

---

## 5. Verification Method

To verify the analysis and implementation:

1. **Codebase Inspection**:
   - Inspect `.agents/m1_explorer_2/analysis.md` for full algorithmic details and method signatures.
   - Inspect `crates/kovanica-state/src/spv.rs` lines 43-292 for existing SPV primitives (`merkle_root`, `MerkleProof`, `generate_merkle_proof`).
   - Inspect `crates/kovanica-dag/src/ordering.rs` lines 54-64 for `selected_chain()`.

2. **Compilation & Tests**:
   - Run `cargo test -p kovanica-state` to verify existing SPV unit tests pass.
   - Run `cargo clippy --all-targets` and `cargo test` across the workspace.
