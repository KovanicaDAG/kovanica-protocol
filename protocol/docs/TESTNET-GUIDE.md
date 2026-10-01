# Kovanica Testnet Operator Guide

> **One-line summary:** Complete operational guide for running, connecting to, and using the `kovanica-testnet` network.
>
> **Status:** Draft
>
> **Consensus impact:** none (operational documentation only)

---

## 1. Network Overview

| Property | Value |
|----------|-------|
| **Network ID** | `kovanica-testnet` |
| **Genesis hash** | See `/api/head` on explorer |
| **Consensus** | GHOSTDAG BlockDAG, **k = 3** |
| **P2P port** | TCP **9000** (plaintext, no libp2p) |
| **Bootstrap seeds** | `seed.kovanica.online:9000`, `seed2.kovanica.online:9000` |
| **Explorer** | https://explorer.kovanica.online |
| **Wallet** | https://wallet.kovanica.online |
| **Faucet** | https://faucet.testnet.kovanica.online (1 KVNC, rate-limited) |
| **Public API** | https://api.kovanica.online |

### Tokenomics (RFC-006)

| Parameter | Value |
|-----------|-------|
| **Native token** | KVNC (8 decimals) |
| **1 KVNC** | 100,000,000 atoms (`ATOM`) |
| **Genesis subsidy (s₀)** | 10 KVNC/block = 1,000,000,000 atoms |
| **Era length (E)** | 2,050,000 blocks |
| **Decay (α)** | 3/4 per era (geometric, integer floor) |
| **Curve emission** | 82M KVNC |
| **Founder premine** | 0.2M KVNC (genesis coinbase) |
| **Treasury** | 8M KVNC (8 x 1M RFC-005 vaults) |
| **MAX_SUPPLY** | 90.2M KVNC = 90,200,000,000,000,000 atoms |
| **Coinbase maturity** | 100 blocks |
| **Fee split** | 75% burned / 25% to producer |
| **Fee floor** | `max(1, subsidy / 500,000)` atoms/byte |

> **Note:** The testnet uses the RFC-006 parameters above. A previous testnet incarnation (pre-RFC-006) used subsidy 200 KVNC/block -- that chain was reset at RFC-006 activation.

---

## 2. Quick Start -- Join as a Participant

### One-line install (Linux/macOS)

```sh
curl -sSfL https://raw.githubusercontent.com/KovanicaDAG/kovanica-node/main/scripts/install.sh | bash
~/kovanica-node/run.sh
```

### One-line install (Windows PowerShell)

```powershell
irm https://raw.githubusercontent.com/KovanicaDAG/kovanica-node/main/scripts/install.ps1 | iex
# Then run %USERPROFILE%\kovanica-node\run.cmd
```

### Manual build from source

```sh
git clone https://github.com/KovanicaDAG/kovanica-node.git
cd kovanica-node
cargo build --release -p kovanica-node
```

### Run a participant node (connects to testnet)

```sh
export KOVANICA_LISTEN=0.0.0.0:9000
export KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000
export KOVANICA_MINE=0          # Leave off unless you intend to mint
export KOVANICA_MINE_SECS=120
export KOVANICA_FAUCET=0
export KOVANICA_ALLOW_RESET=0
export KOVANICA_OPERATOR=0      # Never enable on public clones
export KOVANICA_DATA="$PWD/data"

./target/release/kovanica-node explorer 127.0.0.1:8080
```

Then open http://127.0.0.1:8080 and verify:

```sh
curl -s http://127.0.0.1:8080/api/head
curl -s https://explorer.kovanica.online/api/head
```

The `network` and `genesis` fields must match. Your tip will catch up after the first pull.

---

## 3. Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `KOVANICA_LISTEN` | `0.0.0.0:9000` | P2P bind address (also tries `[::]:9000`) |
| `KOVANICA_PEERS` | `seed.kovanica.online:9000` | Comma-separated bootstrap peers |
| `KOVANICA_MINE` | `0` | Enable auto-mining (produce blocks) |
| `KOVANICA_MINE_SECS` | `120` | Mining interval in seconds (when `MINE=1`) |
| `KOVANICA_FAUCET` | `0` | Enable faucet endpoint (seed-only) |
| `KOVANICA_ALLOW_RESET` | `0` | Allow chain wipe via API (testnet-only) |
| `KOVANICA_OPERATOR` | `0` | Enable operator-only RPC commands |
| `KOVANICA_DATA` | `./data` | Persistence directory (keep this!) |
| `KOVANICA_NETWORK` | `kovanica-testnet` | Network profile selector |
| `KOVANICA_HYBRID` | `0` | Enable hybrid PoW+VRF-staked admission |
| `KOVANICA_RATE_LIMIT` | `10` | HTTP req/s per IP (token bucket) |
| `KOVANICA_RATE_BURST` | `60` | HTTP burst capacity per IP |

