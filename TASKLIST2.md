# TASKLIST 2 — PoA Migration: items discovered during operator verification

Discovered while SSH-verifying seed2/seed3 after the PoA-only cutover
(branch `consensus/poa-only-migration`, PR #15). These were **not** in
`TASKLIST.md`; they surfaced from live infrastructure.

> Status: seed3 ⛔→✅ resolved · seed2 ⛔→✅ resolved · 2 items OPEN

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

## 2.3 Mesh convergence — ⛔ OPEN
- [ ] **seed2/seed3 do not catch up to seed1.** All three derive the same
      genesis but diverge in height afterwards (seed1 ~1002 blocks; seed2 30,
      seed3 31). seed3 logs outbound sync attempts **only against seed2** and
      spends each pass timing out on it; it is pulled *from* by seed1
      (`headers-first served 145.223.116.178`) but never dials out to it.
      - Seed cause: dial-order rotation consumes the pass on the dead peer, so
        a healthy peer is never tried in the same pass.
      - **Deferral rationale:** the testnet reset (RFC-POA-Migration §0.6) is
        mandatory and discards this chain entirely, so convergence on it is
        moot. **But it must be re-tested after the reset** — the rotation bug
        will still be there.
- [ ] `kovanica_peer_count` on **seed2 reads 0** while seed3 reads 1. Either a
      lag in the 125-tick refresh, or the same dial issue. Re-check after reset.

## 2.4 Unexplained metric reading — ⛔ OPEN
- [ ] seed1 reports `kovanica_block_height 32627` while `GET /api/head` on the
      same node reports `blocks: 1002`. Roughly 32x. Not yet diagnosed; the
      metric may be counting something other than linearized chain height
      (blue score? production counter?). **Not asserted as correct or wrong —
      it needs a definition check against `metrics.rs`.** Low severity, but a
      metric that disagrees with the API by 32x will mislead alerting.

## 2.5 Operational findings worth keeping
- [ ] The OOM is a **log-replay** problem, not steady-state: growth is
      monotonic and unbounded during `read_log`, and a 13.5MB log cannot be
      replayed on a 7.9GB host. Worth a real investigation (streaming replay,
      or reject-and-resync instead of unbounded in-memory replay) before any
      reset — a post-reset chain will hit this again as it grows.
- [ ] `deploy-seed.sh` defaults `KOVANICA_PEERS=seed2:8000,seed3:8000`, which
      **excludes seed1**. The dial-order bug in 2.3 is much less harmful if the
      primary seed is in the default peer list.
