//! Kovanica CLI — command-line client for the Kovanica (KVNC) BlockDAG testnet.

mod api;
mod wallet;

use clap::{Parser, Subcommand};
use serde_json::Value;

use api::Client;
use wallet::{sign_transfer, Address};

#[derive(Parser)]
#[command(name = "kovanica", version, about = "Kovanica (KVNC) BlockDAG CLI")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Show chain head
    Head { url: String },

    /// Show P2P info
    P2p { url: String },

    /// Show network bootstrap params
    Bootstrap { url: String },

    /// Show full state snapshot
    State { url: String },

    /// Show balance + unspent outputs for an address (hex or kvnc…dag)
    UtXOs { url: String, address: String },

    /// Prepare a transfer (returns sighash to sign)
    Prepare {
        url: String,
        from: String,
        to: String,
        amount: u64,
    },

    /// Submit a signed transfer
    Submit {
        url: String,
        from: String,
        to: String,
        amount: u64,
        sig: String,
    },

    /// Generate a new wallet seed
    WalletNew,

    /// Sign a prepared transfer with a seed
    WalletSign { seed: u64, sighash: String },
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Head { url } => {
            let client = Client::new(&url);
            let res = client.head()?;
            print_json(&res);
        }
        Commands::P2p { url } => {
            let client = Client::new(&url);
            let res = client.p2p()?;
            print_json(&res);
        }
        Commands::Bootstrap { url } => {
            let client = Client::new(&url);
            let res = client.bootstrap()?;
            print_json(&res);
        }
        Commands::State { url } => {
            let client = Client::new(&url);
            let res = client.state()?;
            print_json(&res);
        }
        Commands::UtXOs { url, address } => {
            let client = Client::new(&url);
            let res = client.utxos(&address)?;
            print_json(&res);
        }
        Commands::Prepare {
            url,
            from,
            to,
            amount,
        } => {
            let client = Client::new(&url);
            let res = client.prepare(&from, &to, amount)?;
            print_json(&res);
        }
        Commands::Submit {
            url,
            from,
            to,
            amount,
            sig,
        } => {
            let client = Client::new(&url);
            let res = client.submit(&from, &to, amount, &sig)?;
            print_json(&res);
        }
        Commands::WalletNew => {
            let seed = wallet::generate_seed();
            println!("Seed: {} (keep secret!)", seed);
            println!("Address: {}", Address::from_seed(seed));
        }
        Commands::WalletSign { seed, sighash } => {
            let sig = sign_transfer(seed, &sighash)?;
            println!("Signature: {}", sig);
        }
    }
    Ok(())
}

fn print_json(value: &Value) {
    println!("{}", serde_json::to_string_pretty(value).unwrap());
}
