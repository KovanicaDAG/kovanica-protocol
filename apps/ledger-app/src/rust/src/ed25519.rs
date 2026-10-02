use super::ed25519_consts;

/// Ed25519 signing using curve25519-dalek (std) or ed25519 crate (no_std)
///
/// For Ledger (no_std), we use the pure Rust `ed25519` crate which is no_std compatible.
/// For std builds, we use ed25519-dalek.
/// Private key (32 bytes)
pub type PrivateKey = [u8; ed25519_consts::PRIVATE_KEY_LEN];

/// Public key (32 bytes, compressed)
pub type PublicKey = [u8; ed25519_consts::PUBLIC_KEY_LEN];

/// Signature (64 bytes: R || S)
pub type Signature = [u8; ed25519_consts::SIGNATURE_LEN];

/// Generate keypair from seed (32 bytes)
/// Returns (private_key, public_key)
#[cfg(feature = "std")]
pub fn keypair_from_seed(seed: &[u8; 32]) -> (PrivateKey, PublicKey) {
    use ed25519_dalek::{SigningKey, VerifyingKey};
    let signing_key = SigningKey::from_bytes(seed);
    let verifying_key = VerifyingKey::from(&signing_key);
    (*signing_key.as_bytes(), *verifying_key.as_bytes())
}

/// Generate keypair from seed (no_std version)
/// Uses pure Rust ed25519 crate
#[cfg(all(not(feature = "std"), feature = "no_std"))]
pub fn keypair_from_seed(seed: &[u8; 32]) -> (PrivateKey, PublicKey) {
    use ed25519::{SigningKey, VerifyingKey};
    let signing_key = SigningKey::from_bytes(seed);
    let verifying_key = VerifyingKey::from(&signing_key);
    (*signing_key.as_bytes(), *verifying_key.as_bytes())
}

/// Sign a message with private key
/// Returns 64-byte signature (R || S)
#[cfg(feature = "std")]
pub fn sign(private_key: &PrivateKey, message: &[u8]) -> Signature {
    use ed25519_dalek::{Signer, SigningKey};
    let signing_key = SigningKey::from_bytes(private_key);
    let sig = signing_key.sign(message);
    sig.to_bytes()
}

/// Sign a message (no_std version)
#[cfg(all(not(feature = "std"), feature = "no_std"))]
pub fn sign(private_key: &PrivateKey, message: &[u8]) -> Signature {
    use ed25519::{Signer, SigningKey};
    let signing_key = SigningKey::from_bytes(private_key);
    let sig: ed25519::Signature = signing_key.sign(message);
    sig.to_bytes()
}

/// Sign a message (fallback for other configurations)
#[cfg(not(any(feature = "std", all(not(feature = "std"), feature = "no_std"))))]
pub fn sign(_private_key: &PrivateKey, _message: &[u8]) -> Signature {
    [0u8; 64]
}

/// Verify a signature
#[cfg(feature = "std")]
pub fn verify(public_key: &PublicKey, message: &[u8], signature: &Signature) -> bool {
    use ed25519_dalek::{Signature as DalekSig, Verifier, VerifyingKey};
    let verifying_key = match VerifyingKey::from_bytes(public_key) {
        Ok(vk) => vk,
        Err(_) => return false,
    };
    let sig = match DalekSig::from_slice(signature) {
        Ok(s) => s,
        Err(_) => return false,
    };
    verifying_key.verify(message, &sig).is_ok()
}

/// Verify signature (no_std version)
#[cfg(all(not(feature = "std"), feature = "no_std"))]
pub fn verify(public_key: &PublicKey, message: &[u8], signature: &Signature) -> bool {
    use ed25519::{Signature as DalekSig, Verifier, VerifyingKey};
    let verifying_key = match VerifyingKey::from_bytes(public_key) {
        Ok(vk) => vk,
        Err(_) => return false,
    };
    let sig = match DalekSig::from_slice(signature) {
        Ok(s) => s,
        Err(_) => return false,
    };
    verifying_key.verify(message, &sig).is_ok()
}

/// Get public key from private key
pub fn public_from_private(private_key: &PrivateKey) -> PublicKey {
    #[cfg(feature = "std")]
    {
        use ed25519_dalek::{SigningKey, VerifyingKey};
        let sk = SigningKey::from_bytes(private_key);
        *VerifyingKey::from(&sk).as_bytes()
    }
    #[cfg(all(not(feature = "std"), feature = "no_std"))]
    {
        use ed25519::{SigningKey, VerifyingKey};
        let sk = SigningKey::from_bytes(private_key);
        *VerifyingKey::from(&sk).as_bytes()
    }
    #[cfg(not(any(feature = "std", all(not(feature = "std"), feature = "no_std"))))]
    {
        // Fallback for other configurations
        let _ = private_key;
        [0u8; 32]
    }
}

/// Sign transaction sighash
/// This is the main signing function used by the Ledger app
pub fn sign_transaction(
    private_key: &PrivateKey,
    sighash: &[u8; 32],
) -> core::result::Result<Signature, super::AppError> {
    if sighash.len() != 32 {
        return Err(super::AppError::InvalidTransaction);
    }
    #[cfg(any(feature = "std", all(not(feature = "std"), feature = "no_std")))]
    {
        Ok(sign(private_key, sighash))
    }
    #[cfg(not(any(feature = "std", all(not(feature = "std"), feature = "no_std"))))]
    {
        let _ = private_key;
        Err(super::AppError::CryptoError)
    }
}

#[cfg(test)]
mod tests {
    #[cfg(any(feature = "std", feature = "no_std"))]
    use super::*;

    #[cfg(feature = "std")]
    #[test]
    fn test_keypair_generation() {
        let seed = [1u8; 32];
        let (sk, pk) = keypair_from_seed(&seed);
        assert_ne!(sk, [0u8; 32]);
        assert_ne!(pk, [0u8; 32]);
    }

    #[cfg(feature = "std")]
    #[test]
    fn test_sign_verify() {
        let seed = [2u8; 32];
        let (sk, pk) = keypair_from_seed(&seed);
        let msg = b"test message";
        let sig = sign(&sk, msg);
        assert!(verify(&pk, msg, &sig));
        assert!(!verify(&pk, b"wrong message", &sig));
    }

    #[cfg(all(not(feature = "std"), feature = "no_std"))]
    #[test]
    fn test_keypair_generation_no_std() {
        let seed = [1u8; 32];
        let (sk, pk) = keypair_from_seed(&seed);
        assert_ne!(sk, [0u8; 32]);
        assert_ne!(pk, [0u8; 32]);
    }

    #[cfg(all(not(feature = "std"), feature = "no_std"))]
    #[test]
    fn test_sign_verify_no_std() {
        let seed = [2u8; 32];
        let (sk, pk) = keypair_from_seed(&seed);
        let msg = b"test message";
        let sig = sign(&sk, msg);
        assert!(verify(&pk, msg, &sig));
        assert!(!verify(&pk, b"wrong message", &sig));
    }
}
