# DISPATCH — m1_explorer_2

**Milestone**: Milestone 1 — SPV Wire Protocol & Light Client Engine
**Objective**: Detail the exact implementation of full node methods on `Node` in `crates/kovanica-node/src/node.rs` and SPV helper methods to extract SPV headers (`kovanica_state::spv::BlockHeader`), assemble Merkle proofs, and construct `MerkleBlock` structures with zero full-payload leakage.

**Files to read**:
- `/root/kovanica-protocol/.agents/ORIGINAL_REQUEST.md`
- `/root/kovanica-protocol/AGENTS.md`
- `/root/kovanica-protocol/PROJECT.md`
- `/root/kovanica-protocol/TEST_INFRA.md`
- `/root/kovanica-protocol/crates/kovanica-node/src/node.rs`
- `/root/kovanica-protocol/crates/kovanica-state/src/spv.rs`
- `/root/kovanica-protocol/crates/kovanica-dag/src/dag.rs`
- `/root/kovanica-protocol/crates/kovanica-state/src/ledger.rs`

**Output**:
Write comprehensive plan to `/root/kovanica-protocol/.agents/m1_explorer_2/analysis.md` and handoff report to `/root/kovanica-protocol/.agents/m1_explorer_2/handoff.md`.
