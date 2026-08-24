# DISPATCH — survey_explorer_2

**Objective**: Investigate Consensus & State Architecture (`crates/kovanica-dag` & `crates/kovanica-state`) regarding block headers, Merkle roots/trees, difficulty, PoW, and timestamp validation.
**Files to read**:
- `/root/kovanica-protocol/.agents/ORIGINAL_REQUEST.md`
- `/root/kovanica-protocol/AGENTS.md`
- `/root/kovanica-protocol/crates/kovanica-dag/src/lib.rs`
- `/root/kovanica-protocol/crates/kovanica-dag/src/block.rs`
- `/root/kovanica-protocol/crates/kovanica-dag/src/dag.rs`
- `/root/kovanica-protocol/crates/kovanica-dag/src/difficulty.rs`
- `/root/kovanica-protocol/crates/kovanica-dag/src/pow.rs`
- `/root/kovanica-protocol/crates/kovanica-dag/src/ghostdag.rs`
- `/root/kovanica-protocol/crates/kovanica-state/src/lib.rs`
- `/root/kovanica-protocol/crates/kovanica-state/src/tx.rs`
- `/root/kovanica-protocol/crates/kovanica-state/src/ledger.rs`
- `/root/kovanica-protocol/crates/kovanica-state/src/validation.rs`

**Questions to answer**:
1. What constitutes a block header in Kovanica (fields in `Block`: parents, timestamp_ms, work, nonce, payload, etc.)? Does `Block` or `BlockHeader` have a Merkle root or tx payload? How is block id computed?
2. How are transactions organized in blocks and state? Is there already a Merkle tree/proof implementation, or what is needed for Merkle trees, Merkle proofs (paths/branches), and `merkleblock` generation and verification?
3. How are difficulty retargeting (`Retarget::next_work`, `Dag::next_work_target`) and proof-of-work verified? What does an SPV client need to verify headers against difficulty and parent timestamps?
4. What are the exact rules for wall-clock future drift limits (`MAX_FUTURE_DRIFT_MS` = 2h) and timestamp monotonicity?

**Output**:
Write full findings to `/root/kovanica-protocol/.agents/survey_explorer_2/analysis.md` and handoff to `/root/kovanica-protocol/.agents/survey_explorer_2/handoff.md`.
Then send a completion message with summary.
