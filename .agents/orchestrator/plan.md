# Project Execution Plan — SPV Wire Protocol & Integration

## 1. Survey Phase
- Spawn 3 Explorers / Spec Miners in parallel:
  - Explorer 1 (`survey_explorer_1`): Survey `kovanica-node/src/relay.rs`, `p2p.rs`, `net.rs`, `main.rs` to map current framing, message types, serialization/deserialization, and handshake/mesh loops.
  - Explorer 2 (`survey_explorer_2`): Survey `kovanica-dag` (blocks, headers, Merkle roots/trees if any, timestamps, difficulty, PoW validation) and `kovanica-state` (tx structure, block payloads, Merkle proofs/paths).
  - Explorer 3 (`survey_explorer_3`): Survey test architecture in `kovanica-node/tests` (`network.rs`, `relay.rs`, `timestamps.rs`, `p2p.rs`, `rpc.rs`) and light client requirements (header validation, difficulty retargeting bounds, wall-clock future drift limits, Merkle proof verification over TCP).

## 2. Decomposition & Feature Inventory (PROJECT.md & TEST_INFRA.md)
- Synthesize findings into `PROJECT.md` and `TEST_INFRA.md`.
- Define wire message formats (`getheaders`, `headers`, `getblocks`, `merkleblock`), serialization, handler logic in `RelaySession`/`Mesh`, SPV client verification logic, and test cases.

## 3. Execution (Milestones & Dual Track)
- Milestone 1: Wire Protocol Messages & Serialization (Merkle tree/proof primitives & P2P message types)
- Milestone 2: P2P Mesh & Relay Handlers (`getheaders`, `headers`, `getblocks`, `merkleblock`) in full node
- Milestone 3: SPV Client / Light Node Verification Logic (Header DAG / chain sync, difficulty/drift validation, Merkle proof validation)
- Milestone 4: E2E Integration Test Suite (`tests/spv_sync.rs` & multi-tier tests)
- Milestone 5: Final Milestone - Pass 100% E2E tests + Tier 5 Adversarial Coverage Hardening

## 4. Verification & Audit
- Independent Reviewers, Challengers, and Forensic Auditor verification.
- Human reporting & Victory message.
