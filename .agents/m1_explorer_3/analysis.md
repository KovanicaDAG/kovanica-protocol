# Analysis: Light Client Sync & Verification Over TCP Streams

**Author**: `m1_explorer_3`  
**Milestone**: Milestone 1 — SPV Wire Protocol & Light Client Engine  
**Target Subsystems**: `crates/kovanica-state/src/spv.rs`, `crates/kovanica-node/src/relay.rs`, `crates/kovanica-node/src/node.rs`, `crates/kovanica-node/src/spv.rs`, `crates/kovanica-node/tests/spv_sync.rs`  
**Date**: 2026-08-24  

---

## 1. Executive Summary

This document provides a comprehensive technical specification and architectural blueprint for the **Kovanica SPV (Simplified Payment Verification) Light Client Engine** and its synchronization over TCP streams. 

Mobile wallets, embedded hardware, and light nodes cannot store the full Directed Acyclic Graph (DAG) or evaluate the complete UTXO state transitions. Instead, light clients operate by:
1. Synchronizing a stream of compact **Block Headers** along the GHOSTDAG selected chain over persistent TCP connections (`RelaySession`).
2. Inductively validating the proof-of-work, cumulative chain blue work, timestamp monotonicity, wall-clock future drift limits ($\le 2\text{ hours}$), and difficulty retargeting bounds ($\le 4\times$ change factor, sliding window calculation).
3. Requesting selective cryptographic **Merkle Proofs** (`MerkleBlock`) for specific transactions of interest and validating transaction inclusion against verified header Merkle roots without ever downloading full block payloads.

This achieves $>99\%$ bandwidth and storage reduction compared to full node synchronization while preserving Nakamoto SPV security guarantees.

---

## 2. SPV Cryptographic & Data Structure Foundations

### 2.1 Block Header Definition (`kovanica_state::spv::BlockHeader`)

The SPV header commits to the consensus state of the GHOSTDAG selected chain and the block payload transactions via a 32-byte Merkle root:

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlockHeader {
    /// The block's canonical BLAKE3 identifier.
    pub id: BlockId,
    /// Hash of the previous block in the GHOSTDAG selected chain.
    pub prev_hash: BlockId,
    /// BLAKE3 Merkle root of the block's transaction sequence.
    pub merkle_root: [u8; 32],
    /// Proof-of-work difficulty weight for this block.
    pub work: u128,
    /// Timestamp in milliseconds since UNIX epoch.
    pub timestamp_ms: u64,
    /// Proof-of-work search nonce.
    pub nonce: u64,
    /// GHOSTDAG blue score (selected chain height).
    pub blue_score: u64,
    /// Cumulative blue work of the selected chain up to this block.
    pub chain_blue_work: u128,
    /// Linear index in the selected chain (0 = genesis).
    pub height: u64,
}
```

#### Size & Bandwidth Comparison:
- **SPV Header Size**: $32 + 32 + 32 + 16 + 8 + 8 + 8 + 16 + 8 = 160\text{ bytes}$.
- **Full Block Payload Size**: Up to $1\text{ MB} - 16\text{ MB}$ (`MAX_BLOCK_PAYLOAD_SIZE`).
- **Bandwidth Efficiency**: Syncing 10,000 headers requires $\sim 1.6\text{ MB}$ of data transfer vs $\sim 10\text{ GB}$ for full blocks ($99.984\%$ reduction).

---

### 2.2 BLAKE3 Merkle Tree & Proof Generation

The transaction list $T = [tx_0, tx_1, \dots, tx_{n-1}]$ is hashed into a balanced binary Merkle tree using BLAKE3:

1. **Leaf Hashes**: $L_i = \text{BLAKE3}(tx_i.\text{id}())$.
2. **Internal Nodes**: For a pair of child nodes $(C_{\text{left}}, C_{\text{right}})$, the parent node is:
   $$\text{Parent} = \text{BLAKE3}(C_{\text{left}} \mathbin{\Vert} C_{\text{right}})$$
3. **Odd Leaf Handling**: If a level has an odd number of elements, the last element is duplicated to maintain a balanced binary structure:
   $$\text{Parent}_{\text{last}} = \text{BLAKE3}(C_{\text{last}} \mathbin{\Vert} C_{\text{last}})$$

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MerkleProof {
    /// The transaction ID (BLAKE3 hash) being proven.
    pub tx_id: [u8; 32],
    /// The root against which the proof is verified.
    pub merkle_root: [u8; 32],
    /// Sibling hashes along the path from leaf to root (ordered leaf-to-root).
    pub path: Vec<[u8; 32]>,
    /// Index of the transaction in the block's transaction sequence.
    pub index: usize,
    /// Total number of transactions in the block.
    pub tx_count: usize,
}
```

