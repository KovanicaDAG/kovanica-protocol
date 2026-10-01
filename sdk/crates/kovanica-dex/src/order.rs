//! Order book for the DEX.

use blake3::Hasher;
use kovanica_types::{Address, AssetId};
use serde::{Deserialize, Serialize};

/// Order ID (blake3 hash of order params).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct OrderId(pub [u8; 32]);

/// Order side: buy or sell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderSide {
    Buy,
    Sell,
}

/// A DEX order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Order {
    pub id: OrderId,
    pub maker: Address,
    pub side: OrderSide,
    /// Asset being offered.
    pub offer_asset: AssetId,
    /// Amount offered.
    pub offer_amount: u64,
    /// Asset requested.
    pub request_asset: AssetId,
    /// Amount requested.
    pub request_amount: u64,
    /// Timeout in blocks.
    pub timeout: u64,
}

impl Order {
    pub fn new(
        maker: Address,
        side: OrderSide,
        offer_asset: AssetId,
        offer_amount: u64,
        request_asset: AssetId,
        request_amount: u64,
        timeout: u64,
    ) -> Self {
        let mut hasher = Hasher::new();
        hasher.update(maker.as_bytes());
        hasher.update(&(side as u8).to_le_bytes());
        hasher.update(&offer_asset.0 .0);
        hasher.update(&offer_amount.to_le_bytes());
        hasher.update(&request_asset.0 .0);
        hasher.update(&request_amount.to_le_bytes());
        hasher.update(&timeout.to_le_bytes());
        let id = OrderId(*hasher.finalize().as_bytes());
        Self {
            id,
            maker,
            side,
            offer_asset,
            offer_amount,
            request_asset,
            request_amount,
            timeout,
        }
    }
}
