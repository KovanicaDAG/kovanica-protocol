# RFC-007 / KVP-106 — Native Non-Fungible Assets (NFT)

**Status:** Draft  
**Public name:** KVP-106 (Native NFT)  
**Depends on:** KVP-102 (RFC-002 multi-asset), RFC-006 tokenomics (maturity + fee rules)  
**Surfaces (planned):** `kovanica-state`, node HTTP API, web wallet/explorer, CLI

## Summary

Native non-fungible assets on the Kovanica UTXO ledger.  
An NFT is a specialised KVP-102 asset whose `max_supply = 1` and whose single unit is never divisible.  
Ownership is pure UTXO ownership; transfer is a normal spend.  
Metadata lives off-chain (IPFS / Arweave / HTTPS) with an optional on-chain commitment hash.

This is **not** an ERC-721 equivalent. There are no smart contracts, no account model, and no operator approvals. Everything stays inside the existing GHOSTDAG + UTXO + Ed25519 design.

## Design Principles

1. **Minimal consensus surface** — reuse KVP-102 `asset_id` and per-asset conservation.
2. **UTXO purity** — one UTXO = one NFT. No partial spends, no batching of the same NFT.
3. **Client-side metadata** — the ledger only stores a 32-byte commitment (optional).
4. **Fee & maturity compatibility** — after RFC-006 activation the normal 100-block coinbase maturity and fee-floor rules apply to NFT mints and transfers.
5. **Composable** — NFTs can later sit inside KVP-103 stealth addresses, KVP-104 HTLCs, or KVP-105 vaults.

## Core Rules

| Rule | Value / Behaviour |
|------|-------------------|
| Asset kind | `Fungible` (existing) \| `NonFungible` (new) |
| Max supply | Exactly `1` for every NFT asset |
| Value on UTXO | Always `1` (atom unit of the asset) |
| Asset ID | 32-byte identifier (see derivation below) |
| Minting | Coinbase output only (v1). Future: dedicated MintTx if needed |
| Transfer | Standard UTXO spend; input must be exactly the NFT UTXO |
| Burning | Spend to an unspendable script / null data (optional explicit burn path) |
| Metadata | Off-chain; optional `metadata_hash: [u8; 32]` stored with the asset registry entry |
| Collection | Optional 32-byte `collection_id` grouping multiple NFTs |

### Asset ID derivation (recommended)

```text
asset_id = blake3(
    0x01 ||                 // domain separator for NFT
    collection_id ||        // 32 bytes (or zeros if none)
    token_id                // 32 bytes (creator-chosen or sequential)
)
```

Alternative (simpler, less structured):

```text
asset_id = blake3(creator_pubkey || salt || token_id)
```

The derivation is **not** consensus-enforced; it is a client / indexer convention. Consensus only cares that the `asset_id` is unique and that supply never exceeds 1.

### Ledger state extension

```rust
// Conceptual — kovanica-state
pub enum AssetKind {
    Fungible,
    NonFungible,
}

pub struct AssetRegistryEntry {
    pub asset_id: [u8; 32],
    pub kind: AssetKind,
    pub max_supply: u64,               // must be 1 for NonFungible
    pub minted: u64,                   // 0 or 1
    pub metadata_hash: Option<[u8; 32]>,
    pub collection_id: Option<[u8; 32]>,
    pub creator: Option<[u8; 32]>,     // optional Ed25519 pubkey
}
```

Conservation rule (already present in KVP-102) is extended:

- For `NonFungible` assets the ledger rejects any transaction that would create a second unit or that would produce an output with `value != 1`.

## Minting Flow

1. Creator prepares metadata JSON (name, description, image URI, attributes, …).
2. Uploads to IPFS / Arweave → obtains CID / permanent URI.
3. Computes `metadata_hash = blake3(uri || extra_fields)`.
4. Submits a coinbase request (or waits for a miner) that includes:

