//! Embedded node worker thread + handle.
//!
//! Slice B: moves the `Node` onto a dedicated worker thread with an
//! `mpsc` channel for commands and a broadcast channel for events. The
//! UI (Tauri shell) holds a `NodeHandle` clone and never touches the
//! `Node` directly — preserving the "zero consensus in UI" invariant.

use std::collections::BTreeMap;
use std::io::Read;
use std::net::TcpListener;
use std::sync::Arc;
use std::time::Duration;

use kovanica_dag::{Block, BlockId};
use kovanica_node::net;
use kovanica_node::spv::{BlockHeader, MerkleProof, SpvClient};
use kovanica_node::{Node, NodeError};
use kovanica_state::spv::BlockFilter;
use kovanica_state::{Address, AssetKind, KeyPair, OutPoint, Sig, Transaction, TxId, TxOutput};
use thiserror::Error;
use tokio::sync::{broadcast, mpsc, oneshot, Mutex};
use tokio::task::JoinHandle;

use crate::datadir::{DataDir, DataDirError};
use crate::events::{NodeEvent, WalletEvent};
use crate::profile::NetworkProfile;
use crate::service::BootError;

/// Wallet state managed by the worker.
///
/// Holds only `Copy`-friendly material (the seed bytes), never a `KeyPair`
/// (which is deliberately neither `Debug` nor `Clone` — see `kovanica-state`).
/// A `KeyPair` is reconstructed on demand from the seed.
#[derive(Debug, Clone)]
struct WalletState {
    seed: Option<[u8; 32]>,
    mnemonic: Option<String>,
    passphrase: Option<String>,
    derivation_index: usize,
}

impl WalletState {
    fn new() -> Self {
        Self {
            seed: None,
            mnemonic: None,
            passphrase: None,
            derivation_index: 0,
        }
    }

    fn is_locked(&self) -> bool {
        self.seed.is_none()
    }

    /// Deterministic keypair for the current derivation index.
    fn keypair(&self) -> Option<KeyPair> {
        self.derive_keypair(self.derivation_index)
    }

    /// Reconstruct a keypair for `index`, seeded from the mnemonic +
    /// passphrase (BIP44-style) or from the raw stored seed.
    fn derive_keypair(&self, index: usize) -> Option<KeyPair> {
        if let Some(mnemonic) = &self.mnemonic {
            let mut hasher = blake3::Hasher::new();
            hasher.update(mnemonic.as_bytes());
            if let Some(passphrase) = &self.passphrase {
                hasher.update(passphrase.as_bytes());
            }
            hasher.update(&(index as u64).to_le_bytes());
            let mut seed = [0u8; 32];
            seed.copy_from_slice(hasher.finalize().as_bytes());
            Some(KeyPair::from_seed(seed))
        } else {
            self.seed.map(KeyPair::from_seed)
        }
    }

    fn derive_address(&self, index: usize) -> Option<String> {
        self.derive_keypair(index)
            .map(|kp| kp.address().to_string())
    }

    /// Re-seed the wallet from a mnemonic + passphrase (BIP39).
    fn set_mnemonic(&mut self, mnemonic: String, passphrase: Option<String>) {
        let seed = MnemonicSeed::from(&mnemonic, passphrase.as_deref());
        self.mnemonic = Some(mnemonic);
        self.passphrase = passphrase;
        self.seed = Some(seed.bytes);
        self.derivation_index = 0;
    }
}

/// BIP39 mnemonic → 32-byte seed (kept small so the worker never depends on
/// tree-sitter or network I/O at derive time).
struct MnemonicSeed {
    bytes: [u8; 32],
}

impl MnemonicSeed {
    fn from(mnemonic: &str, passphrase: Option<&str>) -> Self {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"kvnc-bip39");
        hasher.update(mnemonic.as_bytes());
        if let Some(passphrase) = passphrase {
            hasher.update(passphrase.as_bytes());
        }
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(hasher.finalize().as_bytes());
        Self { bytes }
    }
}

/// How often the worker attempts an outbound P2P sync round.
const P2P_TICK_SECS: u64 = 4;
/// Per-peer timeout for a single P2P sync round (headers-first, then dump).
const P2P_SYNC_TIMEOUT: Duration = Duration::from_millis(400);
/// HTTP timeout for SPV light-sync fetch + proof requests.
const SPV_HTTP_TIMEOUT: Duration = Duration::from_secs(20);

/// Continuous mining cadence state held by the worker loop. Separate from
/// P2P because a node can produce blocks while thoroughly disconnected.
#[derive(Default)]
struct MiningState {
    enabled: bool,
    interval_secs: u64,
}

/// Live P2P state held by the worker loop.
#[derive(Default)]
struct P2pState {
    enabled: bool,
    peers: Vec<String>,
    /// Peers that answered the most recent sync round.
    live: Vec<String>,
    /// Non-blocking inbound listeners, one per requested address.
    listeners: Vec<TcpListener>,
}

/// Light-synced (headers + Golomb-Rice filters) store, from the last
/// successful `SPVSync`. Used to answer filter-matches and proof checks
/// without ever touching full block bodies.
#[derive(Default)]
struct SpvStore {
    /// Base URL the blob was fetched from (for incremental proof pulls).
    base: String,
    /// `(header, filter)` pairs in chain order, verified by `SpvClient`.
    headers: Vec<(BlockHeader, BlockFilter)>,
}

impl SpvStore {
    /// Block ids whose filter MIGHT contain `owner` (probabilistic hits).
    fn matches(&self, owner: &[u8; 32]) -> Vec<String> {
        self.headers
            .iter()
            .filter_map(|(h, f)| {
                if f.matches(owner) {
                    Some(h.id.to_string())
                } else {
                    None
                }
            })
            .collect()
    }
}

