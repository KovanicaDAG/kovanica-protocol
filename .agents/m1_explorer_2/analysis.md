# Analysis: Full Node SPV Methods & Merkle Proof Generation

**Agent**: `m1_explorer_2`  
**Date**: 2026-08-24  
**Milestone**: Milestone 1 — SPV Wire Protocol & Light Client Engine  
**Target Subsystems**: `crates/kovanica-node/src/node.rs`, `crates/kovanica-state/src/spv.rs`, `crates/kovanica-dag/src/dag.rs`, `crates/kovanica-dag/src/ordering.rs`, `crates/kovanica-state/src/ledger.rs`

---

## 1. Executive Summary

This report specifies the design and implementation of full node SPV capabilities on `Node` (`crates/kovanica-node/src/node.rs`), including:
1. **SPV Header Extraction (`spv_header`)**: Transforming internal GHOSTDAG node and DAG consensus state into self-verifying `kovanica_state::spv::BlockHeader` structures carrying `prev_hash`, `merkle_root`, `work`, `timestamp_ms`, `nonce`, `blue_score`, `chain_blue_work`, and `height`.
2. **Locator-Based Header Pagination (`headers_from`)**: Efficiently identifying the highest common ancestor between a light client's block locator (`&[BlockId]`) and the node's canonical GHOSTDAG selected chain (`dag.selected_chain()`), then streaming headers sequentially up to an optional `stop` hash and bounded by a `limit`.
3. **Zero-Leakage Merkle Proof Generation & `MerkleBlock` Assembly (`merkle_block`)**: Generating BLAKE3 Merkle sibling path inclusion proofs for requested transactions, bundling them into a compact `MerkleBlock` structure, and strictly ensuring **zero leakage** of non-matching transaction payloads, reducing SPV bandwidth by over 90% compared to full block downloads.
4. **Integration with Consensus Rules**: Guaranteeing that served SPV headers and proofs preserve the exact consensus invariants of proof-of-work (`pow::meets_target`), difficulty retargeting windows (`Retarget::next_work`), and node wall-clock future drift limits (`MAX_FUTURE_DRIFT_MS = 2h`).

---

## 2. SPV Header Architecture vs. Inventory BlockHeader

### 2.1 Two Header Types in the Codebase

Currently, the workspace contains two distinct header types designed for different roles:

| Characteristic | `kovanica_node::node::BlockHeader` (`node.rs:157-173`) | `kovanica_state::spv::BlockHeader` (`spv.rs:43-63`) |
|---|---|---|
| **Primary Consumer** | Full Nodes (`net.rs` one-shot sync) | Light Clients (`SpvClient` SPV verification) |
| **Payload Commitment** | `payload_hash: [u8; 32]` (`BLAKE3(payload)`) + `payload_len: u64` | `merkle_root: [u8; 32]` (BLAKE3 binary Merkle tree root over `TxId`s) |
| **Graph Context** | `parents: Vec<BlockId>` (all DAG parent edges) | `prev_hash: BlockId` (selected parent / chain backbone) |
| **GHOSTDAG Metadata** | None | `blue_score: u64`, `chain_blue_work: u128`, `height: u64` |
| **Verification Method** | Untrusted inventory hint until body is downloaded | Self-verifying chain proof + Merkle transaction verification |

```rust
// kovanica_state::spv::BlockHeader (for Light Clients)
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlockHeader {
    pub id: BlockId,
    pub prev_hash: BlockId,
    pub merkle_root: [u8; 32],
    pub work: u128,
    pub timestamp_ms: u64,
    pub nonce: u64,
    pub blue_score: u64,
    pub chain_blue_work: u128,
    pub height: u64,
}
```

### 2.2 Header Transformation Logic (`Node::spv_header`)

To produce an SPV header from full node storage:
1. Lookup the block in the DAG: `let block = self.ledger()?.dag().block(id)?;`
2. Lookup GHOSTDAG metadata: `let ghostdag = self.ledger()?.dag().ghostdag(id)?;`
3. Determine `prev_hash`:
   - Non-genesis: `ghostdag.selected_parent.unwrap_or_else(|| BlockId::from_bytes([0u8; 32]))`
   - Genesis: `BlockId::from_bytes([0u8; 32])`
4. Compute `height`:
   - On the selected chain, height is the index of `id` in `dag.selected_chain()`, or the selected-parent distance from genesis.
   - For an arbitrary block in the DAG, height is computed by walking `selected_parent` edges back to genesis.
