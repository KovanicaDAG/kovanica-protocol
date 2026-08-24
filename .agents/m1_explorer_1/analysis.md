# SPV Wire Protocol, Framing, Serialization & Relay Messaging Architecture

**Author**: `m1_explorer_1`  
**Date**: 2026-08-24  
**Workspace**: `/root/kovanica-protocol`  
**Target Files**:
- `crates/kovanica-node/src/relay.rs`
- `crates/kovanica-node/src/net.rs`
- `crates/kovanica-node/src/node.rs`
- `crates/kovanica-node/src/p2p.rs`
- `crates/kovanica-node/src/p2p_hardening.rs`
- `crates/kovanica-state/src/spv.rs`

---

## 1. Executive Summary

This document specifies the exact architecture, binary serialization layouts, defensive bounds, and dispatching mechanisms required to integrate the **Simplified Payment Verification (SPV) Wire Protocol** into `kovanica-node`.

The goal is to enable light clients (such as mobile wallets and low-resource edge nodes) to:
1. **Sync Block Headers** along the GHOSTDAG selected chain over persistent TCP connections without downloading heavy transaction payloads.
2. **Verify Consensus Invariants** on each header: proof-of-work hash targets (`meets_target`), difficulty retargeting windows (`Retarget::next_work`), parent linkages, timestamp monotonicity, and wall-clock future drift limits (`MAX_FUTURE_DRIFT_MS = 2h`).
3. **Request and Verify Merkle Proofs** (`MerkleProof`) for arbitrary transactions using `GetMerkleProof` and `MerkleBlock` wire messages, validating leaf-to-root BLAKE3 authentication paths against the header's `merkle_root`.

---

## 2. Existing Wire Architecture & Current State

### 2.1 Persistent TCP Relay (`crates/kovanica-node/src/relay.rs`)

Currently, `RelaySession` manages persistent TCP connections framed with a 4-byte little-endian length prefix:
$$\text{Frame} = [\text{len: u32\_le}] \,\|\, [\text{payload: len bytes}]$$

- Maximum frame size: `MAX_FRAME = 4 * 1024 * 1024` (4 MB).
- Existing messages are defined in `RelayMsg`:
  ```rust
  pub enum RelayMsg {
      Hello { from: String, advertised: Vec<String> }, // Tag 0 (0x00)
      Block(BlockRecord),                              // Tag 1 (0x01)
      Tx(Transaction),                                 // Tag 2 (0x02)
  }
  ```

### 2.2 Sync Message Tags in `crates/kovanica-node/src/net.rs`

In `net.rs`, one-shot sync routines currently define tags in the `0x1x` namespace:
- `TAG_INVENTORY = 0x10` (`Vec<BlockId>`)
- `TAG_HEADERS = 0x11` (`Vec<BlockHeader>`)
- `TAG_GETHEADERS = 0x12` (`Vec<BlockId>`)
- `TAG_GETBODIES = 0x13` (`Vec<BlockId>`)
- `TAG_BODIES = 0x14` (`Vec<BlockRecord>`)

### 2.3 Header Structures in the Codebase

Two distinct header representations currently exist:
1. **`kovanica_node::node::BlockHeader`** (`crates/kovanica-node/src/node.rs:157-173`):
   - Fields: `id: BlockId`, `parents: Vec<BlockId>`, `work: u128`, `timestamp_ms: u64`, `nonce: u64`, `payload_hash: [u8; 32]`, `payload_len: u64`.
   - Used by full nodes during headers-first sync to verify payload hashes before downloading bodies.
2. **`kovanica_state::spv::BlockHeader`** (`crates/kovanica-state/src/spv.rs:43-62`):
   - Fields: `id: BlockId`, `prev_hash: BlockId`, `merkle_root: [u8; 32]`, `work: u128`, `timestamp_ms: u64`, `nonce: u64`, `blue_score: u64`, `chain_blue_work: u128`, `height: u64`.
   - Used by SPV light clients to verify selected chain progression, proof-of-work, difficulty retargeting, and transaction inclusion via `merkle_root`.

---

## 3. SPV Wire Message Specification (`RelayMsg`)

To support SPV light clients without breaking full-node relay functionality, `RelayMsg` is extended with SPV wire messages matching the interface contracts in `PROJECT.md`.

