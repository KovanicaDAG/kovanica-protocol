//! Mnemonic generation, seed derivation, Ed25519 keypairs and address derivation.
//!
//! **Security rules**
//! - Seeds and private keys are zeroized on drop.
//! - Never log or transmit raw seeds.
//! - Derivation path is **frozen** (SLIP-0010 ed25519, `m/44'/3007'/0'/0'/i'`);
//!   change only with a hard version bump. Canonical spec: `docs/backlog/DERIVATION.md`.
//!
//! **Address format** (node-canonical, NOT bech32):
//! `kvnc` + base58(`[version] ‖ payload32`) + `dag`. The node also accepts
//! 66-hex (versioned 33B) and legacy 64-hex (bare pubkey → P2PK).

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use bip39::{Language, Mnemonic as Bip39Mnemonic};
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use kovanica_types::{
    Address, PublicKey, Signature, TypesError, ADDR_VERSION_MAX, ADDR_VERSION_P2PK,
};
use rand::rngs::OsRng;
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Locking scripts and spend templates (multisig, HTLC, vault) — byte-format
/// ports of `kovanica-state` `multisig.rs` / `htlc.rs` / `vault.rs`.
pub mod scripts;

/// Word count choices (BIP-39).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WordCount {
    /// 128-bit entropy → 12 words.
    Words12,
    /// 256-bit entropy → 24 words.
    Words24,
}

impl WordCount {
    fn entropy_bytes(self) -> usize {
        match self {
            WordCount::Words12 => 16,
            WordCount::Words24 => 32,
        }
    }
}

/// BIP-39 mnemonic wrapper.
#[derive(Clone)]
pub struct Mnemonic {
    inner: Bip39Mnemonic,
}

impl Mnemonic {
    /// Generate a new mnemonic with OS entropy.
    pub fn generate(words: WordCount) -> Result<Self, KeysError> {
        let mut entropy = vec![0u8; words.entropy_bytes()];
        rand::RngCore::fill_bytes(&mut OsRng, &mut entropy);
        let mnemonic = Bip39Mnemonic::from_entropy_in(Language::English, &entropy)
            .map_err(|_| KeysError::MnemonicGeneration)?;
        entropy.zeroize();
        Ok(Mnemonic { inner: mnemonic })
    }

    /// Parse from a phrase (12 or 24 words). Validates checksum.
    pub fn from_phrase(phrase: &str) -> Result<Self, KeysError> {
        let mnemonic = Bip39Mnemonic::parse_in_normalized(Language::English, phrase)
            .map_err(|_| KeysError::InvalidMnemonic)?;
        Ok(Mnemonic { inner: mnemonic })
    }

    /// Rebuild from raw BIP-39 entropy (16 or 32 bytes) with the English
    /// wordlist, recomputing the checksum. Mirrors [`Mnemonic::generate`] for
    /// callers that already hold deterministic entropy (golden vectors, HSM/KMS
    /// flows, tests).
    pub fn from_entropy(entropy: &[u8]) -> Result<Self, KeysError> {
        let mnemonic = Bip39Mnemonic::from_entropy_in(Language::English, entropy)
            .map_err(|_| KeysError::MnemonicGeneration)?;
        Ok(Mnemonic { inner: mnemonic })
    }

    /// Human-readable phrase.
    pub fn phrase(&self) -> String {
        self.inner.to_string()
    }

    /// Number of words.
    pub fn word_count(&self) -> usize {
        self.inner.word_count()
    }

    /// Derive 64-byte seed (BIP-39 PBKDF2). Optional passphrase = 25th word.
    pub fn to_seed(&self, passphrase: &str) -> Seed {
        let bytes = self.inner.to_seed(passphrase);
        Seed(bytes)
    }
}

impl std::fmt::Debug for Mnemonic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Mnemonic([REDACTED])")
    }
}

/// Words in `phrase` that are not in the BIP-39 English wordlist, lowercased
/// and order-preserving. Empty when every word is known.
///
/// Callers use this to distinguish a typo from a checksum failure without
/// re-implementing the wordlist.
pub fn unknown_words(phrase: &str) -> Vec<String> {
    let list = Language::English.word_list();
    phrase
        .split_whitespace()
        .map(str::to_lowercase)
        .filter(|word| !word.is_empty() && !list.contains(&word.as_str()))
        .collect()
}

/// 64-byte BIP-39 seed. Zeroized on drop.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct Seed(pub [u8; 64]);

