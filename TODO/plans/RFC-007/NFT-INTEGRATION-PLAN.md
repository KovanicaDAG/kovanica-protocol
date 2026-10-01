# NFT Integration Plan — Kovanica (KVP-106)

**Target standard:** RFC-007 / KVP-106  
**Foundation:** KVP-102 (already shipped in ledger)  
**Prerequisite:** Close KVP-102 HTTP `asset_id` gap (see `KVP-102-HTTP-asset_id-gap.md`)

## Layered Decomposition

| Layer | Scope | Risk | Notes |
|-------|-------|------|-------|
| **Consensus-safe** | Almost none for v1 | Low | Only soft validation of `AssetKind` |
| **Ledger-safe** | Asset registry, max_supply=1, kind flag | Medium | Must not break existing fungible assets |
| **Client-only** | API, wallet UI, explorer, indexers | Low | Can ship independently once ledger is ready |

## Recommended Sequencing

### Phase 0 — Prerequisites (do first)

| Task | Owner surface | Exit criteria |
|------|---------------|---------------|
| Land KVP-102 HTTP `asset_id` on `/api/utxos`, `/api/history`, `/api/prepare` | node HTTP | AssetPicker works for fungible tokens |
| Document current coinbase mint path for new assets | docs | Clear example of minting a fungible asset |
| Confirm RFC-006 maturity (100 blocks) behaviour on coinbase assets | tokenomics | Immature NFT mints correctly filtered |

**Do not start NFT work on a branch that also contains unfinished RFC-006 emission changes.** Keep branches clean.

### Phase 1 — Ledger Core (Ledger-safe)

**Branch suggestion:** `feature/kvp-106-nft-core`

| # | Task | Exit criteria |
|---|------|---------------|
| 1.1 | Add `AssetKind::{Fungible, NonFungible}` to asset registry | Compiles, existing tests green |
| 1.2 | Enforce `max_supply == 1` and `value == 1` for NonFungible | New unit tests pass; double-mint rejected |
| 1.3 | Optional `metadata_hash` + `collection_id` fields on registry entry | Checkpoint / snapshot format updated if needed |
| 1.4 | Coinbase path accepts the new fields | Can mint an NFT from a test coinbase |
| 1.5 | Regression: all existing KVP-102 fungible tests still pass | CI green |

**Definition of Done (Phase 1):**
- `cargo test -p kovanica-state` green
- Explicit test: mint NFT → transfer → attempt second mint of same `asset_id` → reject
- No change to GHOSTDAG or fee rules

### Phase 2 — HTTP API & Node Surface

**Branch suggestion:** `feature/kvp-106-nft-api` (can base on Phase 1 or main after merge)

| # | Task | Exit criteria |
|---|------|---------------|
| 2.1 | Extend UTXO / history JSON with `kind`, `metadata_hash`, `collection_id` | Spec + live responses match |
| 2.2 | `GET /api/nft/{asset_id}` | Returns registry + current owner (or 404) |
| 2.3 | `GET /api/collection/{collection_id}` | Returns list of asset_ids (may be empty) |
| 2.4 | `prepare` refuses to split an NFT UTXO | Clear error message |
| 2.5 | Update `/api/spec` | Documented |

**Definition of Done (Phase 2):**
- Curl / integration tests against local node pass
- Web can display “NFT” badge on UTXOs that carry `kind: "nft"`

### Phase 3 — Wallet & Explorer UX (Client-only)

| # | Task | Exit criteria |
|---|------|---------------|
| 3.1 | AssetPicker / balance list shows NFT separately from fungible | Clear visual distinction |
| 3.2 | NFT detail page (resolve metadata via hash + off-chain fetch) | Image + name + attributes visible when metadata available |
| 3.3 | Send NFT flow (single UTXO → single recipient) | End-to-end transfer works |
| 3.4 | Mint helper UI (optional, advanced) | Creator can request a coinbase mint with metadata hash |
| 3.5 | Collection view | List of NFTs under a collection_id |

### Phase 4 — Advanced Composition (later)

- NFT inside multisig (KVP-101)
- Stealth NFT receive (KVP-103)
- NFT ↔ KVNC atomic swap via HTLC (KVP-104)
- Time-locked NFT vault (KVP-105)
- Indexer service / GraphQL for marketplaces

## Risk Register (NFT-specific)

| Risk | Mitigation |
|------|------------|
| Parallel mint of same `asset_id` under GHOSTDAG | High-entropy token_id + supply rule; first blue linearised wins |
| Metadata disappearance (off-chain) | Store permanent URI schemes (IPFS, Arweave); hash on-chain |
| Accidental fungible treatment of NFT | Explicit `kind` check in prepare + wallet |
| Branch pollution with RFC-006 | Separate feature branches; no mixed PRs |
| Immature NFT shown as spendable | Rely on existing maturity filter (RFC-006) |
| Fee paid with NFT | Forbidden; fee always in fungible asset (KVNC) |

## Milestone Table

| Milestone | Goal | Exit criteria | Depends on |
|-----------|------|---------------|------------|
| M0 | KVP-102 HTTP complete | AssetPicker fungible works | — |
| M1 | Ledger NFT core | Can mint + transfer + reject double-mint in tests | M0 (practical) |
| M2 | Node API | `/api/nft/...` + kind fields live | M1 |
| M3 | Wallet UX | User can send/receive NFT with metadata preview | M2 |
| M4 | Composition | At least one of multisig / HTLC / stealth NFT demo | M3 |

## Suggested Commit / PR Strategy

```
main
 ├── api/kvp-102-asset-id          ← finish this first (already planned)
 ├── feature/kvp-106-nft-core      ← Phase 1
 └── feature/kvp-106-nft-api      ← Phase 2 (after core merges)
      └── web: NFT UI             ← Phase 3
```

Keep RFC-006 tokenomics work on its own long-running branch. NFT does **not** require a testnet reset.

## Immediate Next Actions

1. Confirm KVP-102 HTTP gap status and close it if still open.
2. Open draft PR for `AssetKind` + max_supply enforcement only (Phase 1.1–1.2).
3. Write the formal RFC-007 text (already provided in `RFC-007-KVP-106-NFT.md`) and circulate for review.
4. Decide whether metadata_hash is mandatory or optional in v1 (recommendation: optional).

## Related Documents

- `RFC-007-KVP-106-NFT.md` — full design
- `NFT-API-AND-CLIENT-NOTES.md` — concrete API shapes + client checklist
- `KVP-102-HTTP-asset_id-gap.md` — prerequisite
- `RFC-006-CLOSE-GAPS.md` / `TESTNET-RFC006.md` — maturity & fee context
