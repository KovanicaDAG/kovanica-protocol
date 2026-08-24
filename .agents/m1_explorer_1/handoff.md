# Handoff Report — m1_explorer_1: SPV Wire Protocol & Light Client Engine Analysis

**Milestone**: Milestone 1 — SPV Wire Protocol & Light Client Engine  
**Agent**: `m1_explorer_1`  
**Date**: 2026-08-24  
**Working Directory**: `/root/kovanica-protocol/.agents/m1_explorer_1`  

---

## 1. Observation

Direct code observations from the workspace:

1. **Persistent TCP Relay Framing & Existing `RelayMsg`**:
   - In `crates/kovanica-node/src/relay.rs` (lines 19–39), messages are framed with a 4-byte little-endian length prefix `[len: u32_le][payload: bytes]` where `MAX_FRAME = 4 * 1024 * 1024` (4 MB).
   - Currently, `RelayMsg` defines three variants:
     ```rust
     const TAG_HELLO: u8 = 0;
     const TAG_BLOCK: u8 = 1;
     const TAG_TX: u8 = 2;

     pub enum RelayMsg {
         Hello { from: String, advertised: Vec<String> },
         Block(BlockRecord),
         Tx(Transaction),
     }
     ```

2. **Sync Message Tags & Defensive Reader**:
   - In `crates/kovanica-node/src/net.rs` (lines 355–365), high-byte tags are used for sync:
     `TAG_INVENTORY = 0x10`, `TAG_HEADERS = 0x11`, `TAG_GETHEADERS = 0x12`, `TAG_GETBODIES = 0x13`, `TAG_BODIES = 0x14`.
   - `Cursor::read_count` (lines 325–331) performs defensive pre-allocation bounds checking:
     `n > self.remaining() / min_element_bytes` returns `NetError::Decode("count too large")`.

3. **SPV Foundation in `kovanica-state`**:
   - In `crates/kovanica-state/src/spv.rs`:
     - `BlockHeader` (lines 43–62) contains `id: BlockId`, `prev_hash: BlockId`, `merkle_root: [u8; 32]`, `work: u128`, `timestamp_ms: u64`, `nonce: u64`, `blue_score: u64`, `chain_blue_work: u128`, `height: u64` (fixed size: 160 bytes).
     - `merkle_root` (lines 179–209) and `generate_merkle_proof` / `MerkleProof::verify` (lines 213–292) implement BLAKE3 binary Merkle trees with odd-count leaf duplication.
     - `SpvClient` (lines 413–512) verifies header chain continuity, proof-of-work (`meets_target`), and difficulty retargeting (`Retarget::next_work`).

4. **Node Serving Capabilities**:
   - In `crates/kovanica-node/src/node.rs`:
     - `node.receive_block` (line 885) enforces `MAX_FUTURE_DRIFT_MS = 2 * 60 * 60 * 1000` (2 hours).
     - `node.block_record(id)` (line 847) returns `Option<BlockRecord>`.
     - `node.export_headers()` (line 775) exports untrusted inventory headers, but `Node` currently lacks SPV-specific header export along the selected chain and Merkle proof generation helpers.

---

## 2. Logic Chain

1. **Requirement Deduction (SPV Wire Messages)**:
   - To fulfill R1 (`ORIGINAL_REQUEST.md`) and the contract in `PROJECT.md`, `RelayMsg` must be extended to carry SPV queries and responses over persistent TCP connections:
     - `RelayMsg::GetHeaders { locator: Vec<BlockId>, stop_hash: Option<BlockId>, max_count: u32 }` (Tag `0x12`)
     - `RelayMsg::Headers { headers: Vec<SpvHeader> }` (Tag `0x11`)
     - `RelayMsg::GetBlocks { locator: Vec<BlockId>, stop_hash: Option<BlockId> }` (Tag `0x13`)
     - `RelayMsg::GetMerkleProof { block_id: BlockId, tx_id: TxId }` (Tag `0x15`)
     - `RelayMsg::MerkleBlock { block_id: BlockId, merkle_root: [u8; 32], tx_count: u32, proof: Option<MerkleProof>, matched_tx: Option<Transaction> }` (Tag `0x16`)

