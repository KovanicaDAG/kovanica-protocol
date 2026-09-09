//! Time-lock vault / escrow template — RFC-005.
//!
//! A [`VaultScript`] defines the two-path spending rules for Version 0x05
//! (vault) addresses: `[beneficiary_pk (32B), owner_pk (32B),
//! relative_delay (4B LE), absolute_time (4B LE)]`.
//!
//! Address derivation is `Address = 0x05 || BLAKE3(template_bytes)` — the same
//! versioned-hash pattern as P2SH (RFC-001), script v2 (RFC-003), and HTLC
//! (RFC-004). When spending, the input witness vector provides:
//!
//! 1. `witness[0]`: the raw template bytes (BLAKE3 must match the owner hash).
//! 2. `witness[1]`: the **path byte** — `0x01` CLAIM (beneficiary signature,
//!    valid only after the lock expires) or `0x02` RECOVER (owner signature,
//!    valid only strictly before the lock expires).
//! 3. `witness[2]`: the single 64-byte Ed25519 signature over the sighash.
//!
//! The lock expires iff `height >= absolute_time` **AND**
//! `height - created_at >= relative_delay`; either field `0` disables that half
//! (pure CLTV / pure CSV / both). At exactly the unlock height, claim wins and
//! recovery is rejected (strictly-before) — deterministic escrow soundness.
//!
//! Reference protocols: BIP-112 (CSV), BIP-68 (relative locktime),
//! BIP-65/BIP-113 (CLTV), Bitcoin time-locked escrow / inheritance vaults,
//! Lightning commitment delays. The template pattern follows RFC-001 multisig
//! and RFC-004 HTLC (`crates/kovanica-state/src/htlc.rs`).

use ed25519_dalek::VerifyingKey;

use crate::keys::Address;

/// Length of a serialized vault template in bytes.
pub const VAULT_SCRIPT_LEN: usize = 72;

/// Witness path byte: **CLAIM** — beneficiary signature, valid only after the
/// lock expires.
pub const VAULT_PATH_CLAIM: u8 = 0x01;

/// Witness path byte: **RECOVER** — owner signature, valid only strictly
/// before the lock expires (claim wins at the boundary).
pub const VAULT_PATH_RECOVER: u8 = 0x02;

/// Errors from constructing or parsing a [`VaultScript`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultScriptError {
    /// The template is not exactly [`VAULT_SCRIPT_LEN`] bytes.
    WrongLength,
    /// The beneficiary public key is not a valid Ed25519 point.
    InvalidBeneficiaryKey,
    /// The owner public key is not a valid Ed25519 point.
    InvalidOwnerKey,
    /// The beneficiary and owner public keys are identical.
    DuplicateKeys,
}

impl VaultScriptError {
    /// A static message for embedding in [`crate::ledger::LedgerError::InvalidRedeemScript`].
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::WrongLength => "vault script must be 72 bytes",
            Self::InvalidBeneficiaryKey => "invalid ed25519 beneficiary public key in vault script",
            Self::InvalidOwnerKey => "invalid ed25519 owner public key in vault script",
            Self::DuplicateKeys => "vault beneficiary and owner public keys must differ",
        }
    }
}

impl core::fmt::Display for VaultScriptError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::error::Error for VaultScriptError {}

/// A parsed, validated time-lock vault template.
///
/// Layout (72 bytes, no version byte inside — the address version `0x05` is
/// the discriminator):
///
/// ```text
/// offset  size  field
/// 0       32    beneficiary_pk — Ed25519 public key; claims after the lock expires
/// 32      32    owner_pk       — Ed25519 public key; recovers before the lock expires
/// 64      4     relative_delay — u32 LE, blocks after deposit (CSV semantics)
/// 68      4     absolute_time  — u32 LE, absolute block height (CLTV semantics)
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VaultScript {
    bytes: [u8; VAULT_SCRIPT_LEN],
}

