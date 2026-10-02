//! Kovanica cross-chain HTLC bridges.
//!
//! This crate provides types and utilities for atomic swaps between Kovanica
//! and other blockchains (BTC, ETH, XRP, DOGE, SOL) using HTLCs.
//!
//! The bridge protocol:
//! 1. User locks funds on source chain with HTLC (preimage hash + timeout)
//! 2. Relayer detects lock event and locks equivalent on destination chain
//! 3. User claims on destination chain by revealing preimage
//! 4. Relayer claims on source chain using same preimage
//! 5. If timeout expires, both parties can refund

use kovanica_types::{Address, AssetId, Hash32};
use serde::{Deserialize, Serialize};

/// Supported destination chains for bridging
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DestinationChain {
    /// Bitcoin (native BTC or Lightning)
    Bitcoin,
    /// Ethereum (ETH or ERC-20)
    Ethereum,
    /// XRP Ledger
    Xrp,
    /// Dogecoin
    Dogecoin,
    /// Solana (SOL or SPL tokens)
    Solana,
}

impl DestinationChain {
    /// Get the native asset identifier for this chain
    pub fn native_asset(&self) -> &'static str {
        match self {
            DestinationChain::Bitcoin => "BTC",
            DestinationChain::Ethereum => "ETH",
            DestinationChain::Xrp => "XRP",
            DestinationChain::Dogecoin => "DOGE",
            DestinationChain::Solana => "SOL",
        }
    }

    /// Typical block time in seconds (for timeout calculations)
    pub fn block_time_seconds(&self) -> u64 {
        match self {
            DestinationChain::Bitcoin => 600, // ~10 min
            DestinationChain::Ethereum => 12, // ~12 sec
            DestinationChain::Xrp => 4,       // ~4 sec
            DestinationChain::Dogecoin => 60, // ~1 min
            DestinationChain::Solana => 1,    // ~0.4 sec (slot)
        }
    }
}

/// HTLC parameters for cross-chain swaps
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeHtlcParams {
    /// Kovanica-side HTLC script (100 bytes, hex)
    pub kovanica_script: String,
    /// Preimage hash (32 bytes, hex) - BLAKE3 on Kovanica, SHA256 on others
    pub preimage_hash: String,
    /// Timeout height on Kovanica
    pub kovanica_timeout: u64,
    /// Timeout on destination chain (block height or timestamp)
    pub destination_timeout: u64,
    /// Amount in destination chain's native units
    pub destination_amount: u64,
    /// Destination chain
    pub destination_chain: DestinationChain,
    /// Recipient address on destination chain
    pub destination_recipient: String,
    /// Sender address on Kovanica
    pub kovanica_sender: Address,
}

/// Bridge swap state
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BridgeState {
    /// Waiting for user to fund Kovanica HTLC
    AwaitingKovanicaFund,
    /// Kovanica HTLC funded, waiting for relayer to fund destination
    AwaitingDestinationFund,
    /// Both HTLCs funded, waiting for claim
    ReadyForClaim,
    /// Claimed on destination chain (preimage revealed)
    ClaimedDestination,
    /// Claimed on Kovanica (relayer used preimage)
    ClaimedKovanica,
    /// Refunded on both chains
    Refunded,
    /// Expired - one side refunded, other pending
    Expired,
}

/// Bridge swap record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeSwap {
    /// Unique swap identifier (hex)
    pub swap_id: String,
    /// Bridge HTLC parameters
    pub params: BridgeHtlcParams,
    /// Current state
    pub state: BridgeState,
    /// Kovanica outpoint (tx_hash hex + vout)
    pub kovanica_outpoint: Option<(String, u32)>,
    /// Destination chain transaction ID
    pub destination_txid: Option<String>,
    /// Preimage (revealed after claim, hex)
    pub preimage: Option<String>,
    /// Creation timestamp (Unix ms)
    pub created_at: u64,
    /// Last update timestamp
    pub updated_at: u64,
}

/// Generate a new swap ID
pub fn generate_swap_id() -> Hash32 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&rand::random::<[u8; 32]>());
    hasher.update(
        &std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_le_bytes(),
    );
    Hash32(hasher.finalize().into())
}

/// Generate a swap ID as hex string
pub fn generate_swap_id_hex() -> String {
    generate_swap_id().to_hex()
}

/// Calculate recommended timeouts for a cross-chain swap
///
/// Returns (kovanica_timeout_blocks, destination_timeout_blocks_or_timestamp)
pub fn calculate_timeouts(
    destination_chain: DestinationChain,
    kovanica_tip_height: u64,
) -> (u64, u64) {
    // Safety margin: 2x destination chain confirmation time + buffer
    let dest_block_time = destination_chain.block_time_seconds();
    let kovanica_blocks = (dest_block_time * 6) / 60 + 10; // ~6 confirmations + buffer
    let kovanica_timeout = kovanica_tip_height + kovanica_blocks;

    // Destination timeout: 2x the time it takes for Kovanica refund to be available
    let kovanica_refund_time = kovanica_blocks * 60; // Kovanica block time ~60s
    let destination_timeout = kovanica_refund_time + (dest_block_time * 4);

    (kovanica_timeout, destination_timeout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn swap_id_generation() {
        let id1 = generate_swap_id_hex();
        let id2 = generate_swap_id_hex();
        assert_ne!(id1, id2);
        assert_eq!(id1.len(), 64);
    }

    #[test]
    fn destination_chain_native_assets() {
        assert_eq!(DestinationChain::Bitcoin.native_asset(), "BTC");
        assert_eq!(DestinationChain::Ethereum.native_asset(), "ETH");
        assert_eq!(DestinationChain::Xrp.native_asset(), "XRP");
        assert_eq!(DestinationChain::Dogecoin.native_asset(), "DOGE");
        assert_eq!(DestinationChain::Solana.native_asset(), "SOL");
    }

    #[test]
    fn timeout_calculation() {
        let (k_timeout, d_timeout) = calculate_timeouts(DestinationChain::Ethereum, 1000);
        assert!(k_timeout > 1000);
        assert!(d_timeout > 0);
    }
}
