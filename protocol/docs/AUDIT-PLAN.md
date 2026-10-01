# Kovanica Protocol — Audit Plan

**Status**: Draft (P2.1) — **scope must be re-cut before the audit is booked**  
**Target window**: Q1 2027 (public target, not yet booked)  
**Budget range**: $75k–$150k (depending on scope depth)  
**Consensus impact**: none (planning document)

> > **Consensus decision (ratified 2026-09-25): Kovanica is PoA-only.**
> > Proof-of-Work is being removed from the protocol. See
> > `protocol/docs/RFC-POA-Migration.md` §0 (canonical). Items marked `[TARGET]`
> > are ratified but not yet implemented; `[CURRENT]` items describe shipped code.

---

## 0. Audit Scope Impact of the PoA-Only Decision

**This plan is written for a PoW chain. Under PoA-only it is wrong in ways that
matter, and it must be re-cut before an engagement is signed.** Read this
section before using §1–§5.

### 0.1 The threat model has changed class, not just detail

PoW gave Kovanica a **permissionless** admission model: anyone could spend CPU
to enter the DAG, the protocol needed no privileged key set, and *cost of
admission was self-enforcing*. PoA replaces that with a **permissioned** model —
block production is restricted to a small, on-chain-committed authority set.

**Removing PoW removes the protocol's permissionless admission path.** This is a
deliberate governance decision, not a security improvement, and an audit that
proceeds as written would review the wrong system. Concretely, the Sybil /
admission-cost property that §5's "consensus liveness" and "hybrid admission" rows
were leaning on **no longer exists**; the residual liveness risk is a
*governance* risk (are enough authorities online, and are the `t` threshold keys
safe?) rather than a *hash-power* risk.

The compensating control is the **authority set plus threshold-signed
`AuthorityUpdateTx`**, and the audit's real job shifts toward: key custody,
threshold arithmetic, rotation safety, and what happens on key loss or collusion.
**There is currently no on-chain recovery path if `t` authorities are lost or
collude** — the rotation *mechanism* is settled (genesis-fixed set, on-chain
M-of-N `AuthorityUpdateTx` only) but dissolution/recovery is `[OPEN]`
(RFC-POA-Migration §0.7.2 residual 6) and is the single largest untested risk in
the new model. Do not let it go to an auditor as a solved problem.

### 0.2 What this changes in the tables below

| Current scope item | Disposition under PoA-only |
|--------------------|----------------------------|
| `difficulty` retargeting, `pow`, `meets_target` | `[TARGET]`-removed — **drop from scope**, but audit the *removal* (see §0.3) |
| PoW-path hybrid admission | `[TARGET]`-removed |
| staked-VRF path | `[TARGET]`-removed — **dropped entirely** (decided 2026-09-25, RFC-POA-Migration §0.7.1). The stake registry retires with it; **RFC-005 vault/CSV and the treasury vaults are unaffected** (`vault.rs` has zero stake references) |
| *(new)* PoA admission: authority set, slot round-robin, authority signature | **must be added — Critical** |
| *(new)* `POA_NOMINAL_WORK = 1` pin and blue-work under PoA | **must be added — Critical** (this is the class of bug that already happened once, §6.1(b) of RFC-POA) |
| *(new)* authority key custody / threshold / rotation | **must be added — Critical** (§0.1) |
| *(new)* SPV authority-set sync and update proofs | **must be added — High** |
| *(new)* **adversarial coverage gap** — the `challenger_*` mining suites are deleted with the mining path | **must be added — High.** Re-establish as PoA adversarial tests (wrong-producer, double-sign/slot violation, stale-slot, missing-sig, work inflation, authority-update abuse). `[OPEN]` per §0.7.3, but treat as a **gate on the removal**, not a follow-up |

### 0.3 Do not let "removed" go unaudited

Deleting consensus code is itself consensus-critical. The PoW-removal PR must
get audit attention for: the completeness of the removal (no orphan `pow` /
`difficulty` call path left reachable, including the `KOVANICA_CONSENSUS=pow`
escape hatch and the RPC `kind: "pow"` surface), and the chain-format
consequences of the nominal-work pin.