### 3.1 Wire Message Tags

| Tag Constant | Hex / Dec | Message Variant | Purpose |
|---|---|---|---|
| `TAG_HELLO` | `0x00` (0) | `RelayMsg::Hello` | Peer discovery & overlay advertisement |
| `TAG_BLOCK` | `0x01` (1) | `RelayMsg::Block` | Full block gossip |
| `TAG_TX` | `0x02` (2) | `RelayMsg::Tx` | Mempool transaction dissemination |
| `TAG_HEADERS` | `0x11` (17) | `RelayMsg::Headers` | Response containing SPV block headers |
| `TAG_GETHEADERS` | `0x12` (18) | `RelayMsg::GetHeaders` | Request SPV headers matching block locator |
| `TAG_GETBLOCKS` | `0x13` (19) | `RelayMsg::GetBlocks` | Request block identifiers / records matching locator |
| `TAG_GET_MERKLE_PROOF`| `0x15` (21) | `RelayMsg::GetMerkleProof` | Request Merkle inclusion proof for specific `(block_id, tx_id)` |
| `TAG_MERKLEBLOCK` | `0x16` (22) | `RelayMsg::MerkleBlock` | Merkle proof & transaction confirmation response |

### 3.2 Extended `RelayMsg` Enum Definition

```rust
// In crates/kovanica-node/src/relay.rs

use kovanica_dag::BlockId;
use kovanica_state::{
    spv::{BlockHeader as SpvHeader, MerkleProof},
    Transaction, TxId,
};
use crate::node::BlockRecord;

#[derive(Clone, Debug)]
pub enum RelayMsg {
    /// Peer-discovery hello: who we are and who we currently peer with.
    Hello {
        from: String,
        advertised: Vec<String>,
    },
    /// A full block record for gossip between full nodes.
    Block(BlockRecord),
    /// A mempool transaction.
    Tx(Transaction),

    /// SPV Request: Request headers along the selected chain matching locator.
    GetHeaders {
        /// Locator block hashes, newest first (exponential backoff).
        locator: Vec<BlockId>,
        /// Stop block hash (None / [0;32] means sync up to the tip).
        stop_hash: Option<BlockId>,
        /// Maximum number of headers to return (capped by MAX_HEADERS = 10,000).
        max_count: u32,
    },
    /// SPV Response: Batch of block headers for the light client.
    Headers {
        headers: Vec<SpvHeader>,
    },
    /// SPV / Node Request: Request blocks or inventory starting from locator.
    GetBlocks {
        locator: Vec<BlockId>,
        stop_hash: Option<BlockId>,
    },
    /// SPV Request: Request transaction inclusion proof for a block.
    GetMerkleProof {
        block_id: BlockId,
        tx_id: TxId,
    },
    /// SPV Response: Merkle root, transaction count, sibling proof path, and matched transaction.
    MerkleBlock {
        block_id: BlockId,
        merkle_root: [u8; 32],
        tx_count: u32,
        proof: Option<MerkleProof>,
        matched_tx: Option<Transaction>,
    },
}
```

---

## 4. Exact Binary Encodings & Serialization Layouts

All integer fields are encoded in **little-endian** byte order. Length-prefixed sequences use explicit count fields validated before buffer allocation.

### 4.1 `GetHeaders` Encoding (`TAG_GETHEADERS = 0x12`)

```text
[Tag: 1 byte (0x12)]
[locator_count: 8 bytes (u64_le)]
[locator[0]: 32 bytes]
[locator[1]: 32 bytes]
...
[locator[locator_count - 1]: 32 bytes]
[has_stop: 1 byte (0 = None, 1 = Some)]
[stop_hash: 32 bytes] (present only if has_stop == 1)
[max_count: 4 bytes (u32_le)]
```

- **Encoding logic**:
  ```rust
  buf.push(TAG_GETHEADERS);
  buf.extend_from_slice(&(locator.len() as u64).to_le_bytes());
  for id in locator {
      buf.extend_from_slice(id.as_bytes());
  }
  match stop_hash {
      Some(stop) => {
          buf.push(1u8);
          buf.extend_from_slice(stop.as_bytes());
      }
      None => {
          buf.push(0u8);
      }
  }
  buf.extend_from_slice(&max_count.to_le_bytes());
  ```

