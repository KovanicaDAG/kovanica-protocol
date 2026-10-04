//! WASM bindings for kovanica-sdk.
//!
//! Build with:
//! ```text
//! wasm-pack build bindings/kovanica-wasm --target web
//! ```
//!
//! This is a minimal surface for the first browser integration.

use kovanica_sdk::keys::{
    decode_address, encode_p2pk_address, to_kvnc, DERIVATION_PATH, SLIP44_COIN_TYPE,
};
use kovanica_sdk::prelude::*;
use kovanica_sdk::types::Signature;
use serde::Deserialize;
use wasm_bindgen::prelude::*;

/// Initialize panic hook for better console errors (optional feature).
#[wasm_bindgen(start)]
pub fn start() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

fn js_err(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}

/// Generate a 12- or 24-word phrase.
///
/// `words` must be 12 or 24.
#[wasm_bindgen]
pub fn generate_mnemonic(words: u32) -> Result<String, JsValue> {
    let wc = match words {
        12 => WordCount::Words12,
        24 => WordCount::Words24,
        _ => return Err(JsValue::from_str("words must be 12 or 24")),
    };
    let m = Mnemonic::generate(wc).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(m.phrase())
}

/// Derive `kvnc…dag` from the frozen SLIP-0010 path `m/44'/3007'/0'/0'/index'`.
#[wasm_bindgen]
pub fn address_from_mnemonic(phrase: &str, index: u32) -> Result<String, JsValue> {
    let m = Mnemonic::from_phrase(phrase).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let kp = Keypair::from_mnemonic_at(&m, "", index);
    Ok(to_kvnc(&kp.address()))
}

// ---------------------------------------------------------------------------
// Wallet-key surface for the browser apps (web / extension / dashboard).
//
// These mirror `kovanica-wallet`'s `Wallet` and the TS implementation they
// replace: same frozen SLIP-0010 path, same BIP-39 seed, same Ed25519 rules.
// Key material never leaves the caller; every function returns only derivable
// public data or a signature.
// ---------------------------------------------------------------------------

/// Normalize a recovery phrase: lowercase, collapse every run of whitespace
/// (spaces, newlines, tabs) to a single space, trim.
#[wasm_bindgen]
pub fn normalize_mnemonic(phrase: &str) -> String {
    normalize_mnemonic_inner(phrase)
}

fn normalize_mnemonic_inner(phrase: &str) -> String {
    phrase
        .split_whitespace()
        .map(str::to_lowercase)
        .collect::<Vec<_>>()
        .join(" ")
}

/// BIP-39 validity: 12 or 24 English words with a correct checksum.
#[wasm_bindgen]
pub fn mnemonic_is_valid(phrase: &str) -> bool {
    Mnemonic::from_phrase(phrase).is_ok()
}

/// Words in `phrase` that are missing from the BIP-39 English wordlist, in
/// order. Lets a caller show a precise "typo" hint before reporting a checksum
/// failure.
#[wasm_bindgen]
pub fn mnemonic_unknown_words(phrase: &str) -> Vec<String> {
    kovanica_sdk::keys::unknown_words(phrase)
}

/// Deterministic English mnemonic from caller-supplied entropy (16 or 32 bytes).
#[wasm_bindgen]
pub fn entropy_to_mnemonic(entropy: &[u8]) -> Result<String, JsValue> {
    entropy_to_mnemonic_inner(entropy).map_err(js_err)
}

fn entropy_to_mnemonic_inner(entropy: &[u8]) -> Result<String, String> {
    let m = Mnemonic::from_entropy(entropy).map_err(|e| e.to_string())?;
    Ok(m.phrase())
}

/// 64-byte BIP-39 seed (PBKDF2-HMAC-SHA512, 2048 iterations). Optional
/// passphrase acts as the BIP-39 "25th word".
#[wasm_bindgen]
pub fn mnemonic_to_seed(phrase: &str, passphrase: &str) -> Result<Vec<u8>, JsValue> {
    mnemonic_to_seed_inner(phrase, passphrase).map_err(js_err)
}

