# SPV Client Architecture & E2E Testing Strategy Analysis

**Agent**: `survey_explorer_3`  
**Date**: 2026-08-24T00:11:00Z  
**Workspace**: `/root/kovanica-protocol`  
**Target Crates**: `kovanica-node`, `kovanica-state`, `kovanica-dag`  

---

## Executive Summary

This report establishes the technical architecture, test harnesses, and end-to-end (E2E) testing strategy for the **Simplified Payment Verification (SPV) / Light Client wire protocol** and **Merkle Proof verification over TCP** in Kovanica.

1. **Test Infrastructure**: Full nodes and mock peers are spun up in existing integration tests via ephemeral TCP binding (`127.0.0.1:0`), background worker threads (`thread::spawn`), bounded I/O timeouts (`set_read_timeout` / `set_write_timeout`), pinned mock clocks (`node.set_now_ms(...)`), and deterministic key generation (`KeyPair::from_u64(...)`). In-process gossip tests leverage `p2p::Mesh` with discrete time ticks (`mesh.tick()` / `mesh.drain()`).
2. **SPV Client Architecture**: A light client maintains a lightweight headers chain (`HashMap<u64, BlockHeader>`), trusted checkpoint, highest verified tip, tracked addresses, and verified Merkle proofs. Headers are validated against parent linkage, monotonicity, proof-of-work (`meets_target`), difficulty retargeting (`Retarget::next_work`), and wall-clock future drift (`MAX_FUTURE_DRIFT_MS = 2h`). Transactions are verified via BLAKE3 Merkle proofs without downloading block transaction bodies.
3. **Acceptance Criteria**: The implementation must provide a dedicated integration test (`crates/kovanica-node/tests/spv_sync.rs`) showing an SPV client syncing headers over TCP from a full node without downloading full block payloads, followed by requesting and verifying a Merkle proof for a transaction over the wire protocol under difficulty retargeting and timestamp drift constraints.
4. **Testing Suite Matrix (Tiers 1–4)**: A structured 4-tier testing matrix covering wire message encoding/decoding, boundary conditions (drift edge, difficulty clamping $\pm 4\times$, empty responses), E2E TCP sync and proof verification, and realistic application scenarios (mobile wallet workflow, bandwidth reduction $>90\%$, malicious peer rejection, chain reorgs).

---

## 1. Test Harness Infrastructure & Peer Management

Investigation of existing tests in `crates/kovanica-node/tests/`:
- `network.rs` (lines 74–144): One-shot TCP pull sync and bidirectional exchange
- `relay.rs` (lines 18–142): Persistent bidirectional TCP sessions
- `timestamps.rs` (lines 23–134): Wall-clock future drift policy and pinned clock determinism
- `p2p.rs` (lines 24–248): Discrete in-process mesh gossip, discovery, and hardening
- `rpc.rs` (lines 14–142): Line-based RPC and snapshot/checkpoint recovery
- `mempool.rs` (lines 18–76): Mempool packing and conflict eviction

### 1.1 TCP Node Spin-up Pattern

```rust
// 1. Bind to ephemeral port to avoid port collisions across parallel test runs
let listener = TcpListener::bind("127.0.0.1:0").unwrap();
let addr = listener.local_addr().unwrap();

// 2. Spawn server thread
// Note: `Node` is not `Send`, so either:
// (a) Pre-export records/headers before spawning, OR
// (b) Construct and own the `Node` inside the spawned thread closure.
let handle = thread::spawn(move || {
    // Wrap listener in RelaySession or run serve_headers_first / serve_exchange
    let mut server = RelaySession::accept(&listener).unwrap();
    server.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    server.set_write_timeout(Some(Duration::from_secs(2))).unwrap();
    // Serve responses...
});

// 3. Connect client on main thread with explicit timeouts
let mut client = RelaySession::connect(addr).unwrap();
client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
client.set_write_timeout(Some(Duration::from_secs(2))).unwrap();

// 4. Join server thread on teardown to assert clean completion
handle.join().unwrap();
```

### 1.2 In-Process Mock Peers & Overlay (`Mesh`)

For in-process testing without OS socket overhead:
- `Mesh::new()` / `Mesh::with_hardening_config(config)`
- `mesh.add("node_name", node)`
- `mesh.connect("alpha", "beta")` establishes directed overlay edge
- `mesh.tick()` advances discrete time `mesh.now() += 1` and delivers envelopes due at `now`
- `mesh.drain(limit)` steps until queue is empty or limit reached (deterministic termination)
- `mesh.events()` provides structured event log (`GossipEvent` with `at`, `from`, `to`, `kind`)

### 1.3 Determinism and Injectable Clock