- **Decoding logic & bounds checks**:
  - `locator_count`: Validated via `cursor.read_count(32)` to ensure `locator_count * 32 <= remaining_bytes` and `locator_count <= MAX_LOCATOR_IDS (1,000)`.
  - `has_stop`: Read 1 byte; if `1`, read `[u8; 32]`. If not `0` or `1`, reject with `NetError::Decode("invalid has_stop flag")`.
  - `max_count`: Read `u32_le`, capped to `MAX_HEADERS as u32`.
  - Final check: `cursor.remaining() == 0`.

---

### 4.2 `Headers` Encoding (`TAG_HEADERS = 0x11`)

Every `SpvHeader` (`kovanica_state::spv::BlockHeader`) has a **fixed size of exactly 160 bytes**:
- `id`: 32 bytes
- `prev_hash`: 32 bytes
- `merkle_root`: 32 bytes
- `work`: 16 bytes (`u128_le`)
- `timestamp_ms`: 8 bytes (`u64_le`)
- `nonce`: 8 bytes (`u64_le`)
- `blue_score`: 8 bytes (`u64_le`)
- `chain_blue_work`: 16 bytes (`u128_le`)
- `height`: 8 bytes (`u64_le`)
- Total = $32 + 32 + 32 + 16 + 8 + 8 + 8 + 16 + 8 = 160$ bytes.

```text
[Tag: 1 byte (0x11)]
[header_count: 8 bytes (u64_le)]
For each header (160 bytes):
  [id: 32 bytes]
  [prev_hash: 32 bytes]
  [merkle_root: 32 bytes]
  [work: 16 bytes (u128_le)]
  [timestamp_ms: 8 bytes (u64_le)]
  [nonce: 8 bytes (u64_le)]
  [blue_score: 8 bytes (u64_le)]
  [chain_blue_work: 16 bytes (u128_le)]
  [height: 8 bytes (u64_le)]
```

- **Encoding logic**:
  ```rust
  buf.push(TAG_HEADERS);
  buf.extend_from_slice(&(headers.len() as u64).to_le_bytes());
  for h in headers {
      buf.extend_from_slice(h.id.as_bytes());
      buf.extend_from_slice(h.prev_hash.as_bytes());
      buf.extend_from_slice(&h.merkle_root);
      buf.extend_from_slice(&h.work.to_le_bytes());
      buf.extend_from_slice(&h.timestamp_ms.to_le_bytes());
      buf.extend_from_slice(&h.nonce.to_le_bytes());
      buf.extend_from_slice(&h.blue_score.to_le_bytes());
      buf.extend_from_slice(&h.chain_blue_work.to_le_bytes());
      buf.extend_from_slice(&h.height.to_le_bytes());
  }
  ```

- **Decoding logic & bounds checks**:
  - `header_count`: Validated via `cursor.read_count(160)` to ensure `header_count * 160 <= remaining_bytes` and `header_count <= MAX_HEADERS (10,000)`.
  - Allocates vector `Vec::with_capacity(header_count)`.
  - For each element, unpacks fixed fields.
  - Final check: `cursor.remaining() == 0`.

---

### 4.3 `GetBlocks` Encoding (`TAG_GETBLOCKS = 0x13`)

```text
[Tag: 1 byte (0x13)]
[locator_count: 8 bytes (u64_le)]
[locator[0..locator_count-1]: 32 bytes each]
[has_stop: 1 byte (0 = None, 1 = Some)]
[stop_hash: 32 bytes] (if has_stop == 1)
```

- **Bounds checks on decode**:
  - `locator_count`: `cursor.read_count(32)`, $\le 1,000$.
  - Trailing bytes check: `cursor.remaining() == 0`.

---

### 4.4 `GetMerkleProof` Encoding (`TAG_GET_MERKLE_PROOF = 0x15`)

Fixed size of $1 + 32 + 32 = 65$ bytes.

```text
[Tag: 1 byte (0x15)]
[block_id: 32 bytes]
[tx_id: 32 bytes]
```

- **Encoding logic**:
  ```rust
  buf.push(TAG_GET_MERKLE_PROOF);
  buf.extend_from_slice(block_id.as_bytes());
  buf.extend_from_slice(tx_id.as_bytes());
  ```

