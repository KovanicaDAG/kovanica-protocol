//! Typed HTTP client for the public Kovanica API.
//!
//! Routes verified against `kovanica-node` `explorer.rs`:
//! - `GET  /api/head`
//! - `GET  /api/utxos?address=&limit=&offset=`
//! - `GET  /api/fee_estimate`
//! - `POST /api/submit_tx` with `{"tx_hex": "<hex>"}`
//! - `POST /api/multisig/create` — create M-of-N address
//! - `POST /api/multisig/build` — build unsigned multisig spend
//! - `POST /api/multisig/sign` — sign with one cosigner key (client-side)
//! - `POST /api/multisig/combine` — combine partial signatures
//! - `POST /api/multisig/submit` — submit fully signed multisig tx
//!
//! Default base URL: `https://api.kovanica.online`.
//! Tests that hit the network are gated behind the `live-testnet` feature.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use kovanica_tx::SignedTx;
use kovanica_types::{
    Address, Amount, AssetId, Block, BlockColour, BlockHash, BlockKind, ConfirmingStatus, Hash32,
    NetworkId, TxHash, Utxo,
};
use serde::{Deserialize, Serialize};

/// Default public API endpoint.
pub const DEFAULT_API_BASE: &str = "https://api.kovanica.online";

/// RPC / HTTP errors.
#[derive(Debug, thiserror::Error)]
pub enum RpcError {
    /// HTTP transport error.
    #[error("http error: {0}")]
    Http(String),
    /// JSON decode error.
    #[error("decode error: {0}")]
    Decode(String),
    /// API returned an error payload.
    #[error("api error: {0}")]
    Api(String),
    /// Unexpected status code.
    #[error("unexpected status {0}")]
    Status(u16),
}

/// Minimal shape of `/api/head` (extend as the node adds fields).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeadInfo {
    /// Network name.
    pub network: String,
    /// Genesis hash.
    #[serde(default)]
    pub genesis: Option<String>,
    /// Current tip hash.
    #[serde(default)]
    pub tip: Option<String>,
    /// Approximate height / block count.
    #[serde(default)]
    pub blocks: Option<u64>,
    /// Minimum fee (atoms) if advertised.
    #[serde(default)]
    pub min_fee: Option<u64>,
    /// Atom scale (should be 1e8).
    #[serde(default)]
    pub atom: Option<u64>,
    /// Current block subsidy in atoms (RFC-006).
    #[serde(default)]
    pub subsidy: Option<u64>,
    /// Native KVNC minted so far (atoms).
    #[serde(default)]
    pub native_minted: Option<u64>,
    /// Total supply (atoms).
    #[serde(default)]
    pub total: Option<u64>,
    /// Circulating supply (atoms).
    #[serde(default)]
    pub circulating: Option<u64>,
    /// Burned fees (atoms).
    #[serde(default)]
    pub burned: Option<u64>,
    /// RFC-006 hard cap (90.2M KVNC in atoms).
    #[serde(default)]
    pub max_supply: Option<u64>,
}

/// One UTXO row from `/api/utxos` (node `utxos_json` shape).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UtxoItem {
    /// Hash of the transaction that created the output (hex).
    pub tx: String,
    /// Output index within that transaction.
    pub index: u64,
    /// Value in atoms.
    pub value: u64,
    /// Asset id hex, or null for native KVNC.
    pub asset_id: Option<String>,
    /// Asset kind: "fungible", "nft", or null (native).
    pub kind: Option<String>,
    /// Optional metadata hash (hex).
    #[serde(default)]
    pub metadata_hash: Option<String>,
    /// Optional collection id (hex).
    #[serde(default)]
    pub collection_id: Option<String>,
}

impl UtxoItem {
    /// Convert a node `/api/utxos` row into a domain [`Utxo`] ready for the
    /// transaction builder, binding the *query* address as the owner (the node
    /// does not repeat it per row).
    ///
    /// Wire parity with `kovanica-node` `utxos_json` + `asset_id_to_wire`:
    /// - `tx` is the lowercase 64-hex transaction id,
    /// - `asset_id` is `"KVNC"` (native) or the lowercase 64-hex asset id.
    pub fn into_domain(&self, owner: &Address) -> Result<Utxo, RpcError> {
        let tx_hash =
            TxHash::from_hex(&self.tx).map_err(|e| RpcError::Decode(format!("utxo tx: {e}")))?;
        let asset_id = match self.asset_id.as_deref() {
            None | Some("KVNC") => AssetId::NATIVE,
            Some(hex) => {
                let hash = Hash32::from_hex(hex)
                    .map_err(|e| RpcError::Decode(format!("utxo asset_id: {e}")))?;
                AssetId(hash)
            }
        };
        Ok(Utxo {
            tx_hash,
            vout: self.index.min(u32::MAX as u64) as u32,
            amount: Amount::from_atoms(self.value),
            asset_id,
            address: *owner,
        })
    }
}

