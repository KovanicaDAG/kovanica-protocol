# TASKLIST 2 — PoA Migration: items discovered during operator verification

Discovered while SSH-verifying seed2/seed3 after the PoA-only cutover
(branch `consensus/poa-only-migration`, PR #15). These were **not** in
`TASKLIST.md`; they surfaced from live infrastructure.

> Status: **ALL RESOLVED except 2.5, which is now BLOCKING** (see 2.5)

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
- [ ] **Follow-up (in TASKLIST4):** `Node::chain_height()` returns
      `tip_blue_score()`, not chain height — another misnomer. Value left
      untouched because the unbond maturity gate and other callers depend on
      it and changing it is consensus-adjacent. Needs its own change.

## 2.5 Unbounded log replay — ⛔ NOW BLOCKING
This is no longer a finding. It **took seed1 down** and is the reason all three
seeds are now on a short chain.

- [x] **Confirmed live and load-bearing.** seed1 could not replay its 9.3MB
      `alpha.log` inside a 10G budget: memory climbed 3.1G → 5.3G → 6.8G →
      8.5G → 8.9G over four minutes without `:8000` ever binding. That is
      ~1000x amplification, consistent with the documented per-block
      full-UTXO-state O(n^2) memory trade-off.
- [x] seed1 restored by wiping its log (backup taken first) and resyncing —
      re-derived the identical genesis, no fork.
- [ ] **Fix the amplification.** Streaming replay, or reject-and-resync past a
      size threshold. Until this is fixed, **any seed restart on a chain of
      this size risks an OOM**, so a routine `systemctl restart` during the
      testnet reset could take a seed down mid-procedure.
- [ ] Add a memory-growth guard/alert so a replay storm is visible before the
      cgroup kill rather than after.
