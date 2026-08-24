# Analysis of P2P Wire Protocol, Framing, Serialization & Relay Messaging in Kovanica

**Agent**: `survey_explorer_1`  
**Date**: 2026-08-24  
**Target Subsystems**: `crates/kovanica-node` (`relay.rs`, `p2p.rs`, `net.rs`, `node.rs`, `p2p_hardening.rs`, `lib.rs`, `main.rs`) and `crates/kovanica-state` (`spv.rs`).

---

## 1. Executive Summary

This report provides a comprehensive architectural survey of the P2P networking, wire message framing, binary serialization, discrete mesh gossip, and long-lived TCP relay loops in `kovanica-node`. It details how the current protocol operates and presents a concrete blueprint for integrating the SPV (Simplified Payment Verification) wire protocol messages (`getheaders`, `headers`, `getblocks`, `merkleblock`) into `RelaySession`, `Mesh`, and `Node`.

Key findings:
1. **TCP Framing**: `RelaySession` (`relay.rs`) and sync routines in `net.rs` use a uniform 4-byte little-endian length prefix `[len: u32_le][payload: bytes]`. Lengths are strictly bounded (`MAX_FRAME` = 4 MB in relay, `MAX_FRAME_BYTES` = 16 MB in net sync).
2. **Current Wire Message Enums**:
   - `RelayMsg` (`relay.rs:26-39`): Currently has only 3 variants: `Hello { from, advertised }` (tag `0`), `Block(BlockRecord)` (tag `1`), `Tx(Transaction)` (tag `2`).
   - `Envelope` (`p2p.rs:76-88`): Internal to `Mesh`, mirrors `RelayMsg` variants.
   - Sync Protocol Tags (`net.rs:355-365`): Has 5 separate request-response tags: `TAG_INVENTORY` (`0x10`), `TAG_HEADERS` (`0x11`), `TAG_GETHEADERS` (`0x12`), `TAG_GETBODIES` (`0x13`), `TAG_BODIES` (`0x14`).
3. **SPV & Merkle Foundation Already Implemented in `kovanica-state`**:
   - `crates/kovanica-state/src/spv.rs` contains fully functional `MerkleProof`, `generate_merkle_proof`, `merkle_root`, `SpvClient`, and `BlockHeader` structures.
   - Light clients can verify transaction inclusion against the header's `merkle_root` via `proof.verify()`, verify proof-of-work with `meets_target()`, and verify difficulty retargeting via `Retarget::next_work()`.
4. **Integration Opportunity**: Extending `RelayMsg` with `GetHeaders`, `Headers`, `GetBlocks`, and `MerkleBlock` (or unifying `net.rs` tags and `RelayMsg`) enables persistent P2P connections to serve both full-node gossip and lightweight SPV sync seamlessly over the same TCP session.

---

## 2. Wire Framing and Message Serialization

### 2.1 Persistent TCP Relay Framing (`relay.rs`)

`RelaySession` manages persistent, bidirectional TCP connections:
- **Wire Framing**: Every frame begins with a 4-byte little-endian length integer:
  $$\text{Frame} = [\text{len: u32\_le}] \,\|\, [\text{payload: len bytes}]$$
- **Frame Limit**: `MAX_FRAME = 4 * 1024 * 1024` (4 MB) (`relay.rs:23`). Any frame indicating $\text{len} > 4\text{MB}$ is rejected immediately with `NetError::Decode("frame too large")` (`relay.rs:81-83`).
- **Stream Configuration**: `set_nodelay(true)` is set on socket acceptance and connection (`relay.rs:50, 57`) to eliminate Nagle buffering latency. Configurable read/write timeouts (`set_read_timeout`) prevent deadlocks (`relay.rs:62-64`).

```rust
// crates/kovanica-node/src/relay.rs:26-39
#[derive(Clone, Debug)]
pub enum RelayMsg {
    Hello {
        from: String,
        advertised: Vec<String>,
    },
    Block(BlockRecord),
    Tx(Transaction),
}
```

### 2.2 Wire Tag Layout and Binary Encoding (`relay.rs:112-180`)

Wire messages in `relay.rs` prefix payloads with a 1-byte message tag:

