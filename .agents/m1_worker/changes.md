# Changes Implemented: SPV Wire Protocol, Full Node Handlers & Light Client Engine

**Author**: `m1_worker`  
**Date**: 2026-08-24  
**Milestone**: Milestone 1 — SPV Wire Protocol & Light Client Engine

---

## 1. Summary of Changes

Implemented the complete end-to-end Simplified Payment Verification (SPV) wire protocol and light client engine for `kovanica-node`:
1. **SPV Wire Protocol Encodings & Framing** (`crates/kovanica-node/src/relay.rs`, `crates/kovanica-node/src/net.rs`):
   - Extended `RelayMsg` with variants: `GetHeaders`, `Headers`, `GetBlocks`, `GetMerkleProof`, and `MerkleBlock`.
   - Defined wire message tags (`TAG_HEADERS = 0x11`, `TAG_GETHEADERS = 0x12`, `TAG_GETBLOCKS = 0x13`, `TAG_GET_MERKLE_PROOF = 0x15`, `TAG_MERKLEBLOCK = 0x16`).
   - Implemented binary serialization in `encode_msg` and bounded, defensive deserialization in `decode_msg` with `Cursor` length checks (`read_count(min_element_bytes)`), buffer bounds (`MAX_FRAME = 4MB`, `MAX_HEADERS = 10,000`, `MAX_LOCATOR_IDS = 1,000`, `MAX_MERKLE_PATH = 64`).
   - Implemented `handle_relay_query` query dispatcher and updated `apply_relay` to pass through SPV messages.

2. **Full Node SPV Serving Capabilities** (`crates/kovanica-node/src/node.rs`):
   - Defined `MerkleBlock` struct containing `block_id`, `merkle_root`, `tx_count`, `proof`, and `matched_tx`.
   - Implemented `Node::spv_header(&self, id: &BlockId) -> Option<kovanica_state::spv::BlockHeader>` converting internal GHOSTDAG DAG and block structures to canonical 160-byte SPV headers.
   - Implemented `Node::export_spv_headers(&self) -> Vec<kovanica_state::spv::BlockHeader>` exporting the selected chain as SPV headers.
   - Implemented `Node::headers_from(&self, locator: &[BlockId], stop: Option<BlockId>, limit: usize) -> Result<Vec<kovanica_state::spv::BlockHeader>, NodeError>` efficiently finding the highest common ancestor and streaming consecutive headers up to `stop` or `limit`.
   - Implemented `Node::merkle_block(&self, block_id: &BlockId, tx_id: &TxId) -> Result<MerkleBlock, NodeError>` producing Merkle sibling inclusion proofs with zero full-payload leakage.

3. **Light Client Wire Sync Module** (`crates/kovanica-node/src/spv.rs`, `crates/kovanica-node/src/lib.rs`):
   - Created `crates/kovanica-node/src/spv.rs` providing:
     - `build_locator(client: &SpvClient) -> Vec<BlockId>` for exponential backoff block locator generation.
     - `sync_headers_via_relay` and `sync_headers_via_relay_with_clock` for light client header synchronization over persistent TCP `RelaySession` connections.
     - `request_merkle_block` for querying transaction inclusion proofs over TCP.
     - `verify_merkle_block` for validating Merkle proofs against synced SPV headers.
   - Re-exported all SPV types and functions in `crates/kovanica-node/src/lib.rs`.

4. **Testing Suite** (`crates/kovanica-node/tests/spv_sync.rs` & unit tests):
   - Added unit tests in `node.rs`, `relay.rs`, and `spv.rs`.
   - Created comprehensive 6-scenario E2E integration test suite in `crates/kovanica-node/tests/spv_sync.rs` testing TCP loopback header sync, Merkle proof verification, difficulty retargeting bounds, wall-clock future drift boundary ($\le 2\text{h}$), tampered proof detection, and mobile wallet workflow.

---

## 2. File-by-File Breakdown

| File | Type | Changes Description |
|---|---|---|
| `crates/kovanica-node/src/relay.rs` | Modified | Added SPV tags (`0x11`, `0x12`, `0x13`, `0x15`, `0x16`), bounds constants (`MAX_HEADERS`, `MAX_LOCATOR_IDS`, `MAX_MERKLE_PATH`), extended `RelayMsg`, implemented binary `encode_msg` / `decode_msg`, `handle_relay_query`, and unit tests. |
| `crates/kovanica-node/src/node.rs` | Modified | Derived `PartialEq, Eq` on `BlockRecord`, added `MerkleBlock` struct, added `spv_header`, `export_spv_headers`, `headers_from`, `merkle_block` methods, and unit tests. |
| `crates/kovanica-node/src/net.rs` | Modified | Exposed SPV wire message tags `TAG_GET_MERKLE_PROOF` and `TAG_MERKLEBLOCK`. |
| `crates/kovanica-node/src/spv.rs` | Created | Light client wire sync logic: `build_locator`, `sync_headers_via_relay`, `sync_headers_via_relay_with_clock`, `request_merkle_block`, `verify_merkle_block`, and unit tests. |
| `crates/kovanica-node/src/lib.rs` | Modified | Added `pub mod spv;` and re-exports for `MerkleBlock`, `handle_relay_query`, and SPV sync helpers. |
| `crates/kovanica-node/tests/spv_sync.rs` | Created | Dedicated E2E integration test suite covering TCP header sync, Merkle proof verification, difficulty retargeting, future drift limits, tampered proof rejection, and mobile wallet payment receipt. |

---

## 3. Verification Commands & Results

- **`cargo fmt --check`**: Passed with 0 violations.
- **`cargo clippy --all-targets`**: Passed with 0 warnings in modified files.
- **`cargo check --all-targets`**: Passed with code 0.
- **`cargo test -p kovanica-node`**: 58 unit tests passed + all integration test suites passed.
- **`cargo test -p kovanica-node --test spv_sync`**: All 6 E2E integration tests passed.
- **`cargo test`**: 100% workspace tests passed across all crates (`kovanica-dag`, `kovanica-state`, `kovanica-node`, doc-tests).
