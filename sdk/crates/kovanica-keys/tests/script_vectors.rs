//! Script template vectors (multisig / HTLC / vault) — shared with the node.
//!
//! Same constants as `protocol/crates/kovanica-state/tests/script_vectors.rs`.
//! Derivation: ed25519-dalek `SigningKey::from_bytes([k LE, 0…0])` which is
//! exactly what the node's `KeyPair::from_u64(k)` produces — so the template
//! bytes and addresses must match byte-for-byte.

use ed25519_dalek::SigningKey;
use kovanica_keys::scripts::{HtlcScript, MultisigScript, VaultScript};
use kovanica_keys::{decode_address, to_kvnc};

/// 2-of-3 redeem script: `[M, N, pk1, pk2, pk3]`.
const MSIG_SCRIPT_HEX: &str = "0203cecc1507dc1ddd7295951c290888f095adb9044d1b73d696e6df065d683bd4fc6b79c57e6a095239282c04818e96112f3f03a4001ba97a564c23852a3f1ea5fcdadbd184a2d526f1ebdd5c06fdad9359b228759b4d7f79d66689fa254aad8546";
/// BLAKE3(2-of-3 redeem script).
const MSIG_HASH_HEX: &str = "431832282d974fbf2be9a99dadc091eb711018b0b021a831618ac0f69a9f5d7f";
/// Version 0x01 address locking to the 2-of-3 script.
const MSIG_ADDR_KVNC: &str = "kvncNkE5xCuTjjZKfqF6viu2aBypvyerLorawYsc3QBVowXkdag";
/// 66-hex of the same versioned address.
const MSIG_ADDR_HEX: &str = "01431832282d974fbf2be9a99dadc091eb711018b0b021a831618ac0f69a9f5d7f";

/// HTLC template: `[preimage_hash ‖ recipient_pk ‖ sender_pk ‖ timeout LE]`.
const HTLC_SCRIPT_HEX: &str = "4242424242424242424242424242424242424242424242424242424242424242cecc1507dc1ddd7295951c290888f095adb9044d1b73d696e6df065d683bd4fc6b79c57e6a095239282c04818e96112f3f03a4001ba97a564c23852a3f1ea5fca0050000";
/// BLAKE3(HTLC template).
const HTLC_HASH_HEX: &str = "34963648cfc1987549c1725b173531bdfe23bc89f2135b02abbcfeb57be988e8";
/// Version 0x04 address locking to the HTLC template.
const HTLC_ADDR_KVNC: &str = "kvnc2FTYXoahYGooV3JhAFDJ7ywu7kwAJHiPxqxpDvXpBvRAwdag";
/// 66-hex of the same versioned address.
const HTLC_ADDR_HEX: &str = "0434963648cfc1987549c1725b173531bdfe23bc89f2135b02abbcfeb57be988e8";

/// Vault template: `[unlock_height LE ‖ csv LE ‖ owner_pk]`.
const VAULT_SCRIPT_HEX: &str =
    "e803000090000000cecc1507dc1ddd7295951c290888f095adb9044d1b73d696e6df065d683bd4fc";
/// BLAKE3(vault template).
const VAULT_HASH_HEX: &str = "78713d90679c8c72a18b5b7c5b230d9ff2bd8d3fe0e0f6232dd9279319d38516";
/// Version 0x05 address locking to the vault template.
const VAULT_ADDR_KVNC: &str = "kvnc2dFjvnX8dSMFqw2reNMpueMjZjoAGMg4AYULyCWaRZHc9dag";
/// 66-hex of the same versioned address.
const VAULT_ADDR_HEX: &str = "0578713d90679c8c72a18b5b7c5b230d9ff2bd8d3fe0e0f6232dd9279319d38516";

fn pk_from_index(k: u64) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    bytes[..8].copy_from_slice(&k.to_le_bytes());
    SigningKey::from_bytes(&bytes).verifying_key().to_bytes()
}

#[test]
fn sdk_multisig_script_vectors() {
    let script = MultisigScript::new(
        2,
        vec![pk_from_index(1), pk_from_index(2), pk_from_index(3)],
    )
    .unwrap();
    assert_eq!(hex::encode(script.encode()), MSIG_SCRIPT_HEX);
    assert_eq!(hex::encode(script.script_hash()), MSIG_HASH_HEX);
    assert_eq!(to_kvnc(&script.address()), MSIG_ADDR_KVNC);
    assert_eq!(script.address().to_hex(), MSIG_ADDR_HEX);
    assert_eq!(decode_address(MSIG_ADDR_KVNC).unwrap(), script.address());

    // Witness shape: [redeem_script, sig_1, sig_2].
    let witness = script.spend_witness(&[[0x11u8; 64], [0x22u8; 64]]).unwrap();
    assert_eq!(witness.len(), 3);
    assert_eq!(witness[0], script.encode());
    assert!(witness[1..].iter().all(|s| s.len() == 64));
}

#[test]
fn sdk_htlc_script_vectors() {
    let script = HtlcScript::new([0x42u8; 32], pk_from_index(1), pk_from_index(2), 1440).unwrap();
    assert_eq!(hex::encode(script.bytes()), HTLC_SCRIPT_HEX);
    assert_eq!(hex::encode(script.script_hash()), HTLC_HASH_HEX);
    assert_eq!(to_kvnc(&script.address()), HTLC_ADDR_KVNC);
    assert_eq!(script.address().to_hex(), HTLC_ADDR_HEX);
    assert_eq!(decode_address(HTLC_ADDR_KVNC).unwrap(), script.address());
}

#[test]
fn sdk_vault_script_vectors() {
    let script = VaultScript::new(1000, 144, pk_from_index(1)).unwrap();
    assert_eq!(hex::encode(script.bytes()), VAULT_SCRIPT_HEX);
    assert_eq!(hex::encode(script.script_hash()), VAULT_HASH_HEX);
    assert_eq!(to_kvnc(&script.address()), VAULT_ADDR_KVNC);
    assert_eq!(script.address().to_hex(), VAULT_ADDR_HEX);
    assert_eq!(decode_address(VAULT_ADDR_KVNC).unwrap(), script.address());
}