- **Decoding logic & bounds checks**:
  - Validates `rest.len() == 64`.
  - Reads `BlockId::from_bytes(r.read_array::<32>()?)` and `TxId::from_bytes(r.read_array::<32>()?)`.

---

### 4.5 `MerkleBlock` Encoding (`TAG_MERKLEBLOCK = 0x16`)

```text
[Tag: 1 byte (0x16)]
[block_id: 32 bytes]
[merkle_root: 32 bytes]
[tx_count: 4 bytes (u32_le)]
[has_proof: 1 byte (0 = None, 1 = Some)]
If has_proof == 1:
  [proof_tx_id: 32 bytes]
  [proof_merkle_root: 32 bytes]
  [path_len: 8 bytes (u64_le)]
  [path[0..path_len-1]: 32 bytes each]
  [index: 8 bytes (u64_le)]
  [proof_tx_count: 8 bytes (u64_le)]
[has_matched_tx: 1 byte (0 = None, 1 = Some)]
If has_matched_tx == 1:
  [tx_payload_len: 4 bytes (u32_le)]
  [tx_payload: tx_payload_len bytes] (via encode_block_payload(&[tx]))
```

- **Encoding logic**:
  ```rust
  buf.push(TAG_MERKLEBLOCK);
  buf.extend_from_slice(block_id.as_bytes());
  buf.extend_from_slice(merkle_root);
  buf.extend_from_slice(&tx_count.to_le_bytes());
  match proof {
      Some(p) => {
          buf.push(1u8);
          buf.extend_from_slice(&p.tx_id);
          buf.extend_from_slice(&p.merkle_root);
          buf.extend_from_slice(&(p.path.len() as u64).to_le_bytes());
          for sibling in &p.path {
              buf.extend_from_slice(sibling);
          }
          buf.extend_from_slice(&(p.index as u64).to_le_bytes());
          buf.extend_from_slice(&(p.tx_count as u64).to_le_bytes());
      }
      None => {
          buf.push(0u8);
      }
  }
  match matched_tx {
      Some(tx) => {
          buf.push(1u8);
          let tx_payload = encode_block_payload(std::slice::from_ref(tx));
          buf.extend_from_slice(&(tx_payload.len() as u32).to_le_bytes());
          buf.extend_from_slice(&tx_payload);
      }
      None => {
          buf.push(0u8);
      }
  }
  ```

- **Decoding logic & bounds checks**:
  - Minimum header fields check: $32 + 32 + 4 + 1 = 69$ bytes.
  - If `has_proof == 1`:
    - `path_len`: Checked via `cursor.read_count(32)`, constrained to `path_len <= MAX_MERKLE_PATH (64)`.
    - Unpacks `index` and `proof_tx_count`.
  - If `has_matched_tx == 1`:
    - `tx_payload_len`: Read `u32_le`, checked $\le 4\text{MB}$.
    - Decodes transaction via `decode_block_payload`. Must yield exactly 1 transaction.
  - Final check: `cursor.remaining() == 0`.

---

## 5. Defensive Bounds, Safety & Resource Management

| Constant | Value | Purpose / Threat Mitigated |
|---|---|---|
| `MAX_FRAME` | 4 MB (`4 * 1024 * 1024`) | Rejects oversized socket frames before allocating heap memory |
| `MAX_HEADERS` | 10,000 headers (~1.6 MB) | Bounds single `Headers` response memory allocation |
| `MAX_LOCATOR_IDS` | 1,000 IDs (32 KB) | Bounds locator list length in `GetHeaders` and `GetBlocks` |
| `MAX_MERKLE_PATH` | 64 hashes (2,048 bytes) | Bounds Merkle sibling path length (sufficient for $2^{64}$ transactions) |
| `MAX_TX_SIZE` | 1 MB (`1024 * 1024`) | Bounds single transaction payload size |
| `MAX_FUTURE_DRIFT_MS` | 2 hours (`7_200_000` ms) | Rejects headers/blocks with timestamps too far in the future |

### 5.1 Pre-Allocation Bound Protection via `Cursor::read_count`

