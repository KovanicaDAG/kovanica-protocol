# Kovanica PoA Migration - Task List

> **Status: Phase 1 ✅ · Phase 3 (metrics) ✅ · Phase 4 ✅ · Phase 2 (seed3 ops) ✅ DONE**
>
> **Superseded in part.** The seed3 items below were closed by operator work
> that surfaced after this file was written — see `TASKLIST2.md` (what was
> actually wrong and how it was fixed), `TASKLIST3.md` (reset pre-flight gate)
> and `TASKLIST4.md` (deferred follow-ups). Read those alongside this one.
>
> Landed on branch `consensus/poa-only-migration` (commit `4488f84` + follow-up
> commits). Every box ticked below was verified by an actual run or grep, not
> inferred. Unticked boxes are genuinely not done.
>
> **Verification gates, last run on this tree:**
> `cargo fmt` clean · `cargo clippy --all-targets` **0 warnings, 0 errors** ·
> `cargo test` → **919 passed, 0 failed, 7 ignored** (all 7 ignores carry an
> inline reason; none is a silent skip).
>
> ⚠️ **Numbering note:** this file's phases are 1 = code removal, 2 = seed3
> deployment, 3 = metrics, 4 = adversarial tests. Some working notes elsewhere
> number "metrics" as phase 3 and "seed3" as 3b — match on the *heading*, not
> the number.

---

## Phase 1: PoA Code Removal (Consensus-Critical) — ✅ COMPLETE

Removal verified by grep across `crates/` (`*.rs`, `*.toml`, `*.kt`, `*.swift`,
`*.h`, `*.html`). Counts shown are remaining hits.

### 1.1 Remove PoW Surface (§0.1 table) — ✅ all 13 verified (0 hits / file gone)
- [x] `Dag::set_proof_of_work` — `kovanica-dag/src/dag.rs`
- [x] `Dag::set_difficulty` / `clear_difficulty` — `kovanica-dag/src/dag.rs`
- [x] `Dag::proof_of_work_enabled` — `kovanica-dag/src/dag.rs`
- [x] `DagError::InsufficientProofOfWork` — `kovanica-dag/src/dag.rs`
- [x] `DagError::DifficultyMismatch` — `kovanica-dag/src/dag.rs`
- [x] `pow` module (`mine`, `mine_from`, `meets_target`, `is_mined`) — `kovanica-dag/src/pow.rs` **file deleted**
- [x] `difficulty` module (`Retarget`, `TimedWork`, `next_work`) — `kovanica-dag/src/difficulty.rs` **file deleted**
- [x] `KOVANICA_POW` env var — **0 hits**
- [x] Mining loop + `KOVANICA_MINE` / `KOVANICA_MINE_SECS` / `KOVANICA_MINER_ADDRESS` — **0 hits**
- [x] RPC/explorer `kind: "pow"` — the only remaining `"pow"` string is a comment in `explorer_detail.rs:74` that documents the removal
- [x] FFI `BlockKind::Pow`, `set_miner_seed`, staked-then-PoW `produce_block` — **0 hits**
- [x] `protocol/mine-kvnc.sh` + `KOVANICA_MINER_ADDRESS` — **script deleted**
- [x] `pow` / `pow-vrf` cargo features — `kovanica-dag` has no `[features]`; `kovanica-node` retains only `fuzzing = []`

### 1.2 Remove Hybrid/Staked-VRF Surface (§0.7.1 table) — ✅ all 13 verified
- [x] `HybridConfig` — only remaining hit is `dag.rs:302`, a comment recording that the path was removed
- [x] `StakedVrf` — **0 hits**
- [x] `Ledger::set_hybrid` / `hybrid_enabled` — **0 hits**
- [x] `set_poa`-vs-hybrid mutual exclusion — removed; `poa_ledger.rs` now states PoA is the only regime
- [x] `stake_nominal_work` (`HybridConfig` field) — **0 hits**
- [x] Staked-block insert path (`insert_with_vrf`) — **0 hits**
- [x] `KOVANICA_HYBRID` env var — **0 hits**
- [x] Stake registry `stake.rs` — **file deleted** (`ledger.rs` still carries a comment marking the registry retired)
- [x] `Freeze` / `UNBOND_MATURITY` / `UNBOND_PREFIX` unbond path — **0 hits**
- [x] FFI hybrid + staking surface (`bond_stake`, `unbond`, `fetchStakeProof`, `fetchEpochAuthoritySet`, `verifySwPoaHeader`) — **0 hits**
- [x] `open_with_hybrid` / `_with_hybrid` reader family — only remaining hit is a comment in `poa_node.rs:217` explaining the readers are gone
- [x] `apply_block_with_stake` — **0 hits**
- [x] `kind: "staked"` in explorer/RPC — the only remaining `"staked"` string is the comment in `explorer_detail.rs:74`; `rpc.rs:363` keeps a `get_stake_proof` **tombstone** that returns an explicit "removed with stake/VRF admission" error rather than an opaque "unknown command"

