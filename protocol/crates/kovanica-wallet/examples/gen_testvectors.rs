//! Generate the shared golden-vector file `protocol/testvectors/vectors.json`.
//!
//! This is the single origin of truth for cross-implementation key/tx/script
//! vectors: the Rust implementation computes every value here, and the web,
//! extension, iOS and Android test suites load the same committed file
//! read-only. If any implementation disagrees, that is a finding to report —
//! never a reason to edit the vector.
//!
//! Run from `protocol/`:
//!
//! ```sh
//! cargo run -p kovanica-wallet --example gen_testvectors \
//!   > testvectors/vectors.json
//! ```
//!
//! Every mnemonic below is a **zero- or fixed-entropy test phrase**. These are
//! public constants, never real wallets. No key material is derived from
//! randomness, so the output is byte-for-byte reproducible.

use bip39::Mnemonic;
use kovanica_state::tx::{AssetId, OutPoint, StealthExt, Transaction, TxId, TxInput, TxOutput};
use kovanica_state::{Address, HtlcScript, KeyPair, MultisigScript, VaultScript};
use kovanica_wallet::Wallet;
use serde_json::{json, Value};

/// BIP-39 English phrase for `entropy`, built from bytes so no mnemonic-like
/// literal appears in this source file.
fn phrase(entropy: &[u8]) -> String {
    Mnemonic::from_entropy_in(bip39::Language::English, entropy)
        .expect("valid entropy length")
        .to_string()
}

/// A deterministic Ed25519 public key, `[k LE, 0…0]` — the same rule the node's
/// `KeyPair::from_u64` uses, so script templates line up with `kovanica-state`.
fn pk(k: u64) -> [u8; 32] {
    *KeyPair::from_u64(k).address().payload()
}

/// One derivation vector: mnemonic → frozen SLIP-0010 path → pubkey → address.
fn derivation(name: &str, mnemonic: &str, passphrase: &str, index: u32) -> Value {
    let wallet =
        Wallet::from_mnemonic_at(mnemonic, passphrase, index).expect("fixed test phrase is valid");
    json!({
        "kind": "derivation",
        "name": name,
        "mnemonic": mnemonic,
        "passphrase": passphrase,
        "derivation_path": format!("m/44'/3007'/0'/0'/{index}'"),
        "index": index,
        "pubkey_hex": hex::encode(wallet.public_key()),
        "address": wallet.address().to_kvnc(),
        "address_hex": wallet.address().to_hex(),
    })
}

fn versioned(version: u8, payload: [u8; 32]) -> Address {
    let mut raw = [0u8; 33];
    raw[0] = version;
    raw[1..].copy_from_slice(&payload);
    Address::from_versioned_bytes(raw)
}

/// The native + multi-asset fixture transaction, shared with the node's
/// `tests/sighash_vector.rs`.
fn native_fixture() -> Transaction {
    let alice = versioned(0x00, [0xAAu8; 32]);
    let bob = versioned(0x00, [0xBBu8; 32]);
    let asset = AssetId::from_bytes([0xEEu8; 32]);
    Transaction::new(
        vec![
            TxInput::new(OutPoint::new(TxId::from_bytes([0x11u8; 32]), 0), Vec::new()),
            TxInput::new(OutPoint::new(TxId::from_bytes([0x22u8; 32]), 1), Vec::new()),
        ],
        vec![
            TxOutput::native(1_000_000_000, alice),
            TxOutput::new(500, Some(asset), bob),
        ],
        b"vector".to_vec(),
    )
}

/// The stealth fixture transaction (v0x03 output + lock time/sequence).
fn stealth_fixture() -> Transaction {
    let owner = versioned(0x03, [0x5Du8; 32]);
    let alice = versioned(0x00, [0xAAu8; 32]);
    let ext = StealthExt {
        r: [0x5Au8; 32],
        view_tag: 0x42,
        p: [0x5Cu8; 32],
    };
    Transaction::new_with_lock(
        vec![TxInput::new(
            OutPoint::new(TxId::from_bytes([0x33u8; 32]), 2),
            Vec::new(),
        )],
        vec![
            TxOutput::native(777, alice),
            TxOutput::stealth(123, owner, ext),
        ],
        b"stealth".to_vec(),
        1000,
        7,
    )
}

