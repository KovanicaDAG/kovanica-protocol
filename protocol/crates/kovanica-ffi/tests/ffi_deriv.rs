//! Known-answer tests for the **exported** derivation surface.
//!
//! `src/deriv.rs` has unit tests for behaviour; this file pins the *wire* the
//! mobile clients actually call. The addresses below are the same vectors
//! `kovanica-wallet/tests/slip10_vectors.rs` pins, re-asserted across the FFI
//! boundary so a regression in the export layer (a swapped argument, a dropped
//! passphrase, a changed path constant) fails here rather than as a
//! balance-less wallet on a phone.
//!
//! The inputs are the canonical zero-entropy 128-bit phrase, built from entropy
//! bytes so no phrase literal lives in source. These are public test vectors,
//! not keys.

use kovanica_ffi::{
    account_from_signing_secret, address_from_signing_secret, derive_account_from_mnemonic,
    derive_address_from_mnemonic, derive_signing_secret_from_mnemonic, mnemonic_is_valid,
    slip10_derivation_path, slip44_coin_type,
};

/// The zero-entropy 128-bit input, built from entropy bytes.
fn zero_phrase() -> String {
    bip39::Mnemonic::from_entropy_in(bip39::Language::English, &[0u8; 16])
        .expect("128 bits of entropy is a valid 12-word phrase")
        .to_string()
}

/// Address vectors, indexed by the `i` in `m/44'/3007'/0'/0'/i'`.
const PINNED: [(&str, u32); 3] = [
    ("kvnc1A2ob7wBpGDrzuyLudnqwMyiqgwKhdN8RtcVGbTChbtvZdag", 0),
    ("kvnc1ESTrrsKKbWrxqKTZWrEHjqitk3GAnm8b8T7cV24e8h2cdag", 1),
    ("kvnc1EiucLwdZyLNuViDKjj5t4W96KKbAJv7EdXNTmER9V86udag", 2),
];

#[test]
fn the_zero_phrase_is_accepted() {
    assert!(mnemonic_is_valid(zero_phrase()));
}

#[test]
fn frozen_constants_are_exposed_verbatim() {
    assert_eq!(slip44_coin_type(), 3007);
    assert_eq!(slip10_derivation_path(0), "m/44'/3007'/0'/0'/0'");
    assert_eq!(slip10_derivation_path(1), "m/44'/3007'/0'/0'/1'");
    assert_eq!(slip10_derivation_path(2), "m/44'/3007'/0'/0'/2'");
}

#[test]
fn every_pinned_address_derives_across_the_ffi_boundary() {
    for (expected, index) in PINNED {
        let account =
            derive_account_from_mnemonic(zero_phrase(), String::new(), index).expect("derives");
        assert_eq!(account.address, expected, "index {index}");
        assert_eq!(account.address_index, index);
        assert_eq!(
            account.derivation_path,
            format!("m/44'/3007'/0'/0'/{index}'")
        );
    }
}

#[test]
fn the_thin_helpers_agree_with_the_record() {
    for (expected, index) in PINNED {
        assert_eq!(
            derive_address_from_mnemonic(zero_phrase(), String::new(), index).expect("derives"),
            expected
        );
    }
}

#[test]
fn the_signing_key_reaches_the_node_address() {
    // The send surface takes a 32-byte hex secret, so the two halves of the
    // export must compose: derive a secret here, hand it back to the
    // secret-based address helper, and land on the same account.
    for (expected, index) in PINNED {
        let secret = derive_signing_secret_from_mnemonic(zero_phrase(), String::new(), index)
            .expect("derives");
        assert_eq!(secret.len(), 64, "index {index}: 32 bytes of hex");
        assert_eq!(
            address_from_signing_secret(secret.clone()).expect("well-formed secret"),
            expected
        );
        let round_tripped = account_from_signing_secret(secret).expect("well-formed secret");
        assert_eq!(round_tripped.address, expected);
        assert_eq!(round_tripped.address_index, 0, "the raw path is `m` only");
        assert_eq!(round_tripped.derivation_path, "m/44'/3007'/0'/0'/0'");
    }
}

/// The regression this whole surface exists for: the derived key must be the
/// SLIP-0010 child, never the first half of the stretched material. A client
/// that truncates shows a valid-looking address that holds nothing.
#[test]
fn the_signing_key_is_not_the_truncated_material() {
    for (_, index) in PINNED {
        let secret = derive_signing_secret_from_mnemonic(zero_phrase(), String::new(), index)
            .expect("derives");
        let material = kovanica_wallet::bip39_material(&zero_phrase(), "").expect("stretches");
        assert_ne!(secret, hex::encode(&material[..32]), "index {index}");
    }
}

#[test]
fn the_passphrase_is_honoured_across_the_boundary() {
    let plain = derive_address_from_mnemonic(zero_phrase(), String::new(), 0).expect("derives");
    let locked = derive_address_from_mnemonic(zero_phrase(), "hunter2".into(), 0).expect("derives");
    assert_ne!(plain, locked, "a passphrase must not be silently dropped");
    assert_eq!(
        derive_address_from_mnemonic(zero_phrase(), "hunter2".into(), 0).expect("derives"),
        locked
    );
}

#[test]
fn a_bad_phrase_errors_instead_of_deriving() {
    assert!(!mnemonic_is_valid("not a real phrase".into()));
    assert!(!mnemonic_is_valid(String::new()));
    // Right shape, wrong checksum.
    let canonical = zero_phrase();
    let mut phrase = canonical.split(' ').collect::<Vec<_>>();
    *phrase.last_mut().expect("12 words") = "zoo";
    assert!(!mnemonic_is_valid(phrase.join(" ")));
    assert!(derive_account_from_mnemonic(phrase.join(" "), String::new(), 0).is_err());
}

#[test]
fn a_bad_secret_errors_instead_of_deriving() {
    for bad in [
        String::new(),
        "aabb".into(),
        "nothex".into(),
        "0".repeat(64 + 2),
    ] {
        assert!(account_from_signing_secret(bad.clone()).is_err(), "{bad}");
    }
}