---

## 4. Node Roles

### Participant (default)
- **Purpose:** Validate, sync, submit transactions, run wallet
- **Config:** `MINE=0`, `FAUCET=0`, `OPERATOR=0`
- **Ports:** Outbound 9000 only (inbound optional for serving peers)
- **Data:** Preserves `KOVANICA_DATA` across restarts

### Block producer (PoA authority)
- **Purpose:** Sign blocks in authority slots for rewards
- **Config:** `MINE=1`, `MINE_SECS=60` (or desired interval)
- **Requires:** a PoA authority key (`KOVANICA_AUTHORITY_KEY`) matching the
  authority scheduled for each slot. Blocks are signed, not mined -- there is
  no proof-of-work and no difficulty retarget. Without the key this role
  produces nothing.
- **Reward:** 25% of fees + block subsidy (per RFC-006 curve)

### Seed / Explorer Node
- **Purpose:** Bootstrap, serve explorer API, mine empty blocks
- **Config:** `MINE=1`, `FAUCET=1`, `OPERATOR=1`, `ALLOW_RESET=0`
- **Ports:** P2P 9000 (grey-cloud DNS), HTTP 8080 (loopback), metrics 9090
- **Peers:** `seed2.kovanica.online:9000` (primary) or `seed.kovanica.online:9000` (secondary)

---

## 5. Common Operations

### Check node health

```sh
# Local node
curl -s http://127.0.0.1:8080/api/head

# Public explorer
curl -s https://explorer.kovanica.online/api/head

# P2P status
curl -s http://127.0.0.1:8080/api/p2p

# Prometheus metrics
curl -s http://127.0.0.1:9090/metrics | grep kovanica
```

### Submit a transaction (prepare --> sign --> submit)

The standard flow keeps private keys **client-side**:

```sh
# 1. Prepare unsigned transaction (on node)
curl -X POST http://127.0.0.1:8080/api/prepare \
  -H "Content-Type: application/json" \
  -d '{"from": "kvnc...", "to": "kvnc...", "amount": 100000000}'

# 2. Sign offline (Ed25519, 64-byte = 128 hex chars)
#    Use wallet UI, CLI, or any Ed25519 signer

# 3. Submit signed transaction
curl -X POST http://127.0.0.1:8080/api/submit_tx \
  -H "Content-Type: application/json" \
  -d '{"tx_hex": "<signed_tx_hex>"}'
```

### Get testnet KVNC from faucet

```sh
curl -X POST https://explorer.kovanica.online/api/faucet \
  -H "Content-Type: application/json" \
  -d '{"address": "kvnc..."}'
```

Pays 1 KVNC from operator funds. Rate-limited per address.

### Query balance / history / UTXOs

```sh
# Balance (native KVNC only)
curl -s "http://127.0.0.1:8080/api/balance?address=kvnc..."

# History (includes asset_id for KVP-102)
curl -s "http://127.0.0.1:8080/api/history?address=kvnc..."

# UTXOs
curl -s "http://127.0.0.1:8080/api/utxos?address=kvnc..."
```

---

## 6. Explorer HTTP API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/head` | GET | Chain tip, genesis, block count, min fee |
| `/api/bootstrap` | GET | Full bootstrap blob (genesis, tip, subsidy, supply, light_config) |
| `/api/state` | GET | Full DAG snapshot (blocks, tips, blue scores) |
| `/api/p2p` | GET | P2P listen address, peers, bootstrap |
| `/api/blocks` | GET | Binary block dump (wire format); `?from=<block_id>` for incremental |
| `/api/block/<id>` | GET | Block detail (JSON) |
| `/api/tx/<id>` | GET | Transaction detail (JSON) |
| `/api/address/<addr>` | GET | Address detail, balance, history |
| `/api/utxos` | GET | UTXO set for address |
| `/api/history` | GET | Transaction history for address |
| `/api/prepare` | POST | Build unsigned transfer (native or asset) |
| `/api/submit_tx` | POST | Submit signed transaction (hex) |
| `/api/faucet` | POST | Request 1 KVNC (testnet only) |
| `/api/mine/template` | GET | Get mining template (for external miners) |
| `/api/mine/submit` | POST | Submit mined block (JSON or wire format) |
| `/api/fee_estimate` | GET | Fee estimation (slow/normal/fast) |
| `/api/light_sync` | GET | SPV light-sync blob (KVLS v1) |
| `/api/light_proof` | GET | Merkle inclusion proof for light client |
| `/api/multisig/*` | POST | Multisig wallet endpoints (create/build/sign/combine/submit) |
| `/ws` | WS | WebSocket real-time updates (blocks, txs, tips, peers) |

