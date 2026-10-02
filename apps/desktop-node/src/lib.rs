#![allow(dead_code, unused_variables, unused_imports)]
//! # kovanica-desktop
//!
//! Core crate for the **Kovanica Desktop Node App** (Windows / Linux / macOS).
//!
//! Slice A ships the foundation the rest of the app is built on:
//!
//! - [`profile::NetworkProfile`] — the **verified live** consensus genesis parameters
//!   (RFC-006-era for testnet: 10 KVNC subsidy, 200,000 KVNC premine, 10×1M KVNC
//!   treasury vaults; dormant RFC-006-era mainnet placeholder), kept in sync with
//!   `kovanica_state` constants;
//! - [`service::NodeService`] — an embedded `kovanica-node::Node` booted with the
//!   same genesis path as the explorer, plus the **genesis-parity gate**
//!   ([`service::NodeService::verify_genesis_parity`]) that proves the local
//!   genesis byte-identically matches the live network before any UI work;
//! - [`worker::NodeHandle`] — Slice B: a worker thread owning the `Node` with an
//!   async command/event interface for the UI (Tauri shell);
//! - [`datadir::DataDir`] — platform-appropriate data directories with network
//!   marker isolation;
//! - [`events::NodeEvent`] — UI-consumable event stream (blocks, txs, tips, sync).
//!
//! Scoping discipline (mirrors `AGENTS.md`): this crate never re-implements
//! consensus. Every call maps 1:1 onto the node crate's audited APIs; the UI
//! layers that arrive in later slices are pure renderers over this service.

pub mod authority_keys;
pub mod datadir;
pub mod events;
pub mod profile;
pub mod service;
#[cfg(feature = "tauri")]
pub mod tauri_main;
pub mod worker;

pub use datadir::{DataDir, DataDirError};
pub use events::{NodeEvent, WalletEvent};
pub use profile::{NetworkProfile, NETWORK_MAINNET, NETWORK_TESTNET};
pub use service::{BootError, NodeService, ParityError};
pub use worker::{
    AssetBalance, NodeHandle, NodeStatus, SpvSyncInfo, StakingInfo, WorkerCmd, WorkerError,
    WorkerResp,
};