2. **Binary Framing & Bounds Safety**:
   - Each `SpvHeader` is exactly 160 bytes. Decoding `Headers` frames requires `read_count(160)` to prevent allocation of unpopulated headers.
   - `GetHeaders` and `GetBlocks` locator counts are bounded by `MAX_LOCATOR_IDS = 1,000` and `read_count(32)`.
   - `MerkleProof` path length is bounded by `MAX_MERKLE_PATH = 64`.
   - Matched transactions are bounded by `MAX_TX_SIZE = 1MB` and decoded via `decode_block_payload`.

3. **Node Serving & Dispatching**:
   - Full nodes can resolve `GetHeaders` by finding the common ancestor between `locator` and `dag.selected_chain()`, extracting `SpvHeader`s up to `stop_hash` / `limit`.
   - Full nodes can resolve `GetMerkleProof` by querying `node.block_record(block_id)`, generating `generate_merkle_proof(&record.txs, idx)`, and returning `MerkleBlock`.
   - `handle_relay_query` dispatches these requests synchronously over the TCP stream.

4. **Light Client Verification State Machine**:
   - Light clients maintaining `SpvClient` can sync headers via `GetHeaders`/`Headers`, validating proof-of-work (`meets_target`), difficulty retargeting (`Retarget::next_work`), and timestamp drift ($\le 2\text{h}$).
   - Light clients verify transaction inclusion by checking `proof.merkle_root == header.merkle_root && proof.verify()` via `MerkleBlock`.

---

## 3. Caveats

1. **DAG Mergeset vs Selected Chain in SPV**:
   - The SPV client tracks headers along the GHOSTDAG **selected chain** (heaviest chain backbone). Transactions merged from side-blocks are finalized via the selected chain's virtual blocks or merger blocks; light clients verify proofs against the block committing the transaction.
2. **Payload Pruning Compatibility**:
   - If a full node prunes block payloads beyond `payload_pruning_depth`, it can still serve headers (`SpvHeader`), but cannot generate new Merkle proofs for transactions in pruned blocks unless pre-indexed. Full nodes serving SPV proofs must retain payloads for active proof queries.

---

## 4. Conclusion

The design for the SPV Wire Protocol and Light Client Engine in Milestone 1 is fully specified and validated against the existing codebase architecture:
- Binary layout, message tags (`0x11`, `0x12`, `0x13`, `0x15`, `0x16`), and defensive bounds checks are detailed in `/root/kovanica-protocol/.agents/m1_explorer_1/analysis.md`.
- Node serving APIs (`Node::headers_from`, `Node::spv_header`, `Node::merkle_block`), relay query handling (`handle_relay_query`), and SPV client wire sync methods are mapped out for implementation.
- All existing tests in the workspace pass (`cargo test` exited with code 0 across 8 test binaries and doc-tests).

---

## 5. Verification Method

To independently verify this analysis:

1. **Codebase Inspection**:
   - Inspect `crates/kovanica-node/src/relay.rs` for `RelayMsg` and framing tags.
   - Inspect `crates/kovanica-node/src/net.rs` for `read_count` and bounds checking.
   - Inspect `crates/kovanica-state/src/spv.rs` for `BlockHeader`, `MerkleProof`, and `SpvClient`.
   - Inspect `crates/kovanica-node/src/node.rs` for `MAX_FUTURE_DRIFT_MS` and block record management.

2. **Test Execution**:
   - Run the workspace test suite:
     ```bash
     cargo test
     ```
   - Run clippy lint check:
     ```bash
     cargo clippy --all-targets
     ```

3. **Detailed Specification Reference**:
   - View `/root/kovanica-protocol/.agents/m1_explorer_1/analysis.md`.
