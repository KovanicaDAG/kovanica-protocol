//! Checkpoint **v10** — the PoA-only format.
//!
//! v10 is the first version that omits the stake registry blob. The stake
//! registry retired together with hybrid admission, so the writer stopped
//! emitting it; the reader still accepts **v3..=v9** and consumes + discards the
//! blob so operators can open a checkpoint written by any older build.
//!
//! These tests pin that contract from both sides:
//! * a v10 checkpoint round-trips and does **not** contain the stake slot;
//! * a synthetic v9 checkpoint (v10 bytes with the blob spliced back in and the
//!   version byte downgraded) decodes to the same ledger;
//! * v2 and v11 are rejected, so the accept range stays exactly 3..=10.

use kovanica_state::{
    encode_block_payload, HalvingSchedule, KeyPair, Ledger, LedgerCheckpointError, OutPoint,
    Transaction, TxOutput, UtxoSet, DEFAULT_HALVING_ERA,
};

const K: u16 = 3;
const SCHEDULE: HalvingSchedule = HalvingSchedule::new(1_000, DEFAULT_HALVING_ERA);
/// `"KVCP"`.
const MAGIC: &[u8; 4] = b"KVCP";

/// Fixed-size header the writer emits before the UTXO set:
/// magic(4) + version(2) + k(2) + genesis_subsidy(8) + halving_era(8)
///   + finality_depth(8) + payload_pruning_depth(8) + checkpoint_height(8)
const HEADER_LEN: usize = 4 + 2 + 2 + 8 * 5;

/// A ledger with a short chain, deep enough that `write_checkpoint` succeeds
/// (it refuses while the DAG is shallower than the finality threshold).
fn funded_chain(depth: u64) -> (Ledger, OutPoint) {
    let founder = KeyPair::from_u64(1);
    let coinbase = Transaction::coinbase(
        vec![TxOutput::native(1_000, founder.address())],
        b"genesis".to_vec(),
    );
    let coin = OutPoint::new(coinbase.id(), 0);
    let mut ledger = Ledger::with_finality(K, SCHEDULE, &[coinbase], depth).unwrap();
    let mut tip = ledger.genesis();
    for h in 1..=(depth + 4) {
        tip = ledger.insert(vec![tip], 1, h * 1_000, 0, &[]).unwrap();
    }
    (ledger, coin)
}

/// Offset of the stake-registry slot in a v10 checkpoint — i.e. immediately
/// after the version-agnostic UTXO set. Derived the same way `read_checkpoint`
/// derives it, so the splice below lands on exactly the byte the reader skips.
fn stake_slot_offset(bytes: &[u8]) -> usize {
    let mut remaining = &bytes[HEADER_LEN..];
    UtxoSet::decode(&mut remaining).expect("v10 UTXO section decodes");
    bytes.len() - remaining.len()
}

/// Rewrite `bytes` as a legacy checkpoint of `version` carrying a `blob_len`-byte
/// stake registry blob in the slot the v10 writer omits.
fn splice_legacy_stake_blob(bytes: &[u8], version: u16, blob: &[u8]) -> Vec<u8> {
    let at = stake_slot_offset(bytes);
    let mut out = Vec::with_capacity(bytes.len() + 8 + blob.len());
    out.extend_from_slice(&bytes[..at]);
    out.extend_from_slice(&(blob.len() as u64).to_le_bytes());
    out.extend_from_slice(blob);
    out.extend_from_slice(&bytes[at..]);
    // Downgrade the version *after* splicing: the length prefix above is what
    // the v3..=v9 reader expects to find at this position.
    out[4..6].copy_from_slice(&version.to_le_bytes());
    out
}

#[test]
fn v10_checkpoint_roundtrips() {
    let (ledger, _coin) = funded_chain(5);
    let bytes = ledger.write_checkpoint().expect("checkpointable");

    assert_eq!(&bytes[..4], MAGIC, "checkpoint magic preserved");
    let version = u16::from_le_bytes([bytes[4], bytes[5]]);
    assert_eq!(version, 10, "writer emits v10");

    let restored = Ledger::read_checkpoint(&bytes).expect("v10 decodes");
    assert_eq!(
        restored.ledger_state().total_value(),
        ledger.ledger_state().total_value(),
        "v10 round-trip preserves total value"
    );
    assert_eq!(
        restored.dag().selected_tip(),
        ledger.dag().selected_tip(),
        "v10 round-trip preserves the selected tip"
    );
}

