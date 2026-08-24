# DISPATCH — survey_explorer_3

## 2026-08-24T00:09:00Z

**Objective**: Investigate SPV Client Architecture & E2E Testing Strategy (`crates/kovanica-node/tests`).
**Files to read**:
- `/root/kovanica-protocol/.agents/ORIGINAL_REQUEST.md`
- `/root/kovanica-protocol/AGENTS.md`
- `/root/kovanica-protocol/crates/kovanica-node/tests/network.rs`
- `/root/kovanica-protocol/crates/kovanica-node/tests/relay.rs`
- `/root/kovanica-protocol/crates/kovanica-node/tests/timestamps.rs`
- `/root/kovanica-protocol/crates/kovanica-node/tests/p2p.rs`
- `/root/kovanica-protocol/crates/kovanica-node/tests/rpc.rs`
- `/root/kovanica-protocol/crates/kovanica-node/tests/mempool.rs`

**Questions to answer**:
1. How are TCP nodes, mock peers, and network meshes spun up in integration tests?
2. How should an SPV client / light node be structured? What state does an SPV client maintain (e.g. headers DAG/chain, verified tips, tracked addresses/UTXOs, Merkle proofs)?
3. What are the exact acceptance criteria in `ORIGINAL_REQUEST.md`: `tests/spv_sync.rs` syncing headers over TCP without full block payloads, requesting and verifying Merkle proofs for txs, handling difficulty retargeting bounds and wall-clock future drift limits?
4. What test cases are needed across Tiers 1-4 (feature coverage, boundary cases, cross-feature combinations, realistic application scenarios)?

**Output**:
Write full findings to `/root/kovanica-protocol/.agents/survey_explorer_3/analysis.md` and handoff to `/root/kovanica-protocol/.agents/survey_explorer_3/handoff.md`.
Then send a completion message with summary.