| Tag Constant | Value (`u8`) | Description | Payload Structure |
|---|---|---|---|
| `TAG_HELLO` | `0` | Peer discovery hello | `[len: u16_le][name: utf8]` + `[count: u16_le]` + $([\text{len: u16\_le}][\text{peer: utf8}])^*$ |
| `TAG_BLOCK` | `1` | Full block record | Encoded `BlockRecord` via `net::encode_record` |
| `TAG_TX` | `2` | Mempool transaction | `[payload_len: u32_le]` + `[encode_block_payload(&[tx])]` |

#### `BlockRecord` Encoding Details (`net.rs:237-248`):
```text
[n_parents: u64_le]
  -> [BlockId: 32 bytes] * n_parents
[work: u128_le] (16 bytes)
[timestamp_ms: u64_le] (8 bytes)
[nonce: u64_le] (8 bytes)
[payload_len: u64_le] (8 bytes)
[payload: bytes] (raw tx payload encoding)
```

### 2.3 One-Shot & Sync Protocol Framing (`net.rs:334-568`)

In `crates/kovanica-node/src/net.rs`, sync functions (`sync_headers_first`, `serve_headers_first`, `pull_blocks_timeout`, `serve_exchange`) use the same `[u32_le len][payload]` framing but with high-byte tags:

| Tag Constant | Value (`u8`) | Target Message Type | Payload Structure | Max Count Limit |
|---|---|---|---|---|
| `TAG_INVENTORY` | `0x10` | `Vec<BlockId>` | `[count: u64_le]` + `[BlockId: 32 bytes]*` | `MAX_INVENTORY_IDS = 200_000` (~6.4 MB) |
| `TAG_HEADERS` | `0x11` | `Vec<BlockHeader>` | `[count: u64_le]` + `[BlockHeader]*` | `MAX_HEADERS = 10_000` (~3 MB) |
| `TAG_GETHEADERS`| `0x12` | `Vec<BlockId>` | `[count: u64_le]` + `[BlockId: 32 bytes]*` | `MAX_GETBODIES = 10_000` |
| `TAG_GETBODIES` | `0x13` | `Vec<BlockId>` | `[count: u64_le]` + `[BlockId: 32 bytes]*` | `MAX_GETBODIES = 10_000` |
| `TAG_BODIES` | `0x14` | `Vec<BlockRecord>` | `[count: u64_le]` + `[BlockRecord]*` | `MAX_BODIES = 10_000` |

### 2.4 In-Process `Mesh` Envelopes (`p2p.rs:76-88`)

In `crates/kovanica-node/src/p2p.rs`, the continuous gossip simulation wraps messages in an in-memory `Envelope`:
```rust
enum Envelope {
    Hello { advertised: Vec<String> },
    Block { record: BlockRecord },
    Tx { tx: Transaction },
}

struct Queued {
    due: u64,
    from: String,
    to: String,
    envelope: Envelope,
}
```
Discrete time `Mesh::now` increments on `Mesh::tick()`. Messages scheduled at `due = now + 1` are delivered via `Mesh::deliver()`, producing observable `GossipEvent` records.

---

## 3. Handshakes, Announcements, and Sync Handlers

### 3.1 Peer Discovery & Hello Handshake
- **Edge Creation**: `Mesh::connect(from, to)` inserts `to` into `peers[from]` and enqueues an `Envelope::Hello` containing all known peers of `from` (`peers_of(from)`).
- **Discovery Reaction** (`p2p.rs:499-517`):
  1. Receiving node `to` inserts `from` into `peers[to]`.
  2. If `from` is a new reverse edge, `to` enqueues an immediate `Hello` back to `from`.
  3. For every advertised peer $p \in \text{advertised}$, if $p$ is known in the mesh and not yet peered with `to`, `to` inserts $p$ and enqueues a discovery `Hello` to $p$.
- **Relay Session Application** (`relay.rs:92-94`):
  `apply_relay(&mut Node, RelayMsg::Hello)` returns `Ok(Some(hello))` to caller. Because `Node` manages only ledger state and is agnostic to overlay topology, the caller / connection manager handles peer routing tables.

### 3.2 Block Announcement & Gossip Flood
- **Production & Announcement** (`p2p.rs:295-338`):
  When a node produces a block (`produce`, `produce_empty`, `send`, `send_to`), it queries the full `BlockRecord` from `node.block_record(&id)`.
  It computes the block id (`record_id`), inserts it into its local `seen_blocks` set, and enqueues `Envelope::Block { record }` to all connected peers.
