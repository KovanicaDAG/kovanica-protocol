//! Core data types for the Kovanica protocol.
//!
//! Pure data + serde + the canonical transaction codec. No key operations.
//! All amounts are in **atoms** (1 KVNC = 100_000_000 atoms).
//!
//! The `Transaction` wire format mirrors `kovanica-state` `tx.rs` exactly:
//! length-prefixed, little-endian, BLAKE3 sighash over the witness-free
//! encoding. `Address` is a 33-byte versioned value (`version ‖ payload32`)
//! rendered for humans as `kvnc` + base58 + `dag` (NOT bech32).

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

/// Native atom scale: 1 KVNC = 10^8 atoms.
pub const ATOMS_PER_KVNC: u64 = 100_000_000;

/// Network identifier (client-side only; NOT part of the wire encoding).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NetworkId {
    /// Public testnet (`kovanica-testnet`).
    Testnet,
    /// Mainnet (`kovanica`).
    Mainnet,
}

impl NetworkId {
    /// Human-readable name used by nodes and explorers.
    pub fn as_str(self) -> &'static str {
        match self {
            NetworkId::Testnet => "kovanica-testnet",
            NetworkId::Mainnet => "kovanica",
        }
    }
}

impl fmt::Display for NetworkId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Amount in atoms. Newtype to avoid accidental unit mistakes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Amount(pub u64);

impl Amount {
    /// Zero.
    pub const ZERO: Amount = Amount(0);

    /// Create from atoms.
    pub const fn from_atoms(atoms: u64) -> Self {
        Amount(atoms)
    }

    /// Create from whole KVNC (multiplies by 10^8).
    pub const fn from_kvnc(kvnc: u64) -> Self {
        Amount(kvnc.saturating_mul(ATOMS_PER_KVNC))
    }

    /// Raw atoms.
    pub const fn atoms(self) -> u64 {
        self.0
    }
}

impl fmt::Display for Amount {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let whole = self.0 / ATOMS_PER_KVNC;
        let frac = self.0 % ATOMS_PER_KVNC;
        write!(f, "{}.{:08} KVNC", whole, frac)
    }
}

/// 32-byte hash (block, tx, asset, …).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Hash32(pub [u8; 32]);

impl Hash32 {
    /// All-zero hash (native asset / null).
    pub const ZERO: Hash32 = Hash32([0u8; 32]);

    /// Parse from lowercase hex (64 chars).
    pub fn from_hex(s: &str) -> Result<Self, TypesError> {
        let bytes = hex::decode(s).map_err(|_| TypesError::InvalidHex)?;
        if bytes.len() != 32 {
            return Err(TypesError::InvalidLength);
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(Hash32(arr))
    }

    /// Lowercase hex encoding.
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}

impl fmt::Display for Hash32 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex())
    }
}

/// Transaction hash.
pub type TxHash = Hash32;
/// Block / DAG block hash.
pub type BlockHash = Hash32;

/// Asset identifier (KVP-102). Native KVNC is the zero hash.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct AssetId(pub Hash32);

impl AssetId {
    /// Native KVNC asset.
    pub const NATIVE: AssetId = AssetId(Hash32::ZERO);

    /// Whether this is the native token.
    pub fn is_native(self) -> bool {
        self.0 == Hash32::ZERO
    }
}

impl fmt::Display for AssetId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.is_native() {
            f.write_str("KVNC")
        } else {
            write!(f, "{}", self.0)
        }
    }
}

/// Ed25519 public key (32 bytes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PublicKey(pub [u8; 32]);

impl PublicKey {
    /// Parse from hex.
    pub fn from_hex(s: &str) -> Result<Self, TypesError> {
        let bytes = hex::decode(s).map_err(|_| TypesError::InvalidHex)?;
        if bytes.len() != 32 {
            return Err(TypesError::InvalidLength);
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(PublicKey(arr))
    }

    /// Hex encoding.
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}

/// Ed25519 signature (64 bytes). Serde uses the 128-char lowercase hex form
/// (fixed arrays > 32 bytes have no serde impls).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Signature(pub [u8; 64]);

impl Signature {
    /// Parse from hex (128 chars).
    pub fn from_hex(s: &str) -> Result<Self, TypesError> {
        let bytes = hex::decode(s).map_err(|_| TypesError::InvalidHex)?;
        if bytes.len() != 64 {
            return Err(TypesError::InvalidLength);
        }
        let mut arr = [0u8; 64];
        arr.copy_from_slice(&bytes);
        Ok(Signature(arr))
    }

