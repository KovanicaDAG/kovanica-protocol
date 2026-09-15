# How to Get KVNC Tokens on Kovanica Testnet

## Overview

KVNC is the native token of the Kovanica Protocol. On the testnet, you can obtain KVNC tokens through:
1. The testnet faucet (recommended for development and testing)
2. Mining (CPU mining via kovanica-node)
3. Receiving from another user (via wallet transfer)

This guide covers all three methods for the Kovanica testnet.

---

## Method 1: Using the Testnet Faucet (Easiest for Development)

The faucet dispenses free test KVNC for development and testing purposes.

### Step 1: Get a Testnet Address

You need a KVNC address to receive funds. You can generate one via:

#### Option A: Using the Wallet UI
1. Visit https://wallet.kovanica.online
2. Click "Create New Wallet" or "Import Wallet"
3. Save your seed phrase securely
4. Copy your KVNC address (starts with `kvnc...`)

#### Option B: Using the Node API
```bash
curl -s -X POST http://127.0.0.1:8080/api/wallet/new | jq .
```
This returns a new address and keys. Save the address.

#### Option C: Using the Mobile/Web Wallet
Follow the instructions in the Kovanica Wallet app to create a new wallet.

### Step 2: Request Funds from the Faucet

#### Via Web UI
1. Visit https://faucet.testnet.kovanica.online
2. Paste your KVNC address
3. Complete any CAPTCHA if required
4. Click "Request Tokens"

#### Via API (for automation)
```bash
# Replace <address> with your KVNC address and <amount> with desired amount in atoms (1 KVNC = 100,000,000 atoms)
curl -s -X POST "http://127.0.0.1:8080/api/faucet?to=<address>&amount=<amount>" | jq .
```

Example: Request 10 KVNC (1,000,000,000 atoms)
```bash
curl -s -X POST "http://127.0.0.1:8080/api/faucet?to=kvnc...&amount=1000000000" | jq .
```

### Step 3: Verify Receipt
Check your balance via:
- Wallet UI: https://wallet.kovanica.online
- API: `curl -s http://127.0.0.1:8080/api/address/<your_address>/balance | jq .`

---

## Method 2: Mining KVNC (CPU Mining)

As an alternative to the faucet, you can mine KVNC by running a full node with mining enabled.

Refer to the detailed guide in `HOWTO_MINE.md` for step-by-step instructions.

### Quick Start for Mining
```bash
# Clone and build (if not already done)
git clone https://github.com/KovanicaDAG/kovanica-protocol.git
cd kovanica-protocol
cargo build --release --bin kovanica-node

# Run with mining enabled (adjust interval as needed)
export KOVANICA_MINE=1
export KOVANICA_MINE_SECS=60  # 1 minute between mining attempts
./target/release/kovanica-node
```

### Notes on Mining
- Mining rewards are sent to the address set by `KOVANICA_MINER_ADDRESS` or an ephemeral key if not set
- The testnet difficulty is low, so even modest CPU can mine blocks
- To see your rewards, check your balance periodically via the wallet or API
- For continuous mining, keep the node running

---

## Method 3: Receiving from Another User

If someone else has KVNC on the testnet, they can send it to you.

### Step 1: Share Your Address
Provide your KVNC address to the sender. You can find it in:
- Wallet UI: https://wallet.kovanica.online (under "Receive" or "Address")
- Node API: `curl -s http://127.0.0.1:8080/api/wallet/info | jq .` (if you have a wallet loaded via API)

### Step 2: Sender Initiates Transfer
The sender can use:
- Wallet UI: https://wallet.kovanica.online → "Send" tab
- Node API:
```bash
curl -s -X POST http://127.0.0.1:8080/api/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "<your_address>",
    "amount": <amount_in_atoms>,
    "fee": 2000
  }' | jq .
```

Example: Send 0.01 KVNC (1,000,000 atoms) with default fee
```bash
curl -s -X POST http://127.0.0.1:8080/api/send \
  -H "Content-Type: application/json" \
  -d '{"to": "kvnc...", "amount": 1000000, "fee": 2000}' | jq .
```

### Step 3: Confirm Receipt
Check your balance after a few seconds (testnet block time is variable but usually fast):
```bash
curl -s http://127.0.0.1:8080/api/address/<your_address>/balance | jq .
```

---

## Important Notes for Testnet

### Faucet Limits
- The faucet may have rate limits to prevent abuse
- If you hit a limit, wait a few minutes or try mining instead
- For large amounts needed for testing, consider mining or contact the dev team

### Testnet Reset
- The testnet may be reset periodically for upgrades
- Follow announcements on https://kovanica.online or the project's communication channels
- After a reset, you'll need to request new funds via faucet or mining

### Security
- **Never** use testnet seed phrases or keys on mainnet
- Testnet tokens have no real value
- Keep your testnet keys separate from any mainnet keys

---

## Transitioning to Mainnet (Future)

When mainnet launches, the methods to obtain KVNC will be:
1. **Mining** (PoW + hybrid staked-VRF)
2. **Purchasing** on exchanges (if listed)
3. **Receiving** from other users
4. **Official distributions** (if any)

The faucet will **not** exist on mainnet. Stay tuned to official channels for mainnet launch details.

---

## Troubleshooting

### Faucet Not Responding
- Check if https://faucet.testnet.kovanica.online is reachable
- Try the API method directly: `curl -v http://127.0.0.1:8080/api/faucet?...`
- Ensure you're using a valid KVNC address format

### Mining Not Earning
- Verify `KOVANICA_MINE=1` is set
- Check node logs for mining attempts
- Ensure you're connected to peers (check `http://127.0.0.1:8080/api/peers`)
- Confirm the node is synced (tip height close to explorer)

### Not Seeing Received Funds
- Wait a few seconds for block propagation
- Check transaction status via API if you have the tx ID
- Ensure you're looking at the correct address (testnet addresses start with `kvnc`)

### Balance Shows Zero but Should Have Funds
- Testnet may have been reset - check recent announcements
- Try requesting from faucet again
- Verify you're using the correct network (testnet vs any local test chains)

---

*Last updated: September 2026*