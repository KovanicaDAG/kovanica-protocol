# DeFi Technical Design — Kovanica

**Document:** DEFI-TECHNICAL-DESIGN  
**Date:** 2026-09-17  
**Related:** DEFI-ARCHITECTURE, DEFI-HTLC-DEX, DEFI-LENDING

## 1. Transaction Patterns Overview

All DeFi flows reduce to a small set of UTXO patterns:

1. **Fund HTLC** — lock asset_id A under hash + timeout
2. **Claim HTLC** — reveal preimage, spend to claimer
3. **Refund HTLC** — after timeout, original owner recovers
4. **Fund Vault** — lock under CSV / absolute lock + optional multisig
5. **Release Vault** — time reached or M-of-N satisfied
6. **Mint / Burn** — issuer-controlled increase / decrease of non-KVNC supply (KVP-102 + RWA rules)

## 2. Script Templates (conceptual)

HTLC (already defined in KVP-104 / script v2):

```
OP_IF
    OP_SHA256 <payment_hash> OP_EQUALVERIFY
    <claimer_pubkey> OP_CHECKSIG
OP_ELSE
    <timeout> OP_CHECKLOCKTIMEVERIFY OP_DROP
    <refunder_pubkey> OP_CHECKSIG
OP_ENDIF
```

Vault (KVP-105 style):

```
<locktime> OP_CHECKLOCKTIMEVERIFY OP_DROP
<M> <pub1> ... <pubN> <N> OP_CHECKMULTISIG
```

(Exact opcodes follow the shipped script-v2 machine.)

## 3. Data Structures (off-chain)

### 3.1 Swap Offer

```json
{
  "version": 1,
  "offer_id": "uuid",
  "maker": "kov1...",
  "give": { "asset_id": "0x...", "amount": "100000000" },
  "take": { "asset_id": "0x00...00", "amount": "5000000000" },
  "payment_hash": "0x...",
  "timeout_height": 123456,
  "htlc_address": "kov1...",
  "expiry": "2026-09-18T12:00:00Z",
  "signature": "..."
}
```

### 3.2 Lending Position (off-chain record)

```json
{
  "position_id": "uuid",
  "borrower": "kov1...",
  "lender": "kov1...",
  "collateral": { "asset_id": "...", "amount": "...", "utxo": "..." },
  "principal": { "asset_id": "0x00..", "amount": "..." },
  "vault_script": "...",
  "release_height": 125000,
  "status": "active|repaid|liquidated"
}
```

## 4. Amount & Asset Handling

- Always use **atoms** (integer). Never floating point.
- Native KVNC = `asset_id = [0u8; 32]`
- Conservation is per-`asset_id` (KVP-102 already enforces this).
- After RFC-006: coinbase maturity = 100 blocks; fee floor applies to every tx.

## 5. Timeout Calculation Guidelines

Given GHOSTDAG `k=3` and observed block production rate `r` blocks/hour:

```
safety_margin = 3 * k + expected_reorg_depth
timeout_blocks = (desired_hours * r) + safety_margin
```

Wallets MUST expose the chosen absolute height and refuse to fund if the timeout is already in the past relative to current tip.

## 6. Preimage Rules

- 32-byte cryptographically random value
- Never reuse across independent swaps
- Reveal only after the counterparty HTLC is confirmed at sufficient depth
- Prefer deriving from a hierarchical secret (HD-style) so the wallet can recover

## 7. Fee & Change

Every funding / claim / refund transaction must:

1. Select UTXOs of the correct `asset_id`
2. Pay fee in KVNC (or accepted fee asset if ever extended)
3. Respect the post-RFC-006 fee floor
4. Produce correct change outputs

`/api/prepare` is the source of truth for fee calculation.

## 8. Indexer Requirements (minimal)

For a usable DEX / lending UI the indexer should expose:

```
GET /api/htlc/{txid}          → status, claimable, refundable
GET /api/offers?asset=...     → open offers
GET /api/positions?address=... 
GET /api/rwa/{asset_id}       → if RWA collateral is used
```

These can live outside the core node.

## 9. Rust Helper Sketch (shared crate)

```rust
pub struct HtlcParams {
    pub payment_hash: [u8; 32],
    pub claimer: [u8; 32],      // pubkey
    pub refunder: [u8; 32],
    pub timeout: u64,           // absolute height
}

pub fn build_htlc_script(params: &HtlcParams) -> Vec<u8> { /* ... */ }

pub fn derive_htlc_address(script: &[u8]) -> String { /* ... */ }
```

Full implementations belong in `kovanica-cli` / wallet crates; keep consensus crates free of DeFi-specific helpers.

## 10. Testing Matrix

| Scenario | Expected |
|----------|----------|
| Happy-path swap | Both sides claim successfully |
| Maker never funds | Taker times out cleanly |
| Taker never reveals | Maker refunds after timeout |
| Double-claim attempt | Second claim rejected |
| Immature coinbase used as funding | Prepare / submit rejects |
| Fee below floor | Rejected after RFC-006 |
| Cross-asset conservation | No inflation of either asset |

## 11. Open Decisions

1. Exact dust limits for HTLC outputs
2. Whether to standardise a “swap session” message format in a future KVP
3. How aggressively explorers should hide timed-out / claimed HTLCs
4. Preferred off-chain transport for offers (HTTP, libp2p, centralised relay)

---

See also: `DEFI-HTLC-DEX.md`, `DEFI-LENDING.md`, `DEFI-API-AND-CLIENT-NOTES.md`