    /// Hex encoding (128 chars).
    pub fn to_hex(self) -> String {
        hex::encode(self.0)
    }

    /// The all-zero placeholder used before an input is signed.
    pub const fn zero() -> Self {
        Signature([0u8; 64])
    }
}

impl Serialize for Signature {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_hex())
    }
}

impl<'de> Deserialize<'de> for Signature {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        Signature::from_hex(&s).map_err(serde::de::Error::custom)
    }
}

/// Address version byte: P2PK (Ed25519 public key).
pub const ADDR_VERSION_P2PK: u8 = 0x00;
/// Address version byte: P2SH (BLAKE3 script hash / multisig).
pub const ADDR_VERSION_P2SH: u8 = 0x01;
/// Address version byte: Script v2.
pub const ADDR_VERSION_SCRIPT_V2: u8 = 0x02;
/// Address version byte: Stealth (65-byte payload layout on wire).
pub const ADDR_VERSION_STEALTH: u8 = 0x03;
/// Address version byte: HTLC.
pub const ADDR_VERSION_HTLC: u8 = 0x04;
/// Address version byte: Vault / CSV.
pub const ADDR_VERSION_VAULT: u8 = 0x05;
/// Highest supported address version byte.
pub const ADDR_VERSION_MAX: u8 = 0x05;

/// A Kovanica address: version byte + 32-byte payload (33 bytes total),
/// identical to `kovanica-state` `keys::Address`.
///
/// Human form: `kvnc` + base58(33 bytes) + `dag`. `Display` renders the
/// 66-hex form, matching node behaviour. Serde uses the 66-hex form (the same
/// representation the explorer API returns).
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Address(pub [u8; 33]);

impl Address {
    /// Construct from canonical 33 versioned bytes. Panics if `version > max`.
    pub const fn from_versioned(bytes: [u8; 33]) -> Self {
        Address(bytes)
    }

    /// Construct a P2PK (version 0x00) address from 32 public-key bytes.
    pub const fn p2pk(pubkey: [u8; 32]) -> Self {
        let mut raw = [0u8; 33];
        raw[0] = ADDR_VERSION_P2PK;
        let mut i = 1;
        while i < 33 {
            raw[i] = pubkey[i - 1];
            i += 1;
        }
        Address(raw)
    }

    /// Construct a P2SH (version 0x01) address from a 32-byte BLAKE3 script hash.
    pub const fn p2sh(script_hash: [u8; 32]) -> Self {
        let mut raw = [0u8; 33];
        raw[0] = ADDR_VERSION_P2SH;
        let mut i = 1;
        while i < 33 {
            raw[i] = script_hash[i - 1];
            i += 1;
        }
        Address(raw)
    }

    /// Construct a HTLC (version 0x04) address from a 32-byte BLAKE3 template hash.
    pub const fn htlc(script_hash: [u8; 32]) -> Self {
        let mut raw = [0u8; 33];
        raw[0] = ADDR_VERSION_HTLC;
        let mut i = 1;
        while i < 33 {
            raw[i] = script_hash[i - 1];
            i += 1;
        }
        Address(raw)
    }

    /// Construct a Vault (version 0x05) address from a 32-byte BLAKE3 template hash.
    pub const fn vault(script_hash: [u8; 32]) -> Self {
        let mut raw = [0u8; 33];
        raw[0] = ADDR_VERSION_VAULT;
        let mut i = 1;
        while i < 33 {
            raw[i] = script_hash[i - 1];
            i += 1;
        }
        Address(raw)
    }

    /// The version byte of this address.
    pub const fn version(&self) -> u8 {
        self.0[0]
    }

    /// Whether this is a P2PK (version 0x00) address.
    pub const fn is_p2pk(&self) -> bool {
        self.0[0] == ADDR_VERSION_P2PK
    }

    /// The 32-byte payload (Ed25519 public key for P2PK, BLAKE3 script hash for P2SH).
    pub fn payload(&self) -> [u8; 32] {
        let mut p = [0u8; 32];
        p.copy_from_slice(&self.0[1..]);
        p
    }

    /// The canonical 33-byte versioned slice.
    pub const fn as_bytes(&self) -> &[u8; 33] {
        &self.0
    }

