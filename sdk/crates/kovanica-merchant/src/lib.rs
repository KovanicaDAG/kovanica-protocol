//! Kovanica merchant payments, fiat on/off ramps, and token listing registry.
//!
//! This crate provides:
//! - Payment request/response types for merchant integration
//! - Fiat on/off ramp provider interfaces
//! - On-chain token listing registry (KVP-106 compliant)
//! - Presale contract types

use kovanica_airdrop::{build_merkle_root, generate_proof, AirdropCampaign, AirdropLeaf};
use kovanica_bridge::{
    generate_swap_id_hex, BridgeHtlcParams, BridgeState, BridgeSwap, DestinationChain,
};
use kovanica_types::{Address, AssetId, Hash32};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Payment request from merchant to customer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentRequest {
    /// Unique payment ID
    pub payment_id: String,
    /// Merchant's Kovanica address
    pub merchant_address: Address,
    /// Amount in atoms
    pub amount: u64,
    /// Asset ID (native KVNC or token)
    pub asset_id: AssetId,
    /// Human-readable description
    pub description: String,
    /// Optional: expiration timestamp (Unix ms)
    pub expires_at: Option<u64>,
    /// Optional: callback URL for payment notifications
    pub callback_url: Option<String>,
    /// Optional: order/reference ID from merchant system
    pub order_id: Option<String>,
}

/// Payment response from customer to merchant
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentResponse {
    /// Payment request ID this responds to
    pub payment_id: String,
    /// Transaction ID if paid
    pub tx_id: Option<Hash32>,
    /// Status
    pub status: PaymentStatus,
    /// Timestamp
    pub timestamp: u64,
}

/// Payment status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentStatus {
    /// Payment request created, awaiting payment
    Pending,
    /// Payment detected in mempool
    Detected,
    /// Payment confirmed (1+ confirmations)
    Confirmed,
    /// Payment failed/expired
    Failed,
    /// Refunded
    Refunded,
}

/// Fiat on-ramp provider interface
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FiatProvider {
    /// Provider identifier
    pub id: String,
    /// Display name
    pub name: String,
    /// Supported fiat currencies (ISO 4217)
    pub fiat_currencies: Vec<String>,
    /// Supported destination chains
    pub destination_chains: Vec<DestinationChain>,
    /// Minimum purchase amount (in fiat minor units, e.g., cents)
    pub min_amount: u64,
    /// Maximum purchase amount (in fiat minor units)
    pub max_amount: u64,
    /// Fee percentage (basis points, e.g., 150 = 1.5%)
    pub fee_bps: u32,
    /// KYC required
    pub kyc_required: bool,
    /// API endpoint for quotes
    pub quote_endpoint: String,
    /// API endpoint for order creation
    pub order_endpoint: String,
}

/// Fiat quote response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FiatQuote {
    /// Quote ID
    pub quote_id: String,
    /// Fiat amount (minor units)
    pub fiat_amount: u64,
    /// Fiat currency
    pub fiat_currency: String,
    /// Estimated crypto amount (atoms/units)
    pub crypto_amount: u64,
    /// Crypto asset
    pub crypto_asset: String,
    /// Total fees (fiat minor units)
    pub fees: u64,
    /// Exchange rate (crypto per fiat)
    pub rate: f64,
    /// Quote expires at (Unix ms)
    pub expires_at: u64,
}

/// Token listing registry entry (on-chain, KVP-106)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenListing {
    /// Asset ID
    pub asset_id: AssetId,
    /// Token metadata
    pub metadata: TokenMetadata,
    /// Listing status
    pub status: ListingStatus,
    /// Listing transaction (hex)
    pub listing_tx: Option<String>,
    /// Creator address
    pub creator: Address,
    /// Creation block height
    pub created_at_height: u64,
}

/// Token metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenMetadata {
    /// Token name
    pub name: String,
    /// Token symbol (3-8 chars)
    pub symbol: String,
    /// Decimals (0-18)
    pub decimals: u8,
    /// Total supply (in base units)
    pub total_supply: u64,
    /// Optional: description
    pub description: Option<String>,
    /// Optional: website
    pub website: Option<String>,
    /// Optional: logo URL (IPFS/HTTPS)
    pub logo_url: Option<String>,
    /// Optional: social links
    pub social_links: Option<SocialLinks>,
}

/// Social links for token
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SocialLinks {
    pub twitter: Option<String>,
    pub telegram: Option<String>,
    pub discord: Option<String>,
    pub github: Option<String>,
}

/// Listing status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ListingStatus {
    /// Pending review
    Pending,
    /// Active and tradeable
    Active,
    /// Delisted
    Delisted,
    /// Paused by admin
    Paused,
}

/// Presale contract parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresaleContract {
    /// Presale ID
    pub presale_id: Hash32,
    /// Token being sold
    pub token_asset_id: AssetId,
    /// Payment asset (usually native KVNC)
    pub payment_asset_id: AssetId,
    /// Price: payment atoms per token base unit
    pub price_numerator: u64,
    pub price_denominator: u64,
    /// Hard cap (payment asset atoms)
    pub hard_cap: u64,
    /// Soft cap (payment asset atoms)
    pub soft_cap: u64,
    /// Start block height
    pub start_height: u64,
    /// End block height
    pub end_height: u64,
    /// Vesting schedule (optional)
    pub vesting: Option<VestingSchedule>,
    /// Creator/owner address
    pub owner: Address,
}

