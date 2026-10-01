# Collateralized Lending & Escrow Patterns

**Document:** DEFI-LENDING  
**Date:** 2026-09-17  
**Status:** Phase 2 design (after Atomic Swap MVP)

## 1. Goal

Enable simple, trust-minimised lending where:

- Borrower locks collateral (any KVP-102 asset, RWA or NFT)
- Lender provides principal (usually KVNC)
- Release of collateral or principal is governed by time-locks and/or multisig
- Liquidation / default path is explicit and on-chain

No interest calculation or automatic compounding lives in consensus.

## 2. Basic Patterns

### 2.1 Time-locked Vault (simplest)

1. Borrower and Lender agree off-chain on terms (amount, duration, collateral ratio).
2. Borrower funds a KVP-105 vault with collateral, locktime = repayment deadline + grace.
3. Lender sends principal to Borrower (ordinary transfer).
4. On repayment, Lender (or multisig) releases the vault early, or Borrower waits for timeout and recovers collateral after proving repayment off-chain.
5. On default, after timeout the Lender can claim the collateral (if the vault script is written in favour of the Lender) or a liquidation multisig is used.

### 2.2 Multisig Escrow

- 2-of-2 or 2-of-3 (Borrower + Lender + optional arbiter)
- More flexible release conditions
- Requires active cooperation or arbiter honesty

### 2.3 Hybrid (recommended for production)

- Collateral in a vault whose script is:
  - (time-lock AND Lender signature) OR
  - (Borrower + Lender signatures) OR
  - (Arbiter + one party)
- Principal sent after collateral confirmation
- Clear on-chain signals for “repaid” vs “defaulted”

## 3. Off-chain Position Record

```json
{
  "position_id": "uuid",
  "borrower": "kov1...",
  "lender": "kov1...",
  "collateral": {
    "asset_id": "...",
    "amount": "...",
    "funding_txid": "...",
    "vout": 0
  },
  "principal": {
    "asset_id": "0000...0000",
    "amount": "...",
    "txid": "..."
  },
  "terms": {
    "duration_blocks": 50000,
    "grace_blocks": 5000,
    "collateral_ratio": "150%"
  },
  "vault_address": "kov1...",
  "status": "open|repaid|defaulted|liquidated",
  "created_at": "...",
  "signatures": { "borrower": "...", "lender": "..." }
}
```

This record is **not** consensus-critical; it is a convenience for wallets and indexers.

## 4. Liquidation Flow (simple)

1. Timeout reached and no early release transaction has been confirmed.
2. Lender (or designated liquidator) spends the vault according to the script.
3. Collateral moves to Lender (or is auctioned via a subsequent HTLC/offer).
4. Indexer marks position as liquidated.

More sophisticated Dutch auctions or partial liquidations are left for later versions.

## 5. Interest & Fees

- Interest is agreed off-chain and settled by the Borrower sending an extra KVNC payment.
- Protocol fees (if any) are ordinary transaction fees + optional burn.
- No on-chain interest accumulator.

## 6. RWA / NFT as Collateral

Once RFC-007 is available:

- RWA tokens or NFTs can be locked exactly like any other asset_id.
- Legal enforcement of the underlying asset remains off-chain.
- Wallets should surface clear disclaimers: “Token ownership ≠ automatic legal title”.

## 7. Security Considerations

| Risk | Mitigation |
|------|------------|
| Borrower never locks collateral | Lender never sends principal until collateral tx confirms |
| Lender never releases after repayment | Use 2-of-2 with timeout fallback to Borrower, or include arbiter |
| Undercollateralisation | Off-chain monitoring + conservative initial ratios |
| Script complexity bugs | Stick to well-tested KVP-105 templates; audit any new combinations |

## 8. Implementation Order (relative to DEX)

1. Finish Atomic Swap MVP first.
2. Reuse the same timeout and script-building discipline.
3. Add vault funding helpers to CLI.
4. Build minimal “Open Position / Repay / Liquidate” wallet flows.
5. Only then consider automated liquidator bots.

## 9. Definition of Done (Lending MVP)

- [ ] Borrower can lock collateral into a documented vault script
- [ ] Lender can verify the lock and send principal
- [ ] Early release (repayment) path works
- [ ] Timeout / default path works
- [ ] Explorer shows vault status
- [ ] At least one public testnet demo with recorded txids

---

**See also:** `DEFI-ARCHITECTURE.md`, `DEFI-TECHNICAL-DESIGN.md`, `DEFI-PROJECT-PLAN.md`, `DEFI-CHECKLIST.md`