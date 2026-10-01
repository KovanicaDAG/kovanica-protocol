# Kovanica NFT Integration Pack (KVP-106)

Documents created for native NFT support on the Kovanica Protocol.

## Files

| File | Purpose |
|------|---------|
| **RFC-007-KVP-106-NFT.md** | Formal design / draft standard (KVP-106) |
| **NFT-INTEGRATION-PLAN.md** | Phased delivery plan, milestones, risks, DoD |
| **NFT-API-AND-CLIENT-NOTES.md** | Concrete HTTP shapes, client checklist, metadata schema |
| **NFT-LEDGER-NOTES.md** | Ledger-safe Rust notes, validation rules, test matrix |

## Quick orientation

1. Read **RFC-007-KVP-106-NFT.md** for the protocol rules.
2. Follow **NFT-INTEGRATION-PLAN.md** for sequencing (Phase 0 → 4).
3. Implement ledger changes using **NFT-LEDGER-NOTES.md**.
4. Wire API + wallet with **NFT-API-AND-CLIENT-NOTES.md**.

## Dependencies

- **KVP-102** (multi-asset) must stay green; NFT is a constrained special case of it.
- Close the existing HTTP `asset_id` gap first (`KVP-102-HTTP-asset_id-gap.md`).
- RFC-006 maturity (100 blocks) and fee rules apply to NFT coinbases and transfers once activated.
- No testnet reset is required for KVP-106 itself.

## Status

- Design: Draft (ready for review)
- Implementation: Not started
- Recommended first PR: ledger `AssetKind` + max_supply=1 enforcement only

## Next concrete steps

1. Review & stabilise RFC-007 text.
2. Finish KVP-102 HTTP surface if still open.
3. Open `feature/kvp-106-nft-core` and land Phase 1 tests.
4. Then API (Phase 2) and web UX (Phase 3).
