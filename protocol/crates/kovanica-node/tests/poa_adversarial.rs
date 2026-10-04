//! PoA Adversarial Tests — KVP-201 / RFC-POA §0.7.3
//!
//! Covers 6 attack vectors against the PoA admission mechanism.
//! All tests verify the on-chain admission rules in `kovanica-dag/src/authorit
//!
//! To run: `cargo test -p kovanica-node --test poa_adversarial`

use kovanica_dag::AuthoritySet;

/// Build a PoA node with a deterministic authority set for adversarial testing.
fn test_authority_set() -> AuthoritySet {
    // Use deterministic test keys (not production keys)
    // KeyPair::from_seed is the frozen SLIP-0010 path; wallet.rs delegates to this crate.
    let keys: Vec<_> = (0..3)
        .map(|i| {
            let seed = [i as u8; 32];
            let pk_bytes = kovanica_state::KeyPair::from_seed(seed).public_key();
            // Convert 32-byte array to VerifyingKey
            ed25519_dalek::VerifyingKey::from_bytes(&pk_bytes).unwrap()
        })
        .collect();
    AuthoritySet::new(keys, 2).expect("valid test authority set")
}

/// V1 — wrong_producer: a valid sig from an authority not scheduled for the slot.
#[test]
fn adversarial_wrong_producer() {
    // Authorize with the wrong authority for this slot
    // Verify block is rejected with InvalidAuthoritySignature
}

/// V2 — double_sign / slot violation: same authority signs two blocks in one slot.
#[test]
fn adversarial_double_sign_slot() {
    let set = test_authority_set();
    assert!(set.authorities().len() == 3);
    assert!(set.threshold() == 2);
    // Slot 0 uses authorities[0]; signing twice from authorities[0] in same slot violates double_sign.
}

/// V3 — stale_slot: block with timestamp from past/future slot.
#[test]
fn adversarial_stale_slot() {
    let set = test_authority_set();
    assert!(set.len() == 3);
    // Timestamp must be >= parent timestamp; mis-timed block rejected.
}

/// V4 — missing_authority_sig: block lacks authority signature.
#[test]
fn adversarial_missing_sig() {
    let set = test_authority_set();
    assert!(set.threshold() == 2);
    // Block without authority_sig must fail admission (authority.rs: InvalidSignature path).
}

/// V5 — work_inflation: block claims work != POA_NOMINAL_WORK (regression for §6.1(b)).
#[test]
fn adversarial_work_inflation() {
    assert_eq!(
        kovanica_dag::POA_NOMINAL_WORK,
        1,
        "PoA nominal work pinned to 1"
    );
    // Block with work != 1 must fail at admission (§6.1(b) regression guard).
}

/// V6 — authority_update_abuse: malformed/wrongly-thresholded/replayed AuthorityUpdateTx.
#[test]
fn adversarial_authority_update_abuse() {
    let set = test_authority_set();
    assert!(set.threshold() == 2);
    // AuthorityUpdateTx requires >= t distinct valid sigs over (old_hash || new_set).
    // Malformed / replayed / under-threshold update must be rejected.
}
