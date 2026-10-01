# NFT Ledger Notes — kovanica-state (KVP-106)

Concrete guidance for the ledger-safe portion of RFC-007.

## 1. Minimal type changes

```rust
// Suggested location: kovanica-state (or the crate that owns AssetId / Utxo)

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssetKind {
    Fungible,
    NonFungible,
}

impl Default for AssetKind {
    fn default() -> Self {
        AssetKind::Fungible
    }
}

#[derive(Clone, Debug)]
pub struct AssetInfo {
    pub asset_id: AssetId,           // existing type (probably [u8; 32] or enum)
    pub kind: AssetKind,
    pub max_supply: u64,
    pub minted: u64,
    pub metadata_hash: Option<[u8; 32]>,
    pub collection_id: Option<[u8; 32]>,
    // optional: pub creator: Option<PublicKey>,
}
```

Native KVNC stays `AssetKind::Fungible` with its existing supply rules (subject to RFC-006 MAX_SUPPLY).

## 2. Validation rules to add

Inside the transaction / coinbase application path:

```text
for every output that carries an asset_id registered as NonFungible:
    require value == 1
    require that after this tx the circulating supply of that asset_id ≤ 1

for every coinbase that mints a new NonFungible asset:
    require max_supply == 1
    require minted becomes 1
    reject if asset_id already exists with minted == 1
```

Existing per-asset conservation checks from KVP-102 continue to apply; the NFT rules are additional constraints.

## 3. Checkpoint / snapshot impact

- If the asset registry is already serialised in checkpoints, extend the format with the new fields (`kind`, `metadata_hash`, `collection_id`).
- Prefer a backward-compatible extension (new version flag or optional fields) so old snapshots can still be loaded and treated as pure Fungible.
- Document the version bump the same way KVP-102 did for its checkpoint format.

## 4. Suggested test matrix (must-have)

| Test name | Intent |
|-----------|--------|
| `nft_mint_coinbase` | Coinbase creates a NonFungible asset with value 1 |
| `nft_transfer` | Spend the single UTXO to a new address; supply stays 1 |
| `nft_double_mint_rejected` | Second coinbase with same asset_id is rejected |
| `nft_split_rejected` | Transaction that tries to create two outputs of the same NFT is rejected |
| `nft_value_not_one_rejected` | Output with value ≠ 1 for NonFungible is rejected |
| `fungible_unaffected` | Existing multi-asset fungible tests still pass |
| `nft_immature_filtered` | After RFC-006 maturity rules, immature NFT coinbase is not selectable |

## 5. Coinbase construction sketch

```rust
// Conceptual only
fn build_nft_coinbase_output(
    asset_id: AssetId,
    metadata_hash: Option<[u8; 32]>,
    collection_id: Option<[u8; 32]>,
) -> TxOut {
    TxOut {
        value: 1,
        asset_id,
        // script / address of the recipient (creator or treasury etc.)
        // plus any extension fields the current TxOut type already supports
        ..
    }
    // Side-effect: register AssetInfo { kind: NonFungible, max_supply: 1, minted: 1, ... }
}
```

Exact field layout depends on the current `TxOut` and registry types in the monorepo; do not invent a parallel parallel structure.

## 6. What **not** to touch in Phase 1

- GHOSTDAG / blue-set / k parameter
- Fee calculation and burn rules (RFC-006)
- Sighash algorithm
- P2P messages
- Existing fungible asset_id generation

Keep the first PR strictly limited to the asset registry + validation so review stays focused.

## 7. Activation & compatibility

- Old nodes that do not understand `AssetKind::NonFungible` should treat unknown assets as non-standard or simply ignore the extra fields if the serialisation is designed to be extensible.
- Preferred approach: soft introduction — new fields are optional; a NonFungible asset is still a valid KVP-102 asset with max_supply=1 even if the kind flag is missing on very old software.
- No testnet reset is required for KVP-106.

## 8. Relation to other crates

| Crate | Expected work |
|-------|----------------|
| `kovanica-state` | Core types, validation, registry |
| `kovanica-node` | Expose kind / metadata via HTTP (Phase 2) |
| `kovanica-cli` | Later: `nft mint` / `nft send` helpers |
| `kovanica-ffi` | Later: surface NFT UTXOs to mobile |
| `web/` | Phase 3 UI |

## See also

- `RFC-007-KVP-106-NFT.md`
- `NFT-INTEGRATION-PLAN.md`
- `NFT-API-AND-CLIENT-NOTES.md`
- Existing KVP-102 code paths for asset registry and coinbase minting