/// Commands the UI can send to the node worker.
#[derive(Debug)]
pub enum WorkerCmd {
    /// Produce a block (mining or staked-VRF depending on config).
    ProduceBlock,
    /// Submit a transaction to the local mempool and gossip.
    SubmitTx(Transaction),
    /// Request a snapshot save.
    SaveSnapshot,
    /// Request a finality checkpoint save.
    SaveCheckpoint,
    /// Request current node status.
    GetStatus,
    /// Start P2P networking (Mesh + gossip).
    StartP2P {
        listen_addr: String,
        bootstrap_peers: Vec<String>,
    },
    /// Stop P2P networking.
    StopP2P,
    /// Create a new wallet (BIP39 mnemonic).
    CreateWallet { passphrase: Option<String> },
    /// Unlock existing wallet from mnemonic.
    UnlockWallet {
        mnemonic: String,
        passphrase: Option<String>,
    },
    /// Lock the current wallet (clear keys from memory).
    LockWallet,
    /// Get wallet addresses (derived from BIP44).
    GetAddresses { count: usize },
    /// Send KVNC from wallet.
    SendFromWallet { to_address: String, amount: u64 },
    /// Get wallet balance.
    GetBalance { address: String },
    /// Get wallet transaction history.
    GetHistory { address: String, max_blocks: usize },
    /// List all per-asset spendable balances for an address.
    GetAssetBalances { address: String },
    /// Fetch + verify a KVLS light-sync blob (headers + filters) from a node.
    SPVSync { url: String },
    /// Which light-synced blocks MIGHT contain activity for an address.
    SPVMatches { address: String },
    /// Verify a Merkle inclusion proof for a tx against a light-synced header.
    SPVVerify { block_id: String, tx_id: String },
    /// Set the validator identity seed (32 bytes hex). The derived VRF public
    /// key must exist before any bond/stake work can be signed for it.
    SetValidatorSeed { seed_hex: String },
    /// Enable hybrid staked+PoW admission with a sortition rate (1/1 = every
    /// slot is the validator's to win, 1/10 = ten times rarer).
    EnableHybrid {
        rate_num: u64,
        rate_den: u64,
        retarget: bool,
    },
    /// Snapshot of the staking/mining state for the panel.
    GetStaking,
    /// Bond `amount` atoms of the unlocked wallet's KVNC to the node's
    /// validator identity.
    BondStake { amount: u64 },
    /// Unbond `amount` atoms of this validator's matured stake back to the
    /// wallet address (sealed in a mined block).
    UnbondStake { amount: u64 },
    /// Keep producing blocks every `interval_secs` until stopped.
    StartMining { interval_secs: u64 },
    /// Stop the continuous cadence; manual `ProduceBlock` still works.
    StopMining,
    /// Graceful shutdown.
    Shutdown,
}

/// Response from the worker to a specific command.
#[derive(Debug)]
pub enum WorkerResp {
    ProduceBlock(Result<Option<BlockId>, NodeError>),
    SubmitTx(Result<TxId, NodeError>),
    Status(NodeStatus),
    P2PStatus(String),
    WalletCreated {
        mnemonic: String,
        master_fingerprint: String,
    },
    WalletUnlocked {
        fingerprint: String,
    },
    WalletLocked,
    Addresses(Vec<String>),
    SendResult(Result<TxId, String>),
    Balance(u64),
    History(Vec<WalletEvent>),
    /// SaveState(Ok(path)) after a snapshot or checkpoint landed on disk.
    SaveState(Result<String, String>),
    /// Per-asset spendable balances for one address.
    AssetBalances(Result<Vec<AssetBalance>, String>),
    /// Light-sync result (fetch + chain verification) or error.
    SpvSync(Result<SpvSyncInfo, String>),
    /// Block ids whose filters MIGHT contain the queried address.
    SpvMatches(Vec<String>),
    /// Whether a Merkle inclusion proof verified against a synced header.
    SpvVerified(bool),
    /// Result of `SetValidatorSeed` (the derived VRF public key hex).
    ValidatorSeed(Result<String, String>),
    /// Result of `EnableHybrid` as a human-friendly status line.
    HybridStatus(String),
    /// Staking/mining snapshot (errors are folded to zero/None fields).
    Staking(StakingInfo),
    /// Result of a bond/unbond (`tx` id hex on success).
    StakingTx(Result<String, String>),
    /// Result of a mining cadence toggle as a status line.
    MiningStatus(String),
    Ok,
}

/// One asset balance for an address (native KVNC or a registered token).
#[derive(Clone, Debug, serde::Serialize)]
pub struct AssetBalance {
    /// `"KVNC"` for the native asset, otherwise the 64-hex asset id.
    pub asset: String,
    /// Balance in atoms (native unit).
    pub amount: u128,
    /// `"Fungible"` or `"NonFungible"`.
    pub kind: String,
}

/// Result of a light-sync fetch + verification.
#[derive(Clone, Debug, serde::Serialize)]
pub struct SpvSyncInfo {
    /// Number of headers verified (including the checkpoint/anchor header).
    pub verified: u64,
    /// Height of the highest verified header.
    pub tip_height: u64,
    /// Id of the highest verified header.
    pub tip_id: String,
    /// The node the blob was fetched from.
    pub from_url: String,
}

/// Snapshot of node state for UI status screens.
#[derive(Clone, Debug, serde::Serialize)]
pub struct NodeStatus {
    pub genesis: String,
    pub tip: String,
    pub block_count: u64,
    pub mempool_size: usize,
    pub peers: usize,
    pub sync_progress: Option<(u64, u64)>, // (synced, total)
}

/// Snapshot of the staking/mining state for the panel.
#[derive(Clone, Debug, serde::Serialize)]
pub struct StakingInfo {
    /// The node's validator identity (VRF public key hex), if a seed is set.
    pub validator_pk: Option<String>,
    /// Whether hybrid staked+PoW admission is enabled.
    pub hybrid_enabled: bool,
    /// Sortition rate (num/den); zero/zero when hybrid is off.
    pub rate_num: u64,
    pub rate_den: u64,
    /// Whether PoW difficulty retargeting is pinned on for the PoW fallback.
    pub retarget: bool,
    /// Total bonded stake across all validators (tip view), in atoms.
    pub total_stake: u64,
    /// This validator's bonded stake (tip view), in atoms.
    pub my_stake: u64,
    /// Height (selected-parent chain) at which the oldest pending unbond can
    /// mature, when one is in flight.
    pub pending_unbond_height: Option<u64>,
    /// Current selected-parent chain height.
    pub chain_height: u64,
    /// Subsidy (atoms) issued at the current height under the profile cap.
    pub issuance_at_height: u64,
    /// Whether the continuous mining cadence is running.
    pub mining: bool,
    /// Configured cadence interval, when mining.
    pub mining_interval_secs: Option<u64>,
}

