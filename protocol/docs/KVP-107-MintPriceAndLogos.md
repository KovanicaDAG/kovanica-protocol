# KVP-107: Mint Price & Asset Logos

**Status**: Draft  
**Authors**: Kovanica Protocol Team  
**Created**: 2026-10-02  
**Requires**: KVP-102 (RFC-002) Native Tokens, RFC-006 Tokenomics  
**Supersedes**: —  

---

## Abstract

This KVP extends KVP-102 native assets with two features:

1. **Mint Price** — A configurable KVNC fee paid per unit when minting new supply of an asset, enforced by consensus.
2. **Asset Logo & Extended Metadata** — On-chain commitments to a logo image URI and extended metadata (name, symbol, decimals, description, website, social links) with integrity verification via content hashes.

Both features are **activation-gated** by blue score (following the pattern of KVP-101 through KVP-105) and require a new checkpoint format version (v11).

---

## Motivation

### Mint Price
- **Spam prevention**: Free asset creation enables spam/malicious tokens.
- **Economic alignment**: Mint fees follow RFC-006 economics (75% burned / 25% to block producer).
- **Revenue for security**: Fees contribute to network sustainability.
- **Flexible pricing**: Creators set per-unit mint price at creation.

### Asset Logos & Metadata
- **Decentralized discovery**: Wallets/explorers display logos without centralized registries.
- **Integrity**: Content hashes prevent silent logo/metadata swaps (rug-pull protection).
- **Extensibility**: Structured metadata supports name, symbol, decimals, description, website, social links.
- **Interoperability**: Standard URI schemes (IPFS, Arweave, HTTPS) work with existing infrastructure.

---

## Specification

### Constants

```rust
/// Base fee to register a new asset (1000 KVNC = 100_000_000_000 atoms)
pub const ASSET_CREATION_FEE: u64 = 1000 * ATOM;

/// Minimum mint price per unit (1 atom KVNC per base unit)
pub const MIN_MINT_PRICE: u64 = 1;

/// Maximum mint price per unit (1 KVNC per base unit = 100_000_000 atoms)
pub const MAX_MINT_PRICE: u64 = 1 * ATOM;

/// Activation threshold for mint price enforcement
pub const MINT_PRICE_ACTIVATION_SCORE: u64 = 0;

/// Activation threshold for asset logo/metadata
pub const ASSET_LOGO_ACTIVATION_SCORE: u64 = 0;
```

### New Types

#### `LogoScheme`
```rust
enum LogoScheme {
    Ipfs = 0,      // ipfs://Qm... or ipfs://bafy...
    Arweave = 1,   // ar://txid or https://arweave.net/txid
    Https = 2,     // traditional web hosting
    Data = 3,      // base64-encoded inline (max 1KB decoded)
}
```

#### `MetadataScheme`
```rust
enum MetadataScheme {
    Ipfs = 0,
    Arweave = 1,
    Https = 2,
}
```

#### `LogoUri`
```rust
struct LogoUri {
    scheme: LogoScheme,
    content_hash: [u8; 32],  // BLAKE3 of image bytes
    uri: String,             // max 256 bytes
}
```

#### `MetadataUri`
```rust
struct MetadataUri {
    scheme: MetadataScheme,
    content_hash: [u8; 32],  // BLAKE3 of JSON bytes
    uri: String,             // max 256 bytes
}
```

### Extended `AssetRegistryEntry`

```rust
struct AssetRegistryEntry {
    asset_id: AssetId,
    kind: AssetKind,
    max_supply: u64,
    minted: u64,
    metadata_hash: Option<[u8; 32]>,      // legacy
    collection_id: Option<[u8; 32]>,      // NFT collections
    creator: Option<[u8; 32]>,            // Ed25519 pubkey
    // NEW FIELDS (KVP-107):
    mint_price_per_unit: u64,             // atoms KVNC per base unit (0 = free)
    logo_uri: Option<LogoUri>,
    metadata_uri: Option<MetadataUri>,
}
```

### Off-Chain Metadata JSON Schema

The `metadata_uri` points to a JSON document with this structure:

```json
{
  "name": "MyToken",
  "symbol": "MTK",
  "decimals": 8,
  "description": "A utility token for...",
  "website": "https://mytoken.io",
  "social": {
    "twitter": "https://twitter.com/mytoken",
    "discord": "https://discord.gg/mytoken",
    "github": "https://github.com/mytoken"
  },
  "logo": {
    "uri": "ipfs://Qm...",
    "content_hash": "0x...",
    "mime_type": "image/svg+xml",
    "width": 512,
    "height": 512
  }
}
```

