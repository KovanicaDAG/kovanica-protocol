# KVP-102 Extension: Mint Price & Asset Logos

**Status**: Draft  
**Consensus Impact**: consensus-safe (new consensus rules, activation-gated)  
**Layer**: ledger  
**Depends on**: KVP-102 (RFC-002) native tokens, RFC-006 tokenomics

---

## Summary

Add two features to KVP-102 native assets:

1. **Mint Price** — A configurable KVNC fee paid when minting new supply of an asset (burned or sent to treasury)
2. **Asset Logo/Metadata** — On-chain commitment to a logo/image URI and extended metadata (name, symbol, decimals, description, website, social links)

Both features are **activation-gated** by blue score (like RFC-001…005) and require a new RFC/KVP number (e.g., **KVP-107**).

---

## 1. Mint Price Design

### 1.1 Rationale

- Prevent spam asset creation
- Align with RFC-006 fee economics (75% burn / 25% producer)
- Provide revenue for network security
- Configurable per-asset at creation time

### 1.2 Mechanics

**Mint Transaction Structure** (new transaction type or flag):

```rust
// In a regular transaction (non-coinbase), minting new asset supply requires:
// - An explicit "mint" output with the new asset_id
// - A KVNC fee input ≥ mint_price * amount_minted
// - The mint_price is stored in AssetRegistryEntry at asset creation
```

**Asset Creation (First Mint)**:
- The first transaction that creates an asset (outputs with new `asset_id`) pays a **creation fee** = `base_creation_fee` (protocol constant, e.g., 1000 KVNC = 100_000_000_000 atoms)
- The creator sets `mint_price_per_unit` (atoms of KVNC per base unit of asset) in the transaction
- Creation fee is **burned** (75%) / **producer** (25%) per RFC-006 fee split

**Subsequent Mints**:
- Each mint transaction must include KVNC inputs ≥ `mint_price_per_unit * amount_minted`
- The KVNC fee is **burned** (75%) / **producer** (25%)
- Enforced in `apply_regular` during per-asset conservation check

### 1.3 Constants

```rust
/// Base fee to register a new asset (1000 KVNC = 100_000_000_000 atoms)
pub const ASSET_CREATION_FEE: u64 = 1000 * ATOM;

/// Minimum mint price per unit (1 atom KVNC per base unit)
pub const MIN_MINT_PRICE: u64 = 1;

/// Maximum mint price per unit (1 KVNC per base unit = 100_000_000 atoms)
pub const MAX_MINT_PRICE: u64 = 1 * ATOM;
```

### 1.4 Activation Gating

```rust
pub const MINT_PRICE_ACTIVATION_SCORE: u64 = 0; // configurable
// Pre-activation: mint price = 0 (legacy behavior)
// Post-activation: mint price enforced
```

---

## 2. Asset Logo & Extended Metadata Design

### 2.1 Rationale