- **Relay Processing** (`p2p.rs:519-556`):
  When peer `to` receives `Envelope::Block`:
  1. **Hardening Check**: Calls `hardening.on_block(from, &id, true)` to track peer score and duplicate submissions.
  2. **Deduplication**: Inserts `id` into `seen_blocks[to]`. If already seen, delivery terminates.
  3. **Node Acceptance**: Calls `node.receive_block(record.clone())`. This validates timestamps against wall-clock drift, DAG parent presence, PoW hash targets, difficulty, and stateful UTXO validity.
  4. **Relay Flood**: Relays the block envelope to all peers of `to` except `from` ($nxt \neq from$).

### 3.3 Transaction Announcement & Eviction
- **Pooling & Announcement** (`p2p.rs:340-380`):
  `Mesh::pool` or `submit_signed` puts transactions into local mempool and enqueues `Envelope::Tx` to all peers.
- **Relay Processing** (`p2p.rs:558-584`):
  Peers submit received tx to `node.submit_tx(tx.clone())`. On successful block production, `node.evict_mempool()` purges any mempool transactions whose inputs were consumed by the selected chain.

### 3.4 Sync Protocol Handlers (`net.rs:580-714`)

The headers-first sync protocol over TCP operates in five distinct phases:
1. **Inventory Handshake**: Client sends `TAG_INVENTORY` with its `node.inventory()` (sorted `Vec<BlockId>`). Server responds with its own `node.inventory()`.
2. **Diff Calculation**: Client calculates `missing = peer_inv \ our_inv`.
3. **GetHeaders**: Client requests headers for `missing` IDs via `TAG_GETHEADERS`. Server fetches `node.headers_for(&missing)` and replies with `TAG_HEADERS`.
4. **GetBodies**: Client iterates over headers in batches of `MAX_BODIES` (10,000), sending `TAG_GETBODIES`. Server sends `TAG_BODIES`.
5. **Header-Body Integrity Verification**: Before inserting the block into the DAG, client calls `Node::verify_header_body(header, body)`:
   - Verifies `BLAKE3(encode_block_payload(&body.txs)) == header.payload_hash`
   - Verifies `payload.len() == header.payload_len`
   - Verifies `Block::new(body.parents, body.work, body.timestamp_ms, body.nonce, payload).id() == header.id`
   - Only matching bodies are forwarded to `node.receive_block(body)`.

---

## 4. SPV Light Client Wire Protocol Extension Design

### 4.1 Comparison of Header Representations

The codebase currently has two distinct header types:
1. **`kovanica_node::node::BlockHeader`** (`crates/kovanica-node/src/node.rs:157-173`):
   - Fields: `id: BlockId`, `parents: Vec<BlockId>`, `work: u128`, `timestamp_ms: u64`, `nonce: u64`, `payload_hash: [u8; 32]`, `payload_len: u64`.
   - Purpose: Untrusted inventory descriptor for full nodes to verify block payload hashes before downloading bodies.
2. **`kovanica_state::spv::BlockHeader`** (`crates/kovanica-state/src/spv.rs:43-63`):
   - Fields: `id: BlockId`, `prev_hash: BlockId`, `merkle_root: [u8; 32]`, `work: u128`, `timestamp_ms: u64`, `nonce: u64`, `blue_score: u64`, `chain_blue_work: u128`, `height: u64`.
   - Purpose: Self-verifying light client header. Commits to transaction tree via `merkle_root`, tracks selected-chain height and cumulative blue work, and supports difficulty verification against historical windows.

### 4.2 Merkle Proof Primitives in `kovanica-state`

`crates/kovanica-state/src/spv.rs` already contains complete, battle-tested Merkle tree and SPV validation logic:
- `merkle_root(txs: &[Transaction]) -> [u8; 32]`: Computes binary BLAKE3 Merkle tree root over transaction hashes. Duplicates odd trailing leaves.
- `generate_merkle_proof(txs: &[Transaction], index: usize) -> Option<MerkleProof>`: Builds leaf-to-root sibling hash path.
- `MerkleProof::verify(&self) -> bool`: Reconstructs root from `tx_id`, `index`, and sibling `path`, validating equality with `merkle_root`.
- `SpvClient`: Maintains verified header chain, validates `prev_hash`, monotonic timestamps, proof-of-work targets (`meets_target`), and difficulty retargeting (`Retarget::next_work`).

