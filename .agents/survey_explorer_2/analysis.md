# Detailed Analysis: Consensus, State & SPV Architecture

**Author**: `survey_explorer_2`  
**Target Area**: `crates/kovanica-dag`, `crates/kovanica-state`, and interaction with `crates/kovanica-node`  
**Date**: 2026-08-24  

---

## 1. Block Structure, Headers, and ID Computation

### 1.1 `Block` Definition in `kovanica-dag`
The core DAG vertex is defined in `crates/kovanica-dag/src/block.rs:91-123`:
```rust
pub struct Block {
    id: BlockId,                       // BLAKE3 digest ([u8; 32])
    parents: Vec<BlockId>,             // Sorted, de-duplicated parent block IDs
    work: u128,                        // Work weight / expected hashes (Nakamoto target)
    timestamp_ms: u64,                 // Milliseconds since UNIX epoch
    nonce: u64,                        // Proof-of-work search nonce
    vrf_public_key: Option<VrfPublicKey>, // 32 bytes producer public key
    vrf_proof: Option<VrfProof>,       // 96 bytes VRF evaluation proof
    vrf_output: Option<VrfOutput>,     // 32 bytes VRF randomness output
    payload: Option<Vec<u8>>,          // Opaque serialized transaction array (prunable)
}
```

### 1.2 Block ID Computation (`Block::compute_id`)
Located in `crates/kovanica-dag/src/block.rs:316-342`. The `BlockId` is the BLAKE3 digest of the canonical serialization of all header fields and the payload bytes:
1. `(parents.len() as u64).to_le_bytes()` (8 bytes)
2. `parent.as_bytes()` (32 bytes) for each parent in sorted order
3. `work.to_le_bytes()` (16 bytes, `u128`)
4. `timestamp_ms.to_le_bytes()` (8 bytes, `u64`)
5. `nonce.to_le_bytes()` (8 bytes, `u64`)
6. VRF fields:
   - If present: `[1u8]` + `pk.as_bytes()` (32B) + `proof.to_bytes()` (96B) + `output.as_bytes()` (32B)
   - If absent: `[0u8]` (1B)
7. `(payload.len() as u64).to_le_bytes()` (8 bytes)
8. Raw `payload` bytes (empty slice `&[]` if `payload.is_none()`)

> **Key Architectural Insight**: In `kovanica-dag`, the `Block` commits directly to raw `payload` bytes inside `BlockId`. When a block is finalized beyond `payload_pruning_depth`, `payload` becomes `None` (`block.rs:359-361`), but the immutable `id` is retained.

### 1.3 Block Header Variations in the Workspace
Two header structures exist in the repository serving distinct roles:

1. **`kovanica_node::node::BlockHeader`** (`crates/kovanica-node/src/node.rs:157-173`):
   - Used for full-node inventory advertising & headers-first sync (`net.rs:356, 401-465`).
   - Fields: `id: BlockId`, `parents: Vec<BlockId>`, `work: u128`, `timestamp_ms: u64`, `nonce: u64`, `payload_hash: [u8; 32]`, `payload_len: u64`.
   - `payload_hash` is `BLAKE3(payload)` where `payload = encode_block_payload(txs)`.

2. **`kovanica_state::spv::BlockHeader`** (`crates/kovanica-state/src/spv.rs:43-62`):
   - Designed specifically for SPV / Light Clients.
   - Fields: `id: BlockId`, `prev_hash: BlockId`, `merkle_root: [u8; 32]`, `work: u128`, `timestamp_ms: u64`, `nonce: u64`, `blue_score: u64`, `chain_blue_work: u128`, `height: u64`.
   - Created via `BlockHeader::from_block(block, prev_hash, blue_score, chain_blue_work, height, txs)` (`spv.rs:66-86`).

---

## 2. Transactions, Merkle Trees, Merkle Proofs & `merkleblock`