See [RPC-API.md](./RPC-API.md) for full request/response schemas.

---

## 7. Line RPC (stdin/stdout REPL)

Run `cargo run -p kovanica-node` or `./kovanica-node` for an interactive REPL:

```
help                                    # List commands
genesis <k> <subsidy> <amount> <seed>   # Create genesis ledger
address <seed>                          # Derive address from actor seed
balance <seed|addr-hex>                 # Spendable balance
send <from-seed> <amount> <to-seed>     # Transfer as new block on tips
pool <from-seed> <amount> <to-seed>     # Add to mempool only
produce                                 # Produce block from mempool
pending                                 # Mempool count
tips                                    # Current tip block IDs
tip                                     # Selected (heaviest) tip
len                                     # Block count
staking [vrf-pk-hex]                    # Hybrid staking status
save <path> / load <path>               # Snapshot persistence
checkpoint <path> / load_checkpoint <path>  # Finality checkpoint

# HTLC (RFC-004)
htlc_create <from-seed> <amount> <recipient-pk-hex> <preimage-hash-hex> <timeout>
htlc_redeem <from-seed> <outpoint-tx-hex> <outpoint-index> <script-hex> <preimage-hex> <to-addr>
htlc_refund <from-seed> <outpoint-tx-hex> <outpoint-index> <script-hex> <to-addr>
htlc_balance <script-hex>

# Vault (RFC-005)
vault_create <from-seed> <amount> <unlock-height> <csv> <owner-pk-hex>
vault_release <from-seed> <outpoint-tx-hex> <outpoint-index> <script-hex> <to-addr>
vault_balance <script-hex>
```

---

## 8. Backup & Restore

Data lives in `KOVANICA_DATA` (default `./data`). **Never put runtime state inside a git working tree.**

### Create backup

```sh
KOV_BACKUP_PASSPHRASE="$(cat /run/secrets/kov-backup-passphrase)" \
  ./scripts/backup-node.sh --data /root/kovanica-data
```

### Restore from backup

```sh
KOV_BACKUP_PASSPHRASE="..." ./scripts/restore-node.sh --data-dir /root/kovanica-data
```

### Restore drill (run quarterly)

```sh
mkdir -p /tmp/kov-restore-drill
KOV_BACKUP_PASSPHRASE="..." ./scripts/restore-node.sh \
  --data-dir /tmp/kov-restore-drill/data --force
KOVANICA_DATA=/tmp/kov-restore-drill/data KOVANICA_PEERS=seed.kovanica.online:9000 \
  /usr/local/bin/kovanica-node explorer 127.0.0.1:18081 &
curl -s http://127.0.0.1:18081/api/head | jq .genesis
```

---

## 9. Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Sync stalls at genesis | Wrong bootstrap peer | Use `KOVANICA_PEERS=145.223.116.178:9000` (origin IP) |
| `address already in use` on 9000 | Another node running | `systemctl stop kovanica-*` or change `KOVANICA_LISTEN` |
| Genesis mismatch | Old chain data in `KOVANICA_DATA` | Wipe data dir (`KOVANICA_ALLOW_RESET=1` + restart) or backup/restore |
| No peers connecting | Cloudflare orange-cloud on seed hostname | Use `seed.kovanica.online` (grey-cloud DNS only) |
| IPv6 dial stalls | Ubuntu prefers IPv6 | Set `KOVANICA_PEERS=145.223.116.178:9000` |
| Miner not producing | `MINE=0` or no mempool txs | Set `KOVANICA_MINE=1` and ensure mempool has txs (or `produce_empty`) |

---

## 10. Related Documents

- [DEPLOY-SEED.md](./DEPLOY-SEED.md) -- Seed node deployment guide
- [NODE-OPERATOR.md](./NODE-OPERATOR.md) -- Full node operator reference
- [RPC-API.md](./RPC-API.md) -- Complete API reference
- [ADDRESS-FORMAT.md](./ADDRESS-FORMAT.md) -- Address encoding/parsing
- [FAQ.md](./FAQ.md) -- Common questions
- [OPERATIONS.md](../OPERATIONS.md) -- Seed runbook, deploy pipeline, incident lessons
- [TOKENOMICS.md](./TOKENOMICS.md) -- Emission curve, supply parameters
- [SPEC-INDEX.md](./SPEC-INDEX.md) -- Specification index
- [NETWORK.md](../NETWORK.md) -- Domain map, DNS, redirect rules

---

*Last updated: 2026-09-21 | Network: kovanica-testnet*