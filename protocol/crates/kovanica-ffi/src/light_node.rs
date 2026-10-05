//! The exported FFI surface: [`LightNode`], a mobile-friendly handle over the
//! full node stack, restricted to what a light validating wallet needs.
//!
//! Design notes:
//! * **Byte-blob sync** — `export_blocks` / `receive_blocks` wrap the exact
//!   gossip wire format (`net::encode_records` / framing reader), so the phone
//!   can carry blobs over any transport (HTTP pull, BLE, QR) and stay
//!   consensus-identical to full nodes.
//! * **u128 safety** — work values and balances are u128 in the protocol but
//!   Kotlin/Swift have no native u128; they cross as hi/lo pairs or decimal
//!   strings. Never widen a Rust `u128` into an FFI integer type.
//! * **Keys stay seed-derived** for now (matching the demo stack); the wallet
//!   holds its seeds and calls methods with them. Moving key custody fully
//!   client-side is follow-up work, not an API break of this surface.
//! * **PoA-only admission** (RFC-POA §0) — `LightConfig` carries the authority
//!   set as **public** keys, because a light node that cannot name the set
//!   cannot verify the authority signature on a block and would be trusting
//!   whichever peer served it. The wallet holds no authority secret: production
//!   is a validator capability, not a wallet one. See `LightConfig` and
//!   RFC-POA-Migration §0.9 (blocker B1) for what that costs a real phone.

use std::sync::{Mutex, MutexGuard};

use kovanica_dag::{AuthorityPublicKey, AuthoritySet, BlockId};
use kovanica_node::{net, Node, TreasuryGenesis};
use kovanica_state::{
    AssetKind, LogoScheme, LogoUri, MetadataScheme, MetadataUri, OutPoint, StealthAddress,
    Transaction, TxOutput, RFC006_PREMINE,
};

/// Why a [`LightNode`] operation failed.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum LightNodeError {
    #[error("node already initialized")]
    AlreadyInitialized,
    #[error("invalid hex in {field}")]
    Hex { field: String },
    #[error("{msg}")]
    Invalid { msg: String },
    #[error("insufficient funds (need an unfrozen coin worth at least {needed})")]
    InsufficientFunds { needed: u64 },
    #[error("secret key must be exactly 32 bytes hex, got {got}")]
    BadSecretLength { expected: u32, got: u32 },
    #[error("node error: {msg}")]
    Node { msg: String },
}

impl From<kovanica_node::NodeError> for LightNodeError {
    fn from(e: kovanica_node::NodeError) -> Self {
        LightNodeError::Node { msg: e.to_string() }
    }
}

fn invalid(msg: impl Into<String>) -> LightNodeError {
    LightNodeError::Invalid { msg: msg.into() }
}

/// Build the PoA authority set from [`LightConfig`].
///
/// Public keys only — a wallet verifies signatures, it never signs blocks, so
/// no secret ever crosses this boundary. `authority_threshold == 0` selects the
/// default strict majority.
fn authority_set_from_config(config: &LightConfig) -> Result<AuthoritySet, LightNodeError> {
    if config.authority_public_keys.is_empty() {
        return Err(invalid(
            "authority_public_keys is empty: a light node needs the PoA authority set to \
             verify block admission (RFC-POA KVP-201)",
        ));
    }
    let mut pks = Vec::with_capacity(config.authority_public_keys.len());
    for hex_pk in &config.authority_public_keys {
        let raw = hex::decode(hex_pk.trim()).map_err(|_| LightNodeError::Hex {
            field: format!("authority_public_keys[{hex_pk}]"),
        })?;
        let bytes: [u8; 32] = raw.as_slice().try_into().map_err(|_| {
            invalid(format!(
                "authority public key must be 32 bytes, got {}",
                raw.len()
            ))
        })?;
        pks.push(
            AuthorityPublicKey::from_bytes(&bytes)
                .map_err(|e| invalid(format!("invalid authority public key {hex_pk}: {e}")))?,
        );
    }
    let threshold = if config.authority_threshold == 0 {
        pks.len() / 2 + 1
    } else {
        config.authority_threshold as usize
    };
    AuthoritySet::new(pks, threshold)
        .map_err(|e| invalid(format!("invalid PoA authority set: {e}")))
}

/// A 128-bit value split across two 64-bit halves — the FFI stand-in for the
/// protocol's `u128` fields (work weights, atom balances).
#[derive(uniffi::Record, Clone, Copy, Debug, PartialEq, Eq)]
pub struct U128Parts {
    pub high: u64,
    pub low: u64,
}

impl U128Parts {
    fn from_u128(v: u128) -> Self {
        Self {
            high: (v >> 64) as u64,
            low: v as u64,
        }
    }

    fn as_u128(self) -> u128 {
        ((self.high as u128) << 64) | self.low as u128
    }

    /// Decimal string, safe for big-number UI rendering.
    pub fn decimal_string(&self) -> String {
        self.as_u128().to_string()
    }
}

/// A summary of one block in this node's DAG — enough for wallets to render
/// history without holding payloads.
#[derive(uniffi::Record, Clone, Debug)]
pub struct BlockInfo {
    /// BLAKE3 block id, lowercase hex (commits to parents+work+ts+nonce+payload).
    pub id_hex: String,
    /// Parent ids, lowercase hex (sorted, de-duplicated, as `Block` stores them).
    pub parents_hex: Vec<String>,
    /// Claimed work weight. Under PoA this is always the nominal `1`
    /// (`POA_NOMINAL_WORK`): admission is by authority signature, not by a
    /// work target, so work carries no ranking weight.
    pub work: U128Parts,
    /// Milliseconds since the UNIX epoch.
    pub timestamp_ms: u64,
}

/// Result of an immediate send: which block sealed the transfer and its tx id.
#[derive(uniffi::Record, Clone, Debug)]
pub struct SendReceipt {
    pub block_id_hex: String,
    pub tx_id_hex: String,
}

/// Direction of a [`HistoryEntry`] relative to the queried address.
#[derive(uniffi::Enum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum TxDirection {
    /// The address received value.
    Received,
    /// The address spent previously-received value.
    Sent,
}

/// One reconstructed history event for an address.
///
/// Entries come back in canonical (linearized) block order; a send's change
/// back to the sender appears as its own `Received` entry.
#[derive(uniffi::Record, Clone, Debug, PartialEq, Eq)]
pub struct HistoryEntry {
    /// Sealing block id (lowercase hex).
    pub block_id_hex: String,
    /// Transaction id (lowercase hex).
    pub tx_id_hex: String,
    /// Credit or debit.
    pub direction: TxDirection,
    /// Value moved, in base units (decimal string).
    pub amount: String,
    /// Asset id (lowercase hex), if non-native. `None` = native KVNC.
    pub asset_id_hex: Option<String>,
}

/// Genesis parameters for a fresh light node.
#[derive(uniffi::Record, Clone, Debug)]
pub struct LightConfig {
    /// GHOSTDAG parameter `k` (merge depth).
    pub k: u16,
    /// Per-block KVNC subsidy.
    pub subsidy: u64,
    /// Genesis coinbase size minted to the founder actor.
    pub founder_amount: u64,
    /// Founder actor seed (deterministic demo keys; real wallets keep custody
    /// client-side — see module docs).
    pub founder_seed: u64,
    /// Finality depth; `u64::MAX` disables finality pruning.
    pub finality_depth: u64,
    /// Payload pruning depth; keep ≥ `finality_depth`.
    pub payload_pruning_depth: u64,
    /// The PoA authority set as lowercase-hex 32-byte Ed25519 **public** keys
    /// (RFC-POA KVP-201, `KVA1 || set_hash`).
    ///
    /// A light node must know this set or it cannot verify the authority
    /// signature on every block it accepts, and would be trusting the peer that
    /// served it. These are public keys: the wallet never holds, and must never
    /// hold, the matching secrets — block production is not a wallet capability.
    ///
    /// Minimum 3 keys (RFC-POA `MIN_AUTHORITIES`). Must be identical across
    /// every node on the network: the set is hashed into the genesis coinbase,
    /// so a different set yields a different genesis id.
    pub authority_public_keys: Vec<String>,
    /// Authority-set threshold M for an on-chain rotation. `0` selects the
    /// default strict majority.
    pub authority_threshold: u32,
    /// Slot duration in milliseconds (RFC-POA default 3000).
    pub slot_duration_ms: u64,
}

impl Default for LightConfig {
    fn default() -> Self {
        Self {
            k: 3,
            subsidy: 1_000,
            founder_amount: 1_000,
            founder_seed: 1,
            finality_depth: u64::MAX,
            payload_pruning_depth: u64::MAX,
            authority_public_keys: Vec::new(),
            authority_threshold: 0,
            slot_duration_ms: kovanica_dag::SLOT_DURATION_MS,
        }
    }
}

/// A newly created multisig P2SH address plus its redeem script.
#[derive(uniffi::Record, Clone, Debug)]
pub struct MultisigAddress {
    /// Human-readable `kvnc…dag` address.
    pub address: String,
    /// The canonical `[M, N, pk1, ..., pkN]` redeem script, lowercase hex.
    pub redeem_script_hex: String,
}

/// An output specification for CoinJoin.
#[derive(uniffi::Record, Clone, Debug)]
pub struct CoinJoinOutput {
    /// The amount in atoms (decimal string).
    pub amount: String,
    /// The recipient address.
    pub to: String,
    /// The asset to use (None = native KVNC).
    pub asset_id_hex: Option<String>,
}

