# RWA Technical Design — Kovanica Protocol

**Document:** RWA-TECHNICAL-DESIGN  
**Related RFC:** RFC-007 / KVP-106  
**Date:** 2026-09-17  

## 1. Overview

This document translates the RFC-007 requirements into concrete technical decisions for the Kovanica monorepo (`kovanica-protocol`) and client surfaces.

## 2. Asset Identifier Derivation

```rust
use blake2::{Blake2b512, Digest};
use sha2::{Sha256, Digest as _};

/// Deterministic asset_id for KVP-106 RWA tokens
pub fn derive_rwa_asset_id(
    issuer: &[u8; 32],          // Ed25519 public key
    asset_class: &str,          // "RE", "BOND", "INVOICE", ...
    unique_id: &str,            // issuer-chosen unique string
    version: u8,                // currently 1
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"KVP106-RWA");
    hasher.update(issuer);
    hasher.update(asset_class.as_bytes());
    hasher.update(unique_id.as_bytes());
    hasher.update(&[version]);
    let result = hasher.finalize();
    let mut id = [0u8; 32];
    id.copy_from_slice(&result);
    id
}
```

**Rules:**
- Never use `asset_id = [0u8; 32]` for RWA.
- Same inputs must always produce the same `asset_id`.
- Issuers SHOULD publish the exact parameters used for derivation.

## 3. Mint Authorization Options

### Option A — Convention only (fastest, recommended for MVP)
- Anyone can create a new `asset_id` (KVP-102 already allows this via coinbase or special outputs).
- Social / off-chain convention: only the issuer listed in metadata is considered legitimate.
- Explorer and indexers filter by known good issuers.

**Pros:** Zero consensus change.  
**Cons:** Possible spam assets.

### Option B — Script-enforced issuer
- Mint outputs must be accompanied by a signature from the issuer key that is embedded in the `asset_id` derivation.
- Can be implemented as a new standard script template (similar to P2SH).

### Option C — On-chain minter registry
- Small UTXO or checkpoint field that lists authorized `(asset_id, minter_script)` pairs.
- Highest security, highest complexity.

**Recommendation for Phase 1:** Option A.  
Move to Option B in Phase 2 if spam becomes a problem.

## 4. Transaction Patterns

### 4.1 Issue (Mint)
```
Inputs:  (funding UTXOs in KVNC for fees)
Outputs:
  - RWA tokens (new asset_id, amount = total_supply) → issuer or distribution addresses
  - Change in KVNC
```

### 4.2 Transfer
Standard multi-asset transfer.  
`prepare` must select UTXOs of the correct `asset_id`.

### 4.3 Burn / Redeem
```
Inputs:  RWA UTXOs
Outputs:
  - (optional) OP_RETURN or unspendable script with burn marker
  - or simply omit the RWA amount (if ledger allows explicit burn)
```

Until an explicit burn opcode exists, the practical approach is:
- Send to a well-known unspendable script (`OP_RETURN` + burn tag) or
- Send to a burn address whose private key is provably discarded.

## 5. Metadata & Discovery

### On-chain
- Only `asset_id` and supply live in the UTXO set.
- Optional: future checkpoint field for “well-known assets”.

### Off-chain (required for usability)
- IPFS / Arweave JSON (schema in RFC-007)
- Optional centralized indexer for search & filtering
- Explorer resolves `ipfs://` or `ar://` links

### Suggested HTTP additions (client / indexer)
```
GET /api/rwa/{asset_id}          → metadata + supply + issuer
GET /api/rwa?issuer=...          → list
GET /api/rwa?class=REAL_ESTATE   → filtered
```

These can live in a separate indexer service; the core node does not need to know about them.

## 6. Wallet Integration Points

1. **AssetPicker** — already planned for KVP-102; must support RWA badges.
2. **Issue screen** — form: name, symbol, class, total supply, legal URI → derive `asset_id` → build mint tx.
3. **Redeem screen** — select RWA UTXOs → burn → show burn txid for issuer.
4. **Balance view** — group by `asset_id`, show symbol from metadata cache.

## 7. Explorer Integration Points

- Badge “RWA” next to non-KVNC assets that match the derivation prefix or known registry.
- Asset detail page: supply, holders, metadata, legal documents.
- Transaction view: clearly show which outputs are RWA.

## 8. CLI Surface (proposed)

```bash
# Derive asset_id
kovanica-cli rwa derive --issuer <pubkey> --class RE --id "tower-12a"

# Issue (mint)
kovanica-cli rwa issue \
  --asset-id <id> \
  --amount 100 \
  --metadata ipfs://... \
  --to <address>

# Burn
kovanica-cli rwa burn --asset-id <id> --amount 5

# Inspect
kovanica-cli rwa info <asset_id>
```

## 9. Testing Strategy

| Level | What to test |
|-------|--------------|
| Unit | `derive_rwa_asset_id` determinism |
| Ledger | Conservation still holds after mint + transfer + burn |
| Integration | Full issue → transfer → burn flow on local node |
| Testnet | Public demo asset + explorer visibility |
| Security | Attempt unauthorized mint (should be rejected or socially ignored) |

## 10. Migration Notes

- No existing KVP-102 assets break.
- RWA is purely additive.
- Once Option B or C is activated, old free-minted assets remain valid but may be marked “unverified” in explorers.

## 11. Open Implementation Decisions

1. Exact burn mechanism (unspendable script vs future opcode).
2. Whether core node should ever validate issuer signatures for mint (or leave it to indexers).
3. Decimal handling convention (0 vs 8).
4. Whether to reserve a namespace of `asset_id` prefixes for official RWA classes.

---

**See also:**
- `RFC-007-RWA-INTEGRATION.md`
- `RWA-PROJECT-PLAN.md`
- `RWA-CHECKLIST.md`