The `metadata_hash` field in `AssetRegistryEntry` (legacy) and the `content_hash` in `MetadataUri` both equal `BLAKE3(JSON_bytes)`.

### Asset Creation

**Asset ID Derivation** (deterministic, collision-resistant):
```
asset_id = BLAKE3("KVP107-ASSET" || creator_pk || nonce || creation_params_hash)
```
Where `creation_params_hash = BLAKE3(max_supply || kind || mint_price || logo_uri || metadata_uri)`.

**Creation Transaction** (coinbase):
- Must pay `ASSET_CREATION_FEE` (1000 KVNC) in KVNC inputs
- Fee split: 75% burned / 25% to block producer (per RFC-006)
- Registers asset in `asset_registry` with all fields
- `mint_price_per_unit` must be in `[MIN_MINT_PRICE, MAX_MINT_PRICE]` or 0 (free)

### Minting (Post-Creation)

**Mint Transaction** (regular transaction):
- Creates new outputs with the asset_id (output amount > input amount for that asset)
- Must include KVNC fee inputs ≥ `mint_price_per_unit × amount_minted`
- KVNC fee split: 75% burned / 25% to block producer
- Enforced in `apply_regular` when `blue_score > MINT_PRICE_ACTIVATION_SCORE`

**Pre-activation behavior** (`blue_score ≤ activation_score`):
- `mint_price_per_unit` ignored (free minting, legacy behavior)
- Logo/metadata fields optional but stored if provided

### Consensus Rules

1. **Asset creation** requires `ASSET_CREATION_FEE` KVNC (burned 75%/producer 25%)
2. **Mint price enforcement** (post-activation):
   - For each asset where `outputs > inputs`: `required_fee = (outputs - inputs) × mint_price_per_unit`
   - Transaction's KVNC fee (native_in - native_out) must ≥ `required_fee`
   - Violation → `LedgerError::InsufficientMintFee`
3. **Mint price bounds**: `mint_price_per_unit ∈ [MIN_MINT_PRICE, MAX_MINT_PRICE]` or 0
4. **URI size limits**: `logo_uri.uri ≤ 256 bytes`, `metadata_uri.uri ≤ 256 bytes`
5. **Data URI payload**: `LogoScheme::Data` decoded payload ≤ 1024 bytes
6. **Content hash integrity**: Wallets SHOULD verify `BLAKE3(fetched_content) == content_hash`

### Checkpoint Format (v11)

Checkpoint version bumped to **11**. Asset registry encoding per entry:

```
asset_id (32 bytes)
kind (1 byte: 0=Fungible, 1=NonFungible)
max_supply (u64 LE)
minted (u64 LE)
mint_price_per_unit (u64 LE)              // NEW v11
metadata_hash (1+32 or 1 byte)            // flag + optional hash
collection_id (1+32 or 1 byte)
creator (1+32 or 1 byte)
logo_uri (1+1+32+8+uri_len or 1 byte)     // NEW v11: flag + scheme + hash + len + uri
metadata_uri (1+1+32+8+uri_len or 1 byte) // NEW v11: flag + scheme + hash + len + uri
```

**Backward compatibility**: v3..=v10 checkpoints decode successfully; new fields default to 0/None.

### Activation

- `MINT_PRICE_ACTIVATION_SCORE` and `ASSET_LOGO_ACTIVATION_SCORE` default to 0
- Testnet: set via `Ledger::set_mint_price_activation_score()` at agreed blue score
- Mainnet: set in genesis config
- No chain reset required (backward compatible — pre-activation mints are free)

---

## Rationale

### Why per-unit mint price (not flat fee)?
- Scales with supply: large mints pay proportionally more
- Predictable cost for users: `cost = amount × price_per_unit`
- Compatible with bonding curves (future extension)

### Why KVNC for mint fees (not the asset itself)?
- RFC-006 fee economics require native KVNC fees
- Prevents circular dependency (paying mint fee in the asset being minted)
- Aligns with "fees paid in native only" rule (KVP-102)

### Why content hashes for logos/metadata?
- On-chain storage of images/JSON is prohibitive
- Content hash commits to immutable content without storing it
- IPFS/Arweave provide content-addressed storage natively
- Prevents silent rug-pulls (logo swap after trust established)