To protect against untrusted length integers (e.g. an attacker sending count $2^{60}$ on a 50-byte buffer):
```rust
fn read_count(&mut self, min_element_bytes: usize) -> Result<usize, NetError> {
    let n = u64::from_le_bytes(self.read_array::<8>()?) as usize;
    if min_element_bytes > 0 && n > self.remaining() / min_element_bytes {
        return Err(NetError::Decode("count too large".into()));
    }
    Ok(n)
}
```
This guarantees that vector allocations (`Vec::with_capacity(n)`) never exceed the remaining bytes in the buffer.

---

## 6. Full Node SPV Serving Capabilities (`crates/kovanica-node/src/node.rs`)

### 6.1 Node Methods for SPV

`Node` provides three core methods for SPV light clients:

#### 1. `Node::headers_from`
Locates the common ancestor between the client's locator and the node's selected chain, then extracts up to `limit` consecutive headers along the selected chain:

```rust
impl Node {
    /// Export SPV block headers along the selected chain starting after the common
    /// ancestor found in `locator`, up to `stop` (or tip), bounded by `limit`.
    pub fn headers_from(
        &self,
        locator: &[BlockId],
        stop: Option<BlockId>,
        limit: usize,
    ) -> Vec<kovanica_state::spv::BlockHeader> {
        let Some(ledger) = self.ledger.as_ref() else {
            return Vec::new();
        };
        let dag = ledger.dag();
        let selected_chain = dag.selected_chain();

        // Find the most recent locator block present on the selected chain
        let mut start_idx = 0;
        let mut found = false;
        for loc in locator {
            if let Some(pos) = selected_chain.iter().position(|id| id == loc) {
                start_idx = pos + 1; // Start after the common ancestor
                found = true;
                break;
            }
        }
        if !found && !locator.is_empty() {
            // No common ancestor found on selected chain; start from genesis (index 0)
            start_idx = 0;
        }

        let max_items = limit.min(MAX_HEADERS);
        let mut headers = Vec::new();

        for id in selected_chain.iter().skip(start_idx) {
            if headers.len() >= max_items {
                break;
            }
            if let Some(header) = self.spv_header(id) {
                let is_stop = Some(*id) == stop;
                headers.push(header);
                if is_stop {
                    break;
                }
            }
        }

        headers
    }

    /// Construct an SPV `BlockHeader` for a single block in the DAG.
    pub fn spv_header(&self, id: &BlockId) -> Option<kovanica_state::spv::BlockHeader> {
        let ledger = self.ledger.as_ref()?;
        let dag = ledger.dag();
        let block = dag.block(id)?;
        let ghostdag = dag.ghostdag(id)?;

        let prev_hash = ghostdag.selected_parent;
        let blue_score = ghostdag.blue_score;
        let chain_blue_work = ghostdag.blue_work;
        let height = blue_score;

        let txs = decode_block_payload(block.payload()).unwrap_or_default();
        Some(kovanica_state::spv::BlockHeader::from_block(
            block,
            prev_hash,
            blue_score,
            chain_blue_work,
            height,
            &txs,
        ))
    }
}
```

#### 2. `Node::merkle_block`
Extracts the Merkle root, transaction count, Merkle proof, and matched transaction for a given `(block_id, tx_id)`:

```rust
impl Node {
    /// Assemble a `MerkleBlock` message for an SPV client verifying a transaction.
    pub fn merkle_block(&self, block_id: BlockId, tx_id: TxId) -> Option<RelayMsg> {
        let record = self.block_record(&block_id)?;
        let merkle_root = kovanica_state::spv::merkle_root(&record.txs);
        let tx_count = record.txs.len() as u32;

        let (proof, matched_tx) = if let Some(idx) = record.txs.iter().position(|tx| tx.id() == tx_id) {
            let proof = kovanica_state::spv::generate_merkle_proof(&record.txs, idx);
            let tx = Some(record.txs[idx].clone());
            (proof, tx)
        } else {
            (None, None)
        };

        Some(RelayMsg::MerkleBlock {
            block_id,
            merkle_root,
            tx_count,
            proof,
            matched_tx,
        })
    }
}
```

---

## 7. Query Handling & Relay Session Dispatch (`crates/kovanica-node/src/relay.rs`)

### 7.1 `handle_relay_query` Helper

To process incoming SPV requests on a `RelaySession`, a query-response dispatcher is introduced:

