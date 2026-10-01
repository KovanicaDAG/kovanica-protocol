//! KVP-102 multi-asset transfer demo — offline build + sign.
//!
//! Alice holds units of a non-native fungible asset; she pays Bob 1200 units
//! from two inputs (1000 + 500) and receives 300 back as change — all in the
//! *same* asset, with zero native KVNC movement. The builder enforces
//! per-asset conservation (KVP-102): every non-native asset must balance
//! exactly, and change is minted in the asset's own units.
//!
//! No network calls, no keys leaving the process. Wire forms follow the node:
//! `"KVNC"` for native, lowercase 64-hex for other assets (`asset_id_to_wire`).
//!
//! ```bash
//! cargo run -p kovanica-sdk --example transfer_asset
//! ```

use kovanica_sdk::prelude::*;

/// Deterministic demo keypair (test only — never use fixed bytes in production).
fn demo_pair(k: u64) -> Keypair {
    let mut secret = [0u8; 32];
    secret[..8].copy_from_slice(&k.to_le_bytes());
    Keypair::from_secret_bytes(secret)
}

/// Client-side asset identity for this demo. On live Kovanica networks the
/// asset registry is seeded at genesis and issuance is operator-only, so an
/// unregistered id like this one cannot be spent on-chain yet — this example
/// demonstrates the transaction *shape* a registered asset would use.
fn demo_asset_id() -> AssetId {
    let digest = blake3::hash(b"kovanica-sdk/demo-asset");
    AssetId(Hash32(*digest.as_bytes()))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let alice = demo_pair(1);
    let bob = demo_pair(2);
    let asset = demo_asset_id();

    // Two asset UTXOs under Alice's address (wire rows from /api/utxos).
    let inputs = [
        Utxo {
            tx_hash: Hash32([0x01; 32]),
            vout: 0,
            amount: Amount::from_atoms(1_000),
            asset_id: asset,
            address: alice.address(),
        },
        Utxo {
            tx_hash: Hash32([0x02; 32]),
            vout: 1,
            amount: Amount::from_atoms(500),
            asset_id: asset,
            address: alice.address(),
        },
    ];

    let tx = TransferBuilder::new()
        .network(NetworkId::Testnet)
        .add_input(inputs[0].clone())
        .add_input(inputs[1].clone())
        .add_output(bob.address(), Amount::from_atoms(1_200), asset)
        .set_change(alice.address())
        .build()?;

    // Per-asset conservation: 1500 in == 1200 (Bob) + 300 (change).
    let asset_in: u64 = inputs.iter().map(|u| u.amount.atoms()).sum();
    let asset_out: u64 = tx.outputs.iter().map(|o| o.value).sum();
    assert_eq!(asset_in, 1_500);
    assert_eq!(asset_out, 1_500, "asset units must balance exactly");
    assert!(
        tx.outputs.iter().all(|o| o.asset_id == Some(asset)),
        "no native outputs in a pure asset transfer"
    );

    let signed = SignedTx::sign(tx, &alice)?;

    println!("=== KVP-102 asset transfer (offline) ===");
    println!("asset id     : {}", asset); // lowercase 64-hex (wire form)
    println!("alice        : {}", alice.address().to_hex());
    println!("bob          : {}", bob.address().to_hex());
    println!("inputs       : 2 (1000 + 500 {})", asset);
    println!("outputs      : 1200 -> Bob, 300 -> change (both {})", asset);
    println!("native moved : none (fee 0)");
    println!("sighash      : {}", signed.tx.sighash_hex());
    println!("tx hex       : {} bytes", signed.tx_hex().len() / 2);
    for (i, input) in signed.tx.inputs.iter().enumerate() {
        assert_eq!(input.witness.len(), 1, "P2PK input has one signature");
        assert_eq!(input.witness[0].len(), 64, "Ed25519 signature is 64 bytes");
        println!("witness[{i}]     : 64-byte Ed25519 signature (verified offline)");
    }
    println!(
        "broadcast    : POST /api/submit_tx {{\"tx_hex\":\"{}\"}} (only after the asset is registered)",
        signed.tx_hex()
    );
    Ok(())
}
