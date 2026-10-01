# Kovanica SDK

Client libraries for building Kovanica-aware applications. Keys and seeds
never leave your process — the node only sees signed transactions and
read-only API calls.

## Crates

| Crate | Purpose |
|-------|---------|
| `kovanica-sdk` | Main SDK (re-exports all) |
| `kovanica-types` | Shared types (Address, Amount, AssetId, TxHash) |
| `kovanica-keys` | Key management (Ed25519, BIP-39, SLIP-10) |
| `kovanica-tx` | Transaction building (Transfer, HTLC, Vault) |
| `kovanica-rpc` | RPC client (HTTP API) |
| `kovanica-fee` | Fee calculation (RFC-006 floor) |
| `kovanica-wasm` | WASM bindings (browser/Node) |

## Quick start

```rust
use kovanica_sdk::prelude::*;

// Generate a new wallet
let mnemonic = Mnemonic::generate(WordCount::Words24)?;
let keypair = Keypair::from_mnemonic(&mnemonic, "");
println!("address: {}", keypair.address().to_hex());

// Build → sign → submit
let tx = TransferBuilder::new()
    .network(NetworkId::Testnet)
    .add_input(utxo)
    .add_native_output(recipient, Amount::from_kvnc(10))
    .set_fee(Amount::from_atoms(2_000))
    .set_change(sender.address())
    .build()?;
let signed = SignedTx::sign(tx, &keypair)?;
// POST /api/submit_tx {"tx_hex": signed.tx_hex()}
```

## Examples

```bash
cargo run -p kovanica-sdk --example generate_wallet    # Create wallet
cargo run -p kovanica-sdk --example transfer_asset     # Send asset
cargo run -p kovanica-sdk --example create_asset       # Asset identity
cargo run -p kovanica-sdk --example htlc_swap          # Atomic swap
cargo run -p kovanica-sdk --example token_listing      # List on DEX
cargo run -p kovanica-sdk --example staking            # Stake KVNC
cargo run -p kovanica-sdk --example airdrop            # Claim airdrop
cargo run -p kovanica-sdk --example bridge             # HTLC bridge
```

## Documentation

- [Cookbook](COOKBOOK.md) — practical recipes
- [Release runbook](RELEASE.md) — publish checklist
- [Protocol docs](../protocol/docs/) — RFCs and KVPs

## Version

SDK: `0.1.0-alpha.1` · Protocol: `0.4.0` · Rust: 1.75+

## License

MIT OR Apache-2.0