impl Seed {
    /// Derive the Ed25519 signing key at account index `index` using the
    /// **frozen** SLIP-0010 ed25519 path `m/44'/3007'/0'/0'/index'` (hardened).
    ///
    /// Canonical spec + cross-client vectors: `docs/backlog/DERIVATION.md`.
    pub fn derive_ed25519_key(&self, index: u32) -> [u8; 32] {
        slip10::derive_ed25519(&self.0, index)
    }
}

impl std::fmt::Debug for Seed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Seed([REDACTED])")
    }
}

/// Frozen SLIP-0010 derivation path descriptor (ed25519, hardened-only).
pub const DERIVATION_PATH: &str = "m/44'/3007'/0'/0'/i'";
/// SLIP-44-style coin type for Kovanica.
pub const SLIP44_COIN_TYPE: u32 = 3007;
/// Account depth used by the frozen path.
pub const DERIVATION_ACCOUNT: u32 = 0;

/// SLIP-0010 (ed25519, hardened-only) primitives.
///
/// This module is the **canonical Rust implementation** of the derivation
/// used by every Kovanica client (see `docs/unify/DECISIONS.md`): the protocol
/// tree re-exports it through `kovanica-wallet`, so there is one algorithm,
/// not one per tree.
///
/// ed25519 defines no normal children, so every path segment is hardened.
/// [`derive_path`] is the generic walk used to check the algorithm against the
/// official SLIP-0010 specification vectors; production code calls
/// [`derive_ed25519`], which applies the frozen Kovanica path
/// `m/44'/3007'/0'/0'/i'`.
///
/// Known-answer vectors live in `tests/slip10_vectors.rs` and match the
/// TypeScript mirror in `apps/web/src/lib/wallet/keys.ts`.
pub mod slip10 {
    use hmac::{Hmac, Mac};
    use sha2::Sha512;

    type HmacSha512 = Hmac<Sha512>;

    /// SLIP-0010 domain-separation key for ed25519 master nodes.
    const ED25519_SEED_KEY: &[u8] = b"ed25519 seed";

    /// Hardened-child marker. SLIP-0010 defines a hardened child as
    /// `i >= 2^31`; ed25519 supports no normal children, so every segment is
    /// hardened unconditionally.
    const HARDENED: u32 = 0x8000_0000;

    /// Derive the 32-byte Ed25519 key material at
    /// `m/44'/3007'/0'/0'/index'` from a 64-byte BIP-39 seed.
    ///
    /// This is the frozen Kovanica path and what production code should call.
    /// The general form is [`derive_path`].
    pub fn derive_ed25519(input: &[u8; 64], index: u32) -> [u8; 32] {
        derive_path(
            input,
            &[
                44,
                crate::SLIP44_COIN_TYPE,
                crate::DERIVATION_ACCOUNT,
                0,
                index,
            ],
        )
    }

    /// SLIP-0010 ed25519 over an arbitrary hardened path, from arbitrary key
    /// material.
    ///
    /// Every segment is hardened: ed25519 defines no normal children, and
    /// SLIP-0010 spells a hardened child as an index `>= 2^31`, which this
    /// applies unconditionally. An empty `path` yields the master key.
    ///
    /// This is the general form, exposed so the algorithm can be checked
    /// against the official specification vectors (which use their own path).
    /// Production code should call [`derive_ed25519`].
    pub fn derive_path(material: &[u8], path: &[u32]) -> [u8; 32] {
        let (mut key, mut chain) = split_master(material);
        for &segment in path {
            let (child_key, child_chain) = derive_child(&key, &chain, segment | HARDENED);
            key = child_key;
            chain = child_chain;
        }
        key
    }

    /// Master node: `I = HMAC-SHA512(key = "ed25519 seed", data = material)`.
    ///
    /// The spec allows 128 to 512 bits of input, so the length is not
    /// constrained here. ed25519 has no invalid-key case, so SLIP-0010's retry
    /// rule never applies: every 32-byte string is a usable Ed25519 secret.
    fn split_master(material: &[u8]) -> ([u8; 32], [u8; 32]) {
        let i = hmac_sha512(ED25519_SEED_KEY, material);
        (
            i[..32].try_into().expect("HMAC-SHA512 yields 64 bytes"),
            i[32..].try_into().expect("HMAC-SHA512 yields 64 bytes"),
        )
    }