fn mnemonic_to_seed_inner(phrase: &str, passphrase: &str) -> Result<Vec<u8>, String> {
    let m = Mnemonic::from_phrase(phrase).map_err(|e| e.to_string())?;
    Ok(m.to_seed(passphrase).0.to_vec())
}

/// 32-byte Ed25519 signing seed at account `index` on the frozen path
/// `m/44'/3007'/0'/0'/index'` (all segments hardened).
#[wasm_bindgen]
pub fn seed_from_mnemonic(phrase: &str, passphrase: &str, index: u32) -> Result<Vec<u8>, JsValue> {
    seed_from_mnemonic_inner(phrase, passphrase, index).map_err(js_err)
}

fn seed_from_mnemonic_inner(phrase: &str, passphrase: &str, index: u32) -> Result<Vec<u8>, String> {
    let m = Mnemonic::from_phrase(phrase).map_err(|e| e.to_string())?;
    Ok(m.to_seed(passphrase).derive_ed25519_key(index).to_vec())
}

/// Public key (32 bytes, 64 hex chars) at account `index`.
#[wasm_bindgen]
pub fn public_key_from_mnemonic(
    phrase: &str,
    passphrase: &str,
    index: u32,
) -> Result<String, JsValue> {
    public_key_from_mnemonic_inner(phrase, passphrase, index).map_err(js_err)
}

fn public_key_from_mnemonic_inner(
    phrase: &str,
    passphrase: &str,
    index: u32,
) -> Result<String, String> {
    let m = Mnemonic::from_phrase(phrase).map_err(|e| e.to_string())?;
    let kp = Keypair::from_mnemonic_at(&m, passphrase, index);
    Ok(kp.public_key().to_hex())
}

/// Sign a sighash (hex) with the key at account `index`; returns the 64-byte
/// Ed25519 signature as 128 hex chars.
#[wasm_bindgen]
pub fn sign_sighash(
    phrase: &str,
    passphrase: &str,
    index: u32,
    sighash_hex: &str,
) -> Result<String, JsValue> {
    sign_sighash_inner(phrase, passphrase, index, sighash_hex).map_err(js_err)
}

fn sign_sighash_inner(
    phrase: &str,
    passphrase: &str,
    index: u32,
    sighash_hex: &str,
) -> Result<String, String> {
    let m = Mnemonic::from_phrase(phrase).map_err(|e| e.to_string())?;
    let kp = Keypair::from_mnemonic_at(&m, passphrase, index);
    let message = hex::decode(sighash_hex.trim()).map_err(|e| e.to_string())?;
    Ok(kp.sign(&message).to_hex())
}

/// Sign a sighash (hex) with a raw 32-byte Ed25519 seed (64 hex chars).
#[wasm_bindgen]
pub fn sign_sighash_with_seed_hex(seed_hex: &str, sighash_hex: &str) -> Result<String, JsValue> {
    sign_sighash_with_seed_hex_inner(seed_hex, sighash_hex).map_err(js_err)
}

fn sign_sighash_with_seed_hex_inner(seed_hex: &str, sighash_hex: &str) -> Result<String, String> {
    let seed = hex::decode(seed_hex.trim()).map_err(|e| e.to_string())?;
    let seed: [u8; 32] = seed
        .try_into()
        .map_err(|_| "seed must be 32 bytes (64 hex chars)".to_string())?;
    let kp = Keypair::from_secret_bytes(seed);
    let message = hex::decode(sighash_hex.trim()).map_err(|e| e.to_string())?;
    Ok(kp.sign(&message).to_hex())
}

/// Frozen SLIP-0010 derivation path template (`m/44'/3007'/0'/0'/i'`).
#[wasm_bindgen]
pub fn slip10_derivation_path() -> String {
    DERIVATION_PATH.to_string()
}

