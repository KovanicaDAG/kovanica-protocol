# RWA Integration — Project Plan & Milestones

**Document:** RWA-PROJECT-PLAN  
**Related:** RFC-007 / KVP-106  
**Date:** 2026-09-17  
**Owner:** Protocol + Wallet + Explorer teams  

## 1. Strategic Positioning

RWA is the highest-value application layer that can be built on top of the already-shipped KVP-102 multi-asset primitive.  
Goal: reach a usable testnet RWA flow before mainnet readiness, without blocking RFC-006 activation.

## 2. Layered Decomposition

| Layer | Work | Risk | Dependencies |
|-------|------|------|--------------|
| Consensus-safe | None (preferred) or minimal mint authorization rule | High | Avoid if possible |
| Ledger-safe | Mint authorization checks, optional burn helper | Medium | KVP-102 complete |
| Client-only | Registry, wallet UX, explorer badges, issuer tooling | Low | HTTP `asset_id` surface |

**Recommendation:** Keep consensus changes to absolute minimum. Prefer script-based or convention-based issuance first.

## 3. Phased Roadmap

### Phase 0 — Foundations (pre-requisite)
**Goal:** Close remaining KVP-102 gaps so RWA can be built on solid ground.

| Task | Exit Criteria | Owner |
|------|---------------|-------|
| Finish Node HTTP `asset_id` exposure | `/api/utxos`, `/api/history`, `/api/prepare` return stable `asset_id` | Node |
| Web AssetPicker usable | Can select & transfer non-KVNC assets | Web |
| Explorer badges for non-KVNC | Visual distinction + basic metadata link | Explorer |

**Exit:** Any non-KVNC asset can be transferred end-to-end via wallet + explorer.

### Phase 1 — Minimal Viable RWA (MVP)
**Goal:** Issue, transfer and redeem a simple RWA token on testnet.

| Milestone | Description | Exit Criteria |
|-----------|-------------|---------------|
| M1.1 | Asset ID derivation standard | Documented + reference Rust helper |
| M1.2 | Off-chain metadata schema | JSON schema + IPFS example |
| M1.3 | Issuer tooling (CLI) | `kovanica-cli rwa issue` works |
| M1.4 | Wallet “Issue RWA” flow | Basic form → mint tx |
| M1.5 | Explorer RWA detail page | Shows metadata + supply |
| M1.6 | Burn / redeem flow | Holder can burn; issuer can verify |

**Duration estimate:** 3–5 weeks after Phase 0.

### Phase 2 — Controlled Issuance & Production Patterns
**Goal:** Make RWA safe enough for real (test) legal experiments.

| Milestone | Description | Exit Criteria |
|-----------|-------------|---------------|
| M2.1 | Multisig issuer support | M-of-N can mint |
| M2.2 | Simple on-chain or off-chain minter registry | Clear who is allowed to mint |
| M2.3 | Custody + legal URI best practices | Documented template |
| M2.4 | HTLC RWA ↔ KVNC example | Atomic swap demo |
| M2.5 | Vault-based escrow example | Time-locked RWA release |

### Phase 3 — Ecosystem & Mainnet Readiness
**Goal:** Production-grade RWA layer.

| Milestone | Description |
|-----------|-------------|
| M3.1 | Public RWA registry indexer |
| M3.2 | Reference legal wrapper templates (jurisdiction-specific) |
| M3.3 | Audit of mint authorization logic |
| M3.4 | Mainnet activation checklist for RWA features |
| M3.5 | Optional: fractional ownership + distribution standard (follow-up RFC) |

## 4. Risk Register (RWA-specific)

| Risk | Impact | Mitigation |
|------|--------|------------|
| Issuer key compromise | Unlimited mint | Force multisig + hardware; consider on-chain minter list |
| Metadata mutability | Misleading investors | Prefer immutable CIDs only |
| Legal title vs token ownership mismatch | Regulatory / lawsuit | Clear disclaimers + legal wrapper |
| Premature consensus change | Blocks RFC-006 | Stay in ledger/client layers first |
| Low liquidity of RWA tokens | Poor UX | Provide HTLC + future AMM patterns |
| Incomplete `asset_id` HTTP surface | Blocks wallet | Finish Phase 0 first |

## 5. Definition of Done — MVP

- [ ] Can create a new RWA `asset_id` from CLI / wallet
- [ ] Metadata published to IPFS and linked
- [ ] Tokens can be transferred between normal addresses
- [ ] Tokens can be locked in multisig and vaults
- [ ] Holder can burn tokens
- [ ] Explorer shows RWA badge + metadata
- [ ] At least one end-to-end demo on public testnet
- [ ] Documentation published (this set of files)

## 6. Resource & Sequencing Notes

- **Do not** start heavy RWA work until KVP-102 HTTP gap is closed.
- RWA work is mostly client + tooling → can run in parallel with RFC-006 finalization.
- First real experiment should use a low-value, well-documented test asset (e.g. “Testnet Parking Space #1”).

## 7. Immediate Next Actions

1. Confirm Phase 0 status of `asset_id` HTTP endpoints.
2. Freeze metadata JSON schema (this document + RFC-007).
3. Implement reference `asset_id` derivation in Rust (shared crate).
4. Draft CLI commands for issue / burn.
5. Design minimal wallet “Issue RWA” screen.

---

**Related documents:**
- `RFC-007-RWA-INTEGRATION.md`
- `RWA-TECHNICAL-DESIGN.md`
- `RWA-CHECKLIST.md`
- `KVP-102-HTTP-asset_id-gap.md`