//! Encrypted voice messages (KVP-104 data transactions).
//!
//! Voice messages are encrypted audio clips carried inside KVP-104
//! transactions with tag `b"VOICE"`. They use the same ECIES encryption
//! as text chat messages (X25519 ephemeral + ChaCha20-Poly1305).
//!
//! Wire format (max 8 + 44 + 200 + 16 = 268 bytes on-chain for metadata):
//! ```text
//! duration: u32     — audio duration in milliseconds
//! epk:      [u8; 32] — ephemeral X25519 public key
//! nonce:    [u8; 12] — ChaCha20-Poly1305 nonce
//! ciphertext: [u8]  — encrypted audio data (includes 16-byte Poly1305 tag)
//! ```

use crate::crypto;
use crate::message::MAX_PLAINTEXT_LEN;

/// KVP-104 transaction tag for voice messages.
pub const VOICE_TAG: &[u8] = b"VOICE";

/// An encrypted voice message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VoiceMessage {
    /// Audio duration in milliseconds.
    pub duration_ms: u32,
    /// Ephemeral X25519 public key (32 bytes).
    pub ephemeral_pk: [u8; 32],
    /// ChaCha20-Poly1305 nonce (12 bytes).
    pub nonce: [u8; 12],
    /// Encrypted audio data (includes 16-byte Poly1305 tag).
    pub ciphertext: Vec<u8>,
}

impl VoiceMessage {
    /// Encrypt a voice message for a recipient.
    ///
    /// `recipient_pk` must be the recipient's **X25519 public key** (32 bytes),
    /// derived from their Ed25519 seed via `crypto::ed25519_seed_to_x25519` then
    /// `x25519_dalek::PublicKey::from(&secret)`.
    ///
    /// # Panics
    /// Panics if `audio_data` exceeds [`MAX_PLAINTEXT_LEN`] bytes.
    pub fn encrypt(
        recipient_pk: &[u8; 32],
        duration_ms: u32,
        audio_data: &[u8],
    ) -> Result<Self, VoiceError> {
        if audio_data.len() > MAX_PLAINTEXT_LEN {
            return Err(VoiceError::AudioTooLong);
        }

        let (ephemeral_pk, nonce_and_ciphertext) = crypto::encrypt(recipient_pk, audio_data)
            .map_err(|e| VoiceError::Crypto(e.to_string()))?;

        if nonce_and_ciphertext.len() < 12 {
            return Err(VoiceError::Crypto("ciphertext too short".into()));
        }

        let mut nonce = [0u8; 12];
        nonce.copy_from_slice(&nonce_and_ciphertext[..12]);
        let ciphertext = nonce_and_ciphertext[12..].to_vec();

        Ok(Self {
            duration_ms,
            ephemeral_pk,
            nonce,
            ciphertext,
        })
    }

    /// Decrypt this voice message with the recipient's X25519 secret.
    pub fn decrypt(
        &self,
        recipient_secret: &x25519_dalek::StaticSecret,
    ) -> Result<Vec<u8>, VoiceError> {
        crypto::decrypt(
            recipient_secret,
            &self.ephemeral_pk,
            &self.nonce,
            &self.ciphertext,
        )
        .map_err(|e| VoiceError::Crypto(e.to_string()))
    }

    /// Serialize to the on-chain wire format.
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(4 + 32 + 12 + self.ciphertext.len());
        buf.extend_from_slice(&self.duration_ms.to_le_bytes());
        buf.extend_from_slice(&self.ephemeral_pk);
        buf.extend_from_slice(&self.nonce);
        buf.extend_from_slice(&self.ciphertext);
        buf
    }

    /// Deserialize from the on-chain wire format.
    pub fn decode(bytes: &[u8]) -> Result<Self, VoiceError> {
        if bytes.len() < 48 {
            return Err(VoiceError::PayloadTooShort);
        }
        let mut duration_bytes = [0u8; 4];
        duration_bytes.copy_from_slice(&bytes[..4]);
        let duration_ms = u32::from_le_bytes(duration_bytes);
        let mut ephemeral_pk = [0u8; 32];
        ephemeral_pk.copy_from_slice(&bytes[4..36]);
        let mut nonce = [0u8; 12];
        nonce.copy_from_slice(&bytes[36..48]);
        let ciphertext = bytes[48..].to_vec();
        Ok(Self {
            duration_ms,
            ephemeral_pk,
            nonce,
            ciphertext,
        })
    }
}