### 4.3 Proposed Wire Message Extensions for SPV

To satisfy R1 and R2 of `ORIGINAL_REQUEST.md`, we specify the extensions for `RelayMsg` and wire encoding:

#### Proposed `RelayMsg` Variants (`relay.rs`):
```rust
#[derive(Clone, Debug)]
pub enum RelayMsg {
    // Existing variants
    Hello { from: String, advertised: Vec<String> }, // Tag 0
    Block(BlockRecord),                              // Tag 1
    Tx(Transaction),                                 // Tag 2

    // SPV / Light Client Wire Messages
    GetHeaders {
        /// Locator block hashes (newest first)
        locator: Vec<BlockId>,
        /// Optional stop hash (zeros/none = up to tip)
        stop: Option<BlockId>,
    },                                               // Tag 3 (0x03 or 0x12)
    Headers(Vec<kovanica_state::spv::BlockHeader>),  // Tag 4 (0x04 or 0x11)
    GetBlocks {
        locator: Vec<BlockId>,
        stop: Option<BlockId>,
    },                                               // Tag 5 (0x05)
    GetMerkleProof {
        block_id: BlockId,
        tx_id: TxId,
    },                                               // Tag 6 (0x06)
    MerkleBlock {
        block_id: BlockId,
        proof: kovanica_state::spv::MerkleProof,
    },                                               // Tag 7 (0x07)
}
```

#### Proposed Wire Encodings:

1. **`GetHeaders` (Tag 3)**:
   ```text
   [TAG_GETHEADERS: 1 byte (3)]
   [locator_count: u64_le]
   [BlockId: 32 bytes] * locator_count
   [has_stop: 1 byte]
   [stop_id: 32 bytes] (if has_stop == 1)
   ```
2. **`Headers` (Tag 4)**:
   ```text
   [TAG_HEADERS: 1 byte (4)]
   [header_count: u64_le]
   Per Header:
     [id: 32 bytes]
     [prev_hash: 32 bytes]
     [merkle_root: 32 bytes]
     [work: u128_le] (16 bytes)
     [timestamp_ms: u64_le] (8 bytes)
     [nonce: u64_le] (8 bytes)
     [blue_score: u64_le] (8 bytes)
     [chain_blue_work: u128_le] (16 bytes)
     [height: u64_le] (8 bytes)
   ```
3. **`GetMerkleProof` (Tag 6)**:
   ```text
   [TAG_GETMERKLEPROOF: 1 byte (6)]
   [block_id: 32 bytes]
   [tx_id: 32 bytes]
   ```
4. **`MerkleBlock` (Tag 7)**:
   ```text
   [TAG_MERKLEBLOCK: 1 byte (7)]
   [block_id: 32 bytes]
   [tx_id: 32 bytes]
   [merkle_root: 32 bytes]
   [path_len: u64_le]
   [sibling_hash: 32 bytes] * path_len
   [index: u64_le]
   [tx_count: u64_le]
   ```

### 4.4 Dispatching in `RelaySession` and Full Node

When a full node running `RelaySession` receives SPV messages:
- On `GetHeaders { locator, stop }`:
  The node finds the highest block in `locator` present in its selected chain, extracts headers along the selected chain from that point up to `stop` (or tip, max 2,000 headers), using `node.export_spv_headers()` / `spv::BlockHeader::from_block()`, and replies with `RelayMsg::Headers`.
- On `GetMerkleProof { block_id, tx_id }`:
  The node queries `node.block_record(&block_id)`. If found, searches for `tx_id` in `record.txs`. If present at `index`, generates `generate_merkle_proof(&record.txs, index)` and replies with `RelayMsg::MerkleBlock { block_id, proof }`.
- Light Client Processing:
  The light client receives `RelayMsg::Headers`, iterates through them, and invokes `SpvClient::add_header(header)`.
  When a payment confirmation is needed, the light client sends `RelayMsg::GetMerkleProof`, receives `RelayMsg::MerkleBlock`, and invokes `SpvClient::verify_transaction(&proof, header.height)`.

