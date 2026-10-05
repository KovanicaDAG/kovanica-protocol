//! PoA Adversarial Tests — KVP-201 / RFC-POA §0.7.3
//!
//! Covers 6 attack vectors against the PoA admission mechanism.
//! All tests verify the on-chain admission rules in `kovanica-dag/src/authority.rs`.
//!
//! To run: `cargo test -p kovanica-node --test poa_adversarial`

use ed25519_dalek::{Signer, SigningKey};
use kovanica_dag::{
    sign_update, AuthorityError, AuthoritySet, AuthorityUpdateTx, Block, BlockId, Dag, DagError,
    POA_NOMINAL_WORK,
};

/// Slot duration used throughout (RFC-POA default).
const SLOT_MS: u64 = 3000;

/// Build a deterministic authority set for adversarial testing (3 authorities, threshold 2).
fn test_authority_set() -> (AuthoritySet, Vec<SigningKey>) {
    let mut keys = Vec::new();
    let mut sks = Vec::new();
    for i in 1..=3 {
        let sk = SigningKey::from_bytes(&[i as u8; 32]);
        let pk = sk.verifying_key();
        keys.push(pk);
        sks.push(sk);
    }
    (
        AuthoritySet::new(keys, 2).expect("valid test authority set"),
        sks,
    )
}

/// Build a PoA-enforcing DAG seeded with genesis and the test authority set.
fn test_dag() -> (Dag, AuthoritySet, Vec<SigningKey>) {
    let genesis = Block::genesis(1, 0, 0, b"genesis".to_vec());
    let mut dag = Dag::new(3, genesis);
    let (set, sks) = test_authority_set();
    dag.set_poa(set.clone(), SLOT_MS);
    (dag, set, sks)
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
    let unsigned = Block::new(parents.clone(), 1, timestamp_ms, 0, payload.to_vec());
    let sig = sk
        .sign(unsigned.hash_without_authority_sig().as_bytes())
        .to_bytes();
    Block::new_with_authority(parents, 1, timestamp_ms, 0, sig, payload.to_vec())
}

/// Build a block for `slot` signed by `sk` (any authority).
fn poa_block_signed_by(parents: Vec<BlockId>, slot: u64, sk: &SigningKey, payload: &[u8]) -> Block {
    let timestamp_ms = slot * SLOT_MS;
    let unsigned = Block::new(parents.clone(), 1, timestamp_ms, 0, payload.to_vec());
    let sig = sk
        .sign(unsigned.hash_without_authority_sig().as_bytes())
        .to_bytes();
    Block::new_with_authority(parents, 1, timestamp_ms, 0, sig, payload.to_vec())
}

/// Build a block for `slot` signed by the scheduled authority but with arbitrary work.
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

/// Get a signing key that is NOT the authority scheduled for `slot`.
fn sk_not_for_slot(set: &AuthoritySet, sks: &[SigningKey], slot: u64) -> SigningKey {
    let scheduled = set.active_authority(slot);
    sks.iter()
        .find(|sk| sk.verifying_key() != *scheduled)
        .expect("set has at least one non-scheduled authority")
        .clone()
}