/// Full `/api/utxos` response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UtxosResponse {
    /// Requested address (66-hex form).
    pub address: String,
    /// Native balance in atoms.
    pub balance: u64,
    /// Per-asset balances: asset hex → atoms.
    #[serde(default)]
    pub balances: std::collections::BTreeMap<String, u64>,
    /// UTXO rows (offset/limit applied).
    pub utxos: Vec<UtxoItem>,
    /// Applied limit.
    pub limit: u64,
    /// Applied offset.
    pub offset: u64,
    /// Total rows available.
    pub total: u64,
}

/// `/api/fee_estimate` response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeeEstimate {
    /// Fee rate in atoms per byte.
    pub fee_rate: u64,
    /// Unit string ("atoms/byte").
    pub unit: String,
    /// Number of pending mempool transactions.
    pub mempool: u64,
    /// Total mempool bytes.
    pub bytes: u64,
}

/// One block row from `GET /api/block/<id>` (node `block_detail_json` shape).
///
/// Everything arrives as strings or numbers; [`Self::into_domain`] maps it to
/// the rich [`Block`] view with typed enums.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockItem {
    /// Block id (64 hex).
    pub id: String,
    /// Selected-parent hash (64 hex; zero for genesis).
    pub prev_hash: String,
    /// Merkle root of the block's transaction ids (64 hex).
    pub merkle_root: String,
    /// Selected-chain height.
    pub height: u64,
    /// Producer timestamp, milliseconds since the Unix epoch.
    pub timestamp_ms: u64,
    /// Proof-of-work nonce.
    pub nonce: u64,
    /// GHOSTDAG blue score.
    pub blue_score: u64,
    /// Cumulative blue work of the selected chain.
    pub chain_blue_work: u128,
    /// The block's own work weight.
    pub work: u128,
    /// Parent block ids (64 hex).
    pub parents: Vec<String>,
    /// Child block ids (64 hex).
    pub children: Vec<String>,
    /// Transaction ids (64 hex).
    pub txs: Vec<String>,
    /// `"pow"` or `"staked"`.
    pub kind: String,
    /// `"genesis" | "chain" | "blue" | "red"`.
    pub colour: String,
    /// `"tip" | "confirmed" | "accepted" | "pending"`.
    pub confirming_status: String,
}

impl BlockItem {
    /// Map a node block row into the typed domain view.
    pub fn into_domain(&self) -> Result<Block, RpcError> {
        let parse_hash = |s: &str, what: &str| {
            Hash32::from_hex(s).map_err(|e| RpcError::Decode(format!("block {what}: {e}")))
        };
        let kind = match self.kind.as_str() {
            "staked" => BlockKind::Staked,
            _ => BlockKind::Pow,
        };
        let colour = match self.colour.as_str() {
            "genesis" => BlockColour::Genesis,
            "chain" => BlockColour::Chain,
            "blue" => BlockColour::Blue,
            _ => BlockColour::Red,
        };
        let status = match self.confirming_status.as_str() {
            "tip" => ConfirmingStatus::Tip,
            "confirmed" => ConfirmingStatus::Confirmed,
            "accepted" => ConfirmingStatus::Accepted,
            _ => ConfirmingStatus::Pending,
        };
        Ok(Block {
            id: parse_hash(&self.id, "id")?,
            prev_hash: parse_hash(&self.prev_hash, "prev_hash")?,
            merkle_root: parse_hash(&self.merkle_root, "merkle_root")?,
            height: self.height,
            timestamp_ms: self.timestamp_ms,
            nonce: self.nonce,
            blue_score: self.blue_score,
            chain_blue_work: self.chain_blue_work,
            work: self.work,
            parents: self
                .parents
                .iter()
                .map(|p| parse_hash(p, "parent"))
                .collect::<Result<_, _>>()?,
            children: self
                .children
                .iter()
                .map(|c| parse_hash(c, "child"))
                .collect::<Result<_, _>>()?,
            txs: self
                .txs
                .iter()
                .map(|t| parse_hash(t, "tx"))
                .collect::<Result<_, _>>()?,
            kind,
            colour,
            confirming_status: status,
        })
    }
}