- Wallets/explorers need logos without centralized registries
- On-chain commitment prevents rug-pulls (logo can't be swapped silently)
- Extensible for future metadata standards

### 2.2 On-Chain Data Structure

Extend `AssetRegistryEntry` (in `tx.rs`):

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AssetRegistryEntry {
    pub asset_id: AssetId,
    pub kind: AssetKind,
    pub max_supply: u64,
    pub minted: u64,
    pub metadata_hash: Option<[u8; 32]>,      // existing: BLAKE3 of off-chain JSON
    pub collection_id: Option<[u8; 32]>,     // existing: for NFTs
    pub creator: Option<[u8; 32]>,           // existing: Ed25519 pubkey
    // NEW FIELDS:
    pub mint_price_per_unit: u64,            // atoms KVNC per base unit (0 = free)
    pub logo_uri: Option<LogoUri>,           // on-chain logo commitment
    pub metadata_uri: Option<MetadataUri>,   // extended metadata (name, symbol, etc.)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LogoUri {
    /// URI scheme: "ipfs", "arweave", "https", "data"
    pub scheme: LogoScheme,
    /// Content hash (BLAKE3 of the image bytes) — for integrity verification
    pub content_hash: [u8; 32],
    /// URI string (max 256 bytes)
    pub uri: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogoScheme {
    Ipfs = 0,
    Arweave = 1,
    Https = 2,
    Data = 3,      // base64-encoded inline (for tiny logos < 1KB)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MetadataUri {
    pub scheme: MetadataScheme,
    pub content_hash: [u8; 32],
    pub uri: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MetadataScheme {
    Ipfs = 0,
    Arweave = 1,
    Https = 2,
}
```

### 2.3 Off-Chain Metadata JSON Schema (IPFS/Arweave)

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

The `metadata_hash` field in `AssetRegistryEntry` is `BLAKE3(JSON_bytes)`.

### 2.4 Size Limits

- `LogoUri.uri`: max 256 bytes
- `MetadataUri.uri`: max 256 bytes
- `LogoScheme::Data` payload: max 1024 bytes (base64 decoded)
- Total on-chain metadata per asset: ~600 bytes max

---

## 3. Transaction Format Changes

### 3.1 Asset Creation Transaction

A new transaction type or extended coinbase/regular transaction:

```rust
/// Asset creation parameters (included in transaction tag or as a special output)
pub struct AssetCreation {
    pub asset_id: AssetId,                    // derived from creator_pk + nonce
    pub max_supply: u64,
    pub kind: AssetKind,
    pub mint_price_per_unit: u64,             // atoms KVNC per base unit
    pub logo_uri: Option<LogoUri>,
    pub metadata_uri: Option<MetadataUri>,
    pub creator: [u8; 32],                    // Ed25519 pubkey
}
```

**Asset ID Derivation** (deterministic, collision-resistant):
```
asset_id = BLAKE3("KVP107-ASSET" || creator_pk || nonce || creation_params_hash)
```

Where `creation_params_hash = BLAKE3(max_supply || kind || mint_price || logo_uri || metadata_uri)`

### 3.2 Mint Transaction

Regular transaction with:
- Inputs: KVNC (for mint fee) + optionally existing asset UTXOs
- Outputs: New asset units (with the asset_id) + change
- Fee: KVNC fee ≥ `mint_price_per_unit * amount_minted` (enforced by ledger)

---

## 4. Ledger Changes

### 4.1 `AssetRegistryEntry` Extensions (tx.rs)

```rust
impl AssetRegistryEntry {
    pub fn new_fungible_with_mint_price(
        asset_id: AssetId,
        max_supply: u64,
        mint_price_per_unit: u64,
        logo_uri: Option<LogoUri>,
        metadata_uri: Option<MetadataUri>,
        creator: Option<[u8; 32]>,
    ) -> Self {
        Self {
            asset_id,
            kind: AssetKind::Fungible,
            max_supply,
            minted: 0,
            metadata_hash: None, // computed from metadata_uri content
            collection_id: None,
            creator,
            mint_price_per_unit,
            logo_uri,
            metadata_uri,
        }
    }
    
    // ... similar for NFT
}
```

### 4.2 `apply_regular` Changes (ledger.rs)

Add mint price enforcement after per-asset conservation check:

```rust
// In apply_regular, after asset conservation (line ~1360):

// Check mint price for assets being minted (output > input for an asset)
for (asset_id, out_val) in &asset_outputs {
    let in_val = asset_inputs.get(asset_id).copied().unwrap_or(0);
    if *out_val > in_val {
        // This asset is being minted
        let minted_amount = out_val - in_val;
        
        if let Some(entry) = asset_registry.get(asset_id) {
            if entry.mint_price_per_unit > 0 && blue_score > mint_price_activation_score {
                let required_fee = minted_amount
                    .checked_mul(entry.mint_price_per_unit)
                    .ok_or(LedgerError::ValueOverflow)?;
                
                // Verify KVNC fee paid ≥ required_fee
                let native_in = asset_inputs.get(&None).copied().unwrap_or(0);
                let native_out = asset_outputs.get(&None).copied().unwrap_or(0);
                let kvnc_fee_paid = native_in.saturating_sub(native_out);
                
                if kvnc_fee_paid < required_fee {
                    return Err(LedgerError::InsufficientMintFee {
                        tx: tx.id(),
                        asset_id: *asset_id,
                        required: required_fee,
                        paid: kvnc_fee_paid,
                    });
                }
            }
        }
    }
}
```

### 4.3 New Error Variant

```rust
/// Insufficient KVNC fee paid for minting an asset with a mint price
InsufficientMintFee {
    tx: TxId,
    asset_id: AssetId,
    required: u64,
    paid: u64,
},
```

### 4.4 Asset Creation in Coinbase (apply_coinbase)

Allow asset creation in coinbase with creation fee:

```rust
// In apply_coinbase, when processing outputs with new asset_ids:
// 1. Verify creation fee paid in KVNC (separate from subsidy limit)
// 2. Register asset in asset_registry with mint_price, logo, metadata
// 3. Creation fee is burned/producer per RFC-006 split
```

---

## 5. Node/API Changes

### 5.1 New RPC Methods (explorer.rs)

```rust
// POST /api/asset/create/prepare
{
  "from": "kvnc1...",
  "max_supply": "1000000000000",
  "kind": "fungible",
  "mint_price_per_unit": "1000000",      // 0.01 KVNC per unit
  "logo_uri": "ipfs://Qm...",
  "metadata_uri": "ipfs://Qm...",
  "creator_pubkey": "0x..."
}
// Returns: unsigned tx + sighash

// POST /api/asset/mint/prepare
{
  "from": "kvnc1...",
  "asset_id": "0x...",
  "amount": "1000000",
  "to": "kvnc1..."
}
// Returns: unsigned tx + sighash (includes KVNC fee input for mint price)
```

### 5.2 Node Methods (node.rs)

```rust
pub fn prepare_create_asset(
    &self,
    from: Address,
    max_supply: u64,
    kind: AssetKind,
    mint_price_per_unit: u64,
    logo_uri: Option<LogoUri>,
    metadata_uri: Option<MetadataUri>,
) -> Result<Prepared, NodeError>

pub fn prepare_mint_asset(
    &self,
    from: Address,
    asset_id: AssetId,
    amount: u64,
    to: Address,
) -> Result<Prepared, NodeError>
```

---

## 6. Activation & Migration

### 6.1 Activation Parameters

```rust
// In ledger.rs constants:
pub const MINT_PRICE_ACTIVATION_SCORE: u64 = 0;
pub const ASSET_LOGO_ACTIVATION_SCORE: u64 = 0; // same or separate

// In Ledger struct:
mint_price_activation_score: u64,
asset_logo_activation_score: u64,
```

### 6.2 Testnet Activation

1. Deploy code with `activation_score = u64::MAX` (disabled)
2. At agreed blue score, call `ledger.set_mint_price_activation_score(target_score)`
3. No chain reset needed (backward compatible — pre-activation mints are free)

### 6.3 Mainnet

Set activation score in genesis config.

---

## 7. Testing Requirements

### 7.1 Unit Tests (kovanica-state)

- `asset_creation_with_mint_price_and_logo` — valid creation
- `asset_creation_invalid_mint_price` — rejects > MAX_MINT_PRICE
- `mint_with_sufficient_fee` — succeeds
- `mint_with_insufficient_fee` — rejects with `InsufficientMintFee`
- `mint_pre_activation_free` — no fee required before activation
- `logo_uri_size_limit` — rejects oversized URIs
- `metadata_hash_matches_content` — verifies integrity

### 7.2 Adversarial Consensus Tests (kovanica-state/tests/)

- Parallel asset creation with same params (deterministic asset_id)
- Double-mint in parallel blocks (only first succeeds)
- Mint fee evasion attempts (zero KVNC input, wrong asset)
- Logo/metadata mutation after creation (rejected — immutable)

### 7.3 Node Integration Tests (kovanica-node/tests/)

- Full create → mint → transfer flow via RPC
- Explorer UI displays logo from IPFS gateway
- Fee estimation includes mint price

---

## 8. Implementation Checklist

### Phase 1: Core Types & Encoding (tx.rs)
- [ ] Add `LogoUri`, `MetadataUri`, `LogoScheme`, `MetadataScheme`
- [ ] Extend `AssetRegistryEntry` with new fields
- [ ] Update `AssetRegistryEntry` constructors
- [ ] Add serialization/deserialization for new fields (checkpoint format bump)

### Phase 2: Ledger Rules (ledger.rs)
- [ ] Add `MINT_PRICE_ACTIVATION_SCORE`, `ASSET_LOGO_ACTIVATION_SCORE` constants
- [ ] Add `mint_price_activation_score`, `asset_logo_activation_score` to `Ledger`
- [ ] Add `InsufficientMintFee` error variant
- [ ] Implement mint price enforcement in `apply_regular`
- [ ] Implement asset creation with fee in `apply_coinbase`
- [ ] Update `apply_block_inner` to pass activation scores
- [ ] Update `Ledger::apply_new_block` to pass scores

### Phase 3: Structural Validation (validation.rs)
- [ ] Validate logo/metadata URI sizes in `validate_tx_structure`
- [ ] Validate mint price bounds (MIN/MAX)

### Phase 4: Node & RPC (node.rs, explorer.rs)
- [ ] Add `prepare_create_asset` / `prepare_mint_asset` to `Node`
- [ ] Add RPC handlers in `explorer.rs`
- [ ] Add FFI bindings in `kovanica-ffi`

### Phase 5: Tests
- [ ] Unit tests in `tx.rs` and `ledger.rs`
- [ ] Consensus tests in `native_token_consensus.rs` (extend)
- [ ] Node tests in `rpc.rs` or new `asset_mint.rs`

### Phase 6: Documentation
- [ ] Update `docs/RFC-002-NativeTokens.md` or create `docs/KVP-107-MintPriceAndLogos.md`
- [ ] Update `AGENTS.md` with new constants
- [ ] Update explorer web UI to display logos

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Mint price griefing (set huge price) | Cap at `MAX_MINT_PRICE` (1 KVNC/unit) |
| Logo URI spam (huge URIs) | Enforce 256-byte limit in structural validation |
| Logo content mutation | `content_hash` commits to immutable content |
| Activation fork | Blue-score gating ensures synchronized activation |
| Fee estimation complexity | Node `min_fee()` includes mint price estimate |

---

## 10. Backward Compatibility

- **Pre-activation**: `mint_price_per_unit = 0`, no logo/metadata required
- **Post-activation**: New assets must include fields; existing assets have `mint_price_per_unit = 0` (free minting) unless updated via governance
- **Checkpoint format**: Bump to v7 (adds mint_price, logo_uri, metadata_uri to asset registry encoding)

---

## 11. Reference Implementation Notes

### Asset ID Derivation (Deterministic)

```rust
pub fn derive_asset_id(
    creator_pk: &[u8; 32],
    nonce: u64,
    max_supply: u64,
    kind: AssetKind,
    mint_price: u64,
    logo_uri: Option<&LogoUri>,
    metadata_uri: Option<&MetadataUri>,
) -> AssetId {
    let mut hasher = Sha256::new();
    hasher.update(b"KVP107-ASSET");
    hasher.update(creator_pk);
    hasher.update(&nonce.to_le_bytes());
    hasher.update(&max_supply.to_le_bytes());
    hasher.update(&[kind as u8]);
    hasher.update(&mint_price.to_le_bytes());
    if let Some(logo) = logo_uri {
        hasher.update(&[1]);
        hasher.update(logo.uri.as_bytes());
        hasher.update(&logo.content_hash);
    } else {
        hasher.update(&[0]);
    }
    if let Some(meta) = metadata_uri {
        hasher.update(&[1]);
        hasher.update(meta.uri.as_bytes());
        hasher.update(&meta.content_hash);
    } else {
        hasher.update(&[0]);
    }
    AssetId::from_bytes(*hasher.finalize().as_bytes())
}
```

### Fee Calculation Example

```
Asset: MTK, mint_price = 100_000 atoms KVNC per MTK (0.001 KVNC)
User mints: 1,000,000 MTK (10^6 base units, 8 decimals = 10 MTK)
Required KVNC fee: 1,000,000 * 100,000 = 100,000,000,000 atoms = 1,000 KVNC
Fee split: 750 KVNC burned, 250 KVNC to block producer
```

---

## 12. Future Extensions

- **Dynamic mint price**: Bonding curve (price increases with supply)
- **Royalty fees**: Creator earns % on secondary transfers (requires script v2)
- **Verified assets**: On-chain attestation from known entities
- **Asset metadata updates**: Governance-gated metadata URI updates

---

*This design follows Kovanica's conventions: activation-gated consensus changes, RFC-006 fee economics, deterministic asset IDs, and off-chain metadata with on-chain commitments.*