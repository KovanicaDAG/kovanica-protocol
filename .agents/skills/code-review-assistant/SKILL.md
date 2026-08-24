---
name: code-review-assistant
description: >-
  Use this skill when auditing pull requests, reviewing code changes, or checking architectural alignment before committing new features.
---

# Code Review & PR Assistant Skill

This skill provides a rigorous checklist for evaluating code changes in the Kovanica protocol.

## 1. Consensus Verification (GHOSTDAG)
- Do the changes strictly adhere to the GHOSTDAG rules?
- Does the change inadvertently modify the deterministic tie-breaking logic (which must fallback to `BlockId` byte order)?
- Does the change break the `k-cluster` invariant?

## 2. Backward Compatibility & Snapshots
- Does this change alter the `Block` or `Transaction` structs?
- **CRITICAL**: If structs change, the snapshot serialization (`write_snapshot`/`read_snapshot`) must be version-bumped and handled gracefully. 
- Old checkpoints MUST still load cleanly. Always write tests that load an old binary snapshot to ensure deserialization doesn't panic.

## 3. Algorithmic Complexity (O-Notation)
- Ensure no new $O(N^2)$ loops are introduced into the critical path (e.g., `apply_block`, `mergeset` calculations, or P2P block flooding).
- Ensure interval reindexing in `reachability.rs` remains highly amortized.

## 4. Required Audits
Run the standard workflow before approving:
- `cargo fmt --check`
- `cargo clippy --all-targets -- -D warnings`
- 100% test pass rate with `cargo test`.