---

## 5. Defensive Bounds, Buffer Limits & Error Handling

### 5.1 Protocol Limits Summary

| Scope | Identifier / Parameter | Limit Value | Defensive Purpose |
|---|---|---|---|
| Socket Frame | `MAX_FRAME` (`relay.rs`) | 4 MB (4,194,304 bytes) | Rejects oversized socket frames before allocating buffer |
| Net Frame | `MAX_FRAME_BYTES` (`net.rs`) | 16 MB (16,777,216 bytes) | Upper bound on sync batch frames |
| Inventory | `MAX_INVENTORY_IDS` (`net.rs`) | 200,000 IDs (~6.4 MB) | Prevents unbounded vector allocations from untrusted count |
| Headers Batch | `MAX_HEADERS` (`net.rs`) | 10,000 headers (~3 MB) | Bounds single getheaders response |
| Bodies Batch | `MAX_BODIES` (`net.rs`) | 10,000 blocks | Bounds body chunk transfers |
| Payload Size | `MAX_BLOCK_PAYLOAD_SIZE` | 16 MB | Limits single block transaction bytes |
| Parents Count | `read_record_from` | 4,096 parents | Rejects malformed parent counts |
| Timestamp Drift | `MAX_FUTURE_DRIFT_MS` (`node.rs`)| 2 hours (7,200,000 ms) | Node policy: rejects blocks stamped > 2h into future |

### 5.2 Defensive Cursor Reading (`net.rs:296-332`)

To defend against memory exhaustion where a malicious peer sends `u64::MAX` as count on a short stream:
```rust
fn read_count(&mut self, min_element_bytes: usize) -> Result<usize, NetError> {
    let n = u64::from_le_bytes(self.read_array::<8>()?) as usize;
    if min_element_bytes > 0 && n > self.remaining() / min_element_bytes {
        return Err(NetError::Decode("count too large".into()));
    }
    Ok(n)
}
```
This check guarantees that the buffer actually contains enough remaining bytes to satisfy the claimed count before allocating any vector capacity.

### 5.3 P2P Hardening State Machine (`p2p_hardening.rs`)

`P2pHardening` provides:
1. **Token-Bucket Rate Limiting**: Tracks `bytes_in_window` and `messages_in_window` per peer across `rate_window_ticks` (default 1 MB / 1000 msgs per 100 ticks).
2. **Duplicate Suppression & Penalty**:
   - Duplicate block penalty: `-5` score
   - Duplicate tx penalty: `-2` score
3. **Misbehavior & Banning**:
   - Invalid block/tx penalty: `-20` / `-10` score
   - Auto-ban threshold: `score <= -50` (`ban_threshold`). Once banned, all traffic from peer is dropped.

---

## 6. Implementation and Verification Strategy

### 6.1 Integration Plan for SPV Wire Protocol
1. **State / DAG Layer**: Re-export or integrate `kovanica_state::spv` types into `kovanica_node`.
2. **Node Helpers**: Add helper methods to `Node`:
   - `Node::export_spv_headers(&self) -> Vec<kovanica_state::spv::BlockHeader>`
   - `Node::generate_merkle_proof(&self, block_id: &BlockId, tx_id: &TxId) -> Option<MerkleProof>`
3. **Relay & Wire Protocol**:
   - Add `GetHeaders`, `Headers`, `GetBlocks`, `GetMerkleProof`, `MerkleBlock` variants to `RelayMsg`.
   - Implement `encode_msg` and `decode_msg` with tags `3..=7`.
   - Update `apply_relay` or create `handle_relay_query` to service queries from incoming `RelayMsg` frames.
4. **SPV Integration Test (`tests/spv_sync.rs`)**:
   - Spawn full node with difficulty retargeting and proof-of-work enabled.
   - Mine multiple blocks with transactions.
   - Connect SPV client via `RelaySession::connect`.
   - Send `GetHeaders`, receive `Headers`, verify header chain against difficulty retarget and future drift limits.
   - Send `GetMerkleProof` for a transaction, receive `MerkleBlock`, verify `proof.verify()` against header `merkle_root`.
   - Confirm SPV client synced and verified without downloading full block records or transaction payloads.
