# Changelog

All notable changes to the Kovanica protocol workspace.

Grouping is by release impact (see `docs/RELEASE.md` and the
`kovanica-release` conventions):

- **Consensus-safe** — validation/acceptance rules, k=3 GHOSTDAG invariants,
  PoA ordering. Unless stated otherwise, these are **reset-gated**: they must
  land at a fresh genesis so no old-node block is rejected mid-chain.
- **Ledger-safe** — UTXO/state behavior that does not change validation.
- **Client-only / docs** — no node impact.

## [1.1.0] — 2026-10-06 (reset-day rollout planned)

First SemVer release of the PoA-only era. The previous untagged history up to
the October reset is compressed into this entry; per-commit ids are given where
they help the audit trail.

### Consensus-safe

- **RFC-009 hardening family (reset-gated; see `docs/RFC-009-ACTIVATION-PLAN.md`
  and `docs/RFC-009-FIX-BRIEF.md`):**
  - Bound the GHOSTDAG blue-anticone map to the pruning window (B1).
  - A+ mergeset admission: every candidate block lives in `future(P) ∪ {P}`
    (`Dag::insert_with_id_inner` + `Ledger::apply_new_block`, gated on finite
    `finality_depth` and non-replay). This activates on testnet at finality
    depth 100 the moment 1.1.0 binaries produce.
  - R6 memory bound + R7 rejection equivalence for evicted blocks.
  - R8 load-path guards + snapshot pruning policy.
  - Sparse `blue_anticone_sizes` so `block_pruning_depth` can reach 10k.
  - R4 differential test gate for block-pruning colouring (tests only).
- Block pruning disabled by default (`BLOCK_PRUNING_DEPTH = u64::MAX`) so the
  F1 eviction bug cannot be reached on the live chain; finite depth must not be
  re-enabled until R1–R7 hold and R4's differential test is green.
- PoA fail-closed: the node boundary refuses unsigned blocks instead of
  logging and continuing.

### Ledger-safe

- Coinbase maturity: the wallet-facing UTXO pre-filter now measures the
  linearized chain height, matching the ledger's spendability rule
  (`UtxoEntry::is_spendable_at`). Validation is unchanged (replay-safe); the
  fix aligns what wallet users were offered with what the ledger accepts.

### Client-only / docs

- `apps/web`: `dash.kovanica.online` network dashboard (live node stats, block
  height sparkline, testnet/mainnet switch), black + gold redesign of the
  landing, testnet and mainnet surfaces; `faucet.testnet.` and `kovi.` hosts
  decommissioned (faucet remains at `testnet.kovanica.online/faucet`).
- `docs/RELEASE.md`, `docs/DEPLOY-SEED.md`, reset runbook updates.

---

Unreleased / next:
- Mainnet genesis ceremony (authority set + treasury seed) — requires
  `docs/RFC-009-ACTIVATION-PLAN.md` sign-off and the SW-PoA/SPV spec
  (`docs/SW-PoA-SPV-CONSENSUS.md`) before the mainnet reset.