/// A participant in a CoinJoin batch.
#[derive(uniffi::Record, Clone, Debug)]
pub struct CoinJoinParticipant {
    /// The participant's address (must own the UTXOs being spent).
    pub from: String,
    /// The outputs this participant wants to create.
    pub outputs: Vec<CoinJoinOutput>,
    /// The asset to spend (None = native KVNC).
    pub asset_id_hex: Option<String>,
}

/// A prepared CoinJoin transaction ready for participants to sign.
#[derive(uniffi::Record, Clone, Debug)]
pub struct CoinJoinPrepared {
    /// The unsigned batched transaction, hex-encoded.
    pub tx_hex: String,
    /// Sighash for each input (all inputs share the same transaction sighash).
    pub sighashes_hex: Vec<String>,
    /// The outpoints being spent, in order (hex-encoded).
    pub outpoints_hex: Vec<String>,
    /// Values of the outpoints being spent, in order (decimal strings).
    pub values: Vec<String>,
    /// Total protocol fee for the batch (atoms, decimal string).
    pub fee: String,
}

/// One output of a multisig spend, as seen from the mobile FFI.
#[derive(uniffi::Record, Clone, Debug)]
pub struct MultisigSpendOutput {
    /// Value to send, in atoms.
    pub value: u64,
    /// Recipient address: 64-hex, 66-hex, or `kvnc…dag`.
    pub address: String,
    /// Asset id (lowercase hex), if non-native. `None` = native KVNC.
    pub asset_id_hex: Option<String>,
}

/// A created HTLC output (RFC-004), as seen from the mobile FFI.
#[derive(uniffi::Record, Clone, Debug)]
pub struct HtlcInfo {
    /// The validated 100-byte HTLC template, lowercase hex.
    pub script_hex: String,
    /// The Version 0x04 address the output is locked to (`kvnc…dag`).
    pub address: String,
    /// Id of the funding transaction, lowercase hex.
    pub tx_id: String,
    /// Funding transaction id of the outpoint, lowercase hex.
    pub outpoint_tx: String,
    /// Output index of the HTLC output within the funding transaction.
    pub outpoint_index: u32,
}

/// A created Vault output (RFC-005), as seen from the mobile FFI.
#[derive(uniffi::Record, Clone, Debug)]
pub struct VaultInfo {
    /// The validated 40-byte Vault template, lowercase hex.
    pub script_hex: String,
    /// The Version 0x05 address the output is locked to (`kvnc…dag`).
    pub address: String,
    /// Id of the funding transaction, lowercase hex.
    pub tx_id: String,
    /// Funding transaction id of the outpoint, lowercase hex.
    pub outpoint_tx: String,
    /// Output index of the Vault output within the funding transaction.
    pub outpoint_index: u32,
}

/// Logo URI for asset branding (KVP-107) — FFI representation.
#[derive(uniffi::Record, Clone, Debug)]
pub struct LogoUriRecord {
    /// URI scheme: 0 = IPFS, 1 = Arweave, 2 = HTTPS, 3 = Data.
    pub scheme: u8,
    /// BLAKE3 content hash of the logo image (32 bytes, hex).
    pub content_hash: String,
    /// The URI string (max 256 bytes).
    pub uri: String,
}

/// Extended metadata URI for asset (KVP-107) — FFI representation.
#[derive(uniffi::Record, Clone, Debug)]
pub struct MetadataUriRecord {
    /// URI scheme: 0 = IPFS, 1 = Arweave, 2 = HTTPS.
    pub scheme: u8,
    /// BLAKE3 content hash of the JSON metadata (32 bytes, hex).
    pub content_hash: String,
    /// The URI string (max 256 bytes).
    pub uri: String,
}

/// Result of preparing an asset creation transaction (KVP-107).
#[derive(uniffi::Record, Clone, Debug)]
pub struct PrepareCreateAssetResult {
    /// The unsigned transaction, hex-encoded.
    pub tx_hex: String,
    /// The sighash to sign (32 bytes, hex).
    pub sighash_hex: String,
    /// The derived asset ID (32 bytes, lowercase hex).
    pub asset_id_hex: String,
    /// Total input value in atoms (decimal string).
    pub value: String,
    /// Protocol fee in atoms (decimal string).
    pub fee: String,
    /// Change amount in atoms (decimal string).
    pub change: String,
    /// The funding outpoint (tx_id:hex, index:u32).
    pub outpoint_tx: String,
    pub outpoint_index: u32,
    /// The logo URI (if provided).
    pub logo_uri: Option<LogoUriRecord>,
    /// The metadata URI (if provided).
    pub metadata_uri: Option<MetadataUriRecord>,
}

/// Result of preparing a mint transaction (KVP-107).
#[derive(uniffi::Record, Clone, Debug)]
pub struct PrepareMintAssetResult {
    /// The unsigned transaction, hex-encoded.
    pub tx_hex: String,
    /// The sighash to sign (32 bytes, hex).
    pub sighash_hex: String,
    /// The asset ID being minted (32 bytes, lowercase hex).
    pub asset_id_hex: String,
    /// Total input value in atoms (decimal string).
    pub value: String,
    /// Protocol fee in atoms (decimal string).
    pub fee: String,
    /// Change amount in atoms (decimal string).
    pub change: String,
    /// The funding outpoint (tx_id:hex, index:u32).
    pub outpoint_tx: String,
    pub outpoint_index: u32,
}

/// A Kovanica light node: ledger + mempool + authority identity.
///
/// Sync model for mobile: call [`Self::export_blocks`] to hand peers your
/// blocks, feed peer bytes into [`Self::receive_blocks`]. Everything else —
/// balances, bonding, staked production — is local computation over verified
/// history only.
///
/// SPV model: [`Self::export_light_sync`] carries the selected chain as
/// verified headers plus one compact block filter per block; a phone can
/// accept that blob ([`Self::receive_light_sync`]) without any full payload,
/// then watch addresses via [`Self::filter_matches`] and pull only matching
/// full blocks through the regular block channel. Transaction inclusion is
/// proved with [`Self::prove_tx`] / [`Self::verify_tx_proof`].
#[derive(uniffi::Object)]
pub struct LightNode {
    inner: Mutex<Node>,
    light: Mutex<LightSyncState>,
}

/// Headers (and their filters) accepted from light-sync blobs, keyed by block
/// id — the trust anchor set for inclusion-proof verification.
#[derive(Default)]
struct LightSyncState {
    headers: std::collections::HashMap<BlockId, LightHeader>,
}

struct LightHeader {
    header: kovanica_state::spv::BlockHeader,
    filter: kovanica_state::spv::BlockFilter,
}

impl LightNode {
    fn lock(&self) -> MutexGuard<'_, Node> {
        // A panic in another thread must not brick the node forever.
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn block_info(&self, node: &Node, id: &BlockId) -> Option<BlockInfo> {
        let record = node.block_record(id)?;
        Some(BlockInfo {
            id_hex: id.to_hex(),
            parents_hex: record.parents.iter().map(BlockId::to_hex).collect(),
            work: U128Parts::from_u128(record.work),
            timestamp_ms: record.timestamp_ms,
        })
    }

    // ------------------------------------------------------------------
    // Rust-only test seam — NOT part of the FFI contract
    // ------------------------------------------------------------------
    //
    // Deliberately outside `#[uniffi::export]`, so it never reaches Kotlin or
    // Swift: no mobile caller can obtain a consensus signing key through the
    // FFI. This is a test fixture, not an operator key-ingestion path, and it
    // does **not** resolve blocker B1 (see RFC-POA-Migration §0.9) — the node
    // still has no env var, RPC command or CLI flag that feeds an operator's
    // own authority secret to a running process. The FFI test suite needs to
    // be an authority because under PoA a block can only be sealed by the
    // scheduled authority, and the send surface below is what the tests
    // exercise.
    pub fn set_authority_key_for_tests(&self, seed: [u8; 32]) {
        self.lock().set_authority_signing_key(seed);
    }
}

#[uniffi::export]
impl LightNode {
    /// Bring up a fresh node at genesis with `config`.
    ///
    /// The genesis is a PoA genesis: its coinbase commits to
    /// `config.authority_public_keys` (`KVA1 || set_hash`), so a node built
    /// with a different authority set derives a different genesis id and will
    /// not accept the network's blocks. PoA is the only admission regime
    /// (RFC-POA §0) — there is no non-PoA genesis to fall back to.
    #[uniffi::constructor]
    pub fn new(config: LightConfig) -> Result<Self, LightNodeError> {
        let authority_set = authority_set_from_config(&config)?;
        let mut node = Node::new();
        let (_id, _founder) = node.genesis_with_poa(
            config.k,
            config.subsidy,
            config.founder_amount,
            config.founder_seed,
            // RFC-006 genesis gate: the live light-node config uses
            // founder_amount = RFC006_PREMINE (200 KVNC), so the genesis
            // coinbase must include the RFC-006 treasury vaults
            // (RFC006_TREASURY_TRANCHES × 1M, currently 8) with the
            // placeholder keys. Non-standard premines stay treasury-less.
            // ⚠️ The id this yields is NOT the one pinned in
            // kovanica-node/tests/treasury.rs: this path folds in a PoA
            // authority set, that one passes `authority_set: None`.
            // See crates/kovanica-ffi/tests/live_sync_spike.rs.
            if config.founder_amount == RFC006_PREMINE {
                Some(TreasuryGenesis::placeholder())
            } else {
                None
            },
            config.finality_depth,
            config.payload_pruning_depth,
            u64::MAX, // block pruning: light nodes keep the full oracle (follow-up)
            None,     // operator_seed: None for general FFI constructor
            authority_set,
            config.slot_duration_ms,
        )?;
        Ok(Self {
            inner: Mutex::new(node),
            light: Mutex::new(LightSyncState::default()),
        })
    }

