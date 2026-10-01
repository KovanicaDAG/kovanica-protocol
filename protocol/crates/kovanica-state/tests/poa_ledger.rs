//! Ledger-level Proof-of-Authority wiring (RFC-POA M3).
//!
//! M3 exit criteria at the state layer: the genesis coinbase tag commits to
//! the authority set (`KVA1 || set_hash`), `Ledger::set_poa` enables PoA
//! admission (the only admission regime — no hybrid counterpart remains), and
//! PoA blocks are admitted through the identity-preserving insert path
//! (`insert_prepared_block` keeps the authority signature; the template `insert`
//! path cannot carry one).

use ed25519_dalek::{Signer, SigningKey};
use kovanica_dag::{AuthorityPublicKey, AuthoritySet, Block, BlockId};
use kovanica_state::{
    encode_block_payload, parse_poa_genesis_tag, poa_genesis_tag, HalvingSchedule, KeyPair, Ledger,
    Transaction, TxOutput, ATOM,
};

/// Slot duration used throughout (RFC-POA default).
const SLOT_MS: u64 = 3000;

fn keypair(seed: u8) -> (SigningKey, AuthorityPublicKey) {
    let sk = SigningKey::from_bytes(&[seed; 32]);
    let pk = sk.verifying_key();
    (sk, pk)
}

fn authority_set(n: u8, threshold: usize) -> (AuthoritySet, Vec<SigningKey>) {
    let mut keys = Vec::new();
    let mut sks = Vec::new();
    for i in 1..=n {
        let (sk, pk) = keypair(i);
        keys.push(pk);
        sks.push(sk);
    }
    (AuthoritySet::new(keys, threshold).unwrap(), sks)
}

/// A signing key that is **not** the authority scheduled for `slot` — the
/// adversarial "wrong producer" case. Resolved by public key so the choice
/// does not depend on the set's canonical ordering.
fn sk_not_for_slot(set: &AuthoritySet, sks: &[SigningKey], slot: u64) -> SigningKey {
    let scheduled = set.active_authority(slot);
    sks.iter()
        .find(|sk| sk.verifying_key() != *scheduled)
        .expect("set has at least one non-scheduled authority")
        .clone()
}

/// A ledger seeded with a simple genesis coinbase and PoA admission enabled.
fn poa_ledger(n: u8, threshold: usize) -> (Ledger, AuthoritySet, Vec<SigningKey>) {
    let (set, sks) = authority_set(n, threshold);
    let founder = KeyPair::from_u64(1).address();
    let coinbase = Transaction::coinbase(
        vec![TxOutput::native(200_000 * ATOM, founder)],
        poa_genesis_tag(&set.hash()),
    );
    let mut ledger = Ledger::new(3, HalvingSchedule::new(10 * ATOM, 2_000_000), &[coinbase])
        .expect("genesis coinbase valid");
    ledger.set_poa(set.clone(), SLOT_MS);
    (ledger, set, sks)
}

/// Build a PoA block for `slot` signed by the scheduled authority. The payload
/// is a valid encoding of an empty transaction list.
fn poa_block(parents: Vec<BlockId>, slot: u64, set: &AuthoritySet, sks: &[SigningKey]) -> Block {
    let timestamp_ms = slot * SLOT_MS;
    let authority = set.active_authority(slot);
    let sk = sks
        .iter()
        .find(|sk| sk.verifying_key() == *authority)
        .expect("scheduled authority's signing key present");
    let payload = encode_block_payload(&[]);
    let unsigned = Block::new(parents.clone(), 1, timestamp_ms, 0, payload.clone());
    let sig = sk
        .sign(unsigned.hash_without_authority_sig().as_bytes())
        .to_bytes();
    Block::new_with_authority(parents, 1, timestamp_ms, 0, sig, payload)
}

// ---------------------------------------------------------------------------
// Genesis tag commitment
// ---------------------------------------------------------------------------

#[test]
fn poa_genesis_tag_roundtrip() {
    let set = authority_set(3, 2).0;
    let tag = poa_genesis_tag(&set.hash());
    assert!(tag.starts_with(b"KVA1"), "tag carries the KVA1 prefix");
    assert_eq!(tag.len(), 4 + 32, "KVA1 || 32-byte set hash");
    assert_eq!(parse_poa_genesis_tag(&tag), Some(set.hash()));

    // Malformed tags parse to None.
    assert_eq!(parse_poa_genesis_tag(b"KVA1"), None);
    assert_eq!(parse_poa_genesis_tag(b"KVA1short"), None);
    assert_eq!(parse_poa_genesis_tag(b"KVX1"), None);
    assert_eq!(parse_poa_genesis_tag(b"genesis-rfc006"), None);
}