### 0.4 `max(1, subsidy / 500_000)` and RFC-006 are unaffected

Whatever the consensus model, the RFC-006 constants do not move: MAX_SUPPLY
**90.2M KVNC**, s₀ **10 KVNC/block**, era **2,050,000 blocks**, α **3/4**,
maturity **100 blocks**, fee split **75% burned / 25% producer**, GHOSTDAG **k=3**,
UTXO, Ed25519, **1 KVNC = 100_000_000 atoms**. The curve is height-indexed and
`cumulative_minted` is capped in `apply_block`, so supply math is independent of
admission. Audit the cap, not the miner.

---

## 1. Scope

### In-scope crates (consensus-critical)

| Crate | Lines | Description | Priority |
|-------|-------|-------------|----------|
| `kovanica-dag` | ~4,500 | BlockDAG + GHOSTDAG consensus core, reachability oracle, difficulty retargeting `[TARGET]`-removed, PoW `[TARGET]`-removed, VRF `[TARGET]`-removed, **PoA authority admission + nominal-work pin `[TARGET]`-required scope** | **Critical** |
| `kovanica-state` | ~8,500 | UTXO ledger, transaction validation, **RFC-005 vault/CSV + treasury vaults**, checkpoints, finality pruning. Stake registry + hybrid admission `[TARGET]`-removed (§0.7.1) | **Critical** |
| `kovanica-node` (RPC surface) | ~2,000 | Line RPC commands, block production, mempool, P2P gossip, snapshot/checkpoint I/O | **High** |

### Out of scope (for this audit)
- `kovanica-ffi` / UniFFI bindings (mobile)
- `kovanica-cli` (CLI tooling) — note: the CLI has **no** mining commands
  today, so there is nothing PoW-related to exclude
- `android-light-node` (mobile app)
- `kovanica-web` (frontend)
- Infrastructure (VPS, Cloudflare, DNS seeds)
- ⚠️ `[TARGET]` **Key custody and operator procedures for authority signing
  keys** would normally be out of scope as "infrastructure". Under PoA-only they
  are the crown jewels of the new model and **must be brought into scope**
  (§0.1). This is a deliberate scope expansion, not an oversight.

---

## 2. Focus Areas

### Consensus Safety (kovanica-dag)
- GHOSTDAG k-cluster invariant: `blue_anticone_size ≤ k` for all blue blocks
- Selected parent selection determinism (tie-break on BlockId byte order)
- Mergeset computation correctness (reachability oracle parity)
- Linearization order: `order(B) = order(sp) ++ mergeset ++ [B]`
- Re-org handling: implicit re-orgs above finality, rejection below finality
- Difficulty retargeting: `next_work_target` determinism, timestamp monotonicity
  — `[TARGET]`-removed; audit the *removal* instead
- Proof-of-work: `meets_target(id, work)` correctness, genesis exemption
  — `[TARGET]`-removed
- VRF: `vrf_verify` correctness, epoch beacon input derivation, eligibility
  threshold — `[TARGET]`-removed (hybrid dropped entirely, §0.7.1); drop from
  scope, but audit the *removal* per §0.3

### PoA Admission (kovanica-dag) — `[TARGET]` **new, Critical**
- Authority signature verification against `active_authority(slot)`;
  permutation-invariance of `AuthoritySet::hash()` and `active_authority()`
  (RFC-POA §6.1(a) — two nodes with the same keys in different order must not
  fork)
- Slot consistency: `slot == timestamp_ms / SLOT_DURATION_MS`, `slot ≥ parent_slots`
- The `POA_NOMINAL_WORK = 1` pin: `Dag::check_poa` / `DagError::PoaWorkMismatch`,
  and that accumulated blue work really is a plain block count. **This is the
  exact bug class that already occurred once** — RFC-POA §2 claimed PoA
  "ignored" `work` while `compute_ghostdag` still consumed it, letting an
  authority capture chain selection. The fix is a pin at the admission boundary
  (§6.1(b)); an audit should try to break that boundary.
