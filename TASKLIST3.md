# TASKLIST 3 — Testnet reset readiness (pre-flight gate)

Everything that must be true **before** the PoA testnet reset is executed.
RFC-POA-Migration §0.6 makes the reset mandatory: the genesis block id commits
to the authority set, so a PoA node derives a different genesis than the
existing PoW-era chain.

> Status: NOT READY. 2 blocking items open.

## 3.1 Blocking — must clear before any reset
- [ ] **Authority keys exist and are distributed.** The reset re-derives genesis
      from the authority set; without the real set on every producing node the
      new genesis diverges per node. RFC-POA-GOVERNANCE (KVP-202) is still
      **Draft** and the initial-set choice is `[SELECTED]`-by-maintainer, not
      ratified. **A reset cannot be executed against an unratifed key set.**
- [ ] **Reset runbook + blast radius signed off.** Which hosts, in what order,
      who holds the keys, and the rollback. Existing
      `TESTNET-RESET-POLICY.md` predates PoA and still discusses the
      difficulty-retarget window (now `[TARGET]`-obsolete).

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
- [x] PoA fail-closed at the node boundary (commit `d00cd7a`): a node with no
      authority set refuses unsigned blocks instead of silently downgrading.
- [x] `POA_NOMINAL_WORK` retained — removing it reopens 6.1(b) work inflation.
- [ ] **Every seed must run the migrated binary.** seed1's binary currently
      predates the PoA commits; it happens to be PoA-capable but must be
      rebuilt from this branch before the reset or it will disagree about
      admission.
- [ ] `KOVANICA_AUTHORITIES` + `KOVANICA_AUTHORITY_THRESHOLD` present in each
      seed's `EnvironmentFile` (mode 0600). **Never committed.**
- [ ] **Block pruning must be disabled on every node before the reset**
      (`BLOCK_PRUNING_DEPTH = u64::MAX`, the default from this branch). Block
      pruning as shipped by RFC-008 is consensus-unsafe — it can colour a block
      differently from an unpruned node and split the chain once the reset chain
      passes ~1000 blue with any fork. See
      [`protocol/docs/RFC-009-BlockPruning-Colouring.md`](protocol/docs/RFC-009-BlockPruning-Colouring.md)
      and `TASKLIST2.md` §2.5. Verify the live value on each seed's
      `/api/head` (`block_pruning_depth == 18446744073709551615`) **after** the
      rebuilt binary is deployed and before the reset window opens.
- [ ] **Replay bound in place.** The migrated binary refuses a replay log whose
      projected peak exceeds the node's memory limit, and a `replay-watchdog`
      aborts cleanly rather than being OOM-killed. Confirm both are present in
      the deployed build so a seed restart during the reset cannot silently die.

## 3.4 Safety invariants (must hold during and after)
- [ ] The reset-permitting env flag enabled **only** on the node performing
      the reset, only during the window, reverted immediately after. Never on a
      public node. (See `kovanica-genesis-ops` for the exact procedure.)
- [ ] `KOVANICA_FAUCET=0` on all public seeds — no open faucet.
- [ ] `KOVANICA_DATA` preserved/backed up per host before the wipe.
- [ ] Full data-dir backup taken on **all three** seeds before the reset.
- [ ] Post-reset verification: each seed's `/api/head` genesis matches, block
      production advances, and supply reads under the 90.2M cap.

## 3.5 Note — reset invalidates, does not change, RFC-006
Supply math is untouched by the PoA cutover: MAX_SUPPLY 90.2M KVNC,
s0 10 KVNC/block, era 2,050,000, alpha 3/4, maturity 100 blocks, fee split 75%
burned / 25% producer, GHOSTDAG k=3. The reset discards pre-PoA balances;
the curve itself is unchanged.
