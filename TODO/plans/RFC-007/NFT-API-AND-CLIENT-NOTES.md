# NFT API & Client Notes (KVP-106)

Companion to `RFC-007-KVP-106-NFT.md` and `NFT-INTEGRATION-PLAN.md`.

## 1. Canonical JSON shapes

### UTXO entry (extended)

```json
{
  "tx": "…",
  "index": 0,
  "value": 1,
  "asset_id": "a1b2c3d4e5…",
  "kind": "nft",
  "metadata_hash": "f6e5d4c3…",
  "collection_id": "01234567…"
}
```

- `kind` is `"nft"` or `"fungible"` (default `"fungible"` for backward compatibility).
- `metadata_hash` and `collection_id` are optional; omit or `null` when absent.
- For native KVNC: `"asset_id": "KVNC"`, `"kind": "fungible"`.

### `/api/utxos?address=…` response (conceptual)

```json
{
  "address": "…",
  "balances": {
    "KVNC": 1500000000,
    "a1b2c3…": 1
  },
  "nfts": [
    {
      "asset_id": "a1b2c3…",
      "tx": "…",
      "index": 0,
      "metadata_hash": "…",
      "collection_id": "…"
    }
  ],
  "utxos": [ /* all spendable UTXOs including NFTs */ ]
}
```

`nfts` is a convenience array; clients can also filter `utxos` by `kind === "nft"`.

### `GET /api/nft/{asset_id}`

```json
{
  "asset_id": "a1b2c3…",
  "kind": "nft",
  "max_supply": 1,
  "minted": 1,
  "metadata_hash": "f6e5…",
  "collection_id": "0123…",
  "creator": "ed25519-pubkey-hex-or-null",
  "owner": {
    "address": "…",
    "tx": "…",
    "index": 0
  }
}
```

If the NFT is currently burned or not yet minted: `"owner": null`.

### `GET /api/collection/{collection_id}`

```json
{
  "collection_id": "0123…",
  "assets": [
    { "asset_id": "a1b2…", "metadata_hash": "…", "owner_address": "…" },
    { "asset_id": "b2c3…", "metadata_hash": "…", "owner_address": null }
  ]
}
```

## 2. Prepare / Submit rules for NFTs

**Request (prepare):**

```json
{
  "inputs": [
    { "tx": "…", "index": 0 }
  ],
  "outputs": [
    {
      "address": "recipient…",
      "value": 1,
      "asset_id": "a1b2c3…",
      "kind": "nft"
    }
  ],
  "fee_asset": "KVNC"
}
```

**Server behaviour:**

- Reject if any input NFT UTXO is split (value on output must stay 1 and only one output may carry that `asset_id`).
- Reject if fee is attempted from an NFT asset.
- Fee is always taken from a fungible asset (normally KVNC).
- Sighash construction remains the same as today (Ed25519, 64-byte signature).

## 3. Client checklist (wallet / dApp)

- [ ] Always treat balances as `Map<asset_id, amount>`.
- [ ] Never show an NFT as “0.00000001” of a fungible token.
- [ ] When `kind === "nft"`, render a card / badge, not a decimal balance.
- [ ] Resolve `metadata_hash` → off-chain JSON (IPFS gateway, Arweave, or HTTPS). Cache aggressively.
- [ ] If metadata cannot be resolved, show “Unresolved NFT” + short asset_id.
- [ ] Send flow: select one NFT UTXO → one recipient → pay fee in KVNC.
- [ ] After RFC-006: trust the node’s maturity filter; do not try to spend immature coinbase NFTs.
- [ ] Prefer official `/api/prepare` over local coin selection until you fully re-implement per-asset selection.

## 4. Off-chain metadata recommendation

Suggested minimal JSON schema (not consensus):

```json
{
  "name": "Kovanica Genesis #001",
  "description": "…",
  "image": "ipfs://bafy…",
  "external_url": "https://…",
  "attributes": [
    { "trait_type": "Rarity", "value": "Legendary" }
  ],
  "collection": {
    "id": "0123…",
    "name": "Kovanica Genesis"
  }
}
```

`metadata_hash = blake3(canonical_json_bytes)` or `blake3(uri)`.  
Document the exact hashing rule in the final RFC so indexers stay consistent.

## 5. Indexer / Marketplace notes

- Primary key: `asset_id`.
- Secondary indexes: `collection_id`, `owner_address`, `metadata_hash`.
- Listen to new blocks → detect coinbase outputs with `kind = nft` → insert into registry.
- On every spend of an NFT UTXO → update owner.
- Never trust a marketplace listing that does not match the current on-chain owner UTXO.

## 6. Rust client sketch (conceptual)

```rust
// Highly simplified — real code lives in kovanica-cli / future SDK
pub struct NftUtxo {
    pub outpoint: OutPoint,
    pub asset_id: [u8; 32],
    pub metadata_hash: Option<[u8; 32]>,
    pub collection_id: Option<[u8; 32]>,
}

pub fn prepare_nft_transfer(
    nft: &NftUtxo,
    to: &Address,
    fee_utxos: &[Utxo],          // must be fungible / KVNC
    fee_rate: u64,
) -> Result<UnsignedTx> {
    // 1. Build single NFT output
    // 2. Select fee inputs from fee_utxos
    // 3. Call node /api/prepare or local builder
    // 4. Return sighash for offline Ed25519 signing
    todo!()
}
```

## 7. Error codes (suggested)

| Code | Meaning |
|------|---------|
| `nft_split_forbidden` | Attempted to create output value ≠ 1 or multiple outputs for same NFT |
| `nft_already_minted` | Coinbase tried to mint an asset_id that already has supply 1 |
| `nft_fee_forbidden` | Fee was requested from a non-fungible asset |
| `nft_immature` | Tried to spend a coinbase NFT before maturity |

These can be plain strings in the existing error response shape until a formal error catalogue is introduced.