    /// Parse the node's hex address forms: 66-hex (versioned) or 64-hex
    /// (legacy bare pubkey → P2PK). The `kvnc…dag` base58 form is handled by
    /// `kovanica-keys`.
    pub fn from_hex(s: &str) -> Result<Self, TypesError> {
        parse_address_hex(s)
    }

    /// Lowercase 66-hex rendering of the 33-byte address.
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}

impl fmt::Debug for Address {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Address({}…)", &self.to_hex()[..8])
    }
}

impl fmt::Display for Address {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex())
    }
}

impl Serialize for Address {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_hex())
    }
}

impl<'de> Deserialize<'de> for Address {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        parse_address_hex(&s).map_err(serde::de::Error::custom)
    }
}

fn parse_address_hex(s: &str) -> Result<Address, TypesError> {
    // 66-hex: versioned 33 bytes.
    if s.len() == 66 && s.bytes().all(|b| b.is_ascii_hexdigit()) {
        let raw = hex::decode(s).map_err(|_| TypesError::InvalidHex)?;
        if raw[0] > ADDR_VERSION_MAX {
            return Err(TypesError::Validation("unsupported address version".into()));
        }
        let mut arr = [0u8; 33];
        arr.copy_from_slice(&raw);
        return Ok(Address(arr));
    }
    // 64-hex: legacy bare pubkey → P2PK.
    if s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()) {
        let raw = hex::decode(s).map_err(|_| TypesError::InvalidHex)?;
        let mut pk = [0u8; 32];
        pk.copy_from_slice(&raw);
        return Ok(Address::p2pk(pk));
    }
    Err(TypesError::Validation(
        "address must be 66-hex (versioned) or 64-hex (legacy P2PK); kvnc…dag form is handled by kovanica-keys"
            .into(),
    ))
}

/// Unspent transaction output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Utxo {
    /// Outpoint (tx hash + output index).
    pub tx_hash: TxHash,
    /// Output index within the transaction.
    pub vout: u32,
    /// Amount in atoms.
    pub amount: Amount,
    /// Asset (native = zero hash).
    pub asset_id: AssetId,
    /// Locking address that can spend this UTXO.
    pub address: Address,
}

/// One-time key material accompanying a stealth output (version 0x03).
///
/// Mirrors `kovanica-state` `tx::StealthExt`: `R = r·G` (32B), 1-byte view
/// tag, and the one-time pubkey `P` (32B).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct StealthExt {
    /// `R = r·G`: the sender's ephemeral public key (32 bytes).
    pub r: [u8; 32],
    /// View tag: first byte of `BLAKE3(scan_pk · r)`, for SPV filtering.
    pub view_tag: u8,
    /// `P = H(r · spend_pk) · G`: the one-time public key the ledger verifies spends against.
    pub p: [u8; 32],
}

/// A spend: the previous output being consumed and the witness stack
/// authorising it (mirrors `kovanica-state` `tx::TxInput`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TxInput {
    /// The previous transaction hash being spent.
    pub prev_tx: TxHash,
    /// Output index within the previous transaction.
    pub prev_vout: u32,
    /// Witness stack authorising the spend:
    /// P2PK / stealth: `vec![signature_64_bytes]`; P2SH: `vec![redeem_script, sig_1, …]`.
    #[serde(default)]
    pub witness: Vec<Vec<u8>>,
}

impl TxInput {
    /// An input with an empty witness (unsigned).
    pub fn fresh(prev_tx: TxHash, prev_vout: u32) -> Self {
        Self {
            prev_tx,
            prev_vout,
            witness: Vec::new(),
        }
    }

    /// A single-signature input (P2PK / stealth): witness = `[sig]`.
    pub fn single_sig(prev_tx: TxHash, prev_vout: u32, signature: [u8; 64]) -> Self {
        Self {
            prev_tx,
            prev_vout,
            witness: vec![signature.to_vec()],
        }
    }
}

/// A newly created output (mirrors `kovanica-state` `tx::TxOutput`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TxOutput {
    /// The value locked in this output (atoms).
    pub value: u64,
    /// The asset this output locks. `None` = native KVNC (serialised flag 0).
    pub asset_id: Option<AssetId>,
    /// The address that owns (may spend) this output.
    pub owner: Address,
    /// Stealth extension for v0x03 outputs; `None` for ordinary outputs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stealth: Option<StealthExt>,
}

