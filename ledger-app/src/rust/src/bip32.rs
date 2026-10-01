use super::Result;
use hmac::{Hmac, Mac};
use sha2::Sha512;

/// HMAC-SHA512 implementation using external crates
fn hmac_sha512(key: &[u8], data: &[u8]) -> [u8; 64] {
    let mut mac = Hmac::<Sha512>::new_from_slice(key).expect("HMAC key");
    mac.update(data);
    mac.finalize().into_bytes().into()
}

/// SLIP-0010 Ed25519 derivation
/// Returns (private_key[32], chain_code[32])
pub fn slip10_derive(
    parent_key: &[u8; 32],
    parent_chain: &[u8; 32],
    index: u32,
) -> ([u8; 32], [u8; 32]) {
    let mut data = [0u8; 37];
    // First byte: 0x00 for private derivation (hardened)
    data[0] = 0x00;
    // Next 32 bytes: parent private key
    data[1..33].copy_from_slice(parent_key);
    // Last 4 bytes: index (big-endian)
    data[33..37].copy_from_slice(&index.to_be_bytes());

    let hmac = hmac_sha512(parent_chain, &data);
    let mut child_key = [0u8; 32];
    let mut child_chain = [0u8; 32];
    child_key.copy_from_slice(&hmac[0..32]);
    child_chain.copy_from_slice(&hmac[32..64]);
    (child_key, child_chain)
}

/// Derive master key and chain code from seed (SLIP-0010)
/// Returns (master_key[32], master_chain[32])
pub fn slip10_master_from_seed(seed: &[u8]) -> ([u8; 32], [u8; 32]) {
    const ED25519_SEED: &[u8] = b"ed25519 seed";
    let hmac = hmac_sha512(ED25519_SEED, seed);
    let mut master_key = [0u8; 32];
    let mut master_chain = [0u8; 32];
    master_key.copy_from_slice(&hmac[0..32]);
    master_chain.copy_from_slice(&hmac[32..64]);
    (master_key, master_chain)
}

/// BIP-39 seed from mnemonic (with passphrase)
/// Uses PBKDF2-HMAC-SHA512 with 2048 iterations
pub fn bip39_seed(_mnemonic: &str, _passphrase: &str) -> [u8; 64] {
    // In production, use pbkdf2 crate
    // This is a placeholder
    [0u8; 64]
}

/// Derive BIP-44 path from seed
/// Path format: m / 44' / coin_type' / account' / change / index
pub fn derive_bip44_path(seed: &[u8], path: &[u32]) -> Result<([u8; 32], [u8; 32])> {
    if path.is_empty() || path.len() > 10 {
        return Err(super::AppError::InvalidPath);
    }

    // Master key from seed
    let (mut key, mut chain) = slip10_master_from_seed(seed);

    // Derive each component
    for (i, &index) in path.iter().enumerate() {
        let hardened = index & 0x80000000 != 0;
        let child_index = index & 0x7FFFFFFF;

        // Only hardened derivation supported for Ed25519 (SLIP-0010)
        if !hardened && i > 0 {
            return Err(super::AppError::InvalidDerivation);
        }

        (key, chain) = slip10_derive(&key, &chain, hardened as u32 | child_index);
    }

    Ok((key, chain))
}

/// Get public key from private key (Ed25519)
pub fn ed25519_public_key(_private_key: &[u8; 32]) -> [u8; 32] {
    // Use ed25519-dalek or similar
    // Placeholder
    [0u8; 32]
}

/// Sign message with Ed25519 private key
pub fn ed25519_sign(_private_key: &[u8; 32], _message: &[u8]) -> [u8; 64] {
    // Use ed25519-dalek or similar
    // Placeholder
    [0u8; 64]
}

/// Verify Ed25519 signature
pub fn ed25519_verify(_public_key: &[u8; 32], _message: &[u8], _signature: &[u8; 64]) -> bool {
    // Use ed25519-dalek or similar
    // Placeholder
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slip10_master() {
        let seed = [0u8; 32]; // Test seed
        let (key, chain) = slip10_master_from_seed(&seed);
        assert_ne!(key, [0u8; 32]);
        assert_ne!(chain, [0u8; 32]);
    }

    #[test]
    fn test_slip10_derive() {
        let parent_key = [1u8; 32];
        let parent_chain = [2u8; 32];
        let (child_key, child_chain) = slip10_derive(&parent_key, &parent_chain, 0x80000000);
        assert_ne!(child_key, parent_key);
        assert_ne!(child_chain, parent_chain);
    }
}
