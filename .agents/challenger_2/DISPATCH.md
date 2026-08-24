# DISPATCH — challenger_2

## 2026-08-24T00:18:44Z
**Objective**: Consensus invariants, difficulty retargeting bounds, and wall-clock drift empirical challenge.
**Files to inspect**:
- `/root/kovanica-protocol/.agents/ORIGINAL_REQUEST.md`
- `/root/kovanica-protocol/AGENTS.md`
- `/root/kovanica-protocol/PROJECT.md`
- `/root/kovanica-protocol/TEST_INFRA.md`
- `crates/kovanica-dag/src/difficulty.rs`
- `crates/kovanica-state/src/spv.rs`
- `crates/kovanica-node/src/spv.rs`
- `crates/kovanica-node/tests/spv_sync.rs`

**Tasks**:
1. Empirically verify difficulty retargeting bounds ($4\times$ upward clamp and $0.25\times$ downward clamp) during SPV header sync.
2. Empirically verify wall-clock drift boundaries: exact `now + 2h` allowed vs `now + 2h + 1ms` rejected.
3. Empirically verify locator convergence across deep reorgs and fork branches.
4. Run commands, verify test output, and record empirical findings and verdict (`APPROVE` or `REQUEST_CHANGES`) in `/root/kovanica-protocol/.agents/challenger_2/handoff.md`.

