# How to Mine KVNC on Kovanica Testnet

## Overview

Kovanica uses a hybrid Proof-of-Work (PoW) + VRF-staked block production system. Mining is opt-in and can be done via CPU mining on the testnet.

## Prerequisites

- Linux or macOS (Windows via WSL)
- Rust toolchain installed (via rustup)
- Git
- At least 2GB RAM recommended

## Step 1: Clone the Repository

```bash
git clone https://github.com/KovanicaDAG/kovanica-protocol.git
cd kovanica-protocol
```

## Step 2: Build the Node

```bash
# Build in release mode for better mining performance
cargo build --release --bin kovanica-node
```

The binary will be available at `target/release/kovanica-node`.

## Step 3: Configure Environment Variables

Create a `.env` file or set environment variables:

```bash
# Enable mining (set to 1 to mine, 0 to run as light node)
export KOVANICA_MINE=1

# Optional: Set mining interval in seconds (default: 120s)
export KOVANICA_MINE_SECS=60

# Optional: Disable hybrid mode for pure PoW (default: enabled)
# export KOVANICA_POW=1

# Optional: Set custom data directory
# export KOVANICA_DATA=/path/to/your/data

# Optional: Set miner address (if empty, uses ephemeral key)
# export KOVANICA_MINER_ADDRESS=your_address_here
```

## Step 4: Run the Node

```bash
# Run with environment variables
KOVANICA_MINE=1 KOVANICA_MINE_SECS=60 ./target/release/kovanica-node
```

Or if you set them in your shell:

```bash
export KOVANICA_MINE=1
export KOVANICA_MINE_SECS=60
./target/release/kovanica-node
```

## Step 5: Verify Mining is Working

Check the logs for lines like:
```
[INFO] kovanica_node: Produced block <hash> (height: <height>, txs: <count>)
[INFO] kovanica_node: Mined nonce <nonce> for work target <target>
```

You can also monitor your hashrate via:
```bash
# In another terminal, assuming default data directory
watch -n 1 "grep -c 'Produced block' ~/.kovanica/logs/info.log"
```

## CPU Mining Recommendations

- For meaningful testnet participation: Use at least 2 CPU cores
- The testnet difficulty is low, so even modest hardware can mine blocks
- To mine continuously, keep the node running
- Mining rewards go to the address specified by `KOVANICA_MINER_ADDRESS` or an ephemeral key

## Stopping Mining

To run as a light node (no mining):
```bash
export KOVANICA_MINE=0
./target/release/kovanica-node
```

## Monitoring Your Rewards

Check your balance via:
1. The wallet UI: https://wallet.kovanica.online
2. Or via the node's RPC API:
```bash
curl -s http://127.0.0.1:8080/api/address/<your_address>/balance
```

## Troubleshooting

### "No peers" messages
- This is normal on first startup - peer discovery takes time
- Ensure ports 30303-30304 are open for TCP/UDP
- Check your firewall settings

### Mining not producing blocks
- Verify `KOVANICA_MINE=1` is set
- Check that `target/release/kovanica-node` is actually running
- Look for error messages in the logs
- Ensure you're synced with the network (check tip height vs explorer)

### High CPU usage
- This is expected when mining
- To reduce CPU usage, increase `KOVANICA_MINE_SECS` or set `KOVANICA_MINE=0`

## Testnet Faucet

If you need test KVNC for transactions while waiting to mine:
- Visit: https://faucet.testnet.kovanica.online
- Or use the API: `POST /api/faucet?to=<address>&amount=<atoms>`

## Mainnet Considerations

Mainnet mining will require:
- Updated software release
- Different network configuration
- Potentially higher difficulty requiring specialized hardware
- Refer to announcements on https://kovanica.online for mainnet launch details

---

*Last updated: September 2026*