```rust
/// Handle query-type relay messages that require an immediate response back over the wire.
/// Returns Some(response) for queries (GetHeaders, GetBlocks, GetMerkleProof), or None
/// for push/stateful messages (Hello, Block, Tx) which are handled via apply_relay.
pub fn handle_relay_query(node: &Node, msg: &RelayMsg) -> Option<RelayMsg> {
    match msg {
        RelayMsg::GetHeaders { locator, stop_hash, max_count } => {
            let limit = if *max_count == 0 { 2000 } else { *max_count as usize };
            let headers = node.headers_from(locator, *stop_hash, limit);
            Some(RelayMsg::Headers { headers })
        }
        RelayMsg::GetMerkleProof { block_id, tx_id } => {
            node.merkle_block(*block_id, *tx_id)
        }
        RelayMsg::GetBlocks { locator, stop_hash } => {
            // Return block headers or inventory for requested locator
            let headers = node.headers_from(locator, *stop_hash, 2000);
            Some(RelayMsg::Headers { headers })
        }
        _ => None,
    }
}
```

---

## 8. Light Client Engine Integration (`crates/kovanica-state/src/spv.rs`)

`SpvClient` serves as the light client state machine. We outline its wire synchronization integration:

### 8.1 SPV Client Block Locator Generation

```rust
impl SpvClient {
    /// Generate a block locator hashes list (newest first, exponential spacing)
    /// to locate the common ancestor with a full node peer.
    pub fn locator(&self) -> Vec<BlockId> {
        let Some(tip) = &self.tip else {
            return Vec::new();
        };
        let mut locator = Vec::new();
        let mut step = 1u64;
        let mut cur_height = tip.height;

        while let Some(h) = self.headers.get(&cur_height) {
            locator.push(h.id);
            if cur_height == 0 {
                break;
            }
            if locator.len() >= 10 {
                step *= 2;
            }
            cur_height = cur_height.saturating_sub(step);
        }

        // Always include the checkpoint / genesis if available
        if let Some(cp) = &self.checkpoint {
            if locator.last() != Some(&cp.id) {
                locator.push(cp.id);
            }
        }
        locator
    }

    /// Add a block header to the SPV client with wall-clock future drift validation.
    pub fn add_header_with_clock(
        &mut self,
        header: BlockHeader,
        now_ms: u64,
    ) -> Result<bool, SpvError> {
        // Enforce 2-hour wall-clock future drift limit
        const MAX_FUTURE_DRIFT_MS: u64 = 2 * 60 * 60 * 1000;
        if header.timestamp_ms > now_ms.saturating_add(MAX_FUTURE_DRIFT_MS) {
            return Err(SpvError::TimestampTooFarInFuture);
        }
        self.add_header(header)
    }
}
```

### 8.2 Light Client Wire Sync Protocol Flow

```text
Light Client (SpvClient)                          Full Node (Node)
       │                                                 │
       │ 1. GetHeaders { locator, stop: None, 2000 }     │
       ├────────────────────────────────────────────────►│
       │                                                 │ [Finds common ancestor in selected chain]
       │                                                 │ [Extracts up to 2000 SpvHeaders]
       │ 2. Headers { headers: Vec<SpvHeader> }          │
       │◄────────────────────────────────────────────────┤
       │                                                 │
[For each header:                                        │
   - Verify link to tip (h.prev_hash == tip.id)          │
   - Verify height monotonicity                          │
   - Verify timestamp >= tip.ts & <= now_ms + 2h         │
   - Verify proof-of-work: meets_target(h.id, h.work)    │
   - Verify retarget: h.work == Retarget::next_work(...) │
   - Append to self.headers & update tip]                │
       │                                                 │
       │ 3. GetMerkleProof { block_id, tx_id }           │
       ├────────────────────────────────────────────────►│
       │                                                 │ [Queries block_record(block_id)]
       │                                                 │ [Finds tx_id, builds MerkleProof]
       │ 4. MerkleBlock { proof, matched_tx, ... }       │
       │◄────────────────────────────────────────────────┤
       │                                                 │
[Verify Merkle Proof:                                    │
   - Lookup header H at height                           │
   - Check proof.merkle_root == H.merkle_root            │
   - Check proof.verify() == true                        │
   - Confirm payment receipt without full block download]│
```