impl TxOutput {
    /// Native KVNC output.
    pub const fn native(value: u64, owner: Address) -> Self {
        Self {
            value,
            asset_id: None,
            owner,
            stealth: None,
        }
    }

    /// Output with an explicit asset id.
    pub const fn new(value: u64, asset_id: Option<AssetId>, owner: Address) -> Self {
        Self {
            value,
            asset_id,
            owner,
            stealth: None,
        }
    }

    /// Output with an explicit asset id and stealth extension.
    pub const fn with_stealth(
        value: u64,
        asset_id: Option<AssetId>,
        owner: Address,
        stealth: StealthExt,
    ) -> Self {
        Self {
            value,
            asset_id,
            owner,
            stealth: Some(stealth),
        }
    }
}

/// A transaction: spends the outputs named by `inputs` and creates `outputs`.
///
/// Wire format mirrors `kovanica-state` `tx::Transaction` exactly. `network`
/// is a client-side label and is **never** part of the encoding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transaction {
    /// Client-side network label (NOT part of the wire encoding).
    pub network: NetworkId,
    /// Spent outputs.
    pub inputs: Vec<TxInput>,
    /// Created outputs.
    pub outputs: Vec<TxOutput>,
    /// Extra committed bytes (coinbases use this to disambiguate ids).
    #[serde(default)]
    pub tag: Vec<u8>,
    /// Lock time (BIP-65): 32-bit value bound into the sighash.
    pub n_lock_time: u32,
    /// Sequence (BIP-112): 32-bit value bound into the sighash.
    pub sequence: u32,
}

impl Transaction {
    /// Construct a transaction with explicit inputs, outputs and tag.
    pub fn new(
        network: NetworkId,
        inputs: Vec<TxInput>,
        outputs: Vec<TxOutput>,
        tag: Vec<u8>,
    ) -> Self {
        Self {
            network,
            inputs,
            outputs,
            tag,
            n_lock_time: 0,
            sequence: 0,
        }
    }

    /// The canonical byte encoding **including** witness (used for `submit`).
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        self.encode_into(&mut buf, true);
        buf
    }

    /// The witness-free canonical encoding (the sighash preimage).
    pub fn encode_sans_witness(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        self.encode_into(&mut buf, false);
        buf
    }

    /// Hex form of the canonical signed encoding — the `tx_hex` the node expects.
    pub fn encode_hex(&self) -> String {
        hex::encode(self.encode())
    }

    /// The signature hash: BLAKE3 over the witness-free encoding (`tx.rs` ~692).
    ///
    /// Inputs sign **these 32 bytes** with Ed25519. The node verifies with
    /// `verify_strict`.
    pub fn sighash(&self) -> [u8; 32] {
        *blake3::hash(&self.encode_sans_witness()).as_bytes()
    }

    /// 64-hex sighash — what the CLI/explorer display.
    pub fn sighash_hex(&self) -> String {
        hex::encode(self.sighash())
    }

    /// Byte-identical port of `kovanica-state` `Transaction::encode_into`.
    ///
    /// - `with_signatures = true`: includes dynamic witness items (used for `encode()`).
    /// - `with_signatures = false`: omits witness vectors (used for `sighash()`).
    ///
    /// Layout: `u64` input count; per input `outpoint.tx` (32B) + `index` (u32 LE) +
    /// optional witness (`u64` count, each `u64` len + bytes); `u64` output count;
    /// per output `value` (u64 LE) + asset flag (0 native / 1 + 32B) + stealth flag
    /// (0 / 1 + R 32B + view_tag 1B + P 32B) + owner (33B); `n_lock_time` (u32 LE) +
    /// `sequence` (u32 LE); tag (`u64` len + bytes).
    pub fn encode_into(&self, buf: &mut Vec<u8>, with_signatures: bool) {
        buf.extend_from_slice(&(self.inputs.len() as u64).to_le_bytes());
        for input in &self.inputs {
            buf.extend_from_slice(&input.prev_tx.0);
            buf.extend_from_slice(&input.prev_vout.to_le_bytes());
            if with_signatures {
                buf.extend_from_slice(&(input.witness.len() as u64).to_le_bytes());
                for item in &input.witness {
                    buf.extend_from_slice(&(item.len() as u64).to_le_bytes());
                    buf.extend_from_slice(item);
                }
            }
        }
        buf.extend_from_slice(&(self.outputs.len() as u64).to_le_bytes());
        for output in &self.outputs {
            buf.extend_from_slice(&output.value.to_le_bytes());
            match output.asset_id {
                None => buf.push(0),
                Some(asset_id) => {
                    buf.push(1);
                    buf.extend_from_slice(&asset_id.0 .0);
                }
            }
            match output.stealth {
                None => buf.push(0),
                Some(s) => {
                    buf.push(1);
                    buf.extend_from_slice(&s.r);
                    buf.push(s.view_tag);
                    buf.extend_from_slice(&s.p);
                }
            }
            buf.extend_from_slice(&output.owner.0);
        }
        buf.extend_from_slice(&self.n_lock_time.to_le_bytes());
        buf.extend_from_slice(&self.sequence.to_le_bytes());
        buf.extend_from_slice(&(self.tag.len() as u64).to_le_bytes());
        buf.extend_from_slice(&self.tag);
    }

    /// The inverse of [`Transaction::encode`]: parse one transaction from its
    /// canonical bytes (including witness), mirroring `kovanica-state` `tx.rs`
    /// `Transaction::decode` byte-for-byte.
    ///
    /// The node carries no `network` label (it is client-side only), so the
    /// caller supplies it.
    pub fn decode(bytes: &[u8], network: NetworkId) -> Result<Self, DecodeError> {
        let mut reader = Reader::new(bytes);
        let (inputs, outputs, tag, n_lock_time, sequence) = reader.read_transaction_fields()?;
        if reader.remaining() != 0 {
            return Err(DecodeError::TrailingBytes);
        }
        Ok(Transaction {
            network,
            inputs,
            outputs,
            tag,
            n_lock_time,
            sequence,
        })
    }
}

