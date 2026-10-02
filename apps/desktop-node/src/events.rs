//! Event types emitted by the embedded node worker.
//!
//! The UI layer consumes these via the `NodeHandle::events()` stream.
//! Events are coarse-grained and consensus-agnostic — they reflect *what
//! happened* in the node, not *why* (that lives in the node crate).

use serde::{Deserialize, Serialize};

/// Events the desktop app's node worker emits.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum NodeEvent {
    /// The embedded node has finished booting genesis.
    Booted { genesis: String, founder: String },

    /// A new block was produced locally (mined or staked).
    BlockProduced {
        block_id: String,
        height: u64,
        tx_count: usize,
    },

    /// A block was received from the network and accepted.
    BlockReceived {
        block_id: String,
        height: u64,
        tx_count: usize,
    },

    /// The selected tip changed (new heaviest block).
    TipChanged {
        old_tip: Option<String>,
        new_tip: String,
    },

    /// A transaction was confirmed in the selected chain.
    TxConfirmed {
        tx_id: String,
        block_id: String,
        depth: u64,
    },

    /// A transaction entered the local mempool.
    TxAccepted { tx_id: String },

    /// A transaction was evicted from the mempool.
    TxEvicted { tx_id: String },

    /// A finality checkpoint was written to disk.
    CheckpointSaved { path: String, block_count: u64 },

    /// A whole-file snapshot was written to disk.
    SnapshotSaved { path: String, block_count: u64 },

    /// Sync progress update (during initial catch-up).
    SyncProgress {
        synced_blocks: u64,
        total_blocks: u64,
        peers: usize,
    },

    /// A new peer was discovered/connected.
    PeerConnected { peer_id: String, address: String },

    /// A peer disconnected.
    PeerDisconnected { peer_id: String },

    /// The node's validator identity (VRF public key) was set from a seed.
    ValidatorReady { pk: String },

    /// An error occurred in the worker (non-fatal).
    Error { message: String },

    /// Node is shutting down gracefully.
    Shutdown,
}

/// Wallet-relevant events (subset of `NodeEvent` plus address-specific filtering).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum WalletEvent {
    Received {
        tx_id: String,
        block_id: String,
        amount: u64,
        asset_id: Option<String>,
        address: String,
    },
    Sent {
        tx_id: String,
        block_id: String,
        amount: u64,
        asset_id: Option<String>,
        address: String,
    },
    Confirmed {
        tx_id: String,
        block_id: String,
        depth: u64,
    },
}