### 1.3 Delete/Split Test Suites (§0.7.1 table) — ✅ all 10 verified
- [x] Delete `kovanica-state/tests/hybrid.rs` — **gone**
- [x] Delete `kovanica-node/tests/hybrid_node.rs` — **gone**
- [x] Delete `kovanica-node/tests/unbond_node.rs` — **gone**
- [x] Split `kovanica-node/tests/incremental_persistence.rs` — surviving; the `hybrid_log_*` staked-VRF replay cases are gone, and lines 7–8 now record *why* they were removed. The remaining non-hybrid content is intact and passing.
- [x] Split `kovanica-state/tests/undo_log_adversarial.rs` — surviving and **already free** of stake/`UNBOND_MATURITY` references (0 matches); no split needed
- [x] Update `kovanica-state/tests/poa_ledger.rs` — hybrid mutual-exclusion test removed; header notes PoA is the only admission regime
- [x] Update `kovanica-node/tests/poa_node.rs` — prose updated
- [x] Update `kovanica-node/tests/explorer_detail.rs` — **tightened**: was `kind == "pow" || "staked" || "poa"`, now `assert_eq!(kind, "poa")`. The old form would have let a regression reintroducing a removed admission path pass silently.
- [x] Prune `kovanica-ffi/tests/ffi.rs` — hybrid/stake/bond/validator refs removed
- [x] Update `kovanica-node/benches/node_hot_paths.rs` — 0 stake/hybrid/pow references

### 1.4 Regenerate FFI Bindings — ✅ all 3 verified
- [x] Regenerate Kotlin bindings
- [x] Regenerate Swift bindings
- [x] Commit updated bindings

> **This was a real CI failure, not a formality.** The committed bindings were
> stale by **166 Kotlin lines + 121 Swift lines + `kovanicaFFI.h`**, all
> `>`-side removals (`fetchStakeProof`, `fetchEpochAuthoritySet`,
> `verifySwPoaHeader`, `blockFilter`/`filterMatches` externs + checksums) — i.e.
> the bindings still advertised methods whose Rust source no longer existed.
> CI's `bindings drift` step (`diff -r -x README.md` against a fresh generate)
> would have failed. It now returns `fail=0`.
>
> Toolchain note for whoever regenerates next: uniffi shells out to `ktlint`
> **from `PATH`** and silently skips formatting when it is absent. ktlint
> formatting is a byte-level **no-op** on uniffi's generated Kotlin (verified
> with 0.50.0 and 1.5.0 — both produce identical bytes), so output is
> reproducible regardless of which ktlint is on `PATH`. There are no
> hand-written `README.md` files under `bindings/`, so the `-x README.md`
> exclude in CI matches nothing today.

### 1.5 Verify Build — ✅ all 3 verified
- [x] `cargo check` — implied green by the clippy/test runs below
- [x] `cargo test` — **919 passed, 0 failed, 7 ignored**
- [x] `cargo clippy --all-targets -D warnings` — **0 warnings, 0 errors**

---

## Phase 2: Seed3 Deployment (Operations) — ✅ DONE (verified 2026-10-06)

All four items landed (deployed 2026-09-29 / 2026-10-05; verified against
`protocol/docs/TESTNET-SOAK.md` §7 and a live DNS lookup on 2026-10-06).

- [x] Re-point `seed3.kovanica.online` DNS A record → `187.7.27.139` (DNS-only/grey-cloud)
      **Done** — verified live 2026-10-06: `dig` returns `187.7.27.139`
      directly (origin IP, not a Cloudflare anycast address).