### Why activation gating?
- Follows established pattern (KVP-101..105)
- Allows coordinated network upgrade
- Pre-activation behavior = free minting (no disruption)

---

## Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| Pre-activation mint | Free (mint_price_per_unit ignored) |
| Asset created pre-KVP-107 | `mint_price_per_unit = 0`, no logo/metadata |
| Old checkpoint (v3..=v10) | Decodes with new fields defaulted to 0/None |
| Old node reading v11 checkpoint | Fails (version 11 > max supported) — expected |

---

## Test Vectors

### Asset Creation
```
creator_pk: 0x4242... (32 bytes)
nonce: 1
max_supply: 1_000_000_000_000 (1M with 6 decimals)
kind: Fungible (0)
mint_price_per_unit: 100_000 (0.001 KVNC per unit)
logo_uri: { scheme: 0 (IPFS), content_hash: 0xAA..., uri: "ipfs://QmX..." }
metadata_uri: { scheme: 0 (IPFS), content_hash: 0xBB..., uri: "ipfs://QmY..." }
creator_pk: 0xCC...

asset_id = BLAKE3("KVP107-ASSET" || creator_pk || nonce_le || params_hash)
```

### Mint Fee Calculation
```
Asset: MTK, mint_price = 100_000 atoms KVNC per base unit
User mints: 1_000_000 MTK (10^6 base units, 6 decimals = 1 MTK)
Required KVNC fee: 1_000_000 × 100_000 = 100_000_000_000 atoms = 1_000 KVNC
Fee split: 750 KVNC burned, 250 KVNC to block producer
```

---

## Implementation Plan

### Phase 1: Core Types & Encoding ✓
- [x] `LogoScheme`, `MetadataScheme`, `LogoUri`, `MetadataUri` in `tx.rs`
- [x] Extended `AssetRegistryEntry` with new fields
- [x] Checkpoint v11 encoding/decoding in `ledger.rs`
- [x] Export new types from `lib.rs`
- [x] Update `CHECKPOINT_VERSION = 11`

### Phase 2: Ledger Rules ✓
- [x] Add `MINT_PRICE_ACTIVATION_SCORE`, `ASSET_LOGO_ACTIVATION_SCORE` constants
- [x] Add activation score fields to `Ledger` struct
- [x] Add `InsufficientMintFee` error variant
- [x] Implement mint price enforcement in `apply_regular`
- [x] Implement asset creation fee in `apply_coinbase`
- [x] Add setters/getters for activation scores

### Phase 3: Structural Validation ✓
- [x] Validate URI size limits in `validate_tx_structure`
- [x] Validate mint price bounds (MIN/MAX)

### Phase 4: Node & RPC ✓
- [x] `Node::prepare_create_asset()` — builds creation tx with fee
- [x] `Node::prepare_mint_asset()` — builds mint tx with KVNC fee
- [x] RPC: `POST /api/asset/create/prepare`, `/api/asset/mint/prepare`
- [x] FFI bindings in `kovanica-ffi`

### Phase 5: Tests ✓
- [x] Unit tests for new types
- [x] Consensus tests: mint price enforcement, asset creation
- [x] Node integration tests: full create→mint→transfer flow

### Phase 6: Documentation ✓
- [x] This KVP document
- [x] Update `AGENTS.md` with new constants
- [x] Explorer web UI: display logos from URIs

---

## Security Considerations

1. **Mint price griefing**: Cap at `MAX_MINT_PRICE` (1 KVNC/unit) prevents extortionate prices
2. **Logo URI spam**: 256-byte limit enforced in structural validation
3. **Content mutation**: `content_hash` commits to immutable content; wallets must verify
4. **Activation fork risk**: Blue-score gating ensures synchronized activation
5. **Fee estimation**: Node `min_fee()` should include mint price estimate for UX

---

## Future Extensions

- **Dynamic mint price**: Bonding curve (price increases with supply) via script v2
- **Royalty fees**: Creator earns % on secondary transfers (requires script v2)
- **Verified assets**: On-chain attestation from known entities
- **Metadata updates**: Governance-gated metadata URI updates

---

## References

- [KVP-102 / RFC-002] Native Tokens
- [RFC-006] Tokenomics (emission, cap, maturity, fee burn)
- [KVP-106 / RFC-007] NFTs (AssetKind::NonFungible)
- [KVP-101] Multisig (activation gating pattern)
- [RFC-005] Vault/CSV (checkpoint versioning pattern)