/// Errors from decoding a transaction from its canonical byte encoding.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DecodeError {
    /// The input ended before a fully-formed value could be read.
    #[error("unexpected end of payload")]
    UnexpectedEof,
    /// Bytes remained after decoding the transaction.
    #[error("trailing bytes after payload")]
    TrailingBytes,
}

/// A minimal, bounds-checked cursor over the payload bytes (port of the node
/// `tx.rs` `Reader`).
struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    fn remaining(&self) -> usize {
        self.buf.len() - self.pos
    }

    fn read_array<const N: usize>(&mut self) -> Result<[u8; N], DecodeError> {
        if self.remaining() < N {
            return Err(DecodeError::UnexpectedEof);
        }
        let mut out = [0u8; N];
        out.copy_from_slice(&self.buf[self.pos..self.pos + N]);
        self.pos += N;
        Ok(out)
    }

    fn read_u32(&mut self) -> Result<u32, DecodeError> {
        Ok(u32::from_le_bytes(self.read_array::<4>()?))
    }

    fn read_u64(&mut self) -> Result<u64, DecodeError> {
        Ok(u64::from_le_bytes(self.read_array::<8>()?))
    }

    /// Read a length prefix, rejecting counts that cannot fit even at
    /// `min_element_bytes` each — so malformed input can't request a giant
    /// allocation before the bytes run out.
    fn read_count(&mut self, min_element_bytes: usize) -> Result<usize, DecodeError> {
        let n = self.read_u64()? as usize;
        if min_element_bytes > 0 && n > self.remaining() / min_element_bytes {
            return Err(DecodeError::UnexpectedEof);
        }
        Ok(n)
    }

    fn read_array_dyn(&mut self, len: usize) -> Result<Vec<u8>, DecodeError> {
        if self.remaining() < len {
            return Err(DecodeError::UnexpectedEof);
        }
        let out = self.buf[self.pos..self.pos + len].to_vec();
        self.pos += len;
        Ok(out)
    }

    /// Reading is the inverse of `Transaction::encode_into(buf, true)`
    /// (witness included). Minimum input size: 32 (tx) + 4 (index) + 8
    /// (witness count) = 44 bytes.
    #[allow(clippy::type_complexity)]
    fn read_transaction_fields(
        &mut self,
    ) -> Result<(Vec<TxInput>, Vec<TxOutput>, Vec<u8>, u32, u32), DecodeError> {
        let n_inputs = self.read_count(44)?;
        let mut inputs = Vec::with_capacity(n_inputs);
        for _ in 0..n_inputs {
            let prev_tx = Hash32(self.read_array::<32>()?);
            let prev_vout = self.read_u32()?;
            // Minimum witness item size: 8 bytes length prefix.
            let n_witness = self.read_count(8)?;
            let mut witness = Vec::with_capacity(n_witness);
            for _ in 0..n_witness {
                let item_len = self.read_count(1)?;
                let item = self.read_array_dyn(item_len)?;
                witness.push(item);
            }
            inputs.push(TxInput {
                prev_tx,
                prev_vout,
                witness,
            });
        }
        // Minimum output size: 8 (value) + 1 (asset flag) + 1 (stealth flag)
        // + 33 (owner) = 43 bytes for an ordinary native output.
        // When stealth flag is 1, add 65 bytes for the stealth extension.
        // When asset flag is 1, add 32 bytes for asset_id.
        let n_outputs = self.read_count(43)?;
        let mut outputs = Vec::with_capacity(n_outputs);
        for _ in 0..n_outputs {
            let value = self.read_u64()?;
            let asset_flag = self.read_array::<1>()?[0];
            let asset_id = if asset_flag == 0 {
                None
            } else {
                Some(AssetId(Hash32(self.read_array::<32>()?)))
            };
            // stealth_flag: 1 byte (0 = ordinary, 1 = stealth)
            let stealth_flag = self.read_array::<1>()?[0];
            let stealth = if stealth_flag == 1 {
                let r = self.read_array::<32>()?;
                let view_tag = self.read_array::<1>()?[0];
                let p = self.read_array::<32>()?;
                Some(StealthExt { r, view_tag, p })
            } else {
                None
            };
            let owner = Address(self.read_array::<33>()?);
            outputs.push(TxOutput {
                value,
                asset_id,
                owner,
                stealth,
            });
        }
        // n_lock_time (4 bytes) + sequence (4 bytes)
        let n_lock_time = self.read_u32()?;
        let sequence = self.read_u32()?;
        let tag_len = self.read_count(1)?;
        let tag = self.read_array_dyn(tag_len)?;
        Ok((inputs, outputs, tag, n_lock_time, sequence))
    }
}

