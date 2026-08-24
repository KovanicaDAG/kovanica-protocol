# Handoff Report — survey_explorer_1

**Objective**: Investigate P2P framing, message serialization, mesh and relay loops in `crates/kovanica-node` and design SPV wire protocol integration (`getheaders`, `headers`, `getblocks`, `merkleblock`).

---

## 1. Observation

1. **Relay Framing & Message Types (`crates/kovanica-node/src/relay.rs`)**:
   - `RelaySession::send` writes a 4-byte little-endian length prefix followed by the payload:
     `self.stream.write_all(&len.to_le_bytes())` (`relay.rs:70`).
   - `RelaySession::recv` reads 4 bytes `len_buf` (`relay.rs:78`), enforces `MAX_FRAME = 4 * 1024 * 1024` (4 MB) (`relay.rs:23, 81`), and reads exact bytes before decoding with `decode_msg`.
   - Wire messages are represented by enum `RelayMsg` (`relay.rs:27-39`):
     ```rust
     pub enum RelayMsg {
         Hello { from: String, advertised: Vec<String> }, // TAG_HELLO = 0
         Block(BlockRecord),                              // TAG_BLOCK = 1
         Tx(Transaction),                                 // TAG_TX = 2
     }
     ```
   - Binary serialization tag mapping: `TAG_HELLO = 0`, `TAG_BLOCK = 1`, `TAG_TX = 2` (`relay.rs:19-21, 115-134`).
   - Message application: `apply_relay` (`relay.rs:92-106`) handles `RelayMsg::Block` by calling `node.receive_block(record)` and `RelayMsg::Tx` via `node.submit_tx(tx)`, while returning `RelayMsg::Hello` to caller.

2. **Discrete In-Process Mesh Gossip (`crates/kovanica-node/src/p2p.rs`)**:
   - `Envelope` enum (`p2p.rs:76-80`) encapsulates `Hello`, `Block`, and `Tx`.
   - `Mesh::tick` (`p2p.rs:236-254`) advances discrete time, processes rate limits in `P2pHardening`, and delivers queued messages via `deliver()`.
   - Peer discovery: `Mesh::on_hello` (`p2p.rs:499-517`) adds mutual edges and advertises neighboring peers.
   - Deduplication and flood termination: `Mesh::on_block` (`p2p.rs:519-556`) and `Mesh::on_tx` (`p2p.rs:558-584`) check `seen_blocks` / `seen_txs` and `P2pHardening` duplicate tracking before relaying to all neighbor peers.

3. **Existing Headers-First Sync Protocol (`crates/kovanica-node/src/net.rs`)**:
   - Frame length reading/writing with `write_frame`/`read_frame` (`net.rs:335-352`).
   - Defined sync tags:
     - `TAG_INVENTORY: u8 = 0x10` (`net.rs:355`)
     - `TAG_HEADERS: u8 = 0x11` (`net.rs:356`)
     - `TAG_GETHEADERS: u8 = 0x12` (`net.rs:357`)
     - `TAG_GETBODIES: u8 = 0x13` (`net.rs:358`)
     - `TAG_BODIES: u8 = 0x14` (`net.rs:359`)
   - Bounded batch limits: `MAX_INVENTORY_IDS = 200_000`, `MAX_HEADERS = 10_000`, `MAX_GETBODIES = 10_000`, `MAX_BODIES = 10_000`, `MAX_FRAME_BYTES = 16 * 1024 * 1024` (`net.rs:361-365`).
   - Defensive allocation guard in `Cursor::read_count`: checks `n > self.remaining() / min_element_bytes` (`net.rs:327-329`).
   - Client and server routines: `sync_headers_first` (`net.rs:580-662`) and `serve_headers_first` (`net.rs:667-714`).

4. **SPV & Merkle Proof Structures in State Layer (`crates/kovanica-state/src/spv.rs`)**:
   - `kovanica_state::spv::BlockHeader` (`spv.rs:43-63`) contains `id`, `prev_hash`, `merkle_root`, `work`, `timestamp_ms`, `nonce`, `blue_score`, `chain_blue_work`, `height`.
   - `merkle_root(txs: &[Transaction]) -> [u8; 32]` (`spv.rs:179-185`) computes BLAKE3 Merkle root.
   - `generate_merkle_proof(txs: &[Transaction], index: usize) -> Option<MerkleProof>` (`spv.rs:249-292`) generates leaf-to-root sibling path.
   - `MerkleProof::verify(&self) -> bool` (`spv.rs:228-245`) validates inclusion against `merkle_root`.
   - `SpvClient` (`spv.rs:413-512`) tracks header chain, verifies proof-of-work (`meets_target`), difficulty retargeting (`Retarget::next_work`), monotonic timestamps, and transaction inclusion.

