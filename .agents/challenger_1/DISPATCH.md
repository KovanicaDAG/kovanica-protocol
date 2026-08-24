# DISPATCH — challenger_1

**Objective**: Empirical correctness & adversarial stress testing for SPV wire protocol and Merkle proofs.
**Files to inspect**:
- `/root/kovanica-protocol/.agents/ORIGINAL_REQUEST.md`
- `/root/kovanica-protocol/AGENTS.md`
- `/root/kovanica-protocol/PROJECT.md`
- `/root/kovanica-protocol/TEST_INFRA.md`
- `crates/kovanica-node/src/relay.rs`
- `crates/kovanica-node/src/spv.rs`
- `crates/kovanica-node/tests/spv_sync.rs`

**Tasks**:
1. Empirically verify message round-trips under malformed / fuzz data and edge-case wire payloads.
2. Empirically verify Merkle proof verification failure when path hashes, indices, or transaction IDs are altered.
3. Test concurrent TCP light client connections and high-throughput queries against a full node.
4. Run commands, verify test output, and record empirical findings and verdict (`APPROVE` or `REQUEST_CHANGES`) in `/root/kovanica-protocol/.agents/challenger_1/handoff.md`.

## 2026-08-24T00:18:44Z
You are challenger_1.
Your working directory is /root/kovanica-protocol/.agents/challenger_1.
Read your task instructions in /root/kovanica-protocol/.agents/challenger_1/DISPATCH.md.
Also read /root/kovanica-protocol/.agents/ORIGINAL_REQUEST.md, /root/kovanica-protocol/AGENTS.md, /root/kovanica-protocol/PROJECT.md, and /root/kovanica-protocol/TEST_INFRA.md.
Empirically verify wire framing fuzzing, invalid Merkle proofs, and concurrent TCP connections.
Write your findings to /root/kovanica-protocol/.agents/challenger_1/analysis.md and handoff report to /root/kovanica-protocol/.agents/challenger_1/handoff.md with your verdict.
Then send a completion message back.