5. Compute `merkle_root`:
   - Decode payload: `let txs = decode_block_payload(block.payload()).ok()?;`
   - Calculate root: `kovanica_state::spv::merkle_root(&txs)`
   - If payload is pruned (`block.is_pruned()`), return error or require unpruned header.

---

## 3. Locator-Based Header Pagination (`headers_from`)

### 3.1 Problem Definition & Synchronization Flow

When a light client connects to a full node, it needs to synchronize headers from its current local tip to the full node's selected tip. Due to potential network forks, reorgs, or offline intervals, the client cannot simply ask for "blocks after height $H$". Instead, it sends a **block locator** (`locator: Vec<BlockId>`).

### 3.2 Locator Resolution Algorithm

```text
Full Node Selected Chain: [ Genesis (0) -> B1 (1) -> B2 (2) -> B3 (3) -> B4 (4) -> B5 (Tip) ]
Client Locator:           [ Fork_X, Fork_Y, B2, Genesis ]
                                            ^^ First Match Found (Common Ancestor at index 2)

Headers Returned:         [ B3 (Height 3), B4 (Height 4), B5 (Height 5) ]
```

#### Step-by-Step Algorithm:
1. **Retrieve Selected Chain**:
   ```rust
   let dag = self.ledger()?.dag();
   let selected_chain = dag.selected_chain(); // [Genesis, B1, B2, ..., SelectedTip]
   ```
2. **Find Highest Common Ancestor**:
   - Iterate through `locator` in provided order ($L_0, L_1, L_2, \dots$):
   - For each $L_k$, find if $L_k \in \text{selected\_chain}$.
   - Let `match_idx` be the position in `selected_chain` where `selected_chain[match_idx] == L_k`.
   - If found, stop iterating.
   - If no locator block is found (or `locator` is empty), set `match_idx = None`.
3. **Determine Slice Range**:
   - If `Some(idx)` was found: start streaming at `start_idx = idx + 1` (the block *after* the common ancestor).
   - If `None` was found (e.g. empty locator or completely unknown branch): start streaming at `start_idx = 0` (from genesis).
   - If `start_idx >= selected_chain.len()`, client is already fully synchronized with the tip; return an empty `Vec`.
4. **Apply Stop Condition**:
   - If `stop` is `Some(stop_id)` where `stop_id != BlockId::from_bytes([0u8; 32])`:
     - Scan `selected_chain[start_idx..]` for `stop_id`.
     - If `stop_id` is present at index `j`, slice up to `j` inclusive (`selected_chain[start_idx..=j]`).
5. **Apply Limit & Convert**:
   - Truncate the candidates slice to `limit` (with default clamp `MAX_SPV_HEADERS = 2_000`).
   - Convert each `BlockId` to `kovanica_state::spv::BlockHeader` via `self.spv_header(&id)`.
   - Return `Vec<kovanica_state::spv::BlockHeader>`.

---

## 4. Zero-Leakage Merkle Proofs & `MerkleBlock` Assembly

### 4.1 Merkle Tree Structure in `kovanica-state`

Transactions inside a block $[T_0, T_1, \dots, T_{n-1}]$ form a binary Merkle tree:
- **Leaf Hashes**: $H_i = \text{BLAKE3}(T_i.\text{encode}())$ (i.e. `tx.id().as_bytes()`).
- **Internal Nodes**: $H_{parent} = \text{BLAKE3}(H_{left} \,\|\, H_{right})$.
- **Odd Levels**: If a level has an odd number of nodes, the last node is duplicated: $H_{parent} = \text{BLAKE3}(H_{last} \,\|\, H_{last})$.
- **Merkle Root**: Computed by `kovanica_state::spv::merkle_root(txs)`.

### 4.2 Merkle Inclusion Proof Generation

A Merkle proof for leaf at index $i$ is generated by `kovanica_state::spv::generate_merkle_proof(txs, index)`:
```rust
pub struct MerkleProof {
    pub tx_id: [u8; 32],
    pub merkle_root: [u8; 32],
    pub path: Vec<[u8; 32]>, // Sibling hashes from leaf up to root
    pub index: usize,        // Index in the block's transaction list
    pub tx_count: usize,     // Total transaction count in the block
}
```

