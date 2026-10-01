//! Atomic swap orchestration — two HTLCs, one preimage.

use crate::htlc::{HtlcParams, HtlcScript};
use crate::order::{Order, OrderId};
use kovanica_types::{Address, AssetId};
use serde::{Deserialize, Serialize};

/// Swap ID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SwapId(pub [u8; 32]);

/// Swap state machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SwapState {
    /// Both HTLCs funded, waiting for claim.
    Funded,
    /// Preimage revealed, both sides claimed.
    Completed,
    /// Timed out, refunded.
    Refunded,
}

/// An atomic swap between two parties.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Swap {
    pub id: SwapId,
    pub order_id: OrderId,
    pub maker_htlc: HtlcScript,
    pub taker_htlc: HtlcScript,
    pub state: SwapState,
}

impl Swap {
    /// Create a new swap from an order and taker params.
    pub fn new(
        order: &Order,
        taker: Address,
        taker_asset: AssetId,
        taker_amount: u64,
        preimage: &[u8],
        timeout: u64,
    ) -> Self {
        use blake3::Hasher;

        // Maker HTLC: maker offers asset, taker receives
        let maker_htlc = HtlcScript::new(HtlcParams::new(
            preimage,
            order.maker,
            taker,
            timeout,
            order.offer_asset,
            order.offer_amount,
        ));

        // Taker HTLC: taker offers asset, maker receives
        let taker_htlc = HtlcScript::new(HtlcParams::new(
            preimage,
            taker,
            order.maker,
            timeout,
            taker_asset,
            taker_amount,
        ));

        let mut hasher = Hasher::new();
        hasher.update(&order.id.0);
        hasher.update(taker.as_bytes());
        let id = SwapId(*hasher.finalize().as_bytes());

        Self {
            id,
            order_id: order.id,
            maker_htlc,
            taker_htlc,
            state: SwapState::Funded,
        }
    }

    /// Claim both HTLCs with the preimage.
    pub fn claim(&mut self, preimage: &[u8]) -> bool {
        let maker_ok = self.maker_htlc.claim(preimage);
        let taker_ok = self.taker_htlc.claim(preimage);
        if maker_ok && taker_ok {
            self.state = SwapState::Completed;
            true
        } else {
            false
        }
    }

    /// Refund both HTLCs after timeout.
    pub fn refund(&mut self, current_height: u64) -> bool {
        let maker_ok = self.maker_htlc.refund(current_height);
        let taker_ok = self.taker_htlc.refund(current_height);
        if maker_ok && taker_ok {
            self.state = SwapState::Refunded;
            true
        } else {
            false
        }
    }
}
