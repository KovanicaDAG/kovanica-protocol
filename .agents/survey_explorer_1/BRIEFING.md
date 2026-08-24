# BRIEFING — 2026-08-24T02:10:40+02:00

## Mission
Investigate P2P framing, message serialization, mesh and relay loops in crates/kovanica-node for SPV/light client wire protocol support (getheaders, headers, getblocks, merkleblock).

## 🔒 My Identity
- Archetype: explorer
- Roles: survey_explorer_1
- Working directory: /root/kovanica-protocol/.agents/survey_explorer_1
- Original parent: c778ad59-4026-42bb-925e-648efbb3d7a6
- Milestone: P2P Wire Protocol & SPV Architecture Survey

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Follow repository layout, AGENTS.md conventions, and strict consensus/wire determinism rules

## Current Parent
- Conversation ID: c778ad59-4026-42bb-925e-648efbb3d7a6
- Updated: 2026-08-24T02:10:40+02:00

## Investigation State
- **Explored paths**:
  - `crates/kovanica-node/src/relay.rs` (RelaySession, RelayMsg, framing, serialization)
  - `crates/kovanica-node/src/p2p.rs` (Mesh, Envelope, discrete gossip, peer discovery)
  - `crates/kovanica-node/src/net.rs` (one-shot sync, sync tags, headers-first sync)
  - `crates/kovanica-node/src/node.rs` (BlockHeader, BlockRecord, receive_block, verification)
  - `crates/kovanica-node/src/p2p_hardening.rs` (Rate limiting, duplicate suppression, banning)
  - `crates/kovanica-state/src/spv.rs` (MerkleProof, merkle_root, SpvClient, header verification)
- **Key findings**:
  - TCP framing uses 4-byte little-endian length prefix across `relay.rs` and `net.rs`.
  - `RelayMsg` can be extended with SPV variants (`GetHeaders`, `Headers`, `GetBlocks`, `GetMerkleProof`, `MerkleBlock`) with tag-based encoding.
  - Merkle roots, Merkle paths, proofs, and `SpvClient` logic are fully built in `kovanica-state::spv`.
  - Verified that all workspace tests pass (`cargo test`).
- **Unexplored areas**: None for survey_explorer_1 scope.

## Key Decisions Made
- Produced detailed `analysis.md` answering all four dispatch questions and drafted the 5-component `handoff.md`.

## Artifact Index
- `/root/kovanica-protocol/.agents/survey_explorer_1/analysis.md` — Comprehensive analysis of wire protocol & P2P architecture
- `/root/kovanica-protocol/.agents/survey_explorer_1/handoff.md` — 5-component handoff report
- `/root/kovanica-protocol/.agents/survey_explorer_1/progress.md` — Liveness heartbeat and task progress