    /// One hardened CKDpriv step:
    /// `I = HMAC-SHA512(key = chain, data = 0x00 ‖ ser256(sk) ‖ ser32(index))`.
    ///
    /// For ed25519 the child key is `I[..32]` verbatim — there is no
    /// `+ k_par (mod n)` step, because an ed25519 secret is a byte string and
    /// not a scalar multiple. `index` is expected to be already hardened.
    fn derive_child(sk: &[u8; 32], chain: &[u8; 32], index: u32) -> ([u8; 32], [u8; 32]) {
        // The leading 0x00 pads the key to 33 bytes so the layout is unambiguous.
        let mut data = [0u8; 1 + 32 + 4];
        data[1..33].copy_from_slice(sk);
        data[33..].copy_from_slice(&index.to_be_bytes());
        let i = hmac_sha512(chain, &data);
        (
            i[..32].try_into().expect("HMAC-SHA512 yields 64 bytes"),
            i[32..].try_into().expect("HMAC-SHA512 yields 64 bytes"),
        )
    }

    /// HMAC-SHA512 (RFC 2104).
    fn hmac_sha512(key: &[u8], data: &[u8]) -> [u8; 64] {
        let mut mac = <HmacSha512 as Mac>::new_from_slice(key).expect("HMAC accepts any key size");
        mac.update(data);
        let out = mac.finalize().into_bytes();
        let mut arr = [0u8; 64];
        arr.copy_from_slice(&out);
        arr
    }
}

// ---------------------------------------------------------------------------
// Address encoding (matches kovanica-state keys.rs — NOT bech32)
// ---------------------------------------------------------------------------

/// Human-readable prefix.
pub const ADDR_PREFIX: &str = "kvnc";
/// Human-readable suffix.
pub const ADDR_SUFFIX: &str = "dag";

/// Encode versioned 33-byte payload as `kvnc` + base58 + `dag`.
pub fn encode_versioned_address(version: u8, payload32: &[u8; 32]) -> Address {
    let mut raw = [0u8; 33];
    raw[0] = version;
    raw[1..].copy_from_slice(payload32);
    Address::from_versioned(raw)
}

/// P2PK address from raw Ed25519 public key bytes.
pub fn encode_p2pk_address(pubkey: &[u8; 32]) -> Address {
    encode_versioned_address(ADDR_VERSION_P2PK, pubkey)
}

/// Human form: `kvnc` + base58(33B) + `dag` (node `Address::to_kvnc`).
pub fn to_kvnc(address: &Address) -> String {
    format!(
        "{}{}{}",
        ADDR_PREFIX,
        bs58::encode(address.0).into_string(),
        ADDR_SUFFIX
    )
}

/// Parse a Kovanica address string into an [`Address`].
///
/// Accepts (node `Address::parse` parity):
/// - `kvnc…dag` (base58, case-insensitive prefix/suffix) — 33B versioned or
///   32B legacy (→ P2PK)
/// - 66-hex (33 versioned bytes, version ≤ 0x05)
/// - 64-hex legacy (32 bytes → P2PK)
pub fn decode_address(s: &str) -> Result<Address, KeysError> {
    let t = s.trim();
    let lower = t.to_ascii_lowercase();

    // kvnc…dag form (node requires at least 1 base58 char between prefix/suffix).
    if lower.starts_with(ADDR_PREFIX) && lower.ends_with(ADDR_SUFFIX) {
        if t.len() < ADDR_PREFIX.len() + ADDR_SUFFIX.len() + 1 {
            return Err(KeysError::InvalidAddress);
        }
        let core = &t[ADDR_PREFIX.len()..t.len() - ADDR_SUFFIX.len()];
        let bytes = bs58::decode(core)
            .into_vec()
            .map_err(|_| KeysError::InvalidAddress)?;
        return match bytes.len() {
            33 => {
                check_version(bytes[0])?;
                let mut arr = [0u8; 33];
                arr.copy_from_slice(&bytes);
                Ok(Address::from_versioned(arr))
            }
            32 => Ok(Address::p2pk(bytes.try_into().expect("32 bytes"))),
            _ => Err(KeysError::InvalidAddress),
        };
    }

    // 66-hex versioned.
    if t.len() == 66 && t.bytes().all(|b| b.is_ascii_hexdigit()) {
        let bytes = hex::decode(t).map_err(|_| KeysError::InvalidAddress)?;
        check_version(bytes[0])?;
        let mut arr = [0u8; 33];
        arr.copy_from_slice(&bytes);
        return Ok(Address::from_versioned(arr));
    }

    // 64-hex legacy pubkey.
    if t.len() == 64 && t.bytes().all(|b| b.is_ascii_hexdigit()) {
        let bytes = hex::decode(t).map_err(|_| KeysError::InvalidAddress)?;
        let mut pk = [0u8; 32];
        pk.copy_from_slice(&bytes);
        return Ok(Address::p2pk(pk));
    }

    Err(KeysError::InvalidAddress)
}

