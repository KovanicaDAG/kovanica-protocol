//! ECIES encryption/decryption for chat payloads (X25519 + ChaCha20-Poly1305).
//!
//! The sender generates an ephemeral X25519 keypair, computes a shared secret
//! with the recipient's public key, derives a ChaCha20-Poly1305 key via BLAKE3,
//! and encrypts the plaintext. Only the recipient can recover the shared secret
//! and decrypt.

use blake3::Hasher;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use rand::rngs::OsRng;
use x25519_dalek::{EphemeralSecret, PublicKey};

/// Errors from chat encryption/decryption.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CryptoError {
    /// Ciphertext too short to contain the Poly1305 tag.
    CiphertextTooShort,
    /// AEAD decryption failed (wrong key or tampered ciphertext).
    DecryptionFailed,
}

impl core::fmt::Display for CryptoError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::CiphertextTooShort => write!(f, "ciphertext too short"),
            Self::DecryptionFailed => write!(f, "decryption failed"),
        }
    }
}

impl std::error::Error for CryptoError {}

/// Derive a 32-byte AEAD key from the ephemeral public key, recipient public
/// key, and X25519 shared secret.
fn derive_key(epk: &[u8; 32], recipient_pk: &[u8; 32], shared: &[u8]) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"KOVANICA-CHAT-KEY");
    hasher.update(epk);
    hasher.update(recipient_pk);
    hasher.update(shared);
    let mut key = [0u8; 32];
    key.copy_from_slice(hasher.finalize().as_bytes());
    key
}

/// Encrypt `plaintext` for `recipient_pk`, returning the 32-byte ephemeral
/// public key and the ciphertext (which includes the 16-byte Poly1305 tag).
///
/// The caller is responsible for generating a random 12-byte nonce and
/// concatenating the output: `epk || nonce || ciphertext`.
///
/// `aad` is authenticated but not encrypted: it is covered by the Poly1305 tag
/// yet never appears in the output. Pass any metadata that travels beside the
/// ciphertext — a message duration, a chunk index — so it cannot be altered in
/// transit. Pass `&[]` when there is nothing to bind; that is byte-for-byte
/// identical to encrypting without AAD.
pub fn encrypt(
    recipient_pk: &[u8; 32],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<([u8; 32], Vec<u8>), CryptoError> {
    // Ephemeral X25519 keypair
    let ephemeral_secret = EphemeralSecret::random_from_rng(OsRng);
    let ephemeral_public = PublicKey::from(&ephemeral_secret);

    // Recipient public key
    let recipient_public = PublicKey::from(*recipient_pk);

    // ECDH shared secret
    let shared = ephemeral_secret.diffie_hellman(&recipient_public);

    // Derive AEAD key
    let key = derive_key(ephemeral_public.as_bytes(), recipient_pk, shared.as_bytes());
    let cipher = ChaCha20Poly1305::new_from_slice(&key)
        .expect("32-byte key is always valid for ChaCha20-Poly1305");

    // Random nonce
    let mut nonce_bytes = [0u8; 12];
    use rand::RngCore;
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt
    let ciphertext = cipher
        .encrypt(nonce, Payload { msg: plaintext, aad })
        .map_err(|_| CryptoError::DecryptionFailed)?;

    // Concatenate nonce || ciphertext
    let mut output = Vec::with_capacity(12 + ciphertext.len());
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);

    Ok((*ephemeral_public.as_bytes(), output))
}

/// Decrypt a payload produced by `encrypt`.
///
/// `ephemeral_pk` is the 32-byte ephemeral public key, `nonce` is the
/// 12-byte nonce, and `ciphertext` includes the 16-byte Poly1305 tag.
///
/// `aad` must be byte-identical to the value passed to [`encrypt`], or the
/// Poly1305 tag check fails and the payload is rejected.
pub fn decrypt(
    recipient_secret: &x25519_dalek::StaticSecret,
    ephemeral_pk: &[u8; 32],
    nonce: &[u8],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if ciphertext.len() < 16 {
        return Err(CryptoError::CiphertextTooShort);
    }

    let ephemeral_public = PublicKey::from(*ephemeral_pk);
    let shared = recipient_secret.diffie_hellman(&ephemeral_public);

    // Recipient's own public key for key derivation
    let recipient_pk = PublicKey::from(recipient_secret);
    let key = derive_key(ephemeral_pk, recipient_pk.as_bytes(), shared.as_bytes());

    let cipher = ChaCha20Poly1305::new_from_slice(&key)
        .expect("32-byte key is always valid for ChaCha20-Poly1305");
    let nonce = Nonce::from_slice(nonce);

    cipher
        .decrypt(nonce, Payload { msg: ciphertext, aad })
        .map_err(|_| CryptoError::DecryptionFailed)
}

/// Convert an Ed25519 secret key seed to an X25519 static secret.
///
/// Clamps the 32-byte seed per RFC 7748 and returns an X25519 StaticSecret.
#[allow(dead_code)]
pub fn ed25519_seed_to_x25519(ed25519_seed: &[u8; 32]) -> x25519_dalek::StaticSecret {
    let mut clamped = [0u8; 32];
    clamped.copy_from_slice(ed25519_seed);
    // Clamp per RFC 7748 §5 (X25519 clamping)
    clamped[0] &= 248;
    clamped[31] &= 127;
    clamped[31] |= 64;
    x25519_dalek::StaticSecret::from(clamped)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A payload encrypted with empty AAD must be byte-for-byte identical to
    /// one encrypted with no AAD argument at all.
    ///
    /// Plain chat messages bind nothing, so this is what keeps every already
    /// sent payload decryptable after AAD support landed. If a future AEAD
    /// change made empty AAD differ, this test fails rather than the wire
    /// format quietly breaking for clients holding old messages.
    #[test]
    fn empty_aad_matches_the_no_aad_ciphertext() {
        let key = [0x5Au8; 32];
        let nonce_bytes = [0x17u8; 12];
        let nonce = Nonce::from_slice(&nonce_bytes);
        let cipher = ChaCha20Poly1305::new_from_slice(&key).unwrap();
        let plaintext = b"a plain chat message";

        let without_aad = cipher.encrypt(nonce, plaintext.as_ref()).unwrap();
        let with_empty_aad = cipher
            .encrypt(nonce, Payload { msg: plaintext.as_ref(), aad: &[] })
            .unwrap();

        assert_eq!(without_aad, with_empty_aad);
        assert_eq!(
            cipher
                .decrypt(nonce, Payload { msg: with_empty_aad.as_ref(), aad: &[] })
                .unwrap(),
            plaintext
        );
    }

    #[test]
    fn non_empty_aad_is_authenticated() {
        let key = [0x5Au8; 32];
        let nonce_bytes = [0x17u8; 12];
        let nonce = Nonce::from_slice(&nonce_bytes);
        let cipher = ChaCha20Poly1305::new_from_slice(&key).unwrap();
        let plaintext = b"metadata-bound";

        let sealed = cipher
            .encrypt(nonce, Payload { msg: plaintext.as_ref(), aad: b"index=3" })
            .unwrap();

        assert!(cipher
            .decrypt(nonce, Payload { msg: sealed.as_ref(), aad: b"index=3" })
            .is_ok());
        // A different AAD must fail: this is the property that makes bound
        // metadata tamper-evident rather than merely encrypted.
        assert!(cipher
            .decrypt(nonce, Payload { msg: sealed.as_ref(), aad: b"index=4" })
            .is_err());
    }
}