- `AuthorityUpdateTx` validation and threshold arithmetic

### Ledger Correctness (kovanica-state)
- UTXO state transitions: atomic `apply_block` / `apply_block_with_stake`
- Per-asset conservation (KVP-102): each asset independently conserved, fees in native KVNC only
- Supply cap: `cumulative_minted + claimed_native > MAX_SUPPLY` rejection in
  `apply_block`, and the mergeset-ordering argument for parallel near-cap blocks
- Stake registry: bond/unbond maturity, frozen-input rejection, per-(validator, asset) accounting
- Hybrid admission: PoW path `[TARGET]`-removed + staked-VRF path
  `[TARGET]`-removed (both, §0.7.1); stake registry retires with them,
  sibling-spam guard, nominal work pin
- Checkpoint encoding/decoding: v1→v6 roundtrips, stake registry v1→v2
- Finality pruning: idempotent prune, folded deltas preserve reconstruction
- Activation gating: blue-score thresholds for multisig, native tokens, stealth, script v2, HTLC, vault

### Node RPC & P2P (kovanica-node)
- Line RPC command parsing/execution: no panic on malformed input
- Block production: `produce_block` / `produce_empty` staked draw → PoW fallback
  — `[TARGET]`-obsolete; PoA production is `try_produce_poa`
- Explorer/RPC `kind` field: `poa` is the only `[TARGET]` value; `pow` is removed
- `KOVANICA_CONSENSUS` parsing: any value other than `poa` must **fail loudly**,
  not silently fall back
- Mempool: orphan handling, fee-based eviction, capacity limits, min fee rate
- P2P hardening: rate limits, duplicate suppression, peer scoring/banning
- Snapshot/checkpoint I/O: `write_snapshot`/`read_snapshot`, `write_checkpoint`/`read_checkpoint`
- SPV light-sync: `KVLS`v1 blob, Golomb-Rice filters, Merkle proofs; plus
  authority-set sync and update proofs under PoA

---

## 3. Candidate Firms / Researchers

| Firm | Relevant Experience | Notes |
|------|---------------------|-------|
| **Trail of Bits** | Rust, consensus (Filecoin, Tezos), formal verification | High cost, high thoroughness |
| **Sigma Prime** | Ethereum consensus, Rust, GHOSTDAG-adjacent (Lighthouse) | Strong on consensus |
| **Halborn** | Rust, DeFi, Layer 1s (Solana, Aptos) | Good Rust coverage |
| **OtterSec** | Rust, Solana, Move, consensus | Strong on memory safety |
| **Zellic** | Rust, consensus, novel cryptography | Emerging, competitive pricing |
| **Pashov Audit Group** | Rust, DeFi, competitive rates | Good value |
| **Independent researchers** | e.g., @nebraskaf, @kzen-networks | For targeted reviews |

**Selection criteria**: Prior GHOSTDAG/Kaspa/BlockDAG experience > general Rust > general blockchain.

---

## 4. Audit Phases

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| **1. Ramp-up** | 1 week | Auditor onboards, runs tests, understands threat model |
| **2. Automated analysis** | 1 week | `cargo audit`, `cargo fuzz`, `cargo clippy`, `cargo miri` findings |
| **3. Manual review** | 3–4 weeks | Deep dive on consensus + ledger + RPC |
| **4. Report + remediation** | 2 weeks | Findings (Critical/High/Medium/Low), fix verification |
| **5. Public report** | 1 week | Redacted public report published |

**Total estimated**: 8–10 weeks

---

## 5. Threat Model Summary

**`[CURRENT]` rows describe the shipped PoW-era model. `[TARGET]` rows are the
PoA model that replaces them — see §0.1 for why this is a change of class, not a
change of detail.**

### `[CURRENT]` — shipped (pre-migration) model

