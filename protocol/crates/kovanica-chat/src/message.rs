//! Chat message types and KVP-104 wire format.

use crate::crypto;

/// KVP-104 transaction tag for chat messages.
pub const CHAT_TAG: &[u8] = b"CHAT";

/// Maximum plaintext length in bytes (200 symbols).
pub const MAX_PLAINTEXT_LEN: usize = 200;

/// Maximum on-chain payload size: 32 (epk) + 12 (nonce) + 200 (plaintext) + 16 (tag) = 260.
#[allow(dead_code)]
pub const MAX_PAYLOAD_LEN: usize = 32 + 12 + MAX_PLAINTEXT_LEN + 16;

/// A decrypted chat message held in memory.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatMessage {
    /// Sender's Ed25519 public key (32 bytes).
    pub sender: [u8; 32],
    /// Recipient's Ed25519 public key (32 bytes).
    pub recipient: [u8; 32],
    /// Decrypted plaintext (max 200 bytes).
    pub plaintext: String,
    /// Unix timestamp (informational only, not consensus-critical).
    pub timestamp: u64,
}

impl ChatMessage {
    /// Create a new chat message.
    ///
    /// # Panics
    /// Panics if `plaintext` exceeds [`MAX_PLAINTEXT_LEN`] bytes.
    pub fn new(sender: [u8; 32], recipient: [u8; 32], plaintext: String, timestamp: u64) -> Self {
        assert!(
            plaintext.len() <= MAX_PLAINTEXT_LEN,
            "plaintext exceeds {} bytes",
            MAX_PLAINTEXT_LEN
        );
        Self {
            sender,
            recipient,
            plaintext,
            timestamp,
        }
    }

    /// Serialize to a compact byte representation (not the on-chain format).
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(64 + self.plaintext.len());
        buf.extend_from_slice(&self.sender);
        buf.extend_from_slice(&self.recipient);
        buf.extend_from_slice(&self.timestamp.to_le_bytes());
        buf.extend_from_slice(self.plaintext.as_bytes());
        buf
    }
}

/// The encrypted on-chain payload (inside a KVP-104 transaction's data field).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatPayload {
    /// Ephemeral X25519 public key (32 bytes).
    pub ephemeral_pk: [u8; 32],
    /// ChaCha20-Poly1305 nonce (12 bytes).
    pub nonce: [u8; 12],
    /// Ciphertext including the 16-byte Poly1305 tag.
    pub ciphertext: Vec<u8>,
}

impl ChatPayload {
    /// Serialize to the on-chain wire format: `epk || nonce || ciphertext`.
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(32 + 12 + self.ciphertext.len());
        buf.extend_from_slice(&self.ephemeral_pk);
        buf.extend_from_slice(&self.nonce);
        buf.extend_from_slice(&self.ciphertext);
        buf
    }

    /// Deserialize from the on-chain wire format.
    pub fn decode(bytes: &[u8]) -> Result<Self, ChatError> {
        if bytes.len() < 44 {
            return Err(ChatError::PayloadTooShort);
        }
        let mut ephemeral_pk = [0u8; 32];
        ephemeral_pk.copy_from_slice(&bytes[..32]);
        let mut nonce = [0u8; 12];
        nonce.copy_from_slice(&bytes[32..44]);
        let ciphertext = bytes[44..].to_vec();
        Ok(Self {
            ephemeral_pk,
            nonce,
            ciphertext,
        })
    }

    /// Encrypt a plaintext message for a recipient.
    ///
    /// `recipient_pk` must be the recipient's **X25519 public key** (32 bytes),
    /// derived from their Ed25519 seed via `crypto::ed25519_seed_to_x25519` then
    /// `x25519_dalek::PublicKey::from(&secret)`.
    pub fn encrypt(
        _sender_pk: &[u8; 32],
        recipient_pk: &[u8; 32],
        plaintext: &[u8],
    ) -> Result<Self, ChatError> {
        if plaintext.len() > MAX_PLAINTEXT_LEN {
            return Err(ChatError::PlaintextTooLong);
        }

        let (ephemeral_pk, nonce_and_ciphertext) = crypto::encrypt(recipient_pk, plaintext, &[])
            .map_err(|e| ChatError::Crypto(e.to_string()))?;

        if nonce_and_ciphertext.len() < 12 {
            return Err(ChatError::Crypto("ciphertext too short".into()));
        }

        let mut nonce = [0u8; 12];
        nonce.copy_from_slice(&nonce_and_ciphertext[..12]);
        let ciphertext = nonce_and_ciphertext[12..].to_vec();

        Ok(Self {
            ephemeral_pk,
            nonce,
            ciphertext,
        })
    }

    /// Decrypt this payload with the recipient's X25519 secret.
    ///
    /// A plain chat payload binds no AAD: everything it carries is either in
    /// the ciphertext or authenticated by the tag.
    pub fn decrypt(
        &self,
        recipient_secret: &x25519_dalek::StaticSecret,
    ) -> Result<Vec<u8>, ChatError> {
        crypto::decrypt(
            recipient_secret,
            &self.ephemeral_pk,
            &self.nonce,
            &self.ciphertext,
            &[],
        )
        .map_err(|e| ChatError::Crypto(e.to_string()))
    }
}

