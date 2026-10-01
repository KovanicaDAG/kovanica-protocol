//! Parity vectors shared with the node — the *lock* between SDK and consensus.
//!
//! Same constants as `protocol/crates/kovanica-state/tests/sighash_vector.rs`.
//! If either side drifts from `kovanica-state::tx::encode_into`, one of the two
//! suites fails loudly.

use kovanica_types::{
    Address, AssetId, DecodeError, Hash32, NetworkId, StealthExt, Transaction, TxInput, TxOutput,
    ADDR_VERSION_STEALTH,
};

/// BLAKE3(witness-free encode) of the fixture transaction (node-verified).
const SIGHASH_HEX: &str = "a2a1549b30f77f8e808eb422a958c80211caad55b991d5697c8f249b47edef7d";
/// Full canonical encode (with witness vectors) of the fixture (node-verified).
const ENCODE_HEX: &str = "020000000000000011111111111111111111111111111111111111111111111111111111111111110000000000000000000000002222222222222222222222222222222222222222222222222222222222222222010000000000000000000000020000000000000000ca9a3b00000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaf40100000000000001eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb00000000000000000600000000000000766563746f72";
/// Stealth fixture: sighash over a v0x03 output with one-time key material.
const STEALTH_SIGHASH_HEX: &str =
    "6b55aacfe093b09251c1cafd548f4b4c3b069f4ccadec5742d4f1feb7a210d97";
/// Stealth fixture: full encode with lock time 1000 + sequence 7.
const STEALTH_ENCODE_HEX: &str = "0100000000000000333333333333333333333333333333333333333333333333333333333333333302000000000000000000000002000000000000000903000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa7b0000000000000000015a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a425c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c035d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5de8030000070000000700000000000000737465616c7468";

fn address(version: u8, payload: [u8; 32]) -> Address {
    let mut raw = [0u8; 33];
    raw[0] = version;
    raw[1..].copy_from_slice(&payload);
    Address::from_versioned(raw)
}

fn alice() -> Address {
    address(0x00, [0xAAu8; 32])
}

fn bob() -> Address {
    address(0x00, [0xBBu8; 32])
}

fn fixture() -> Transaction {
    Transaction::new(
        NetworkId::Testnet,
        vec![
            TxInput::fresh(Hash32([0x11u8; 32]), 0),
            TxInput::fresh(Hash32([0x22u8; 32]), 1),
        ],
        vec![
            TxOutput::native(1_000_000_000, alice()),
            TxOutput::new(500, Some(AssetId(Hash32([0xEEu8; 32]))), bob()),
        ],
        b"vector".to_vec(),
    )
}

fn fixture_stealth() -> Transaction {
    let stealth_owner = address(ADDR_VERSION_STEALTH, [0x5Du8; 32]);
    let ext = StealthExt {
        r: [0x5Au8; 32],
        view_tag: 0x42,
        p: [0x5Cu8; 32],
    };
    let mut tx = Transaction::new(
        NetworkId::Testnet,
        vec![TxInput::fresh(Hash32([0x33u8; 32]), 2)],
        vec![
            TxOutput::native(777, alice()),
            TxOutput::with_stealth(123, None, stealth_owner, ext),
        ],
        b"stealth".to_vec(),
    );
    tx.n_lock_time = 1000;
    tx.sequence = 7;
    tx
}

#[test]
fn sdk_sighash_matches_node_vector() {
    assert_eq!(fixture().sighash_hex(), SIGHASH_HEX);
}

#[test]
fn sdk_encode_matches_node_vector() {
    assert_eq!(fixture().encode_hex(), ENCODE_HEX);
}

#[test]
fn sdk_sighash_ignores_witness() {
    let mut tx = fixture();
    tx.inputs = tx
        .inputs
        .iter()
        .map(|i| TxInput::single_sig(i.prev_tx, i.prev_vout, [0x77u8; 64]))
        .collect();
    assert_eq!(tx.sighash(), fixture().sighash());
}

#[test]
fn sdk_stealth_matches_node_vectors() {
    let tx = fixture_stealth();
    assert_eq!(tx.sighash_hex(), STEALTH_SIGHASH_HEX);
    assert_eq!(tx.encode_hex(), STEALTH_ENCODE_HEX);
}

#[test]
fn sdk_field_ordering_is_wire_frozen() {
    // Spot-check bytes so a future accidental reorder of fixture fields is caught
    // even before comparing to the node constant: input count then tx hash…
    let tx = fixture();
    let enc = tx.encode_sans_witness();
    assert_eq!(&enc[0..8], &2u64.to_le_bytes());
    assert_eq!(&enc[8..40], &[0x11u8; 32]);
    assert_eq!(&enc[40..44], &0u32.to_le_bytes());
    // …then second input tx hash, output count, first value…
    assert_eq!(&enc[44..76], &[0x22u8; 32]);
    assert_eq!(&enc[76..80], &1u32.to_le_bytes());
    assert_eq!(&enc[80..88], &2u64.to_le_bytes());
    assert_eq!(&enc[88..96], &1_000_000_000u64.to_le_bytes());
}

#[test]
fn sdk_decode_roundtrips_fixture() {
    let tx = fixture();
    let decoded = Transaction::decode(&tx.encode(), NetworkId::Testnet).unwrap();
    // Network label is client-side; everything else must survive byte-for-byte.
    assert_eq!(decoded.network, NetworkId::Testnet);
    assert_eq!(decoded.inputs, tx.inputs);
    assert_eq!(decoded.outputs, tx.outputs);
    assert_eq!(decoded.tag, tx.tag);
    assert_eq!(decoded.n_lock_time, tx.n_lock_time);
    assert_eq!(decoded.sequence, tx.sequence);
    // Re-encoding the decoded form must be byte-identical.
    assert_eq!(decoded.encode(), tx.encode());
    assert_eq!(decoded.sighash(), tx.sighash());
}

#[test]
fn sdk_decode_roundtrips_stealth_fixture() {
    let tx = fixture_stealth();
    let decoded = Transaction::decode(&tx.encode(), NetworkId::Testnet).unwrap();
    assert_eq!(decoded, tx);
    assert_eq!(decoded.encode(), tx.encode());
}

#[test]
fn sdk_decode_rejects_trailing_and_truncated() {
    let tx = fixture();
    let enc = tx.encode();
    // Trailing garbage byte.
    let mut with_trailing = enc.clone();
    with_trailing.push(0x00);
    assert_eq!(
        Transaction::decode(&with_trailing, NetworkId::Testnet).unwrap_err(),
        DecodeError::TrailingBytes
    );
    // Truncation anywhere must be UnexpectedEof, never a panic.
    for cut in [0, 1, 8, 43, 44, 100, enc.len() - 1] {
        let err = Transaction::decode(&enc[..cut], NetworkId::Testnet).unwrap_err();
        assert_eq!(err, DecodeError::UnexpectedEof);
    }
}

#[test]
fn sdk_decode_rejects_giant_counts() {
    // A count prefix claiming 2^40 inputs must be rejected without allocation.
    let mut enc = 1_099_511_627_776u64.to_le_bytes().to_vec(); // 2^40 inputs
    enc.extend_from_slice(&[0u8; 64]);
    assert_eq!(
        Transaction::decode(&enc, NetworkId::Testnet).unwrap_err(),
        DecodeError::UnexpectedEof
    );
}