| Asset | Threat | Mitigation in Code |
|-------|--------|-------------------|
| **Consensus safety** | Double-spend via GHOSTDAG violation | k-cluster invariant tests, adversarial fork tests |
| **Consensus liveness** | Stall / no block production | Difficulty retarget, hybrid PoW+stake fallback |
| **Ledger integrity** | Minting / value non-conservation | Per-asset conservation checks, atomic apply |
| **Stake registry** | Unauthorized unbond / immature unlock | Maturity check (100 blocks), frozen-input rejection |
| **Hybrid admission** | Sibling spam / grinding | One staked block per (vrf_pk, selected_parent) |
| **RPC/P2P** | DoS via malformed messages | Rate limits, duplicate suppression, peer banning |
| **Finality** | Deep re-org | Finality depth pruning, rejection below finality score |

### `[TARGET]` — PoA model (what the audit must actually review)

| Asset | Threat | Mitigation | Status |
|-------|--------|------------|--------|
| **Consensus safety** | Double-spend via GHOSTDAG violation | k-cluster tests, adversarial fork tests | Carries over |
| **Consensus safety (new)** | Authority captures chain selection by forging `work` | `POA_NOMINAL_WORK = 1` pin at admission (`Dag::check_poa`) | Shipped; **must be audited — this bug class already occurred** (RFC-POA §6.1(b)) |
| **Consensus safety (new)** | Fork via non-canonical authority ordering | `AuthoritySet::new` sorts keys; permutation-invariance tests | Shipped; **must be audited** (RFC-POA §6.1(a)) |
| **Consensus liveness** | **Loss of the permissionless admission path** — the protocol no longer has one | *None; this is deliberate* | **Accepted governance risk, RFC-POA §0.5** |
| **Consensus liveness (new)** | Enough authorities offline to stall slots | Slot round-robin; no gap-fill, so a dead authority = empty slot, not a retarget | Partial. **No automated failover exists** |
| **Authority governance (new)** | Rogue `t` authorities collude to rewrite history | `AuthorityUpdateTx` threshold; rotation only via that path (mechanism settled) | `[OPEN]` on **inputs** — **§0.7.2 residuals; largest untested risk** |
| **Key custody (new)** | Authority signing key compromised / lost | Ceremony + threshold signing; mainnet refuses to boot without explicit `KOVANICA_AUTHORITIES` | `[OPEN]` — no key-ceremony spec exists |
| **Supply cap** | Issuance above MAX_SUPPLY via racing near-cap blocks | `cumulative_minted` cap in `apply_block` + mergeset ordering | Carries over; **unchanged by PoA** |
| **RPC/P2P** | DoS via malformed messages | Rate limits, duplicate suppression, peer banning | Carries over |
| **Finality** | Deep re-org | Finality depth pruning, rejection below finality score | Carries over |

---

## 6. Public Commitment

- Audit plan published: **this document** (linked from roadmap)
- Target window: **Q1 2027** (public, not yet booked)
- Firm selection: **by end of Q4 2026**
- Public report: **will be published** regardless of findings

---

## 7. Next Steps

1. [ ] **Re-cut scope for PoA-only** (§0.2) — *blocking; do not request
   proposals against the current scope*
2. [ ] Scope the authority-set governance / key-ceremony residuals
   (§0.7.2) — *hybrid fate is no longer a blocker, it is decided (§0.7.1)*
3. [ ] Decide whether PoA adversarial tests replace the deleted `challenger_*`
   suites (§0.7.3) — a **gate on the removal**, not a follow-up
3. [ ] Finalize scope with team
4. [ ] Request proposals from 3–5 firms (Q4 2026)
5. [ ] Select firm, sign engagement (Q4 2026)
6. [ ] Kick off audit (Q1 2027)
7. [ ] Publish public report (post-audit)

---

*Related: [LEGIT-BOARD.md](./LEGIT-BOARD.md) · [KVP.md](./KVP.md) · [WHAT-IS-KOVANICA.md](./WHAT-IS-KOVANICA.md) · [RFC-POA-Migration.md §0](./RFC-POA-Migration.md)*