5. **Consensus & Node Policies (`crates/kovanica-node/src/node.rs`)**:
   - `MAX_FUTURE_DRIFT_MS: u64 = 2 * 60 * 60 * 1000` (2 hours) (`node.rs:29`).
   - `Node::receive_block` (`node.rs:880-890`) rejects blocks with `timestamp_ms > now_ms + MAX_FUTURE_DRIFT_MS`.
   - Block production monotone timestamp clamping: `next_timestamp` (`node.rs:243-250`) guarantees timestamps strictly exceed all parents.

---

## 2. Logic Chain

1. **Step 1 (Wire Protocol Extensibility)**: Observation 1 shows that `RelaySession` is designed to be a long-lived multiplexed TCP connection using a 1-byte message tag prefix followed by payload. Observation 3 shows that `net.rs` already defines distinct byte tags for inventory and header messages. Therefore, extending `RelayMsg` with SPV wire messages (`GetHeaders`, `Headers`, `GetBlocks`, `GetMerkleProof`, `MerkleBlock`) directly into `RelaySession` adheres to the established framing conventions without breaking existing message flows.
2. **Step 2 (Reuse of SPV Primitives)**: Observation 4 demonstrates that Merkle tree generation (`merkle_root`), path generation (`generate_merkle_proof`), Merkle verification (`MerkleProof::verify`), and light client header validation (`SpvClient`) are already fully implemented and unit-tested in `kovanica-state`.
3. **Step 3 (Full Node Serving Logic)**: Observation 1 and Observation 4 show that a full node with access to `Ledger`/`Dag` can reconstruct any block's transaction list (`node.block_record(id)`), calculate the Merkle root, generate Merkle proofs for requested `TxId`s, and stream headers along the selected chain upon receiving `GetHeaders`.
4. **Step 4 (Light Client SPV Verification over TCP)**: Combining the extended `RelaySession` (Step 1) with `SpvClient` (Step 2) allows an SPV node to dial a full node over TCP, exchange `GetHeaders`/`Headers` to synchronize the header DAG/chain without block bodies, request a `GetMerkleProof`, and verify `MerkleBlock` against the header's `merkle_root`.
5. **Step 5 (Policy Compliance)**: Observation 5 establishes that the SPV client's header verification directly mirrors the full node's difficulty retargeting (`Retarget::next_work`) and timestamp bounds (`MAX_FUTURE_DRIFT_MS`), satisfying Requirement R2.

---

## 3. Caveats

1. **Dual Header Definitions**: `crates/kovanica-node/src/node.rs` defines `BlockHeader` (which carries `parents`, `payload_hash`, `payload_len` for full node inventory) while `crates/kovanica-state/src/spv.rs` defines `BlockHeader` (which carries `prev_hash`, `merkle_root`, `blue_score`, `chain_blue_work`, `height` for SPV chain sync). The implementers should explicitly use `kovanica_state::spv::BlockHeader` (or a unified header type) for SPV wire messages.
2. **DAG vs Linear Selected Chain in SPV**: In GHOSTDAG, blocks have multiple parents, but SPV light clients track the selected-parent backbone chain (`selected_chain` / `prev_hash`). Headers on side branches can either be synchronized as full DAG headers or filtered to the selected chain.
3. **Protocol Versioning**: There is currently no version negotiation in `RelayMsg::Hello`. For backward compatibility, unknown message tags will return a decode error unless explicitly ignored.

---

## 4. Conclusion

The existing `kovanica-node` codebase provides a solid, modular foundation for SPV wire protocol support:
- `RelaySession` provides persistent length-prefixed TCP streaming (`MAX_FRAME = 4 MB`).
- `kovanica_state::spv` provides ready-to-use Merkle root calculation, Merkle proof generation/verification, and `SpvClient` header validation.
- Extending `RelayMsg` with `GetHeaders`, `Headers`, `GetBlocks`, `GetMerkleProof`, and `MerkleBlock` will enable full nodes to serve light clients and allow SPV clients to sync and verify payments over TCP without downloading full block payloads.

---

## 5. Verification Method

To independently verify the codebase and validate the findings:
1. **Workspace Test Suite**:
   ```bash
   cargo test
   ```
2. **Examine Relay & Net Framing Code**:
   - `crates/kovanica-node/src/relay.rs` (lines 10–180)
   - `crates/kovanica-node/src/net.rs` (lines 334–714)
   - `crates/kovanica-node/src/p2p.rs` (lines 76–120, 480–585)
3. **Examine State Layer SPV Primitives**:
   - `crates/kovanica-state/src/spv.rs` (lines 40–292, 410–540)
4. **Inspect Existing Tests**:
   - `crates/kovanica-node/tests/relay.rs`
   - `crates/kovanica-node/tests/p2p.rs`
   - `crates/kovanica-node/tests/timestamps.rs`