#### Verification Algorithm:
```rust
impl MerkleProof {
    pub fn verify(&self) -> bool {
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
    }
}
```

---

## 3. Light Client Consensus & Protocol Rules Engine

To prevent fraudulent chain advertisements, the light client executes strict validation on every received header prior to state advancement.

```
+-----------------------------------------------------------------------------------+
|                           SPV Header Validation Pipeline                          |
+-----------------------------------------------------------------------------------+
                                        |
                                        v
                    +---------------------------------------+
                    | 1. Link & Height Monotonicity Check   |
                    |    - prev_hash == tip.id              |
                    |    - height == tip.height + 1         |
                    |    - chain_blue_work > tip.work       |
                    +---------------------------------------+
                                        | [Pass]
                                        v
                    +---------------------------------------+
                    | 2. Timestamp Monotonicity Check       |
                    |    - timestamp_ms >= tip.timestamp_ms |
                    +---------------------------------------+
                                        | [Pass]
                                        v
                    +---------------------------------------+
                    | 3. Wall-Clock Future Drift Check      |
                    |    - timestamp_ms <= now_ms + 2h      |
                    +---------------------------------------+
                                        | [Pass]
                                        v
                    +---------------------------------------+
                    | 4. Proof-of-Work Target Check         |
                    |    - H(id) * work < 2^256             |
                    +---------------------------------------+
                                        | [Pass]
                                        v
                    +---------------------------------------+
                    | 5. Difficulty Retargeting Check       |
                    |    - work == Retarget::next_work(...) |
                    +---------------------------------------+
                                        | [Pass]
                                        v
                    +---------------------------------------+
                    | 6. Commit Header to SPV State Store   |
                    +---------------------------------------+
```

---

### 3.1 Difficulty Retargeting Bounds Enforcement

Difficulty retargeting ensures hash rate fluctuations maintain the target block production rate. The light client independently calculates the expected work for incoming headers using the same sliding window rules as the full node consensus core:

$$\text{intervals} = \text{samples}.\text{len}() - 1$$
$$\text{expected\_timespan} = \text{intervals} \times \text{target\_interval\_ms}$$
$$\text{actual\_timespan} = t_{\text{last}} - t_{\text{first}}$$
$$\text{avg\_work} = \frac{\sum_{i=0}^{n-1} w_i}{n}$$
$$\text{scaled\_work} = \frac{\text{avg\_work} \times \text{expected\_timespan}}{\text{actual\_timespan}}$$

#### Retargeting Clamping Limits:
$$\text{lower\_bound} = \max\left(\frac{\text{avg\_work}}{\text{max\_factor}}, \text{min\_work}\right)$$
$$\text{upper\_bound} = \max(\text{avg\_work} \times \text{max\_factor}, \text{min\_work})$$
$$\text{expected\_work} = \text{clamp}(\text{scaled\_work}, \text{lower\_bound}, \text{upper\_bound})$$

Where:
- `window` = 20 blocks (or configurable per testnet).
- `max_factor` = 4 ($4\times$ upward clamp, $0.25\times$ downward clamp).
- `target_interval_ms` = 1,000 ms.
- `min_work` = 1.

#### Light Client Difficulty Verification Rule:
For every incoming header $H$ at height $h$:
1. If $h = 0$ (genesis checkpoint): Accepted unconditionally.
2. If $h \ge 1$: The client retrieves up to $\text{window} + 1$ verified headers preceding $h$ from its local store in ascending chronological order ($[H_{h-\text{window}}, \dots, H_{h-1}]$).
3. If the available history has $< 2$ samples, expected work is `retarget.min_work`.
4. Otherwise, the expected work is evaluated via `retarget.next_work(&samples)`.
5. If $H.\text{work} \neq \text{expected\_work}$, the header is rejected with `SpvError::DifficultyMismatch { expected, actual }`.

---

### 3.2 Wall-Clock Future Drift Boundary Limits

Full nodes enforce a 2-hour maximum future drift rule (`MAX_FUTURE_DRIFT_MS = 2 * 60 * 60 * 1000 = 7,200,000 ms`) to prevent time-warp attacks. Light clients must enforce the identical boundary relative to their own local wall clock:

$$\text{header}.\text{timestamp\_ms} \le \text{client\_now\_ms} + \text{MAX\_FUTURE\_DRIFT\_MS}$$

#### Clock Injectability for Deterministic Verification:
To enable deterministic unit, integration, and adversarial testing, `SpvClient` provides clock injection matching `Node::set_now_ms`:

