# TASKLIST 4 — Post-reset follow-ups

Deferred work that is **not** a blocker for the reset but must not be lost.
Each item states why it was deferred.

## 4.1 Deferred: mesh convergence (from TASKLIST2 section 2.3)
- [x] ~~Diagnose the dial-order rotation: one sync pass dials the dead peer and
      times out, never trying a healthy peer in the same pass.~~ **Stale — fixed
      in TASKLIST2 §2.3.** The real root causes were an accept-queue overflow
      (`TcpExtListenOverflows`, std default backlog 128) and `EAGAIN` treated as
      fatal; both were fixed (`P2P_LISTEN_BACKLOG = 1024` + `PEER_SYNC_BACKOFF_TICKS`),
      and the mesh converged live (chain 644/645/646, peers 3/3/2).
- [x] ~~Verify `kovanica_peer_count` on seed2 rises above 0.~~ **Stale — fixed
      in TASKLIST2 §2.4** (single gauge writer; live `kovanica_peer_count` now
      reads 3/3/2).
- [ ] Re-run after the reset on the fresh chain. **Still open — post-reset only.**
      See TASKLIST3 §3.2 and `protocol/docs/TESTNET-RESET-POLICY.md` §3.5.

## 4.2 Deferred: `kovanica_block_height` vs `/api/head blocks` (TASKLIST2 2.4)
- [x] Define what `kovanica_block_height` counts and give the other height
      semantics a name. **Done in `aa8f211`:** `kovanica_block_height` keeps its
      blue-score meaning for dashboard compatibility, and an additive
      `kovanica_chain_height` gauge was added carrying the **linearized** chain
      height, with a doc comment on both spelling out all three semantics
      (`kovanica_chain_height` = selected-chain length, `kovanica_block_height` =
      blue score, `/api/head blocks` = retained `Dag::len()`). Tests assert the
      two series are not aliases.
- [x] **`Node::chain_height()` misnomer + a real unit bug found while chasing it.**
      `Node::chain_height()` returns the tip's blue score (documented in place,
      value deliberately unchanged because the vault/CSV maturity callers depend
      on it). While auditing it, the wallet-facing coinbase-maturity pre-filter
      was found to use `tip_blue_score() − COINBASE_MATURITY` while **consensus**
      measures maturity in **linearized chain height** (`ledger.rs` CoinbaseImmature
      check) — so the filter admitted coinbases consensus rejects. Fixed in
      **`c015aab`**: new `Ledger::tip_chain_height()`, all nine maturity sites
      switched over (eight `mature_before` filters plus `produce_block`'s
      `next_height`, the latter a liveness bug where an immature spend could be
      selected into a block and then rejected at insert), plus a merge-based
      regression test (`spendable_coinbases_respect_linearized_maturity_across_a_merge`).
      Classification: **client-only / ledger-safe** — consensus enforcement was
      already correct and is unchanged.

## 4.3 Deferred: unbounded log replay (TASKLIST2 2.5)
- [x] ~~Replace unbounded in-memory `read_log` with streaming replay, or
      reject-and-resync past a size threshold.~~ **Done:** streaming replay
      already existed (`store.rs` two-pass, never buffering the log); the
      operational bound shipped in `6d0581e`/`255fbfb` — a pre-flight
      `estimate_replay_peak_bytes` refusal on both the log and snapshot tiers,
      with operator guidance to restore a snapshot or wipe-and-resync.
- [x] ~~Add a memory-growth guard or alert so a replay storm is visible before
      the cgroup kill.~~ **Done:** the `replay-watchdog` thread publishes
      `kovanica_replay_rss_bytes`, logs progress, and aborts cleanly with a named
      diagnostic at 90% of the cgroup/host ceiling (verified firing at 3740 MiB
      against a 3686 MiB ceiling instead of being silently OOM-killed).