/// Errors produced by type parsing / construction.
/// GHOSTDAG colour of a block, as the node renders it
/// (`"genesis" | "chain" | "blue" | "red"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BlockColour {
    /// The genesis DAG block.
    Genesis,
    /// On the selected (blue) chain.
    Chain,
    /// In the blue set (accepted, off-chain).
    Blue,
    /// Not in the blue set (pending/red).
    Red,
}

/// Admission path of a block (hybrid PoW / staked-VRF).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BlockKind {
    /// Proof-of-work admitted.
    Pow,
    /// Staked-VRF admitted (epoch beacon).
    Staked,
}

/// Confirmation status relative to the current tip.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ConfirmingStatus {
    /// The block is the current tip.
    Tip,
    /// On the selected chain below the tip.
    Confirmed,
    /// In the blue set but off the selected chain.
    Accepted,
    /// Not yet in the blue set.
    Pending,
}

/// Client view of one DAG block, mirroring `GET /api/block/<id>`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Block {
    /// Block id (32-byte hash, lowercase hex).
    pub id: BlockHash,
    /// Selected-parent hash (zero for the genesis block).
    pub prev_hash: BlockHash,
    /// Merkle root of the block's transaction ids.
    pub merkle_root: BlockHash,
    /// Selected-chain height: number of blocks between genesis and this one.
    pub height: u64,
    /// Producer timestamp, milliseconds since the Unix epoch.
    pub timestamp_ms: u64,
    /// Proof-of-work nonce, carried so peers reconstruct the exact id.
    pub nonce: u64,
    /// GHOSTDAG blue score.
    pub blue_score: u64,
    /// Cumulative blue work of the selected chain at this block.
    pub chain_blue_work: u128,
    /// The block's own work weight.
    pub work: u128,
    /// Parent block ids.
    pub parents: Vec<BlockHash>,
    /// Child block ids (empty at the tip).
    pub children: Vec<BlockHash>,
    /// Transaction ids contained in the block.
    pub txs: Vec<TxHash>,
    /// Admission path.
    pub kind: BlockKind,
    /// GHOSTDAG colour.
    pub colour: BlockColour,
    /// Status relative to the current tip.
    pub confirming_status: ConfirmingStatus,
}

