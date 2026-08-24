# DISPATCH — m1_explorer_1

**Milestone**: Milestone 1 — SPV Wire Protocol & Light Client Engine
**Objective**: Detail the exact changes needed in `crates/kovanica-node/src/relay.rs`, `net.rs`, `p2p.rs`, and `node.rs` to implement SPV wire messages (`GetHeaders`, `Headers`, `GetBlocks`, `GetMerkleProof`, `MerkleBlock`), their binary encoding/decoding tags, bounds checking, and handling in `RelaySession` and `Node`.

**Files to read**:
- `/root/kovanica-protocol/.agents/ORIGINAL_REQUEST.md`
- `/root/kovanica-protocol/AGENTS.md`
- `/root/kovanica-protocol/PROJECT.md`
- `/root/kovanica-protocol/TEST_INFRA.md`
- `/root/kovanica-protocol/crates/kovanica-node/src/relay.rs`
- `/root/kovanica-protocol/crates/kovanica-node/src/net.rs`
- `/root/kovanica-protocol/crates/kovanica-node/src/node.rs`
- `/root/kovanica-protocol/crates/kovanica-state/src/spv.rs`

**Output**:
Write comprehensive plan to `/root/kovanica-protocol/.agents/m1_explorer_1/analysis.md` and handoff report to `/root/kovanica-protocol/.agents/m1_explorer_1/handoff.md`.