```rust
#[derive(Default, Clone, Debug)]
pub enum SpvClock {
    #[default]
    Wall,
    Fixed(u64),
}

impl SpvClient {
    pub fn set_now_ms(&mut self, now_ms: u64) {
        self.clock = SpvClock::Fixed(now_ms);
    }
    
    pub fn now_ms(&self) -> u64 {
        match self.clock {
            SpvClock::Wall => SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |d| d.as_millis() as u64),
            SpvClock::Fixed(n) => n,
        }
    }
}
```

If `header.timestamp_ms > self.now_ms() + MAX_FUTURE_DRIFT_MS`, the header is rejected immediately with `SpvError::TimestampTooFarInFuture { timestamp_ms, now_ms }`.

---

## 4. P2P SPV Wire Protocol Specification

### 4.1 Message Tag Definitions & Payload Formats

The wire protocol operates over framed TCP streams (`RelaySession`), prefixed with a 4-byte little-endian length. The maximum frame size is bounded by `MAX_FRAME = 4 * 1024 * 1024` (4 MB).

| Tag Name | Byte Tag | Struct Representation | Description |
|---|---|---|---|
| `TAG_GETHEADERS` | `0x12` | `RelayMsg::GetHeaders { locator, stop_hash, max_count }` | Request headers starting after the locator up to `stop_hash` or `max_count`. |
| `TAG_HEADERS` | `0x11` | `RelayMsg::Headers { headers }` | Batch response containing up to `MAX_HEADERS` (10,000) SPV block headers. |
| `TAG_GETBLOCKS` | `0x13` | `RelayMsg::GetBlocks { locator, stop_hash }` | Request block inventory starting after locator. |
| `TAG_GET_MERKLE_PROOF` | `0x15` | `RelayMsg::GetMerkleProof { block_id, tx_id }` | Query a cryptographic Merkle proof for a specific tx in a block. |
| `TAG_MERKLEBLOCK` | `0x16` | `RelayMsg::MerkleBlock { block_id, merkle_root, tx_count, proof, matched_tx }` | Response carrying Merkle proof and matched transaction payload. |

---

### 4.2 Binary Serialization Schemes

#### 1. `TAG_GETHEADERS` (`0x12`)
```
[1 byte: 0x12]
[4 bytes: locator_count (u32 LE)]
  for each locator: [32 bytes: BlockId]
[1 byte: has_stop (0 or 1)]
  if has_stop == 1: [32 bytes: stop_hash]
[4 bytes: max_count (u32 LE)]
```

#### 2. `TAG_HEADERS` (`0x11`)
```
[1 byte: 0x11]
[4 bytes: header_count (u32 LE)]
  for each header:
    [32 bytes: id]
    [32 bytes: prev_hash]
    [32 bytes: merkle_root]
    [16 bytes: work (u128 LE)]
    [8 bytes: timestamp_ms (u64 LE)]
    [8 bytes: nonce (u64 LE)]
    [8 bytes: blue_score (u64 LE)]
    [16 bytes: chain_blue_work (u128 LE)]
    [8 bytes: height (u64 LE)]
```

#### 3. `TAG_GET_MERKLE_PROOF` (`0x15`)
```
[1 byte: 0x15]
[32 bytes: block_id]
[32 bytes: tx_id]
```

#### 4. `TAG_MERKLEBLOCK` (`0x16`)
```
[1 byte: 0x16]
[32 bytes: block_id]
[32 bytes: merkle_root]
[4 bytes: tx_count (u32 LE)]
[1 byte: has_proof (0 or 1)]
  if has_proof == 1:
    [32 bytes: tx_id]
    [32 bytes: merkle_root]
    [4 bytes: path_len (u32 LE)]
      for each hash in path: [32 bytes: sibling_hash]
    [8 bytes: index (u64 LE)]
    [8 bytes: tx_count (u64 LE)]
[1 byte: has_matched_tx (0 or 1)]
  if has_matched_tx == 1:
    [4 bytes: tx_payload_len (u32 LE)]
    [N bytes: canonical transaction encoding]
```

---

## 5. Light Client Synchronization State Machine

