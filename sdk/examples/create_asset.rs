//! KVP-102 asset identity demo — derivation and live balance listing.
//!
//! Shows the *client side* of working with non-native assets:
//!
//! 1. A deterministic asset identity is derived locally (BLAKE3 of a
//!    description + issuer key). On the current Kovanica networks the asset
//!    registry is seeded at genesis and issuance is operator-only, so there is
//!    no public mint endpoint — an asset must already exist before its units
//!    can move (see `transfer_asset`). KVP-106 (NFT/RWA, draft) defines its own
//!    SHA-256-prefixed derivation; this example intentionally stays on the
//!    plain KVP-102 fungible path.
//! 2. If `KOVANICA_API` is set, the *read-only* `/api/utxos` call lists the
//!    address's per-asset balances (`balances` map) — run it against your own
//!    node or the public explorer. No keys are sent anywhere.
//!
//! ```bash
//! cargo run -p kovanica-sdk --example create_asset                 # offline
//! KOVANICA_API=https://api.kovanica.online cargo run -p kovanica-sdk --example create_asset
//! ```

use kovanica_sdk::prelude::*;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let issuer = Keypair::from_secret_bytes([7u8; 32]);

    // 1. Derive a deterministic fungible-asset identity in the client.
    let mut h = blake3::Hasher::new();
    h.update(b"KVP-102 fungible asset");
    h.update(&issuer.public_key().0);
    h.update(b"/kovanica-sdk demo token");
    let asset = AssetId(Hash32(*h.finalize().as_bytes()));
    println!("=== KVP-102 asset identity (client-side) ===");
    println!("asset id     : {asset}"); // wire form: lowercase 64-hex
    println!("native       : KVNC (zero hash)");
    println!("registration : genesis/operator only on live networks — no public mint endpoint");

    // 2. Optional read-only live listing of per-asset balances.
    let Ok(base) = std::env::var("KOVANICA_API") else {
        println!("\n(skip live listing: set KOVANICA_API to query /api/utxos)");
        return Ok(());
    };
    let client = Client::new(base)?;
    let addr = issuer.address();
    tokio::runtime::Runtime::new()?.block_on(async {
        let page = client.get_utxos(&addr, Some(100), Some(0)).await?;
        println!("\n=== /api/utxos for {} ===", addr.to_hex());
        println!("native balance : {} atoms", page.balance);
        if page.balances.is_empty() {
            println!("per-asset      : (none)");
        } else {
            for (asset_hex, atoms) in &page.balances {
                println!("{asset_hex} : {atoms} atoms");
            }
        }
        Ok::<_, Box<dyn std::error::Error>>(())
    })?;
    Ok(())
}
