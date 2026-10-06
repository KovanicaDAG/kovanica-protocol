# TASKLIST 2 — PoA Migration: items discovered during operator verification

Discovered while SSH-verifying seed2/seed3 after the PoA-only cutover
(branch `consensus/poa-only-migration`, PR #15). These were **not** in
`TASKLIST.md`; they surfaced from live infrastructure.

> Status: **ALL RESOLVED except 2.5.** 2.5's root cause is a consensus-critical
> defect (RFC-009 / F1). The interim mitigation — block pruning disabled
> network-wide + an operational replay bound — shipped in `6d0581e` and must be
> deployed to every node before the reset (TASKLIST3 §3.3). The real fix is
> RFC-009 R1-R8.

## 2.1 seed3 provisioning — ✅ RESOLVED
- [x] Diagnose why seed3 never served a request. **Root cause was not
      networking.** `NRestarts=1256` — a crash loop since
      2026-10-01T14:06:15. RSS grew monotonically 8MB→4.4GB in 21s and was
      kernel-OOM-killed; it never reached the P2P bind, which is why TCP 8000
      was never listening.
- [x] Confirm the failure is pre-existing, not caused by the PoA cutover.
      seed1's binary predates every migration commit and has
      `NRestarts=0`.
- [x] Back up the data dir before touching anything
      (`/root/kovanica-backups/seed3-testnet-datadir-*.tar.gz`, 5.1MB).
- [x] Stop the crash loop, `reset-failed`, vacuum the 143MB journal (−96.9MB).
- [x] Wipe stale `alpha.log` + wallet keys; **preserve** `alpha.authorities`
      and `network` (manual operator wipe under approval — `ALLOW_RESET`
      untouched).
- [x] Start the service: `NRestarts=0`, RSS 6MB, **P2P 0.0.0.0:8000 + [::]:8000
      bound** (never achieved before).
- [x] Genesis re-derivation byte-identical to seed1 → **no fork**.
- [x] External TCP 8000 reachable from outside the host.
- [x] `fail2ban` installed and active (was absent).

## 2.2 seed2 provisioning — ✅ RESOLVED
seed2 was in the **identical** state and was also fixed the same way.
- [x] Confirm identical failure: `NRestarts=1070`, 13.5MB log frozen
      2026-10-04, same OOM pattern.
- [x] Back up, stop, `reset-failed`, vacuum journal.
- [x] Wipe `alpha.log` + wallet keys; preserve `alpha.authorities`, `network`.
- [x] Start: `NRestarts=0`, **P2P 0.0.0.0:8000 + [::]:8000 bound**.
- [x] Genesis byte-identical to seed1/seed3 → **no fork**.
- [x] External TCP 8000 reachable.
- [x] `fail2ban` installed and active (Fail2Ban v1.0.2; was absent).

## 2.3 Mesh convergence — ✅ RESOLVED
The original hypothesis recorded here was **wrong**: `sync_peers` rotates dial
order but does *not* abort a pass on failure, so a dead peer does not consume
it. Two real causes, both fixed.

- [x] **Root cause 1 — accept-queue overflow, not a rotation bug.** seed1 was
      dropping SYNs: `TcpExtListenOverflows 3380`, `TcpExtListenDrops 3385`,
      with `Send-Q 128` on `:8000`. The P2P listeners were built on the std
      default backlog of 128 (the v6 path hardcoded `socket.listen(128)`; the
      v4 path used plain `TcpListener::bind`). Every node re-dials every peer
      on a fixed timer, so a peer whose SYNs get dropped keeps re-dialling and
      keeps feeding the backlog it already fails on — a self-sustaining loop.
      `net.core.somaxconn` was 4096, so the host limit was never the
      constraint.
- [x] **Root cause 2 — EAGAIN treated as fatal.** The failing peer surfaced
      `io: Resource temporarily unavailable (os error 11)`. A peer that fails
      to connect is now backed off for `PEER_SYNC_BACKOFF_TICKS = 500`
      instead of being re-dialled every interval, and a successful sync clears
      the backoff.
- [x] **Silent-success observability hole closed.** The "reachable, nothing
      new to apply" arm logged nothing, so a healthy headers-only peer was
      indistinguishable from one never contacted. It now logs.
- [x] Verified live: all three seeds converge (chain 644/645/646,
      blue 808/809/810, peers 3/3/2), `NRestarts=0`, ~30MB RSS each.

## 2.4 `block_height` vs `/api/head blocks` — ✅ RESOLVED
Not a value bug. `kovanica_block_height` was set to **blue score** by both
`record_block_produced` and `record_block_observed` (proof: it equalled
`kovanica_dag_blue_score` exactly on seed1), while `/api/head blocks` is
`dag().len()` — the **pruned retained DAG size**. Both were correct; the names
misled.

- [x] Added an honest `kovanica_chain_height` gauge sourced from
      `Ledger::chain_height_of(selected_tip)`.
- [x] Kept `kovanica_block_height` with its current name and value for
      dashboard compatibility; verified no `alerting_rules.yml` consumer first.
- [x] Documented all three quantities at the definition site.
- [x] Regression test asserting the two series are not aliases.
- [x] **Follow-up (in TASKLIST4):** `Node::chain_height()` returns
      `tip_blue_score()`, not chain height — another misnomer. Value left
      untouched because the unbond maturity gate and other callers depend on
      it and changing it is consensus-adjacent. Needs its own change.
      **Done in `c015aab`** — see TASKLIST4 §4.2: `Node::chain_height()` is
      documented in place with all three semantics, a new
      `Ledger::tip_chain_height()` feeds all nine maturity sites (the measure
      consensus actually uses), and the public value stays unchanged for its
      existing callers. Classification: client-only / ledger-safe.

## 2.5 Unbounded log replay — ⚠️ ROOT-CAUSED; mitigation shipped, real fix deferred to RFC-009
This is no longer a finding. It **took seed1 down** and is the reason all three
seeds are now on a short chain.

The root cause turned out to be a **consensus-critical defect** (F1: block
pruning corrupts GHOSTDAG colouring), not a memory-tuning problem — so the
memory fix and the correctness fix are the same problem. The interim mitigation
shipped in `6d0581e`; the real fix is tracked in
`protocol/docs/RFC-009-BlockPruning-Colouring.md` (R1-R8).

- [x] **Confirmed live and load-bearing.** seed1 could not replay its 9.3MB
      `alpha.log` inside a 10G budget: memory climbed 3.1G → 5.3G → 6.8G →
      8.5G → 8.9G over four minutes without `:8000` ever binding.
- [x] **Root cause identified by measurement — and it is NOT the
      per-block-UTXO-state O(n^2) previously blamed.** The UTXO undo log
      (upgrade phase B3) already replaced that design: `Ledger` keeps ONE
      materialised `tip_state` plus per-block net undo `deltas`, and measured
      `deltas` stays at ~357 entries (the finality window) throughout replay.
      The reachability oracle is also ruled out — measured `fcs_total` = 9,089
      entries at replayed=11,776.
      The real cause is **`GhostdagData.blue_anticone_sizes`**
      (`crates/kovanica-dag/src/dag.rs:228`), one entry per blue block in a
      block's blue set. Blue-set size grows with depth, so every retained block
      carries an O(depth) map ⇒ **O(N²) across the DAG**. Measured: ~461 KB
      retained per block at N=11,776, which extrapolates to ~62 GB for the
      45,638-record log. It is retained on every stored block, in live
      operation as well as replay.
- [x] **Why replay never prunes it:** `Ledger::set_replay_mode(true)`
      deliberately forces `block_pruning_depth = u64::MAX` so that anticone
      blocks linearized last can still resolve deep selected parents, and
      `store.rs` pass 2 calls it *after* applying the policy depths — so no
      block is ever evicted during replay. Confirmed live: mid-replay
      `bpd=18446744073709551615` while `ppd=1000`.
- [x] **Reproduced offline in ~4 min against the real artifact** (no SSH): the
      13.5 MB `alpha.log` was pulled from seed2's backup and replayed locally,
      showing identical unbounded ~37 MB/s growth. Truncated-log series
      (1k/2k/4k/8k/16k) pinned the curve.
- [x] seed1 restored by wiping its log (backup taken first) and resyncing —
      re-derived the identical genesis, no fork.
- [x] **Fix the amplification — REOPENED, now known to be a consensus-correctness
      problem, not a memory optimisation.** Two independent approaches were tried
      and both were **disproven with reproductions**:
      1. *Shrink the map.* Dropping the selected-chain ("spine") entries of
         `blue_anticone_sizes` broke
         `block_pruning::adversarial_wide_fork_pruning`: a spine ancestor of the
         selected parent need not be an ancestor of a mergeset candidate, so
         those entries genuinely participate in `try_colour_blue`.
      2. *Evict DAG blocks during replay* (the previously-chosen design, evicting
         a block only when below `finality_score()` **and**
         `remaining[id] == 0`). An independent review plus a first-hand
         differential test showed this is **UNSAFE**: eviction leaves the evicted
         ids inside the `blue_anticone_sizes` maps retained on the surviving
         blocks, and `Reachability::is_ancestor` answers `false` for an absent id
         in *both* directions — so `Dag::in_anticone` returns `true` for an
         evicted block that is a **true ancestor** of the candidate.
      See the new item below: this is a live bug in block pruning itself, and it
      is the reason the map cannot simply be bounded.
      **Resolved in `d131790` (RFC-009 sparse map):** the stored
      `blue_anticone_sizes` is now built sparse — colouring enumerates the blue
      set through a selected-parent chain walk instead of iterating an inherited
      O(depth) map — so per-block storage is O(k) and the O(N²) amplification is
      gone (`rfc009_memory_bound.rs` asserts `m_large <= 8`). Both designs
      disproven above are superseded by the sparse representation; the (B1) trim
      was dropped in its favour.
- [x] **⚠️ CONSENSUS BUG (live, latent): block pruning corrupts GHOSTDAG
      colouring.** **Documented in
      [`protocol/docs/RFC-009-BlockPruning-Colouring.md`](protocol/docs/RFC-009-BlockPruning-Colouring.md)**
      (Draft, consensus-critical); RFC-008 is corrected in place and its
      consensus-safe claim is retracted. **Interim mitigation adopted** (per
      operator decision): block pruning disabled network-wide
      (`BLOCK_PRUNING_DEPTH = u64::MAX`) plus an operational replay bound
      (pre-flight refusal + `replay-watchdog`), so the unsound path cannot run
      and an over-budget log cannot OOM-loop a seed. `Dag::remove_blocks` (`crates/kovanica-dag/src/dag.rs`) drops
      evicted ids from the reachability oracle, `nodes`, and `tips`, but does
      **not** strip them from the `blue_anticone_sizes` maps retained on live
      blocks. `try_colour_blue` iterates *every* key of that map and asks
      `in_anticone`, which is computed from `is_ancestor` — and for an evicted id
      both `is_ancestor(evicted, x)` and `is_ancestor(x, evicted)` are `false`,
      so `in_anticone` returns `true` even when the evicted block is a true
      ancestor. **Consequence:** after any eviction, every mergeset candidate
      whose colouring is evaluated sees `O(|past(P)|)` phantom anticone blues and
      is forced red, diverging from an unpruned node's `blue_score` /
      `mergeset_blues` — a chain split.
      **Reproduced first-hand** (differential test, `block_pruning_depth = 3`,
      20-block chain + one side block): the same later merging block is
      `blue_score=24 blues=1 reds=0` unpruned vs `blue_score=23 blues=0 reds=1`
      pruned. Kept as an `#[ignore]`d regression test,
      `crates/kovanica-dag/tests/block_pruning_colouring.rs`
      (`block_pruning_preserves_colouring`), to be un-ignored when fixed.
      **It is latent on the current network only because the chain (~645 blue) is
      shorter than `TESTNET_BLOCK_PRUNING_DEPTH = 1000`, so `pruning_point()`
      is still genesis and nothing is evicted.** It will start biting as soon as
      the chain passes ~1000 blue score *with any fork* — i.e. on the post-reset
      chain. The existing `adversarial_wide_fork_pruning` test does not catch it
      because it only asserts block presence/size, never inserts a merging block
      after an eviction.
      **Attempted fix, insufficient:** stripping evicted ids from the retained
      maps restores the unpruned `blue_score` but violates the load-bearing
      invariant asserted at `ghostdag.rs:77` ("blue anticone map must cover
      exactly the blue set", `len == blue_score`) and fails 4 existing pruning
      tests. A correct fix requires reworking the k-cluster evaluation so it does
      not need the full historical blue map (Kaspa-style) — a consensus redesign,
      out of scope for a memory fix.
      **Interim mitigation to decide before the reset:** disable block pruning
      (`block_pruning_depth = u64::MAX`) so the unsound path cannot run, and bound
      replay another way (see next item). This trades memory for correctness and
      must be paired with a real fix before the chain grows large.
      **Fixed in `d131790` (RFC-009 sparse map), not just mitigated.** The
      phantom-anticone mechanism is gone: `count` skips ids absent from
      `self.nodes` (eviction removes only `past(P) \ {genesis}`, and every
      (A+)-admissible candidate lies in `future(P) ∪ {P}`, so an evicted id is
      always a true ancestor and never in-anticone — the skip is exact), the map
      starts empty (`HashMap::with_capacity(k+1)`), and colouring enumerates the
      blue set through the selected-parent chain walk. The R4 differential gate
      (`block_pruning_colouring.rs`) is un-ignored and green; the R7
      rejection-equivalence suite is green; full workspace 944 passed / 0 failed
      / 7 ignored, clippy 0/0. **Caveat:** `d131790` is on
      `consensus/poa-only-migration` only — PR #15 is still open — and the live
      guarantee remains the interim mitigation (`block_pruning_depth =
      u64::MAX`, re-confirmed on `/api/head` 2026-10-06) until RFC-009
      activation A3→A4 ships the fix to the network.
- [x] Add a memory-growth guard/alert so a replay storm is visible before the
      cgroup kill rather than after. **Done:** a `replay-watchdog` thread
      samples RSS every 10 s during replay, publishes
      `kovanica_replay_rss_bytes`, logs progress, and `abort()`s with a named
      diagnostic at 90% of the cgroup/host ceiling instead of being silently
      OOM-killed. Verified with teeth: it fired at 3740 MiB against a 3686 MiB
      ceiling (exit 134 = SIGABRT) with a `FATAL: … refusing to be OOM-killed`
      message. `cargo clippy -p kovanica-node --all-targets` clean. This is a
      backstop, not the fix.
- [x] **Bound replay without evicting mid-replay — log tier.** Rather than
      evicting DAG blocks mid-replay (disproven, see the F1 item), replay is now
      bounded operationally on the `LoadTier::Log` path: a **pre-flight estimate**
      (`estimate_replay_peak_bytes`, fitted to the measured quadratic curve)
      refuses a log whose projected peak exceeds the process memory ceiling, with
      operator guidance to restore from a snapshot or wipe-and-resync, and the
      **`replay-watchdog`** aborts cleanly if the estimate is wrong. Shipped in
      `6d0581e`. Verified: the real 13.5 MB log is refused with
      `projected replay peak is ~59569 MiB but the memory limit is 4096 MiB`,
      while a 1000-record log still loads and serves.
- [x] **Bound replay — snapshot tier.** `Ledger::read_snapshot_impl`
      (`ledger.rs:3192-3237`) rebuilds the whole DAG with `insert_raw_block` and
      never enables block pruning, so the snapshot path had the same quadratic
      exposure as the log path. It now runs the **same pre-flight refusal** plus
      the `replay-watchdog` before loading. Shipped in the snapshot-guard commit.
      (The snapshot format does not carry `block_pruning_depth`, so the loader
      still cannot apply a pruning policy — but with block pruning disabled
      network-wide that makes no difference today; recorded as a format gap.)
- [x] **A real memory bound (RFC-009 R1-R8).** **Done in `d131790`.** The
      k-cluster evaluation no longer needs the full historical blue map —
      colouring walks the selected-parent chain instead of iterating an inherited
      O(depth) map — so stored maps are O(k) and replay memory grows linearly,
      not quadratically, on top of the operational guard (pre-flight estimate +
      `replay-watchdog`). R1–R8 are green (RFC-009-ACTIVATION-PLAN A0: full
      workspace 944 passed / 0 failed / 7 ignored, clippy 0/0). Re-enabling
      block pruning network-wide is no longer open design work — it is sequenced
      as activation A3→A4 (testnet depth 1000). A finality-checkpoint replay
      (`Store::open_checkpoint`, wired for the snapshot tier) remains available
      as a separate, non-blocking enhancement.