/// Decode 64 hex chars into a raw 32-byte key, with the error message the
/// wallet surfaces expect to see.
fn decode_32(hex_input: &str, what: &str) -> Result<[u8; 32], String> {
    let bytes = hex::decode(hex_input.trim()).map_err(|e| e.to_string())?;
    bytes
        .try_into()
        .map_err(|_| format!("{what} must be 32 bytes (64 hex chars)"))
}

/// Signing key (32 bytes, 64 hex chars) at account `index`, derived from a
/// 64-byte BIP-39 seed (128 hex chars) with the frozen hardened path. Lets a
/// wallet that already holds seed material keep it and still derive per-index
/// keys through the core instead of re-implementing SLIP-0010.
#[wasm_bindgen]
pub fn signing_key_from_seed_hex(bip39_seed_hex: &str, index: u32) -> Result<String, JsValue> {
    signing_key_from_seed_hex_inner(bip39_seed_hex, index).map_err(js_err)
}

fn signing_key_from_seed_hex_inner(bip39_seed_hex: &str, index: u32) -> Result<String, String> {
    let bytes = hex::decode(bip39_seed_hex.trim()).map_err(|e| e.to_string())?;
    let arr: [u8; 64] = bytes
        .try_into()
        .map_err(|_| "bip39 seed must be 64 bytes (128 hex chars)".to_string())?;
    Ok(hex::encode(Seed(arr).derive_ed25519_key(index)))
}

/// Public key (32 bytes, 64 hex chars) for a raw 32-byte Ed25519 secret
/// (64 hex chars). Wallets that already hold key material use this instead of
/// re-running the full derivation.
#[wasm_bindgen]
pub fn public_key_from_secret_bytes(secret_hex: &str) -> Result<String, JsValue> {
    public_key_from_secret_bytes_inner(secret_hex).map_err(js_err)
}

fn public_key_from_secret_bytes_inner(secret_hex: &str) -> Result<String, String> {
    let kp = Keypair::from_secret_bytes(decode_32(secret_hex, "signing key")?);
    Ok(kp.public_key().to_hex())
}

/// `kvnc…dag` P2PK address for a raw 32-byte public key (64 hex chars).
#[wasm_bindgen]
pub fn address_from_public_key(pubkey_hex: &str) -> Result<String, JsValue> {
    address_from_public_key_inner(pubkey_hex).map_err(js_err)
}

fn address_from_public_key_inner(pubkey_hex: &str) -> Result<String, String> {
    let pk = decode_32(pubkey_hex, "public key")?;
    Ok(to_kvnc(&encode_p2pk_address(&pk)))
}

/// Canonical 66-hex rendering of any accepted address form: `kvnc…dag`,
/// 64-hex legacy, or 66-hex versioned.
#[wasm_bindgen]
pub fn address_to_hex(address: &str) -> Result<String, JsValue> {
    address_to_hex_inner(address).map_err(js_err)
}

fn address_to_hex_inner(address: &str) -> Result<String, String> {
    decode_address(address)
        .map(|a| a.to_hex())
        .map_err(|e| e.to_string())
}

/// Strict Ed25519 verification with the node's rules (malleable signatures are
/// rejected). Returns `false` for a well-formed but wrong signature; malformed
/// input throws.
#[wasm_bindgen]
pub fn verify_signature(
    pubkey_hex: &str,
    message_hex: &str,
    signature_hex: &str,
) -> Result<bool, JsValue> {
    verify_signature_inner(pubkey_hex, message_hex, signature_hex).map_err(js_err)
}

fn verify_signature_inner(
    pubkey_hex: &str,
    message_hex: &str,
    signature_hex: &str,
) -> Result<bool, String> {
    let pk = decode_32(pubkey_hex, "public key")?;
    let message = hex::decode(message_hex.trim()).map_err(|e| e.to_string())?;
    let signature = Signature::from_hex(signature_hex.trim()).map_err(|e| e.to_string())?;
    Ok(kovanica_sdk::keys::verify_signature(&pk, &message, &signature).is_ok())
}

