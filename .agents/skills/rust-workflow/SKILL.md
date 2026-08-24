---
name: rust-workflow
description: >-
  Use this skill when asked to review, lint, test, or audit Rust code in the Kovanica project.
  It provides the standard commands and architectural guidelines for maintaining high-performance, deterministic Rust consensus code.
---

# Kovanica Rust Workflow & Safety Skill

When asked to work on Rust code, ensure you apply these strict guidelines tailored for a distributed ledger environment.

## 1. Determinism & Consensus Rules
In consensus-critical modules (`kovanica-dag`, `kovanica-state`):
- **Never use `std::collections::HashMap` or `HashSet`** if iteration order affects block validation or the reachability oracle. Use `BTreeMap`/`BTreeSet` for deterministic iteration.
- **No floating-point math (`f32`/`f64`)**: Use integer math (e.g., `u128` for proof-of-work calculations) to ensure all nodes calculate identical results regardless of CPU architecture.
- **Time**: Wall-clock time should only be used as a soft bound (node policy), never as a strict pure-function consensus rule unless bounded by parent timestamps.

## 2. Safety & Error Handling
- **Zero Unsafe Code**: The project forbids `unsafe`. If you are writing FFI or absolutely need it, it requires a separate architectural review.
- **No Panics**: Never use `.unwrap()` or `.expect()` in node-facing code or transaction processing. Always propagate errors using `?` and proper error enums (e.g., `thiserror`). `expect()` is only allowed in tests or when an invariant is mathematically guaranteed by a previous check.

## 3. Standard Verification Commands
When finishing a coding task or auditing, ALWAYS run the following verification loop:
1. **Format Check**: `cargo fmt --check`
2. **Strict Linting**: `cargo clippy --all-targets -- -D warnings` (Fix all warnings, do not ignore them).
3. **Testing with Backtraces**: `RUST_BACKTRACE=1 cargo test`
4. **Specific Test Targeting**: If a test fails, isolate it to save time: `RUST_BACKTRACE=1 cargo test -p <crate_name> --test <test_file> -- <test_name> --nocapture`

## 4. Performance Considerations
- Pass large structures by reference (`&Block`, `&Transaction`) rather than cloning.
- Pre-allocate vectors with `Vec::with_capacity` when the size is known (especially in `reachability` and `mempool` loops).
