# TASKLIST 3 — Testnet reset readiness (pre-flight gate)

Everything that must be true **before** the PoA testnet reset is executed.
RFC-POA-Migration §0.6 makes the reset mandatory: the genesis block id commits
to the authority set, so a PoA node derives a different genesis than the
existing PoW-era chain.

> Status: **NOT READY — soak #1 FAILED (SEV-2); window restarting.** Two of the
> three §3.1 blockers are cleared: (1) the testnet authority set is **ratified**
> (2026-10-05), (2) the reset runbook's blast radius and order are **signed off**
> (2026-10-05). (3) The **24h multi-validator soak** ran 2026-10-05T20:56:41Z →
> 2026-10-06 and **failed** (SEV-2: seed2 OOM → replay-refusal crash loop,
> `NRestarts=651`); the clock restarts on a fresh window. §3.2, §3.3 and the
> deploy-side §3.4 invariants are satisfied and verified live; the remaining
> §3.4/§3.2 items are reset-window or post-reset by nature. The reset must **not**
> be executed until a soak window closes clean per `TESTNET-RESET-POLICY.md`
> §3.2 (seed1 first).

## 3.1 Blocking — must clear before any reset
- [x] **Authority keys exist and are distributed — RATIFIED 2026-10-05.** The
      deployed set is the real, randomly generated testnet set in
      `protocol/authority-keys/authorities.conf` (3 Ed25519 public keys,
      threshold 2, slot 3000 ms, set commitment `3b030005…`), verified **not** to
      be the publicly derivable `AUTHORITY_PLACEHOLDER_BASE = 9001` set — the
      live keys match no `KeyPair::from_u64(9001 + i)` seat, so no forgery is
      possible from reading the source. All three producing nodes already carry
      the set and derive the identical genesis `1a635915…`, so no new key
      material is generated and no node needs rekeying. Recorded in
      `TESTNET-RESET-POLICY.md` §2.1. RFC-POA-GOVERNANCE (KVP-202) stays
      **Draft** — it governs the *mainnet* initial set, whose ceremony
      (`AUTHORITY-KEY-CEREMONY.md`, Gate 4) is separate and not required for this
      testnet reset.
- [x] **Reset runbook + blast radius signed off — SIGNED OFF 2026-10-05.**
      `TESTNET-RESET-POLICY.md` §3 is a PoA runbook (pre-flight table §3.0,
      blast radius §3.1, order of operations §3.2, rollback §3.3, key holders
      §3.4, post-reset verification §3.5); §1's obsolete difficulty-retarget text
      is moved into a marked historical blockquote; §4 gained the
      `block_pruning_depth == u64::MAX` safety rule; §5 gained a 2026-10-05 row.
      The blast radius (§3.1) and the order of operations (§3.2, seed1 first)
      carry explicit maintainer sign-off dated 2026-10-05.
- [◐] **24h multi-validator soak — STARTED 2026-10-05T20:56:41Z; #1 FAILED
      2026-10-06 (SEV-2), clock restarted.** Baseline recorded in
      `TESTNET-RESET-POLICY.md` §0.2 gate 2: all three seeds `active`,
      `NRestarts=0`, `block_pruning_depth = u64::MAX`, same genesis; seed1/seed2
      blue 2251 / blocks 2821 / 2 peers, seed3 blue 1742 / blocks 1880 / 2 peers
      (still catching up). **Caveat:** the pre-reset mesh is *diverged*
      (TASKLIST2 §2.5 / RFC-009), so this soak is evidence for authority
      liveness and slot-clock stability, **not** for cross-validator state
      agreement — a consensus-parity soak requires the post-reset chain.
      **UPDATE 2026-10-06 (SEV-2, do not tick):** seed2 OOM-killed 12:37:33Z and
      has refused to replay since 12:38:03Z (`NRestarts=651`) — with block
      pruning disabled (RFC-009) the O(N²) replay peak (~3368 MiB) exceeds the
      `MemoryMax=3G` cap (3072 MiB); seed1 runs the same cap and is on the same
      trajectory. Details in `protocol/docs/TESTNET-SOAK.md` §"Soak #1 Result".

## 3.2 Infrastructure — should clear first
- [x] All three seeds running, `NRestarts=0`.
- [x] All three report **byte-identical genesis** → no fork.
- [x] All three accept external TCP 8000 (v4 + v6).
- [x] `fail2ban` installed and active on seed2 + seed3.
- [x] DNS correct: `seed3.kovanica.online` -> `187.7.27.139`, confirmed
      **DNS-only / grey-cloud** (origin IP returned directly, not a Cloudflare
      anycast IP). Testnet = 8000, mainnet = 9000.
- [ ] Mesh convergence re-verified after the reset (TASKLIST2 section 2.3) —
      the dial-order-rotation bug is still present.

