//! Canonical encoding / sighash / address vectors — shared with the client SDK.
//!
//! The constants below are the *lock* between `kovanica-state` and the
//! `kovanica-sdk` (monorepo `sdk/`). If the wire format ever changes, BOTH
//! sides must change together: the SDK test asserts the same constants
//! (`sdk/crates/kovanica-types/tests/sighash_vector.rs`).

use kovanica_state::keys::Address;
use kovanica_state::tx::{AssetId, OutPoint, StealthExt, Transaction, TxId, TxInput, TxOutput};

/// BLAKE3(witness-free encode) of the fixture transaction.
const SIGHASH_HEX: &str = "a2a1549b30f77f8e808eb422a958c80211caad55b991d5697c8f249b47edef7d";
/// Full canonical encode (with witness vectors) of the fixture transaction.
const ENCODE_HEX: &str = "020000000000000011111111111111111111111111111111111111111111111111111111111111110000000000000000000000002222222222222222222222222222222222222222222222222222222222222222010000000000000000000000020000000000000000ca9a3b00000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaf40100000000000001eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb00000000000000000600000000000000766563746f72";
/// `kvnc` + base58(versioned 33B) + `dag` for alice (00 ‖ AA×32).
const ALICE_KVNC: &str = "kvnc1CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqBdag";
/// `kvnc…dag` for bob (00 ‖ BB×32).
const BOB_KVNC: &str = "kvnc1DdqGmK5uamYN5vmuZrzpQhKeehLdwtPLVJdhu5P2iJKCdag";
/// `kvnc` + base58(bare 32B pubkey AB×32) + `dag` — legacy form → P2PK.
const LEGACY32_KVNC: &str = "kvncCZ8YUVdk7znjrUmnb5n7kgySk9yRAsQDYmyCxzfSky9tdag";
/// Stealth fixture: sighash over a v0x03 output with one-time key material.
const STEALTH_SIGHASH_HEX: &str =
    "6b55aacfe093b09251c1cafd548f4b4c3b069f4ccadec5742d4f1feb7a210d97";
/// Stealth fixture: full encode with lock time 1000 + sequence 7.
const STEALTH_ENCODE_HEX: &str = "0100000000000000333333333333333333333333333333333333333333333333333333333333333302000000000000000000000002000000000000000903000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa7b0000000000000000015a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a425c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c035d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5de8030000070000000700000000000000737465616c7468";

fn fixture() -> Transaction {
    let txid0 = TxId::from_bytes([0x11u8; 32]);
    let txid1 = TxId::from_bytes([0x22u8; 32]);

    let mut alice_raw = [0u8; 33];
    alice_raw[0] = 0x00;
    alice_raw[1..].copy_from_slice(&[0xAAu8; 32]);
    let alice = Address::from_versioned_bytes(alice_raw);

    let mut bob_raw = [0u8; 33];
    bob_raw[0] = 0x00;
    bob_raw[1..].copy_from_slice(&[0xBBu8; 32]);
    let bob = Address::from_versioned_bytes(bob_raw);

    let asset = AssetId::from_bytes([0xEEu8; 32]);

    Transaction::new(
        vec![
            TxInput::new(OutPoint::new(txid0, 0), Vec::new()),
            TxInput::new(OutPoint::new(txid1, 1), Vec::new()),
        ],
        vec![
            TxOutput::native(1_000_000_000, alice),
            TxOutput::new(500, Some(asset), bob),
        ],
        b"vector".to_vec(),
    )
}

fn fixture_stealth() -> Transaction {
    let txid = TxId::from_bytes([0x33u8; 32]);

    let mut stealth_owner = [0u8; 33];
    stealth_owner[0] = 0x03;
    stealth_owner[1..].copy_from_slice(&[0x5Du8; 32]);
    let owner = Address::from_versioned_bytes(stealth_owner);

    let mut alice_raw = [0u8; 33];
    alice_raw[0] = 0x00;
    alice_raw[1..].copy_from_slice(&[0xAAu8; 32]);
    let alice = Address::from_versioned_bytes(alice_raw);

    let ext = StealthExt {
        r: [0x5Au8; 32],
        view_tag: 0x42,
        p: [0x5Cu8; 32],
    };

    Transaction::new_with_lock(
        vec![TxInput::new(OutPoint::new(txid, 2), Vec::new())],
        vec![
            TxOutput::native(777, alice),
            TxOutput::stealth(123, owner, ext),
        ],
        b"stealth".to_vec(),
        1000,
        7,
    )
}

#[test]
fn node_sighash_vector() {
    let sighash = fixture().sighash();
    assert_eq!(hex::encode(sighash), SIGHASH_HEX);
}

#[test]
fn node_encode_vector() {
    assert_eq!(hex::encode(fixture().encode()), ENCODE_HEX);
}

#[test]
fn node_sighash_ignores_witness() {
    let tx = fixture();
    let mut with_sigs = tx.clone();
    with_sigs.inputs_mut().iter_mut().for_each(|input| {
        *input = TxInput::single_sig(input.outpoint, [0x77u8; 64]);
    });
    // Identity in sighash space: witness never participates.
    assert_eq!(with_sigs.sighash(), tx.sighash());
}

#[test]
fn node_stealth_vectors() {
    let tx = fixture_stealth();
    assert_eq!(hex::encode(tx.sighash()), STEALTH_SIGHASH_HEX);
    assert_eq!(hex::encode(tx.encode()), STEALTH_ENCODE_HEX);
}

#[test]
fn node_address_kvnc_vectors() {
    let mut alice_raw = [0u8; 33];
    alice_raw[0] = 0x00;
    alice_raw[1..].copy_from_slice(&[0xAAu8; 32]);
    let alice = Address::from_versioned_bytes(alice_raw);
    assert_eq!(alice.to_kvnc(), ALICE_KVNC);
    assert_eq!(Address::parse(ALICE_KVNC).unwrap(), alice);

    let mut bob_raw = [0u8; 33];
    bob_raw[0] = 0x00;
    bob_raw[1..].copy_from_slice(&[0xBBu8; 32]);
    let bob = Address::from_versioned_bytes(bob_raw);
    assert_eq!(bob.to_kvnc(), BOB_KVNC);
    assert_eq!(Address::parse(BOB_KVNC).unwrap(), bob);
}

#[test]
fn node_legacy_kvnc32_parses_as_p2pk() {
    // 44 base58 chars decode to 32 bytes → version 0x00 P2PK.
    assert_eq!(
        Address::parse(LEGACY32_KVNC).unwrap(),
        Address::p2pk([0xABu8; 32])
    );
}
