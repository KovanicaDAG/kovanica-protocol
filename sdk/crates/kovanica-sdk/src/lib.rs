//! # kovanica-sdk
//!
//! Official high-level Rust SDK for the Kovanica protocol.
//!
//! ## Quick start
//!
//! ```rust,no_run
//! use kovanica_sdk::prelude::*;
//!
//! # async fn demo() -> Result<(), Box<dyn std::error::Error>> {
//! let mnemonic = Mnemonic::generate(WordCount::Words24)?;
//! let keypair = Keypair::from_mnemonic(&mnemonic, "");
//! println!("address: {}", keypair.address());
//!
//! let client = Client::testnet()?;
//! let head = client.get_head().await?;
//! println!("network: {}, height: {:?}", head.network, head.blocks);
//! # Ok(())
//! # }
//! ```
//!
//! ## Modules
//!
//! Re-exported from the underlying crates:
//! - [`types`] — amounts, hashes, addresses, UTXOs, transactions
//! - [`keys`] — BIP-39 mnemonic, Ed25519 keypairs
//! - [`tx`] — transfer / HTLC / multisig / vault builders
//! - [`rpc`] — HTTP client for the public API
//! - [`fee`] — tokenomics-aware fee estimation
//!
//! ## Versioning
//!
//! This crate stays on the **0.x** line until the protocol reaches a stable **1.0.0**.
//! Derivation paths and address encoding will be frozen before mainnet.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

pub use kovanica_fee as fee;
pub use kovanica_keys as keys;
pub use kovanica_rpc as rpc;
pub use kovanica_tx as tx;
pub use kovanica_types as types;

/// Convenient prelude for application code.
pub mod prelude {
    pub use crate::fee::estimate;
    pub use crate::keys::scripts::{HtlcScript, MultisigScript, VaultScript};
    pub use crate::keys::{Keypair, Mnemonic, Seed, WordCount};
    pub use crate::rpc::Client;
    pub use crate::tx::{HtlcBuilder, MultisigSigner, SignedTx, TransferBuilder, VaultBuilder};
    pub use crate::types::{
        Address, Amount, AssetId, Hash32, NetworkId, Transaction, TxHash, Utxo, ATOMS_PER_KVNC,
    };
}

/// SDK version string.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
