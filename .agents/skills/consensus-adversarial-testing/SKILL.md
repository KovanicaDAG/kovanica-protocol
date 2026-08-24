---
name: consensus-adversarial-testing
description: >-
  Use this skill when asked to write tests for the DAG consensus, reachability oracle, or when debugging network forks and double-spends.
---

# Consensus & Adversarial Testing Skill

This skill defines the strict templates and requirements for writing consensus-level tests in Kovanica.

## 1. The Adversarial Mindset
When writing tests for `kovanica-dag` or `kovanica-state`, you must simulate extreme Byzantine conditions:
- **Wide Forks**: Create parallel branches that exceed the `k` parameter (the max tolerated anticone size) to ensure the network correctly colours them as red (untrusted).
- **Deep Re-orgs**: Produce a heavier competing chain that overtakes the selected tip, and assert that the `Ledger` correctly unwinds or implicitly follows the new chain.
- **Equivocation & Double-Spends**: Have a malicious actor spend the same UTXO in two parallel blocks. Ensure that `Ledger` admits both blocks into the DAG but invalidates the conflicting transaction during `apply_dag` in the merger's view.

## 2. Test Structure
- Use deterministic block parameters. Never rely on the system clock or random numbers in consensus tests. 
- Inject synthetic timestamps (`Node::set_now_ms`) to test wall-clock bounds.
- Use `Dag::with_validator` to hook in custom validation tracking if needed for the test.

## 3. Reachability Oracle Parity
When touching `reachability.rs`:
- Every change to the incremental interval-tree allocator MUST be differential-tested against a naive parent-walk DFS (`from-scratch build == incremental insert`).
- Assert that reindex counts (`CHILD_RESERVE`) stay amortized for wide fans.