Verification (`proof.verify()`) iteratively recomputes the root:
```rust
let mut current = self.tx_id;
let mut idx = self.index;
for sibling in &self.path {
    let mut hasher = Hasher::new();
    if idx % 2 == 0 {
        hasher.update(&current);
        hasher.update(sibling);
    } else {
        hasher.update(sibling);
        hasher.update(&current);
    }
    current = *hasher.finalize().as_bytes();
    idx /= 2;
}
current == self.merkle_root
```

### 4.3 Zero Full-Payload Leakage Guarantee

To protect network bandwidth and transaction privacy:
- A full block contains full serialized transactions: inputs, spend scripts, ed25519 signatures, outputs, values, and tags.
- A `MerkleBlock` transmits **only**:
  1. The `block_id: BlockId`
  2. The `merkle_root: [u8; 32]` and `tx_count: u32`
  3. The `proof: Option<MerkleProof>`: Contains only $O(\log_2 N)$ 32-byte hashes (the sibling path).
  4. The `matched_tx: Option<Transaction>`: The single requested transaction that the client needs to verify.
- **Zero non-matching transactions are ever serialized or sent in `MerkleBlock`**.
- Example bandwidth comparison for a block with 1,000 transactions (~300 KB full body):
  - `MerkleBlock` payload size: $\approx 32\text{B (root)} + 4\text{B (count)} + 10 \times 32\text{B (path)} + 300\text{B (single tx)} \approx 656\text{ bytes}$.
  - **Bandwidth reduction: $>99.7\%$**.

---

## 5. Full Node Method Signatures & Concrete Implementation Plan

### 5.1 Methods to Add to `Node` in `crates/kovanica-node/src/node.rs`

```rust
impl Node {
    /// Extract an SPV-compatible header for block `id`, containing Merkle root and
    /// selected-chain consensus metadata.
    pub fn spv_header(&self, id: &BlockId) -> Option<kovanica_state::spv::BlockHeader> {
        let ledger = self.ledger.as_ref()?;
        let dag = ledger.dag();
        let block = dag.block(id)?;
        let ghostdag = dag.ghostdag(id)?;
        
        let prev_hash = ghostdag
            .selected_parent
            .unwrap_or_else(|| BlockId::from_bytes([0u8; 32]));
        let blue_score = ghostdag.blue_score;
        let chain_blue_work = ghostdag.blue_work;
        
        // Calculate height along selected-parent chain
        let mut height = 0u64;
        let mut cur = ghostdag.selected_parent;
        while let Some(pid) = cur {
            height += 1;
            cur = dag.ghostdag(&pid).and_then(|g| g.selected_parent);
        }
        
        let txs = decode_block_payload(block.payload()).ok()?;
        let merkle_root = kovanica_state::spv::merkle_root(&txs);
        
        Some(kovanica_state::spv::BlockHeader {
            id: *id,
            prev_hash,
            merkle_root,
            work: block.work(),
            timestamp_ms: block.timestamp_ms(),
            nonce: block.nonce(),
            blue_score,
            chain_blue_work,
            height,
        })
    }

    /// Serve a batch of SPV headers starting from the highest common ancestor identified
    /// by `locator`, up to `stop` (inclusive) and bounded by `limit`.
    pub fn headers_from(
        &self,
        locator: &[BlockId],
        stop: Option<BlockId>,
        limit: usize,
    ) -> Result<Vec<kovanica_state::spv::BlockHeader>, NodeError> {
        let ledger = self.ledger()?;
        let dag = ledger.dag();
        let selected_chain = dag.selected_chain();
        
        // 1. Find highest common ancestor in locator
        let mut match_idx = None;
        for loc in locator {
            if let Some(pos) = selected_chain.iter().position(|id| id == loc) {
                match_idx = Some(pos);
                break;
            }
        }
        
        // 2. Start after matched block, or from genesis if no match / empty locator
        let start_idx = match match_idx {
            Some(idx) => idx + 1,
            None => 0,
        };
        
        if start_idx >= selected_chain.len() {
            return Ok(Vec::new());
        }
        
        // 3. Slice up to stop hash (if present and non-zero)
        let candidates = &selected_chain[start_idx..];
        let mut end_idx = candidates.len();
        if let Some(stop_id) = stop {
            if stop_id != BlockId::from_bytes([0u8; 32]) {
                if let Some(pos) = candidates.iter().position(|id| *id == stop_id) {
                    end_idx = pos + 1; // inclusive of stop_id
                }
            }
        }
        
        let max_serve = limit.clamp(1, 2_000);
        let selected_ids = &candidates[..end_idx.min(max_serve)];
        
        let headers: Vec<_> = selected_ids
            .iter()
            .filter_map(|id| self.spv_header(id))
            .collect();
            
        Ok(headers)
    }

    /// Generate a Merkle proof and assemble a `MerkleBlock` for a given transaction `tx_id`
    /// within block `block_id` with zero full-payload leakage.
    pub fn merkle_block(
        &self,
        block_id: &BlockId,
        tx_id: &TxId,
    ) -> Result<MerkleBlock, NodeError> {
        let ledger = self.ledger()?;
        let dag = ledger.dag();
        let block = dag
            .block(block_id)
            .ok_or_else(|| NodeError::Io("block not found".into()))?;
            
        let txs = decode_block_payload(block.payload())
            .map_err(|e| NodeError::Snapshot(e.to_string()))?;
            
        let root = kovanica_state::spv::merkle_root(&txs);
        let tx_count = txs.len() as u32;
        
        if let Some(index) = txs.iter().position(|t| t.id() == *tx_id) {
            let proof = kovanica_state::spv::generate_merkle_proof(&txs, index);
            let matched_tx = Some(txs[index].clone());
            Ok(MerkleBlock {
                block_id: *block_id,
                merkle_root: root,
                tx_count,
                proof,
                matched_tx,
            })
        } else {
            Ok(MerkleBlock {
                block_id: *block_id,
                merkle_root: root,
                tx_count,
                proof: None,
                matched_tx: None,
            })
        }
    }
}
```

