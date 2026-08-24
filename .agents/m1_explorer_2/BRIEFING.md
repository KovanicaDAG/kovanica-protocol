# BRIEFING — 2026-08-24T00:12:35Z

## Mission
Analyze full node SPV methods on Node (serving headers from locators, generating Merkle proofs and assembling MerkleBlock with zero payload leakage).

## 🔒 My Identity
- Archetype: explorer
- Roles: investigator, analyzer, synthesizer
- Working directory: /root/kovanica-protocol/.agents/m1_explorer_2
- Original parent: c778ad59-4026-42bb-925e-648efbb3d7a6
- Milestone: Milestone 1 — SPV Wire Protocol & Light Client Engine

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Analyze full node SPV methods on `Node` in `crates/kovanica-node/src/node.rs` and SPV helper methods to extract SPV headers (`kovanica_state::spv::BlockHeader`), assemble Merkle proofs, and construct `MerkleBlock` structures with zero full-payload leakage.

## Current Parent
- Conversation ID: c778ad59-4026-42bb-925e-648efbb3d7a6
- Updated: not yet

## Investigation State
- **Explored paths**:
  - `crates/kovanica-state/src/spv.rs`
  - `crates/kovanica-node/src/node.rs`
  - `crates/kovanica-dag/src/dag.rs`
  - `crates/kovanica-dag/src/ordering.rs`
  - `crates/kovanica-state/src/ledger.rs`
  - `crates/kovanica-node/src/relay.rs`
  - `crates/kovanica-node/src/net.rs`
- **Key findings**:
  - `kovanica_state::spv` contains `BlockHeader`, `merkle_root`, `MerkleProof`, `generate_merkle_proof`, `BlockFilter`, `SpvClient`.
  - `Node` needs SPV serving methods: `spv_header`, `headers_from` (locator-based with `stop` and `limit`), `merkle_block`, `merkle_proofs_for_tx`.
  - Distinguish between existing `kovanica_node::node::BlockHeader` (inventory/payload-hash) and `kovanica_state::spv::BlockHeader` (Merkle-root/selected-chain metadata).
  - MerkleBlock construction must avoid leaking non-matched transaction payloads, delivering only the target tx, its leaf index, and the sibling path hashes.
- **Unexplored areas**: none.

## Key Decisions Made
- Structure full node SPV methods on `Node` with clear signatures, locator pagination algorithms, and zero-leakage `MerkleBlock` generation.

## Artifact Index
- /root/kovanica-protocol/.agents/m1_explorer_2/analysis.md — Comprehensive SPV full node methods analysis report
- /root/kovanica-protocol/.agents/m1_explorer_2/handoff.md — 5-component handoff report
