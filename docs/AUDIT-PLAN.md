# Kovanica Protocol — Audit Plan

**Status**: Draft (P2.1)  
**Target window**: Q1 2027 (public target, not yet booked)  
**Budget range**: $75k–$150k (depending on scope depth)

---

## 1. Scope

### In-scope crates (consensus-critical)

| Crate | Lines | Description | Priority |
|-------|-------|-------------|----------|
| `kovanica-dag` | ~4,500 | BlockDAG + GHOSTDAG consensus core, reachability oracle, difficulty retargeting, PoW, VRF | **Critical** |
| `kovanica-state` | ~8,500 | UTXO ledger, transaction validation, stake registry, hybrid PoW/VRF admission, checkpoints, finality pruning | **Critical** |
| `kovanica-node` (RPC surface) | ~2,000 | Line RPC commands, block production, mempool, P2P gossip, snapshot/checkpoint I/O | **High** |

### Out of scope (for this audit)
- `kovanica-ffi` / UniFFI bindings (mobile)
- `kovanica-cli` (CLI tooling)
- `android-light-node` (mobile app)
- `kovanica-web` (frontend)
- Infrastructure (VPS, Cloudflare, DNS seeds)

---

## 2. Focus Areas

### Consensus Safety (kovanica-dag)
- GHOSTDAG k-cluster invariant: `blue_anticone_size ≤ k` for all blue blocks
- Selected parent selection determinism (tie-break on BlockId byte order)
- Mergeset computation correctness (reachability oracle parity)
- Linearization order: `order(B) = order(sp) ++ mergeset ++ [B]`
- Re-org handling: implicit re-orgs above finality, rejection below finality
- Difficulty retargeting: `next_work_target` determinism, timestamp monotonicity
- Proof-of-work: `meets_target(id, work)` correctness, genesis exemption
- VRF: `vrf_verify` correctness, epoch beacon input derivation, eligibility threshold

### Ledger Correctness (kovanica-state)
- UTXO state transitions: atomic `apply_block` / `apply_block_with_stake`
- Per-asset conservation (KVP-102): each asset independently conserved, fees in native KVNC only
- Stake registry: bond/unbond maturity, frozen-input rejection, per-(validator, asset) accounting
- Hybrid admission: PoW path + staked-VRF path, sibling-spam guard, nominal work pin
- Checkpoint encoding/decoding: v1→v6 roundtrips, stake registry v1→v2
- Finality pruning: idempotent prune, folded deltas preserve reconstruction
- Activation gating: blue-score thresholds for multisig, native tokens, stealth, script v2, HTLC, vault

### Node RPC & P2P (kovanica-node)
- Line RPC command parsing/execution: no panic on malformed input
- Block production: `produce_block` / `produce_empty` staked draw → PoW fallback
- Mempool: orphan handling, fee-based eviction, capacity limits, min fee rate
- P2P hardening: rate limits, duplicate suppression, peer scoring/banning
- Snapshot/checkpoint I/O: `write_snapshot`/`read_snapshot`, `write_checkpoint`/`read_checkpoint`
- SPV light-sync: `KVLS`v1 blob, Golomb-Rice filters, Merkle proofs

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

| Asset | Threat | Mitigation in Code |
|-------|--------|-------------------|
| **Consensus safety** | Double-spend via GHOSTDAG violation | k-cluster invariant tests, adversarial fork tests |
| **Consensus liveness** | Stall / no block production | Difficulty retarget, hybrid PoW+stake fallback |
| **Ledger integrity** | Minting / value non-conservation | Per-asset conservation checks, atomic apply |
| **Stake registry** | Unauthorized unbond / immature unlock | Maturity check (100 blocks), frozen-input rejection |
| **Hybrid admission** | Sibling spam / grinding | One staked block per (vrf_pk, selected_parent) |
| **RPC/P2P** | DoS via malformed messages | Rate limits, duplicate suppression, peer banning |
| **Finality** | Deep re-org | Finality depth pruning, rejection below finality score |

---

## 6. Public Commitment

- Audit plan published: **this document** (linked from roadmap)
- Target window: **Q1 2027** (public, not yet booked)
- Firm selection: **by end of Q4 2026**
- Public report: **will be published** regardless of findings

---

## 7. Next Steps

1. [ ] Finalize scope with team
2. [ ] Request proposals from 3–5 firms (Q4 2026)
3. [ ] Select firm, sign engagement (Q4 2026)
4. [ ] Kick off audit (Q1 2027)
5. [ ] Publish public report (post-audit)

---

*Related: [LEGIT-BOARD.md](./LEGIT-BOARD.md) · [KVP.md](./KVP.md) · [WHAT-IS-KOVANICA.md](./WHAT-IS-KOVANICA.md)*