### 2.1 Transaction Model & Payload Encoding
Defined in `crates/kovanica-state/src/tx.rs`:
- **`Transaction`** (`tx.rs:139-144`):
  - `inputs: Vec<TxInput>` (outpoint `(TxId, u32)` + ed25519 signature `Sig([u8; 64])`)
  - `outputs: Vec<TxOutput>` (`value: u64`, `owner: Address`)
  - `tag: Vec<u8>` (used for coinbase height/identifier disambiguation)
- **`TxId`** (`tx.rs:266-268`): `BLAKE3` hash of the canonical signed transaction serialization (`tx.encode()`).
- **Payload Encoding**:
  - `encode_block_payload(txs: &[Transaction]) -> Vec<u8>` (`tx.rs:294-300`): `(txs.len() as u64).to_le_bytes()` + canonical encoding of each transaction.
  - `decode_block_payload(bytes: &[u8]) -> Result<Vec<Transaction>, DecodeError>` (`tx.rs:305-341`).

### 2.2 Merkle Tree & Proof Implementation in `kovanica-state`
The core SPV primitives already exist in `crates/kovanica-state/src/spv.rs`:

1. **Merkle Root Computation (`merkle_root`, `spv.rs:179-209`)**:
   - Leaves are transaction IDs (`tx.id().as_bytes()`).
   - Pairs adjacent hashes `H(left || right)` using BLAKE3.
   - For odd level counts, duplicates the last node `H(last || last)`.
   - Empty transactions list returns `[0u8; 32]`.

2. **Merkle Proof Generation & Verification (`MerkleProof`, `spv.rs:213-292`)**:
   - `MerkleProof` struct:
     ```rust
     pub struct MerkleProof {
         pub tx_id: [u8; 32],
         pub merkle_root: [u8; 32],
         pub path: Vec<[u8; 32]>,
         pub index: usize,
         pub tx_count: usize,
     }
     ```
   - `MerkleProof::verify(&self) -> bool`: Walks from `tx_id` up using `path`, concatenating `(current, sibling)` or `(sibling, current)` depending on `index % 2`, hashing with BLAKE3, and comparing final root to `merkle_root`.
   - `generate_merkle_proof(txs: &[Transaction], index: usize) -> Option<MerkleProof>` constructs the exact sibling path from leaf to root.

3. **`BlockFilter` (Golomb-Rice Coded Output Address Filters, `spv.rs:298-360`)**:
   - Allows light clients to test address matching before requesting full blocks or Merkle proofs.

### 2.3 `merkleblock` Requirements for P2P Wire Protocol
To satisfy **R1** and **R2** of `ORIGINAL_REQUEST.md`:
- Full nodes must provide a `merkleblock` wire message that responds to client requests (e.g. `getblocks` / `getdata`).
- The `merkleblock` message should contain:
  - The block's header (or block ID & header fields)
  - The block's `merkle_root` and total transaction count
  - The `MerkleProof`(s) for the matched transactions
  - Optionally, the matched `Transaction` objects themselves.
- The SPV client verifies the `merkleblock` by:
  1. Validating that the header is in its verified header chain/DAG.
  2. Verifying each transaction's `MerkleProof` against the header's `merkle_root`.

---

## 3. Difficulty Retargeting, Proof-of-Work & SPV Validation

### 3.1 Difficulty Retargeting (`kovanica_dag::difficulty::Retarget`)
Located in `crates/kovanica-dag/src/difficulty.rs:40-100`:
- **Parameters**: `target_interval_ms` (1,000 ms), `window` (20 intervals), `max_factor` (4x clamp), `min_work` (floor 1).
- **Algorithm (`Retarget::next_work`)**:
  1. Takes last `window + 1` samples (oldest first). If `< 2` samples, returns `min_work`.
  2. `expected = (samples.len() - 1) * target_interval_ms`.
  3. `actual = (samples.last().timestamp_ms - samples.first().timestamp_ms).max(1)`.
  4. `avg_work = sum(work) / samples.len()`.
  5. `scaled = (avg_work * expected) / actual`.
  6. Clamped to `[avg_work / max_factor, avg_work * max_factor]`, floored at `min_work`.

