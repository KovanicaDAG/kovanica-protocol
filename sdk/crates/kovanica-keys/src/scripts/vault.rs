//! Vault / time-lock templates (RFC-005 / KVP-105).
//!
//! Wire format (40 bytes, no version byte inside — the address version `0x05`
//! is the discriminator): `unlock_height (u32 LE) ‖ csv (u32 LE) ‖
//! owner_pk (32B)`.
//!
//! - `unlock_height`: absolute block height (CLTV-style); `0` = no absolute lock.
//! - `csv`: relative blocks since this output's creation (CSV / BIP-112); `0` = no relative lock.
//! - At least one lock must be non-zero.
//! - Spending witness: `[template, owner_sig]`.

use ed25519_dalek::VerifyingKey;
use kovanica_types::Address;

/// Canonical vault template length in bytes.
pub const VAULT_TEMPLATE_LEN: usize = 40;

/// Errors from constructing / parsing a vault template.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum VaultError {
    /// Template must be exactly 40 bytes.
    #[error("vault template must be exactly 40 bytes")]
    WrongLength,
    /// Both locks are zero — a vault must lock at least one dimension.
    #[error("vault must have a non-zero absolute or relative lock")]
    NoLock,
    /// Owner public key is not a valid Ed25519 point.
    #[error("invalid owner key")]
    InvalidOwnerKey,
}

/// A parsed, validated vault template.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VaultScript {
    unlock_height: u32,
    csv: u32,
    owner_pk: [u8; 32],
}

impl VaultScript {
    /// Construct and validate a `VaultScript` from its three parameters.
    ///
    /// Rejects a template with both locks zero and an invalid Ed25519 owner
    /// point. No BIP-68 disable-flag bits are allowed in the template.
    pub fn new(unlock_height: u32, csv: u32, owner_pk: [u8; 32]) -> Result<Self, VaultError> {
        if unlock_height == 0 && csv == 0 {
            return Err(VaultError::NoLock);
        }
        if VerifyingKey::from_bytes(&owner_pk).is_err() {
            return Err(VaultError::InvalidOwnerKey);
        }
        Ok(Self {
            unlock_height,
            csv,
            owner_pk,
        })
    }

    /// Parse and strictly validate a binary vault template (exactly 40 bytes).
    pub fn parse(bytes: &[u8]) -> Result<Self, VaultError> {
        if bytes.len() != VAULT_TEMPLATE_LEN {
            return Err(VaultError::WrongLength);
        }
        let unlock_height = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        let csv = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
        let mut owner_pk = [0u8; 32];
        owner_pk.copy_from_slice(&bytes[8..40]);
        Self::new(unlock_height, csv, owner_pk)
    }

    /// Serialize the template to its canonical 40-byte form.
    pub fn bytes(&self) -> [u8; VAULT_TEMPLATE_LEN] {
        let mut buf = [0u8; VAULT_TEMPLATE_LEN];
        buf[0..4].copy_from_slice(&self.unlock_height.to_le_bytes());
        buf[4..8].copy_from_slice(&self.csv.to_le_bytes());
        buf[8..40].copy_from_slice(&self.owner_pk);
        buf
    }

    /// Serialize the template to a `Vec<u8>` (convenience).
    pub fn encode(&self) -> Vec<u8> {
        self.bytes().to_vec()
    }

    /// The absolute block height (CLTV-style) after which the vault may be
    /// spent; `0` = no absolute lock.
    pub fn unlock_height(&self) -> u32 {
        self.unlock_height
    }

    /// The relative block count since this output's creation after which it may
    /// be spent; `0` = no relative lock.
    pub fn csv(&self) -> u32 {
        self.csv
    }

    /// The Ed25519 public key authorised to spend the vault once unlocked.
    pub fn owner_pk(&self) -> &[u8; 32] {
        &self.owner_pk
    }

    /// BLAKE3 hash of the 40-byte template.
    pub fn script_hash(&self) -> [u8; 32] {
        *blake3::hash(&self.bytes()).as_bytes()
    }

    /// The version 0x05 (Vault) address locking to this template.
    pub fn address(&self) -> Address {
        Address::vault(self.script_hash())
    }

    /// Build the spend witness stack: `[template, owner_sig]`.
    pub fn spend_witness(&self, owner_sig: [u8; 64]) -> Vec<Vec<u8>> {
        vec![self.bytes().to_vec(), owner_sig.to_vec()]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    fn pk_from_seed(seed: u64) -> [u8; 32] {
        let mut bytes = [0u8; 32];
        bytes[..8].copy_from_slice(&seed.to_le_bytes());
        SigningKey::from_bytes(&bytes).verifying_key().to_bytes()
    }

    #[test]
    fn make_and_parse_valid_script() {
        let owner = pk_from_seed(1);
        let script = VaultScript::new(1000, 0, owner).unwrap();
        assert_eq!(script.unlock_height(), 1000);
        assert_eq!(script.csv(), 0);
        assert_eq!(script.owner_pk(), &owner);

        let bytes = script.bytes();
        assert_eq!(bytes.len(), VAULT_TEMPLATE_LEN);
        let parsed = VaultScript::parse(&bytes).unwrap();
        assert_eq!(parsed, script);
        assert_eq!(parsed.script_hash(), script.script_hash());
        assert_eq!(parsed.address(), script.address());
        assert_eq!(
            parsed.address().version(),
            kovanica_types::ADDR_VERSION_VAULT
        );
    }

    #[test]
    fn requries_a_lock() {
        let ok = pk_from_seed(1);
        assert_eq!(VaultScript::new(0, 0, ok), Err(VaultError::NoLock));
        assert!(VaultScript::new(0, 144, ok).is_ok());
        assert!(VaultScript::new(1000, 0, ok).is_ok());
        assert!(VaultScript::new(1000, 144, ok).is_ok());
    }

    #[test]
    fn rejects_invalid_key_and_length() {
        // y=2 (bytes [0x02, 0, …, 0]) is NOT on the Ed25519 curve.
        let invalid = [0x02u8; 32];
        assert_eq!(
            VaultScript::new(1000, 0, invalid),
            Err(VaultError::InvalidOwnerKey)
        );
        assert_eq!(VaultScript::parse(&[0u8; 39]), Err(VaultError::WrongLength));
        assert_eq!(VaultScript::parse(&[0u8; 41]), Err(VaultError::WrongLength));
    }

    #[test]
    fn spend_witness_shape() {
        let script = VaultScript::new(1000, 0, pk_from_seed(1)).unwrap();
        let witness = script.spend_witness([0x33u8; 64]);
        assert_eq!(witness.len(), 2);
        assert_eq!(witness[0], script.bytes().to_vec());
        assert_eq!(witness[1], vec![0x33u8; 64]);
    }
}
