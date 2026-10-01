//! HTLC templates (RFC-004 / KVP-104).
//!
//! Wire format (100 bytes, no version byte inside — the address version `0x04`
//! is the discriminator): `preimage_hash (32B) ‖ recipient_pk (32B) ‖
//! sender_pk (32B) ‖ timeout (u32 LE)`.
//!
//! - **Redeem** path: `[template, preimage, recipient_sig]` — reveals the
//!   preimage; ledger checks `BLAKE3(preimage) == preimage_hash` and the
//!   recipient signature (no time constraint, BIP-199).
//! - **Refund** path: `[template, sender_sig]` — sender may spend after the
//!   chain height reaches `timeout`.

use ed25519_dalek::VerifyingKey;
use kovanica_types::Address;

/// Canonical HTLC template length in bytes.
pub const HTLC_SCRIPT_LEN: usize = 100;

/// Errors from constructing / parsing an HTLC template.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum HtlcError {
    /// Template must be exactly 100 bytes.
    #[error("htlc template must be exactly 100 bytes")]
    WrongLength,
    /// Recipient public key is not a valid Ed25519 point.
    #[error("invalid recipient key")]
    InvalidRecipientKey,
    /// Sender public key is not a valid Ed25519 point.
    #[error("invalid sender key")]
    InvalidSenderKey,
    /// Recipient and sender keys must differ.
    #[error("recipient and sender keys must differ")]
    DuplicateKeys,
}

/// A parsed, validated HTLC template.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HtlcScript {
    preimage_hash: [u8; 32],
    recipient_pk: [u8; 32],
    sender_pk: [u8; 32],
    timeout: u32,
}

impl HtlcScript {
    /// Construct and validate an `HtlcScript` from its four parameters.
    ///
    /// Rejects invalid Ed25519 points and identical recipient/sender keys
    /// (mirrors the multisig duplicate rule). `preimage_hash` may be any 32
    /// bytes; `timeout` any `u32` (`0` = immediately refundable).
    pub fn new(
        preimage_hash: [u8; 32],
        recipient_pk: [u8; 32],
        sender_pk: [u8; 32],
        timeout: u32,
    ) -> Result<Self, HtlcError> {
        if VerifyingKey::from_bytes(&recipient_pk).is_err() {
            return Err(HtlcError::InvalidRecipientKey);
        }
        if VerifyingKey::from_bytes(&sender_pk).is_err() {
            return Err(HtlcError::InvalidSenderKey);
        }
        if recipient_pk == sender_pk {
            return Err(HtlcError::DuplicateKeys);
        }
        Ok(Self {
            preimage_hash,
            recipient_pk,
            sender_pk,
            timeout,
        })
    }

    /// Parse and strictly validate a binary HTLC template (exactly 100 bytes).
    pub fn parse(bytes: &[u8]) -> Result<Self, HtlcError> {
        if bytes.len() != HTLC_SCRIPT_LEN {
            return Err(HtlcError::WrongLength);
        }
        let mut preimage_hash = [0u8; 32];
        preimage_hash.copy_from_slice(&bytes[0..32]);
        let mut recipient_pk = [0u8; 32];
        recipient_pk.copy_from_slice(&bytes[32..64]);
        let mut sender_pk = [0u8; 32];
        sender_pk.copy_from_slice(&bytes[64..96]);
        let timeout = u32::from_le_bytes([bytes[96], bytes[97], bytes[98], bytes[99]]);
        Self::new(preimage_hash, recipient_pk, sender_pk, timeout)
    }

    /// Serialize the template to its canonical 100-byte form.
    pub fn bytes(&self) -> [u8; HTLC_SCRIPT_LEN] {
        let mut buf = [0u8; HTLC_SCRIPT_LEN];
        buf[0..32].copy_from_slice(&self.preimage_hash);
        buf[32..64].copy_from_slice(&self.recipient_pk);
        buf[64..96].copy_from_slice(&self.sender_pk);
        buf[96..100].copy_from_slice(&self.timeout.to_le_bytes());
        buf
    }

    /// Serialize the template to a `Vec<u8>` (convenience).
    pub fn encode(&self) -> Vec<u8> {
        self.bytes().to_vec()
    }

    /// The committed preimage hash (`BLAKE3(preimage)`).
    pub fn preimage_hash(&self) -> &[u8; 32] {
        &self.preimage_hash
    }