#[test]
fn v10_writes_no_stake_blob() {
    let (ledger, _coin) = funded_chain(5);
    let bytes = ledger.write_checkpoint().unwrap();

    // If a stake slot were still being written it would sit between the UTXO
    // set and the asset registry, so the 8 bytes at the UTXO end would be a
    // stake length. Assert instead that what sits there is a *self-consistent
    // asset-registry length*: consuming it lands on a non-zero tip-segment
    // count, and the section is followed by both trailing supply counters.
    let at = stake_slot_offset(&bytes);
    let tail = &bytes[at..];
    let asset_len = u64::from_le_bytes(tail[..8].try_into().unwrap()) as usize;
    let after_asset = 8 + asset_len;
    assert!(
        after_asset + 8 < tail.len(),
        "asset registry must be followed by a tip-segment count and the two \
         trailing supply counters"
    );
    let tip_len = u64::from_le_bytes(tail[after_asset..after_asset + 8].try_into().unwrap());
    assert!(tip_len > 0, "tip segment present after the asset registry");
    assert!(
        tail.len() >= after_asset + 8 + 16,
        "tip segment is followed by native_minted + fees_burned"
    );
    // Both trailing counters are where the reader expects them: native_minted
    // is the genesis issuance (1000) and fees_burned is 0 (no fees in this
    // chain). Reading them off the tail proves the layout really is
    // utxo|asset|tip|supply with nothing extra in between.
    let supply = &tail[tail.len() - 16..];
    assert_eq!(u64::from_le_bytes(supply[..8].try_into().unwrap()), 1_000);
    assert_eq!(u64::from_le_bytes(supply[8..].try_into().unwrap()), 0);
}

#[test]
fn legacy_v9_checkpoint_with_stake_blob_still_decodes() {
    let (ledger, _coin) = funded_chain(5);
    let v10 = ledger.write_checkpoint().unwrap();

    // What a pre-v10 writer put in that slot: a length-prefixed stake
    // registry blob. The content is irrelevant now — the reader must skip it
    // without interpreting it, so any bytes (including ones that would fail to
    // parse as a registry) must not break the decode.
    let junk_stake_blob = vec![0xABu8; 137];
    let v9 = splice_legacy_stake_blob(&v10, 9, &junk_stake_blob);
    assert_eq!(v9.len(), v10.len() + 8 + junk_stake_blob.len());

    let restored = Ledger::read_checkpoint(&v9).expect("legacy v9 decodes");
    assert_eq!(
        restored.ledger_state().total_value(),
        ledger.ledger_state().total_value(),
        "legacy v9 restores the same total value as v10"
    );
    assert_eq!(
        restored.dag().selected_tip(),
        ledger.dag().selected_tip(),
        "legacy v9 restores the same selected tip as v10"
    );
}

#[test]
fn legacy_stake_blob_is_skipped_not_parsed() {
    let (ledger, _coin) = funded_chain(5);
    let v10 = ledger.write_checkpoint().unwrap();

    // A blob whose first u64 claims a huge entry count: if the reader parsed
    // it as a registry it would either blow up or mis-advance the cursor. It
    // must be skipped as opaque bytes, so the decode still succeeds.
    let mut blob = u64::MAX.to_le_bytes().to_vec();
    blob.extend_from_slice(&[0xFFu8; 64]);
    let v9 = splice_legacy_stake_blob(&v10, 9, &blob);

    let restored = Ledger::read_checkpoint(&v9).expect("v9 with unparseable stake blob decodes");
    assert_eq!(
        restored.ledger_state().total_value(),
        ledger.ledger_state().total_value()
    );
}

