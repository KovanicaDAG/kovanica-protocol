# TASKLIST 4 — Post-reset follow-ups

Deferred work that is **not** a blocker for the reset but must not be lost.
Each item states why it was deferred.

## 4.1 Deferred: mesh convergence (from TASKLIST2 section 2.3)
- [ ] Diagnose the dial-order rotation: one sync pass dials the dead peer and
      times out, never trying a healthy peer in the same pass.
- [ ] Verify `kovanica_peer_count` on seed2 rises above 0.
- [ ] Re-run after the reset on the fresh chain.

## 4.2 Deferred: `kovanica_block_height` vs `/api/head blocks` (TASKLIST2 2.4)
- [ ] Define what `kovanica_block_height` counts in `metrics.rs` and either
      rename it or fix it to match linearized chain height. A 32x disagreement
      with the public API will misfire alerts.

## 4.3 Deferred: unbounded log replay (TASKLIST2 2.5)
- [ ] Replace unbounded in-memory `read_log` with streaming replay, or
      reject-and-resync past a size threshold. A 13.5MB log already OOMs a
      7.9GB host; the post-reset chain will hit this again as it grows.
- [ ] Add a memory-growth guard or alert so a replay storm is visible before
      the cgroup kill.

## 4.4 Deferred: RFC-POA 0.7.2 governance residuals
Per KVP-202, still `[OPEN]` / `[TARGET]` and **not** to be implemented on the
strength of section 0:
- [ ] Authority eligibility criteria (`[OPEN]`).
- [ ] Expansion path toward `n <= 16` and threshold evolution.
- [ ] Recovery/dissolution if `t` authorities are lost.
- [ ] Stake-weighted election — **`[TARGET]`, rejected. Do not re-derive.**

## 4.5 Deferred: housekeeping
- [ ] Merge PR #15 (still draft) after review.
- [ ] Consider `deploy-seed.sh` default peers including `seed1`.
- [ ] Confirm whether the `get_stake_proof` tombstone should stay as a loud
      error or be deleted outright (client-only either way).