    /// The recipient's Ed25519 public key (authorises the redeem path).
    pub fn recipient_pk(&self) -> &[u8; 32] {
        &self.recipient_pk
    }

    /// The sender's Ed25519 public key (authorises the refund path).
    pub fn sender_pk(&self) -> &[u8; 32] {
        &self.sender_pk
    }

    /// The absolute block height at which the refund path unlocks.
    pub fn timeout(&self) -> u32 {
        self.timeout
    }

    /// BLAKE3 hash of the 100-byte template.
    pub fn script_hash(&self) -> [u8; 32] {
        *blake3::hash(&self.bytes()).as_bytes()
    }

    /// The version 0x04 (HTLC) address locking to this template.
    pub fn address(&self) -> Address {
        Address::htlc(self.script_hash())
    }

    /// Build the **redeem** witness stack: `[template, preimage, recipient_sig]`.
    pub fn redeem_witness(&self, preimage: &[u8], recipient_sig: [u8; 64]) -> Vec<Vec<u8>> {
        vec![
            self.bytes().to_vec(),
            preimage.to_vec(),
            recipient_sig.to_vec(),
        ]
    }

    /// Build the **refund** witness stack: `[template, sender_sig]`.
    pub fn refund_witness(&self, sender_sig: [u8; 64]) -> Vec<Vec<u8>> {
        vec![self.bytes().to_vec(), sender_sig.to_vec()]
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
        let preimage_hash = [0x42u8; 32];
        let script = HtlcScript::new(preimage_hash, pk_from_seed(1), pk_from_seed(2), 100).unwrap();
        assert_eq!(script.timeout(), 100);
        assert_eq!(script.preimage_hash(), &preimage_hash);
        assert_eq!(script.recipient_pk(), &pk_from_seed(1));
        assert_eq!(script.sender_pk(), &pk_from_seed(2));

        let bytes = script.bytes();
        assert_eq!(bytes.len(), HTLC_SCRIPT_LEN);
        let parsed = HtlcScript::parse(&bytes).unwrap();
        assert_eq!(parsed, script);
        assert_eq!(parsed.script_hash(), script.script_hash());
        assert_eq!(parsed.address(), script.address());
        assert_eq!(
            parsed.address().version(),
            kovanica_types::ADDR_VERSION_HTLC
        );
    }

    #[test]
    fn reject_wrong_length() {
        assert_eq!(HtlcScript::parse(&[0u8; 99]), Err(HtlcError::WrongLength));
        assert_eq!(HtlcScript::parse(&[0u8; 101]), Err(HtlcError::WrongLength));
    }

    #[test]
    fn reject_invalid_and_duplicate_keys() {
        let ok = pk_from_seed(1);
        // y=2 (bytes [0x02, 0, …, 0]) is NOT on the Ed25519 curve.
        let invalid = [0x02u8; 32];
        assert_eq!(
            HtlcScript::new([0u8; 32], invalid, ok, 0),
            Err(HtlcError::InvalidRecipientKey)
        );
        assert_eq!(
            HtlcScript::new([0u8; 32], ok, invalid, 0),
            Err(HtlcError::InvalidSenderKey)
        );
        assert_eq!(
            HtlcScript::new([0u8; 32], ok, ok, 0),
            Err(HtlcError::DuplicateKeys)
        );
    }

    #[test]
    fn witness_shapes() {
        let script = HtlcScript::new(
            *blake3::hash(b"preimage").as_bytes(),
            pk_from_seed(1),
            pk_from_seed(2),
            10,
        )
        .unwrap();
        let redeem = script.redeem_witness(b"preimage", [0x11u8; 64]);
        assert_eq!(redeem.len(), 3);
        assert_eq!(redeem[0], script.bytes().to_vec());
        assert_eq!(redeem[1], b"preimage".to_vec());
        assert_eq!(redeem[2], vec![0x11u8; 64]);
        // Ledger rule: BLAKE3(preimage) == preimage_hash.
        assert_eq!(
            *blake3::hash(b"preimage").as_bytes(),
            *script.preimage_hash()
        );

        let refund = script.refund_witness([0x22u8; 64]);
        assert_eq!(refund.len(), 2);
        assert_eq!(refund[1], vec![0x22u8; 64]);
    }
}