/// V1 — wrong_producer: a valid sig from an authority not scheduled for the slot.
#[test]
fn adversarial_wrong_producer() {
    let (mut dag, set, sks) = test_dag();
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

/// V2 — double_sign / equivocation: the authority scheduled for a slot signs two
/// conflicting blocks for that slot.
///
/// PoA cannot *prevent* equivocation — an honest-key holder can always sign two
/// different blocks and the slot scheduler has no way to detect it without a
/// signed slot reservation. What the protocol must guarantee instead is that
/// equivocation is **harmless**: both blocks are admitted (a block that names the
/// scheduled authority with a valid signature over a slot-derivable hash is
/// indistinguishable from an honest one), the equivocation gains no chain weight
/// because `work` is pinned to nominal, and GHOSTDAG converges deterministically
/// on one tip regardless of the order in which the two blocks reach a node.
#[test]
fn adversarial_double_sign_slot() {
    let (set, sks) = test_authority_set();
    assert_eq!(set.authorities().len(), 3);
    assert_eq!(set.threshold(), 2);

    // Two conflicting blocks for slot 0: identical parents and timestamp, both
    // correctly signed by slot 0's scheduled authority, differing only in payload.
    // That is the strongest form of double-sign — both are valid under every
    // admission rule, and neither is identifiable as equivocation on its own.
    let genesis = Block::genesis(1, 0, 0, b"genesis".to_vec());
    let g = genesis.id();
    let a = equivocating_block(vec![g], &set, &sks, 0, b"honest".as_slice());
    let b = equivocating_block(vec![g], &set, &sks, 0, b"equivocation".as_slice());
    assert_ne!(a.id(), b.id(), "the two blocks must be distinct");

    // Both are admitted — admission cannot distinguish them.
    let (mut dag, _, _) = test_dag();
    let a_id = dag
        .insert(a.clone())
        .expect("equivocating block A is admitted");
    let b_id = dag
        .insert(b.clone())
        .expect("equivocating block B is admitted");
    assert_eq!(dag.len(), 3, "genesis + both equivocating blocks");

    // Equivocation must not buy chain weight. The control is an honest single
    // block on the same parent: an equivocating block must earn no more blue
    // work than it, so signing twice can never be converted into chain weight.
    let (mut control, _, _) = test_dag();
    let control_id = control
        .insert(poa_block(vec![g], 0, &set, &sks, b"control".as_slice()))
        .expect("honest control block admitted");
    let control_work = control
        .ghostdag(&control_id)
        .expect("control ghostdag data")
        .blue_work;
    for id in [a_id, b_id] {
        let gd = dag.ghostdag(&id).expect("ghostdag data present");
        assert!(
            gd.blue_work <= control_work,
            "equivocating block {id} (blue_work {}) must not exceed the honest \
             control ({control_work})",
            gd.blue_work
        );
        assert!(
            gd.blue_work < POA_NOMINAL_WORK * 2,
            "equivocation must not accumulate additional work"
        );
    }

    // And the network must converge: two nodes that see the same pair in opposite
    // orders must agree on the tip, or equivocation would be a fork primitive.
    let (mut dag2, _, _) = test_dag();
    dag2.insert(b.clone()).unwrap();
    dag2.insert(a.clone()).unwrap();
    assert_eq!(
        dag.selected_tip(),
        dag2.selected_tip(),
        "equivocating pair must not fork the network"
    );

    // A slot may also be *skipped* entirely: an authority that withholds its block
    // stalls only its own slot, and the next scheduled authority continues. This
    // is the anti-double-sign liveness bound — an equivocating authority cannot
    // lock out the round-robin.
    let (mut dag3, set3, sks3) = test_dag();
    let g3 = dag3.genesis();
    let parent = dag3
        .insert(poa_block(vec![g3], 1, &set3, &sks3, b"next".as_slice()))
        .expect("slot 1's authority continues after slot 0 is equivocated away");
    assert_eq!(dag3.len(), 2);
    assert!(parent != a_id && parent != b_id);
}

/// A block correctly signed by the authority scheduled for `slot` over the given
/// parents — the equivocation primitive. Two calls differing only in `payload`
/// produce the strongest double-sign: both fully valid, mutually exclusive.
fn equivocating_block(
    parents: Vec<BlockId>,
    set: &AuthoritySet,
    sks: &[SigningKey],
    slot: u64,
    payload: &[u8],
) -> Block {
    let timestamp_ms = slot * SLOT_MS;
    let authority = set.active_authority(slot);
    let sk = sks
        .iter()
        .find(|sk| sk.verifying_key() == *authority)
        .expect("scheduled authority's signing key present");
    let unsigned = Block::new(parents.clone(), 1, timestamp_ms, 0, payload.to_vec());
    let sig = sk
        .sign(unsigned.hash_without_authority_sig().as_bytes())
        .to_bytes();
    Block::new_with_authority(parents, 1, timestamp_ms, 0, sig, payload.to_vec())
}

/// V3 — stale_slot: block with timestamp from past/future slot causing slot regression.
#[test]
fn adversarial_stale_slot() {
    let (mut dag, set, sks) = test_dag();
    let g = dag.genesis();
    assert!(set.len() == 3);

    // Parent at slot 2, child claims slot 1 (timestamp 3000 < parent 6000) —
    // the child's slot precedes its parent's slot, which violates slot monotonicity.
    let parent = dag
        .insert(poa_block(vec![g], 2, &set, &sks, b"p".as_slice()))
        .unwrap();
    let bad = poa_block(vec![parent], 1, &set, &sks, b"child".as_slice());
    let bad_id = bad.id();
    let err = dag.insert(bad).unwrap_err();
    assert!(
        matches!(err, DagError::InvalidAuthoritySignature { id, .. } if id == bad_id),
        "expected InvalidAuthoritySignature for stale slot, got {err:?}"
    );
    assert_eq!(dag.len(), 2, "only genesis + parent admitted");
}

/// V4 — missing_authority_sig: block lacks authority signature.
#[test]
fn adversarial_missing_sig() {
    let (mut dag, _set, _sks) = test_dag();
    let g = dag.genesis();
    assert_eq!(_set.threshold(), 2);

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

/// V5 — work_inflation: block claims work != POA_NOMINAL_WORK (regression for §6.1(b)).
#[test]
fn adversarial_work_inflation() {
    assert_eq!(POA_NOMINAL_WORK, 1, "PoA nominal work pinned to 1");
    let (mut dag, set, sks) = test_dag();
    let g = dag.genesis();

    // Each of these is correctly signed by the authority scheduled for slot 0
    // — the only thing wrong is the claimed weight. The pin is exact.
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

    // The nominal value is still admitted.
    let honest = poa_block(vec![g], 0, &set, &sks, b"honest".as_slice());
    let honest_id = honest.id();
    assert_eq!(dag.insert(honest).unwrap(), honest_id);
}

/// V6 — authority_update_abuse: a rotation attempt that is malformed,
/// under-threshold, signed by a non-member, forged, or replayed.
#[test]
fn adversarial_authority_update_abuse() {
    let (old_set, old_sks) = test_authority_set();
    assert_eq!(old_set.threshold(), 2);
    assert_eq!(old_set.len(), 3);
    let old_hash = old_set.hash();

    // The attacker wants to install a set they control. The honest path is a
    // threshold-signed update over (old_hash || new_set); every abuse below is
    // a way of getting that rotation applied *without* that threshold.
    let (attacker_set, attacker_sks) = test_authority_set_with_seeds(40, 3, 2);
    let new_set = attacker_set;

    // (a) Under-threshold: one honest signature against t=2. This is the headline
    // attack — a single authority must not be able to rotate the set alone.
    let one_sig = vec![(
        *old_set.authorities().first().unwrap(),
        sign_update(&old_sks[0], &old_hash, &new_set),
    )];
    let under = AuthorityUpdateTx::new(old_hash, new_set.clone(), one_sig).unwrap();
    assert_eq!(
        under.validate(&old_set),
        Err(AuthorityError::InsufficientSignatures(2, 1)),
        "a lone authority must not be able to rotate the set"
    );

    // (b) Right count, wrong signers: two signatures from authorities that are not
    // in the old set. The count gate passes, membership must not.
    let outsider_sigs: Vec<_> = attacker_sks
        .iter()
        .take(2)
        .map(|sk| (sk.verifying_key(), sign_update(sk, &old_hash, &new_set)))
        .collect();
    let outsiders = AuthorityUpdateTx::new(old_hash, new_set.clone(), outsider_sigs).unwrap();
    assert_eq!(
        outsiders.validate(&old_set),
        Err(AuthorityError::UnknownSigner),
        "non-member signatures must not rotate the set"
    );

    // (c) Forged signature: a real member's key, a signature over a *different*
    // payload. The signature is well-formed and the key is a member, so only
    // actual verification catches this.
    let mut forged_sig = sign_update(&old_sks[1], &old_hash, &new_set);
    forged_sig[0] ^= 0x01;
    let forged = AuthorityUpdateTx::new(
        old_hash,
        new_set.clone(),
        vec![
            (
                old_sks[0].verifying_key(),
                sign_update(&old_sks[0], &old_hash, &new_set),
            ),
            (old_sks[1].verifying_key(), forged_sig),
        ],
    )
    .unwrap();
    assert_eq!(
        forged.validate(&old_set),
        Err(AuthorityError::InsufficientSignatures(2, 1)),
        "a signature over the wrong payload must not count"
    );

    // (d) Signature transplant: two honest signatures, but over an update the
    // current set never authorised. Signing a different new_set does not carry
    // over to this one.
    let (other_set, _) = test_authority_set_with_seeds(70, 3, 2);
    let transplant = AuthorityUpdateTx::new(
        old_hash,
        new_set.clone(),
        vec![
            (
                old_sks[0].verifying_key(),
                sign_update(&old_sks[0], &old_hash, &other_set),
            ),
            (
                old_sks[1].verifying_key(),
                sign_update(&old_sks[1], &old_hash, &other_set),
            ),
        ],
    )
    .unwrap();
    assert_eq!(
        transplant.validate(&old_set),
        Err(AuthorityError::InsufficientSignatures(2, 0)),
        "signatures over a different new set must not transfer"
    );

    // (e) Replay across sets: a validly-signed update is bound to the set it
    // spends. Replayed against a different (later) set it must not apply, or a
    // retired authority could keep rotating sets forever.
    let replayed = AuthorityUpdateTx::new(
        old_hash,
        new_set.clone(),
        vec![
            (
                old_sks[0].verifying_key(),
                sign_update(&old_sks[0], &old_hash, &new_set),
            ),
            (
                old_sks[1].verifying_key(),
                sign_update(&old_sks[1], &old_hash, &new_set),
            ),
        ],
    )
    .unwrap();
    let (successor_set, _) = test_authority_set_with_seeds(80, 3, 2);
    assert!(
        replayed.validate(&successor_set).is_err(),
        "an update must not replay against a different authority set"
    );

    // (f) Duplicate signer: the same key twice must not be counted twice, even
    // though `sigs.len()` is at threshold.
    let dup = AuthorityUpdateTx::new(
        old_hash,
        new_set.clone(),
        vec![
            (
                old_sks[0].verifying_key(),
                sign_update(&old_sks[0], &old_hash, &new_set),
            ),
            (
                old_sks[0].verifying_key(),
                sign_update(&old_sks[0], &old_hash, &new_set),
            ),
        ],
    );
    assert_eq!(
        dup.unwrap_err(),
        AuthorityError::DuplicateSigner,
        "a repeated signer must be refused at construction, not counted twice"
    );

    // (g) Malformed encoding must be rejected by the decoder, not panic or
    // silently decode to a partial set.
    let valid = replayed.to_bytes();
    for bad in [vec![], valid[..16].to_vec(), {
        // Declares 3 new keys but carries none of them.
        let mut b = valid[..48].to_vec();
        b.truncate(32 + 16);
        b
    }] {
        assert!(
            AuthorityUpdateTx::from_bytes(&bad).is_err(),
            "malformed update encoding must be rejected"
        );
    }

    // (h) The honest path still works — the abuse tests above are only
    // meaningful if a threshold-signed update is actually accepted.
    let honest = AuthorityUpdateTx::new(
        old_hash,
        new_set.clone(),
        vec![
            (
                old_sks[0].verifying_key(),
                sign_update(&old_sks[0], &old_hash, &new_set),
            ),
            (
                old_sks[2].verifying_key(),
                sign_update(&old_sks[2], &old_hash, &new_set),
            ),
        ],
    )
    .unwrap();
    assert!(
        honest.validate(&old_set).is_ok(),
        "a threshold-signed update must validate"
    );
    assert_eq!(honest.new_set().hash(), new_set.hash());
    assert_eq!(honest.old_set_hash(), &old_hash);

    // Round-trips through the canonical encoding.
    let decoded = AuthorityUpdateTx::from_bytes(&honest.to_bytes()).unwrap();
    assert_eq!(decoded, honest, "canonical encoding must round-trip");
    assert!(decoded.validate(&old_set).is_ok());
}

/// An `n`-authority set with threshold `t` whose keys derive from `base..base+n`,
/// so each test can build a *different* set (the attacker's target, a successor
/// set for replay testing) without colliding with the primary set.
fn test_authority_set_with_seeds(
    base: u8,
    n: u8,
    threshold: usize,
) -> (AuthoritySet, Vec<SigningKey>) {
    let mut keys = Vec::new();
    let mut sks = Vec::new();
    for i in 0..n {
        let sk = SigningKey::from_bytes(&[base + i; 32]);
        let pk = sk.verifying_key();
        keys.push(pk);
        sks.push(sk);
    }
    (
        AuthoritySet::new(keys, threshold).expect("valid authority set"),
        sks,
    )
}