/// `/api/bootstrap` response — node/consensus parameters the client needs to
/// know (RFC-006 tokenomics, GHOSTDAG k, network identity).
///
/// Read-only mirror of the node's JSON; fields the node may omit stay `None`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapInfo {
    /// Network name (e.g. "kovanica-testnet").
    #[serde(default)]
    pub network: Option<String>,
    /// Genesis hash (hex).
    #[serde(default)]
    pub genesis: Option<String>,
    /// GHOSTDAG k parameter (3 on testnet).
    #[serde(default)]
    pub k: Option<u32>,
    /// Native token symbol.
    #[serde(default)]
    pub token: Option<String>,
    /// Atom scale (should be 1e8 = atoms per KVNC).
    #[serde(default)]
    pub atom: Option<u64>,
    /// Minimum fee (atoms/byte) the node advertises.
    #[serde(default)]
    pub min_fee: Option<u64>,
    /// Current block subsidy in atoms (RFC-006).
    #[serde(default)]
    pub subsidy: Option<u64>,
    /// RFC-006 hard cap in atoms (90.2M KVNC).
    #[serde(default)]
    pub max_supply: Option<u64>,
    /// Native KVNC minted so far (atoms).
    #[serde(default)]
    pub native_minted: Option<u64>,
    /// Total supply (atoms).
    #[serde(default)]
    pub total: Option<u64>,
    /// Circulating supply (atoms).
    #[serde(default)]
    pub circulating: Option<u64>,
    /// Burned fees (atoms).
    #[serde(default)]
    pub burned: Option<u64>,
    /// Configured P2P peer list (DNS seed names / origin IPs).
    #[serde(default)]
    pub peers: Vec<String>,
}

/// `/api/multisig/create` response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultisigCreateResponse {
    /// P2SH address (kvnc…dag form).
    pub address: String,
    /// Redeem script (hex).
    pub redeem_script_hex: String,
}

/// `/api/multisig/build` response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultisigBuildResponse {
    /// Unsigned transaction blob (hex).
    pub tx_blob_hex: String,
    /// Sighash of the unsigned transaction (64 hex).
    pub sighash_hex: String,
}

/// `/api/multisig/sign` response — one cosigner's partial signature.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultisigSignResponse {
    /// Partial signature (64 bytes, hex).
    pub partial_sig_hex: String,
}

/// `/api/multisig/combine` response — fully signed transaction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultisigCombineResponse {
    /// Signed transaction blob (hex), ready for submit.
    pub signed_tx_blob_hex: String,
}

/// `/api/multisig/submit` response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultisigSubmitResponse {
    /// Accepted transaction id (hex).
    pub tx_id_hex: String,
}

/// HTTP client.
#[derive(Clone)]
pub struct Client {
    base_url: String,
    http: reqwest::Client,
}

impl Client {
    /// Custom base URL.
    pub fn new(base_url: impl Into<String>) -> Result<Self, RpcError> {
        let http = reqwest::Client::builder()
            .user_agent(concat!("kovanica-sdk/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| RpcError::Http(e.to_string()))?;
        Ok(Client {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            http,
        })
    }

    /// Convenience: public testnet/mainnet shared API.
    pub fn default_public() -> Result<Self, RpcError> {
        Self::new(DEFAULT_API_BASE)
    }

    /// Alias for clarity in examples (shared public API).
    pub fn testnet() -> Result<Self, RpcError> {
        Self::default_public()
    }

    /// Alias for clarity in examples (shared public API).
    pub fn mainnet() -> Result<Self, RpcError> {
        Self::default_public()
    }

    /// GET /api/head
    pub async fn get_head(&self) -> Result<HeadInfo, RpcError> {
        let url = format!("{}/api/head", self.base_url);
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| RpcError::Http(e.to_string()))?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(RpcError::Status(status));
        }
        resp.json::<HeadInfo>()
            .await
            .map_err(|e| RpcError::Decode(e.to_string()))
    }