fn check_version(v: u8) -> Result<(), KeysError> {
    if v > ADDR_VERSION_MAX {
        Err(KeysError::UnsupportedVersion(v))
    } else {
        Ok(())
    }
}

/// Ed25519 keypair. Secret key is zeroized on drop.
pub struct Keypair {
    signing: SigningKey,
    verifying: VerifyingKey,
}

impl Keypair {
    /// From 32-byte secret key material.
    pub fn from_secret_bytes(secret: [u8; 32]) -> Self {
        let signing = SigningKey::from_bytes(&secret);
        let verifying = signing.verifying_key();
        Keypair { signing, verifying }
    }

    /// From a BIP-39 seed wallet — uses the **frozen** derivation path
    /// `m/44'/3007'/0'/0'/0'` (account index 0). See [`Seed::derive_ed25519_key`].
    pub fn from_seed(seed: &Seed) -> Self {
        Self::from_secret_bytes(seed.derive_ed25519_key(0))
    }

    /// Convenience: mnemonic → seed → keypair at account index 0.
    pub fn from_mnemonic(mnemonic: &Mnemonic, passphrase: &str) -> Self {
        Self::from_mnemonic_at(mnemonic, passphrase, 0)
    }

    /// Mnemonic → seed → keypair at a specific account index using the frozen
    /// SLIP-0010 path `m/44'/3007'/0'/0'/index'`.
    pub fn from_mnemonic_at(mnemonic: &Mnemonic, passphrase: &str, index: u32) -> Self {
        let seed = mnemonic.to_seed(passphrase);
        Self::from_secret_bytes(seed.derive_ed25519_key(index))
    }

    /// Public key.
    pub fn public_key(&self) -> PublicKey {
        PublicKey(self.verifying.to_bytes())
    }

    /// Derive a **P2PK** address (`version = 0x00`) matching `kovanica-state` keys.rs.
    ///
    /// Human-readable:
    /// `kvnc` + base58(`[0x00] ‖ pubkey[32]`) + `dag`
    pub fn address(&self) -> Address {
        encode_p2pk_address(&self.public_key().0)
    }

    /// 66-character lowercase hex of versioned P2PK bytes (`00` ‖ pubkey).
    pub fn address_hex(&self) -> String {
        self.address().to_hex()
    }

    /// Sign a message (raw bytes). Returns the 64-byte Ed25519 signature.
    pub fn sign(&self, message: &[u8]) -> Signature {
        let sig = self.signing.sign(message);
        Signature(sig.to_bytes())
    }

    /// Verify a signature against this keypair's public key using the node's
    /// **strict** verification (rejects non-canonical / malleable signatures).
    pub fn verify(&self, message: &[u8], signature: &Signature) -> Result<(), KeysError> {
        let sig = ed25519_dalek::Signature::from_bytes(&signature.0);
        self.verifying
            .verify_strict(message, &sig)
            .map_err(|_| KeysError::InvalidSignature)
    }
}

impl std::fmt::Debug for Keypair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Keypair")
            .field("public", &self.public_key().to_hex())
            .finish_non_exhaustive()
    }
}

/// Errors from key / mnemonic operations.
#[derive(Debug, thiserror::Error)]
pub enum KeysError {
    /// Failed to generate mnemonic.
    #[error("mnemonic generation failed")]
    MnemonicGeneration,
    /// Invalid mnemonic phrase or checksum.
    #[error("invalid mnemonic")]
    InvalidMnemonic,
    /// Signature verification failed.
    #[error("invalid signature")]
    InvalidSignature,
    /// Unsupported address version byte.
    #[error("unsupported address version 0x{0:02x}")]
    UnsupportedVersion(u8),
    /// Malformed address.
    #[error("invalid address")]
    InvalidAddress,
    /// Underlying types error.
    #[error(transparent)]
    Types(#[from] TypesError),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_12_and_24() {
        let m12 = Mnemonic::generate(WordCount::Words12).unwrap();
        assert_eq!(m12.word_count(), 12);
        let m24 = Mnemonic::generate(WordCount::Words24).unwrap();
        assert_eq!(m24.word_count(), 24);
    }

    #[test]
    fn roundtrip_phrase() {
        let m = Mnemonic::generate(WordCount::Words12).unwrap();
        let phrase = m.phrase();
        let m2 = Mnemonic::from_phrase(&phrase).unwrap();
        assert_eq!(m.phrase(), m2.phrase());
    }