impl VaultScript {
    /// Construct and validate a `VaultScript` from its four parameters.
    ///
    /// Rejects invalid Ed25519 points and identical beneficiary/owner keys
    /// (mirrors the HTLC/multisig duplicate rule). `relative_delay` and
    /// `absolute_time` may be any `u32` (`0` disables that half of the lock).
    pub fn new(
        beneficiary_pk: [u8; 32],
        owner_pk: [u8; 32],
        relative_delay: u32,
        absolute_time: u32,
    ) -> Result<Self, VaultScriptError> {
        if VerifyingKey::from_bytes(&beneficiary_pk).is_err() {
            return Err(VaultScriptError::InvalidBeneficiaryKey);
        }
        if VerifyingKey::from_bytes(&owner_pk).is_err() {
            return Err(VaultScriptError::InvalidOwnerKey);
        }
        if beneficiary_pk == owner_pk {
            return Err(VaultScriptError::DuplicateKeys);
        }
        let mut bytes = [0u8; VAULT_SCRIPT_LEN];
        bytes[0..32].copy_from_slice(&beneficiary_pk);
        bytes[32..64].copy_from_slice(&owner_pk);
        bytes[64..68].copy_from_slice(&relative_delay.to_le_bytes());
        bytes[68..72].copy_from_slice(&absolute_time.to_le_bytes());
        Ok(Self { bytes })
    }

    /// Parse and strictly validate a binary vault template (exactly 72 bytes).
    pub fn parse(bytes: &[u8]) -> Result<Self, VaultScriptError> {
        if bytes.len() != VAULT_SCRIPT_LEN {
            return Err(VaultScriptError::WrongLength);
        }
        let mut beneficiary_pk = [0u8; 32];
        beneficiary_pk.copy_from_slice(&bytes[0..32]);
        let mut owner_pk = [0u8; 32];
        owner_pk.copy_from_slice(&bytes[32..64]);
        let relative_delay = u32::from_le_bytes([bytes[64], bytes[65], bytes[66], bytes[67]]);
        let absolute_time = u32::from_le_bytes([bytes[68], bytes[69], bytes[70], bytes[71]]);
        Self::new(beneficiary_pk, owner_pk, relative_delay, absolute_time)
    }

    /// Serialize the template to its canonical 72-byte form.
    pub fn bytes(&self) -> [u8; VAULT_SCRIPT_LEN] {
        self.bytes
    }

    /// Serialize the template to a `Vec<u8>` (convenience, mirrors
    /// [`crate::multisig::MultisigScript::encode`]).
    pub fn encode(&self) -> Vec<u8> {
        self.bytes.to_vec()
    }

    /// The beneficiary's Ed25519 public key (authorises the CLAIM path).
    pub fn beneficiary_pk(&self) -> &[u8; 32] {
        (&self.bytes[0..32])
            .try_into()
            .expect("beneficiary_pk slice is 32 bytes")
    }

    /// The owner's Ed25519 public key (authorises the RECOVER path).
    pub fn owner_pk(&self) -> &[u8; 32] {
        (&self.bytes[32..64])
            .try_into()
            .expect("owner_pk slice is 32 bytes")
    }

    /// The relative delay in blocks after deposit (CSV semantics). `0` disables
    /// this half of the lock.
    pub fn relative_delay(&self) -> u32 {
        u32::from_le_bytes([
            self.bytes[64],
            self.bytes[65],
            self.bytes[66],
            self.bytes[67],
        ])
    }

    /// The absolute block height at which the lock expires (CLTV semantics).
    /// `0` disables this half of the lock.
    pub fn absolute_time(&self) -> u32 {
        u32::from_le_bytes([
            self.bytes[68],
            self.bytes[69],
            self.bytes[70],
            self.bytes[71],
        ])
    }

    /// Compute the 32-byte BLAKE3 template hash.
    pub fn script_hash(&self) -> [u8; 32] {
        *blake3::hash(&self.bytes).as_bytes()
    }

    /// Derive the Version 0x05 (vault) address for this template.
    pub fn address(&self) -> Address {
        Address::from_vault_script(&self.bytes)
    }

