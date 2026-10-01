//! Bridge demo — how to use HTLC bridges on the Kovanica network.
//!
//! Shows the *client side* of creating a cross-chain bridge transaction:
//!
//! 1. Build an HTLC lock transaction that bridges KVNC to another chain.
//! 2. Sign the transaction with the sender's key.
//! 3. Prepare for broadcast to the network.
//!
//! HTLC bridges enable atomic swaps between Kovanica and other chains
//! (ETH, BTC, XRP, DOGE, SOL). The bridge uses the same HTLC mechanism
//! as RFC-004 atomic swaps, with additional relay logic for cross-chain
//! communication.
//!
//! ```bash
//! cargo run -p kovanica-sdk --example bridge
//! ```

use kovanica_sdk::prelude::*;

/// Deterministic demo keypair (test only — never use fixed bytes in production).
fn demo_pair(k: u64) -> Keypair {
    let mut secret = [0u8; 32];
    secret[..8].copy_from_slice(&k.to_le_bytes());
    Keypair::from_secret_bytes(secret)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let sender = demo_pair(1);
    let recipient = demo_pair(2);

    // 1. Bridge parameters
    let bridge_amount = Amount::from_kvnc(100);
    let target_chain = "ETH";
    let target_address = "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18";
    let preimage: &[u8] = b"kovanica-bridge-preimage";
    let timeout = 1440u64; // blocks

    println!("=== HTLC bridge (client-side) ===");
    println!("sender       : {}", sender.address().to_hex());
    println!("recipient    : {}", recipient.address().to_hex());
    println!("amount       : {} KVNC", bridge_amount.to_kvnc());
    println!("target chain : {target_chain}");
    println!("target addr  : {target_address}");
    println!("timeout      : {timeout} blocks");

    // 2. Build an HTLC lock transaction for the bridge.
    let htlc = HtlcScript::new(
        *blake3::hash(preimage).as_bytes(),
        recipient.public_key().0,
        sender.public_key().0,
        timeout,
    )?;

    let bridge_tx = HtlcBuilder::new(htlc)
        .network(NetworkId::Testnet)
        .add_input(Utxo {
            tx_hash: TxHash::ZERO,
            vout: 0,
            amount: Amount::from_kvnc(101),
            asset_id: AssetId::NATIVE,
            address: sender.address(),
        })
        .amount(Amount::from_kvnc(100))
        .set_fee(Amount::from_atoms(10_000))
        .set_change(sender.address())
        .build()?;

    let signed = SignedTx::sign(bridge_tx, &sender)?;

    println!("\n=== Bridge transaction ===");
    println!("htlc address : {}", to_kvnc(&htlc.address()));
    println!("tx size      : {} bytes", signed.tx.encode().len());
    println!("sighash      : {}", signed.tx.sighash_hex());
    println!("tx hex       : {} bytes", signed.tx_hex().len() / 2);
    println!(
        "broadcast    : POST /api/submit_tx {{\"tx_hex\":\"{}\"}}",
        signed.tx_hex()
    );
    println!("\nNote: Cross-chain bridges require relay nodes for communication.");
    Ok(())
}