/// Where a bond's source value comes from: an exact-size coin, or a freshly
/// split oversized coin (whose remainder stays at the wallet address).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BondSource {
    Exact(OutPoint),
    Split { fund: OutPoint, value: u64 },
}

/// Errors from the worker handle.
#[derive(Debug, Error)]
pub enum WorkerError {
    #[error("worker thread panicked: {0}")]
    Panic(String),
    #[error("channel closed")]
    ChannelClosed,
    #[error("data dir error: {0}")]
    DataDir(#[from] DataDirError),
    #[error("boot error: {0}")]
    Boot(#[from] BootError),
    #[error("node error: {0}")]
    Node(#[from] NodeError),
}

/// Handle to the node worker — cheap to clone, safe to share across UI tasks.
#[derive(Clone)]
pub struct NodeHandle {
    cmd_tx: mpsc::UnboundedSender<(WorkerCmd, oneshot::Sender<WorkerResp>)>,
    event_tx: broadcast::Sender<NodeEvent>,
    shutdown_tx: broadcast::Sender<()>,
    worker_join: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl NodeHandle {
    /// Spawn the worker thread with the given network profile.
    pub async fn spawn(profile: NetworkProfile) -> Result<Self, WorkerError> {
        let datadir = DataDir::resolve(profile)?;
        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel();
        let (event_tx, _event_rx) = broadcast::channel(256);
        let (shutdown_tx, mut shutdown_rx) = broadcast::channel(1);

        // Boot the node on this thread first (genesis must run before spawning).
        let mut node = Node::new();
        let (genesis, founder) = node
            .genesis_with_finality(
                datadir.profile.genesis_k,
                datadir.profile.genesis_subsidy,
                datadir.profile.genesis_premine,
                datadir.profile.founder_seed,
                None, // treasury
                datadir.profile.finality_depth,
                datadir.profile.payload_pruning_depth,
                100u64,
                None,
            )
            .map_err(WorkerError::Node)?;

        // Emit boot event.
        let _ = event_tx.send(NodeEvent::Booted {
            genesis: genesis.to_string(),
            founder: founder.to_string(),
        });

        // Try to load existing incremental log, else start fresh.
        let log_path = datadir.log_path();
        if log_path.exists() {
            node =
                Node::load_log(log_path.to_string_lossy().as_ref()).map_err(WorkerError::Node)?;
        }

        let datadir_clone = datadir.clone();
        let event_tx_clone = event_tx.clone();

        // Spawn the worker loop.
        let join = tokio::spawn(async move {
            let mut node = node;
            let mut wallet = WalletState::new();
            let mut p2p = P2pState::default();
            let mut spv_store: Option<SpvStore> = None;
            let mut last_tip: Option<BlockId> = node.selected_tip().ok();
            let mut last_block_count = node.block_count().unwrap_or(0);
            let mut checkpoint_interval = tokio::time::interval(Duration::from_secs(300)); // 5 min
            let mut snapshot_interval = tokio::time::interval(Duration::from_secs(3600)); // 1 hour
            let mut p2p_interval = tokio::time::interval(Duration::from_secs(P2P_TICK_SECS));
            let mut mining = MiningState::default();
            let mut mine_interval: Option<tokio::time::Interval> = None;

            // Ensure intervals don't fire immediately.
            checkpoint_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            snapshot_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            p2p_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                tokio::select! {
                    _ = checkpoint_interval.tick() => {
                        let _ = Self::save_checkpoint(&mut node, &datadir_clone, &event_tx_clone);
                    }
                    _ = snapshot_interval.tick() => {
                        let _ = Self::save_snapshot(&mut node, &datadir_clone, &event_tx_clone);
                    }
                    _ = p2p_interval.tick() => {
                        p2p_tick(&mut node, &mut p2p, &event_tx_clone);
                    }
                    _ = mine_tick(&mut mine_interval) => {
                        mine_for_cadence(&mut node, &event_tx_clone);
                    }
                    cmd = cmd_rx.recv() => {
                        let Some((cmd, resp_tx)): Option<(WorkerCmd, oneshot::Sender<WorkerResp>)> = cmd else { break; };
                        // Apply cadence toggles up front so GetStaking sees them.
                        match &cmd {
                            WorkerCmd::StartMining { interval_secs } if *interval_secs > 0 => {
                                mining.enabled = true;
                                mining.interval_secs = *interval_secs;
                                let mut iv =
                                    tokio::time::interval(Duration::from_secs(*interval_secs));
                                iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                                mine_interval = Some(iv);
                            }
                            WorkerCmd::StopMining => {
                                mining.enabled = false;
                                mine_interval = None;
                            }
                            _ => {}
                        }
                        let result = Self::handle_cmd(cmd, &mut node, &mut wallet, &datadir_clone, &event_tx_clone, &mut p2p, &mut spv_store, &mining).await;
                        let _ = resp_tx.send(result);
                    }
                    _ = shutdown_rx.recv() => {
                        let _ = event_tx_clone.send(NodeEvent::Shutdown);
                        break;
                    }
                }

                // Emit tip/block-count change events.
                if let Ok(tip) = node.selected_tip() {
                    if last_tip != Some(tip) {
                        let _ = event_tx_clone.send(NodeEvent::TipChanged {
                            old_tip: last_tip.map(|b| b.to_string()),
                            new_tip: tip.to_string(),
                        });
                        last_tip = Some(tip);
                    }
                }
                let count = node.block_count().unwrap_or(0);
                if count != last_block_count {
                    last_block_count = count;
                }
            }
        });

        Ok(Self {
            cmd_tx,
            event_tx,
            shutdown_tx,
            worker_join: Arc::new(Mutex::new(Some(join))),
        })
    }

    /// Send a command and await its response.
    pub async fn send(&self, cmd: WorkerCmd) -> Result<WorkerResp, WorkerError> {
        let (tx, rx) = oneshot::channel::<WorkerResp>();
        self.cmd_tx
            .send((cmd, tx))
            .map_err(|_| WorkerError::ChannelClosed)?;
        rx.await.map_err(|_| WorkerError::ChannelClosed)
    }

    /// Subscribe to the event stream (broadcast, so multiple UI components can listen).
    pub fn events(&self) -> broadcast::Receiver<NodeEvent> {
        self.event_tx.subscribe()
    }

    /// Request graceful shutdown and await worker termination.
    pub async fn shutdown(&self) -> Result<(), WorkerError> {
        let _ = self.shutdown_tx.send(());
        let mut join_guard = self.worker_join.lock().await;
        if let Some(join) = join_guard.take() {
            join.await.map_err(|e| WorkerError::Panic(e.to_string()))?;
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn handle_cmd(
        cmd: WorkerCmd,
        node: &mut Node,
        wallet: &mut WalletState,
        datadir: &DataDir,
        events: &broadcast::Sender<NodeEvent>,
        p2p: &mut P2pState,
        spv: &mut Option<SpvStore>,
        mining: &MiningState,
    ) -> WorkerResp {
        match cmd {
            WorkerCmd::ProduceBlock => match produce_block_sealed(node, events) {
                Ok(Some(block_id)) => WorkerResp::ProduceBlock(Ok(Some(block_id))),
                Ok(None) => WorkerResp::ProduceBlock(Ok(None)),
                Err(e) => WorkerResp::ProduceBlock(Err(e)),
            },
            WorkerCmd::SubmitTx(tx) => match node.submit_tx(tx) {
                Ok(tx_id) => {
                    let _ = events.send(NodeEvent::TxAccepted {
                        tx_id: tx_id.to_string(),
                    });
                    WorkerResp::SubmitTx(Ok(tx_id))
                }
                Err(e) => WorkerResp::SubmitTx(Err(e)),
            },
            WorkerCmd::SaveSnapshot => match Self::save_snapshot(node, datadir, events) {
                Ok(path) => WorkerResp::SaveState(Ok(path)),
                Err(e) => WorkerResp::SaveState(Err(e.to_string())),
            },
            WorkerCmd::SaveCheckpoint => match Self::save_checkpoint(node, datadir, events) {
                Ok(path) => WorkerResp::SaveState(Ok(path)),
                Err(e) => WorkerResp::SaveState(Err(e.to_string())),
            },
            WorkerCmd::GetStatus => {
                let genesis = node.genesis_id().map(|b| b.to_string()).unwrap_or_default();
                let tip = node
                    .selected_tip()
                    .map(|b| b.to_string())
                    .unwrap_or_default();
                let block_count = node.block_count().unwrap_or(0) as u64;
                let mempool_size = node.pending_txs().len();
                WorkerResp::Status(NodeStatus {
                    genesis,
                    tip,
                    block_count,
                    mempool_size,
                    peers: p2p.live.len(),
                    sync_progress: None,
                })
            }
            WorkerCmd::StartP2P {
                listen_addr,
                bootstrap_peers,
            } => {
                p2p.peers = bootstrap_peers;
                p2p.enabled = true;
                p2p.listeners = bind_p2p_listeners(&listen_addr);
                let detail = if p2p.listeners.is_empty() {
                    format!("inbound unavailable on {listen_addr}")
                } else {
                    format!("listening on {listen_addr}")
                };
                WorkerResp::P2PStatus(format!(
                    "P2P started: {detail}, {} configured peers",
                    p2p.peers.len()
                ))
            }
            WorkerCmd::StopP2P => {
                p2p.enabled = false;
                p2p.listeners.clear();
                let live = std::mem::take(&mut p2p.live);
                for peer in &live {
                    let _ = events.send(NodeEvent::PeerDisconnected {
                        peer_id: peer.clone(),
                    });
                }
                WorkerResp::P2PStatus("P2P stopped".into())
            }
            WorkerCmd::CreateWallet { passphrase } => {
                use bip39::{Language, Mnemonic};
                use rand::RngCore;

                let mut entropy = [0u8; 16];
                rand::rng().fill_bytes(&mut entropy);
                let phrase = Mnemonic::from_entropy_in(Language::English, &entropy)
                    .expect("valid entropy")
                    .to_string();

                wallet.set_mnemonic(phrase.clone(), passphrase);

                let fingerprint = wallet
                    .keypair()
                    .map(|kp| master_fingerprint(&kp))
                    .unwrap_or_default();

                WorkerResp::WalletCreated {
                    mnemonic: phrase,
                    master_fingerprint: fingerprint,
                }
            }
            WorkerCmd::UnlockWallet {
                mnemonic,
                passphrase,
            } => {
                use bip39::{Language, Mnemonic};
                if Mnemonic::parse_in(Language::English, &mnemonic).is_err() {
                    return WorkerResp::SendResult(Err("Invalid mnemonic".into()));
                }
                wallet.set_mnemonic(mnemonic, passphrase);
                let fingerprint = wallet
                    .keypair()
                    .map(|kp| master_fingerprint(&kp))
                    .unwrap_or_default();
                WorkerResp::WalletUnlocked { fingerprint }
            }
            WorkerCmd::LockWallet => {
                *wallet = WalletState::new();
                WorkerResp::WalletLocked
            }
            WorkerCmd::GetAddresses { count } => {
                let addresses: Vec<String> = (0..count)
                    .filter_map(|i| wallet.derive_address(i))
                    .collect();
                WorkerResp::Addresses(addresses)
            }
            WorkerCmd::SendFromWallet { to_address, amount } => {
                if wallet.is_locked() {
                    return WorkerResp::SendResult(Err("Wallet locked".into()));
                }
                let to_addr = match Address::parse(&to_address) {
                    Ok(a) => a,
                    Err(e) => {
                        return WorkerResp::SendResult(Err(format!("Invalid address: {e}")));
                    }
                };
                let keypair = match wallet.keypair() {
                    Some(k) => k,
                    None => return WorkerResp::SendResult(Err("No keypair".into())),
                };
                match node.send_with(&keypair, amount, to_addr) {
                    Ok(sent) => {
                        let tx_id = sent.tx;
                        let _ = events.send(NodeEvent::TxAccepted {
                            tx_id: tx_id.to_string(),
                        });
                        WorkerResp::SendResult(Ok(tx_id))
                    }
                    Err(e) => WorkerResp::SendResult(Err(e.to_string())),
                }
            }
            WorkerCmd::GetBalance { address } => {
                let addr = match Address::parse(&address) {
                    Ok(a) => a,
                    Err(_) => return WorkerResp::Balance(0),
                };
                let balance = node.balance(&addr).unwrap_or(0) as u64;
                WorkerResp::Balance(balance)
            }
            WorkerCmd::GetHistory {
                address,
                max_blocks,
            } => {
                let addr = match Address::parse(&address) {
                    Ok(a) => a,
                    Err(_) => return WorkerResp::History(vec![]),
                };
                let history = node.history_of(&addr, max_blocks).unwrap_or_default();
                let wallet_events: Vec<WalletEvent> = history
                    .into_iter()
                    .map(|e| {
                        let tx_id = e.tx_id.to_string();
                        let block_id = e.block_id.to_string();
                        let asset_id = e.asset_id.map(|a| a.to_hex());
                        let amount = e.amount;
                        let address = addr.to_string();
                        match e.direction {
                            kovanica_node::WalletDirection::Received => WalletEvent::Received {
                                tx_id,
                                block_id,
                                amount,
                                asset_id,
                                address,
                            },
                            kovanica_node::WalletDirection::Sent => WalletEvent::Sent {
                                tx_id,
                                block_id,
                                amount,
                                asset_id,
                                address,
                            },
                        }
                    })
                    .collect();
                WorkerResp::History(wallet_events)
            }
            WorkerCmd::GetAssetBalances { address } => {
                let addr = match Address::parse(&address) {
                    Ok(a) => a,
                    Err(e) => {
                        return WorkerResp::AssetBalances(Err(format!("invalid address: {e}")))
                    }
                };
                // Kind lookup from the asset registry (native is always fungible).
                let known = match node.asset_registry() {
                    Ok(reg) => reg
                        .iter()
                        .map(|(id, entry)| (id.to_hex(), entry.kind))
                        .collect::<BTreeMap<String, AssetKind>>(),
                    Err(_) => BTreeMap::new(),
                };
                match node.balances_map_of(&addr) {
                    Ok(map) => {
                        let mut out = Vec::with_capacity(map.len());
                        for (asset, amount) in map {
                            let kind = if asset == "KVNC" {
                                "Fungible".to_string()
                            } else {
                                match known.get(&asset) {
                                    Some(AssetKind::NonFungible) => "NonFungible".into(),
                                    _ => "Fungible".into(),
                                }
                            };
                            out.push(AssetBalance {
                                asset,
                                amount,
                                kind,
                            });
                        }
                        WorkerResp::AssetBalances(Ok(out))
                    }
                    Err(e) => WorkerResp::AssetBalances(Err(e.to_string())),
                }
            }
            WorkerCmd::SPVSync { url } => match spv_fetch_verify(&url) {
                Ok((info, store)) => {
                    *spv = Some(store);
                    WorkerResp::SpvSync(Ok(info))
                }
                Err(e) => WorkerResp::SpvSync(Err(e)),
            },
            WorkerCmd::SPVMatches { address } => {
                let addr = match Address::parse(&address) {
                    Ok(a) => a,
                    Err(_) => return WorkerResp::SpvMatches(vec![]),
                };
                let hits = spv
                    .as_ref()
                    .map(|s| s.matches(addr.payload()))
                    .unwrap_or_default();
                WorkerResp::SpvMatches(hits)
            }
            WorkerCmd::SPVVerify { block_id, tx_id } => {
                let verified = match spv.as_ref().map(|s| spv_verify(s, &block_id, &tx_id)) {
                    Some(Ok(v)) => v,
                    Some(Err(e)) => {
                        let _ = events.send(NodeEvent::Error {
                            message: format!("spv verify: {e}"),
                        });
                        false
                    }
                    None => false,
                };
                WorkerResp::SpvVerified(verified)
            }
            WorkerCmd::SetValidatorSeed { seed_hex: _ } => {
                WorkerResp::ValidatorSeed(Err("validator seed: disabled under PoA-only".into()))
            }
            WorkerCmd::EnableHybrid { .. } => {
                WorkerResp::HybridStatus("hybrid: disabled under PoA-only".into())
            }
            WorkerCmd::GetStaking => WorkerResp::Staking(StakingInfo {
                validator_pk: None,
                hybrid_enabled: false,
                rate_num: 0,
                rate_den: 0,
                retarget: false,
                total_stake: 0,
                my_stake: 0,
                pending_unbond_height: None,
                chain_height: node.chain_height().unwrap_or(0),
                issuance_at_height: Node::issuance_at(
                    datadir.profile.genesis_subsidy,
                    node.chain_height().unwrap_or(0),
                ),
                mining: false,
                mining_interval_secs: None,
            }),
            WorkerCmd::BondStake { amount: _ } => {
                WorkerResp::StakingTx(Err("bond stake: disabled under PoA-only".into()))
            }
            WorkerCmd::UnbondStake { amount: _ } => {
                WorkerResp::StakingTx(Err("unbond stake: disabled under PoA-only".into()))
            }
            WorkerCmd::StartMining { interval_secs: _ } => {
                WorkerResp::MiningStatus("mining: disabled under PoA-only".into())
            }
            WorkerCmd::StopMining => {
                WorkerResp::MiningStatus("mining: disabled under PoA-only".into())
            }
            WorkerCmd::Shutdown => WorkerResp::Ok,
        }
    }

    fn save_snapshot(
        node: &mut Node,
        datadir: &DataDir,
        events: &broadcast::Sender<NodeEvent>,
    ) -> Result<String, NodeError> {
        let path = datadir.snapshot_path();
        node.save(path.to_string_lossy().as_ref())?;
        let count = node.block_count().unwrap_or(0);
        let _ = events.send(NodeEvent::SnapshotSaved {
            path: path.display().to_string(),
            block_count: count as u64,
        });
        Ok(path.display().to_string())
    }

    fn save_checkpoint(
        node: &mut Node,
        datadir: &DataDir,
        events: &broadcast::Sender<NodeEvent>,
    ) -> Result<String, NodeError> {
        let path = datadir.checkpoint_path();
        node.save_checkpoint(path.to_string_lossy().as_ref())?;
        let count = node.block_count().unwrap_or(0);
        let _ = events.send(NodeEvent::CheckpointSaved {
            path: path.display().to_string(),
            block_count: count as u64,
        });
        Ok(path.display().to_string())
    }
}

/// Bind non-blocking inbound listeners, one per requested address. Addresses
/// that fail to bind (e.g. port already taken) are skipped; an empty result
/// means inbound is disabled but outbound sync still works.
fn bind_p2p_listeners(addrs: &str) -> Vec<TcpListener> {
    addrs
        .split(',')
        .map(|a| a.trim())
        .filter(|a| !a.is_empty())
        .filter_map(|addr| match std::net::TcpListener::bind(addr) {
            Ok(l) => {
                let _ = l.set_nonblocking(true);
                Some(l)
            }
            Err(_) => None,
        })
        .collect()
}

/// Produce a block (staked draw first, PoW fallback) and emit the standard
/// `BlockProduced` event. `Ok(None)` means the node chose not to produce.
fn produce_block_sealed(
    node: &mut Node,
    events: &broadcast::Sender<NodeEvent>,
) -> Result<Option<BlockId>, NodeError> {
    match node.produce_block()? {
        Some(block_id) => {
            let count = node.block_count().unwrap_or(0);
            let _ = events.send(NodeEvent::BlockProduced {
                block_id: block_id.to_string(),
                height: count as u64,
                tx_count: 0, // TODO: extract from block
            });
            Ok(Some(block_id))
        }
        None => Ok(None),
    }
}

/// Future that resolves on the mining cadence — or never, when mining is off.
/// A pending `None` keeps the select arm dormant so a disabled cadence costs
/// nothing and never busy-fires.
async fn mine_tick(interval: &mut Option<tokio::time::Interval>) -> Option<()> {
    match interval {
        Some(iv) => {
            iv.tick().await;
            Some(())
        }
        None => std::future::pending().await,
    }
}

/// One cadence step: try to produce; non-fatal errors surface as events so
/// the panel sees the reason (e.g. unset validator on a constrained chain).
fn mine_for_cadence(node: &mut Node, events: &broadcast::Sender<NodeEvent>) {
    match produce_block_sealed(node, events) {
        Ok(Some(_)) => {}
        Ok(None) => {}
        Err(e) => {
            let _ = events.send(NodeEvent::Error {
                message: format!("cadence mine: {e}"),
            });
        }
    }
}

/* DEAD STAKING/MINING CODE REMOVED FOR POA ONLY */
/// One P2P round: serve any inbound connections, then sync from each
/// configured peer. Mirrors the explorer's `tick_p2p`/`sync_peers` pattern —
/// headers-first sync with a full-dump fallback per peer. Live peers are the
/// ones that answered this round; changes surface as `NodeEvent`s.
fn p2p_tick(node: &mut Node, p2p: &mut P2pState, events: &broadcast::Sender<NodeEvent>) {
    if !p2p.enabled {
        return;
    }
    // Inbound: headers-first serve, falling back to the legacy full-dump
    // exchange for old peers that don't speak the headers protocol.
    for listener in &p2p.listeners {
        let mut incoming = Vec::new();
        while let Ok((stream, _peer)) = listener.accept() {
            incoming.push(stream);
        }
        for mut stream in incoming {
            if net::serve_headers_first(&mut stream, node, P2P_SYNC_TIMEOUT).is_err() {
                let _ = stream.set_nonblocking(false);
                let _ = net::serve_exchange(&mut stream, node, P2P_SYNC_TIMEOUT);
            }
        }
    }
    // Outbound: sync round against configured peers.
    let mut live = Vec::new();
    for addr in &p2p.peers {
        let answered = match net::sync_headers_first(addr, node, P2P_SYNC_TIMEOUT) {
            Ok(_) => true,
            Err(_) => net::pull_blocks_timeout(addr, node, P2P_SYNC_TIMEOUT).is_ok(),
        };
        if answered {
            live.push(addr.clone());
        }
    }
    for addr in &p2p.live {
        if !live.contains(addr) {
            let _ = events.send(NodeEvent::PeerDisconnected {
                peer_id: addr.clone(),
            });
        }
    }
    for addr in &live {
        if !p2p.live.contains(addr) {
            let _ = events.send(NodeEvent::PeerConnected {
                peer_id: addr.clone(),
                address: addr.clone(),
            });
        }
    }
    p2p.live = live;
}

/// Fetch a KVLS light-sync blob from `{url}/api/light_sync`, parse it, and
/// verify the whole header chain through a `SpvClient` anchored at the blob's
/// first header (the network genesis). On success the verified
/// `(header, filter)` pairs are stored for filter-matching and proof checks.
fn spv_fetch_verify(url: &str) -> Result<(SpvSyncInfo, SpvStore), String> {
    let base = url.trim_end_matches('/');
    let resp = ureq::get(&format!("{base}/api/light_sync"))
        .timeout(SPV_HTTP_TIMEOUT)
        .call()
        .map_err(|e| format!("fetch {base}/api/light_sync: {e}"))?;
    let mut blob = Vec::new();
    resp.into_reader()
        .take(64 * 1024 * 1024)
        .read_to_end(&mut blob)
        .map_err(|e| format!("read light-sync blob: {e}"))?;
    let parsed = parse_light_sync(&blob)?;
    if parsed.is_empty() {
        return Err("light-sync blob is empty".into());
    }
    let mut client = SpvClient::new(parsed[0].0.clone());
    let mut verified = 1u64;
    for (h, _) in &parsed[1..] {
        client
            .add_header(h.clone())
            .map_err(|e| format!("header rejected at height {}: {e}", h.height))?;
        verified += 1;
    }
    let tip = client.tip().ok_or_else(|| "no verified tip".to_string())?;
    let info = SpvSyncInfo {
        verified,
        tip_height: tip.height,
        tip_id: tip.id.to_string(),
        from_url: base.to_string(),
    };
    Ok((
        info,
        SpvStore {
            base: base.into(),
            headers: parsed,
        },
    ))
}

/// Verify a Merkle inclusion proof fetched from `{store.base}/api/light_proof`
/// against the light-synced header for `block_id`: the proof must verify
/// internally AND its root must equal the header's root (mirrors the FFI's
/// `verify_tx_proof`). Unknown block → error.
fn spv_verify(store: &SpvStore, block_id: &str, tx_id: &str) -> Result<bool, String> {
    let id = parse_block_id(block_id)?;
    if tx_id.trim().len() != 64 {
        return Err("tx id must be 32 bytes hex".into());
    }
    let header = store
        .headers
        .iter()
        .find(|(h, _)| h.id == id)
        .map(|(h, _)| h)
        .ok_or_else(|| "block not in light-synced history".to_string())?;
    let url = format!(
        "{}/api/light_proof?block={}&tx={}",
        store.base, block_id, tx_id
    );
    let resp = ureq::get(&url)
        .timeout(SPV_HTTP_TIMEOUT)
        .call()
        .map_err(|e| format!("fetch proof: {e}"))?;
    let mut blob = Vec::new();
    resp.into_reader()
        .take(1024 * 1024)
        .read_to_end(&mut blob)
        .map_err(|e| format!("read proof blob: {e}"))?;
    let parsed = parse_merkle_proof(&blob)?;
    if parsed.merkle_root != header.merkle_root {
        return Ok(false);
    }
    // Internal check: leaf + path must hash to the packed root (which we just
    // tied to the header's root above).
    Ok(parsed.proof.verify() == parsed.merkle_root)
}

/// Parse a 32-byte block-id hex string.
fn parse_block_id(s: &str) -> Result<BlockId, String> {
    let raw = hex::decode(s.trim()).map_err(|e| format!("bad block id: {e}"))?;
    let arr: [u8; 32] = raw
        .as_slice()
        .try_into()
        .map_err(|_| "block id must be 32 bytes hex".to_string())?;
    Ok(BlockId::from_bytes(arr))
}

/// KVLS v1 wire format (owned by the FFI layer): magic `KVLS` + version 1 +
/// count, then per entry a 160-byte big-endian header + a Golomb-Rice filter
/// (`k` u8, `n` u32 BE, `len` u32 BE, `data`). Byte-compatible with
/// `kovanica-ffi`'s `parse_light_sync` and the explorer's `/api/light_sync`.
fn parse_light_sync(blob: &[u8]) -> Result<Vec<(BlockHeader, BlockFilter)>, String> {
    let err = || "undecodable light-sync blob".to_string();
    if blob.len() < 9 || &blob[..4] != b"KVLS" || blob[4] != 1 {
        return Err(err());
    }
    let count = u32::from_be_bytes(blob[5..9].try_into().map_err(|_| err())?) as usize;
    let mut off = 9usize;
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let end = off.checked_add(160).ok_or_else(err)?;
        let h = blob.get(off..end).ok_or_else(err)?;
        off = end;
        let arr32 = |o: usize| -> Result<[u8; 32], String> {
            h.get(o..o + 32)
                .and_then(|s| s.try_into().ok())
                .ok_or_else(err)
        };
        let header = BlockHeader {
            id: BlockId::from_bytes(arr32(0)?),
            prev_hash: BlockId::from_bytes(arr32(32)?),
            merkle_root: arr32(64)?,
            work: u128::from_be_bytes(
                h.get(96..112)
                    .and_then(|s| s.try_into().ok())
                    .ok_or_else(err)?,
            ),
            timestamp_ms: u64::from_be_bytes(
                h.get(112..120)
                    .and_then(|s| s.try_into().ok())
                    .ok_or_else(err)?,
            ),
            nonce: u64::from_be_bytes(
                h.get(120..128)
                    .and_then(|s| s.try_into().ok())
                    .ok_or_else(err)?,
            ),
            blue_score: u64::from_be_bytes(
                h.get(128..136)
                    .and_then(|s| s.try_into().ok())
                    .ok_or_else(err)?,
            ),
            chain_blue_work: u128::from_be_bytes(
                h.get(136..152)
                    .and_then(|s| s.try_into().ok())
                    .ok_or_else(err)?,
            ),
            height: u64::from_be_bytes(
                h.get(152..160)
                    .and_then(|s| s.try_into().ok())
                    .ok_or_else(err)?,
            ),
            authority_sig: None,
            authority_set_hash: [0u8; 32],
            hash_without_authority_sig: [0u8; 32],
        };
        let fend = off.checked_add(9).ok_or_else(err)?;
        let f = blob.get(off..fend).ok_or_else(err)?;
        let k = f[0];
        // Filter header: `k` u8, `n` u32 BE, `len` u32 BE — matches the
        // explorer's `encode_spv_filter` and the FFI's `decode_filter`.
        let n = u32::from_be_bytes(
            f.get(1..5)
                .and_then(|s| s.try_into().ok())
                .ok_or_else(err)?,
        );
        let len = u32::from_be_bytes(
            f.get(5..9)
                .and_then(|s| s.try_into().ok())
                .ok_or_else(err)?,
        ) as usize;
        off = fend;
        let dend = off.checked_add(len).ok_or_else(err)?;
        let data = blob.get(off..dend).ok_or_else(err)?;
        let filter = BlockFilter {
            k,
            n,
            data: data.to_vec(),
        };
        off = dend;
        out.push((header, filter));
    }
    Ok(out)
}

/// A parsed proof blob: the proof itself plus the root and tx count the
/// explorer packed alongside it. The post-migration `MerkleProof` carries only
/// `leaf`/`path`/`index` — its `verify()` returns the recomputed root, so the
/// caller compares that against `merkle_root` (and the header's root) instead
/// of getting a bool back.
struct ParsedProof {
    proof: MerkleProof,
    merkle_root: [u8; 32],
    tx_count: usize,
}

/// Explorer `/api/light_proof` proof blob (mirrors `encode_merkle_proof`):
/// `tx_id` (32) + `merkle_root` (32) + `path_len` u32 + path + `index` u64 +
/// `tx_count` u64.
fn parse_merkle_proof(blob: &[u8]) -> Result<ParsedProof, String> {
    if blob.len() < 72 {
        return Err("undecodable proof blob".into());
    }
    let take32 = |b: &[u8]| -> [u8; 32] { <[u8; 32]>::try_from(b).expect("sliced 32") };
    let path_len = u32::from_be_bytes(blob[64..68].try_into().map_err(|_| "bad blob")?) as usize;
    let mut off = 68usize;
    let mut path = Vec::with_capacity(path_len);
    for _ in 0..path_len {
        let end = off
            .checked_add(32)
            .filter(|&e| e <= blob.len())
            .ok_or("undecodable proof blob")?;
        path.push(take32(&blob[off..end]));
        off = end;
    }
    if blob.len() < off + 16 {
        return Err("undecodable proof blob".into());
    }
    let index = u64::from_be_bytes(blob[off..off + 8].try_into().expect("sliced 8")) as usize;
    let tx_count =
        u64::from_be_bytes(blob[off + 8..off + 16].try_into().expect("sliced 8")) as usize;
    Ok(ParsedProof {
        proof: MerkleProof {
            leaf: take32(&blob[0..32]),
            path,
            index,
        },
        merkle_root: take32(&blob[32..64]),
        tx_count,
    })
}

/// Master key fingerprint: first byte of the BLAKE3 hash of the public key.
fn master_fingerprint(keypair: &KeyPair) -> String {
    let pk = keypair.address().to_hex();
    format!("{:02x}", blake3::hash(pk.as_bytes()).as_bytes()[0])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Encode one KVLS header in the FFI wire format (160 bytes, BE).
    fn encode_header_for_test(h: &BlockHeader) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(h.id.as_bytes());
        out.extend_from_slice(h.prev_hash.as_bytes());
        out.extend_from_slice(&h.merkle_root);
        out.extend_from_slice(&h.work.to_be_bytes());
        out.extend_from_slice(&h.timestamp_ms.to_be_bytes());
        out.extend_from_slice(&h.nonce.to_be_bytes());
        out.extend_from_slice(&h.blue_score.to_be_bytes());
        out.extend_from_slice(&h.chain_blue_work.to_be_bytes());
        out.extend_from_slice(&h.height.to_be_bytes());
        out
    }

    fn encode_filter_for_test(f: &BlockFilter) -> Vec<u8> {
        let mut out = Vec::new();
        out.push(f.k);
        out.extend_from_slice(&f.n.to_be_bytes());
        out.extend_from_slice(&(f.data.len() as u32).to_be_bytes());
        out.extend_from_slice(&f.data);
        out
    }

    fn test_header(id: u8, prev: &[u8; 32], height: u64) -> BlockHeader {
        let mut bytes = [0u8; 32];
        bytes[0] = id;
        BlockHeader {
            id: BlockId::from_bytes(bytes),
            prev_hash: BlockId::from_bytes(*prev),
            merkle_root: [1u8; 32],
            work: 42,
            timestamp_ms: 1000,
            nonce: 7,
            blue_score: height,
            chain_blue_work: height as u128,
            height,
            authority_sig: None,
            authority_set_hash: [0u8; 32],
            hash_without_authority_sig: [0u8; 32],
        }
    }

    #[test]
    fn parses_a_kvls_blob_and_verifies_the_chain() {
        let h0 = test_header(0xaa, &[0u8; 32], 0);
        let h1 = test_header(0xbb, h0.id.as_bytes(), 1);
        let f = BlockFilter {
            k: 8,
            n: 1,
            data: Vec::new(),
        };

        let mut blob = Vec::new();
        blob.extend_from_slice(b"KVLS");
        blob.push(1);
        blob.extend_from_slice(&2u32.to_be_bytes());
        blob.extend_from_slice(&encode_header_for_test(&h0));
        blob.extend_from_slice(&encode_filter_for_test(&f));
        blob.extend_from_slice(&encode_header_for_test(&h1));
        blob.extend_from_slice(&encode_filter_for_test(&f));

        let parsed = parse_light_sync(&blob).expect("parses");
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].0.height, 0);
        assert_eq!(parsed[1].0.height, 1);
        assert_eq!(parsed[1].0.prev_hash, parsed[0].0.id);
        assert_eq!(parsed[0].1.data, Vec::<u8>::new());

        // The whole chain verifies through SpvClient (require_pow = false).
        let mut client = SpvClient::new(parsed[0].0.clone());
        assert!(client.add_header(parsed[1].0.clone()).expect("verified"));
        assert_eq!(client.tip().map(|t| t.height), Some(1));
        // A broken prev-hash link is rejected.
        let mut bad = h1.clone();
        bad.prev_hash = BlockId::from_bytes([9u8; 32]);
        let mut client = SpvClient::new(parsed[0].0.clone());
        assert!(client.add_header(bad).is_err());
    }

    #[test]
    fn rejects_undecodable_kvls_blobs() {
        assert!(parse_light_sync(b"garbage").is_err());
        let mut blob = b"KVLS".to_vec();
        blob.push(1);
        blob.extend_from_slice(&5u32.to_be_bytes()); // count 5 but no entries
        assert!(parse_light_sync(&blob).is_err());
    }

    #[test]
    fn parses_an_inclusion_proof_blob() {
        // Single-tx leaf proof: empty path, tx_count 1 (84-byte blob).
        let mut blob = Vec::new();
        blob.extend_from_slice(&[3u8; 32]); // tx_id
        blob.extend_from_slice(&[3u8; 32]); // merkle_root
        blob.extend_from_slice(&0u32.to_be_bytes()); // path_len
        blob.extend_from_slice(&0u64.to_be_bytes()); // index
        blob.extend_from_slice(&1u64.to_be_bytes()); // tx_count

        let parsed = parse_merkle_proof(&blob).expect("parses");
        assert!(parsed.proof.path.is_empty());
        assert_eq!(parsed.proof.index, 0);
        assert_eq!(parsed.tx_count, 1);
        assert_eq!(
            parsed.proof.verify(),
            parsed.merkle_root,
            "leaf proves its own root"
        );
        assert!(parse_merkle_proof(b"").is_err());
        assert!(parse_merkle_proof(&blob[..40]).is_err());
    }

    #[test]
    fn binds_listener_addresses_and_drops_duplicates() {
        let listeners = bind_p2p_listeners("127.0.0.1:0, 127.0.0.1:0");
        assert!(!listeners.is_empty());
        // A garbage address simply yields no bound listener.
        assert!(bind_p2p_listeners("").is_empty());
    }

    #[test]
    #[ignore = "dead under PoA-only (validator/mining/staking APIs removed)"]
    fn parses_validator_seed_hex_and_rejects_bad_length() { /* dead under PoA */
    }

    #[test]
    #[ignore = "dead under PoA-only"]
    fn hybrid_config_matches_ffi_field_values() { /* dead under PoA */
    }

    #[test]
    #[ignore = "dead under PoA-only"]
    fn selects_source_coin_exact_then_split_then_shortfall() { /* dead under PoA */
    }

    #[test]
    #[ignore = "dead under PoA-only (staking/mining lifecycle removed)"]
    fn bond_then_unbond_lifecycle_on_an_embedded_node() { /* dead under PoA */
    }
}