Consensus block IDs commit to `timestamp_ms` (`crates/kovanica-dag/src/block.rs:323`). In order to make test assertions 100% deterministic and reproducible:
- `node.set_now_ms(1_700_000_000_000)` pins the node's internal clock (`Clock::Fixed(n)` in `crates/kovanica-node/src/node.rs:233`).
- All actor addresses in tests use deterministic seeds: `Node::address(seed)` where `seed: u64` generates ed25519 keypairs via `KeyPair::from_u64(seed)` (`crates/kovanica-state/src/keys.rs:40`).

---

## 2. SPV Client Architecture & Verification State

### 2.1 Full Node vs SPV Client Responsibilities

| Dimension | Full Node (`kovanica_node::Node`) | SPV Client (`kovanica_state::spv::SpvClient`) |
| :--- | :--- | :--- |
| **Storage** | Full BlockDAG, reachability oracle, full UTXO set, all raw transaction payloads | Headers only, verified tips, tracked transaction Merkle proofs |
| **Bandwidth** | Downloads full blocks (headers + all tx payloads) | Downloads headers ($\sim 112$ bytes/block) + selective Merkle proofs |
| **Validation Scope** | Full state transition execution, input existence, ed25519 signatures, balance accounting | Header PoW, difficulty retargeting, timestamp monotonicity & drift, Merkle path evaluation |
| **Trust Model** | Trustless from genesis / checkpoint | Trusts checkpoint header + majority honest hash power (GHOSTDAG heaviest chain) |

### 2.2 SPV Client State Machine

Based on `crates/kovanica-state/src/spv.rs:412–512`:

```rust
pub struct SpvClient {
    /// Verified block headers indexed by height
    headers: HashMap<u64, BlockHeader>,
    /// Highest verified header (tip of the SPV selected chain)
    tip: Option<BlockHeader>,
    /// Trusted checkpoint anchor (genesis or hardcoded checkpoint)
    checkpoint: Option<BlockHeader>,
    /// Flag requiring proof-of-work validation (`meets_target`)
    require_pow: bool,
    /// Optional difficulty retarget policy (`Retarget`)
    retarget: Option<Retarget>,
    /// Tracked addresses of the light wallet
    tracked_addresses: HashSet<Address>,
    /// Verified transaction inclusion proofs: tx_id -> (MerkleProof, block_height)
    verified_txs: HashMap<TxId, (MerkleProof, u64)>,
    /// Local pinned or wall clock for future drift checking
    now_ms: u64,
}
```

### 2.3 Header Structure Comparison

1. **DAG Node Header** (`crates/kovanica-node/src/node.rs:157–173`):
   - `id`: `BlockId`
   - `parents`: `Vec<BlockId>`
   - `work`: `u128`
   - `timestamp_ms`: `u64`
   - `nonce`: `u64`
   - `payload_hash`: `[u8; 32]` (BLAKE3 hash of raw serialized payload)
   - `payload_len`: `u64`