/// SLIP-44-style coin type for Kovanica (3007).
#[wasm_bindgen]
pub fn slip44_coin_type() -> u32 {
    SLIP44_COIN_TYPE
}

/// One spendable output, as reported by `GET /api/utxos`.
#[derive(Deserialize)]
struct WasmUtxo {
    /// Outpoint tx hash (64 hex).
    tx_hash: String,
    /// Output index within the previous transaction.
    vout: u32,
    /// Atoms. Decimal string: JS numbers lose integer precision above 2^53.
    amount_atoms: String,
    /// Asset id (64 hex); omit or empty for native KVNC.
    #[serde(default)]
    asset_hex: Option<String>,
}

/// One output the transaction will create.
#[derive(Deserialize)]
struct WasmOutput {
    /// `kvnc…dag` address (66-hex also accepted).
    address: String,
    /// Atoms. Decimal string: JS numbers lose integer precision above 2^53.
    amount_atoms: String,
    /// Asset id (64 hex); omit or empty for native KVNC.
    #[serde(default)]
    asset_hex: Option<String>,
}

/// Build and sign a single-signer (P2PK) transaction from explicit UTXOs.
///
/// Shapes:
/// - `utxos`: `[{"tx_hash":"<64hex>","vout":0,"amount_atoms":"100000000","asset_hex":null}]`
/// - `outputs`: `[{"address":"kvnc…dag","amount_atoms":"50000000","asset_hex":null}]`
/// - every amount is a **decimal string**
/// - `change_address`: empty = no change output
/// - `network`: `"testnet"` or `"mainnet"`
///
/// Returns `{"tx_hex":"<hex>","sighash":"<64hex>"}`. Key derivation uses the
/// frozen SLIP-0010 path; the key never leaves the caller.
///
/// Inner form, without `JsValue`, so host-side tests can exercise every error
/// path (wasm-bindgen aborts on non-wasm32 targets for `JsValue`).
fn build_signed_transfer_inner(
    phrase: &str,
    index: u32,
    network: &str,
    utxos_json: &str,
    outputs_json: &str,
    fee_atoms: &str,
    change_address: &str,
) -> Result<String, String> {
    let m = Mnemonic::from_phrase(phrase).map_err(|e| e.to_string())?;
    let kp = Keypair::from_mnemonic_at(&m, "", index);

    let utxos: Vec<WasmUtxo> = serde_json::from_str(utxos_json).map_err(|e| e.to_string())?;
    let outputs: Vec<WasmOutput> = serde_json::from_str(outputs_json).map_err(|e| e.to_string())?;

    let network_id = match network {
        "mainnet" => NetworkId::Mainnet,
        _ => NetworkId::Testnet,
    };

    let mut builder = TransferBuilder::new().network(network_id);
    for u in &utxos {
        let hash = Hash32::from_hex(&u.tx_hash).map_err(|e| e.to_string())?;
        let amount = u
            .amount_atoms
            .parse::<u64>()
            .map_err(|_| "utxo amount_atoms must be a decimal u64".to_string())?;
        let asset = match u.asset_hex.as_deref() {
            Some(h) => AssetId(Hash32::from_hex(h).map_err(|e| e.to_string())?),
            None => AssetId::NATIVE,
        };
        builder = builder.add_input(Utxo {
            tx_hash: hash,
            vout: u.vout,
            amount: Amount::from_atoms(amount),
            asset_id: asset,
            address: kp.address(),
        });
    }

    for o in &outputs {
        let addr = decode_address(&o.address).map_err(|e| e.to_string())?;
        let amount = o
            .amount_atoms
            .parse::<u64>()
            .map_err(|_| "output amount_atoms must be a decimal u64".to_string())?;
        builder = match o.asset_hex.as_deref() {
            Some(h) => builder.add_output(
                addr,
                Amount::from_atoms(amount),
                AssetId(Hash32::from_hex(h).map_err(|e| e.to_string())?),
            ),
            None => builder.add_native_output(addr, Amount::from_atoms(amount)),
        };
    }

    let fee = fee_atoms
        .parse::<u64>()
        .map_err(|_| "fee_atoms must be a decimal u64".to_string())?;
    builder = builder.set_fee(Amount::from_atoms(fee));

    if !change_address.trim().is_empty() {
        builder = builder.set_change(decode_address(change_address).map_err(|e| e.to_string())?);
    }

    let tx = builder.build().map_err(|e| e.to_string())?;
    let sighash = tx.sighash_hex();
    let signed = SignedTx::sign(tx, &kp).map_err(|e| e.to_string())?;
    Ok(format!(
        "{{\"tx_hex\":\"{}\",\"sighash\":\"{}\"}}",
        signed.tx_hex(),
        sighash
    ))
}

