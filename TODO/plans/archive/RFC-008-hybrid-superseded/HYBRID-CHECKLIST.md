# Hybrid PoW/PoS + VRF + SPV — Implementation & Activation Checklist

Use this as a living checklist while moving from pure PoW to hybrid.  
Mark items only when the exit criterion is objectively met.

---

## A. Preconditions (gate)

- [ ] RFC-006 fully live on testnet (`native_minted`, `circulating`, `burned`, `max_supply`, maturity, fee-burn)
- [ ] Residual RFC-006 gaps closed (Prometheus supply gauges, docs, tests)
- [ ] Public `/api/head` matches local after clean sync
- [ ] No open critical pure-PoW consensus issues
- [ ] Decision recorded: testnet **reset** vs activation height for hybrid

---

## B. Specification

- [ ] RFC-008 reviewed and accepted (or explicitly marked Draft with open questions listed)
- [ ] Technical Design reviewed (header layout, VRF, work assignment, stake model)
- [ ] Light-node / SPV design reviewed
- [ ] Consensus parameters table frozen for first activation (`SLOT_LENGTH`, `FIXED_STAKE_WORK`, `THRESHOLD`, activation/unbonding delays, `MIN_STAKE`)
- [ ] Open questions resolved or explicitly deferred to a follow-up KVP

---

## C. Cryptography (`kovanica-vrf`)

- [ ] VRF prove / verify implemented
- [ ] Test vectors (known-answer tests) committed
- [ ] Fuzz target running in CI
- [ ] Benchmark numbers recorded (prove + verify latency)
- [ ] No dependency on dag / state / node

---

## D. Consensus (`kovanica-dag`)

- [ ] Header version bump + optional `StakeProof` fields
- [ ] Admission: PoW path unchanged, staked path enforces VRF + eligibility
- [ ] Work assignment: real PoW work vs `FIXED_STAKE_WORK`
- [ ] GHOSTDAG(k=3) receives correct work values; existing tests still pass
- [ ] New tests: mixed PoW + staked blocks, anticone ≤ k, pure-stake tip vs PoW tip
- [ ] Pre-activation: any staked header rejected
- [ ] Post-activation: both types accepted under rules

---

## E. Ledger (`kovanica-state`)

- [ ] Staking vault / script recognition (RFC-005 extension or new template)
- [ ] `active_stake(pubkey)` and `total_active_stake` deterministic from parent view
- [ ] Activation delay enforced
- [ ] Unbonding period enforced
- [ ] Basic slash / evidence path (at least equivocation)
- [ ] Coinbase / MAX_SUPPLY / maturity / fee-burn rules identical for staked blocks

---

## F. Node (`kovanica-node`)

- [ ] Staker production loop (eligible → VRF → build → broadcast)
- [ ] Miner loop still works
- [ ] Config / env flags documented (`KOVANICA_STAKE`, key paths, etc.)
- [ ] Operator matrix updated (staker role, safe defaults)
- [ ] P2P propagates staked blocks to upgraded peers
- [ ] Logging / metrics for stake eligibility and block type

---

## G. Light-node / UniFFI

- [ ] `verify_header_chain` (selected path + basic score consistency)
- [ ] VRF proof verification path
- [ ] Blue-score depth helper for wallet UX
- [ ] Checkpoint / weak-subjectivity handling documented
- [ ] Smoke test on at least one mobile or host target
- [ ] Behaviour correct across activation boundary

---

## H. API & observability

- [ ] `/api/head` (or equivalent) exposes consensus version / hybrid active flag / blue_score
- [ ] Header fetch endpoints suitable for light-node (`/api/headers`, single header)
- [ ] Optional stake snapshot endpoint
- [ ] Grafana / Prometheus: block type counters, stake distribution, tip work source
- [ ] Explorer UI distinguishes PoW vs staked blocks (optional but recommended)

---

## I. Testnet activation

- [ ] New genesis **or** activation height published
- [ ] All public documentation updated (NETWORK.md, docs site, cheat-sheet)
- [ ] Seed / explorer / faucet operators running hybrid-aware binaries
- [ ] At least one independent staker and one miner observed producing blocks
- [ ] Light-node successfully follows the new tip
- [ ] Soak period started (target ≥ 14 days with no critical consensus incident)

---

## J. Post-activation monitoring (first 14 days)

- [ ] No unexpected pure-stake tip dominance under realistic conditions
- [ ] Stake distribution tracked (top-N validators)
- [ ] Unbonding / slash paths exercised or simulated
- [ ] Header size and propagation latency acceptable
- [ ] MAX_SUPPLY still respected
- [ ] Client reports (wallet, explorer, light-node) collected

---

## K. Mainnet readiness (later)

- [ ] Long testnet soak completed
- [ ] Security review of VRF + admission + light-client assumptions
- [ ] Economic parameters final (including any future staking rewards decision)
- [ ] Weak-subjectivity / checkpoint distribution plan for light clients
- [ ] Operator runbooks and incident response updated
- [ ] Formal go/no-go against mainnet checklist

---

## Quick reference — “do not ship” items

- Hybrid consensus code merged while RFC-006 residual gaps still open
- `FIXED_STAKE_WORK` left uncalibrated
- Light-node that accepts headers without any checkpoint story
- Staking enabled with unbonding period shorter than practical reorg depth
- Public nodes running with experimental slash disabled and no monitoring

---

**How to use:** copy this checklist into the tracking issue or project board and tick items only when evidence (PR, test log, public `/api/head`, soak report) exists.