/// Errors from voice message operations.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VoiceError {
    /// Payload shorter than the minimum 48 bytes.
    PayloadTooShort,
    /// Audio data exceeds [`MAX_PLAINTEXT_LEN`].
    AudioTooLong,
    /// Encryption/decryption failure.
    Crypto(String),
}

impl core::fmt::Display for VoiceError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::PayloadTooShort => write!(f, "payload too short"),
            Self::AudioTooLong => write!(f, "audio too long"),
            Self::Crypto(msg) => write!(f, "crypto error: {}", msg),
        }
    }
}

impl std::error::Error for VoiceError {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto;

    fn test_keypair(seed: u64) -> ed25519_dalek::SigningKey {
        let mut seed_bytes = [0u8; 32];
        // Put seed in byte 1+ to avoid X25519 clamping collisions on byte 0.
        seed_bytes[1..9].copy_from_slice(&seed.to_le_bytes());
        ed25519_dalek::SigningKey::from_bytes(&seed_bytes)
    }

    #[test]
    fn voice_message_encrypt_decrypt_roundtrip() {
        let sk = test_keypair(10);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let duration_ms = 5000u32;
        let audio_data = vec![0xABu8; 100];
        let msg = VoiceMessage::encrypt(recipient_pk.as_bytes(), duration_ms, &audio_data).unwrap();

        let decrypted = msg.decrypt(&recipient_secret).unwrap();
        assert_eq!(decrypted, audio_data);
    }

    #[test]
    fn voice_message_encode_decode_roundtrip() {
        let sk = test_keypair(11);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let duration_ms = 3000u32;
        let audio_data = vec![0xCDu8; 50];
        let msg = VoiceMessage::encrypt(recipient_pk.as_bytes(), duration_ms, &audio_data).unwrap();

        let encoded = msg.encode();
        let decoded = VoiceMessage::decode(&encoded).unwrap();
        assert_eq!(decoded.duration_ms, duration_ms);
        assert_eq!(decoded.ephemeral_pk, msg.ephemeral_pk);
        assert_eq!(decoded.nonce, msg.nonce);
        assert_eq!(decoded.ciphertext, msg.ciphertext);

        let decrypted = decoded.decrypt(&recipient_secret).unwrap();
        assert_eq!(decrypted, audio_data);
    }

    #[test]
    fn voice_message_wrong_recipient_cannot_decrypt() {
        let sk1 = test_keypair(12);
        let sk2 = test_keypair(13);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk1.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let audio_data = vec![0xEFu8; 80];
        let msg = VoiceMessage::encrypt(recipient_pk.as_bytes(), 1000, &audio_data).unwrap();

        let wrong_secret = crypto::ed25519_seed_to_x25519(&sk2.to_bytes());
        assert!(msg.decrypt(&wrong_secret).is_err());
    }

    #[test]
    fn voice_message_too_short_rejected() {
        let short = [0u8; 47];
        assert_eq!(
            VoiceMessage::decode(&short).unwrap_err(),
            VoiceError::PayloadTooShort
        );
    }

    #[test]
    fn voice_message_audio_too_long() {
        let sk = test_keypair(14);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);
        let long_audio = vec![0u8; MAX_PLAINTEXT_LEN + 1];
        assert_eq!(
            VoiceMessage::encrypt(recipient_pk.as_bytes(), 1000, &long_audio).unwrap_err(),
            VoiceError::AudioTooLong
        );
    }

    #[test]
    fn voice_message_tampered_ciphertext_rejected() {
        let sk = test_keypair(15);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let audio_data = vec![0xAAu8; 60];
        let mut msg = VoiceMessage::encrypt(recipient_pk.as_bytes(), 2000, &audio_data).unwrap();
        msg.ciphertext[0] ^= 0xFF;

        assert!(msg.decrypt(&recipient_secret).is_err());
    }
}
