# DeFi — API & Client Notes

**Document:** DEFI-API-AND-CLIENT-NOTES  
**Date:** 2026-09-17

## 1. Core Node HTTP Surface (existing)

DeFi clients rely on the standard Kovanica node API. No new consensus endpoints are required for v1.

| Endpoint | Use in DeFi |
|----------|-------------|
| `GET /api/head` | Current tip height (for timeout calculation), fee parameters |
| `GET /api/utxos?address=...` | Select funding UTXOs by `asset_id` |
| `GET /api/history?...` | Track HTLC / vault related txs |
| `POST /api/prepare` | Fee calculation, change, sighash for fund / claim / refund |
| `POST /api/submit` | Broadcast signed transactions |
| `GET /api/tx/{txid}` | Confirm claim or refund landed |

After KVP-102 gap is closed, every UTXO and prepare response must carry a stable `asset_id` field.

## 2. Recommended Indexer / Application API (off-chain)

These live outside the core node:

```
GET  /api/offers                     # list open swap offers
GET  /api/offers/{offer_id}
POST /api/offers                     # publish signed offer (optional relay)
DELETE /api/offers/{offer_id}        # cancel (soft)

GET  /api/htlc/{txid or address}     # status: open / claimed / refunded
GET  /api/positions?address=...      # lending positions
GET  /api/rwa/{asset_id}             # metadata if collateral is RWA
```

## 3. Client Responsibilities

1. **Never send seeds or private keys to any node or indexer.**
2. Generate 32-byte preimages with a CSPRNG; store encrypted or derive deterministically.
3. Compute timeouts from current tip + desired duration + safety margin.
4. Always call `/api/prepare` before signing; never hard-code fees.
5. Verify the on-chain script of the counterparty HTLC before considering funds “locked”.
6. After RFC-006, skip immature coinbases automatically (prepare already does this if implemented correctly).

## 4. Suggested CLI Surface

```bash
# HTLC helpers
kovanica-cli htlc fund   --asset-id <id> --amount <atoms> --hash <hex> --timeout <height> --claimer <addr>
kovanica-cli htlc claim  --txid <txid> --vout <n> --preimage <hex>
kovanica-cli htlc refund --txid <txid> --vout <n>
kovanica-cli htlc inspect --txid <txid>

# Offer helpers (optional)
kovanica-cli defi offer-create ...
kovanica-cli defi offer-take ...
```

## 5. Wallet Integration Points

- **AssetPicker** — already required for KVP-102; must work for HTLC funding.
- **Swap screen** — create offer / take offer / show remaining blocks.
- **Activity feed** — surface HTLC state changes.
- **Secret manager** — safe storage of preimages until claim or expiry.
- **Notifications** — “your HTLC is claimable” / “timeout approaching”.

## 6. Explorer Integration Points

- Transaction detail: detect HTLC scripts and show human-readable status.
- Address view: list locked HTLC / vault UTXOs.
- Optional global “Open Swaps” page fed by the indexer.

## 7. Error Handling Guidelines

| Situation | Client behaviour |
|-----------|------------------|
| Prepare returns fee-floor error | Re-prepare with higher fee; never submit |
| Claim after timeout | Show clear “too late, use refund” message |
| Refund before timeout | Node rejects; show remaining blocks |
| Unknown asset_id | Refuse to build offer; require registry or explicit metadata |
| Counterparty script mismatch | Abort; do not fund |

## 8. Testing Against Public Testnet

1. Sync a local node or use public explorer API.
2. Obtain test KVNC from faucet (if open) or known test addresses.
3. Mint or use an existing non-KVNC test asset.
4. Run full fund → claim and fund → refund scenarios.
5. Record tip height, chosen timeout, and final txids.

## 9. Versioning

- Offer schema and CLI flags should carry an explicit version field.
- Breaking changes to offer format require a new version number; old offers simply expire.

---

**See also:** `DEFI-TECHNICAL-DESIGN.md`, `DEFI-HTLC-DEX.md`