- [x] Provision and start node on `srv2013143` (VPS `187.7.27.139`)
      **Done** — `kovanica-testnet-seed@3.service` active, `NRestarts=0`,
      serving TCP 8000 (`TESTNET-SOAK.md` §7.2 and Current Status).
- [x] Install fail2ban on seed3
      **Done** — FailBan v1.0.2 active (`TESTNET-SOAK.md` §7.3).
- [x] Verify TCP 9000 serves, P2P peering with seed1/seed2, metrics on :9090
      **Done on testnet TCP 8000** (mainnet is 9000) — all three seeds accept
      external TCP 8000 (v4+v6) and are mutually peered; Prometheus `:9090`
      per host reports real peer counts (2–3 peers each). Evidence:
      `TESTNET-SOAK.md` §7.4 / Current Status 2026-10-05.

> ⚠️ **Port conflict, unresolved.** `AGENTS.md` and the code default to **TCP
> 9000**, but the live `GET /api/bootstrap` advertises **port 8000**
> (`listen 0.0.0.0:8000`, peers `seed2:8000`, `seed3:8000`), and
> `DEFAULT_PEERS` for testnet is seed2+seed3 on `:8000`. Resolve which port is
> authoritative **before** provisioning seed3, or the node comes up
> unpeered. The `seed-lint` tool should be run against any env block first.
>
> ⚠️ **DNS must stay DNS-only (grey-cloud).** Never point TCP peers at a
> Cloudflare orange-cloud hostname.

---

## Phase 3: Metrics Fixes (Observability) — ✅ items 1–2 · ⛔ item 3 (blocked on Phase 2)

### `kovanica_peer_count` reported 0 — ✅ FIXED
Root cause was **five compounding bugs**, not one. All three old
`set_peer_count` call sites read `app.live_peers.len()`, and `live_peers` was
only ever assigned wholesale at the tail of `sync_peers()`:

1. **Inbound peers were never recorded** (primary). The `tick_p2p` accept loop
   serves inbound peers and only logged them. On a seed — where other seeds
   dial *us* — that is most of the mesh.
2. `sync_peers` early-returned when `peers.is_empty()`, before ever touching
   `live_peers`, and `tick_p2p` only called it when `!peers.is_empty()`.
3. Wholesale replacement meant one timed-out round zeroed the gauge; there was
   no liveness decay.
4. `Mesh::connect`'s gauge write was meaningless on a real seed — `Mesh` only
   ever holds in-process nodes, never real TCP peers.
5. `Mesh` has no disconnect path, so a vanished peer was indistinguishable
   from one merely merged.

Fix: `Explorer` now keeps `outbound_seen` / `inbound_seen` tick-stamped maps
plus `last_tip`, and **`Explorer::refresh_live_peers()` is the single writer of
the gauge** — the periodic tick, the `/metrics` scrape path, and the sync path
all route through it, so they cannot disagree. `normalise_peer_key` keys peers
by address-without-port so both directions and every spelling collapse to one
entry, and a peer ages out on its own via `PEER_LIVENESS_TICKS`.

- [x] Fix `kovanica_peer_count` metric (reports 0 despite mesh peers)

Two real bugs were found by the new regression tests and fixed:
- **`normalise_peer_key` mangled IPv6.** `trim_start_matches('[').trim_end_matches(']')`
  turned `[2001:db8::1]:9000` into `2001:db8::1]:9000`. Rewritten to use
  `strip_prefix('[')` + `find(']')`.
- **Off-by-one in the decay retain.** `*seen > cutoff` evicted a peer the
  instant it was recorded at `ticks == 0` (the subtraction saturates to 0).
  Now `*seen >= cutoff`, i.e. live iff `ticks - seen <= PEER_LIVENESS_TICKS`.

Four regression tests added: `inbound_only_mesh_reports_non_zero_peer_count`,
`a_silent_peer_ages_out_after_the_liveness_window`,
`a_peer_seen_from_both_directions_counts_once`,
`peer_key_normalisation_handles_ipv4_ipv6_and_hostnames`.

### Orphaned recorders — ✅ FIXED (all 36 now have call sites)
- [x] Enable DHT/reorg/sync/validation metrics emission

