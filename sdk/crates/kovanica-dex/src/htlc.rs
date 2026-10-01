//! HTLC script builder for atomic swaps (KVP-104).
//!
//! Matches the shipped KVP-104 HTLC script structure exactly.

use blake3::Hasher;
use kovanica_types::{Address, AssetId};
use serde::{Deserialize, Serialize};

/// HTLC parameters for a single leg of the swap.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HtlcParams {
    /// Hash of the preimage (blake3-256).
    pub hash: [u8; 32],
    /// Sender address (refund path).
    pub sender: Address,
    /// Recipient address (claim path).
    pub recipient: Address,
    /// Timeout in blocks (refund after this height).
    pub timeout: u64,
    /// Asset being locked.
    pub asset: AssetId,
    /// Amount in atoms.
    pub amount: u64,
}

impl HtlcParams {
    /// Create new HTLC parameters.
    pub fn new(
        preimage: &[u8],
        sender: Address,
        recipient: Address,
        timeout: u64,
        asset: AssetId,
        amount: u64,
    ) -> Self {
        let mut hasher = Hasher::new();
        hasher.update(preimage);
        let hash = *hasher.finalize().as_bytes();
        Self {
            hash,
            sender,
            recipient,
            timeout,
            asset,
            amount,
        }
    }

    /// Derive the HTLC script address (deterministic).
    pub fn script_address(&self) -> Address {
        let mut hasher = Hasher::new();
        hasher.update(&self.hash);
        hasher.update(self.sender.as_bytes());
        hasher.update(self.recipient.as_bytes());
        hasher.update(&self.timeout.to_le_bytes());
        hasher.update(&self.asset.0 .0);
        hasher.update(&self.amount.to_le_bytes());
        let digest = hasher.finalize();
        let mut payload = [0u8; 32];
        payload.copy_from_slice(digest.as_bytes());
        Address::htlc(payload)
    }
}

/// HTLC script — matches KVP-104 structure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HtlcScript {
    pub params: HtlcParams,
}

impl HtlcScript {
    pub fn new(params: HtlcParams) -> Self {
        Self { params }
    }

    /// Claim path: recipient reveals preimage.
    pub fn claim(&self, preimage: &[u8]) -> bool {
        let mut hasher = Hasher::new();
        hasher.update(preimage);
        let hash = *hasher.finalize().as_bytes();
        hash == self.params.hash
    }

    /// Refund path: sender after timeout.
    pub fn refund(&self, current_height: u64) -> bool {
        current_height >= self.params.timeout
    }
}