    #[test]
    fn sign_verify_strict() {
        let m = Mnemonic::generate(WordCount::Words12).unwrap();
        let kp = Keypair::from_mnemonic(&m, "");
        let msg = b"kovanica test message";
        let sig = kp.sign(msg);
        assert!(kp.verify(msg, &sig).is_ok());
        // Wrong message fails.
        assert!(kp.verify(b"tampered", &sig).is_err());
    }

    #[test]
    fn deterministic_from_entropy() {
        // Zero-entropy mnemonic — the standard BIP-39 test vector phrase,
        // constructed from entropy so no seed phrase appears in source.
        let entropy = [0u8; 16];
        let m = Bip39Mnemonic::from_entropy_in(Language::English, &entropy).unwrap();
        let m = Mnemonic { inner: m };
        assert_eq!(m.word_count(), 12);
        assert_eq!(m.phrase().split(' ').count(), 12);
        let kp1 = Keypair::from_mnemonic(&m, "");
        let kp2 = Keypair::from_mnemonic(&m, "");
        assert_eq!(kp1.address(), kp2.address());
        let kvnc = to_kvnc(&kp1.address());
        assert!(kvnc.to_ascii_lowercase().starts_with("kvnc"));
        assert!(kvnc.to_ascii_lowercase().ends_with("dag"));
        assert_eq!(decode_address(&kvnc).unwrap(), kp1.address());
    }

    #[test]
    fn address_hex_roundtrip() {
        let m = Mnemonic::generate(WordCount::Words12).unwrap();
        let kp = Keypair::from_mnemonic(&m, "");
        let addr = kp.address();
        let hex66 = addr.to_hex();
        assert_eq!(hex66.len(), 66);
        assert_eq!(decode_address(&hex66).unwrap(), addr);
    }

    #[test]
    fn legacy_hex64_and_kvnc32_are_p2pk() {
        let pk = [0xABu8; 32];
        let from_hex64 = decode_address(&hex::encode(pk)).unwrap();
        assert_eq!(from_hex64, Address::p2pk(pk));
        // base58 of bare 32 bytes inside kvnc…dag (node accepts this too).
        let kvnc32 = format!(
            "{}{}{}",
            ADDR_PREFIX,
            bs58::encode(pk).into_string(),
            ADDR_SUFFIX
        );
        assert_eq!(decode_address(&kvnc32).unwrap(), Address::p2pk(pk));
    }

    #[test]
    fn rejects_unsupported_version() {
        let raw = [0x06u8; 33]; // version 6 > ADDR_VERSION_MAX
        let err = decode_address(&hex::encode(raw)).unwrap_err();
        assert!(matches!(err, KeysError::UnsupportedVersion(6)));
    }

    #[test]
    fn address_codec_matches_node_vectors() {
        // Constants from `protocol/crates/kovanica-state/tests/sighash_vector.rs`.
        const ALICE_KVNC: &str = "kvnc1CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqBdag";
        const BOB_KVNC: &str = "kvnc1DdqGmK5uamYN5vmuZrzpQhKeehLdwtPLVJdhu5P2iJKCdag";
        const LEGACY32_KVNC: &str = "kvncCZ8YUVdk7znjrUmnb5n7kgySk9yRAsQDYmyCxzfSky9tdag";

        let mut alice_raw = [0u8; 33];
        alice_raw[0] = 0x00;
        alice_raw[1..].copy_from_slice(&[0xAAu8; 32]);
        let alice = Address::from_versioned(alice_raw);
        assert_eq!(to_kvnc(&alice), ALICE_KVNC);
        assert_eq!(decode_address(ALICE_KVNC).unwrap(), alice);

        let mut bob_raw = [0u8; 33];
        bob_raw[0] = 0x00;
        bob_raw[1..].copy_from_slice(&[0xBBu8; 32]);
        let bob = Address::from_versioned(bob_raw);
        assert_eq!(to_kvnc(&bob), BOB_KVNC);
        assert_eq!(decode_address(BOB_KVNC).unwrap(), bob);

        // Legacy bare-pubkey kvnc form (44 base58 chars → 32 bytes) → P2PK.
        assert_eq!(
            decode_address(LEGACY32_KVNC).unwrap(),
            Address::p2pk([0xABu8; 32])
        );
    }

    #[test]
    fn debug_redacts_secrets() {
        let m = Mnemonic::generate(WordCount::Words12).unwrap();
        let debug = format!("{:?}", m);
        assert!(debug.contains("REDACTED"));
        assert!(!debug.contains(&m.phrase()));
    }
}
