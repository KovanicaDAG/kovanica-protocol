# Handoff Report — m1_explorer_3

**Task**: Milestone 1 SPV Wire Protocol & Light Client Engine Analysis  
**Working Directory**: `/root/kovanica-protocol/.agents/m1_explorer_3`  
**Date**: 2026-08-24  

---

## 1. Observation

1. **Existing SPV Structures in `crates/kovanica-state/src/spv.rs`**:
   - Lines 43–62 define `BlockHeader`:
     ```rust
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
   - Lines 213–226 define `MerkleProof`:
     ```rust
     pub struct MerkleProof {
         pub tx_id: [u8; 32],
         pub merkle_root: [u8; 32],
         pub path: Vec<[u8; 32]>,
         pub index: usize,
         pub tx_count: usize,
     }
     ```
   - Lines 413–425 define `SpvClient`:
     `SpvClient` tracks headers in `HashMap<u64, BlockHeader>`, `tip: Option<BlockHeader>`, `checkpoint: Option<BlockHeader>`, `require_pow: bool`, and `retarget: Option<Retarget>`.

2. **Difficulty Retargeting Implementation in `crates/kovanica-dag/src/difficulty.rs` and `crates/kovanica-dag/src/dag.rs`**:
   - In `difficulty.rs` lines 70–99, `Retarget::next_work(&self, recent: &[TimedWork]) -> u128` evaluates the sliding window timespan:
     `expected = intervals.saturating_mul(target_interval_ms)`
     `actual = samples.last().timestamp_ms - samples.first().timestamp_ms`
     `scaled = avg_work * expected / actual` clamped to $[ \text{avg} / \text{max\_factor}, \text{avg} \times \text{max\_factor} ]$ and floored at `min_work`.
   - In `dag.rs` lines 587–594, `Dag::check_difficulty` enforces:
     ```rust
     let expected = retarget.next_work(&self.chain_samples(sp, retarget.window));
     if block.work() != expected {
         return Err(DagError::DifficultyMismatch { id, expected, actual: block.work() });
     }
     ```

3. **Wall-Clock Drift Policy in `crates/kovanica-node/src/node.rs` and `crates/kovanica-node/tests/timestamps.rs`**:
   - `node.rs` line 29: `const MAX_FUTURE_DRIFT_MS: u64 = 2 * 60 * 60 * 1000;` (2 hours).
   - `node.rs` lines 35–41: `Clock::Wall` vs `Clock::Fixed(u64)` injectable via `node.set_now_ms(now_ms)`.
   - In `SpvClient`, future drift is not yet checked, and clock is not yet injectable.

4. **P2P Relay Session Framing in `crates/kovanica-node/src/relay.rs`**:
   - Lines 19–23:
     ```rust
     const TAG_HELLO: u8 = 0;
     const TAG_BLOCK: u8 = 1;
     const TAG_TX: u8 = 2;
     const MAX_FRAME: usize = 4 * 1024 * 1024;
     ```
   - Lines 27–39: `RelayMsg` currently only supports `Hello`, `Block`, and `Tx`.
   - `RelaySession` (lines 42–88) handles framed TCP streaming with 4-byte length prefix.

---

## 2. Logic Chain

1. From Observation 1, `kovanica-state::spv` provides the core cryptographic primitives (`BlockHeader`, `MerkleProof`, `merkle_root`, `generate_merkle_proof`, `SpvClient`), but these operate purely in-memory without networking or wire framing.
2. From Observation 4, `RelaySession` in `kovanica-node::relay` provides the persistent bidirectional TCP framing mechanism (`MAX_FRAME = 4MB`). Extending `RelayMsg` with message tags `0x11` (`Headers`), `0x12` (`GetHeaders`), `0x13` (`GetBlocks`), `0x15` (`GetMerkleProof`), and `0x16` (`MerkleBlock`) directly enables SPV wire communication over persistent TCP sessions.
3. From Observation 2, difficulty retargeting requires checking exact equality `header.work == retarget.next_work(&samples)` against the sliding window of previous headers. `SpvClient::add_header` and `BlockHeader::verify_difficulty` must use `Retarget::next_work` over the collected window to match full node consensus.
4. From Observation 3, light clients must defend against time-warp attacks by rejecting headers whose timestamps exceed `client_now_ms + MAX_FUTURE_DRIFT_MS` (2 hours). Adding an injectable clock `SpvClock` and `set_now_ms` to `SpvClient` allows deterministic verification of exact boundary conditions (`now + 2h` accepted, `now + 2h + 1ms` rejected) in integration tests.
5. From Observations 1 and 4, full nodes can extract SPV headers along the selected chain and generate Merkle proofs for requested transactions, packaging them into `MerkleBlock` responses. The light client verifies the Merkle root against its verified SPV header and verifies the Merkle branch path, ensuring complete cryptographic trust with zero block payload transfer.

---

## 3. Caveats

1. **DAG Anticone Transactions**: SPV clients track the GHOSTDAG selected chain. Transactions merged in non-selected blocks require proof along the merging block's selected-chain parent path.
2. **Re-org Depth**: In the event of a deep reorganization, light clients must support locator-based fork recovery; for Milestone 1, linear selected-chain extension and basic locator pagination provide full coverage.
3. **No Unsafe Code**: All wire decoders must strictly use bounds-checked cursor readers to prevent buffer overruns or unauthenticated allocations.

---

## 4. Conclusion

The SPV wire protocol and light client engine architecture is fully designed, cryptographically sound, and ready for implementation.
Key implementation deliverables:
1. Wire message variants in `RelayMsg` and framing decoders in `relay.rs`/`net.rs`.
2. Full node SPV serving APIs (`export_spv_headers`, `spv_headers_from`, `merkle_block`) in `node.rs`.
3. Hardened `SpvClient` with future drift checking ($\le 2\text{h}$), injectable clock, and exact difficulty retargeting in `crates/kovanica-state/src/spv.rs`.
4. TCP light client networking engine in `crates/kovanica-node/src/spv.rs`.
5. 4-tier E2E test suite in `crates/kovanica-node/tests/spv_sync.rs`.

---

## 5. Verification Method

To independently verify the architecture and prepare for implementation testing:

1. **Inspect Architecture and Plan**:
   - View `/root/kovanica-protocol/.agents/m1_explorer_3/analysis.md`
   - View `/root/kovanica-protocol/.agents/m1_explorer_3/handoff.md`

2. **Verify Rust Compilation & Test Suite**:
   ```bash
   cargo check --workspace --all-targets
   cargo test --workspace
   cargo clippy --all-targets
   ```

3. **Verify Target Integration Test Command**:
   ```bash
   cargo test -p kovanica-node --test spv_sync
   ```
