//! WASM bindings for kovanica-sdk.
//!
//! Build with:
//! ```text
//! wasm-pack build bindings/kovanica-wasm --target web
//! ```
//!
//! This is a minimal surface for the first browser integration.

use kovanica_sdk::keys::{decode_address, to_kvnc};
use kovanica_sdk::prelude::*;
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
}
