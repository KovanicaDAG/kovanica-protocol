//! Kovanica DEX — HTLC-based atomic swap (KVP-104).
//!
//! Maker/Taker model: two HTLCs (one from each side), preimage reveals
//! the swap, timeout for refunds.

pub mod htlc;
pub mod order;
pub mod swap;

pub use htlc::{HtlcParams, HtlcScript};
pub use order::{Order, OrderId, OrderSide};
pub use swap::{Swap, SwapId, SwapState};