    /// Build the **CLAIM** witness stack: `[template, 0x01, beneficiary_sig]`.
    ///
    /// The beneficiary signs the sighash; the ledger requires the lock to have
    /// expired (`height >= absolute_time` AND `age >= relative_delay`) before
    /// accepting the claim.
    pub fn claim_witness(&self, sig: [u8; 64]) -> Vec<Vec<u8>> {
        vec![self.bytes.to_vec(), vec![VAULT_PATH_CLAIM], sig.to_vec()]
    }

    /// Build the **RECOVER** witness stack: `[template, 0x02, owner_sig]`.
    ///
    /// The owner signs the sighash; the ledger requires the lock to *not* have
    /// expired yet (strictly before — claim wins at the boundary).
    pub fn recover_witness(&self, sig: [u8; 64]) -> Vec<Vec<u8>> {
        vec![self.bytes.to_vec(), vec![VAULT_PATH_RECOVER], sig.to_vec()]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::KeyPair;

    #[test]
    fn make_and_parse_valid_script() {
        let beneficiary = KeyPair::from_u64(1);
        let owner = KeyPair::from_u64(2);

        let script = VaultScript::new(
            *beneficiary.address().payload(),
            *owner.address().payload(),
            10,
            20,
        )
        .unwrap();
        assert_eq!(script.relative_delay(), 10);
        assert_eq!(script.absolute_time(), 20);
        assert_eq!(script.beneficiary_pk(), beneficiary.address().payload());
        assert_eq!(script.owner_pk(), owner.address().payload());

        let bytes = script.bytes();
        assert_eq!(bytes.len(), VAULT_SCRIPT_LEN);
        let parsed = VaultScript::parse(&bytes).unwrap();
        assert_eq!(parsed, script);
        assert_eq!(parsed.script_hash(), script.script_hash());
        assert_eq!(parsed.address(), script.address());
        assert_eq!(parsed.address().version(), Address::VERSION_VAULT);
        assert!(parsed.address().is_vault());
    }

    #[test]
    fn reject_wrong_length() {
        assert_eq!(
            VaultScript::parse(&[0u8; 71]),
            Err(VaultScriptError::WrongLength)
        );
        assert_eq!(
            VaultScript::parse(&[0u8; 73]),
            Err(VaultScriptError::WrongLength)
        );
    }

    #[test]
    fn reject_invalid_keys() {
        let beneficiary = KeyPair::from_u64(1);
        let owner = KeyPair::from_u64(2);
        // y=2 (bytes [0x02, 0, …, 0]) is NOT on the Ed25519 curve.
        let invalid = [0x02u8; 32];

        assert_eq!(
            VaultScript::new(invalid, *owner.address().payload(), 0, 0),
            Err(VaultScriptError::InvalidBeneficiaryKey)
        );
        assert_eq!(
            VaultScript::new(*beneficiary.address().payload(), invalid, 0, 0),
            Err(VaultScriptError::InvalidOwnerKey)
        );
    }

    #[test]
    fn reject_duplicate_keys() {
        let beneficiary = KeyPair::from_u64(1);
        let pk = *beneficiary.address().payload();
        assert_eq!(
            VaultScript::new(pk, pk, 0, 0),
            Err(VaultScriptError::DuplicateKeys)
        );
    }

    #[test]
    fn witness_shapes() {
        let beneficiary = KeyPair::from_u64(1);
        let owner = KeyPair::from_u64(2);
        let script = VaultScript::new(
            *beneficiary.address().payload(),
            *owner.address().payload(),
            10,
            20,
        )
        .unwrap();

        let claim = script.claim_witness([0x11u8; 64]);
        assert_eq!(claim.len(), 3);
        assert_eq!(claim[0], script.bytes().to_vec());
        assert_eq!(claim[1], vec![VAULT_PATH_CLAIM]);
        assert_eq!(claim[2], vec![0x11u8; 64]);

        let recover = script.recover_witness([0x22u8; 64]);
        assert_eq!(recover.len(), 3);
        assert_eq!(recover[0], script.bytes().to_vec());
        assert_eq!(recover[1], vec![VAULT_PATH_RECOVER]);
        assert_eq!(recover[2], vec![0x22u8; 64]);
    }
}