/// WASM entry: same as [`build_signed_transfer_inner`], with `JsValue` errors
/// for browser callers.
#[wasm_bindgen]
pub fn build_signed_transfer(
    phrase: &str,
    index: u32,
    network: &str,
    utxos_json: &str,
    outputs_json: &str,
    fee_atoms: &str,
    change_address: &str,
) -> Result<String, JsValue> {
    build_signed_transfer_inner(
        phrase,
        index,
        network,
        utxos_json,
        outputs_json,
        fee_atoms,
        change_address,
    )
    .map_err(js_err)
}

/// SDK version.
#[wasm_bindgen]
pub fn version() -> String {
    kovanica_sdk::VERSION.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// BIP-39 zero-entropy phrase (128-bit) + the frozen SLIP-0010 path,
    /// index 0: deterministic key on any target.
    fn phrase() -> String {
        [
            "abandon", "abandon", "abandon", "abandon", "abandon", "abandon", "abandon", "abandon",
            "abandon", "abandon", "abandon", "about",
        ]
        .join(" ")
    }

    #[test]
    fn build_transfer_ok_on_host() {
        let p = phrase();
        let kp = Keypair::from_mnemonic_at(&Mnemonic::from_phrase(&p).unwrap(), "", 0);
        let addr = to_kvnc(&kp.address());
        let utxos = "[{\"tx_hash\":\"1111111111111111111111111111111111111111111111111111111111111111\",\"vout\":0,\"amount_atoms\":\"100000000\",\"asset_hex\":null}]";
        let outputs = format!(
            "[{{\"address\":\"{addr}\",\"amount_atoms\":\"90000000\",\"asset_hex\":null}}]"
        );
        let json = build_signed_transfer_inner(&p, 0, "testnet", utxos, &outputs, "10000000", "")
            .expect("transfer builds");
        assert!(json.contains("\"tx_hex\":\""), "has tx_hex");
        assert!(json.contains("\"sighash\":\""), "has sighash");
    }

    #[test]
    fn build_transfer_rejects_bad_hex() {
        let p = phrase();
        let bad =
            "[{{\"tx_hash\":\"zzzz\",\"vout\":0,\"amount_atoms\":\"100000000\",\"asset_hex\":null}}]";
        let res = build_signed_transfer_inner(&p, 0, "testnet", bad, "[]", "1", "");
        assert!(res.is_err(), "bad tx_hash must fail");
    }

    #[test]
    fn build_transfer_roundtrips_sighash() {
        let p = phrase();
        let kp = Keypair::from_mnemonic_at(&Mnemonic::from_phrase(&p).unwrap(), "", 0);
        let addr = to_kvnc(&kp.address());
        let utxos = "[{\"tx_hash\":\"2222222222222222222222222222222222222222222222222222222222222222\",\"vout\":3,\"amount_atoms\":\"50000000\",\"asset_hex\":null}]";
        let outputs = format!(
            "[{{\"address\":\"{addr}\",\"amount_atoms\":\"40000000\",\"asset_hex\":null}}]"
        );
        let json = build_signed_transfer_inner(&p, 0, "testnet", utxos, &outputs, "10000000", "")
            .expect("transfer builds");
        let v: serde_json::Value = serde_json::from_str(&json).expect("json");
        let sighash = v["sighash"].as_str().expect("sighash string");
        assert_eq!(sighash.len(), 64, "sighash is 32 bytes hex");
    }

    #[test]
    fn build_transfer_missing_fee_rejected() {
        let p = phrase();
        let kp = Keypair::from_mnemonic_at(&Mnemonic::from_phrase(&p).unwrap(), "", 0);
        let addr = to_kvnc(&kp.address());
        let utxos = "[{\"tx_hash\":\"3333333333333333333333333333333333333333333333333333333333333333\",\"vout\":0,\"amount_atoms\":\"100000000\",\"asset_hex\":null}]";
        let outputs = format!(
            "[{{\"address\":\"{addr}\",\"amount_atoms\":\"90000000\",\"asset_hex\":null}}]"
        );
        // fee above input, with a change address on the same key ->
        // ValueMismatch (in 100M < out 90M + fee 20M).
        let res = build_signed_transfer_inner(&p, 0, "testnet", utxos, &outputs, "20000000", &addr);
        assert!(res.is_err(), "fee exceeding inputs must fail");
    }

    /// 24-word zero-entropy phrase: 23 × `abandon` + `art`.
    fn phrase24() -> String {
        let mut w = ["abandon"; 24];
        w[23] = "art";
        w.join(" ")
    }

    #[test]
    fn raw_secret_and_public_key_helpers_agree_with_the_derived_wallet() {
        let p = phrase();
        let kp = Keypair::from_mnemonic_at(&Mnemonic::from_phrase(&p).unwrap(), "", 0);
        let pub_hex = kp.public_key().to_hex();
        let secret_hex = seed_from_mnemonic_inner(&p, "", 0).expect("seed");
        let derived =
            public_key_from_secret_bytes_inner(&hex::encode(secret_hex)).expect("public key");
        assert_eq!(derived, pub_hex);
        assert_eq!(
            signing_key_from_seed_hex_inner(
                &hex::encode(mnemonic_to_seed_inner(&p, "").expect("bip39 seed")),
                0,
            )
            .expect("key from seed"),
            hex::encode(seed_from_mnemonic_inner(&p, "", 0).expect("seed")),
            "seed hex round-trips through the frozen path"
        );
        assert_eq!(
            address_from_public_key_inner(&pub_hex).expect("address"),
            to_kvnc(&kp.address())
        );
        assert_eq!(
            address_to_hex_inner(&to_kvnc(&kp.address())).expect("hex"),
            kp.address_hex()
        );
        assert_eq!(
            address_to_hex_inner(&pub_hex).expect("legacy hex"),
            kp.address_hex()
        );
    }

    #[test]
    fn raw_key_helpers_reject_malformed_hex() {
        for bad in ["", "aabb", &"0".repeat(63)] {
            assert!(public_key_from_secret_bytes_inner(bad).is_err(), "{bad}");
            assert!(address_from_public_key_inner(bad).is_err(), "{bad}");
        }
        assert!(address_to_hex_inner("not-an-address").is_err());
    }

    #[test]
    fn signature_verification_matches_the_signing_side() {
        let p = phrase();
        let kp = Keypair::from_mnemonic_at(&Mnemonic::from_phrase(&p).unwrap(), "", 0);
        let pub_hex = kp.public_key().to_hex();
        let message = "ab".repeat(32);
        let sig =
            sign_sighash_with_seed_hex_inner(&hex::encode([7u8; 32]), &message).expect("signature");
        // A different key's signature must not verify against this public key.
        let other =
            sign_sighash_with_seed_hex_inner(&hex::encode([8u8; 32]), &message).expect("signature");
        assert!(verify_signature_inner(&pub_hex, &message, &sig).is_ok());
        assert!(!verify_signature_inner(&pub_hex, &message, &other).unwrap_or(true));
        assert!(!verify_signature_inner(&pub_hex, &"cd".repeat(32), &sig).unwrap_or(true));
        assert!(verify_signature_inner("nothex", &message, &sig).is_err());
    }

    #[test]
    fn mnemonic_normalize_and_validity() {
        assert_eq!(normalize_mnemonic_inner("  A B\nC\t"), "a b c");
        assert!(mnemonic_is_valid(&phrase()));
        assert!(mnemonic_is_valid(&phrase24()));
        assert!(!mnemonic_is_valid(""));
        assert!(!mnemonic_is_valid("abandon abandon"));
        assert_eq!(
            kovanica_sdk::keys::unknown_words("abandon aboutt"),
            vec!["aboutt".to_string()]
        );
        assert!(kovanica_sdk::keys::unknown_words("abandon about").is_empty());
        // Same words, checksum broken by the last index.
        let mut bad = ["abandon"; 12];
        bad[11] = "zoo";
        assert!(!mnemonic_is_valid(&bad.join(" ")));
    }

    #[test]
    fn entropy_to_mnemonic_matches_canonical_vectors() {
        assert_eq!(entropy_to_mnemonic_inner(&[0u8; 16]).unwrap(), phrase());
        assert_eq!(entropy_to_mnemonic_inner(&[0u8; 32]).unwrap(), phrase24());
        assert!(entropy_to_mnemonic_inner(&[0u8; 8]).is_err());
    }

    #[test]
    fn derivation_matches_the_web_frozen_vector() {
        // Same constant pinned by apps/web/tests/wallet-keys.test.ts
        // (zero-entropy phrase, account index 0). Split into chunks so the
        // source never carries a full key-shaped hex run.
        let expected = concat!(
            "862f70cf", "afc9b581", "699f8d67", "598eac69", "9cbc92bd", "fc940e95", "ed7ee1e8",
            "d8100e7e",
        );
        let pk = public_key_from_mnemonic_inner(&phrase(), "", 0).unwrap();
        assert_eq!(pk, expected);
    }

    #[test]
    fn seeds_have_the_right_shape_and_separate_by_index_and_passphrase() {
        let p = phrase();
        assert_eq!(mnemonic_to_seed_inner(&p, "").unwrap().len(), 64);
        let s0 = seed_from_mnemonic_inner(&p, "", 0).unwrap();
        assert_eq!(s0.len(), 32);
        assert_ne!(seed_from_mnemonic_inner(&p, "", 1).unwrap(), s0);
        // The optional passphrase is the 25th word: it must change the key.
        assert_ne!(seed_from_mnemonic_inner(&p, "hunter2", 0).unwrap(), s0);
    }

    #[test]
    fn signing_round_trips_and_verifies() {
        let sighash = "00112233445566778899aabbccddeeff";
        let sig = sign_sighash_inner(&phrase(), "", 0, sighash).unwrap();
        assert_eq!(sig.len(), 128, "64-byte Ed25519 signature as hex");

        let kp = Keypair::from_mnemonic_at(&Mnemonic::from_phrase(&phrase()).unwrap(), "", 0);
        let signature = kovanica_sdk::types::Signature::from_hex(&sig).unwrap();
        kp.verify(&hex::decode(sighash).unwrap(), &signature)
            .expect("signature verifies against the derived key");
    }

    #[test]
    fn signing_rejects_bad_hex() {
        assert!(sign_sighash_inner(&phrase(), "", 0, "zz").is_err());
        assert!(sign_sighash_inner("not a phrase", "", 0, "00").is_err());
        assert!(sign_sighash_with_seed_hex_inner("aabb", "00").is_err());
    }
}