```
                   +-----------------------+
                   |     Disconnected      |
                   +-----------------------+
                               |
                               | RelaySession::connect()
                               v
                   +-----------------------+
                   |     Connected         |
                   +-----------------------+
                               |
                               | send(GetHeaders { locator })
                               v
                   +-----------------------+
                   |   Awaiting Headers    |
                   +-----------------------+
                               |
                               | recv() -> Headers(headers)
                               v
                   +-----------------------+
                   |   Validating Batch    |
                   +-----------------------+
                     /                   \
      [Valid Headers]                     [Invalid Header: PoW / Drift / Retarget]
            v                                      v
+-----------------------+               +-----------------------+
|  Update Tip & Headers |               |  Disconnect / Abort   |
+-----------------------+               +-----------------------+
            |
            | (If more headers exist) -> Loop to Awaiting Headers
            v
+-----------------------+
|    Synced to Tip      |
+-----------------------+
            |
            | send(GetMerkleProof { block_id, tx_id })
            v
+-----------------------+
| Awaiting Merkle Proof |
+-----------------------+
            |
            | recv() -> MerkleBlock { proof, matched_tx }
            v
+-----------------------+
| Verify Root & Branch  |
+-----------------------+
```

### 5.1 Block Locator Construction

When synchronizing, the client builds a locator to allow the full node to find the fork point efficiently:
1. Include the current tip: `locator.push(tip.id)`.
2. Step back exponentially: $h - 1, h - 2, h - 4, h - 8, \dots$.
3. Include the trusted checkpoint: `locator.push(checkpoint.id)`.

---

## 6. Verification Method & Test Architecture

The light client implementation must pass the comprehensive 4-tier test suite in `crates/kovanica-node/tests/spv_sync.rs`.

### 6.1 Test Execution Matrix

| Tier | Test Case Identifier | Objective | Verification Condition |
|---|---|---|---|
| **Tier 1** | `test_spv_wire_roundtrip` | Verify binary encoding/decoding of all SPV messages | Identical struct equality across serialize-deserialize cycle |
| **Tier 1** | `test_spv_header_sync_over_tcp` | Sync 10 headers over loopback TCP | `spv_client.tip().unwrap().height == 10` |
| **Tier 1** | `test_spv_merkle_proof_verification` | Request and verify Merkle proof for transfer tx | `spv_client.verify_merkle_block(&mb) == true` |
| **Tier 2** | `test_spv_drift_exact_boundary_accept` | Block timestamp at `now + 2h` | Header accepted into SPV chain |
| **Tier 2** | `test_spv_drift_exact_boundary_reject` | Block timestamp at `now + 2h + 1ms` | Header rejected with `TimestampTooFarInFuture` |
| **Tier 2** | `test_spv_difficulty_clamp_upward` | Fast blocks with $10\times$ speedup | Work clamped to exact $4\times$ upper bound |
| **Tier 2** | `test_spv_difficulty_clamp_downward` | Slow blocks with $10\times$ delay | Work clamped to exact $0.25\times$ lower bound |
| **Tier 3** | `test_spv_multi_client_concurrent_sync` | 4 concurrent light clients syncing from 1 node | All 4 clients sync to identical tip |
| **Tier 4** | `test_spv_tampered_merkle_proof_rejection` | Attacker mutates tx output or sibling hash | Proof verification fails (`verify() == false`) |
| **Tier 4** | `test_spv_time_warp_attack_rejection` | Attacker serves far-future headers | Light client aborts sync with error |

---

## 7. Implementation Recommendations for Implementers

1. **Reconcile SPV Header Types**:
   - Keep `kovanica_state::spv::BlockHeader` as the canonical SPV header structure.
   - Re-export `kovanica_state::spv::BlockHeader` in `kovanica_node::spv` or `kovanica_node::node` to eliminate confusion with `kovanica_node::node::BlockHeader`.

2. **Full Node Methods in `kovanica-node/src/node.rs`**:
   - `node.export_spv_headers(&self) -> Vec<kovanica_state::spv::BlockHeader>`
   - `node.spv_headers_from(&self, locator: &[BlockId], stop: Option<BlockId>, limit: usize) -> Vec<kovanica_state::spv::BlockHeader>`
   - `node.merkle_block(&self, block_id: BlockId, tx_id: TxId) -> Result<MerkleBlock, NodeError>`

3. **Light Client Networking Helper in `kovanica-node/src/spv.rs`**:
   - Provide a clean helper `SpvSyncEngine` or extend `SpvClient`:
     - `client.sync_headers_via_relay(&mut self, session: &mut RelaySession) -> Result<usize, SpvError>`
     - `client.fetch_and_verify_merkle_proof(&self, session: &mut RelaySession, block_id: BlockId, tx_id: TxId) -> Result<Transaction, SpvError>`

4. **Safety & Robustness**:
   - Always bound network reads (`set_read_timeout(Some(Duration::from_secs(2)))`).
   - Validate array and count lengths before memory allocation to prevent malicious OOM attacks.