/// Errors from chat message operations.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChatError {
    /// On-chain payload shorter than the minimum 44 bytes (32 epk + 12 nonce).
    PayloadTooShort,
    /// Plaintext exceeds [`MAX_PLAINTEXT_LEN`].
    PlaintextTooLong,
    /// Encryption/decryption failure.
    Crypto(String),
}

impl core::fmt::Display for ChatError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::PayloadTooShort => write!(f, "payload too short"),
            Self::PlaintextTooLong => write!(f, "plaintext too long"),
            Self::Crypto(msg) => write!(f, "crypto error: {}", msg),
        }
    }
}

impl std::error::Error for ChatError {}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    fn test_keypair(seed: u64) -> SigningKey {
        let mut seed_bytes = [0u8; 32];
        // Put seed in byte 1+ to avoid X25519 clamping collisions on byte 0.
        seed_bytes[1..9].copy_from_slice(&seed.to_le_bytes());
        SigningKey::from_bytes(&seed_bytes)
    }

    #[test]
    fn payload_encode_decode_roundtrip() {
        let sk = test_keypair(1);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let plaintext = b"Hello, Kovanica!";
        let payload = ChatPayload::encrypt(&[0u8; 32], recipient_pk.as_bytes(), plaintext).unwrap();
        let encoded = payload.encode();
        assert_eq!(encoded.len(), 44 + plaintext.len() + 16);

        let decoded = ChatPayload::decode(&encoded).unwrap();
        assert_eq!(decoded.ephemeral_pk, payload.ephemeral_pk);
        assert_eq!(decoded.nonce, payload.nonce);
        assert_eq!(decoded.ciphertext, payload.ciphertext);
    }

    #[test]
    fn decrypt_roundtrip() {
        let sk = test_keypair(2);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let plaintext = b"Secret message";
        let payload = ChatPayload::encrypt(&[0u8; 32], recipient_pk.as_bytes(), plaintext).unwrap();

        let decrypted = payload.decrypt(&recipient_secret).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn wrong_recipient_cannot_decrypt() {
        let sk1 = test_keypair(3);
        let sk2 = test_keypair(4);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk1.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let plaintext = b"Secret";
        let payload = ChatPayload::encrypt(&[0u8; 32], recipient_pk.as_bytes(), plaintext).unwrap();

        let wrong_secret = crypto::ed25519_seed_to_x25519(&sk2.to_bytes());
        assert!(payload.decrypt(&wrong_secret).is_err());
    }

    #[test]
    fn plaintext_too_long_rejected() {
        let sk = test_keypair(5);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);
        let long_plaintext = vec![0u8; MAX_PLAINTEXT_LEN + 1];
        assert_eq!(
            ChatPayload::encrypt(&[0u8; 32], recipient_pk.as_bytes(), &long_plaintext).unwrap_err(),
            ChatError::PlaintextTooLong
        );
    }

    #[test]
    fn tampered_ciphertext_rejected() {
        let sk = test_keypair(6);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let plaintext = b"Secret";
        let mut payload =
            ChatPayload::encrypt(&[0u8; 32], recipient_pk.as_bytes(), plaintext).unwrap();
        payload.ciphertext[0] ^= 0xFF;

        assert!(payload.decrypt(&recipient_secret).is_err());
    }
}
