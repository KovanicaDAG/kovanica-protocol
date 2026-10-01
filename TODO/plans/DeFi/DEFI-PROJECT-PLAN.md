# DeFi Integration — Project Plan & Milestones

**Document:** DEFI-PROJECT-PLAN  
**Date:** 2026-09-17  
**Owner:** Protocol + Wallet + Explorer + Indexer teams

## 1. Strategic Positioning

DeFi is the highest-leverage application layer that can be built purely on already-shipped primitives (KVP-101…105).  
Primary goal: **usable atomic-swap DEX on public testnet** before mainnet, without blocking RFC-006 or RWA/NFT work.

## 2. Layered Decomposition

| Layer | Work | Risk | Notes |
|-------|------|------|-------|
| Consensus-safe | None for v1 | — | Do not touch GHOSTDAG or fee rules |
| Ledger-safe | None (reuse existing script validation) | Low | HTLC & vault already exist |
| Client-only | Swap builder, offer format, wallet UX, indexer | Low–Medium | Main effort |

**Rule:** Keep consensus and ledger crates clean. All DeFi logic lives in CLI, wallet, explorer and optional indexer services.

## 3. Phased Roadmap

### Phase 0 — Prerequisites (must be green)

| Task | Exit Criteria |
|------|---------------|
| KVP-102 `asset_id` on `/api/utxos`, `/api/history`, `/api/prepare` | AssetPicker works for any asset |
| RFC-006 activation + stable testnet | `/api/head` shows correct supply fields |
| Documented HTLC + vault script templates | Reference examples in repo |
| Fee-floor & maturity behaviour understood by wallet team | Immature coinbases never selected |

### Phase 1 — Atomic Swap MVP (highest priority)

**Goal:** Two users can safely swap KVNC ↔ any KVP-102 token on testnet.

| Milestone | Description | Exit Criteria |
|-----------|-------------|---------------|
| M1.1 | Reference Rust HTLC builder | Unit tests + CLI `htlc fund / claim / refund` |
| M1.2 | Off-chain offer schema frozen | JSON schema + signature scheme |
| M1.3 | CLI end-to-end swap | Two terminals can complete a swap |
| M1.4 | Wallet “Atomic Swap” flow | Create offer → fund → claim / refund UI |
| M1.5 | Explorer HTLC status | Shows lock / claim / refund |
| M1.6 | Public testnet demo | Documented txids + short video / write-up |

**Duration estimate:** 3–6 weeks after Phase 0.

### Phase 2 — Lending / Escrow MVP

| Milestone | Description | Exit Criteria |
|-----------|-------------|---------------|
| M2.1 | Vault-based collateral lock | Borrower can lock, lender can verify |
| M2.2 | Multisig release path | M-of-N can release principal or collateral |
| M2.3 | Simple liquidation / timeout path | Documented and tested |
| M2.4 | Wallet “Lend / Borrow” screens | Basic happy path works |
| M2.5 | Demo with RWA or test token as collateral | End-to-end on testnet |

### Phase 3 — Liquidity & Ecosystem

| Milestone | Description |
|-----------|-------------|
| M3.1 | Simple order-book / RFQ indexer |
| M3.2 | Aggregated offer list in wallet |
| M3.3 | RWA + NFT as first-class collateral |
| M3.4 | Volume & open-interest metrics (Prometheus) |
| M3.5 | Mainnet readiness checklist for DeFi features |

### Phase 4 — Advanced (post-mainnet)

- Batch net settlement
- Simple constant-product pools (off-chain matching)
- Cross-chain HTLC bridges
- Governance token + treasury flows

## 4. Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Incomplete `asset_id` HTTP surface | Blocks wallet | Finish Phase 0 first |
| Timeout miscalculation | Funds locked longer than expected | Conservative defaults + UI warnings |
| Preimage leakage | Counterparty can claim early | Strict wallet secret handling |
| Fee-floor surprises after RFC-006 | Failed claims | Always call `/api/prepare` |
| Low liquidity | Poor UX | Start with P2P + RFQ, not full AMM |
| Scope creep into consensus | Delays mainnet | Enforce “client-only” rule |
| Oracle centralisation | Manipulation risk | Never put prices on-chain |

## 5. Definition of Done — Atomic Swap MVP

- [ ] CLI can fund, claim and refund HTLCs for any asset_id
- [ ] Two independent wallets can complete a swap without trusted third party
- [ ] Timeouts work correctly under normal testnet block production
- [ ] Explorer shows HTLC lifecycle
- [ ] At least one public demo with recorded txids
- [ ] Documentation (this pack) published
- [ ] No changes required in consensus crates

## 6. Resource & Sequencing Notes

- DeFi work is almost entirely client-side → can run in parallel with RFC-006 finalisation and RWA/NFT design.
- Prefer finishing the HTLC DEX before deep lending work; swaps give immediate utility and teach the team the timeout / preimage discipline.
- First real experiment should use a low-value test asset, not production RWA.

## 7. Immediate Next Actions

1. Confirm Phase 0 status (especially `asset_id` on prepare/utxos).
2. Freeze the Swap Offer JSON schema.
3. Implement `kovanica-cli htlc` subcommands.
4. Write reference timeout helper that takes current tip + desired hours.
5. Design minimal wallet screens for “Create Offer” and “Take Offer”.

---

**Related documents in this pack:**  
`DEFI-ARCHITECTURE.md`, `DEFI-TECHNICAL-DESIGN.md`, `DEFI-HTLC-DEX.md`, `DEFI-LENDING.md`, `DEFI-CHECKLIST.md`, `DEFI-API-AND-CLIENT-NOTES.md`