//! Generate a new 24-word mnemonic and print the derived address.
//!
//! ```bash
//! cargo run -p kovanica-sdk --example generate_wallet
//! ```

use kovanica_sdk::keys::to_kvnc;
use kovanica_sdk::prelude::*;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mnemonic = Mnemonic::generate(WordCount::Words24)?;
    let keypair = Keypair::from_mnemonic(&mnemonic, "");

    println!("=== Kovanica wallet (test only) ===");
    println!("mnemonic : {}", mnemonic.phrase());
    println!("address  : {}", to_kvnc(&keypair.address()));
    println!("pubkey   : {}", keypair.public_key().to_hex());
    println!();
    println!("Write the mnemonic down. Never share it. Never send it to any server.");
    Ok(())
}