### 5.2 `MerkleBlock` Structure Definition

Defined in `crates/kovanica-node/src/node.rs` (and re-exported / mirrored in `relay.rs`):
```rust
/// A MerkleBlock response for SPV clients: proves transaction inclusion in a block
/// with zero full-payload leakage.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MerkleBlock {
    /// The block ID containing the transaction.
    pub block_id: BlockId,
    /// The block's BLAKE3 Merkle root.
    pub merkle_root: [u8; 32],
    /// Total number of transactions in the block.
    pub tx_count: u32,
    /// Inclusion proof for the matching transaction.
    pub proof: Option<kovanica_state::spv::MerkleProof>,
    /// The matching transaction data.
    pub matched_tx: Option<Transaction>,
}
```

---

## 6. Edge Cases & Boundary Handling

1. **Genesis Block SPV Header & Proof**:
   - `prev_hash`: `[0u8; 32]`.
   - `height`: `0`.
   - `merkle_root`: `BLAKE3(genesis_tx_id)`.
   - Merkle proof for genesis transaction has `path: []` (0 siblings). `proof.verify()` confirms root directly.
2. **Locator with Orphaned Fork Hashes**:
   - If a client experienced a reorg and sends locator hashes $[F_{tip}, F_1, C_{split}, G]$, the loop ignores $F_{tip}$ and $F_1$ because they are not on `selected_chain`, matches $C_{split}$, and returns headers from the canonical chain starting at $C_{split} + 1$.
3. **Empty Locator Query**:
   - Returns headers starting from `Genesis` (height 0) up to `limit` or `stop`.
4. **Pagination Beyond Tip**:
   - If the locator matches the current selected tip, `start_idx == selected_chain.len()`, returning `Ok(vec![])`.
5. **Non-Existent Transaction in Block**:
   - If `tx_id` is not present in `block_id`, `merkle_block` returns `MerkleBlock` with `proof: None` and `matched_tx: None`, allowing the client to recognize that the transaction is absent without erroring out the connection.
6. **Pruned Blocks**:
   - If a block's payload has been evicted (`block.is_pruned()`), `merkle_block` returns an error, preventing serving incomplete data.

---

## 7. Next Steps & Implementer Guidance

1. Implement `Node::spv_header`, `Node::headers_from`, and `Node::merkle_block` in `crates/kovanica-node/src/node.rs`.
2. Connect `RelaySession` handlers to call `node.headers_from(...)` and `node.merkle_block(...)` on receiving `RelayMsg::GetHeaders` and `RelayMsg::GetMerkleProof`.
3. Support wire serialization/deserialization for `MerkleBlock` and `kovanica_state::spv::BlockHeader` in `relay.rs` and `net.rs`.
4. Validate full node serving with unit tests in `node.rs` and E2E integration tests in `crates/kovanica-node/tests/spv_sync.rs`.