2. **SPV Selected Chain Header** (`crates/kovanica-state/src/spv.rs:43–62`):
   - `id`: `BlockId`
   - `prev_hash`: `BlockId` (selected parent ID)
   - `merkle_root`: `[u8; 32]` (BLAKE3 Merkle root over block's tx list)
   - `work`: `u128`
   - `timestamp_ms`: `u64`
   - `nonce`: `u64`
   - `blue_score`: `u64`
   - `chain_blue_work`: `u128`
   - `height`: `u64`

### 2.4 Header & Merkle Proof Verification Pipeline

```
1. Header Ingestion:
   [New Header H]
         │
         ├── Check: H.height == tip.height + 1
         ├── Check: H.prev_hash == tip.id
         ├── Check: H.timestamp_ms >= tip.timestamp_ms (Monotonicity)
         ├── Check: H.timestamp_ms <= client.now_ms + 2h (Future Drift Bound)
         ├── Check: H.chain_blue_work > tip.chain_blue_work (Accumulating Work)
         ├── Check: meets_target(H.id, H.work) (Proof-of-Work, if enabled)
         └── Check: H.work == retarget.next_work(window_samples) (Difficulty Target)
         │
         ▼
   Accept Header & Update Tip

2. Transaction Proof Ingestion:
   [MerkleProof P for TxId]
         │
         ├── Find Header H at P.height (or H.id)
         ├── Check: P.merkle_root == H.merkle_root
         └── Check: P.verify() == true (Leaf-to-Root BLAKE3 Hash Path)
         │
         ▼
   Confirm Transaction Inclusion in Block H
```

---

## 3. Acceptance Criteria & Protocol Invariants

According to `/root/kovanica-protocol/.agents/ORIGINAL_REQUEST.md`:

### 3.1 Core Requirements
1. **R1. P2P Message Support**:
   - SPV wire protocol messages (`getheaders`, `headers`, `getblocks`, `merkleblock`) integrated directly into `kovanica-node` P2P mesh and relay loops (`RelayMsg`, `net.rs`, `p2p.rs`).
2. **R2. Integration Verification**:
   - Integration test running over real TCP sockets (`tests/spv_sync.rs`).
   - Syncing headers from a full node without downloading full block payloads.
   - Requesting and verifying Merkle proofs for transactions using the wire protocol.
   - Enforcing difficulty retargeting bounds and wall-clock future drift limits.

### 3.2 Key Protocol Invariants to Verify

1. **Payload Independence (Zero Payload Leakage)**:
   - SPV client does NOT request or receive `BlockRecord::txs` or raw `payload` bytes for unmonitored blocks.
   - Bandwidth consumption scale: $O(\text{headers} + \text{proofs})$ rather than $O(\text{total transactions})$.
2. **Difficulty Retargeting Bounds**:
   - Window size: `retarget.window` (default 20 blocks).
   - Rate calculation: `expected = intervals * target_interval_ms`, `actual = ts_last - ts_first`.
   - Clamping rule: `scaled.clamp(avg / max_factor, avg * max_factor).max(min_work)` (`crates/kovanica-dag/src/difficulty.rs:98`).
   - Target determinism: SPV client and Full Node compute the exact same `work` target for each height.
3. **Wall-Clock Future Drift Bounds**:
   - `MAX_FUTURE_DRIFT_MS = 2 * 60 * 60 * 1000` (2 hours = 7,200,000 ms).
   - Boundary condition: `timestamp_ms <= now_ms + MAX_FUTURE_DRIFT_MS` is accepted; `timestamp_ms > now_ms + MAX_FUTURE_DRIFT_MS` is rejected.
4. **Merkle Proof Determinism**:
   - BLAKE3 tree pairing: odd-count leaf duplication (`crates/kovanica-state/src/spv.rs:199–204`).
   - Sibling ordering based on index bit position (`idx % 2 == 0 ? [current, sibling] : [sibling, current]`).

---

## 4. Comprehensive Testing Strategy (Tiers 1–4)

A complete test suite must be implemented and organized across 4 tiers.

### Tier 1: Feature Coverage (Protocol Framing & Cryptographic Verification)

| Test ID | Location | Target Component | Description |
| :--- | :--- | :--- | :--- |
| **T1.1** | `tests/spv_sync.rs` | `net::encode_getheaders` / `decode_getheaders` | Verify binary round-trip of `getheaders` frame carrying locator/missing block IDs. |
| **T1.2** | `tests/spv_sync.rs` | `net::encode_headers` / `decode_headers` | Verify binary round-trip of `headers` frame carrying SPV `BlockHeader`s. |
| **T1.3** | `tests/spv_sync.rs` | `net::encode_getblocks` / `decode_getblocks` | Verify binary round-trip of `getblocks` / `getmerkleblock` query frames. |
| **T1.4** | `tests/spv_sync.rs` | `net::encode_merkleblock` / `decode_merkleblock` | Verify binary round-trip of `merkleblock` frame containing header + `MerkleProof`. |
| **T1.5** | `crates/kovanica-state/src/spv.rs` | `merkle_root` / `generate_merkle_proof` | Verify Merkle roots and proof generation for 1, 2, 3, 5, 8, 16 transactions (power-of-two and odd counts). |
| **T1.6** | `crates/kovanica-state/src/spv.rs` | `MerkleProof::verify` | Verify proof succeeds for each valid leaf index and fails for tampered index. |

### Tier 2: Boundary & Edge Cases

| Test ID | Location | Invariant / Boundary | Description |
| :--- | :--- | :--- | :--- |
| **T2.1** | `tests/spv_sync.rs` | Empty / Up-to-Date Sync | Full node has no new headers; peer sends empty headers list; client gracefully remains at current tip. |
| **T2.2** | `tests/spv_sync.rs` | Genesis-only Checkpoint | Client initialized with genesis checkpoint syncs first non-genesis header (verifying `min_work` floor). |
| **T2.3** | `tests/spv_sync.rs` | Future Drift Exact Boundary | Header with `timestamp_ms == now_ms + MAX_FUTURE_DRIFT_MS` is accepted; header with `now_ms + MAX_FUTURE_DRIFT_MS + 1` is rejected with `SpvError::TimestampTooFarInFuture` / `DriftExceeded`. |
| **T2.4** | `tests/spv_sync.rs` | Monotonicity Floor Violation | Header with `timestamp_ms < tip.timestamp_ms` is rejected with `SpvError::TimestampNotMonotonic`. |
| **T2.5** | `tests/spv_sync.rs` | Difficulty Clamping (Max Speedup) | Blocks arriving with 0 ms intervals clamped to at most $4\times$ work increase (`max_factor = 4`). |
| **T2.6** | `tests/spv_sync.rs` | Difficulty Clamping (Max Slowdown) | Blocks arriving with huge delay clamped to at most $\div 4$ work decrease, respecting `min_work`. |
| **T2.7** | `tests/spv_sync.rs` | Merkle Proof Leaf Tampering | Modifying a single byte of `proof.tx_id` causes `proof.verify()` to return false. |
| **T2.8** | `tests/spv_sync.rs` | Merkle Proof Wrong Header Root | Verifying a valid proof against a header with mismatched `merkle_root` returns false. |

### Tier 3: Cross-Feature Combinations & End-to-End Over TCP

| Test ID | Location | Scope | Description |
| :--- | :--- | :--- | :--- |
| **T3.1** | `tests/spv_sync.rs` | E2E TCP Headers-Only Sync | Full node produces a 10-block DAG with active difficulty retargeting; SPV client connects over TCP, requests and syncs all headers without downloading any block payload bodies; client verifies tip height and cumulative work. |
| **T3.2** | `tests/spv_sync.rs` | E2E TCP Merkle Proof Verification | Full node packages transfer `Actor 1 -> Actor 2` in Block 3; SPV client syncs headers, requests Merkle proof for target `tx_id` over TCP, verifies proof against Header 3's `merkle_root`, and confirms payment. |
| **T3.3** | `tests/spv_sync.rs` | Persistent `RelaySession` SPV Flow | Connection remains open across multiple message rounds: `Hello` -> `GetHeaders` -> `Headers` -> `GetMerkleBlock` -> `MerkleBlock` -> `Tx` broadcast. |
| **T3.4** | `tests/spv_sync.rs` | In-Process Mesh SPV Relay | Attach light client handler to `p2p::Mesh`; verify header announcements trigger lightweight SPV catch-up. |

### Tier 4: Realistic Application Scenarios & Adversarial Conditions

| Test ID | Location | Scenario | Description |
| :--- | :--- | :--- | :--- |
| **T4.1** | `tests/spv_sync.rs` | Mobile Wallet Payment Workflow | End-to-end simulation: Alice sends 250 KVNC to Bob; Bob's light wallet connects to full node seed, syncs headers, requests Merkle proof for Bob's incoming transfer, verifies proof, and confirms wallet balance update. |
| **T4.2** | `tests/spv_sync.rs` | Bandwidth Efficiency Assertion | Measure total TCP bytes transferred for SPV sync vs full block sync over 50 multi-tx blocks; assert SPV bandwidth is $<10\%$ of full node sync. |
| **T4.3** | `tests/spv_sync.rs` | Adversarial Fake Header Injection | Rogue peer sends header chain with fake cumulative work or unmined PoW; SPV client detects invalidity and discards fake branch. |
| **T4.4** | `tests/spv_sync.rs` | Adversarial Fake Merkle Proof Injection | Rogue peer returns fabricated Merkle proof claiming an unconfirmed tx was mined in block $B$; SPV client rejects proof. |
| **T4.5** | `tests/spv_sync.rs` | SPV Chain Reorg / Fork Resolution | SPV client observes two competing header branches; correctly follows the branch with higher cumulative blue work and re-evaluates transaction confirmations. |

---

## 5. Implementation Roadmap Recommendations

To implement the requirements smoothly:

1. **Step 1: Wire Messages & Protocol Enums (`crates/kovanica-node/src/net.rs` & `relay.rs`)**
   - Add/extend `RelayMsg` and `net.rs` message tags for `GetHeaders`, `Headers`, `GetBlocks`, `MerkleBlock`.
   - Implement framing encoders and decoders with buffer limit guards (`MAX_FRAME_BYTES`).
2. **Step 2: Full Node Serving Handlers (`crates/kovanica-node/src/node.rs` & `net.rs`)**
   - Implement `Node::spv_headers_for(&self, ids: &[BlockId]) -> Vec<spv::BlockHeader>`.
   - Implement `Node::merkle_proof_for(&self, tx_id: &TxId) -> Option<(spv::BlockHeader, spv::MerkleProof)>`.
   - Implement `net::serve_spv` handler over TCP stream.
3. **Step 3: Dedicated Integration Test Suite (`crates/kovanica-node/tests/spv_sync.rs`)**
   - Implement the complete test suite described in Tier 1–4.
   - Verify with `cargo test --test spv_sync` and `cargo test`.