    /// GET /api/utxos for an address (address sent as 66-hex, as the node renders it).
    pub async fn get_utxos(
        &self,
        address: &Address,
        limit: Option<u64>,
        offset: Option<u64>,
    ) -> Result<UtxosResponse, RpcError> {
        let mut url = format!("{}/api/utxos?address={}", self.base_url, address.to_hex());
        if let Some(l) = limit {
            url.push_str(&format!("&limit={l}"));
        }
        if let Some(o) = offset {
            url.push_str(&format!("&offset={o}"));
        }
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| RpcError::Http(e.to_string()))?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            let text = resp.text().await.unwrap_or_default();
            return Err(RpcError::Api(format!("status {status}: {text}")));
        }
        resp.json::<UtxosResponse>()
            .await
            .map_err(|e| RpcError::Decode(e.to_string()))
    }

    /// GET /api/fee_estimate — current mempool fee rate (atoms/byte).
    pub async fn get_fee_estimate(&self) -> Result<FeeEstimate, RpcError> {
        let url = format!("{}/api/fee_estimate", self.base_url);
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| RpcError::Http(e.to_string()))?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(RpcError::Status(status));
        }
        resp.json::<FeeEstimate>()
            .await
            .map_err(|e| RpcError::Decode(e.to_string()))
    }

    /// GET /api/block/<id> — detail view of one DAG block, typed.
    ///
    /// `id` is the block hash; the node answers with parents, children, tx
    /// ids, GHOSTDAG colour and confirmation status relative to the current
    /// tip (see [`Block`]).
    pub async fn get_block(&self, id: &BlockHash) -> Result<Block, RpcError> {
        let url = format!("{}/api/block/{}", self.base_url, id.to_hex());
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| RpcError::Http(e.to_string()))?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            let text = resp.text().await.unwrap_or_default();
            return Err(RpcError::Api(format!("status {status}: {text}")));
        }
        let item: BlockItem = resp
            .json()
            .await
            .map_err(|e| RpcError::Decode(e.to_string()))?;
        item.into_domain()
    }

    /// GET /api/bootstrap — consensus + tokenomics parameters (RFC-006, k).
    pub async fn get_bootstrap(&self) -> Result<BootstrapInfo, RpcError> {
        let url = format!("{}/api/bootstrap", self.base_url);
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| RpcError::Http(e.to_string()))?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(RpcError::Status(status));
        }
        resp.json::<BootstrapInfo>()
            .await
            .map_err(|e| RpcError::Decode(e.to_string()))
    }

    /// Submit a signed transaction: `POST /api/submit_tx` with `{"tx_hex": …}`.
    ///
    /// Returns the accepted transaction id (hex).
    pub async fn submit_tx(&self, signed: &SignedTx) -> Result<TxHash, RpcError> {
        let url = format!("{}/api/submit_tx", self.base_url);
        let body = serde_json::json!({ "tx_hex": signed.tx_hex() });
        let resp = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| RpcError::Http(e.to_string()))?;
        let status = resp.status().as_u16();
        let text = resp
            .text()
            .await
            .map_err(|e| RpcError::Http(e.to_string()))?;
        if !(200..300).contains(&status) {
            return Err(RpcError::Api(format!("status {status}: {text}")));
        }
        // `{"ok":true,"tx":"<tx_id>"}` (also tolerate bare hash / tx_hash).
        #[derive(Deserialize)]
        struct SubmitResp {
            #[serde(default)]
            ok: bool,
            #[serde(default)]
            tx: Option<String>,
            #[serde(alias = "hash", alias = "txid")]
            tx_hash: Option<String>,
        }
        if let Ok(h) = TxHash::from_hex(text.trim().trim_matches('"')) {
            return Ok(h);
        }
        let parsed: SubmitResp =
            serde_json::from_str(&text).map_err(|e| RpcError::Decode(e.to_string()))?;
        if !parsed.ok {
            return Err(RpcError::Api(text));
        }
        let hex = parsed
            .tx
            .or(parsed.tx_hash)
            .ok_or_else(|| RpcError::Decode("missing tx id in response".into()))?;
        TxHash::from_hex(&hex).map_err(|e| RpcError::Decode(e.to_string()))
    }

    /// POST /api/multisig/create — create an M-of-N multisig address.
    ///
    /// `threshold` = required signatures (M), `pubkeys_hex` = list of N 32-byte
    /// Ed25519 public keys (hex). Returns address (kvnc…dag) and redeem script.
    pub async fn multisig_create(
        &self,
        threshold: u8,
        pubkeys_hex: &[String],
    ) -> Result<MultisigCreateResponse, RpcError> {
        let url = format!("{}/api/multisig/create", self.base_url);
        let body = serde_json::json!({
            "threshold": threshold as u64,
            "pubkeys_hex": pubkeys_hex,
        });
        let resp = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| RpcError::Http(e.to_string()))?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            let text = resp.text().await.unwrap_or_default();
            return Err(RpcError::Api(format!("status {status}: {text}")));
        }
        resp.json::<MultisigCreateResponse>()
            .await
            .map_err(|e| RpcError::Decode(e.to_string()))
    }

    /// POST /api/multisig/build — build an unsigned multisig spend.
    ///
    /// `address` = the P2SH multisig address (kvnc…dag or 66-hex).
    /// `outputs` = list of `{ "address": "...", "amount_atoms": N }`.
    /// Returns the unsigned tx blob (hex) and its sighash (64 hex).
    pub async fn multisig_build(
        &self,
        address: &str,
        outputs: &[(Address, Amount)],
    ) -> Result<MultisigBuildResponse, RpcError> {
        let url = format!("{}/api/multisig/build", self.base_url);
        let outputs_json: Vec<serde_json::Value> = outputs
            .iter()
            .map(|(addr, amt)| {
                serde_json::json!({
                    "address": addr.to_hex(),
                    "amount_atoms": amt.atoms(),
                })
            })
            .collect();
        let body = serde_json::json!({
            "address": address,
            "outputs": outputs_json,
        });
        let resp = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| RpcError::Http(e.to_string()))?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            let text = resp.text().await.unwrap_or_default();
            return Err(RpcError::Api(format!("status {status}: {text}")));
        }
        resp.json::<MultisigBuildResponse>()
            .await
            .map_err(|e| RpcError::Decode(e.to_string()))
    }

    /// POST /api/multisig/sign — cosigner signs the multisig tx (offline style).
    ///
    /// The caller provides the unsigned `tx_blob_hex` (from `multisig_build`)
    /// and their `secret_hex` (64-hex Ed25519 private key). Returns the
    /// partial signature (64 bytes, hex).
    ///
    /// **Security note**: the private key never leaves the caller — this is an
    /// RPC wrapper for the node's signing helper. For true offline signing, use
    /// `kovanica-tx` `MultisigSigner` directly.
    pub async fn multisig_sign(
        &self,
        tx_blob_hex: &str,
        secret_hex: &str,
    ) -> Result<MultisigSignResponse, RpcError> {
        let url = format!("{}/api/multisig/sign", self.base_url);
        let body = serde_json::json!({
            "tx_blob_hex": tx_blob_hex,
            "secret_hex": secret_hex,
        });
        let resp = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| RpcError::Http(e.to_string()))?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            let text = resp.text().await.unwrap_or_default();
            return Err(RpcError::Api(format!("status {status}: {text}")));
        }
        resp.json::<MultisigSignResponse>()
            .await
            .map_err(|e| RpcError::Decode(e.to_string()))
    }

    /// POST /api/multisig/combine — combine partial signatures into a signed tx.
    ///
    /// `tx_blob_hex` = the original unsigned tx, `partial_sigs_hex` = list of
    /// 64-byte partial signatures (hex). Returns the fully signed tx blob
    /// ready for `multisig_submit`.
    pub async fn multisig_combine(
        &self,
        tx_blob_hex: &str,
        partial_sigs_hex: &[String],
    ) -> Result<MultisigCombineResponse, RpcError> {
        let url = format!("{}/api/multisig/combine", self.base_url);
        let body = serde_json::json!({
            "tx_blob_hex": tx_blob_hex,
            "partial_sigs_hex": partial_sigs_hex,
        });
        let resp = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| RpcError::Http(e.to_string()))?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            let text = resp.text().await.unwrap_or_default();
            return Err(RpcError::Api(format!("status {status}: {text}")));
        }
        resp.json::<MultisigCombineResponse>()
            .await
            .map_err(|e| RpcError::Decode(e.to_string()))
    }

    /// POST /api/multisig/submit — submit a fully signed multisig transaction.
    ///
    /// Returns the accepted transaction id (hex).
    pub async fn multisig_submit(&self, signed_tx_blob_hex: &str) -> Result<TxHash, RpcError> {
        let url = format!("{}/api/multisig/submit", self.base_url);
        let body = serde_json::json!({ "signed_tx_blob_hex": signed_tx_blob_hex });
        let resp = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| RpcError::Http(e.to_string()))?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            let text = resp.text().await.unwrap_or_default();
            return Err(RpcError::Api(format!("status {status}: {text}")));
        }
        let r: MultisigSubmitResponse = resp
            .json()
            .await
            .map_err(|e| RpcError::Decode(e.to_string()))?;
        TxHash::from_hex(&r.tx_id_hex).map_err(|e| RpcError::Decode(e.to_string()))
    }
}

/// Map network name from head into our enum when possible.
pub fn parse_network_id(s: &str) -> Option<NetworkId> {
    match s {
        "kovanica-testnet" | "testnet" => Some(NetworkId::Testnet),
        "kovanica" | "mainnet" => Some(NetworkId::Mainnet),
        _ => None,
    }
}

#[cfg(all(test, feature = "live-testnet"))]
mod live_tests {
    use super::*;

    #[tokio::test]
    async fn head_reachable() {
        let client = Client::testnet().unwrap();
        let head = client.get_head().await.expect("head");
        assert!(!head.network.is_empty());
        println!("network = {}, blocks = {:?}", head.network, head.blocks);
    }
}
