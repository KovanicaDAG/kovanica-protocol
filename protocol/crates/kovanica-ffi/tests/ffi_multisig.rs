//! FFI-level multisig flow tests — mirror the Kotlin/Swift surface exactly.

use ed25519_dalek::SigningKey;
use kovanica_ffi::{LightConfig, LightNode, MultisigSpendOutput};
use kovanica_state::KeyPair;

/// The PoA authority set for these tests (3 keys, the RFC-POA minimum).
const AUTHORITY_BASE: u8 = 0xB1;

fn authority_seeds() -> Vec<[u8; 32]> {
    (0..3usize)
        .map(|i| [AUTHORITY_BASE + i as u8; 32])
        .collect()
}

fn authority_config() -> LightConfig {
    LightConfig {
        authority_public_keys: authority_seeds()
            .iter()
            .map(|seed| hex::encode(SigningKey::from_bytes(seed).verifying_key().as_bytes()))
            .collect(),
        ..LightConfig::default()
    }
}

/// A node that is an authority in every slot, so `produce_block` can seal the
/// multisig spend. Under PoA nothing else can (RFC-POA §0: admission is by
/// authority signature, and there is no PoW fallback).
fn fresh() -> LightNode {
    let node = LightNode::new(authority_config()).expect("genesis ok");
    for seed in authority_seeds() {
        node.set_authority_key_for_tests(seed);
    }
    node
}

fn secret_for(seed: u64) -> String {
    let mut bytes = [0u8; 32];
    bytes[..8].copy_from_slice(&seed.to_le_bytes());
    hex::encode(bytes)
}

fn pubkey_hex(seed: u64) -> String {
    hex::encode(KeyPair::from_u64(seed).address().payload())
}

#[test]
fn ffi_two_of_three_create_fund_spend() {
    let node = fresh();

    let ms = node
        .create_multisig_address(2, vec![pubkey_hex(1), pubkey_hex(2), pubkey_hex(3)])
        .unwrap();
    assert!(ms.address.starts_with("kvnc") && ms.address.ends_with("dag"));
    assert_eq!(
        hex::decode(&ms.redeem_script_hex).unwrap().len(),
        2 + 32 * 3
    );

    // Fund from the founder seed (actor 1).
    node.send_from(secret_for(1), 500, ms.address.clone())
        .unwrap();
    assert_eq!(node.balance_of_address(ms.address.clone()).unwrap(), "500");

    // Build spend to actor 9.
    let unsigned_blob = node
        .build_multisig_spend(
            ms.address.clone(),
            vec![MultisigSpendOutput {
                value: 400,
                address: kovanica_node::Node::address(9).to_hex(),
                asset_id_hex: None,
            }],
        )
        .unwrap();

    // Partial signatures from two cosigners.
    let sig1 = node
        .sign_multisig_partial(unsigned_blob.clone(), secret_for(1))
        .unwrap();
    let sig2 = node
        .sign_multisig_partial(unsigned_blob.clone(), secret_for(2))
        .unwrap();

    // Combine and submit.
    let signed_blob = node
        .combine_multisig_sigs(unsigned_blob, vec![sig1, sig2])
        .unwrap();
    let tx_id = node.submit_multisig_tx(signed_blob).unwrap();
    assert_eq!(hex::decode(&tx_id).unwrap().len(), 32);

    node.produce_block().unwrap().expect("mines the spend");
    assert_eq!(node.balance_of_seed(9).unwrap(), "400");
    assert_eq!(node.balance_of_address(ms.address).unwrap(), "99"); // 500 - 400 - fee(1)
}

#[test]
fn ffi_multisig_rejects_bad_threshold() {
    let node = fresh();
    // Threshold (2) exceeds key count (1).
    let err = node
        .create_multisig_address(2, vec![pubkey_hex(1)])
        .unwrap_err();
    assert!(
        err.to_string().contains("threshold") || err.to_string().contains("M"),
        "{err}"
    );
}

#[test]
fn ffi_multisig_rejects_bad_pubkey_hex() {
    let node = fresh();
    let err = node
        .create_multisig_address(1, vec!["nothex".to_string()])
        .unwrap_err();
    assert!(
        err.to_string().contains("hex") || err.to_string().contains("pubkey"),
        "{err}"
    );
}

#[test]
fn ffi_combine_rejects_duplicate_signatures() {
    let node = fresh();
    let ms = node
        .create_multisig_address(2, vec![pubkey_hex(1), pubkey_hex(2), pubkey_hex(3)])
        .unwrap();
    node.send_from(secret_for(1), 500, ms.address.clone())
        .unwrap();

    let unsigned = node
        .build_multisig_spend(
            ms.address,
            vec![MultisigSpendOutput {
                value: 400,
                address: kovanica_node::Node::address(9).to_hex(),
                asset_id_hex: None,
            }],
        )
        .unwrap();
    let sig1 = node
        .sign_multisig_partial(unsigned.clone(), secret_for(1))
        .unwrap();

    let err = node
        .combine_multisig_sigs(unsigned, vec![sig1.clone(), sig1])
        .unwrap_err();
    assert!(
        err.to_string().contains("multisig") || err.to_string().contains("duplicate"),
        "{err}"
    );
}
