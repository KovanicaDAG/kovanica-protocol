# DISPATCH — m1_worker

**Milestone**: Milestone 1 — SPV Wire Protocol & Light Client Engine
**Objective**: Implement SPV wire protocol message types, serialization/deserialization, full node SPV handlers, and light client wire sync logic in `crates/kovanica-node`.

**Files Owned Exclusively**:
- `crates/kovanica-node/src/relay.rs`
- `crates/kovanica-node/src/net.rs`
- `crates/kovanica-node/src/node.rs`
- `crates/kovanica-node/src/lib.rs`
- `crates/kovanica-node/src/spv.rs` (create if needed / expose light client wire sync)

**Explorer Blueprints & References**:
- `/root/kovanica-protocol/.agents/ORIGINAL_REQUEST.md`
- `/root/kovanica-protocol/AGENTS.md`
- `/root/kovanica-protocol/PROJECT.md`
- `/root/kovanica-protocol/TEST_INFRA.md`
- `/root/kovanica-protocol/.agents/m1_explorer_1/analysis.md`
- `/root/kovanica-protocol/.agents/m1_explorer_2/analysis.md`
- `/root/kovanica-protocol/.agents/m1_explorer_3/analysis.md`

**Mandatory Integrity Warning**:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

**Specific Tasks**:
1. In `crates/kovanica-node/src/relay.rs` and `net.rs`:
   - Extend `RelayMsg` enum and wire message tags with:
     - `GetHeaders { locator: Vec<BlockId>, stop_hash: Option<BlockId>, max_count: u32 }` (tag `0x12` or `TAG_GETHEADERS`)
     - `Headers { headers: Vec<kovanica_state::spv::BlockHeader> }` (tag `0x11` or `TAG_HEADERS`)
     - `GetBlocks { locator: Vec<BlockId>, stop_hash: Option<BlockId> }` (tag `0x13` or `TAG_GETBLOCKS`)
     - `GetMerkleProof { block_id: BlockId, tx_id: TxId }` (tag `0x15` or `TAG_GET_MERKLE_PROOF`)
     - `MerkleBlock { block_id: BlockId, merkle_root: [u8; 32], tx_count: u32, proof: Option<kovanica_state::spv::MerkleProof>, matched_tx: Option<kovanica_state::Transaction> }` (tag `0x16` or `TAG_MERKLEBLOCK`)
   - Implement binary serialization and deserialization for these variants in `encode_msg` and `decode_msg` (and `Cursor` helper functions) with defensive length bounds (`read_count(min_element_bytes)`).
2. In `crates/kovanica-node/src/node.rs`:
   - Implement `spv_header(&self, id: &BlockId) -> Option<kovanica_state::spv::BlockHeader>`.
   - Implement `headers_from(&self, locator: &[BlockId], stop: Option<BlockId>, limit: usize) -> Result<Vec<kovanica_state::spv::BlockHeader>, NodeError>`.
   - Implement `merkle_block(&self, block_id: &BlockId, tx_id: &TxId) -> Result<MerkleBlock, NodeError>`.
   - Add a dispatch helper or query handler (e.g. `handle_relay_query` or in `apply_relay`/`RelaySession`) so a full node can answer SPV queries over a `RelaySession`.
3. In `crates/kovanica-node/src/spv.rs` (or integrated module):
   - Expose SPV client helpers for light nodes to communicate over `RelaySession`:
     - `sync_headers_via_relay(session: &mut RelaySession, client: &mut kovanica_state::spv::SpvClient, stop_hash: Option<BlockId>) -> Result<usize, RelayError>`
     - `request_merkle_block(session: &mut RelaySession, block_id: BlockId, tx_id: TxId) -> Result<MerkleBlock, RelayError>`
     - Verification functions ensuring `client.verify_tx_inclusion` / `proof.verify()` matches the synced header's `merkle_root`.
4. Run builds, clippy, and all tests:
   `cargo check --all-targets`
   `cargo clippy --all-targets`
   `cargo test`
5. Report changes in `/root/kovanica-protocol/.agents/m1_worker/changes.md` and handoff in `/root/kovanica-protocol/.agents/m1_worker/handoff.md`.