    /// The current chain height (selected tip's blue score).
    pub fn chain_height(&self) -> Result<u64, LightNodeError> {
        Ok(self.lock().chain_height()?)
    }

    // ------------------------------------------------------------------
    // Production & transfers
    // ------------------------------------------------------------------

    /// Pack pending mempool transactions into the next block, signing with this
    /// node's authority key. `None` when nothing is pending.
    ///
    /// Under PoA this node must hold the authority key scheduled for the
    /// current slot, and block *immediately* rather than waiting for the next
    /// one — so on a wallet with no authority key it fails with
    /// "not the scheduled authority for this slot". PoA is the only admission
    /// regime (RFC-POA §0); there is no PoW fallback to fall back to.
    pub fn produce_block(&self) -> Result<Option<BlockInfo>, LightNodeError> {
        let mut node = self.lock();
        match node.produce_block()? {
            None => Ok(None),
            Some(id) => Ok(self.block_info(&node, &id)),
        }
    }

    /// Produce a block even with an empty mempool (coinbase-only, crediting the
    /// authority). Same authority-slot requirement as [`Self::produce_block`].
    pub fn produce_empty_block(&self) -> Result<BlockInfo, LightNodeError> {
        let mut node = self.lock();
        let id = node.produce_empty()?;
        Ok(self.block_info(&node, &id).expect("just-produced block"))
    }

    /// Transfer `amount` from actor `from_seed` to `to_seed`, sealed
    /// immediately in a block.
    ///
    /// Sealing requires this node to be the authority scheduled for the current
    /// slot; a wallet without an authority key gets
    /// "not the scheduled authority for this slot" rather than a silently
    /// unsealed transfer.
    pub fn send(
        &self,
        from_seed: u64,
        amount: u64,
        to_seed: u64,
    ) -> Result<SendReceipt, LightNodeError> {
        let mut node = self.lock();
        let sent = node.send(from_seed, amount, to_seed)?;
        Ok(SendReceipt {
            block_id_hex: sent.block.to_hex(),
            tx_id_hex: hex::encode(sent.tx.as_bytes()),
        })
    }

    /// Transfer `amount` of a specific asset from actor `from_seed` to actor
    /// `to_seed`, sealed immediately in a mined block.
    /// `asset_id_hex` is the 32-byte asset id as lowercase hex; `None` = native KVNC.
    pub fn send_asset(
        &self,
        from_seed: u64,
        amount: u64,
        to_seed: u64,
        asset_id_hex: Option<String>,
    ) -> Result<SendReceipt, LightNodeError> {
        let asset_id = match asset_id_hex {
            Some(hex) => {
                let raw = decode_hex(&hex, "asset id")?;
                if raw.len() != 32 {
                    return Err(invalid("asset id must be 32 bytes hex"));
                }
                Some(kovanica_state::AssetId::from_bytes(
                    <[u8; 32]>::try_from(raw.as_slice())
                        .map_err(|_| invalid("asset id must be 32 bytes hex"))?,
                ))
            }
            None => None,
        };
        let mut node = self.lock();
        let sent = node.send_asset(from_seed, amount, to_seed, asset_id)?;
        Ok(SendReceipt {
            block_id_hex: sent.block.to_hex(),
            tx_id_hex: hex::encode(sent.tx.as_bytes()),
        })
    }

    /// Transfer using an imported secret: the wallet passes its 32-byte
    /// ed25519 seed as hex; the secret is used for this call only and never
    /// stored. `to_address` accepts 64-hex or `kvnc…dag` form.
    pub fn send_from(
        &self,
        signing_secret_hex: String,
        amount: u64,
        to_address: String,
    ) -> Result<SendReceipt, LightNodeError> {
        let kp = keypair_from_secret(&signing_secret_hex)?;
        let to = kovanica_state::Address::parse(&to_address)
            .map_err(|e| invalid(format!("bad address: {e}")))?;
        let mut node = self.lock();
        let sent = node.send_with(&kp, amount, to)?;
        Ok(SendReceipt {
            block_id_hex: sent.block.to_hex(),
            tx_id_hex: hex::encode(sent.tx.as_bytes()),
        })
    }

    /// Transfer `amount` of a specific asset using an imported secret.
    /// `asset_id_hex` is the 32-byte asset id as lowercase hex; `None` = native KVNC.
    pub fn send_from_asset(
        &self,
        signing_secret_hex: String,
        amount: u64,
        to_address: String,
        asset_id_hex: Option<String>,
    ) -> Result<SendReceipt, LightNodeError> {
        let kp = keypair_from_secret(&signing_secret_hex)?;
        let to = kovanica_state::Address::parse(&to_address)
            .map_err(|e| invalid(format!("bad address: {e}")))?;
        let asset_id = match asset_id_hex {
            Some(hex) => {
                let raw = decode_hex(&hex, "asset id")?;
                if raw.len() != 32 {
                    return Err(invalid("asset id must be 32 bytes hex"));
                }
                Some(kovanica_state::AssetId::from_bytes(
                    <[u8; 32]>::try_from(raw.as_slice())
                        .map_err(|_| invalid("asset id must be 32 bytes hex"))?,
                ))
            }
            None => None,
        };
        let mut node = self.lock();
        let sent = node.send_with_asset(&kp, amount, to, asset_id)?;
        Ok(SendReceipt {
            block_id_hex: sent.block.to_hex(),
            tx_id_hex: hex::encode(sent.tx.as_bytes()),
        })
    }

    /// Send `amount` to a **script v2** address (the BLAKE3 digest of `script_hex`)
    /// using an imported 32-byte Ed25519 secret (hex). Returns the tx id (lowercase
    /// hex). The script is hashed into a `v0x02` address; the script itself is
    /// revealed at spend time (see RFC-003 / 3B).
    pub fn send_to_script_v2(
        &self,
        signing_secret_hex: String,
        amount: u64,
        script_hex: String,
    ) -> Result<String, LightNodeError> {
        let kp = keypair_from_secret(&signing_secret_hex)?;
        let script = decode_hex(&script_hex, "script")?;
        let mut node = self.lock();
        let tx_id = node.send_to_script_v2(&kp, amount, &script)?;
        Ok(hex::encode(tx_id.as_bytes()))
    }

    /// Send `amount` to a **stealth address** (130-hex, version 0x03) using an
    /// imported 32-byte Ed25519 secret (hex). Returns the tx id (lowercase hex).
    ///
    /// The one-time output is derived deterministically by the node (see
    /// [`Node::send_to_stealth`]); production wallets should prefer supplying
    /// their own random `r` for unlinkability.
    pub fn send_to_stealth(
        &self,
        signing_secret_hex: String,
        amount: u64,
        stealth_address_hex: String,
    ) -> Result<String, LightNodeError> {
        let kp = keypair_from_secret(&signing_secret_hex)?;
        let to = StealthAddress::parse(&stealth_address_hex)
            .map_err(|e| invalid(format!("bad stealth address: {e}")))?;
        let mut node = self.lock();
        let tx_id = node.send_to_stealth(&kp, amount, &to)?;
        Ok(hex::encode(tx_id.as_bytes()))
    }

    /// Spendable balance of a **script v2** address (the BLAKE3 digest of
    /// `script_hex`) in atoms.
    pub fn balance_of_script(&self, script_hex: String) -> Result<u64, LightNodeError> {
        let script = decode_hex(&script_hex, "script")?;
        Ok(self.lock().balance_of_script(&script))
    }

    /// Spendable balance of a **stealth address** (130-hex, version 0x03) in atoms.
    pub fn balance_of_stealth(&self, stealth_address_hex: String) -> Result<u64, LightNodeError> {
        let to = StealthAddress::parse(&stealth_address_hex)
            .map_err(|e| invalid(format!("bad stealth address: {e}")))?;
        Ok(self.lock().balance_of_stealth(&to))
    }

    // ------------------------------------------------------------------
    // Sync (byte blobs over any transport)
    // ------------------------------------------------------------------

    /// Every known block as a wire-format blob (framed count + records). Hand
    /// this to a peer; idempotent on their side.
    pub fn export_blocks(&self) -> Vec<u8> {
        net::encode_records(&self.lock().export())
    }

    /// Export a single block as a one-record wire-format blob. `None` if the
    /// block id is unknown or not a non-genesis block.
    pub fn export_block(&self, block_id_hex: String) -> Result<Option<Vec<u8>>, LightNodeError> {
        let id = parse_block_id(&block_id_hex)?;
        let node = self.lock();
        match node.block_record(&id) {
            Some(rec) => Ok(Some(net::encode_records(std::slice::from_ref(&rec)))),
            None => Ok(None),
        }
    }

    /// Export a single block by lowercase-hex id as a wire-format blob.
    /// Returns `None` when the id is unknown.
    pub fn export_block_by_id(&self, id_hex: String) -> Result<Option<Vec<u8>>, LightNodeError> {
        self.export_block(id_hex)
    }

