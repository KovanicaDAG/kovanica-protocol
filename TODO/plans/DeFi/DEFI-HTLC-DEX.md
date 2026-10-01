# HTLC-based Atomic Swap DEX — Detailed Design

**Document:** DEFI-HTLC-DEX  
**Date:** 2026-09-17  
**Status:** Primary DeFi MVP path

## 1. Why HTLC first

- Already shipped (KVP-104)
- Trustless
- Works with any KVP-102 asset
- No new consensus rules
- Teaches the team timeout and preimage discipline needed for all later DeFi

## 2. Participants & Roles

- **Maker** — creates the offer and usually funds the first HTLC
- **Taker** — accepts the offer and funds the counterparty HTLC
- **Matcher / Relay** (optional) — discovers offers; never holds funds

## 3. Happy-path Sequence

```
1. Maker generates preimage S, computes payment_hash = SHA256(S)
2. Maker publishes signed Offer (give asset A, take asset B, hash, timeout)
3. Taker verifies offer and current market conditions
4. Taker funds HTLC-B (locks asset B under the same payment_hash + timeout)
5. Maker verifies HTLC-B on-chain (correct script, amount, timeout)
6. Maker funds HTLC-A (locks asset A under same hash + timeout)
7. Taker verifies HTLC-A
8. Taker claims HTLC-A by revealing S
9. Maker sees S on-chain and claims HTLC-B with the same S
```

Either party can refund after the absolute timeout if the counterparty never completes the next step.

## 4. Timeout Strategy

Recommended pattern (same absolute height for both HTLCs, or Taker timeout slightly earlier):

- Taker HTLC timeout = T
- Maker HTLC timeout = T + Δ (small positive delta)

This gives the Maker a window to claim after the Taker has claimed (and thereby revealed S).

Concrete calculation helper:

```text
desired_hours = 4
block_rate    ≈ observed blocks per hour
safety        = 3 * k + 20          # k=3 → ~29 blocks
timeout       = tip + desired_hours * block_rate + safety
```

Wallets must re-check tip at funding time and abort if the remaining window is too short.

## 5. Offer Message (canonical)

```json
{
  "v": 1,
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "maker": "kov1q...",
  "give": {
    "asset_id": "0000...0000",
    "amount": "1000000000"
  },
  "take": {
    "asset_id": "a1b2c3...",
    "amount": "50000000000"
  },
  "payment_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "timeout_height": 1850000,
  "created_at": "2026-09-17T02:00:00Z",
  "expires_at": "2026-09-17T06:00:00Z",
  "sig": "<Ed25519 signature over canonical bytes>"
}
```

Signature covers all fields except `sig` itself.  
Clients must reject offers whose `timeout_height` is already too close to the current tip.

## 6. On-chain Footprint

Minimum two transactions (one from each side) for a successful swap;  
up to four if both sides refund.

No persistent “pool” UTXO is required.

## 7. Failure Modes & Recovery

| Failure | Recovery |
|---------|----------|
| Taker never funds | Maker’s offer simply expires; no funds locked |
| Maker never funds after Taker | Taker refunds after timeout |
| Taker never claims | Maker refunds after timeout |
| Network reorg around timeout | Safety margin + k=3 depth protects honest parties |
| Preimage leaked early | Counterparty can claim early — treated as successful swap |

## 8. Privacy Considerations

- HTLC scripts are visible on-chain
- Linking of the two HTLCs is possible via the shared payment_hash
- Stealth addresses (KVP-103) can be used for the final claim outputs if desired
- Offer relay can be run over private channels

## 9. Extension: Multi-hop / Partial Fills

Out of scope for v1.  
Future work can use nested HTLCs or off-chain payment channels once the basic atomic swap is battle-tested.

## 10. Implementation Checklist (from DEFI-CHECKLIST)

- [ ] Script builder matches shipped KVP-104 exactly
- [ ] Address derivation deterministic
- [ ] CLI fund / claim / refund
- [ ] Wallet UI for both sides of the swap
- [ ] Explorer status view
- [ ] Public testnet demo

## 11. Reference Test Vectors (to be filled)

- Known payment_hash / preimage pair
- Expected script hex
- Expected address
- Sample fund transaction (sighash)

These should be added to the monorepo test suite once the Rust helpers land.

---

**Next:** Implement the Rust HTLC builder and the first CLI commands.  
See `DEFI-TECHNICAL-DESIGN.md` for the helper sketch and `DEFI-PROJECT-PLAN.md` for sequencing.