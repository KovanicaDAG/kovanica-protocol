//! HTLC atomic-swap demo (RFC-004 / KVP-104) — locking, redeem and refund.
//!
//! Alice locks funds to an HTLC template (version 0x04 address) funded by her
//! own UTXO; Bob reveals the preimage and redeems; otherwise Alice refunds
//! after the timeout. Both paths are demonstrated locally — no network calls.
//!
//! ```bash
//! cargo run -p kovanica-sdk --example htlc_swap
//! ```

use kovanica_sdk::keys::to_kvnc;
use kovanica_sdk::prelude::*;

/// Deterministic demo keypair (test only — never use fixed bytes in production).
fn demo_pair(k: u64) -> Keypair {
    let mut secret = [0u8; 32];
    secret[..8].copy_from_slice(&k.to_le_bytes());
    Keypair::from_secret_bytes(secret)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let alice = demo_pair(1);
    let bob = demo_pair(2);
    let preimage: &[u8] = b"kovanica-htlc-preimage";

    // 1. Alice locks 4 KVNC to an HTLC: Bob can redeem with the preimage,
    //    Alice can refund after height 1440.
    let htlc = HtlcScript::new(
        *blake3::hash(preimage).as_bytes(),
        bob.public_key().0,
        alice.public_key().0,
        1440,
    )?;
    let lock_tx = HtlcBuilder::new(htlc)
        .network(NetworkId::Testnet)
        .add_input(Utxo {
            tx_hash: TxHash::ZERO,
            vout: 0,
            amount: Amount::from_kvnc(5),
            asset_id: AssetId::NATIVE,
            address: alice.address(),
        })
        .amount(Amount::from_kvnc(4))
        .set_fee(Amount::from_atoms(10_000))
        .set_change(alice.address())
        .build()?;

    println!("=== HTLC lock (unsigned) ===");
    println!("htlc address : {}", to_kvnc(&htlc.address()));
    println!("outputs      : {}", lock_tx.outputs.len());
    println!("lock tx size : {} bytes", lock_tx.encode().len());

    // 2. Bob redeems: signs the sighash of an unsigned transfer spending the
    //    HTLC UTXO, revealing the preimage in the witness.
    let redeem_utxo = Utxo {
        tx_hash: TxHash::ZERO,
        vout: 0,
        amount: Amount::from_kvnc(4),
        asset_id: AssetId::NATIVE,
        address: htlc.address(),
    };
    let redeem_tx = TransferBuilder::new()
        .network(NetworkId::Testnet)
        .add_input(redeem_utxo)
        .add_native_output(bob.address(), Amount::from_kvnc(3))
        .set_fee(Amount::from_atoms(10_000))
        .set_change(bob.address())
        .build()?;
    let bob_sig = bob.sign(&redeem_tx.sighash()).0;
    let redeem_witness = htlc.redeem_witness(preimage, bob_sig);
    assert_eq!(
        redeem_witness.len(),
        3,
        "[template, preimage, recipient_sig]"
    );
    assert_eq!(
        *blake3::hash(&redeem_witness[1]).as_bytes(),
        *htlc.preimage_hash(),
        "ledger rule: BLAKE3(preimage) == preimage_hash"
    );
    println!("\n=== Bob redeem ===");
    println!("witness items : {}", redeem_witness.len());
    println!("preimage ok   : true (BLAKE3 matches the locked hash)");

    // 3. Alternatively Alice refunds after the timeout with [template, sig].
    let refund_sig = alice.sign(&redeem_tx.sighash()).0;
    let refund_witness = htlc.refund_witness(refund_sig);
    assert_eq!(refund_witness.len(), 2, "[template, sender_sig]");
    println!("\n=== Alice refund (after height {}) ===", htlc.timeout());
    println!("witness items : {}", refund_witness.len());
    Ok(())
}