```text
Coinbase output:
  asset_id        = derived NFT id
  value           = 1
  kind            = NonFungible
  metadata_hash   = <32 bytes>   // optional but recommended
  collection_id   = <32 bytes>   // optional
```

5. After the 100-block coinbase maturity window (RFC-006) the NFT becomes spendable.
6. Indexers / explorers resolve the metadata via the stored hash + off-chain lookup.

**Race condition note (GHOSTDAG):** two parallel coinbases could attempt the same `asset_id`. The first one that becomes blue and is linearised wins; the second is rejected by the supply rule. Clients should use high-entropy `token_id` or a sequential counter under a collection.

## Transfer Flow

Identical to any other KVP-102 asset transfer:

1. `POST /api/prepare` with the single NFT UTXO as input and a single output of `value = 1` to the recipient.
2. Sign the sighash offline (Ed25519).
3. `POST /api/submit`.

No special redeem script is required for a plain transfer. Advanced use-cases (royalties, secondary-sale locks, etc.) can later be built with KVP-103 scripts.

## HTTP API Surface (planned)

All existing KVP-102 endpoints gain an optional `kind` field.

| Endpoint | NFT-related additions |
|----------|-----------------------|
| `GET /api/utxos?address=` | Each UTXO may contain `"kind": "nft"`, `"metadata_hash"`, `"collection_id"` |
| `GET /api/history?address=` | Same fields on history entries |
| `GET /api/nft/{asset_id}` | New — returns registry entry + current owner UTXO (if any) |
| `GET /api/collection/{collection_id}` | New — list of known `asset_id`s belonging to the collection |
| `POST /api/prepare` | Accepts `"kind": "nft"`; coin selection refuses to split the UTXO |

Wire representation:

```json
{
  "asset_id": "a1b2c3…",
  "kind": "nft",
  "value": 1,
  "metadata_hash": "d4e5f6…",
  "collection_id": "0123…"
}
```

Native KVNC remains `"asset_id": "KVNC"`, `"kind": "fungible"`.

## Client Rules

1. Treat every NFT UTXO as atomic — never attempt to spend only part of it.
2. Always display the off-chain metadata when the hash is known; fall back to “unresolved” otherwise.
3. Prefer the official wallet / explorer for minting until the coinbase path is fully documented.
4. After RFC-006 activation, immature NFT coinbases are automatically filtered by `/api/utxos` and by the transaction builder.
5. Fees are always paid in KVNC (or another fungible asset); an NFT cannot pay its own fee.

## Composition with Existing KVPs

| Feature | How it composes |
|---------|-----------------|
| KVP-101 Multisig | NFT can be locked to an M-of-N P2SH address |
| KVP-103 Stealth | NFT can be sent to a stealth address |
| KVP-104 HTLC | Atomic swap of an NFT against KVNC or another asset |
| KVP-105 Vault | Time-locked NFT escrow / vesting |

## Out of Scope (v1)

- On-chain royalty enforcement
- Operator / approval model (ERC-721 style)
- On-chain metadata storage (too expensive and against UTXO philosophy)
- Fractional ownership (that would be a separate fungible asset backed by the NFT)
- Cross-chain bridges

## Activation

- Soft / opt-in: new asset kind is ignored by old nodes until they upgrade.
- No chain reset required (unlike RFC-006).
- Can ship independently of the tokenomics branch.

## Security Considerations

- Metadata hash collision resistance relies on BLAKE3.
- Creator key is not required for transfer; possession of the UTXO is ownership.
- Parallel mint races are resolved by GHOSTDAG linearisation + supply rule.
- Indexers must not trust unauthenticated off-chain metadata without verifying the hash.

## See also

- RFC-002 / KVP-102 — Native multi-asset tokens (foundation)
- RFC-006 — Tokenomics (maturity, fee floor)
- `NFT-INTEGRATION-PLAN.md` — phased delivery & DoD
- `KVP-102-HTTP-asset_id-gap.md` — prerequisite API work
