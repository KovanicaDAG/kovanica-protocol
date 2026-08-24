# DISPATCH — m1_explorer_3

**Milestone**: Milestone 1 — SPV Wire Protocol & Light Client Engine
**Objective**: Detail the exact client-side light client engine (`crates/kovanica-node/src/spv.rs` / `RelaySession` SPV client) for synchronizing headers over a TCP stream using `getheaders`/`headers`, and requesting/verifying Merkle proofs with `getmerkleproof`/`merkleblock`, ensuring difficulty retargeting bounds and future drift limits are strictly enforced.

**Files to read**:
- `/root/kovanica-protocol/.agents/ORIGINAL_REQUEST.md`
- `/root/kovanica-protocol/AGENTS.md`
- `/root/kovanica-protocol/PROJECT.md`
- `/root/kovanica-protocol/TEST_INFRA.md`
- `/root/kovanica-protocol/crates/kovanica-state/src/spv.rs`
- `/root/kovanica-protocol/crates/kovanica-node/src/relay.rs`
- `/root/kovanica-protocol/crates/kovanica-node/src/node.rs`

**Output**:
Write comprehensive plan to `/root/kovanica-protocol/.agents/m1_explorer_3/analysis.md` and handoff report to `/root/kovanica-protocol/.agents/m1_explorer_3/handoff.md`.