---

## 9. Comprehensive Integration Testing Blueprint (`tests/spv_sync.rs`)

The test suite in `crates/kovanica-node/tests/spv_sync.rs` verifies all SPV requirements across 4 tiers:

### Tier 1: Feature Coverage
- **T1.1**: Binary round-trip serialization for `RelayMsg::GetHeaders`.
- **T1.2**: Binary round-trip serialization for `RelayMsg::Headers` with 160-byte SPV headers.
- **T1.3**: Binary round-trip serialization for `RelayMsg::GetMerkleProof`.
- **T1.4**: Binary round-trip serialization for `RelayMsg::MerkleBlock`.
- **T1.5**: Merkle root calculation & proof verification for odd and even leaf counts (1, 2, 3, 7, 16 transactions).

### Tier 2: Boundary & Corner Cases
- **T2.1**: Genesis-only checkpoint sync against an empty DAG.
- **T2.2**: Maximum frame limit (`MAX_FRAME = 4MB`) and headers limit (`MAX_HEADERS = 10,000`).
- **T2.3**: Exact wall-clock drift boundary (`now + 2h` passes, `now + 2h + 1ms` rejected).
- **T2.4**: Difficulty retargeting clamping ($\pm 4\times$ clamp on timestamp step changes).
- **T2.5**: Merkle proof verification failure on altered leaf hash or invalid sibling path.

### Tier 3: Cross-Feature End-to-End Over TCP
- **T3.1**: Full node produces 10 blocks with transactions; SPV client connects over real TCP loopback, sends `GetHeaders`, syncs all headers without downloading bodies, and asserts cumulative blue work matches.
- **T3.2**: Light client requests `GetMerkleProof` over the same TCP session, receives `MerkleBlock`, verifies `proof.verify()` against header's `merkle_root`, and confirms payment.

### Tier 4: Real-World Mobile Wallet Workflow & Bandwidth Reduction
- **T4.1**: Mobile wallet payment receipt: Alice sends 250 KVNC to Bob; Bob's SPV client syncs 50 headers, requests proof for Bob's transfer, validates inclusion, and confirms payment.
- **T4.2**: Bandwidth measurement: SPV headers sync consumes $>90\%$ less network traffic than full block download (`<10%` bytes transferred).

---

## 10. Summary of Required Modifications

| Target File | Changes Required |
|---|---|
| `crates/kovanica-node/src/relay.rs` | 1. Add `TAG_HEADERS = 0x11`, `TAG_GETHEADERS = 0x12`, `TAG_GETBLOCKS = 0x13`, `TAG_GET_MERKLE_PROOF = 0x15`, `TAG_MERKLEBLOCK = 0x16`.<br>2. Add `GetHeaders`, `Headers`, `GetBlocks`, `GetMerkleProof`, `MerkleBlock` to `RelayMsg`.<br>3. Implement binary encoding in `encode_msg` and decoding in `decode_msg` with defensive bounds checking.<br>4. Add `handle_relay_query` helper. |
| `crates/kovanica-node/src/node.rs` | 1. Implement `Node::headers_from(locator, stop, limit) -> Vec<spv::BlockHeader>`.<br>2. Implement `Node::spv_header(id) -> Option<spv::BlockHeader>`.<br>3. Implement `Node::merkle_block(block_id, tx_id) -> Option<RelayMsg>`. |
| `crates/kovanica-node/src/net.rs` | 1. Re-export wire serialization helpers for standalone use in tests.<br>2. Ensure bounds checking matches `MAX_HEADERS` and `MAX_LOCATOR_IDS`. |
| `crates/kovanica-node/src/p2p.rs` | 1. Update byte size estimation in `Mesh::enqueue` to account for new `RelayMsg` payload types in rate limiting. |
| `crates/kovanica-state/src/spv.rs` | 1. Add `SpvError::TimestampTooFarInFuture`.<br>2. Add `SpvClient::locator(&self) -> Vec<BlockId>`.<br>3. Add `SpvClient::add_header_with_clock(&mut self, header, now_ms)`. |
| `crates/kovanica-node/tests/spv_sync.rs` | 1. Implement full 4-tier E2E integration test suite testing TCP sync, Merkle proofs, difficulty retargeting, and drift limits. |
