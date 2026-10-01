//! Client-side key derivation for mobile wallets.
//!
//! Derivation is **frozen** and has exactly one implementation:
//! [`kovanica_wallet::Wallet`] — key stretching followed by the fully-hardened
//! SLIP-0010 ed25519 path `m/44'/3007'/0'/0'/i'`, pinned by a known-answer
//! suite in `kovanica-wallet`.
//!
//! Mobile clients need two things out of that rule: the *public* address for a
//! receive screen, and the *32-byte signing key* that
//! `LightNode::send_from` (and the script/stealth/HTLC senders) take as
//! `signing_secret_hex`. The FFI surface offered neither, so each client
//! re-derived — and both truncated the 64-byte stretched material to its first
//! 32 bytes. That key belongs to nobody: a permanently empty address, and a
//! send targeting a keypair with no UTXOs. These functions are thin adapters
//! over the one implementation; they contain no cryptography.
//!
//! **Client-side only — no consensus or ledger impact.** Nothing here touches
//! GHOSTDAG, the UTXO set, emission, or block validation. The surface is
//! stateless and is not a method on `LightNode`; a node derives no address from
//! a phrase, so nothing here can move a balance.
//!
//! The derived secret is returned to the caller and never stored, logged, or
//! attached to the node — the same contract as `send_from`, which takes a
//! secret per call and keeps none. Custody stays in the client keystore; the
//! node only ever sees a signed transaction.

use kovanica_wallet::{Wallet, DEFAULT_ADDRESS_INDEX, DERIVATION_PATH, SLIP44_COIN_TYPE};

/// Failure modes of the derivation helpers.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum DerivationError {
    /// The recovery phrase failed word-list, word-count, or checksum validation.
    #[error("invalid recovery phrase: {msg}")]
    InvalidMnemonic { msg: String },
    /// A raw secret was not 32 bytes of hex.
    #[error("signing secret must be 32 bytes hex, got {got} bytes")]
    BadSecretLength { got: u32 },
}

impl From<anyhow::Error> for DerivationError {
    fn from(e: anyhow::Error) -> Self {
        DerivationError::InvalidMnemonic { msg: e.to_string() }
    }
}

/// One derived account: what a wallet needs to show an address, watch it, and
/// sign for it.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DerivedAccount {
    /// The receive address, rendered `kvnc…dag` (base58 over `0x00 ‖ pubkey`).
    pub address: String,
    /// The raw 32-byte Ed25519 public key, lowercase hex — the SPV watch key.
    pub public_key_hex: String,
    /// The raw 32-byte Ed25519 signing key, lowercase hex: the value every
    /// `LightNode::send_*` expects in `signing_secret_hex`. Hand it straight to
    /// the signer; do not log it.
    pub signing_secret_hex: String,
    /// The path this account came from, e.g. `m/44'/3007'/0'/0'/0'`.
    pub derivation_path: String,
    /// The address index used (the `i` in the path).
    pub address_index: u32,
}

/// The frozen derivation path, for a client that wants to display it.
#[uniffi::export]
pub fn slip10_derivation_path(address_index: u32) -> String {
    format!("m/44'/{SLIP44_COIN_TYPE}'/0'/0'/{address_index}'")
}

/// The frozen SLIP-44 coin type (3007), so a client need not hard-code it.
#[uniffi::export]
pub fn slip44_coin_type() -> u32 {
    SLIP44_COIN_TYPE
}

/// Derive the account at `address_index` from a recovery phrase.
///
/// `passphrase` is the optional "25th word" and may be empty. It is honoured,
/// not ignored: the same phrase under a different passphrase is a *different
/// account*, so dropping it would show a balance-less address instead of an
/// error.
#[uniffi::export]
pub fn derive_account_from_mnemonic(
    mnemonic: String,
    passphrase: String,
    address_index: u32,
) -> Result<DerivedAccount, DerivationError> {
    let wallet = Wallet::from_mnemonic_at(&mnemonic, &passphrase, address_index)?;
    Ok(account_from_wallet(&wallet, address_index))
}

/// Just the receive address for a recovery phrase, at `address_index`.
#[uniffi::export]
pub fn derive_address_from_mnemonic(
    mnemonic: String,
    passphrase: String,
    address_index: u32,
) -> Result<String, DerivationError> {
    Ok(derive_account_from_mnemonic(mnemonic, passphrase, address_index)?.address)
}

/// Just the 32-byte signing key (lowercase hex) for a recovery phrase, at
/// `address_index`.
#[uniffi::export]
pub fn derive_signing_secret_from_mnemonic(
    mnemonic: String,
    passphrase: String,
    address_index: u32,
) -> Result<String, DerivationError> {
    Ok(derive_account_from_mnemonic(mnemonic, passphrase, address_index)?.signing_secret_hex)
}

/// Derive the account owning a raw 32-byte Ed25519 key.
///
/// This is the no-derivation path (`m` only), used by genesis and by a raw-seed
/// key file. It must agree with [`derive_account_from_mnemonic`] for the
/// matching material — a disagreement here would be the original bug in a new
/// place.
#[uniffi::export]
pub fn account_from_signing_secret(
    signing_secret_hex: String,
) -> Result<DerivedAccount, DerivationError> {
    let wallet = Wallet::from_seed(parse_secret(&signing_secret_hex)?);
    Ok(account_from_wallet(&wallet, DEFAULT_ADDRESS_INDEX))
}

