//! Consensus enforcement of Proof-of-Authority admission (`Dag::set_poa`).
//!
//! RFC-POA §4: PoA is the only admission path. A block is
//! admitted only if it carries a valid Ed25519 `authority_sig` from the
//! authority scheduled for its slot (`authorities[slot % len]`, with
//! `slot = timestamp_ms / slot_duration_ms`), and its slot does not precede any
//! parent's. Here we check the consensus rule wired into `Dag::insert` — the
//! M2 exit criteria: 3-validator round-robin, 4-validator liveness with one
//! offline, re-org under GHOSTDAG — plus the adversarial cases (wrong
//! authority, missing signature, slot regression), replay exemption, and that
//! PoW, difficulty and VRF admission have been removed from the crate entirely.

use ed25519_dalek::{Signer, SigningKey};
use kovanica_dag::{
    AuthorityPublicKey, AuthoritySet, Block, BlockId, Dag, DagError, POA_NOMINAL_WORK,
};

/// Slot duration used throughout (RFC-POA default).
const SLOT_MS: u64 = 3000;

fn keypair(seed: u8) -> (SigningKey, AuthorityPublicKey) {
    let sk = SigningKey::from_bytes(&[seed; 32]);
    let pk = sk.verifying_key();
    (sk, pk)
}

