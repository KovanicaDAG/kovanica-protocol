//! M-of-N multisignature redeem scripts (RFC-001 / KVP-101).
//!
//! Wire format: `[M (1B), N (1B), PubKey_1 (32B), …, PubKey_N (32B)]`.
//! Address = BLAKE3(redeem_script) at version 0x01 (P2SH). Spending witness:
//! `[redeem_script, sig_1 (64B), …, sig_M (64B)]`.

use ed25519_dalek::VerifyingKey;
use kovanica_types::Address;

/// Maximum number of public keys allowed in a multisig script (node rule).
pub const MAX_MULTISIG_KEYS: usize = 16;

/// Errors from constructing / parsing a multisig redeem script.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MultisigError {
    /// Key list is empty.
    #[error("key count N must be at least 1")]
    EmptyKeys,
    /// More than `MAX_MULTISIG_KEYS` keys.
    #[error("key count N exceeds maximum allowed (16)")]
    TooManyKeys,
    /// Threshold M must be at least 1.
    #[error("threshold M must be at least 1")]
    ThresholdUnderOne,
    /// Threshold M cannot exceed N.
    #[error("threshold M cannot exceed N")]
    ThresholdExceedsN,
    /// A public key is not a valid Ed25519 point.
    #[error("invalid ed25519 public key in script")]
    InvalidPubkey,
    /// Duplicate public key in script.
    #[error("duplicate public key in multisig script")]
    DuplicatePubkey,
    /// Script bytes malformed.
    #[error("script too short")]
    ScriptTooShort,
    /// Length does not match declared N.
    #[error("script length does not match declared N")]
    BadLength,
    /// Wrong number of signatures supplied to the spend witness.
    #[error("multisig spend requires exactly M = {0} signatures")]
    WrongSignatureCount(u8),
}

/// A parsed, validated M-of-N multisig redeem script.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MultisigScript {
    /// Required threshold of valid signatures (`1 <= m <= n`).
    pub m: u8,
    /// Total number of authorized public keys (`1 <= n <= 16`).
    pub n: u8,
    /// List of distinct, valid Ed25519 public keys.
    pub pubkeys: Vec<[u8; 32]>,
}

impl MultisigScript {
    /// Construct and validate from threshold `m` and a slice of pubkeys.
    pub fn new(m: u8, pubkeys: Vec<[u8; 32]>) -> Result<Self, MultisigError> {
        if pubkeys.is_empty() {
            return Err(MultisigError::EmptyKeys);
        }
        if pubkeys.len() > MAX_MULTISIG_KEYS {
            return Err(MultisigError::TooManyKeys);
        }
        let n = pubkeys.len() as u8;
        if m < 1 {
            return Err(MultisigError::ThresholdUnderOne);
        }
        if m > n {
            return Err(MultisigError::ThresholdExceedsN);
        }
        for pk in &pubkeys {
            if VerifyingKey::from_bytes(pk).is_err() {
                return Err(MultisigError::InvalidPubkey);
            }
        }
        for i in 0..pubkeys.len() {
            for j in (i + 1)..pubkeys.len() {
                if pubkeys[i] == pubkeys[j] {
                    return Err(MultisigError::DuplicatePubkey);
                }
            }
        }
        Ok(Self { m, n, pubkeys })
    }

    /// Parse and strictly validate a binary redeem script.
    pub fn parse(bytes: &[u8]) -> Result<Self, MultisigError> {
        if bytes.len() < 2 {
            return Err(MultisigError::ScriptTooShort);
        }
        let m = bytes[0];
        let n = bytes[1];
        if m < 1 {
            return Err(MultisigError::ThresholdUnderOne);
        }
        if n < 1 {
            return Err(MultisigError::EmptyKeys);
        }
        if m > n {
            return Err(MultisigError::ThresholdExceedsN);
        }
        if n as usize > MAX_MULTISIG_KEYS {
            return Err(MultisigError::TooManyKeys);
        }
        let expected_len = 2 + 32 * (n as usize);
        if bytes.len() != expected_len {
            return Err(MultisigError::BadLength);
        }
        let mut pubkeys = Vec::with_capacity(n as usize);
        for i in 0..(n as usize) {
            let offset = 2 + 32 * i;
            let mut pk = [0u8; 32];
            pk.copy_from_slice(&bytes[offset..offset + 32]);
            if VerifyingKey::from_bytes(&pk).is_err() {
                return Err(MultisigError::InvalidPubkey);
            }
            pubkeys.push(pk);
        }
        for i in 0..pubkeys.len() {
            for j in (i + 1)..pubkeys.len() {
                if pubkeys[i] == pubkeys[j] {
                    return Err(MultisigError::DuplicatePubkey);
                }
            }
        }
        Ok(Self { m, n, pubkeys })
    }

