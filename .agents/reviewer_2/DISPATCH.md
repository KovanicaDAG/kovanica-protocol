## 2026-08-24T00:18:44Z

# DISPATCH — reviewer_2

**Objective**: Protocol security, memory bounds, error handling, and cryptographic soundness review of SPV wire protocol changes.
**Files to inspect**:
- `/root/kovanica-protocol/.agents/ORIGINAL_REQUEST.md`
- `/root/kovanica-protocol/AGENTS.md`
- `/root/kovanica-protocol/PROJECT.md`
- `/root/kovanica-protocol/TEST_INFRA.md`
- `/root/kovanica-protocol/.agents/m1_worker/changes.md`
- `crates/kovanica-node/src/relay.rs`
- `crates/kovanica-node/src/node.rs`
- `crates/kovanica-node/src/net.rs`
- `crates/kovanica-node/src/spv.rs`
- `crates/kovanica-node/src/lib.rs`
- `crates/kovanica-node/tests/spv_sync.rs`

**Tasks**:
1. Review deserializer memory bounds (`read_count`, `MAX_FRAME`, `MAX_HEADERS`, `MAX_LOCATOR_IDS`, `MAX_MERKLE_PATH`), denial-of-service protections, and error handling.
2. Review difficulty retargeting validation, monotonic timestamp validation, and 2-hour future drift boundary enforcement.
3. Run `cargo check --all-targets`, `cargo clippy --all-targets`, and `cargo test`.
4. Provide your explicit verdict (`APPROVE` or `REQUEST_CHANGES`) with rationale in `/root/kovanica-protocol/.agents/reviewer_2/handoff.md`.