#[test]
fn genesis_coinbase_tag_commits_to_authority_set() {
    let (ledger, set, _sks) = poa_ledger(3, 2);
    let genesis_id = ledger.genesis();
    let genesis = ledger
        .dag()
        .block(&genesis_id)
        .expect("genesis block present");
    let txs = kovanica_state::decode_block_payload(genesis.payload()).expect("payload decodes");
    let coinbase = txs
        .iter()
        .find(|tx| tx.inputs().is_empty())
        .expect("genesis coinbase present");
    assert_eq!(
        parse_poa_genesis_tag(coinbase.tag()),
        Some(set.hash()),
        "genesis coinbase tag commits to the authority set"
    );
}

// ---------------------------------------------------------------------------
// set_poa wiring
// ---------------------------------------------------------------------------

#[test]
fn set_poa_enables_admission() {
    let founder = KeyPair::from_u64(1).address();
    let coinbase = Transaction::coinbase(
        vec![TxOutput::native(200_000 * ATOM, founder)],
        b"genesis".to_vec(),
    );
    let mut ledger =
        Ledger::new(3, HalvingSchedule::new(10 * ATOM, 2_000_000), &[coinbase]).unwrap();
    assert!(!ledger.poa_enabled(), "PoA is off until set_poa");
    assert!(ledger.poa_config().is_none());

    let (set, _sks) = authority_set(3, 2);
    ledger.set_poa(set.clone(), SLOT_MS);
    assert!(ledger.poa_enabled());
    assert_eq!(ledger.poa_config().unwrap().authority_set, set);
    assert_eq!(ledger.poa_config().unwrap().slot_duration_ms, SLOT_MS);
}

// ---------------------------------------------------------------------------
// PoA block admission through the ledger
// ---------------------------------------------------------------------------

#[test]
fn poa_blocks_admitted_through_ledger() {
    let (mut ledger, set, sks) = poa_ledger(3, 2);
    let g = ledger.genesis();

    // Slots 0,1,2 → authorities 0,1,2; slot 3 wraps to authority 0.
    let mut parent = g;
    for slot in 0..6u64 {
        let block = poa_block(vec![parent], slot, &set, &sks);
        let txs = kovanica_state::decode_block_payload(block.payload()).unwrap();
        let id = ledger
            .insert_prepared_block(block, &txs)
            .expect("scheduled authority admitted");
        parent = id;
    }
    assert_eq!(ledger.dag().len(), 7, "genesis + 6 round-robin blocks");
}

#[test]
fn wrong_authority_rejected_by_ledger() {
    let (mut ledger, set, sks) = poa_ledger(3, 2);
    let g = ledger.genesis();

    // Slot 0 must be signed by its scheduled authority; sign with any other
    // authority in the set instead.
    let timestamp_ms = 0;
    let sk = &sk_not_for_slot(&set, &sks, 0);
    let payload = encode_block_payload(&[]);
    let unsigned = Block::new(vec![g], 1, timestamp_ms, 0, payload.clone());
    let sig = sk
        .sign(unsigned.hash_without_authority_sig().as_bytes())
        .to_bytes();
    let block = Block::new_with_authority(vec![g], 1, timestamp_ms, 0, sig, payload);
    let txs = kovanica_state::decode_block_payload(block.payload()).unwrap();
    let err = ledger
        .insert_prepared_block(block, &txs)
        .expect_err("wrong authority must be rejected");
    assert!(
        format!("{err:?}").contains("InvalidAuthoritySignature"),
        "rejection surfaces the PoA signature error, got {err:?}"
    );
}

#[test]
fn unsigned_block_rejected_by_ledger() {
    let (mut ledger, _set, _sks) = poa_ledger(3, 2);
    let g = ledger.genesis();

    // The template `insert` path builds a block without an authority signature.
    let err = ledger
        .insert(vec![g], 1, 0, 0, &[])
        .expect_err("unsigned block must be rejected under PoA");
    assert!(
        format!("{err:?}").contains("InvalidAuthoritySignature"),
        "rejection surfaces the PoA signature error, got {err:?}"
    );
}