Four recorders had **zero** call sites and were silently dead:
`set_dht_routing_table_size` → `explorer.rs:764` (`tick_dht`) ·
`record_sync_complete` → `explorer.rs:1083` (`sync_peers`) ·
`record_reorg` → `explorer.rs:941` (`note_reorg`, only when the tip moves
*backwards* in height — a moving tip is normal block advancement, not a reorg) ·
`record_peer_disconnected` → per-peer eviction in `refresh_live_peers`.

`record_block_validation` / `record_tx_validation` already had call sites in
`node.rs`. Audit method: every `pub fn` in `metrics.rs` grepped for call sites
outside that file — all 36 now have ≥1.

### Verify seeds expose `/metrics` — ✅ verified (loopback-only by design)
- [x] Verify all 3 seeds expose `/metrics` publicly with correct data
      ~~publicly~~ — metrics are deliberately **loopback-only**
      (`KOVANICA_METRICS_LISTEN=127.0.0.1:9090`, "scraped, never exposed
      publicly" in `ops/deploy/testnet/configs/seed{1,2,3}.env`); the per-host
      scrape reports correct data on all three seeds — `kovanica_peer_count`
      reads 2–3 peers each (`TESTNET-SOAK.md` §7.4). Phase 2 (seed3) is now
      live, so the blocker is gone.

---

## Phase 4: PoA Adversarial Tests (§0.7.3 / KVP-201) — ✅ all 6 passing

All in `crates/kovanica-node/tests/poa_adversarial.rs`, against a 3-authority
set at threshold 2 with `SLOT_MS = 3000`.
Run: `cargo test -p kovanica-node --test poa_adversarial`.

- [x] `wrong_producer` — a valid signature from an *unscheduled* authority → `DagError::InvalidAuthoritySignature`
- [x] `double_sign` / slot violation — **not** an acceptance test. Asserts three real safety properties: equivocation gains no `blue_work` versus an honest control block, the two chains converge on the same `selected_tip()` under **opposite arrival order**, and an equivocating authority cannot lock out round-robin (slot 1's authority still extends genesis).
- [x] `stale_slot` — parent at slot 2, child claims slot 1 → rejected
- [x] `missing_authority_sig` — unsigned `Block::new` → rejected
- [x] `work_inflation` — correctly-signed blocks claiming `work` of `0`, `2`, `1_000_000`, `u128::MAX` → `DagError::PoaWorkMismatch`. **Regression guard for RFC-POA §6.1(b)**; `POA_NOMINAL_WORK` was deliberately **kept** (it is a dag-level constant, not a `HybridConfig` field, and removing it would reopen this exploit).
- [x] `authority_update_abuse` — 8 sub-cases: under-threshold, non-member signers, bit-flipped sig, sig transplanted onto a different set, replay against a successor set, duplicate signer, three malformed encodings, plus a positive 2-of-3 round-trip

---

## Open observations (not checklist items — surfaced, not fixed)

1. **`Ledger::insert` with no PoA config admits unsigned blocks.**
   `Node::insert_immediate_block` (`node.rs:2814`) has an `else` branch for when
   PoA is not enabled, and the ledger performs **no** authority check in that
   state (`PoANotEnabled` is only raised on the PoA-configured path,
   `dag.rs:422`). Production nodes always call `set_poa`, so this is not
   reachable on a well-configured network — but it is a bypass shape, and
   RFC-POA §0.7.2 (mainnet authority-set governance) is still `[OPEN]`. Worth an
   explicit decision: should a PoA-only ledger *require* an authority set?
   **Consensus-relevant — needs an RFC, not a code change.**

2. **The `get_stake_proof` RPC tombstone is live surface.** It returns an
   explicit removal error, which is deliberate. If the project wants removed
   paths to be *entirely* unreachable rather than loudly rejected, delete it
   and let it fall through to `unknown command`. Client-only either way.

3. **RFC-006 supply math is untouched by this migration** — MAX_SUPPLY
   90.2M, s₀ 10 KVNC/block, era 2,050,000, α 3/4, maturity 100 blocks, fee split
   75% burned / 25% producer, GHOSTDAG k=3 are all unchanged. What changes is
   the *pace*: fixed slots, no retarget, no gap-fill (an offline authority
   yields an empty slot). **The testnet chain must be reset before PoA goes
   live** (RFC-POA-Migration §0.6).