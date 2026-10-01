//! [`NodeService`]: owns the embedded `Node`.
//!
//! Slice A is deliberately a **synchronous** owner: it boots the same genesis
//! path as the explorer's `genesis_node()` and proves the resulting genesis id
//! matches the live network (the genesis-parity gate). Slice B moves the node
//! onto a dedicated worker thread and adds the event stream that drives the
//! UI shell.
//!
//! Consensus invariants respected here (see `AGENTS.md` §8):
//! - no consensus logic is re-implemented — every call maps 1:1 to the node
//!   crate API;
//! - genesis parameters come from [`NetworkProfile`], never invented locally;
//! - treasury inclusion is **explicit**: the live testnet runs the RFC-006-era
//!   chain with the deterministic placeholder treasury (10×1M KVNC vaults),
//!   and only that construction reproduces the live genesis `9565fc20…`
//!   (proven by `examples/probe_genesis.rs` and the node crate's own
//!   `genesis_with_placeholder_treasury_matches_live_testnet_genesis` test).

use kovanica_node::{Node, NodeError, TreasuryGenesis};

use crate::profile::NetworkProfile;

/// Why booting the embedded node failed.
#[derive(Debug)]
pub enum BootError {
    /// The profile is dormant (mainnet) and must never be booted implicitly.
    DormantNetwork(&'static str),
    /// The node crate rejected the genesis parameters.
    Node(NodeError),
    /// The profile's PoA authority set violates the RFC-POA §1 invariants
    /// (3–16 distinct keys, `2 <= threshold <= count`).
    Authority(String),
}

impl std::fmt::Display for BootError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BootError::DormantNetwork(id) => write!(
                f,
                "network profile '{id}' is DORMANT: genesis parameters are TBD; \
                 refusing to boot (mainnet is never activated implicitly)"
            ),
            BootError::Node(e) => write!(f, "node genesis failed: {e}"),
            BootError::Authority(e) => write!(
                f,
                "invalid PoA authority set (RFC-POA §1): {e}; the genesis coinbase \
                 commits to this set, so a wrong set is a hard fork"
            ),
        }
    }
}

impl std::error::Error for BootError {}

/// Why the genesis-parity gate failed.
#[derive(Debug)]
pub enum ParityError {
    /// Could not build the local genesis to compare.
    Boot(BootError),
    /// Local embedded genesis id differs from the live network's reported id.
    Mismatch { local: String, live: String },
}

impl std::fmt::Display for ParityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParityError::Boot(e) => write!(f, "could not build local genesis: {e}"),
            ParityError::Mismatch { local, live } => write!(
                f,
                "GENESIS MISMATCH\n  local: {local}\n  live : {live}\n\
                 Do not join the network — the embedded node's genesis differs from the \
                 live network. Check NetworkProfile constants and /api/bootstrap's light_config."
            ),
        }
    }
}

impl std::error::Error for ParityError {}

/// Serialized node handle (Slice A v0: synchronous owner of an embedded `Node`).
///
/// (No `Debug` derive — the embedded `Node` doesn't implement it.)
pub struct NodeService {
    node: Option<Node>,
    profile: NetworkProfile,
}

impl NodeService {
    /// A service bound to `profile` (not yet booted).
    pub fn new(profile: NetworkProfile) -> Self {
        Self {
            node: None,
            profile,
        }
    }

    /// Boot genesis with this profile's consensus parameters.
    ///
    /// Refuses to boot dormant profiles (mainnet), mirroring the explorer's
    /// `KOVANICA_MAINNET_OVERRIDE` fail-fast guard.
    ///
    /// Treasury inclusion is **explicit** — the node crate never infers it
    /// from the premine amount. The live testnet's genesis coinbase includes
    /// the RFC-006 treasury tranches (10×1M KVNC vaults with placeholder
    /// keys), so we pass `Some(TreasuryGenesis::placeholder())` — the same
    /// construction the explorer's `genesis_node()` uses to reproduce the
    /// live genesis `08fa538f…`.
    ///
    /// **PoA is the only admission regime** (RFC-POA-Migration §0), so this
    /// boots through `genesis_with_poa`, not the legacy
    /// `genesis_with_finality`: under PoA the genesis coinbase tag is
    /// `KVA1 || authority_set_hash`, so the genesis id commits to the
    /// authority set. The legacy path tags the coinbase `b"genesis"` and
    /// derives the pre-PoA id `7c5361da…`, which would hard-fork from the
    /// live network. Mirrors the explorer's `genesis_node()`.
    pub fn boot(&mut self) -> Result<(String, String), BootError> {
        if self.profile.dormant {
            return Err(BootError::DormantNetwork(self.profile.id));
        }
        let authority_set = self
            .profile
            .authority_set()
            .map_err(|e| BootError::Authority(e.to_string()))?;
        let mut node = Node::new();
        let (genesis, founder) = node
            .genesis_with_poa(
                self.profile.genesis_k,
                self.profile.genesis_subsidy,
                self.profile.genesis_premine,
                self.profile.founder_seed,
                Some(TreasuryGenesis::placeholder()),
                self.profile.finality_depth,
                self.profile.payload_pruning_depth,
                self.profile.block_pruning_depth,
                Some(self.profile.operator_seed),
                authority_set,
                self.profile.slot_duration_ms,
            )
            .map_err(BootError::Node)?;
        let out = (genesis.to_string(), founder.to_string());
        self.node = Some(node);
        Ok(out)
    }

    /// The embedded node's genesis id, if booted.
    pub fn genesis_id(&self) -> Option<String> {
        self.node
            .as_ref()
            .and_then(|n| n.genesis_id())
            .map(|id| id.to_string())
    }

    /// The selected (heaviest) tip id, if booted.
    pub fn selected_tip(&self) -> Option<String> {
        self.node
            .as_ref()
            .and_then(|n| n.selected_tip().ok())
            .map(|t| t.to_string())
    }

    /// Number of blocks in the embedded DAG, if booted.
    pub fn block_count(&self) -> u64 {
        self.node
            .as_ref()
            .map(|n| n.block_count().unwrap_or(0) as u64)
            .unwrap_or(0)
    }

    /// The profile this service is bound to.
    pub fn profile(&self) -> &NetworkProfile {
        &self.profile
    }

    /// The genesis-parity gate: boot if needed, then compare the local genesis
    /// id byte-for-byte against the network's reported genesis
    /// (`/api/bootstrap → genesis`, `/api/head → genesis`).
    ///
    /// This is the Slice A gate: the embedded node must produce exactly the
    /// live network's genesis before any UI or sync work is allowed.
    pub fn verify_genesis_parity(&mut self, live_genesis_hex: &str) -> Result<(), ParityError> {
        if self.node.is_none() {
            self.boot().map_err(ParityError::Boot)?;
        }
        let local = self
            .genesis_id()
            .expect("genesis_id is Some after a successful boot");
        let live = live_genesis_hex.trim();
        if local == live {
            Ok(())
        } else {
            Err(ParityError::Mismatch {
                local,
                live: live.to_string(),
            })
        }
    }
}