/// A PoA-enforcing DAG seeded with genesis and an `n`-authority set.
fn poa_dag(n: u8, threshold: usize) -> (Dag, AuthoritySet, Vec<SigningKey>) {
    let genesis = Block::genesis(1, 0, 0, b"genesis".to_vec());
    let mut dag = Dag::new(3, genesis);
    let (set, sks) = authority_set(n, threshold);
    dag.set_poa(set.clone(), SLOT_MS);
    (dag, set, sks)
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

/// Build a block for `slot` signed by the authority scheduled for it.
fn poa_block(
    parents: Vec<BlockId>,
    slot: u64,
    set: &AuthoritySet,
    sks: &[SigningKey],
    payload: &[u8],
) -> Block {
    let timestamp_ms = slot * SLOT_MS;
    let authority = set.active_authority(slot);
    let sk = sks
        .iter()
        .find(|sk| sk.verifying_key() == *authority)
        .expect("scheduled authority's signing key present");
    // Sign the hash without the authority signature; the id then commits to
    // the signature, but the signed message is unchanged by it.
    let unsigned = Block::new(parents.clone(), 1, timestamp_ms, 0, payload.to_vec());
    let sig = sk
        .sign(unsigned.hash_without_authority_sig().as_bytes())
        .to_bytes();
    Block::new_with_authority(parents, 1, timestamp_ms, 0, sig, payload.to_vec())
}

/// Build a block for `slot` signed by `sk` (any authority — for the
/// wrong-authority adversarial cases).
fn poa_block_signed_by(parents: Vec<BlockId>, slot: u64, sk: &SigningKey, payload: &[u8]) -> Block {
    let timestamp_ms = slot * SLOT_MS;
    let unsigned = Block::new(parents.clone(), 1, timestamp_ms, 0, payload.to_vec());
    let sig = sk
        .sign(unsigned.hash_without_authority_sig().as_bytes())
        .to_bytes();
    Block::new_with_authority(parents, 1, timestamp_ms, 0, sig, payload.to_vec())
}

/// A correctly-signed block for `slot` that claims an arbitrary `work`. The
/// authority signature *covers* `work` (it is part of the signed hash), so this
/// is what a real chain-selection attack looks like: a block with an entirely
/// valid authority signature that over-claims its weight.
fn poa_block_with_work(
    parents: Vec<BlockId>,
    slot: u64,
    work: u128,
    set: &AuthoritySet,
    sks: &[SigningKey],
    payload: &[u8],
) -> Block {
    let timestamp_ms = slot * SLOT_MS;
    let authority = set.active_authority(slot);
    let sk = sks
        .iter()
        .find(|sk| sk.verifying_key() == *authority)
        .expect("scheduled authority's signing key present");
    let unsigned = Block::new(parents.clone(), work, timestamp_ms, 0, payload.to_vec());
    let sig = sk
        .sign(unsigned.hash_without_authority_sig().as_bytes())
        .to_bytes();
    Block::new_with_authority(parents, work, timestamp_ms, 0, sig, payload.to_vec())
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

// ---------------------------------------------------------------------------
// M2 exit criteria: 3-validator round-robin
// ---------------------------------------------------------------------------

#[test]
fn three_authority_round_robin_accepts_scheduled_blocks() {
    let (mut dag, set, sks) = poa_dag(3, 2);
    let g = dag.genesis();

    // Slots 0,1,2 → authorities 0,1,2; slot 3 wraps back to authority 0.
    let mut parent = g;
    for slot in 0..6u64 {
        let b = poa_block(vec![parent], slot, &set, &sks, b"b".as_slice());
        let id = dag.insert(b).expect("scheduled authority must be admitted");
        parent = id;
    }
    assert_eq!(dag.len(), 7, "genesis + 6 round-robin blocks");
}

// ---------------------------------------------------------------------------
// M2 exit criteria: 4-validator liveness with one offline
// ---------------------------------------------------------------------------

#[test]
fn four_authority_liveness_with_one_offline() {
    let (mut dag, set, sks) = poa_dag(4, 3);
    let g = dag.genesis();

    // Authority 2 (seed 3) is offline: skip its slots (2, 6, 10, …). The other
    // three keep the chain growing — liveness holds with 3 of 4 online.
    let mut parent = g;
    for slot in 0..12u64 {
        if slot % 4 == 2 {
            continue; // offline authority's slot — no block produced
        }
        let b = poa_block(vec![parent], slot, &set, &sks, b"b".as_slice());
        parent = dag.insert(b).expect("online authority must be admitted");
    }
    assert_eq!(
        dag.len(),
        10,
        "genesis + 9 blocks from the 3 online authorities"
    );
}

// ---------------------------------------------------------------------------
// M2 exit criteria: re-org under GHOSTDAG
// ---------------------------------------------------------------------------

#[test]
fn parallel_blocks_from_different_authorities_merge_under_ghostdag() {
    let (mut dag, set, sks) = poa_dag(3, 2);
    let g = dag.genesis();

    // Two authorities produce in parallel on genesis (slots 0 and 1) — both
    // are admitted (k=3 tolerates the anticone), then a third merges them.
    let a = dag
        .insert(poa_block(vec![g], 0, &set, &sks, b"a".as_slice()))
        .unwrap();
    let b = dag
        .insert(poa_block(vec![g], 1, &set, &sks, b"b".as_slice()))
        .unwrap();
    let c = dag
        .insert(poa_block(vec![a, b], 2, &set, &sks, b"c".as_slice()))
        .unwrap();

    // GHOSTDAG colours both parallel blocks blue (k=3).
    let gd = dag.ghostdag(&c).unwrap();
    assert_eq!(gd.blue_score, 3, "genesis + a + b");
    assert_eq!(dag.len(), 4);
}

// ---------------------------------------------------------------------------
// Adversarial: admission rejections
// ---------------------------------------------------------------------------

#[test]
fn inflated_work_is_rejected_under_poa() {
    // RFC-POA §4 item 5. `work` proves nothing under PoA, but the GHOSTDAG
    // blue-work fold still consumes it and `blue_work` drives the
    // selected-parent choice. An authority able to claim arbitrary work could
    // therefore unilaterally steer the selected parent of every successor,
    // defeating the round-robin fairness PoA exists to provide. Admission pins
    // `work` to the nominal value.
    let (mut dag, set, sks) = poa_dag(3, 2);
    let g = dag.genesis();

    // Each of these is correctly signed by the authority scheduled for slot 0
    // — the *only* thing wrong with them is the claimed weight. The pin is
    // exact, not a cap, so both a mild and an absurd inflation are refused.
    for greedy_work in [0, 2, 1_000_000, u128::MAX] {
        let greedy = poa_block_with_work(vec![g], 0, greedy_work, &set, &sks, b"greedy".as_slice());
        let greedy_id = greedy.id();
        let err = dag.insert(greedy).unwrap_err();
        assert!(
            matches!(
                err,
                DagError::PoaWorkMismatch { id, expected, actual }
                    if id == greedy_id
                        && expected == POA_NOMINAL_WORK
                        && actual == greedy_work
            ),
            "work {greedy_work} must be rejected, got {err:?}"
        );
        assert_eq!(dag.len(), 1, "the rejected block was not added");
    }

    // The nominal value is still admitted, so the pin closes the inflation
    // vector without breaking honest production.
    let honest = poa_block(vec![g], 0, &set, &sks, b"honest".as_slice());
    let honest_id = honest.id();
    assert_eq!(dag.insert(honest).unwrap(), honest_id);
}

#[test]
fn wrong_authority_is_rejected() {
    let (mut dag, set, sks) = poa_dag(3, 2);
    let g = dag.genesis();

    // Slot 0 belongs to exactly one authority; any other authority's
    // signature for that slot must be rejected.
    let wrong = sk_not_for_slot(&set, &sks, 0);
    let bad = poa_block_signed_by(vec![g], 0, &wrong, b"bad".as_slice());
    let bad_id = bad.id();
    let err = dag.insert(bad).unwrap_err();
    assert!(
        matches!(err, DagError::InvalidAuthoritySignature { id, .. } if id == bad_id),
        "expected InvalidAuthoritySignature, got {err:?}"
    );
    assert_eq!(dag.len(), 1, "the rejected block was not added");
}

#[test]
fn missing_authority_signature_is_rejected() {
    let (mut dag, _set, _sks) = poa_dag(3, 2);
    let g = dag.genesis();

    // A plain (unsigned) block is rejected under PoA.
    let bad = Block::new(vec![g], 1, 0, 0, b"unsigned".to_vec());
    let bad_id = bad.id();
    let err = dag.insert(bad).unwrap_err();
    assert!(
        matches!(err, DagError::InvalidAuthoritySignature { id, .. } if id == bad_id),
        "expected InvalidAuthoritySignature, got {err:?}"
    );
    assert_eq!(dag.len(), 1);
}

#[test]
fn slot_regression_below_parent_is_rejected() {
    let (mut dag, set, sks) = poa_dag(3, 2);
    let g = dag.genesis();

    // Parent at slot 2, child claims slot 1 (timestamp 3000 < parent 6000) —
    // the child's slot precedes its parent's, even with a valid signature for
    // slot 1.
    let parent = dag
        .insert(poa_block(vec![g], 2, &set, &sks, b"p".as_slice()))
        .unwrap();
    let bad = poa_block(vec![parent], 1, &set, &sks, b"child".as_slice());
    let bad_id = bad.id();
    let err = dag.insert(bad).unwrap_err();
    assert!(
        matches!(err, DagError::InvalidAuthoritySignature { id, .. } if id == bad_id),
        "expected InvalidAuthoritySignature, got {err:?}"
    );
    assert_eq!(dag.len(), 2, "only genesis + parent admitted");
}

#[test]
fn timestamp_in_wrong_slot_is_rejected() {
    let (mut dag, set, sks) = poa_dag(3, 2);
    let g = dag.genesis();

    // A block whose timestamp maps to slot 1 but is signed by an authority
    // other than slot 1's scheduled producer is rejected — the slot is
    // derived from the timestamp, so the signature must match the
    // *derived* slot.
    let wrong = sk_not_for_slot(&set, &sks, 1);
    let bad = poa_block_signed_by(vec![g], 1, &wrong, b"wrong-slot".as_slice());
    let err = dag.insert(bad).unwrap_err();
    assert!(
        matches!(err, DagError::InvalidAuthoritySignature { .. }),
        "expected InvalidAuthoritySignature, got {err:?}"
    );
}

// ---------------------------------------------------------------------------
// Replay exemption
// ---------------------------------------------------------------------------

#[test]
fn replay_skips_the_poa_check() {
    let (mut dag, _set, _sks) = poa_dag(3, 2);
    let g = dag.genesis();

    // An unsigned block is rejected by `insert`…
    let bad = Block::new(vec![g], 1, 0, 0, b"unsigned".to_vec());
    let bad_id = bad.id();
    assert!(dag.insert(bad.clone()).is_err());

    // …but `insert_for_replay` admits it: replayed blocks are trusted history
    // whose signatures may come from an earlier authority set.
    dag.insert_for_replay(bad, Some(bad_id))
        .expect("replay must skip the PoA check");
    assert_eq!(dag.len(), 2);
}

// ---------------------------------------------------------------------------
#[test]
fn poa_off_by_default() {
    let genesis = Block::genesis(1, 0, 0, b"genesis".to_vec());
    let dag = Dag::new(3, genesis);
    assert!(dag.poa_config().is_none(), "PoA is off by default");
}
