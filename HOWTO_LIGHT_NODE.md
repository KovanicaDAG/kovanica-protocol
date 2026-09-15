# How to Run a Kovanica Light Node

## Overview

A light node synchronizes with the Kovanica network without mining, consuming minimal resources while still providing wallet functionality and network participation.

## Prerequisites

- Linux or macOS (Windows via WSL)
- Rust toolchain installed (via rustup)
- Git
- Minimal resources: 512MB RAM, 2GB disk space

## Step 1: Clone the Repository

```bash
git clone https://github.com/KovanicaDAG/kovanica-protocol.git
cd kovanica-protocol
```

## Step 2: Build the Node

```bash
cargo build --release --bin kovanica-node
```

## Step 3: Configure for Light Node Operation

Set environment variables to disable mining:

```bash
export KOVANICA_MINE=0
# Optional: Set custom data directory
# export KOVANICA_DATA=/path/to/your/data
# Optional: Enable verbose logging for troubleshooting
# export RUST_LOG=info
```

## Step 4: Run the Light Node

```bash
./target/release/kovanica-node
```

## Step 5: Verify Synchronization

Check the logs for sync progress:
```
[INFO] kovanica_node: Synced to tip <hash> (height: <height>)
[INFO] kovanica_node: Connected to <count> peers
```

You can also check via the API:
```bash
# Get node status
curl -s http://127.0.0.1:8080/api/state | jq .

# Get peer count
curl -s http://127.0.0.1:8080/api/peers | jq .
```

## Step 6: Use the Light Node

Your light node provides:
- RPC API on port 8080 (localhost only by default)
- Wallet key generation and management
- Transaction submission
- Balance queries
- Network statistics

### Example: Generate a new wallet address
```bash
curl -s -X POST http://127.0.0.1:8080/api/wallet/new | jq .
```

### Example: Check balance
```bash
curl -s http://127.0.0.1:8080/api/address/<your_address>/balance | jq .
```

### Example: Submit a transaction
```bash
curl -s -X POST http://127.0.0.1:8080/api/send \
  -H "Content-Type: application/json" \
  -d '{"to": "<destination>", "amount": 100000000, "fee": 2000}' | jq .
```

## Resource Usage Expectations

- RAM: 50-150 MB (depending on peers and sync state)
- CPU: Minimal when synced (occasional spikes during sync)
- Disk: ~2-5 GB for blockchain data (grows slowly)
- Bandwidth: ~1-5 MB/hour idle, more during initial sync

## Running as a Service

To run your light node continuously, consider using systemd:

Create `/etc/systemd/system/kovanica-lightnode.service`:
```ini
[Unit]
Description=Kovanica Light Node
After=network.target

[Service]
Type=simple
User=your_username
WorkingDirectory=/path/to/kovanica-protocol
ExecStart=/path/to/kovanica-protocol/target/release/kovanica-node
Environment=KOVANICA_MINE=0
Environment=KOVANICA_DATA=/home/your_username/.kovanica
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable kovanica-lightnode
sudo systemctl start kovanica-lightnode
```

## Security Considerations

- The light node RPC is bound to localhost only by default
- Never expose the RPC port (8080) to the internet without proper authentication
- Keep your node updated with the latest releases
- Regularly backup your wallet keys (found in `$KOVANICA_DATA/wallet/`)

## Troubleshooting

### Not syncing
- Check logs for peer connection messages
- Ensure outbound TCP/UDP 30303-30304 is allowed
- Try adding a known peer manually via API if needed

### High disk usage
- Enable pruning in the node configuration (advanced)
- Consider periodic snapshots and state pruning

### API not responding
- Verify the node is running: `ps aux | grep kovanica-node`
- Check if it's bound to localhost: `netstat -tlnp | grep 8080`
- Look for error messages in the logs

---

*Last updated: September 2026*