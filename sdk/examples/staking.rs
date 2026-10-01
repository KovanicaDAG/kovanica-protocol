//! Staking demo — how to stake KVNC on the Kovanica network.
//!
//! Shows the *client side* of creating a staking transaction:
//!
//! 1. Build a staking transaction that locks KVNC for a specified period.
//! 2. Sign the transaction with the staker's key.
//! 3. Prepare for broadcast to the network.
//!
//! Staking rewards are distributed per RFC-006 emission curve. The staker
//! receives rewards proportional to their stake and lock duration.
//!
//! ```bash
//! cargo run -p kovanica-sdk --example staking
//! ```

use kovanica_sdk::prelude::*;

/// Deterministic demo keypair (test only — never use fixed bytes in production).
fn demo_pair(k: u64) -> Keypair {
    let mut secret = [0u8; 32];
    secret[..8].copy_from_slice(&k.to_le_bytes());
    Keypair::from_secret_bytes(secret)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let staker = demo_pair(1);

    // 1. Staking parameters
    let stake_amount = Amount::from_kvnc(10_000);
    let lock_period = 10_000u64; // blocks
    let current_height = 1_000_000u64;

    println!("=== Staking transaction (client-side) ===");
    println!("staker       : {}", staker.address().to_hex());
    println!("stake amount : {} KVNC", stake_amount.to_kvnc());
    println!("lock period  : {lock_period} blocks");
    println!("unlock height: {}", current_height + lock_period);

    // 2. Build a staking transaction (placeholder for staking contract).
    //    On live networks, this would be a special transaction type that
    //    locks funds in a staking contract.
    let stake_tx = TransferBuilder::new()
        .network(NetworkId::Testnet)
        .add_input(Utxo {
            tx_hash: TxHash::ZERO,
            vout: 0,
            amount: Amount::from_kvnc(10_001),
            asset_id: AssetId::NATIVE,
            address: staker.address(),
        })
        .add_native_output(staker.address(), Amount::from_kvnc(10_000))
        .set_fee(Amount::from_atoms(10_000))
        .set_change(staker.address())
        .build()?;

    let signed = SignedTx::sign(stake_tx, &staker)?;

    println!("\n=== Staking transaction ===");
    println!("tx size      : {} bytes", signed.tx.encode().len());
    println!("sighash      : {}", signed.tx.sighash_hex());
    println!("tx hex       : {} bytes", signed.tx_hex().len() / 2);
    println!(
        "broadcast    : POST /api/submit_tx {{\"tx_hex\":\"{}\"}}",
        signed.tx_hex()
    );
    println!("\nNote: Staking rewards are distributed per RFC-006 emission curve.");
    Ok(())
}
