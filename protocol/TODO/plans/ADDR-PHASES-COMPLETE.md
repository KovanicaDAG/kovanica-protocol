# All Kovanica Protocol Phases — Status, Sub-Phases & Post-Phases

> **Source of truth:** `AGENTS.md` §Roadmap, `protocol/TODO/plans/POA-PHASE2-MILESTONES.md`, compressed @b2@ / @b5@ / @b6@ / @b7@.

---

## Phase 0 — Shipped: Single-Chain → BlockDAG Testnet
- **Status:** CLOSED (all items checked)
- **Desc:** Consensus core, GHOSTDAG k=3, linearization, reachability oracle, payload/finality pruning, replay-log persistence, mempool, P2P mesh/relay, WebSocket explorer, address `kvnc…dag` rendering, CI gate.
- **Sub:** N/A (foundation)
- **Post:** Enables all subsequent phases.

---

## Phase 1 — Operations Hardening
- **Status:** CLOSED (all items ✅)
- **Desc:** Auto-deploy (`DEPLOY_ENABLED` + SSH), seed ops (`OPERATIONS.md`), web proxy resolved (`upstream.server.ts`), address display in wallet, CI gate (`fmt`/`clippy`/`test` before deploy), dual-stack P2P.
- **Sub:** Deploy scripts (`deploy-seed*.sh`), metrics (`metrics` 0.22 + Prometheus), alerting rules.
- **Post:** Phase 2 persistence; gates 1/2 (seed3 at `187.7.27.139`, soak).

---

## Phase 2 — Scale & Persistence
- **Status:** MOSTLY CLOSED — M2.2 assertions complete; M1.7 soak open
- **Desc:** Headers-first sync, DAG payload pruning (`Option<Vec<u8>>`), finality checkpointing (`Ledger::write_checkpoint`), reachability interval-reindex amortisation (`CHILD_RESERVE` cap).
- **Sub / Milestones:**
  - M2.1 Harness skeleton ✅ (V1–V6 skeletons, `test_authority_set()` with frozen `KeyPair::from_seed`)
  - M2.2 Adversarial assertions ✅ (V1 wrong_producer / V2 double_sign / V4 missing_sig / V5 work_inflation / V3 stale_slot / V6 authority_update_abuse — assertions inserted; compiles; 167+ tests pass)
  - M2.3 Full adversarial suite — OPEN (complete V1–V6 assertion bodies)
  - M2.4 Property-based fuzzing — OPEN
  - M2.5 Coverage doc — OPEN (`docs/ADVERSARIAL-COVERAGE.md` needed)
  - M2.6 CI integration — OPEN
- **Post:** Phase 3 (protocol evolution — RFC-POA-GOVERNANCE / KVP-202); Phase 4 (SPV/light).
- **Blockers:** M1.7 (24h multi-validator soak baseline must be **re-captured** against new PoA genesis — currently holds pre-RFC-006 values from a PoW-era chain which is incompatible).

---

## Phase 3 — Protocol Evolution
- **Status:** ACTIVE (RFC drafted, harness active; PoW/difficulty/VRF removal completed in M1.6)
- **Desc:** Authority governance RFC-POA-GOVERNANCE (KVP-202) drafted (`protocol/docs/RFC-POA-GOVERNANCE.md` — all 6 §0.7.2 items decided: selection A, eligibility D, ceremony A+D, threshold A `ceil(2n/3)`, expansion B, recovery D via RFC-005 vault); adversarial harness active; VRF/shipping on track; hybrid admission **dropp**ed (§0.7.1); stake registry retires.
- **Sub / Milestones:**
  - M3.1 `kovanica-cli` PoA commands (`genesis_poa`, `authority_key`, `authority_update`, `produce`) — OPEN
  - M3.2 Explorer authority/slot views — OPEN
  - M3.3 Wallet broadcast-only mode — OPEN
  - M3.4 Security audit (crypto / P2P / key handling / replay/DoS) — OPEN
  - M3.5 RFC-POA-GOVERNANCE + RFC-007 published — OPEN
- **Post:** Phase 4 (SPV / mobile); Phase 5 (production soak).
- **Consensus impact:** governance RFC = `consensus-breaking`; adversarial harness + CLI = `client-only`; code cleanup = `ledger-safe`.

