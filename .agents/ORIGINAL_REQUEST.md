# Original User Request

## Initial Request — 2026-08-24T00:08:12Z

# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview

Implement the P2P wire protocol for Light Clients and SPV Proofs (`getheaders`, `headers`, `getblocks`, `merkleblock`), enabling mobile wallets and light nodes to verify transactions and sync headers without downloading the full DAG.

Working directory: /root/kovanica-protocol
Integrity mode: development

## Requirements

### R1. P2P Message Support
Integrate SPV wire protocol messages (`getheaders`, `headers`, `getblocks`, `merkleblock`) directly into the existing `kovanica-node` P2P mesh and relay loops.

### R2. Integration Verification
Write an integration test that spins up a full node and an SPV client to sync headers and verify proofs over TCP. The sync must correctly handle the protocol's difficulty retargeting bounds and wall-clock future drift limits.

## Acceptance Criteria

### Integration Test
- [ ] A dedicated integration test (e.g., `tests/spv_sync.rs` in `kovanica-node`) successfully runs and passes.
- [ ] The test demonstrates an SPV client syncing headers from a full node over TCP without downloading full block payloads.
- [ ] The test demonstrates the SPV client successfully requesting and verifying a Merkle proof for a transaction using the wire protocol.