## 3.3 Code — must be on every node before the reset
- [x] PoA-only cutover merged (PR #15): no PoW / hybrid / staked-VRF paths.
      **Merged 2026-10-06T12:00:44Z** — merge commit `b6a8f9e` (head
      `a3c5b4e`), CI green on every job. The *code* was already on every node
      before the merge — deployed build sha `9f52d9dd…` (commit `255fbfb`) —
      and live `/api/head` reports `admission: poa`, `poa_enabled: true`,
      slot 3000 ms. The merge was briefly held by a red `desktop-node`
      clippy job (`kovanica-desktop` still built the pre-migration
      `MerkleProof` API that `4488f84` rewrote), cleared by the `worker.rs`
      SPV-API port in `a3c5b4e`. Merge tracked in TASKLIST4 §4.5.
- [x] PoA fail-closed at the node boundary (commit `d00cd7a`): a node with no
      authority set refuses unsigned blocks instead of silently downgrading.
- [x] `POA_NOMINAL_WORK` retained — removing it reopens 6.1(b) work inflation.
- [x] **Every migrated node runs the rebuilt binary.** ✅ **Done** — the
      deployed binary is 5,785,656 B, sha256 `9f52d9dd…` (commit `255fbfb`),
      installed to `/usr/local/bin/kovanica-node` and restarted on all three
      hosts. Each host first backed its previous binary up to
      `/root/kovanica-backups/pre-deploy-<TS>/kovanica-node.prev`. All three:
      `active`, `NRestarts=0`, genesis unchanged.
- [x] `KOVANICA_AUTHORITIES` + `KOVANICA_AUTHORITY_THRESHOLD` present in each
      node's `EnvironmentFile`. ✅ **Done** —
      `/etc/kovanica/testnet-authorities.conf` (mode 0644, public keys only) is
      loaded by every `kovanica-testnet-seed@N.service` unit and carries
      `KOVANICA_AUTHORITIES` = 3 public keys, `KOVANICA_AUTHORITY_THRESHOLD=2`,
      `KOVANICA_SLOT_DURATION=3000`. The per-host signing secret lives in
      `/etc/kovanica/testnet-authority-N.env` (mode 0600) and is **never
      committed**.
- [x] **Block pruning must be disabled on every node before the reset**
      (`BLOCK_PRUNING_DEPTH = u64::MAX`). ✅ **Done and verified live** — all
      three nodes' `/api/head` report
      `block_pruning_depth == 18446744073709551615` (`u64::MAX`) on the deployed
      build. Block pruning as shipped by RFC-008 is consensus-unsafe — it can
      colour a block differently from an unpruned node and split the chain once
      the reset chain passes ~1000 blue with any fork. See
      [`protocol/docs/RFC-009-BlockPruning-Colouring.md`](protocol/docs/RFC-009-BlockPruning-Colouring.md)
      and `TASKLIST2.md` §2.5.
- [x] **Replay bound in place.** ✅ **Done** — present in the deployed build
      (sha `9f52d9dd…`): the log and snapshot loaders refuse a replay whose
      projected peak exceeds the node's memory limit, and a `replay-watchdog`
      aborts cleanly rather than being OOM-killed. Confirmed by rebuilding from
      `255fbfb` and by the deployed sha matching.

## 3.4 Safety invariants (must hold during and after)
- [ ] The reset-permitting env flag enabled **only** on the node performing
      the reset, only during the window, reverted immediately after. Never on a
      public node. (See `kovanica-genesis-ops` for the exact procedure.)
      *(reset-window item — still open by design.)*
- [x] `KOVANICA_FAUCET=0` on all public nodes — no open faucet. ✅ **Done and
      verified live** — set to `0` in each host's
      `/etc/kovanica/testnet-seed{N}.env` (mode 0600 preserved, backup
      `*.pre-faucet-off`), then restarted; all three `/api/state` now report
      `faucet=False`.
- [x] `KOVANICA_DATA` preserved/backed up per host before the wipe. ✅ **Done
      for the deploy** — pre-deploy backups at
      `/root/kovanica-backups/pre-deploy-<TS>/` include a `datadir.tar.gz` per
      host. Must be refreshed inside the reset window immediately before the
      actual wipe.
- [x] Full data-dir backup taken on **all three** nodes before the reset.
      ✅ **Done for the deploy** — `datadir.tar.gz` on each host (seed1
      316,153 B; seed2 316,104 B; seed3 211,727 B), alongside
      `kovanica-node.prev` and the env files. Refresh inside the reset window.
- [ ] Post-reset verification: each node's `/api/head` genesis matches, block
      production advances, and supply reads under the 90.2M cap.
      *(post-reset item.)*

## 3.5 Note — reset invalidates, does not change, RFC-006
Supply math is untouched by the PoA cutover: MAX_SUPPLY 90.2M KVNC,
s0 10 KVNC/block, era 2,050,000, alpha 3/4, maturity 100 blocks, fee split 75%
burned / 25% producer, GHOSTDAG k=3. The reset discards pre-PoA balances;
the curve itself is unchanged.
