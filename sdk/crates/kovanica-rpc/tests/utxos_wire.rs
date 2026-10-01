//! Wire parity for `/api/utxos` (offline fixture tests).
//!
//! The JSON shapes below are copied byte-for-byte from `kovanica-node`
//! `explorer.rs` `utxos_json` (+ `node.rs` `asset_id_to_wire`):
//! rows render as `{"tx","index","value","asset_id","kind","metadata_hash",
//! "collection_id"}` where `asset_id` is `"KVNC"` for native and lowercase
//! 64-hex otherwise. The top level carries `address`, `balance` and the
//! per-asset `balances` map.
//!
//! These tests are offline (no `live-testnet` gate): they lock the SDK to the
//! node's wire contract, so a mismatch shows up in CI rather than on testnet.

use kovanica_rpc::{RpcError, UtxosResponse};
use kovanica_types::{Address, Amount, AssetId, Hash32, Utxo};

fn p2pk_addr(byte: u8) -> Address {
    Address::p2pk([byte; 32])
}

fn tx_hex(byte: u8) -> String {
    Hash32([byte; 32]).to_hex()
}

/// Body exactly as `utxos_json` would render it: one native row, one
/// fungible-asset row, plus the per-asset balance map.
fn fixture_json() -> String {
    let asset = AssetId(Hash32([0x42; 32]));
    // All interpolations are plain lowercase hex (`Display` for AssetId), so
    // they are quoted directly — same rendering as the node's `jstr` output.
    format!(
        r#"{{"address":"{}","balance":1234,"balances":{{"{}":1000000}},"utxos":[
          {{"tx":"{}","index":0,"value":1000000,"asset_id":"KVNC","kind":null,"metadata_hash":null,"collection_id":null}},
          {{"tx":"{}","index":3,"value":7,"asset_id":"{}","kind":"fungible","metadata_hash":null,"collection_id":null}}
        ],"limit":100,"offset":0,"total":2}}"#,
        p2pk_addr(0xAA).to_hex(),
        asset,
        tx_hex(0x11),
        tx_hex(0x22),
        asset,
    )
}

#[test]
fn utxos_wire_parses_node_shape() {
    let resp: UtxosResponse = serde_json::from_str(&fixture_json()).expect("parse /api/utxos body");
    assert_eq!(resp.address, p2pk_addr(0xAA).to_hex());
    assert_eq!(resp.balance, 1234);
    assert_eq!(resp.total, 2);

    let rows = &resp.utxos;
    assert_eq!(rows.len(), 2);

    // Native row.
    assert_eq!(rows[0].tx, tx_hex(0x11));
    assert_eq!(rows[0].index, 0);
    assert_eq!(rows[0].value, 1_000_000);
    assert_eq!(rows[0].asset_id.as_deref(), Some("KVNC"));
    assert_eq!(rows[0].kind.as_deref(), None);

    // Fungible row.
    assert_eq!(rows[1].tx, tx_hex(0x22));
    assert_eq!(rows[1].index, 3);
    assert_eq!(rows[1].value, 7);
    let expected_asset_hex = AssetId(Hash32([0x42; 32])).to_string();
    assert_eq!(
        rows[1].asset_id.as_deref(),
        Some(expected_asset_hex.as_str())
    );
    assert_eq!(rows[1].kind.as_deref(), Some("fungible"));

    // Per-asset balance map (asset hex → atoms).
    let asset_hex = AssetId(Hash32([0x42; 32])).to_string();
    assert_eq!(resp.balances.get(&asset_hex), Some(&1_000_000u64));
}

#[test]
fn utxo_item_maps_to_domain_with_query_address() {
    let resp: UtxosResponse = serde_json::from_str(&fixture_json()).expect("parse /api/utxos body");
    let owner = Address::from_hex(&resp.address).expect("query address parses");

    let native: Utxo = resp.utxos[0].into_domain(&owner).unwrap();
    assert_eq!(native.tx_hash, Hash32([0x11; 32]));
    assert_eq!(native.vout, 0);
    assert_eq!(native.amount, Amount::from_atoms(1_000_000));
    assert!(native.asset_id.is_native());
    assert_eq!(native.address, owner);

    let asset: Utxo = resp.utxos[1].into_domain(&owner).unwrap();
    assert_eq!(asset.asset_id, AssetId(Hash32([0x42; 32])));
    assert_eq!(asset.vout, 3);
    assert_eq!(asset.amount, Amount::from_atoms(7));
}

#[test]
fn utxo_item_rejects_malformed_asset_id() {
    let mut resp: UtxosResponse =
        serde_json::from_str(&fixture_json()).expect("parse /api/utxos body");
    resp.utxos[1].asset_id = Some("not-hex".into());
    let owner = p2pk_addr(0xAA);
    let err = resp.utxos[1].into_domain(&owner).unwrap_err();
    assert!(
        matches!(err, RpcError::Decode(_)),
        "asset_id must be 64-hex or KVNC: {err:?}"
    );
}