/// The address owning a raw 32-byte Ed25519 key (lowercase hex).
#[uniffi::export]
pub fn address_from_signing_secret(signing_secret_hex: String) -> Result<String, DerivationError> {
    Ok(account_from_signing_secret(signing_secret_hex)?.address)
}

/// Whether `phrase` is a well-formed recovery phrase (word list, word count, and
/// checksum). Purely local — call it first so the user gets "that word is
/// wrong" instead of a derived-and-wrong address.
#[uniffi::export]
pub fn mnemonic_is_valid(phrase: String) -> bool {
    kovanica_wallet::bip39_material(&phrase, "").is_ok()
}

fn account_from_wallet(wallet: &Wallet, address_index: u32) -> DerivedAccount {
    let keypair = wallet.keypair();
    DerivedAccount {
        address: keypair.address().to_kvnc(),
        public_key_hex: hex::encode(keypair.public_key()),
        signing_secret_hex: hex::encode(wallet.seed()),
        derivation_path: slip10_derivation_path(address_index),
        address_index,
    }
}

fn parse_secret(signing_secret_hex: &str) -> Result<[u8; 32], DerivationError> {
    let raw = hex::decode(signing_secret_hex.trim())
        .map_err(|_| DerivationError::BadSecretLength { got: 0 })?;
    raw.as_slice().try_into().map_err(|_| {
        let got = u32::try_from(raw.len()).unwrap_or(u32::MAX);
        DerivationError::BadSecretLength { got }
    })
}

/// Reference the re-exported canonical constant so it cannot drift unused.
const _: &str = DERIVATION_PATH;

#[cfg(test)]
mod tests {
    use super::*;

    /// The canonical zero-entropy 128-bit input, built from entropy bytes so no
    /// phrase appears in source. Never a real wallet.
    fn zero_phrase() -> String {
        bip39::Mnemonic::from_entropy_in(bip39::Language::English, &[0u8; 16])
            .unwrap()
            .to_string()
    }

    #[test]
    fn constants_match_the_frozen_path() {
        assert_eq!(slip44_coin_type(), 3007);
        assert_eq!(slip10_derivation_path(0), "m/44'/3007'/0'/0'/0'");
        assert_eq!(slip10_derivation_path(7), "m/44'/3007'/0'/0'/7'");
    }

    #[test]
    fn a_valid_phrase_derives_a_stable_account() {
        let account = derive_account_from_mnemonic(zero_phrase(), String::new(), 0).unwrap();
        assert!(account.address.starts_with("kvnc1"));
        assert!(account.address.ends_with("dag"));
        assert_eq!(account.derivation_path, "m/44'/3007'/0'/0'/0'");
        assert_eq!(account.address_index, 0);
        assert_eq!(account.signing_secret_hex.len(), 64);
        assert_eq!(account.public_key_hex.len(), 64);

        // Every helper agrees, and the raw-key path round-trips.
        assert_eq!(
            derive_address_from_mnemonic(zero_phrase(), String::new(), 0).unwrap(),
            account.address
        );
        assert_eq!(
            derive_signing_secret_from_mnemonic(zero_phrase(), String::new(), 0).unwrap(),
            account.signing_secret_hex
        );
        assert_eq!(
            account_from_signing_secret(account.signing_secret_hex.clone())
                .unwrap()
                .address,
            account.address
        );
    }

    /// The regression guard: the signing key is the SLIP-0010 child, never the
    /// first half of the stretched material, which is a key nobody controls.
    #[test]
    fn the_key_is_not_the_truncated_stretched_material() {
        let account = derive_account_from_mnemonic(zero_phrase(), String::new(), 0).unwrap();
        let material = kovanica_wallet::bip39_material(&zero_phrase(), "").unwrap();
        assert_ne!(account.signing_secret_hex, hex::encode(&material[..32]));
    }

    #[test]
    fn the_passphrase_is_honoured_not_ignored() {
        let plain = derive_account_from_mnemonic(zero_phrase(), String::new(), 0).unwrap();
        let locked = derive_account_from_mnemonic(zero_phrase(), "hunter2".into(), 0).unwrap();
        assert_ne!(plain.address, locked.address);
        assert_ne!(plain.signing_secret_hex, locked.signing_secret_hex);
        assert_eq!(
            derive_account_from_mnemonic(zero_phrase(), "hunter2".into(), 0)
                .unwrap()
                .address,
            locked.address
        );
    }

    #[test]
    fn address_indices_are_distinct() {
        let mut seen = std::collections::BTreeSet::new();
        for index in 0..3 {
            let address =
                derive_address_from_mnemonic(zero_phrase(), String::new(), index).unwrap();
            assert!(seen.insert(address), "index {index} collided");
        }
    }

    #[test]
    fn bad_phrases_are_rejected_rather_than_derived() {
        assert!(!mnemonic_is_valid("not a real phrase".into()));
        assert!(!mnemonic_is_valid(String::new()));
        assert!(
            derive_account_from_mnemonic("not a real phrase".into(), String::new(), 0).is_err()
        );
    }

    #[test]
    fn malformed_secrets_are_rejected() {
        for bad in [
            String::new(),
            "aabbcc".into(),
            "zz".into(),
            "0".repeat(63),
            "0".repeat(66),
        ] {
            assert!(account_from_signing_secret(bad.clone()).is_err(), "{bad}");
        }
        // 32 bytes of valid hex is a well-formed key even if it was never
        // published: address derivation is total.
        assert!(account_from_signing_secret("00".repeat(32)).is_ok());
    }
}
