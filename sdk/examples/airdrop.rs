//! Airdrop demo — how to claim airdrops on the Kovanica network.
//!
//! Shows the *client side* of creating an airdrop claim transaction:
//!
//! 1. Create an airdrop campaign with a list of recipients.
//! 2. Build the Merkle tree and compute the Merkle root.
//! 3. Generate a Merkle proof for a specific claimant.
//! 4. Build a claim transaction that includes the Merkle proof.
//! 5. Sign the transaction with the claimant's key.
//! 6. Prepare for broadcast to the network.
//!
//! Airdrops are distributed to stakers and miners per the token listing
//! and presale contracts. The claim transaction includes a Merkle proof
//! of eligibility.
//!
//! ```bash
//! cargo run -p kovanica-sdk --example airdrop
//! ```

use kovanica_sdk::prelude::*;
use kovanica_airdrop::{AirdropCampaign, AirdropLeaf, build_merkle_root, generate_proof};
use kovanica_types::{Address, AssetId, Hash32};

/// Deterministic demo keypair (test only — never use fixed bytes in production).
fn demo_pair(k: u64) -> Keypair {
    let mut secret = [0u8; 32];
    secret[..8].copy_from_slice(&k.to_le_bytes());
    Keypair::from_secret_bytes(secret)
}

/// Create a deterministic address from a seed byte.
fn demo_address(seed: u8) -> Address {
    let mut bytes = [seed; 33];
    bytes[0] = 0x00; // P2PK version
    Address::from_versioned(bytes)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Airdrop Demo (with real Merkle proofs) ===\n");

    // 1. Define recipients for the airdrop campaign
    // In practice, this would come from a CSV file or database
    let recipients = vec![
        (demo_address(0x01), 1_000_000_000u64),  // 10 KVNC
        (demo_address(0x02), 2_000_000_000u64),  // 20 KVNC
        (demo_address(0x03), 500_000_000u64),    // 5 KVNC
        (demo_address(0x04), 750_000_000u64),    // 7.5 KVNC
        (demo_address(0x05), 1_500_000_000u64),  // 15 KVNC
    ];

    // 2. Build AirdropLeaf objects
    let leaves: Vec<AirdropLeaf> = recipients
        .into_iter()
        .map(|(address, amount)| AirdropLeaf { address, amount })
        .collect();

    // 3. Build the Merkle tree and compute the root
    let merkle_root = build_merkle_root(&leaves);
    println!("=== Merkle Tree ===");
    println!("Total recipients: {}", leaves.len());
    println!("Merkle root     : {}", merkle_root);

    // 4. Campaign metadata
    let campaign_id = Hash32([0x42; 32]); // Campaign identifier
    let total_amount: u64 = leaves.iter().map(|l| l.amount).sum();
    let asset_id = AssetId::NATIVE;
    let expires_at = 1_000_000u64; // Block height when campaign expires

    let campaign = AirdropCampaign {
        id: campaign_id,
        total_amount,
        asset_id,
        expires_at,
        merkle_root,
    };

    println!("\n=== Campaign ===");
    println!("Campaign ID     : {}", campaign.id);
    println!("Total amount    : {} KVNC", total_amount as f64 / 100_000_000.0);
    println!("Asset           : {}", campaign.asset_id);
    println!("Expires at      : height {}", campaign.expires_at);
    println!("Merkle root     : {}", campaign.merkle_root);

    // 5. Generate a Merkle proof for a specific claimant (e.g., recipient index 2)
    let claimant_index = 2; // Third recipient (demo_address(0x03))
    let claimant_address = leaves[claimant_index].address;
    let claimant_amount = leaves[claimant_index].amount;

    let proof = generate_proof(&leaves, claimant_index)
        .expect("Failed to generate proof - claimant index out of bounds");

    println!("\n=== Merkle Proof (for claimant index {}) ===", claimant_index);
    println!("Claimant address: {}", claimant_address);
    println!("Claimant amount : {} KVNC", claimant_amount as f64 / 100_000_000.0);
    println!("Siblings count  : {}", proof.siblings.len());
    println!("Path directions : {:?}", proof.is_left);

    // 6. Verify the proof locally before submitting
    let proof_valid = proof.verify(campaign.merkle_root);
    println!("Proof valid     : {}", if proof_valid { "✓ YES" } else { "✗ NO" });

    if !proof_valid {
        eprintln!("ERROR: Proof does not verify against campaign Merkle root!");
        return Err("Invalid proof".into());
    }

    // 7. Build a claim transaction (using TransferBuilder as placeholder)
    // In production, this would be a dedicated airdrop claim transaction type
    // that includes the Merkle proof in the witness.
    let claimant = demo_pair(claimant_index as u64 + 1); // Different keypair for demo

    println!("\n=== Claim Transaction ===");
    println!("Claimant        : {}", claimant.address().to_hex());
    println!("Claiming        : {} KVNC", claimant_amount as f64 / 100_000_000.0);
    println!("Campaign ID     : {}", campaign.id);
    println!("Merkle proof    : {} siblings", proof.siblings.len());

    // 8. Simulate the claim transaction structure
    // The actual on-chain transaction would include the Merkle proof in the witness
    // for the airdrop claim script to verify.
    let claim_tx = TransferBuilder::new()
        .network(NetworkId::Testnet)
        .add_input(Utxo {
            tx_hash: TxHash::ZERO,
            vout: 0,
            amount: Amount::from_atoms(claimant_amount + 100_000_000), // claimant amount + change
            asset_id: AssetId::NATIVE,
            address: claimant.address(),
        })
        .add_native_output(claimant.address(), Amount::from_atoms(claimant_amount))
        .set_fee(Amount::from_atoms(10_000))
        .set_change(claimant.address())
        .build()?;

    let signed = SignedTx::sign(claim_tx, &claimant)?;

    println!("\n=== Signed Claim Transaction ===");
    println!("tx size      : {} bytes", signed.tx.encode().len());
    println!("sighash      : {}", signed.tx.sighash_hex());
    println!("tx hex       : {} bytes", signed.tx_hex().len() / 2);
    println!(
        "broadcast    : POST /api/submit_tx {{\"tx_hex\":\"{}\"}}",
        signed.tx_hex()
    );

    // 9. Show the claim structure that would be submitted to the node
    // (when the node supports /api/prepare/airdrop-claim endpoint)
    let claim_structure = serde_json::json!({
        "type": "airdrop_claim",
        "campaign_id": campaign.id.to_hex(),
        "claimant": claimant.address().to_hex(),
        "amount": claimant_amount,
        "asset_id": campaign.asset_id.to_string(),
        "merkle_proof": {
            "leaf": {
                "address": proof.leaf.address.to_hex(),
                "amount": proof.leaf.amount,
            },
            "siblings": proof.siblings.iter().map(|h| h.to_hex()).collect::<Vec<_>>(),
            "is_left": proof.is_left,
        },
    });

    println!("\n=== Claim Structure (for node submission) ===");
    println!("{}", serde_json::to_string_pretty(&claim_structure)?);

    println!("\n=== Summary ===");
    println!("✓ Campaign created with {} recipients", leaves.len());
    println!("✓ Merkle root computed: {}", merkle_root);
    println!("✓ Merkle proof generated for claimant index {}", claimant_index);
    println!("✓ Proof verified against campaign root");
    println!("✓ Claim transaction prepared and signed");
    println!("\nNote: On live networks, submit via node's airdrop claim endpoint");
    println!("      which verifies the Merkle proof on-chain.");

    Ok(())
}