    /// Apply a blob produced by [`Self::export_blocks`] (or any full node
    /// speaking the same format). Records apply topologically; already-known
    /// blocks are skipped. Returns how many were newly applied.
    pub fn receive_blocks(&self, blob: Vec<u8>) -> Result<u32, LightNodeError> {
        let mut cursor = std::io::Cursor::new(blob);
        let records = net::read_records_from(&mut cursor)
            .map_err(|e| invalid(format!("undecodable sync blob: {e}")))?;
        let mut node = self.lock();
        let mut applied = 0u32;
        for record in records {
            node.receive_block(record).map_err(LightNodeError::from)?;
            applied += 1;
        }
        Ok(applied)
    }

    // ------------------------------------------------------------------
    // Queries & persistence
    // ------------------------------------------------------------------

    /// Spendable balance of actor `seed` in atoms, as a decimal string
    /// (balances are u128; strings avoid FFI integer truncation).
    pub fn balance_of_seed(&self, seed: u64) -> Result<String, LightNodeError> {
        let balance = self.lock().balance(&Node::address(seed))?;
        Ok(balance.to_string())
    }

    /// Spendable balance of an address: 64-hex or `kvnc…dag` form.
    pub fn balance_of_address(&self, address: String) -> Result<String, LightNodeError> {
        let addr = kovanica_state::Address::parse(&address)
            .map_err(|e| invalid(format!("bad address: {e}")))?;
        let balance = self.lock().balance(&addr)?;
        Ok(balance.to_string())
    }

    /// Spendable balance of an address for a specific asset.
    /// `asset_id_hex` is the 32-byte asset id as lowercase hex; `None` = native KVNC.
    pub fn balance_of_asset(
        &self,
        address: String,
        asset_id_hex: Option<String>,
    ) -> Result<String, LightNodeError> {
        let addr = kovanica_state::Address::parse(&address)
            .map_err(|e| invalid(format!("bad address: {e}")))?;
        let asset_id = match asset_id_hex {
            Some(hex) => {
                let raw = decode_hex(&hex, "asset id")?;
                if raw.len() != 32 {
                    return Err(invalid("asset id must be 32 bytes hex"));
                }
                Some(kovanica_state::AssetId::from_bytes(
                    <[u8; 32]>::try_from(raw.as_slice())
                        .map_err(|_| invalid("asset id must be 32 bytes hex"))?,
                ))
            }
            None => None,
        };
        let balance = self.lock().balance_of_asset(&addr, asset_id)?;
        Ok(balance.to_string())
    }

    /// Current tip set, lowercase hex.
    pub fn tips(&self) -> Result<Vec<String>, LightNodeError> {
        Ok(self.lock().tips()?.iter().map(|id| id.to_hex()).collect())
    }

    /// The selected (heaviest) tip, lowercase hex.
    pub fn selected_tip(&self) -> Result<String, LightNodeError> {
        Ok(self.lock().selected_tip()?.to_hex())
    }

    /// Number of blocks in the DAG, including genesis.
    pub fn block_count(&self) -> Result<u32, LightNodeError> {
        let len = self.lock().block_count()?;
        u32::try_from(len).map_err(|_| invalid("block count overflowed u32"))
    }

    /// Summary of one block by lowercase-hex id.
    pub fn block_by_id(&self, id_hex: String) -> Result<Option<BlockInfo>, LightNodeError> {
        let raw = decode_hex(&id_hex, "block id")?;
        let id = BlockId::from_bytes(
            <[u8; 32]>::try_from(raw.as_slice())
                .map_err(|_| invalid("block id must be 32 bytes hex"))?,
        );
        let node = self.lock();
        Ok(node
            .block_record(&id)
            .and_then(|_| self.block_info(&node, &id)))
    }

    /// Write a full snapshot (UTXO + blocks) to `path`.
    pub fn save_snapshot(&self, path: String) -> Result<(), LightNodeError> {
        self.lock().save(&path)?;
        Ok(())
    }