    /// Serialize the redeem script: `[M, N, pk1, …, pkN]`.
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(2 + 32 * self.pubkeys.len());
        buf.push(self.m);
        buf.push(self.n);
        for pk in &self.pubkeys {
            buf.extend_from_slice(pk);
        }
        buf
    }

    /// BLAKE3 hash of the redeem script.
    pub fn script_hash(&self) -> [u8; 32] {
        *blake3::hash(&self.encode()).as_bytes()
    }

    /// The version 0x01 (P2SH) address locking to this script.
    pub fn address(&self) -> Address {
        Address::p2sh(self.script_hash())
    }

    /// Build the spend witness: `[redeem_script, sig_1, …, sig_M]`.
    ///
    /// `signatures` must contain exactly `M` 64-byte Ed25519 signatures. The
    /// ledger verifies each against one of the script's public keys.
    pub fn spend_witness(&self, signatures: &[[u8; 64]]) -> Result<Vec<Vec<u8>>, MultisigError> {
        if signatures.len() != self.m as usize {
            return Err(MultisigError::WrongSignatureCount(self.m));
        }
        let mut witness = Vec::with_capacity(1 + signatures.len());
        witness.push(self.encode());
        for sig in signatures {
            witness.push(sig.to_vec());
        }
        Ok(witness)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk_from_seed(seed: u64) -> [u8; 32] {
        use ed25519_dalek::SigningKey;
        let mut bytes = [0u8; 32];
        bytes[..8].copy_from_slice(&seed.to_le_bytes());
        SigningKey::from_bytes(&bytes).verifying_key().to_bytes()
    }

    #[test]
    fn make_parse_and_address() {
        let keys = vec![pk_from_seed(1), pk_from_seed(2), pk_from_seed(3)];
        let script = MultisigScript::new(2, keys.clone()).unwrap();
        assert_eq!((script.m, script.n), (2, 3));
        assert_eq!(script.pubkeys, keys);

        let parsed = MultisigScript::parse(&script.encode()).unwrap();
        assert_eq!(parsed, script);
        assert_eq!(parsed.script_hash(), script.script_hash());
        assert_eq!(parsed.address(), script.address());
        assert_eq!(
            parsed.address().version(),
            kovanica_types::ADDR_VERSION_P2SH
        );
    }

    #[test]
    fn rejects_bad_thresholds_and_duplicates() {
        assert_eq!(
            MultisigScript::new(0, vec![pk_from_seed(1)]),
            Err(MultisigError::ThresholdUnderOne)
        );
        assert_eq!(
            MultisigScript::new(3, vec![pk_from_seed(1)]),
            Err(MultisigError::ThresholdExceedsN)
        );
        assert_eq!(
            MultisigScript::new(1, vec![]),
            Err(MultisigError::EmptyKeys)
        );
        assert_eq!(
            MultisigScript::new(2, vec![pk_from_seed(1), pk_from_seed(1)]),
            Err(MultisigError::DuplicatePubkey)
        );
    }

    #[test]
    fn spend_witness_requires_exactly_m_signatures() {
        let script = MultisigScript::new(2, vec![pk_from_seed(1), pk_from_seed(2)]).unwrap();
        assert_eq!(
            script.spend_witness(&[[0x11u8; 64]]),
            Err(MultisigError::WrongSignatureCount(2))
        );
        let witness = script.spend_witness(&[[0x11u8; 64], [0x22u8; 64]]).unwrap();
        assert_eq!(witness.len(), 3);
        assert_eq!(witness[0], script.encode());
        assert_eq!(witness[1], vec![0x11u8; 64]);
        assert_eq!(witness[2], vec![0x22u8; 64]);
    }
}