- [x] **The real fix is RFC-009 R1-R8, not a guard.** Block pruning is disabled
      network-wide (`BLOCK_PRUNING_DEPTH = u64::MAX`) because of the F1 defect
      (pruning corrupts GHOSTDAG colouring — `RFC-009-BlockPruning-Colouring.md`),
      so replay memory still grows with the chain. Reworking the k-cluster
      evaluation so it does not need the full historical blue map is what
      restores a true O(finality-window) bound. See RFC-009 and TASKLIST2 §2.5.
      **Progress:** design (B) chosen and **(B1) landed in `0cb5b99`** — once
      pruning is enabled, `compute_ghostdag` drops every `past(P)` key (and any
      key the oracle can no longer resolve) from the inherited
      `blue_anticone_sizes`, which removes the F1 phantom-anticone mechanism and
      bounds the map to ~`block_pruning_depth` entries. The RFC-009 **R4**
      differential gate is now an active, un-ignored regression test
      (`crates/kovanica-dag/tests/block_pruning_colouring.rs`, 3 tests, all
      green; `cargo test --workspace` = 932 passed / 0 failed). **Still open:
      (B2)** — for a stale candidate in `anticone(P)` that forked off
      `A ∈ past(P)`, the dropped chain blocks in `past(P) \ past(A)` are
      genuinely in its anticone, so the drop can in principle *under*-count; the
      R4 gate exercises that configuration and (B1) reproduces the unpruned
      colouring for it, but one construction is not a proof. Block pruning
      therefore stays disabled until (B2) is settled (RFC-009 R8).
      **Settled in `d131790` (RFC-009 sparse map).** The (B1) trim was dropped
      in favour of a sparse representation: colouring enumerates the blue set via
      the selected-parent chain walk, `count` skips evicted ids (exact — eviction
      removes only `past(P) \ {genesis}`, which is always ancestral to an
      (A+)-admissible candidate, never in its anticone), so the (B2) under-count
      class disappears with the design rather than needing a proof. R4
      differential gate un-ignored and green, R7 rejection-equivalence green,
      workspace 944 passed / 0 failed / 7 ignored, clippy 0/0. Block pruning
      still stays disabled network-wide — now because activation is sequenced
      (RFC-009-ACTIVATION-PLAN A3→A4), not because the defect is open.

## 4.4 Deferred: RFC-POA 0.7.2 governance residuals
Per KVP-202, still `[OPEN]` / `[TARGET]` and **not** to be implemented on the
strength of section 0:
- [ ] Authority eligibility criteria (`[OPEN]`).
- [ ] Expansion path toward `n <= 16` and threshold evolution.
- [ ] Recovery/dissolution if `t` authorities are lost.
- [ ] Stake-weighted election — **`[TARGET]`, rejected. Do not re-derive.**

(These require maintainer/governance decisions, not engineering. The **testnet**
authority set is already ratified — see `TESTNET-RESET-POLICY.md` §2.1; this
section is about the *mainnet* set, and `RFC-POA-GOVERNANCE` / KVP-202 stays
Draft until those six inputs are settled.)

## 4.5 Deferred: housekeeping
- [x] Merge PR #15 after review. **Merged 2026-10-06T12:00:44Z** as merge
      commit `b6a8f9e` (head `a3c5b4e`). CI run 37457996683 was green on
      every job before the merge — the red `desktop-node (fmt / clippy /
      test)` check was cleared by the `worker.rs` SPV-API port (`a3c5b4e`).
- [x] `deploy-seed.sh` default peers now include `seed1` (fixed 2026-10-05).
      `protocol/scripts/deploy-seed.sh` defaulted to
      `seed2.kovanica.online:8000,seed3.kovanica.online:8000`, omitting the
      primary, so a freshly provisioned seed would never dial seed1. Both the
      usage comment and the default value now list all three, matching
      `ops/deploy/testnet/configs/network.env`. (The mainnet configs
      deliberately use the other two seeds on port 9000 — untouched.)
- [x] `get_stake_proof` tombstone: **kept as-is** (decided 2026-10-05). It is a
      deliberate, documented removal tombstone (`rpc.rs:367-370`, "removed with
      stake/VRF admission — RFC-POA-Migration §0.7.1") so an operator or stale
      client gets an explicit reason rather than "unknown command". Deleting it
      would only downgrade the error message; client-only either way.