    /// Replace state with a snapshot from `path`, replaying under `config`'s
    /// PoA authority set.
    ///
    /// A snapshot stores the ledger but **not** the admission config, so the
    /// authority set must be supplied again on every load — the same contract
    /// as the full node's `restore_poa_policy`. Loading without it would leave
    /// the node unable to verify authority signatures, i.e. accepting blocks on
    /// the serving peer's word alone.
    pub fn load_snapshot(&self, path: String, config: LightConfig) -> Result<(), LightNodeError> {
        let authority_set = authority_set_from_config(&config)?;
        let mut node = self.lock();
        node.load_with_poa(&path, authority_set, config.slot_duration_ms)?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // SPV: light sync, filters, inclusion proofs
    // ------------------------------------------------------------------

    /// Batch form of [`Self::filter_matches`]: does the filter match ANY of
    /// `addresses`? Decodes the filter once — use this when watching several
    /// addresses per block (multi-address watch wallets).
    pub fn filter_matches_any(
        &self,
        filter_blob: Vec<u8>,
        addresses: Vec<String>,
    ) -> Result<bool, LightNodeError> {
        let filter = decode_filter(&filter_blob)?;
        let addrs = addresses
            .iter()
            .map(|a| {
                kovanica_state::Address::parse(a).map_err(|e| invalid(format!("bad address: {e}")))
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(addrs.iter().any(|addr| filter.matches(addr.payload())))
    }

    /// Reconstruct the transaction history of `address` by scanning stored
    /// blocks in canonical order. Scanning stops after the first
    /// `max_blocks` blocks (`0` = scan everything). A send's change back to
    /// the sender appears as its own `Received` entry.
    pub fn history_of(
        &self,
        address: String,
        max_blocks: u32,
    ) -> Result<Vec<HistoryEntry>, LightNodeError> {
        let addr = kovanica_state::Address::parse(&address)
            .map_err(|e| invalid(format!("bad address: {e}")))?;
        let events = self.lock().history_of(&addr, max_blocks as usize)?;
        Ok(events
            .into_iter()
            .map(|ev| HistoryEntry {
                block_id_hex: ev.block_id.to_hex(),
                tx_id_hex: ev.tx_id.to_hex(),
                direction: match ev.direction {
                    kovanica_node::WalletDirection::Received => TxDirection::Received,
                    kovanica_node::WalletDirection::Sent => TxDirection::Sent,
                },
                amount: ev.amount.to_string(),
                asset_id_hex: ev.asset_id.map(|a| a.to_hex()),
            })
            .collect())
    }

    /// The selected chain as verified headers + per-block filters: everything
    /// a phone needs to track payments without full payloads.
    pub fn export_light_sync(&self) -> Vec<u8> {
        encode_light_sync(&self.lock(), None)
    }

    /// Like [`Self::export_light_sync`], but returns only headers strictly
    /// after `from_id_hex`. Unknown or off-chain ids fall back to the full
    /// header chain.
    pub fn export_light_sync_from(&self, from_id_hex: String) -> Vec<u8> {
        encode_light_sync(&self.lock(), Some(from_id_hex))
    }

    /// Accept a light-sync blob: header chain is verified for linkage,
    /// monotonic timestamps and rising blue work. Returns accepted header
    /// count.
    pub fn receive_light_sync(&self, blob: Vec<u8>) -> Result<u32, LightNodeError> {
        let parsed = parse_light_sync(&blob)?;
        let mut client = kovanica_state::spv::SpvClient::new(parsed[0].0.clone());
        for (h, _) in &parsed[1..] {
            client
                .add_header(h.clone())
                .map_err(|e| invalid(format!("header rejected: {e}")))?;
        }
        let mut light = self.light.lock().unwrap_or_else(|p| p.into_inner());
        for (h, f) in parsed {
            light.headers.insert(
                h.id,
                LightHeader {
                    header: h,
                    filter: f,
                },
            );
        }
        Ok(light.headers.len() as u32)
    }

    /// Highest height among light-synced headers (`None` before any sync).
    pub fn synced_height(&self) -> Option<u64> {
        let light = self.light.lock().unwrap_or_else(|p| p.into_inner());
        light.headers.values().map(|e| e.header.height).max()
    }

    /// Id of the highest light-synced header (`None` before any sync).
    pub fn synced_tip_id(&self) -> Option<String> {
        let light = self.light.lock().unwrap_or_else(|p| p.into_inner());
        light
            .headers
            .values()
            .max_by_key(|e| e.header.height)
            .map(|e| e.header.id.to_hex())
    }

    /// Whether `address` MIGHT appear in the given light-synced block,
    /// answered from locally stored filters (`None` = block not synced).
    /// A `true` is a probabilistic hit worth fetching full blocks for.
    pub fn synced_filter_matches(
        &self,
        block_id_hex: String,
        address: String,
    ) -> Result<Option<bool>, LightNodeError> {
        let id = parse_block_id(&block_id_hex)?;
        let addr = kovanica_state::Address::parse(&address)
            .map_err(|e| invalid(format!("bad address: {e}")))?;
        let light = self.light.lock().unwrap_or_else(|p| p.into_inner());
        Ok(light
            .headers
            .get(&id)
            .map(|e| e.filter.matches(addr.payload())))
    }

    /// A Merkle-inclusion proof for `tx_id` inside block `block_id_hex`,
    /// encoded as a blob. `None` when either is unknown or the tx is absent.
    pub fn prove_tx(
        &self,
        block_id_hex: String,
        tx_id_hex: String,
    ) -> Result<Option<Vec<u8>>, LightNodeError> {
        let id = parse_block_id(&block_id_hex)?;
        let raw_tx = decode_hex(&tx_id_hex, "tx id")?;
        let tx_bytes = <[u8; 32]>::try_from(raw_tx.as_slice())
            .map_err(|_| invalid("tx id must be 32 bytes hex"))?;
        let node = self.lock();
        Ok(node
            .merkle_proof(&id, &kovanica_state::TxId::from_bytes(tx_bytes))
            .map(|p| encode_proof(&p)))
    }

    /// Verify an inclusion-proof blob against the light-synced header of
    /// `block_id_hex`: the proof must verify internally AND its merkle root
    /// must equal the header's root. Unknown block → error.
    pub fn verify_tx_proof(
        &self,
        proof_blob: Vec<u8>,
        block_id_hex: String,
    ) -> Result<bool, LightNodeError> {
        let proof = decode_proof(&proof_blob)?;
        let id = parse_block_id(&block_id_hex)?;
        let light = self.light.lock().unwrap_or_else(|p| p.into_inner());
        let header = light
            .headers
            .get(&id)
            .ok_or_else(|| invalid("block not in light-synced history"))?;
        if proof.leaf != header.header.merkle_root {
            return Ok(false);
        }
        Ok(proof.verify() == header.header.merkle_root)
    }

    // ------------------------------------------------------------------
    // Multisig (M-of-N P2SH) mobile helpers
    // ------------------------------------------------------------------

    /// Create a threshold-multisig P2SH address from `threshold` and a list of
    /// 64-hex Ed25519 public keys. Returns the human address plus the redeem
    /// script (which must be shared with all cosigners out of band).
    pub fn create_multisig_address(
        &self,
        threshold: u8,
        pubkeys_hex: Vec<String>,
    ) -> Result<MultisigAddress, LightNodeError> {
        let pubkeys = pubkeys_hex
            .into_iter()
            .map(|h| {
                let raw = decode_hex(&h, "pubkey")?;
                <[u8; 32]>::try_from(raw.as_slice())
                    .map_err(|_| invalid("pubkey must be 32 bytes hex"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let (address, script) = self
            .lock()
            .create_multisig_address(threshold, pubkeys)
            .map_err(LightNodeError::from)?;
        Ok(MultisigAddress {
            address: address.to_kvnc(),
            redeem_script_hex: hex::encode(&script),
        })
    }

    /// Build an unsigned multisig spend paying `outputs` from a single UTXO
    /// owned by `address`. Returns a transaction blob encoding the unsigned tx
    /// with the redeem script attached as `witness[0]`.
    pub fn build_multisig_spend(
        &self,
        address: String,
        outputs: Vec<MultisigSpendOutput>,
    ) -> Result<Vec<u8>, LightNodeError> {
        let addr = kovanica_state::Address::parse(&address)
            .map_err(|e| invalid(format!("bad address: {e}")))?;
        if outputs.is_empty() {
            return Err(invalid("outputs must not be empty"));
        }
        let mut total = 0u64;
        let tx_outputs = outputs
            .into_iter()
            .map(|o| {
                total = total
                    .checked_add(o.value)
                    .ok_or_else(|| invalid("output sum overflow"))?;
                let owner = kovanica_state::Address::parse(&o.address)
                    .map_err(|e| invalid(format!("bad output address: {e}")))?;
                Ok(TxOutput::native(o.value, owner))
            })
            .collect::<Result<Vec<_>, LightNodeError>>()?;
        let tx = self
            .lock()
            .build_multisig_spend(addr, tx_outputs)
            .map_err(LightNodeError::from)?;
        Ok(encode_tx_blob(&tx))
    }

    /// Sign a multisig transaction blob with a 32-byte Ed25519 secret (hex).
    /// Returns the raw 64-byte partial signature.
    pub fn sign_multisig_partial(
        &self,
        tx_blob: Vec<u8>,
        secret_hex: String,
    ) -> Result<Vec<u8>, LightNodeError> {
        let tx = decode_tx_blob(&tx_blob)?;
        let sig = self
            .lock()
            .sign_multisig_partial(&tx, &secret_hex)
            .map_err(LightNodeError::from)?;
        Ok(sig.to_vec())
    }

    /// Combine `partial_sigs` (each from [`Self::sign_multisig_partial`]) with
    /// the unsigned transaction blob to produce a fully-signed transaction
    /// blob ready for [`Self::submit_multisig_tx`].
    pub fn combine_multisig_sigs(
        &self,
        tx_blob: Vec<u8>,
        partial_sigs: Vec<Vec<u8>>,
    ) -> Result<Vec<u8>, LightNodeError> {
        let tx = decode_tx_blob(&tx_blob)?;
        let sigs = partial_sigs
            .into_iter()
            .map(|bytes| {
                <[u8; 64]>::try_from(bytes.as_slice())
                    .map_err(|_| invalid("partial signature must be 64 bytes"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let final_tx = self
            .lock()
            .combine_multisig_sigs(&tx, sigs)
            .map_err(LightNodeError::from)?;
        Ok(encode_tx_blob(&final_tx))
    }

    /// Submit a fully-signed multisig transaction blob to the mempool. Returns
    /// the transaction id (lowercase hex); mine it with
    /// [`Self::produce_block`] / [`Self::produce_empty_block`].
    pub fn submit_multisig_tx(&self, tx_blob: Vec<u8>) -> Result<String, LightNodeError> {
        let tx = decode_tx_blob(&tx_blob)?;
        let tx_id = self
            .lock()
            .submit_multisig_tx(tx)
            .map_err(LightNodeError::from)?;
        Ok(hex::encode(tx_id.as_bytes()))
    }

    // ------------------------------------------------------------------
    // HTLC / atomic swap (RFC-004)
    // ------------------------------------------------------------------

    /// Create an HTLC output locking `amount` (of `asset_id_hex`, or native
    /// KVNC when `None`) to a Version 0x04 address committing to
    /// `preimage_hash`, `recipient_pk`, this signer as sender, and `timeout`.
    /// The funding transaction is mined immediately. Returns the template,
    /// address, and funding outpoint.
    pub fn create_htlc(
        &self,
        signing_secret_hex: String,
        amount: u64,
        asset_id_hex: Option<String>,
        recipient_pk_hex: String,
        preimage_hash_hex: String,
        timeout: u32,
    ) -> Result<HtlcInfo, LightNodeError> {
        let kp = keypair_from_secret(&signing_secret_hex)?;
        let recipient_pk = decode_32(&recipient_pk_hex, "recipient public key")?;
        let preimage_hash = decode_32(&preimage_hash_hex, "preimage hash")?;
        let asset_id = parse_asset_id(asset_id_hex)?;
        let mut node = self.lock();
        let info = node.create_htlc(&kp, amount, asset_id, recipient_pk, preimage_hash, timeout)?;
        Ok(HtlcInfo {
            script_hex: hex::encode(info.script.bytes()),
            address: info.address.to_kvnc(),
            tx_id: info.tx_id.to_hex(),
            outpoint_tx: info.outpoint.tx.to_hex(),
            outpoint_index: info.outpoint.index,
        })
    }

    /// Redeem an HTLC output with the correct preimage. `signing_secret_hex`
    /// is the **recipient**'s 32-byte Ed25519 secret (hex); the witness is
    /// `[template, preimage, recipient_sig]` and has no time constraint
    /// (BIP-199). Returns the redeem transaction id (lowercase hex).
    pub fn redeem_htlc(
        &self,
        signing_secret_hex: String,
        outpoint_tx_hex: String,
        outpoint_index: u32,
        script_hex: String,
        preimage_hex: String,
        to_address: String,
    ) -> Result<String, LightNodeError> {
        let kp = keypair_from_secret(&signing_secret_hex)?;
        let outpoint = parse_outpoint(&outpoint_tx_hex, outpoint_index)?;
        let script = parse_htlc_script(&script_hex)?;
        let preimage = decode_hex(&preimage_hex, "preimage")?;
        let to = kovanica_state::Address::parse(&to_address)
            .map_err(|e| invalid(format!("bad address: {e}")))?;
        let mut node = self.lock();
        let tx_id = node.redeem_htlc(&kp, outpoint, &script, &preimage, to)?;
        Ok(tx_id.to_hex())
    }

    /// Refund an HTLC output after its timeout. `signing_secret_hex` is the
    /// **sender**'s 32-byte Ed25519 secret (hex); the witness is
    /// `[template, sender_sig]`. The ledger rejects the refund until the chain
    /// height reaches `script.timeout()`. Returns the refund tx id (hex).
    pub fn refund_htlc(
        &self,
        signing_secret_hex: String,
        outpoint_tx_hex: String,
        outpoint_index: u32,
        script_hex: String,
        to_address: String,
    ) -> Result<String, LightNodeError> {
        let kp = keypair_from_secret(&signing_secret_hex)?;
        let outpoint = parse_outpoint(&outpoint_tx_hex, outpoint_index)?;
        let script = parse_htlc_script(&script_hex)?;
        let to = kovanica_state::Address::parse(&to_address)
            .map_err(|e| invalid(format!("bad address: {e}")))?;
        let mut node = self.lock();
        let tx_id = node.refund_htlc(&kp, outpoint, &script, to)?;
        Ok(tx_id.to_hex())
    }

    /// The spendable balance locked to an HTLC template's address, in atoms.
    pub fn balance_of_htlc(&self, script_hex: String) -> Result<u64, LightNodeError> {
        let script = parse_htlc_script(&script_hex)?;
        Ok(self.lock().balance_of_htlc(&script))
    }

    /// Build an HTLC template from its four parameters and return the
    /// canonical 100-byte template as lowercase hex. Useful for constructing
    /// a script to pass to [`Self::balance_of_htlc`] or to share out of band.
    pub fn htlc_script_hex(
        &self,
        preimage_hash_hex: String,
        recipient_pk_hex: String,
        sender_pk_hex: String,
        timeout: u32,
    ) -> Result<String, LightNodeError> {
        let preimage_hash = decode_32(&preimage_hash_hex, "preimage hash")?;
        let recipient_pk = decode_32(&recipient_pk_hex, "recipient public key")?;
        let sender_pk = decode_32(&sender_pk_hex, "sender public key")?;
        let script =
            kovanica_state::htlc::HtlcScript::new(preimage_hash, recipient_pk, sender_pk, timeout)
                .map_err(|e| invalid(format!("invalid HTLC template: {e}")))?;
        Ok(hex::encode(script.bytes()))
    }

    /// Compute `BLAKE3(preimage)` as lowercase hex — the preimage hash to
    /// commit to in an HTLC template.
    pub fn htlc_preimage_hash_hex(&self, preimage_hex: String) -> Result<String, LightNodeError> {
        let preimage = decode_hex(&preimage_hex, "preimage")?;
        Ok(hex::encode(kovanica_node::atomic_swap::preimage_hash(
            &preimage,
        )))
    }

    // ---------------------------------------------------------------------------
    // Asset Creation & Minting (KVP-107)
    // ---------------------------------------------------------------------------

    /// Prepare an unsigned asset creation transaction (KVP-107).
    ///
    /// The caller must fund the creation fee (1000 KVNC) + protocol fee from the
    /// signing key's native KVNC UTXOs. The transaction creates an output with the
    /// new asset_id (value = 0 for fungible, 1 for NFT) to the signer, registering
    /// the asset in the ledger's asset registry with the specified parameters.
    ///
    /// Returns the unsigned transaction, sighash, derived asset_id, and other details.
    pub fn prepare_create_asset(
        &self,
        signing_secret_hex: String,
        max_supply: u64,
        kind: u8, // 0 = fungible, 1 = nonfungible
        mint_price_per_unit: u64,
        logo_uri: Option<LogoUriRecord>,
        metadata_uri: Option<MetadataUriRecord>,
    ) -> Result<PrepareCreateAssetResult, LightNodeError> {
        let kp = keypair_from_secret(&signing_secret_hex)?;
        let from = kp.address();
        let asset_kind = match kind {
            0 => AssetKind::Fungible,
            1 => AssetKind::NonFungible,
            _ => return Err(invalid("kind must be 0 (fungible) or 1 (nonfungible)")),
        };
        // Convert FFI LogoUriRecord/MetadataUriRecord to kovanica_state types
        let logo = logo_uri
            .as_ref()
            .map(|l| {
                let scheme = match l.scheme {
                    0 => LogoScheme::Ipfs,
                    1 => LogoScheme::Arweave,
                    2 => LogoScheme::Https,
                    3 => LogoScheme::Data,
                    _ => LogoScheme::Ipfs,
                };
                let content_hash = decode_32(&l.content_hash, "logo content_hash")?;
                LogoUri::new(scheme, content_hash, l.uri.clone())
                    .map_err(|e| invalid(format!("invalid logo_uri: {e}")))
            })
            .transpose()?;
        let metadata = metadata_uri
            .as_ref()
            .map(|m| {
                let scheme = match m.scheme {
                    0 => MetadataScheme::Ipfs,
                    1 => MetadataScheme::Arweave,
                    2 => MetadataScheme::Https,
                    _ => MetadataScheme::Ipfs,
                };
                let content_hash = decode_32(&m.content_hash, "metadata content_hash")?;
                MetadataUri::new(scheme, content_hash, m.uri.clone())
                    .map_err(|e| invalid(format!("invalid metadata_uri: {e}")))
            })
            .transpose()?;
        let node = self.lock();
        let p = node
            .prepare_create_asset(
                from,
                max_supply,
                asset_kind,
                mint_price_per_unit,
                logo,
                metadata,
            )
            .map_err(LightNodeError::from)?;
        let asset_id = p.tx.outputs()[0].asset_id.unwrap();
        let change = p
            .value
            .saturating_sub(kovanica_state::ASSET_CREATION_FEE)
            .saturating_sub(p.fee);
        Ok(PrepareCreateAssetResult {
            tx_hex: hex::encode(p.tx.encode()),
            sighash_hex: hex::encode(p.sighash),
            asset_id_hex: asset_id.to_hex(),
            value: p.value.to_string(),
            fee: p.fee.to_string(),
            change: change.to_string(),
            outpoint_tx: p.outpoint.tx.to_hex(),
            outpoint_index: p.outpoint.index,
            logo_uri,
            metadata_uri,
        })
    }

    /// Prepare an unsigned mint transaction for an existing asset (KVP-107).
    ///
    /// The caller must pay the mint fee = `mint_price_per_unit * amount` in native KVNC
    /// (enforced by the ledger). The fee is paid from the signing key's native KVNC UTXOs.
    /// The newly minted `amount` of `asset_id` is sent to `to`.
    ///
    /// Returns the unsigned transaction, sighash, and other details.
    pub fn prepare_mint_asset(
        &self,
        signing_secret_hex: String,
        asset_id_hex: String,
        amount: u64,
        to_address: String,
    ) -> Result<PrepareMintAssetResult, LightNodeError> {
        let kp = keypair_from_secret(&signing_secret_hex)?;
        let from = kp.address();
        let asset_id = parse_asset_id(Some(asset_id_hex))?
            .ok_or_else(|| invalid("asset_id cannot be native KVNC"))?;
        let to = kovanica_state::Address::parse(&to_address)
            .map_err(|e| invalid(format!("bad address: {e}")))?;
        let node = self.lock();
        let p = node
            .prepare_mint_asset(from, asset_id, amount, to)
            .map_err(LightNodeError::from)?;
        let change = p.value.saturating_sub(amount).saturating_sub(p.fee);
        Ok(PrepareMintAssetResult {
            tx_hex: hex::encode(p.tx.encode()),
            sighash_hex: hex::encode(p.sighash),
            asset_id_hex: asset_id.to_hex(),
            value: p.value.to_string(),
            fee: p.fee.to_string(),
            change: change.to_string(),
            outpoint_tx: p.outpoint.tx.to_hex(),
            outpoint_index: p.outpoint.index,
        })
    }

    // ---------------------------------------------------------------------------
    // CoinJoin (node-level, non-consensus batched spends)
    // ---------------------------------------------------------------------------

    /// Build an **unsigned** CoinJoin transaction from multiple participants.
    /// Each participant provides their address, desired outputs, and optional asset.
    /// The method selects covering UTXOs for each participant, builds a single
    /// transaction with all inputs and outputs, and returns the unsigned transaction
    /// plus sighashes for each input that each participant must sign.
    ///
    /// This is a non-consensus, node-level utility for privacy-enhancing batched spends.
    pub fn coinjoin_prepare(
        &self,
        participants: Vec<CoinJoinParticipant>,
    ) -> Result<CoinJoinPrepared, LightNodeError> {
        let node_participants: Vec<kovanica_node::CoinJoinParticipant> = participants
            .into_iter()
            .map(|p| {
                let from = kovanica_state::Address::parse(&p.from)
                    .map_err(|e| invalid(format!("bad address: {e}")))?;
                let outputs = p
                    .outputs
                    .into_iter()
                    .map(|o| {
                        let to = kovanica_state::Address::parse(&o.to)
                            .map_err(|e| invalid(format!("bad address: {e}")))?;
                        let amount = o
                            .amount
                            .parse::<u64>()
                            .map_err(|_| invalid("amount must be a decimal string"))?;
                        let asset_id = match o.asset_id_hex {
                            Some(hex) => {
                                let raw = decode_hex(&hex, "asset id")?;
                                if raw.len() != 32 {
                                    return Err(invalid("asset id must be 32 bytes hex"));
                                }
                                Some(kovanica_state::AssetId::from_bytes(
                                    <[u8; 32]>::try_from(raw.as_slice())
                                        .map_err(|_| invalid("asset id must be 32 bytes hex"))?,
                                ))
                            }
                            None => None,
                        };
                        Ok(kovanica_state::TxOutput::new(amount, asset_id, to))
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let asset_id = match p.asset_id_hex {
                    Some(hex) => {
                        let raw = decode_hex(&hex, "asset id")?;
                        if raw.len() != 32 {
                            return Err(invalid("asset id must be 32 bytes hex"));
                        }
                        Some(kovanica_state::AssetId::from_bytes(
                            <[u8; 32]>::try_from(raw.as_slice())
                                .map_err(|_| invalid("asset id must be 32 bytes hex"))?,
                        ))
                    }
                    None => None,
                };
                Ok(kovanica_node::CoinJoinParticipant {
                    from,
                    outputs,
                    asset_id,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;

        let node = self.lock();
        let prepared = node.coinjoin_prepare(node_participants)?;

        // Encode transaction
        let tx_hex = hex::encode(prepared.tx.encode());
        // Sighashes (all inputs share the same transaction sighash)
        let sighashes_hex = prepared.sighashes.iter().map(hex::encode).collect();
        // Outpoints
        let outpoints_hex = prepared
            .outpoints
            .iter()
            .map(|op| format!("{}:{}", op.tx.to_hex(), op.index))
            .collect();
        // Values as decimal strings
        let values = prepared.values.iter().map(|v| v.to_string()).collect();

        Ok(CoinJoinPrepared {
            tx_hex,
            sighashes_hex,
            outpoints_hex,
            values,
            fee: prepared.fee.to_string(),
        })
    }

    // ---------------------------------------------------------------------------
    // Vault / CSV time-lock (RFC-005)
    // ---------------------------------------------------------------------------

    /// Create a Vault (time-lock) output locking `amount` (native KVNC) to a
    /// Version 0x05 address with the given `unlock_height` (absolute CLTV lock)
    /// and `csv` (relative CSV lock in blocks since output creation).
    /// `owner_pk_hex` is the Ed25519 public key authorized to spend when both
    /// locks have elapsed. The funding transaction is mined immediately.
    /// Returns the template, address, and funding outpoint.
    pub fn create_vault(
        &self,
        signing_secret_hex: String,
        amount: u64,
        unlock_height: u32,
        csv: u32,
        owner_pk_hex: String,
    ) -> Result<VaultInfo, LightNodeError> {
        let kp = keypair_from_secret(&signing_secret_hex)?;
        let owner_pk = decode_32(&owner_pk_hex, "owner public key")?;
        let mut node = self.lock();
        let info = node.create_vault(&kp, amount, unlock_height, csv, owner_pk)?;
        Ok(VaultInfo {
            script_hex: hex::encode(info.script.bytes()),
            address: info.address.to_kvnc(),
            tx_id: info.tx_id.to_hex(),
            outpoint_tx: info.outpoint.tx.to_hex(),
            outpoint_index: info.outpoint.index,
        })
    }

    /// Release a Vault output when both locks (absolute and/or relative) have
    /// elapsed. `signing_secret_hex` is the **owner**'s 32-byte Ed25519 secret
    /// (hex); the witness is `[template, owner_sig]`. Fee is paid from the
    /// vault value. Returns the release transaction id (lowercase hex).
    pub fn release_vault(
        &self,
        signing_secret_hex: String,
        outpoint_tx_hex: String,
        outpoint_index: u32,
        script_hex: String,
        to_address: String,
    ) -> Result<String, LightNodeError> {
        let kp = keypair_from_secret(&signing_secret_hex)?;
        let outpoint = parse_outpoint(&outpoint_tx_hex, outpoint_index)?;
        let script = parse_vault_script(&script_hex)?;
        let to = kovanica_state::Address::parse(&to_address)
            .map_err(|e| invalid(format!("bad address: {e}")))?;
        let mut node = self.lock();
        let tx_id = node.release_vault(&kp, outpoint, &script, to)?;
        Ok(tx_id.to_hex())
    }

    /// The spendable balance locked to a Vault template's address, in atoms.
    pub fn balance_of_vault(&self, script_hex: String) -> Result<u64, LightNodeError> {
        let script = parse_vault_script(&script_hex)?;
        Ok(self.lock().balance_of_vault(&script))
    }

    /// Build a Vault template from its four parameters and return the
    /// canonical 40-byte template as lowercase hex. Useful for constructing
    /// a script to pass to [`Self::balance_of_vault`] or to share out of band.
    pub fn vault_script_hex(
        &self,
        unlock_height: u32,
        csv: u32,
        owner_pk_hex: String,
    ) -> Result<String, LightNodeError> {
        let owner_pk = decode_32(&owner_pk_hex, "owner public key")?;
        let script = kovanica_state::vault::VaultScript::new(unlock_height, csv, owner_pk)
            .map_err(|e| invalid(format!("invalid Vault template: {e}")))?;
        Ok(hex::encode(script.bytes()))
    }

    /// Submit a fully signed CoinJoin transaction.
    /// `prepared` is the result from `coinjoin_prepare`.
    /// `signatures_hex` is a list of 64-byte Ed25519 signatures (lowercase hex),
    /// one per input, in the same order as `prepared.outpoints_hex`.
    pub fn coinjoin_submit(
        &self,
        prepared: CoinJoinPrepared,
        signatures_hex: Vec<String>,
    ) -> Result<String, LightNodeError> {
        let signatures: Vec<[u8; 64]> = signatures_hex
            .into_iter()
            .map(|s| {
                let raw = decode_hex(&s, "signature")?;
                if raw.len() != 64 {
                    return Err(invalid("signature must be 64 bytes hex"));
                }
                <[u8; 64]>::try_from(raw.as_slice())
                    .map_err(|_| invalid("signature must be 64 bytes hex"))
            })
            .collect::<Result<Vec<_>, _>>()?;

        // Decode the transaction
        let tx_bytes = decode_hex(&prepared.tx_hex, "tx")?;
        let mut tx = kovanica_state::Transaction::decode(&tx_bytes)
            .map_err(|e| invalid(format!("undecodable tx: {e}")))?;

        // Attach signatures
        for (i, sig_bytes) in signatures.iter().enumerate() {
            let sig = kovanica_state::Sig::from_bytes(*sig_bytes);
            tx.attach_signature(i, sig);
        }

        // Verify all signatures against their respective owners
        let mut node = self.lock();
        let state = node.ledger()?.ledger_state();
        for (i, op_hex) in prepared.outpoints_hex.iter().enumerate() {
            let parts: Vec<&str> = op_hex.split(':').collect();
            if parts.len() != 2 {
                return Err(invalid("outpoint must be 'txid:index'"));
            }
            let txid = kovanica_state::TxId::from_bytes(
                <[u8; 32]>::try_from(decode_hex(parts[0], "txid")?.as_slice())
                    .map_err(|_| invalid("txid must be 32 bytes hex"))?,
            );
            let index = parts[1]
                .parse::<u32>()
                .map_err(|_| invalid("bad outpoint index"))?;
            let op = kovanica_state::OutPoint::new(txid, index);

            let owner = state.get_entry(&op).map(|e| e.output.owner);
            let Some(owner) = owner else {
                return Err(invalid("outpoint not found in UTXO set"));
            };
            // All inputs share the same sighash
            let sighash =
                hex::decode(&prepared.sighashes_hex[0]).map_err(|_| invalid("bad sighash hex"))?;
            let sighash: [u8; 32] = sighash
                .as_slice()
                .try_into()
                .map_err(|_| invalid("bad sighash length"))?;
            if !kovanica_state::verify(&owner, &sighash, &signatures[i]) {
                return Err(invalid("signature verification failed"));
            }
        }

        // Submit the signed transaction
        node.submit_tx(tx)?;
        Ok("submitted".to_string())
    }
}

fn encode_light_sync(node: &Node, from_id_hex: Option<String>) -> Vec<u8> {
    let mut headers = node.export_spv_headers();
    if let Some(hex) = from_id_hex {
        if let Ok(id) = parse_block_id(&hex) {
            if let Some(pos) = headers.iter().position(|h| h.id == id) {
                headers = headers.split_off(pos + 1);
            }
        }
    }
    let mut out = Vec::new();
    out.extend_from_slice(LIGHT_SYNC_MAGIC);
    out.push(LIGHT_SYNC_VERSION);
    out.extend_from_slice(&(headers.len() as u32).to_be_bytes());
    for h in &headers {
        encode_header(h, &mut out);
        let filter = node
            .block_filter(&h.id)
            .unwrap_or_else(|| kovanica_state::spv::BlockFilter {
                k: FILTER_K,
                n: 0,
                data: Vec::new(),
            });
        encode_filter_into(&filter, &mut out);
    }
    out
}

fn decode_hex(s: &str, field: &str) -> Result<Vec<u8>, LightNodeError> {
    hex::decode(s.trim()).map_err(|e| LightNodeError::Hex {
        field: format!("{field} ({e})"),
    })
}

/// Decode a 32-byte block-id hex string.
fn parse_block_id(id_hex: &str) -> Result<BlockId, LightNodeError> {
    let raw = decode_hex(id_hex, "block id")?;
    Ok(BlockId::from_bytes(
        <[u8; 32]>::try_from(raw.as_slice())
            .map_err(|_| invalid("block id must be 32 bytes hex"))?,
    ))
}

/// Encode a single transaction as an FFI "blob": the canonical transaction
/// encoding returned by [`Transaction::encode`].
fn encode_tx_blob(tx: &Transaction) -> Vec<u8> {
    tx.encode()
}

/// Decode a single-transaction blob produced by [`encode_tx_blob`].
fn decode_tx_blob(blob: &[u8]) -> Result<Transaction, LightNodeError> {
    Transaction::decode(blob).map_err(|e| invalid(format!("undecodable tx blob: {e}")))
}

// ---------------------------------------------------------------------------
// SPV wire formats (FFI-owned, versioned; big-endian throughout)
// ---------------------------------------------------------------------------

const FILTER_K: u8 = 8;
const LIGHT_SYNC_MAGIC: &[u8; 4] = b"KVLS";
const LIGHT_SYNC_VERSION: u8 = 2;

fn encode_header(h: &kovanica_state::spv::BlockHeader, out: &mut Vec<u8>) {
    out.extend_from_slice(h.id.as_bytes());
    out.extend_from_slice(h.prev_hash.as_bytes());
    out.extend_from_slice(&h.merkle_root);
    out.extend_from_slice(&h.work.to_be_bytes());
    out.extend_from_slice(&h.timestamp_ms.to_be_bytes());
    out.extend_from_slice(&h.nonce.to_be_bytes());
    out.extend_from_slice(&h.blue_score.to_be_bytes());
    out.extend_from_slice(&h.chain_blue_work.to_be_bytes());
    out.extend_from_slice(&h.height.to_be_bytes());
    // v2 PoA extension (289 bytes total)
    if let Some(sig) = &h.authority_sig {
        out.push(1);
        out.extend_from_slice(sig.as_slice());
    } else {
        out.push(0);
        out.extend_from_slice(&[0u8; 64]);
    }
    out.extend_from_slice(&h.authority_set_hash);
    out.extend_from_slice(&h.hash_without_authority_sig);
}

fn decode_header(buf: &[u8], version: u8) -> Option<(kovanica_state::spv::BlockHeader, &[u8])> {
    // v1 header: 160 bytes, v2 header: 289 bytes
    let min_len = if version >= 2 { 289 } else { 160 };
    if buf.len() < min_len {
        return None;
    }
    // Ensure the buffer is at least the declared header length for the version.
    // Ensure the buffer is at least the declared header length for the version.
    // (The check above is redundant but kept for clarity.)
    let get32 = |o: usize| <[u8; 32]>::try_from(&buf[o..o + 32]).ok();
    let header = kovanica_state::spv::BlockHeader {
        id: BlockId::from_bytes(get32(0)?),
        prev_hash: BlockId::from_bytes(get32(32)?),
        merkle_root: get32(64)?,
        work: u128::from_be_bytes(buf[96..112].try_into().ok()?),
        timestamp_ms: u64::from_be_bytes(buf[112..120].try_into().ok()?),
        nonce: u64::from_be_bytes(buf[120..128].try_into().ok()?),
        blue_score: u64::from_be_bytes(buf[128..136].try_into().ok()?),
        chain_blue_work: u128::from_be_bytes(buf.get(136..152)?.try_into().ok()?),
        height: u64::from_be_bytes(buf.get(152..160)?.try_into().ok()?),
        authority_sig: None,
        authority_set_hash: [0u8; 32],
        hash_without_authority_sig: [0u8; 32],
    };
    let _header_len = if version >= 2 { 289 } else { 160 };
    if version >= 2 {
        let auth_flag = buf[160];
        let authority_sig = if auth_flag == 1 {
            Some(buf[161..225].try_into().ok()?)
        } else {
            None
        };
        let authority_set_hash = buf[225..257].try_into().ok()?;
        let hash_without_authority_sig = buf[257..289].try_into().ok()?;
        Some((
            kovanica_state::spv::BlockHeader {
                authority_sig,
                authority_set_hash,
                hash_without_authority_sig,
                ..header
            },
            &buf[289..],
        ))
    } else {
        Some((header, &buf[160..]))
    }
}

fn encode_filter_into(f: &kovanica_state::spv::BlockFilter, out: &mut Vec<u8>) {
    out.push(f.k);
    out.extend_from_slice(&f.n.to_be_bytes());
    out.extend_from_slice(&(f.data.len() as u32).to_be_bytes());
    out.extend_from_slice(&f.data);
}

fn decode_filter(mut blob: &[u8]) -> Result<kovanica_state::spv::BlockFilter, LightNodeError> {
    (|| {
        if blob.len() < 13 {
            return None;
        }
        let k = blob[0];
        let n = u32::from_be_bytes(blob[1..5].try_into().ok()?);
        let len = u32::from_be_bytes(blob[5..9].try_into().ok()?) as usize;
        blob = blob.get(9..9 + len)?;
        Some(kovanica_state::spv::BlockFilter {
            k,
            n,
            data: blob.to_vec(),
        })
    })()
    .ok_or_else(|| invalid("undecodable filter blob"))
}

/// Parse a light-sync blob into `(header, filter)` pairs in chain order.
fn parse_light_sync(
    blob: &[u8],
) -> Result<
    Vec<(
        kovanica_state::spv::BlockHeader,
        kovanica_state::spv::BlockFilter,
    )>,
    LightNodeError,
> {
    let err = || invalid("undecodable light-sync blob");
    if blob.len() < 9 || &blob[..4] != LIGHT_SYNC_MAGIC {
        return Err(err());
    }
    let version = blob[4];
    if version > LIGHT_SYNC_VERSION {
        return Err(invalid(format!(
            "unsupported light-sync version {}",
            version
        )));
    }
    let count = u32::from_be_bytes(blob[5..9].try_into().map_err(|_| err())?) as usize;
    let mut off = 9usize;
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let (header, rest) = decode_header(&blob[off..], version).ok_or_else(err)?;
        off = blob.len() - rest.len();

        // Filter: k(1) n(4) len(4) data(len).
        if blob.len() < off + 9 {
            return Err(err());
        }
        let k = blob[off];
        let n = u32::from_be_bytes(blob[off + 1..off + 5].try_into().map_err(|_| err())?);
        let len =
            u32::from_be_bytes(blob[off + 5..off + 9].try_into().map_err(|_| err())?) as usize;
        let data_end = off + 9 + len;
        if blob.len() < data_end {
            return Err(err());
        }
        let filter = kovanica_state::spv::BlockFilter {
            k,
            n,
            data: blob[off + 9..data_end].to_vec(),
        };
        off = data_end;
        out.push((header, filter));
    }
    Ok(out)
}

fn encode_proof(p: &kovanica_state::spv::MerkleProof) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&p.leaf);
    out.extend_from_slice(&(p.path.len() as u32).to_be_bytes());
    for s in &p.path {
        out.extend_from_slice(s);
    }
    out.extend_from_slice(&(p.index as u64).to_be_bytes());
    out
}

fn decode_proof(blob: &[u8]) -> Result<kovanica_state::spv::MerkleProof, LightNodeError> {
    let err = || invalid("undecodable proof blob");
    (|| {
        if blob.len() < 72 {
            return None;
        }
        let g32 = |o: usize| <[u8; 32]>::try_from(&blob[o..o + 32]).ok();
        let path_len = u32::from_be_bytes(blob[32..36].try_into().ok()?) as usize;
        if blob.len() < 36 + path_len * 32 + 8 {
            return None;
        }
        let mut path = Vec::with_capacity(path_len);
        for i in 0..path_len {
            path.push(g32(36 + i * 32)?);
        }
        let base = 36 + path_len * 32;
        Some(kovanica_state::spv::MerkleProof {
            leaf: g32(0)?,
            path,
            index: u64::from_be_bytes(blob[base..base + 8].try_into().ok()?) as usize,
        })
    })()
    .ok_or_else(err)
}

/// Decode a 32-byte secret-seed hex string into a keypair. The secret is
/// consumed by the caller for a single operation and never stored.
fn keypair_from_secret(secret_hex: &str) -> Result<kovanica_state::KeyPair, LightNodeError> {
    let raw = decode_hex(secret_hex, "secret")?;
    let bytes =
        <[u8; 32]>::try_from(raw.as_slice()).map_err(|_| LightNodeError::BadSecretLength {
            expected: 32,
            got: raw.len() as u32,
        })?;
    Ok(kovanica_state::KeyPair::from_seed(bytes))
}

/// Decode a 32-byte hex string into a fixed array.
fn decode_32(s: &str, field: &str) -> Result<[u8; 32], LightNodeError> {
    let raw = decode_hex(s, field)?;
    <[u8; 32]>::try_from(raw.as_slice())
        .map_err(|_| invalid(format!("{field} must be 32 bytes hex")))
}

/// Parse an `Option<String>` asset id hex into an `Option<AssetId>`.
fn parse_asset_id(
    asset_id_hex: Option<String>,
) -> Result<Option<kovanica_state::AssetId>, LightNodeError> {
    match asset_id_hex {
        Some(hex) => {
            let raw = decode_hex(&hex, "asset id")?;
            if raw.len() != 32 {
                return Err(invalid("asset id must be 32 bytes hex"));
            }
            Ok(Some(kovanica_state::AssetId::from_bytes(
                <[u8; 32]>::try_from(raw.as_slice())
                    .map_err(|_| invalid("asset id must be 32 bytes hex"))?,
            )))
        }
        None => Ok(None),
    }
}

/// Parse an HTLC template from its 100-byte hex form.
fn parse_htlc_script(script_hex: &str) -> Result<kovanica_state::htlc::HtlcScript, LightNodeError> {
    let raw = decode_hex(script_hex, "HTLC script")?;
    kovanica_state::htlc::HtlcScript::parse(&raw)
        .map_err(|e| invalid(format!("invalid HTLC script: {e}")))
}

/// Parse a Vault template from its 40-byte hex form.
fn parse_vault_script(
    script_hex: &str,
) -> Result<kovanica_state::vault::VaultScript, LightNodeError> {
    let raw = decode_hex(script_hex, "Vault script")?;
    kovanica_state::vault::VaultScript::parse(&raw)
        .map_err(|e| invalid(format!("invalid Vault script: {e}")))
}

/// Parse an outpoint from a tx-id hex string and index.
fn parse_outpoint(tx_hex: &str, index: u32) -> Result<OutPoint, LightNodeError> {
    let raw = decode_hex(tx_hex, "outpoint tx")?;
    let tx = kovanica_state::TxId::from_bytes(
        <[u8; 32]>::try_from(raw.as_slice())
            .map_err(|_| invalid("outpoint tx must be 32 bytes hex"))?,
    );
    Ok(OutPoint::new(tx, index))
}