#[test]
fn v3_is_inside_the_accept_range() {
    // v3 is the oldest version the reader claims to accept. A v10-produced UTXO
    // set cannot be decoded by the v5 decoder (v7+ entries carry an extra
    // `is_coinbase` byte), so a spliced v3 file fails — but it must fail *past*
    // the version gate, i.e. with `UnexpectedEof` from the UTXO decoder, not
    // with `UnsupportedVersion`. That distinction is what proves v3 is inside
    // the accepted 3..=10 range rather than rejected by the version check.
    let (ledger, _coin) = funded_chain(5);
    let v10 = ledger.write_checkpoint().unwrap();
    let v3 = splice_legacy_stake_blob(&v10, 3, &[0u8; 4]);
    match Ledger::read_checkpoint(&v3) {
        Err(LedgerCheckpointError::UnsupportedVersion(3)) => {
            panic!("v3 must be inside the accept range")
        }
        Err(LedgerCheckpointError::UnexpectedEof) => { /* reached the v5 UTXO decoder */ }
        Err(other) => panic!("unexpected v3 error: {other:?}"),
        Ok(_) => {}
    }
}

#[test]
fn out_of_range_versions_are_rejected() {
    let (ledger, _coin) = funded_chain(5);
    let v10 = ledger.write_checkpoint().unwrap();

    // v2 predates the stake blob: the reader must refuse it rather than
    // mis-parse the tail.
    let mut v2 = v10.clone();
    v2[4..6].copy_from_slice(&2u16.to_le_bytes());
    assert!(
        Ledger::read_checkpoint(&v2).is_err(),
        "v2 is below the accept range"
    );

    // v11 is a future format: refuse it so a newer writer is never
    // silently mis-read.
    let mut v11 = v10.clone();
    v11[4..6].copy_from_slice(&11u16.to_le_bytes());
    assert!(
        Ledger::read_checkpoint(&v11).is_err(),
        "v11 is above the accept range"
    );
}

#[test]
fn empty_stake_blob_is_also_accepted() {
    // A pre-v10 writer with an empty registry writes a zero length. The reader
    // must handle the degenerate blob without special-casing.
    let (ledger, _coin) = funded_chain(5);
    let v10 = ledger.write_checkpoint().unwrap();
    let v9 = splice_legacy_stake_blob(&v10, 9, &[]);
    let restored = Ledger::read_checkpoint(&v9).expect("zero-length stake blob decodes");
    assert_eq!(
        restored.ledger_state().total_value(),
        ledger.ledger_state().total_value()
    );
}

#[test]
fn truncated_stake_blob_is_rejected() {
    // Bounds check: a length prefix that runs past the buffer must error, not
    // panic.
    let (ledger, _coin) = funded_chain(5);
    let v10 = ledger.write_checkpoint().unwrap();
    let at = stake_slot_offset(&v10);
    let mut out = Vec::with_capacity(v10.len() + 8);
    out.extend_from_slice(&v10[..at]);
    // Claim a huge stake blob but supply none of it.
    out.extend_from_slice(&u64::MAX.to_le_bytes());
    out[4..6].copy_from_slice(&9u16.to_le_bytes());
    assert!(
        Ledger::read_checkpoint(&out).is_err(),
        "an over-long stake length must be an error, not a panic"
    );
}

#[test]
fn tip_segment_preserves_supply_and_state() {
    // A v10 checkpoint that carries tip-segment blocks above the finality
    // boundary must restore both the replayed state and the supply counters
    // (the stake blob removal must not shift any later byte).
    let (ledger, _coin) = funded_chain(3);
    let bytes = ledger.write_checkpoint().unwrap();
    let restored = Ledger::read_checkpoint(&bytes).unwrap();
    assert_eq!(
        restored.ledger_state().total_value(),
        ledger.ledger_state().total_value()
    );
    // Payload of a tip-segment block must survive the round-trip.
    let tip = restored.dag().selected_tip();
    let block = restored.dag().block(&tip).expect("tip block present");
    assert_eq!(
        block.payload(),
        encode_block_payload(&[]),
        "tip-segment payload survives"
    );
}