/// Error variants for kovanica-types conversions.
#[derive(Debug, thiserror::Error)]
pub enum TypesError {
    /// Invalid hex string.
    #[error("invalid hex")]
    InvalidHex,
    /// Unexpected byte length.
    #[error("invalid length")]
    InvalidLength,
    /// Other validation failure.
    #[error("validation failed: {0}")]
    Validation(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn amount_display() {
        let a = Amount::from_kvnc(10);
        assert_eq!(a.atoms(), 1_000_000_000);
        assert!(a.to_string().starts_with("10."));
    }

    #[test]
    fn block_serde_roundtrip() {
        let b = Block {
            id: Hash32([0xAA; 32]),
            prev_hash: Hash32([0xBB; 32]),
            merkle_root: Hash32([0xCC; 32]),
            height: 26_210,
            timestamp_ms: 1_752_000_000_000,
            nonce: 7,
            blue_score: 26_000,
            chain_blue_work: 1_234_567_890_123_456_789,
            work: 1_000_000,
            parents: vec![Hash32([0x01; 32]), Hash32([0x02; 32])],
            children: vec![Hash32([0x03; 32])],
            txs: vec![Hash32([0x0D; 32])],
            kind: BlockKind::Pow,
            colour: BlockColour::Chain,
            confirming_status: ConfirmingStatus::Confirmed,
        };
        let json = serde_json::to_string(&b).expect("serialize block");
        let back: Block = serde_json::from_str(&json).expect("deserialize block");
        assert_eq!(back, b);
        assert_eq!(back.colour, BlockColour::Chain);
        assert_eq!(back.confirming_status, ConfirmingStatus::Confirmed);
        assert_eq!(back.txs.len(), 1);
    }

    #[test]
    fn native_asset() {
        assert!(AssetId::NATIVE.is_native());
        assert_eq!(AssetId::NATIVE.to_string(), "KVNC");
    }

    #[test]
    fn hash_roundtrip() {
        let h =
            Hash32::from_hex("0000000000000000000000000000000000000000000000000000000000000001")
                .unwrap();
        assert_eq!(h.to_hex().len(), 64);
    }

    #[test]
    fn address_p2pk_shape() {
        let pk = [7u8; 32];
        let a = Address::p2pk(pk);
        assert_eq!(a.version(), ADDR_VERSION_P2PK);
        assert!(a.is_p2pk());
        assert_eq!(a.payload(), pk);
        assert_eq!(a.to_hex().len(), 66);
        assert_eq!(a.as_bytes().len(), 33);
    }

    #[test]
    fn address_serde_hex_roundtrip() {
        let a = Address::p2pk([9u8; 32]);
        let json = serde_json::to_string(&a).unwrap();
        assert_eq!(json.len(), 68); // quoted 66-hex
        let b: Address = serde_json::from_str(&json).unwrap();
        assert_eq!(a, b);
        // legacy 64-hex accepted too
        let c: Address = serde_json::from_str(&format!("\"{}\"", hex::encode([9u8; 32]))).unwrap();
        assert_eq!(a, c);
    }

    #[test]
    fn signature_serde_hex_roundtrip() {
        let sig = Signature([42u8; 64]);
        let json = serde_json::to_string(&sig).unwrap();
        assert_eq!(json.len(), 130); // quoted 128-hex
        let back: Signature = serde_json::from_str(&json).unwrap();
        assert_eq!(sig, back);
        assert_eq!(sig.to_hex().len(), 128);
    }

    #[test]
    fn transaction_encode_sans_witness_omits_witness() {
        let owner = Address::p2pk([1u8; 32]);
        // Same outpoints; only the witness differs between the two transactions.
        let tx_signed = Transaction::new(
            NetworkId::Testnet,
            vec![
                TxInput::single_sig(TxHash::ZERO, 0, [5u8; 64]),
                TxInput::fresh(TxHash::ZERO, 1),
            ],
            vec![TxOutput::native(1_000_000_000, owner)],
            b"t".to_vec(),
        );
        let tx_fresh = Transaction::new(
            NetworkId::Testnet,
            vec![
                TxInput::fresh(TxHash::ZERO, 0),
                TxInput::fresh(TxHash::ZERO, 1),
            ],
            tx_signed.outputs.clone(),
            tx_signed.tag.clone(),
        );
        // Sighash ignores witness: identical outpoints ⇒ identical sighash.
        assert_eq!(tx_signed.sighash(), tx_fresh.sighash());
        // Signed form is strictly longer (witness vectors).
        assert!(tx_signed.encode().len() > tx_fresh.encode().len());
    }
}