/// Vesting schedule for presale tokens
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VestingSchedule {
    /// Cliff period (blocks after end_height)
    pub cliff_blocks: u64,
    /// Vesting duration (blocks)
    pub duration_blocks: u64,
    /// Release frequency (blocks)
    pub release_frequency: u64,
}

/// Create a payment request
pub fn create_payment_request(
    merchant_address: Address,
    amount: u64,
    asset_id: AssetId,
    description: String,
) -> PaymentRequest {
    PaymentRequest {
        payment_id: Uuid::new_v4().to_string(),
        merchant_address,
        amount,
        asset_id,
        description,
        expires_at: None,
        callback_url: None,
        order_id: None,
    }
}

/// Create a fiat on-ramp quote request
pub fn create_quote_request(
    provider: &FiatProvider,
    fiat_amount: u64,
    fiat_currency: &str,
    crypto_asset: &str,
) -> FiatQuoteRequest {
    FiatQuoteRequest {
        provider_id: provider.id.clone(),
        fiat_amount,
        fiat_currency: fiat_currency.to_string(),
        crypto_asset: crypto_asset.to_string(),
    }
}

/// Fiat quote request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FiatQuoteRequest {
    pub provider_id: String,
    pub fiat_amount: u64,
    pub fiat_currency: String,
    pub crypto_asset: String,
}

/// Generate a token listing proposal
pub fn create_token_listing(
    creator: Address,
    name: String,
    symbol: String,
    decimals: u8,
    total_supply: u64,
    payment_asset: AssetId,
    description: Option<String>,
) -> TokenListing {
    // Derive asset ID from creator + symbol (simplified)
    let mut hasher = blake3::Hasher::new();
    hasher.update(creator.as_bytes());
    hasher.update(symbol.as_bytes());
    let asset_id = AssetId(Hash32(hasher.finalize().into()));

    TokenListing {
        asset_id,
        metadata: TokenMetadata {
            name,
            symbol,
            decimals,
            total_supply,
            description,
            website: None,
            logo_url: None,
            social_links: None,
        },
        status: ListingStatus::Pending,
        listing_tx: None,
        creator,
        created_at_height: 0, // Set when submitted
    }
}

/// Create a presale contract
pub fn create_presale(
    owner: Address,
    token_asset_id: AssetId,
    payment_asset_id: AssetId,
    price_per_token: f64, // payment atoms per token base unit
    hard_cap_kvnc: u64,
    soft_cap_kvnc: u64,
    start_height: u64,
    end_height: u64,
    vesting: Option<VestingSchedule>,
) -> PresaleContract {
    let mut hasher = blake3::Hasher::new();
    hasher.update(owner.as_bytes());
    hasher.update(&start_height.to_le_bytes());
    let presale_id = Hash32(hasher.finalize().into());

    // Convert price to numerator/denominator
    let (numerator, denominator) = float_to_ratio(price_per_token);

    PresaleContract {
        presale_id,
        token_asset_id,
        payment_asset_id,
        price_numerator: numerator,
        price_denominator: denominator,
        hard_cap: hard_cap_kvnc * 100_000_000,
        soft_cap: soft_cap_kvnc * 100_000_000,
        start_height,
        end_height,
        vesting,
        owner,
    }
}

/// Convert float price to rational (numerator/denominator)
fn float_to_ratio(price: f64) -> (u64, u64) {
    // Simple conversion: multiply by 10^8 and use as ratio
    let scaled = (price * 100_000_000.0) as u64;
    (scaled, 100_000_000)
}

#[cfg(test)]
mod tests {
    use super::*;
    use kovanica_types::AssetId;

    #[test]
    fn payment_request_creation() {
        let addr = Address::from_versioned([0x01; 33]);
        let req = create_payment_request(
            addr,
            1_000_000_000,
            AssetId::NATIVE,
            "Test payment".to_string(),
        );
        assert_eq!(req.amount, 1_000_000_000);
        assert!(!req.payment_id.is_empty());
    }

    #[test]
    fn token_listing_creation() {
        let addr = Address::from_versioned([0x01; 33]);
        let listing = create_token_listing(
            addr,
            "Test Token".to_string(),
            "TEST".to_string(),
            8,
            1_000_000_000_000,
            AssetId::NATIVE,
            Some("A test token".to_string()),
        );
        assert_eq!(listing.metadata.name, "Test Token");
        assert_eq!(listing.metadata.symbol, "TEST");
        assert_eq!(listing.metadata.decimals, 8);
    }

    #[test]
    fn presale_creation() {
        let addr = Address::from_versioned([0x01; 33]);
        let presale = create_presale(
            addr,
            AssetId::NATIVE,
            AssetId::NATIVE,
            0.01, // 0.01 KVNC per token
            1000, // 1000 KVNC hard cap
            100,  // 100 KVNC soft cap
            10000,
            20000,
            None,
        );
        assert_eq!(presale.hard_cap, 100_000_000_000);
        assert_eq!(presale.soft_cap, 10_000_000_000);
    }
}