### 3.2 Proof-of-Work Verification (`kovanica_dag::pow::meets_target`)
Located in `crates/kovanica-dag/src/pow.rs:38-82`:
- **Condition**: `H * work < 2^256` where `H` is `BlockId` (32-byte BLAKE3 hash) read as a big-endian 256-bit integer.
- Executed via 64-bit limb arithmetic (4 limbs of `H` multiplied by 2 limbs of `work` into 6 limbs, checking that limbs 4 and 5 are zero).

### 3.3 Consensus Enforcement in `Dag`
In `crates/kovanica-dag/src/dag.rs:567-596` (`Dag::check_difficulty`):
1. **Timestamp Monotonicity**: `block.timestamp_ms >= parent.timestamp_ms` for **all** parents in `block.parents()`.
2. **Work Target**: `block.work() == retarget.next_work(&self.chain_samples(sp, retarget.window))`.

### 3.4 Light Client (SPV) Header Verification Flow
In `crates/kovanica-state/src/spv.rs:438-481` (`SpvClient::add_header`):
An SPV client maintaining a header chain from a trusted checkpoint verifies each new header `h` extending `tip`:
1. `h.height == tip.height + 1`
2. `h.prev_hash == tip.id`
3. `h.timestamp_ms >= tip.timestamp_ms` (Monotonicity)
4. `h.chain_blue_work > tip.chain_blue_work`
5. `h.verify_pow(require_pow)` (`meets_target(&h.id, h.work)`)
6. `h.verify_difficulty(&retarget, &window_headers)`: checks `h.work == retarget.next_work(&window)` using the prior `window + 1` headers.

---

## 4. Wall-Clock Future Drift Limits & Timestamp Rules

### 4.1 Layer Separation: Consensus vs. Node Policy
| Layer | Rule | Location | Enforcement / Action |
|---|---|---|---|
| **Consensus / DAG** | Non-decreasing timestamps along every path: `block.ts >= parent.ts` for all parents | `kovanica-dag::dag::Dag::check_difficulty` (`dag.rs:575-584`) | Rejects with `DagError::NonMonotonicTimestamp` |
| **Node Policy** | Wall-clock future drift bound: `block.ts <= now_ms + MAX_FUTURE_DRIFT_MS` (`MAX_FUTURE_DRIFT_MS = 2h = 7,200,000ms`) | `kovanica-node::node::Node::receive_block` (`node.rs:884-890`) | Rejects with `NodeError::TimestampTooFarInFuture` |
| **Node Production** | Clamping: `next_ts = now_ms.max(max(parent.ts) + 1)` | `kovanica-node::node::Node::next_timestamp` (`node.rs:243-250`) | Clamps timestamp strictly above parents |
| **SPV Client** | Monotonicity + Future Drift validation | `kovanica-state::spv::SpvClient` + wire handlers | Header rejected if non-monotonic or exceeding local drift |

---

## 5. Architectural Recommendations for Wire Protocol Integration

1. **Wire Envelopes in `relay.rs` and `p2p.rs`**:
   - Add wire tags / messages for:
     - `GetHeaders { from_id: Option<BlockId>, limit: usize }` (or `Vec<BlockId>`)
     - `Headers(Vec<BlockHeader>)`
     - `GetBlocks { ids: Vec<BlockId> }` (or `GetMerkleBlocks`)
     - `MerkleBlock(MerkleBlockRecord)` (carrying header, Merkle root, tx count, and Merkle proofs)
2. **Reuse `kovanica-state::spv` Primitives**:
   - The Merkle root, `MerkleProof`, `generate_merkle_proof`, and `SpvClient` in `kovanica-state::spv` are complete, tested, and can be directly utilized or wrapped by `kovanica-node`.
3. **SPV Light Node Integration Test (`tests/spv_sync.rs`)**:
   - Test should spin up a full node, generate blocks with transactions, mine them, and connect an SPV client over TCP (`RelaySession`).
   - SPV client sends `GetHeaders`, receives `Headers`, validates PoW, difficulty retargeting, and timestamp drift, and requests/verifies `MerkleProof` for transactions via `MerkleBlock`.
