# Project: SPV Wire Protocol and Light Client Integration

## Architecture
- **Consensus & State Layer** (`crates/kovanica-dag`, `crates/kovanica-state`):
  - Block header definition, BLAKE3 id derivation, Proof-of-Work target checking (`pow::meets_target`), Difficulty retargeting window calculation (`Retarget::next_work`).
  - SPV Merkle tree root calculation (`merkle_root`), sibling path proof generation (`generate_merkle_proof`), and branch proof verification (`MerkleProof::verify`).
  - `SpvClient` state machine tracking header chains, monotonic timestamps, difficulty boundaries, and transaction inclusion.
- **Node & Network Layer** (`crates/kovanica-node`):
  - Wire messages and framing (`net.rs`, `relay.rs`): support `getheaders`, `headers`, `getblocks`, `merkleblock` with explicit tags and length-prefixed frame validation (`MAX_FRAME = 4MB`).
  - `Node` SPV serving APIs: header exports along the selected chain/DAG, transaction Merkle proof extraction from stored block records, and `merkleblock` assembly.
  - P2P Relay & Mesh integration: long-lived `RelaySession` handling SPV request-response flows and in-process `Mesh` support.
- **E2E & Integration Testing Layer** (`crates/kovanica-node/tests/spv_sync.rs`):
  - Opaque-box full node and SPV light client sync over real TCP sockets.
  - Header sync without block payloads, difficulty retargeting clamp checks, future drift boundary checks (`MAX_FUTURE_DRIFT_MS = 2h`), and Merkle proof payment verification.

## Feature Inventory
| # | Feature | Description | Milestone | Source | Status |
|---|---------|-------------|-----------|--------|--------|
| 1 | SPV Wire Message Types & Serialization | Define wire message tags, payload serialization/deserialization for `getheaders`, `headers`, `getblocks`, `merkleblock` in `net.rs` and `relay.rs` | M1 | Survey | DONE |
| 2 | Full Node SPV Serving Capabilities | Implement `Node` and `RelaySession` handlers to serve headers, blocks, and `merkleblock` proofs to light clients over TCP | M1 | Survey | DONE |
| 3 | Light Client SPV Wire Protocol Sync | Integrate `SpvClient` with wire framing to request headers, process `headers` messages, and request/verify `merkleblock` | M1 | Survey | DONE |
| 4 | E2E SPV Sync Integration Test Suite | Comprehensive 4-tier integration test suite in `tests/spv_sync.rs` verifying TCP header sync, Merkle proofs, difficulty retargeting, and drift limits | M2 | Survey / ORIGINAL_REQUEST | DONE |
| 5 | Final Milestone: 100% E2E Pass & Adversarial Hardening | Pass 100% of integration & E2E tests, followed by Tier 5 white-box adversarial stress testing and coverage hardening | M3 | Survey / Pattern | DONE |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | SPV Wire Protocol & Light Client Engine | Implement SPV messages in `relay.rs`/`net.rs`, node serving handlers in `node.rs`, and wire sync client in `spv.rs` | none | DONE |
| 2 | E2E Integration Test Suite (`tests/spv_sync.rs`) | Complete 4-tier E2E test suite for SPV sync over TCP, difficulty bounds, drift limits | M1 | DONE |
| 3 | Final E2E Pass & Adversarial Hardening | 100% E2E test pass + Tier 5 adversarial stress testing (`adversarial_spv.rs`, `challenger_consensus_sync.rs`) | M2 | DONE |

## Interface Contracts
### Wire Protocol (`RelayMsg` & `net.rs`)
- `TAG_GETHEADERS = 0x12` / `RelayMsg::GetHeaders { locator: Vec<BlockId>, stop_hash: Option<BlockId>, max_count: u32 }`
- `TAG_HEADERS = 0x11` / `RelayMsg::Headers { headers: Vec<BlockHeader> }`
- `TAG_GETBLOCKS = 0x13` / `RelayMsg::GetBlocks { locator: Vec<BlockId>, stop_hash: Option<BlockId> }`
- `TAG_GET_MERKLE_PROOF = 0x15` / `RelayMsg::GetMerkleProof { block_id: BlockId, tx_id: TxId }`
- `TAG_MERKLEBLOCK = 0x16` / `RelayMsg::MerkleBlock { block_id: BlockId, merkle_root: [u8; 32], tx_count: u32, proof: Option<MerkleProof>, matched_tx: Option<Transaction> }`

### Full Node SPV API (`Node`)
- `node.spv_header(id: &BlockId) -> Option<BlockHeader>`
- `node.headers_from(locator: &[BlockId], stop: Option<BlockId>, limit: usize) -> Result<Vec<BlockHeader>, NodeError>`
- `node.merkle_block(block_id: &BlockId, tx_id: &TxId) -> Result<MerkleBlock, NodeError>`

### Light Client SPV Verification (`SpvClient`)
- `sync_headers_via_relay(session: &mut RelaySession, client: &mut SpvClient, stop: Option<BlockId>) -> Result<usize, NetError>`
- `sync_headers_via_relay_with_clock(session: &mut RelaySession, client: &mut SpvClient, stop: Option<BlockId>, now_ms: u64) -> Result<usize, NetError>`
- `request_merkle_block(session: &mut RelaySession, block_id: BlockId, tx_id: TxId) -> Result<MerkleBlock, NetError>`
- `verify_merkle_block(client: &SpvClient, mb: &MerkleBlock, target_tx_id: &TxId) -> Result<bool, SpvError>`

## Code Layout
- `crates/kovanica-node/src/relay.rs`: Wire message definitions (`RelayMsg`), tag serialization, decoding, session framing, `handle_relay_query`.
- `crates/kovanica-node/src/net.rs`: Wire tags, header-first sync framing, bounded deserializers.
- `crates/kovanica-node/src/node.rs`: `Node` SPV methods (`spv_header`, `export_spv_headers`, `headers_from`, `merkle_block`).
- `crates/kovanica-node/src/spv.rs`: Light client wire communication (`build_locator`, `sync_headers_via_relay`, `request_merkle_block`, `verify_merkle_block`).
- `crates/kovanica-node/tests/spv_sync.rs`: Dedicated E2E integration test suite.
- `crates/kovanica-node/tests/adversarial_spv.rs`: Fuzzing and adversarial concurrency test suite.
- `crates/kovanica-node/tests/challenger_consensus_sync.rs`: Empirical consensus difficulty & wall-clock drift invariant test suite.
