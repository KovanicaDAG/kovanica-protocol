//! Token listing demo — how to list a token on the Kovanica DEX.
//!
//! Shows the *client side* of creating a token listing transaction:
//!
//! 1. Derive a deterministic asset identity (BLAKE3 of description + issuer).
//! 2. Build a listing transaction that registers the asset for trading.
//! 3. Sign and prepare the transaction for broadcast.
//!
//! On live Kovanica networks, token issuance is operator-only (genesis-seeded).
//! This example demonstrates the transaction *shape* a listing would use once
//! the asset is registered.
//!
//! ```bash
//! cargo run -p kovanica-sdk --example token_listing
//! ```

use kovanica_sdk::prelude::*;

/// Deterministic demo keypair (test only — never use fixed bytes in production).
fn demo_pair(k: u64) -> Keypair {
    let mut secret = [0u8; 32];
    secret[..8].copy_from_slice(&k.to_le_bytes());
    Keypair::from_secret_bytes(secret)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let issuer = demo_pair(1);

    // 1. Derive a deterministic fungible-asset identity.
    let mut h = blake3::Hasher::new();
    h.update(b"KVP-102 fungible asset");
    h.update(&issuer.public_key().0);
    h.update(b"/kovanica-sdk listing demo");
    let asset = AssetId(Hash32(*h.finalize().as_bytes()));

    println!("=== Token listing (client-side) ===");
    println!("asset id     : {asset}");
    println!("issuer       : {}", issuer.address().to_hex());
    println!("name         : Kovanica Demo Token");
    println!("symbol       : KDT");
    println!("decimals     : 8");
    println!("total supply : 1,000,000 units");

    // 2. Build a listing transaction (placeholder for DEX integration).
    //    On live networks, this would be a special transaction type that
    //    registers the asset with the DEX contract.
    let listing_tx = TransferBuilder::new()
        .network(NetworkId::Testnet)
        .add_input(Utxo {
            tx_hash: TxHash::ZERO,
            vout: 0,
            amount: Amount::from_kvnc(1),
            asset_id: AssetId::NATIVE,
            address: issuer.address(),
        })
        .add_native_output(issuer.address(), Amount::from_kvnc(999_999))
        .set_fee(Amount::from_atoms(10_000))
        .set_change(issuer.address())
        .build()?;

    let signed = SignedTx::sign(listing_tx, &issuer)?;

    println!("\n=== Listing transaction ===");
    println!("tx size      : {} bytes", signed.tx.encode().len());
    println!("sighash      : {}", signed.tx.sighash_hex());
    println!("tx hex       : {} bytes", signed.tx_hex().len() / 2);
    println!(
        "broadcast    : POST /api/submit_tx {{\"tx_hex\":\"{}\"}}",
        signed.tx_hex()
    );
    println!("\nNote: On live networks, token listing requires operator approval.");
    Ok(())
}