fn main() {
    let zero12 = phrase(&[0u8; 16]);
    let zero24 = phrase(&[0u8; 32]);
    let ab12 = phrase(&[0xabu8; 16]);

    let mut vectors: Vec<Value> = vec![
        // --- Derivation: every derivation path/wordlist in use -------------
        derivation("en-12-zero-i0", &zero12, "", 0),
        derivation("en-12-zero-i1", &zero12, "", 1),
        derivation("en-12-zero-i2", &zero12, "", 2),
        derivation("en-24-zero-i0", &zero24, "", 0),
        derivation("en-12-zero-passphrase-i0", &zero12, "test passphrase", 0),
        derivation("en-12-ab-i0", &ab12, "", 0),
    ];

    // --- Script templates (RFC-001/004/005) -------------------------------
    let ms = MultisigScript::new(2, vec![pk(1), pk(2), pk(3)]).unwrap();
    vectors.push(json!({
        "kind": "multisig",
        "name": "multisig-2of3",
        "m": 2,
        "n": 3,
        "keys": [1, 2, 3],
        "script_hex": hex::encode(ms.encode()),
        "script_hash_hex": hex::encode(ms.script_hash()),
        "address": ms.address().to_kvnc(),
        "address_hex": ms.address().to_hex(),
    }));

    let htlc = HtlcScript::new([0x42u8; 32], pk(1), pk(2), 1440).unwrap();
    vectors.push(json!({
        "kind": "htlc",
        "name": "htlc-1440",
        "preimage_hash_hex": hex::encode([0x42u8; 32]),
        "recipient_key": 1,
        "sender_key": 2,
        "timeout": 1440,
        "script_hex": hex::encode(htlc.bytes()),
        "script_hash_hex": hex::encode(htlc.script_hash()),
        "address": htlc.address().to_kvnc(),
        "address_hex": htlc.address().to_hex(),
    }));

    let vault = VaultScript::new(1000, 144, pk(1)).unwrap();
    vectors.push(json!({
        "kind": "vault",
        "name": "vault-1000-144",
        "unlock_height": 1000,
        "csv": 144,
        "owner_key": 1,
        "script_hex": hex::encode(vault.bytes()),
        "script_hash_hex": hex::encode(vault.script_hash()),
        "address": vault.address().to_kvnc(),
        "address_hex": vault.address().to_hex(),
    }));

    // --- Address encoding -------------------------------------------------
    vectors.push(json!({
        "kind": "address",
        "name": "p2pk-aa",
        "version": 0,
        "payload_hex": hex::encode([0xAAu8; 32]),
        "address": versioned(0x00, [0xAAu8; 32]).to_kvnc(),
        "address_hex": versioned(0x00, [0xAAu8; 32]).to_hex(),
    }));
    vectors.push(json!({
        "kind": "address",
        "name": "legacy-32-p2pk",
        "version": 0,
        "payload_hex": hex::encode([0xABu8; 32]),
        "address": Address::p2pk([0xABu8; 32]).to_kvnc(),
        "address_hex": Address::p2pk([0xABu8; 32]).to_hex(),
    }));

    // --- Transactions: canonical encode + sighash + signature -------------
    let native = native_fixture();
    let native_sighash = native.sighash();
    let signer = KeyPair::from_u64(1);
    vectors.push(json!({
        "kind": "transaction",
        "name": "native-multi-asset",
        "encode_hex": hex::encode(native.encode()),
        "sighash_hex": hex::encode(native_sighash),
        "signer": "keypair-from-u64-1",
        "signature_hex": hex::encode(signer.sign(&native_sighash)),
        "signer_address": signer.address().to_kvnc(),
    }));

    let stealth = stealth_fixture();
    vectors.push(json!({
        "kind": "transaction",
        "name": "stealth-lock-1000-seq-7",
        "encode_hex": hex::encode(stealth.encode()),
        "sighash_hex": hex::encode(stealth.sighash()),
    }));

    let doc = json!({
        "version": 1,
        "generated_by": "kovanica-wallet",
        "network": "testnet",
        "notes": "Throwaway fixed-entropy phrases only. Generated by `cargo run -p kovanica-wallet --example gen_testvectors`. Do not hand-edit; a mismatch is a finding.",
        "vectors": vectors,
    });

    println!(
        "{}",
        serde_json::to_string_pretty(&doc).expect("vector document serializes")
    );
}
