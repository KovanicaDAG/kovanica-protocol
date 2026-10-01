# Hybrid PoW/PoS + VRF + SPV — Project Plan

**Role:** Project-plan mastermind view for consensus change.  
**Scope:** From current pure-PoW GHOSTDAG (post-RFC-006) to Hybrid admission + light-node path.  
**Constraint:** This is a **consensus-safe** change of the highest risk class. Sequence ruthlessly around testnet stability and RFC-006 completion.

---

## 0. Preconditions (do not start coding consensus until these are green)

| # | Precondition                                      | Owner / signal                          |
|---|---------------------------------------------------|-----------------------------------------|
| 1 | RFC-006 fully activated on testnet                | `/api/head` shows full supply fields, maturity, burn |
| 2 | Residual gaps closed (Prometheus, tests, docs)    | See `RFC-006-CLOSE-GAPS.md`             |
| 3 | Stable P2P catch-up and deterministic tips        | Operator matrix healthy                 |
| 4 | No open critical consensus bugs on pure PoW       | Issue tracker clean                     |

Starting hybrid work before the above creates two simultaneous hard forks and multiplies risk.

---

## 1. Layered decomposition

| Layer            | What belongs here                                      | Risk     | Review bar          |
|------------------|--------------------------------------------------------|----------|---------------------|
| Consensus-safe   | Header version, admission, work assignment, GHOSTDAG input, VRF rules, activation | Critical | Full design review + extensive testnet soak |
| Ledger-safe      | Stake vaults / scripts, active-stake view, slash, unbonding | High     | UTXO validity preserved |
| Client-only      | Light-node UniFFI, wallet finality UX, explorer hybrid indicators, staking UI | Medium   | Can ship independently once API stable |

Never mix consensus changes with pure UX work in the same PR.

---

## 2. Milestone table

| Phase | Goal                                      | Exit criteria                                      | Est. effort (order) | Dependencies      |
|-------|-------------------------------------------|----------------------------------------------------|---------------------|-------------------|
| **H0** | Spec freeze                               | RFC-008 + Technical Design + Light-node doc reviewed & accepted | 1–2 weeks          | Preconditions     |
| **H1** | Pure crypto                               | `kovanica-vrf` crate + test vectors + benchmarks   | 1 week             | H0                |
| **H2** | Header & admission (DAG)                  | Mixed PoW+staked blocks accepted; GHOSTDAG tests green; FIXED_STAKE_WORK wired | 2–3 weeks       | H1                |
| **H3** | Stake ledger                              | Active stake view, vault recognition, activation/unbonding | 2 weeks         | H2                |
| **H4** | Node production loops                     | Staker + miner coexist; P2P propagates both types  | 1–2 weeks          | H3                |
| **H5** | Light-node path                           | UniFFI verify_header_chain + VRF; mobile smoke test | 2 weeks          | H2 (can parallel) |
| **H6** | Testnet activation                        | New genesis or fork height live; public `/api/head` shows hybrid flags; soak ≥ 2 weeks | 2–4 weeks     | H4+H5             |
| **H7** | Tooling & observability                   | Explorer hybrid view, Grafana stake metrics, operator docs | 1–2 weeks      | H6                |
| **H8** | Mainnet readiness                         | Checklist green, security review, economic parameters locked | —              | Long soak         |

Effort numbers are relative order-of-magnitude for a small core team; adjust to actual velocity.

---

## 3. Concrete deliverables per phase

### H0 — Spec
- [x] RFC-008 draft (this package)
- [x] Technical Design
- [x] Light-node / SPV design
- [ ] Parameter table signed off (SLOT_LENGTH, FIXED_STAKE_WORK, …)
- [ ] Open questions closed (VRF suite, stake root yes/no, rewards in-scope?)

### H1 — kovanica-vrf
- Prove / verify API
- Deterministic test vectors (JSON or Rust constants)
- Fuzz targets
- No dependency on dag/state

### H2 — kovanica-dag
- Versioned header with optional StakeProof
- Admission gate
- Work value selection (real PoW vs FIXED_STAKE_WORK)
- Existing GHOSTDAG tests still pass; new mixed-block tests added

### H3 — kovanica-state
- Recognition of staking vaults (RFC-005 extension or new script)
- `active_stake` / `total_active_stake` queries
- Unbonding & basic slash evidence path

### H4 — kovanica-node
- Staker loop (eligible → prove → build → broadcast)
- Config flags (`KOVANICA_STAKE=1`, key path, etc.)
- Operator matrix update

### H5 — Light / UniFFI
- Header chain verification
- VRF verification path
- Blue-score depth helper
- Integration smoke on Android/iOS or host tests

### H6 — Activation
- Testnet reset **or** clean activation height (prefer reset while still early)
- Updated genesis / network magic if needed
- Public documentation of the hybrid rules
- Monitoring for stake distribution and pure-stake tip attempts

---

## 4. Risk register (hybrid-specific)

| Risk                                      | Impact | Mitigation                                      |
|-------------------------------------------|--------|-------------------------------------------------|
| FIXED_STAKE_WORK too high                 | Stake majority overtakes honest PoW     | Conservative calibration + testnet experiments  |
| FIXED_STAKE_WORK too low                  | Staked blocks rarely useful             | Tunable constant; monitor                       |
| Stake centralisation                      | Censorship / liveness                   | Min stake, later delegation limits, monitoring  |
| Light-client long-range attack            | False tip acceptance                    | Weak subjectivity checkpoints, clear docs       |
| Simultaneous RFC-006 + hybrid debt        | Unmanageable testnet                    | **Hard gate**: finish RFC-006 first             |
| VRF implementation bug                    | Invalid blocks accepted or DoS          | Audited construction, extensive vectors, fuzz   |
| Unbonding < reorg depth                   | Nothing-at-stake style issues           | Conservative UNBONDING_PERIOD                   |
| Header size / P2P bloat                   | Propagation slowdown                    | Keep StakeProof compact                         |

---

## 5. Recommended sequencing with existing roadmap

```
Current → finish RFC-006 residual → stable pure-PoW testnet
       → H0 spec freeze
       → H1 VRF crate (can start early, zero consensus risk)
       → H2–H4 consensus + ledger + node
       → H5 light-node (parallel once headers stable)
       → H6 testnet hybrid activation + long soak
       → later: staking rewards, stake root, full SPV inclusion proofs, mainnet
```

Do **not** put hybrid on the critical path of any near-term mainnet checklist item.

---

## 6. Definition of done (hybrid testnet)

- [ ] Both PoW and staked blocks appear in the public DAG
- [ ] `/api/head` reports consensus version / hybrid active
- [ ] Light-node can sync selected headers and report blue-score depth
- [ ] GHOSTDAG selection still prefers honest PoW under realistic stake ratios
- [ ] MAX_SUPPLY, maturity, fee-burn still enforced on staked coinbases
- [ ] Operator docs and Grafana dashboards updated
- [ ] No critical consensus bugs for ≥ 14 days of soak

---

## 7. Communication & review

- Every consensus PR must reference the relevant section of RFC-008 / Technical Design.
- Parameter changes after activation = new RFC / hard fork.
- Keep the three-layer split visible in every milestone review.

---

**Document owner:** Core protocol / project lead  
**Last updated:** with RFC-008 draft package
