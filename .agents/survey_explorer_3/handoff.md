# Handoff Report — survey_explorer_3

**Date**: 2026-08-24T00:11:30Z  
**Role**: Explorer / Investigator & Test Strategy  
**Working Directory**: `/root/kovanica-protocol/.agents/survey_explorer_3`  

---

## 1. Observation

1. **Test Infrastructure Patterns**:
   - `crates/kovanica-node/tests/network.rs:80–93`: TCP tests bind ephemeral ports via `TcpListener::bind("127.0.0.1:0").unwrap()` and run server logic on a background thread spawned with `thread::spawn(move || { ... })`.
   - `crates/kovanica-node/tests/relay.rs:23–45`: Persistent TCP sessions configure `server.set_read_timeout(Some(Duration::from_secs(2)))` and `client.set_read_timeout(...)` to guard against test deadlocks.
   - `crates/kovanica-node/tests/timestamps.rs:12, 68–77, 88–95`: Wall-clock drift limit `const DRIFT_MS: u64 = 2 * 60 * 60 * 1000` is tested at the exact boundary `now + DRIFT_MS` (accepted) and `now + DRIFT_MS + 1` (rejected with `NodeError::TimestampTooFarInFuture`). Clock is pinned using `node.set_now_ms(now)`.
   - `crates/kovanica-node/tests/p2p.rs:13–46`: In-process mesh tests use `Mesh::new()`, `mesh.add(...)`, `mesh.connect(...)`, and discrete time stepping `mesh.drain(16)` / `mesh.tick()`.

2. **Existing SPV and Crypto Implementations**:
   - `crates/kovanica-state/src/spv.rs:43–62`: Defines SPV `BlockHeader` containing `id`, `prev_hash`, `merkle_root`, `work`, `timestamp_ms`, `nonce`, `blue_score`, `chain_blue_work`, `height`.
   - `crates/kovanica-state/src/spv.rs:179–246`: Implements `merkle_root(&[Transaction]) -> [u8; 32]`, `generate_merkle_proof(&[Transaction], usize) -> Option<MerkleProof>`, and `MerkleProof::verify(&self) -> bool`.
   - `crates/kovanica-state/src/spv.rs:412–512`: Implements `SpvClient` maintaining `headers: HashMap<u64, BlockHeader>`, `tip: Option<BlockHeader>`, `checkpoint: Option<BlockHeader>`, `require_pow: bool`, `retarget: Option<Retarget>`, with `add_header` and `verify_tx_inclusion`.
   - `crates/kovanica-dag/src/difficulty.rs:40–99`: Implements `Retarget::next_work(&self, recent: &[TimedWork]) -> u128` with clamp `[avg / max_factor, avg * max_factor]` and floor `min_work`.
   - `crates/kovanica-node/src/node.rs:157–173, 885`: Full node enforces `MAX_FUTURE_DRIFT_MS = 2 * 60 * 60 * 1000` in `Node::receive_block`.

3. **Current Wire Protocol Status**:
   - `crates/kovanica-node/src/net.rs:354–365`: Defines wire tags `TAG_INVENTORY (0x10)`, `TAG_HEADERS (0x11)`, `TAG_GETHEADERS (0x12)`, `TAG_GETBODIES (0x13)`, `TAG_BODIES (0x14)`.
   - `crates/kovanica-node/src/relay.rs:19–39`: Defines `RelayMsg` with `TAG_HELLO (0)`, `TAG_BLOCK (1)`, `TAG_TX (2)`. Currently lacks SPV `GetHeaders`, `Headers`, `GetBlocks`, `MerkleBlock` variants in `RelayMsg`.

---

## 2. Logic Chain

1. **Connecting Observations 1 & 2**: Kovanica already contains core cryptographic primitives (`merkle_root`, `MerkleProof`, `generate_merkle_proof`, `SpvClient`, `Retarget`) in `kovanica-state` and `kovanica-dag`. However, the P2P wire layer (`kovanica-node::net` and `kovanica-node::relay`) currently lacks dedicated message framing and handlers for `merkleblock` and light client SPV queries over persistent sessions.
2. **Connecting Observations 1 & 3**: Full nodes and client tests in `kovanica-node/tests/` follow a clear, consistent testing paradigm: ephemeral TCP listeners, separate server threads with timeouts, pinned clocks for deterministic hash IDs, and multi-round exchange. This exact paradigm should be applied to create `tests/spv_sync.rs`.
3. **Synthesis to Verification Strategy**: To satisfy `ORIGINAL_REQUEST.md`, `tests/spv_sync.rs` must cover all 4 test tiers:
   - Tier 1: Wire framing round-trip encoding/decoding and Merkle proof generation.
   - Tier 2: Boundary conditions for timestamp drift (`now + 2h` boundary), timestamp monotonicity, and difficulty retargeting clamps ($\pm 4\times$).
   - Tier 3: Real TCP client-server sync demonstrating zero-payload header downloading and selective Merkle proof verification.
   - Tier 4: Realistic mobile wallet workflows, bandwidth assertions ($<10\%$ byte usage vs full sync), fake header rejection, and chain reorg tracking.

---

## 3. Caveats

- `Node` is not marked `Send` because it contains non-thread-safe state wrappers; integration tests must construct the `Node` directly inside the server thread closure or export serializable data (`export()`, `export_headers()`) before spawning.
- If a future change alters the Block header structure in `kovanica-dag` (e.g. adding VRF proof fields into SPV headers), the SPV `BlockHeader` serialization and BLAKE3 ID calculation must be kept strictly aligned.

---

## 4. Conclusion

The SPV client and E2E testing architecture is fully mapped out. The existing codebase provides solid building blocks in `kovanica-state::spv` and `kovanica-node::net`. The team should:
1. Extend wire messages in `kovanica-node` (`net.rs` and `relay.rs`) to support `getheaders`, `headers`, `getblocks`, `merkleblock`.
2. Add full node handlers on `Node` for serving SPV headers and Merkle proofs.
3. Implement the comprehensive 4-tier test suite in `crates/kovanica-node/tests/spv_sync.rs`.

Detailed analysis and the full testing matrix are available in:
`/root/kovanica-protocol/.agents/survey_explorer_3/analysis.md`

---

## 5. Verification Method

To verify findings and existing test suite health:
1. **Run full workspace tests**:
   ```bash
   cargo test
   ```
2. **Run specific node integration tests**:
   ```bash
   cargo test -p kovanica-node --test network
   cargo test -p kovanica-node --test relay
   cargo test -p kovanica-node --test timestamps
   ```
3. **Verify SPV unit tests in kovanica-state**:
   ```bash
   cargo test -p kovanica-state --lib spv
   ```
4. **Invalidation condition**: Any divergence between `Block::id()` computation in `kovanica-dag` and header verification in `kovanica-state::spv` would invalidate SPV proof soundness.