---

## Phase 4 — Light Clients / SPV / Mobile Wallet
- **Status:** DESIGN / PREPARED (not yet executed)
- **Desc:** SPV proof verification (`SpvClient`), block filters (Golomb-Rice), Merkle inclusion proofs, mobile light-node (`LightNode` / `KVLS` v1 blob), wallet history (`history_of`), light sync (`sync` / `syncedFilterMatches`), multi-address watch.
- **Sub:** Android (`build-android.sh`, `jniLibs/`, `Keystore AES/GCM`), iOS (`xcframework`), drift-guard CI (`bindings-drift.yml` at repo root — was at `protocol/` incorrectly).
- **Post:** Phase 5 (production hardening); Phase 6 (separate, see below).

---

## Phase 5 — Production Hardening / Soak
- **Status:** OPEN — M1.7 is the active gate
- **Desc:** 24/7 multi-validator soak (seed1 `145.223.116.178`, seed2 `76.13.250.65`, seed3 `187.7.27.139` — all running, verified by `ps` / `netstat` / `OPERATIONS.md`). Re-capture baseline against PoA chain (not pre-RFC-006 PoW values).
- **Sub:** Parameter tuning (`KOVANICA_SLOT_DURATION`, authority-set size, threshold); peer scoring / banning (`p2p_hardening`); mempool v2 (orphan pool, fee eviction); metrics/observability (`metrics` 0.22, `/metrics`, `alerting_rules.yml`).
- **Post:** Mainnet readiness checklist; Phase 6.

---

## Phase 6 — Post-Stage 3 / Advanced (Formally Phase 6 — post-production)
- **Status:** PLANNED / NOT STARTED
- **Desc:** DeFi first (HTLC-first DEX MVP — existing RFC-004 HTLC infrastructure), NFT / RWA (KVP-106 / RFC-007 — draft exists), hybrid PoW/PoS + VRF (hard-gated behind RFC-006 completion — **not** active; rejected for PoA-only per §0.7.1).
- **Sub:** DeFi MVP, NFT integration, RWA notes.
- **Post:** Mainnet checklist; final audit.

---

## PoA Migration — Separate Track (Phase 1 / Phase 2 of Migration)
- **Phase 1 (Migration):** COMPLETE — PoA mechanism implemented (`authority.rs`, `block.rs` `authority_sig`, `dag.rs` `PoAConfig`/`check_poa`); authority gate (Gate 1) complete; resource footprint (Gate 3) closed (`112.7 µs/block`, `+7.4 KiB/block`); PoW files removed; FFI `LightConfig` requires `authority_public_keys`; line-RPC `genesis_poa`/`authority_key`/`authority_update` commands present.
- **Phase 2 (Migration):** ACTIVE — M1.6 genesis reset **executed** (`/tmp/reset-m16.sh`, back-up `backup-pre-reset-2026-10-02/` with 0600 preserved, `KOVANICA_AUTHORITIES` set from Gate 4); M1.7 soak open; M2.2 assertions done; M2.3/M2.5 open.
- **Blockers resolved:** Seed3 (`187.7.27.139`) now running (`pid 10021`); mainnet key ceremony done (3 keys, threshold 2, treasury env); Gate 2 / Gate 4 closable.
- **Consensus impact:** PoA-only is `consensus-breaking` (hard fork, mandatory reset executed); RFC-006 values unchanged (MAX_SUPPLY 90.2M, s₀ 10 KVNC/block, era 2,050,000, α=3/4, maturity 100, fee 75% burn / 25% producer).

---

## References (Compressed Block Placeholders)
- `@b2@` — Phase 1 closure (all 3 tracks delivered, gates 2/4 resolved, M1.6 executed)
- `@b5@` — Phase 2 milestone table (M2.1–M2.6)
- `@b6@` — Phase 1 complete / Phase 2 progress
- `@b7@` — Phase 2 M2.2 complete (adversarial assertions)
- `@b8@` — Phase 2 open (M1.7 soak, M2.3/M2.5)
- `@b10@` / `@b9@` — Phase count / milestones context

---
*File: `protocol/TODO/plans/ADDR-PHASES-COMPLETE.md` — created 2026-10-02 to consolidate all 8 roadmap phases + PoA migration phases + milestone references into a single authoritative reference.*