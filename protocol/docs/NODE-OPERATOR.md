# Kovanica Node Operator Reference

> **One-line summary:** Complete configuration reference for participant, miner, and operator nodes on kovanica-testnet.
>
> **Status:** Draft
>
> **Consensus impact:** none (operational documentation only)

---

## 1. Node Roles & Configuration Profiles

### 1.1 Participant Node (Default)
**Use case:** Validate, sync, submit transactions, run wallet/explorer UI locally.

```sh
export KOVANICA_LISTEN=0.0.0.0:8000
export KOVANICA_PEERS=seed2.kovanica.online:8000,seed3.kovanica.online:8000
export KOVANICA_CONSENSUS=poa
export KOVANICA_FAUCET=0
export KOVANICA_ALLOW_RESET=0
export KOVANICA_OPERATOR=0
export KOVANICA_DATA="$PWD/data"
export KOVANICA_NETWORK=kovanica-testnet
```

### 1.2 Authority Node
**Use case:** Sign blocks in PoA authority slots for block rewards
(subsidy + 25% fees). Requires this node's authority key.

```sh
export KOVANICA_LISTEN=0.0.0.0:8000
export KOVANICA_PEERS=seed2.kovanica.online:8000,seed3.kovanica.online:8000
export KOVANICA_CONSENSUS=poa
export KOVANICA_AUTHORITIES=<comma-separated-32-byte-hex-pubkeys>
export KOVANICA_AUTHORITY_THRESHOLD=2
export KOVANICA_SLOT_DURATION=3000
export KOVANICA_AUTHORITY_KEY=<32-byte-hex-secret>  # via EnvironmentFile, mode 0600
export KOVANICA_PRODUCE=1
export KOVANICA_FAUCET=0
export KOVANICA_ALLOW_RESET=0
export KOVANICA_OPERATOR=0
export KOVANICA_DATA="$PWD/data"
export KOVANICA_NETWORK=kovanica-testnet
```

### 1.3 Seed / Explorer Node (Operator)
**Use case:** Bootstrap peer, serve public explorer API.

```sh
# Primary seed (seed.kovanica.online)
export KOVANICA_LISTEN=0.0.0.0:8000
export KOVANICA_PEERS=seed3.kovanica.online:8000
export KOVANICA_CONSENSUS=poa
export KOVANICA_AUTHORITIES=<comma-separated-32-byte-hex-pubkeys>
export KOVANICA_AUTHORITY_THRESHOLD=2
export KOVANICA_SLOT_DURATION=3000
export KOVANICA_AUTHORITY_KEY=<32-byte-hex-secret>  # via EnvironmentFile, mode 0600
export KOVANICA_PRODUCE=1
export KOVANICA_FAUCET=1
export KOVANICA_ALLOW_RESET=0
export KOVANICA_OPERATOR=1
export KOVANICA_DATA=/root/kovanica-data
export KOVANICA_NETWORK=kovanica-testnet

# Secondary seed (seed2.kovanica.online)
export KOVANICA_LISTEN=0.0.0.0:8000
export KOVANICA_PEERS=seed2.kovanica.online:8000
export KOVANICA_CONSENSUS=poa
export KOVANICA_AUTHORITIES=<comma-separated-32-byte-hex-pubkeys>
export KOVANICA_AUTHORITY_THRESHOLD=2
export KOVANICA_SLOT_DURATION=3000
export KOVANICA_FAUCET=0
export KOVANICA_ALLOW_RESET=0
export KOVANICA_OPERATOR=0
export KOVANICA_DATA=/var/lib/kovanica-seed2
export KOVANICA_NETWORK=kovanica-testnet
```

---

## 2. Environment Variables Reference

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `KOVANICA_LISTEN` | string | `0.0.0.0:8000` (testnet) · `0.0.0.0:9000` (mainnet) | P2P bind address | current |
| `KOVANICA_PEERS` | string | `seed2.kovanica.online:8000,seed3.kovanica.online:8000` | Comma-separated bootstrap peers |
| `KOVANICA_CONSENSUS` | string | `poa` (unset) | Consensus mode: `poa` (default) |
| `KOVANICA_AUTHORITIES` | string | testnet placeholder | Comma-separated 32-byte hex authority public keys |
| `KOVANICA_AUTHORITY_THRESHOLD` | integer | strict majority | Signatures required for AuthorityUpdateTx |
| `KOVANICA_SLOT_DURATION` | integer | `3000` | PoA slot length in ms |
| `KOVANICA_AUTHORITY_KEY` | hex (64 chars) | — | Authority signing secret (via EnvironmentFile, mode 0600) |
| `KOVANICA_PRODUCE` | bool | `0` | Enable block production when scheduled |
| `KOVANICA_FAUCET` | bool | `0` | Enable faucet endpoint (seed/explorer only) |
| `KOVANICA_ALLOW_RESET` | bool | `0` | Allow chain wipe via API (testnet-only) |
| `KOVANICA_OPERATOR` | bool | `0` | Enable operator-only RPC commands |
| `KOVANICA_DATA` | path | `./data` | Persistence directory (MUST persist) |
| `KOVANICA_NETWORK` | string | `kovanica-testnet` | Network profile selector |
| `KOVANICA_TREASURY_SEED` | hex (64 chars) | — | Treasury vault keys (mainnet only) |
| `KOVANICA_MAINNET_OVERRIDE` | bool | `0` | Force boot dormant mainnet profile |
| `KOVANICA_RATE_LIMIT` | float | `10` | HTTP req/s per IP (token bucket) |
| `KOVANICA_RATE_BURST` | float | `60` | HTTP burst capacity per IP |
| `KOVANICA_DEMO_MESH` | bool | `0` | Enable in-process demo mesh (dev only) |

### Boolean values accepted
`1`, `true`, `TRUE`, `yes`, `on` = true | `0`, `false`, `FALSE`, `no`, `off`, `""` = false

### Special values for `KOVANICA_PEERS`
- `off`, `none`, `0`, `false` = disable all peers (solo mode)
- Comma-separated list: `host1:port,host2:port`

---

## 3. Safety Rules (Never Violate)

### 3.1 Private Keys
- **Private keys and seeds stay strictly client-side.** The node never receives them.
- Standard flow: `POST /api/prepare` → offline Ed25519 sign (64-byte / 128 hex) → `POST /api/submit_tx`
- Never set `KOVANICA_OPERATOR=1` on a node that handles user keys.

### 3.2 Data Persistence
- **Preserve `KOVANICA_DATA` after the first genesis write.** This directory contains the chain.
- Never put runtime state inside a git working tree (historical data-loss incident).
- Default location: `./data` (or `~/kovanica-node/data` for installer).

### 3.3 P2P Seeds
- **Always use DNS seed names or origin IPs.** Never point peers at Cloudflare orange-cloud hostnames for TCP 8000.
- Correct: `seed2.kovanica.online:8000` or `145.223.116.178:8000`
- Wrong: `explorer.kovanica.online:8000` (Cloudflare proxied, TCP blocked)

### 3.4 Reset Flag
- **Never recommend `KOVANICA_ALLOW_RESET=1` on public-facing nodes** without explicit isolation and documentation.
- Testnet reset policy: only on wire-format bumps or safety incidents.

### 3.5 Defaults
- Default participant configuration keeps `KOVANICA_PRODUCE=0`, `KOVANICA_FAUCET=0`, `KOVANICA_OPERATOR=0`.
- Consensus is proof-of-authority: there is no proof-of-work, no difficulty
  retarget, and no `KOVANICA_POW` variable -- the node never reads it.

---

## 4. Ports & Network

| Port | Protocol | Binding | Purpose |
|------|----------|---------|---------|
| **8000** | TCP | `0.0.0.0:8000` + `[::]:8000` | P2P gossip, block sync (plaintext) — testnet |
| **9000** | TCP | `0.0.0.0:9000` + `[::]:9000` | P2P gossip, block sync (plaintext) — mainnet |
| **8080** | HTTP | `127.0.0.1:8080` | Explorer API (participant/primary seed) |
| **18080** | HTTP | `127.0.0.1:18080` | Explorer API (seed2, nginx backend) |
| **28080** | HTTP | `127.0.0.1:28080` | Explorer API (seed1) |
| **9090** | HTTP | `0.0.0.0:9090` | Prometheus metrics (firewalled) |
| **3000** | HTTP | `127.0.0.1:3000` | Web UI (pm2, separate process) |

### Firewall Rules
```sh
# Testnet participant: only outbound 8000 needed
ufw allow out 8000/tcp

# Testnet seed/explorer: inbound 8000 for peers
ufw allow 8000/tcp comment 'Kovanica P2P'

# Mainnet: use port 9000 instead of 8000
```

---

## 5. Systemd Service Templates

### 5.1 Participant / Miner

```ini
# /etc/systemd/system/kovanica-node.service
[Unit]
Description=Kovanica Participant Node
After=network.target

[Service]
Type=simple
User=kovanica
WorkingDirectory=/home/kovanica
EnvironmentFile=/home/kovanica/kovanica.env
ExecStart=/usr/local/bin/kovanica-node explorer 127.0.0.1:8080
Restart=always
RestartSec=10
LimitNOFILE=65536
# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/home/kovanica/data

[Install]
WantedBy=multi-user.target
```

### 5.2 Environment File (`/home/kovanica/kovanica.env`)

```ini
KOVANICA_LISTEN=0.0.0.0:8000
KOVANICA_PEERS=seed2.kovanica.online:8000,seed3.kovanica.online:8000
KOVANICA_CONSENSUS=poa
KOVANICA_FAUCET=0
KOVANICA_ALLOW_RESET=0
KOVANICA_OPERATOR=0
KOVANICA_DATA=/home/kovanica/data
KOVANICA_NETWORK=kovanica-testnet
```

---

## 6. Health Checks & Monitoring

### 6.1 Local Health Checks

```sh
# Chain head
curl -s http://127.0.0.1:8080/api/head | jq '{network, genesis, tip, blocks, min_fee}'

# P2P connectivity
curl -s http://127.0.0.1:8080/api/p2p | jq '{listen, peers, bootstrap}'

# Sync status (compare with explorer)
curl -s https://explorer.kovanica.online/api/head | jq .tip
curl -s http://127.0.0.1:8080/api/head | jq .tip

# Mempool
curl -s http://127.0.0.1:8080/api/state | jq '.mempool | length'

# Metrics
curl -s http://127.0.0.1:9090/metrics | grep -E 'kovanica_(block_height|dag_blue_score|peer_count|mempool_size)'
```

### 6.2 Key Metrics to Alert On

| Metric | Healthy Range | Alert Threshold |
|--------|---------------|-----------------|
| `kovanica_block_height` | Increasing ~1/min | Stalled > 10 min |
| `kovanica_dag_blue_score` | ~= block_height | Divergence > 100 |
| `kovanica_peer_count` | >= 2 | < 2 for 5 min |
| `kovanica_mempool_size_bytes` | < 50% capacity | > 90% capacity |
| `kovanica_reorg_depth` | 0-1 | > 3 |
| `kovanica_disk_usage_bytes` | < 50 GB | > 80% disk |
| `kovanica_orphan_blocks_total` | < 0.1% of total | > 1% |

---

## 7. Common Operations

### 7.1 Start / Stop / Restart

```sh
systemctl start kovanica-node
systemctl stop kovanica-node
systemctl restart kovanica-node
systemctl status kovanica-node
journalctl -u kovanica-node -f
```

### 7.2 Binary Upgrade

```sh
# Build
cd /root/kovanica/node && cargo build --release --workspace

# Atomic replace (stop -> copy -> start)
sudo systemctl stop kovanica-node
sudo install -m755 ./target/release/kovanica-node /usr/local/bin/kovanica-node.new
sudo mv -f /usr/local/bin/kovanica-node{.new,}
sudo systemctl start kovanica-node

# Verify
curl -s http://127.0.0.1:8080/api/head | jq .
```

### 7.3 Cold Bootstrap (Pristine Sync)

```sh
KOVANICA_DATA=/tmp/cold-bootstrap \
KOVANICA_LISTEN=127.0.0.1:19000 \
KOVANICA_PEERS=seed2.kovanica.online:8000 \
/usr/local/bin/kovanica-node explorer 127.0.0.1:18081

# Verify genesis matches
curl -s http://127.0.0.1:18081/api/head | jq .genesis
```

### 7.4 Query Balance / Send TX (via HTTP API)

```sh
# Balance
curl -s "http://127.0.0.1:8080/api/balance?address=kvnc..."

# Prepare unsigned TX
curl -X POST http://127.0.0.1:8080/api/prepare \
  -H "Content-Type: application/json" \
  -d '{"from": "kvnc...", "to": "kvnc...", "amount": 100000000}'

# Submit signed TX (after offline Ed25519 sign)
curl -X POST http://127.0.0.1:8080/api/submit_tx \
  -H "Content-Type: application/json" \
  -d '{"tx_hex": "<128-hex-chars>"}'
```

### 7.5 Line RPC (REPL)

```sh
./kovanica-node
# or
cargo run -p kovanica-node

# Commands:
# help | genesis | address | balance | send | pool | produce | pending
# tips | tip | len | staking | save | load | checkpoint | load_checkpoint
# htlc_* | vault_*
```

---

## 8. Troubleshooting

| Symptom | Cause | Resolution |
|---------|-------|------------|
| **Sync stalls at genesis** | Wrong bootstrap peer / IPv6 stall | Use origin IP: `KOVANICA_PEERS=145.223.116.178:8000` |
| **`address already in use` on 9000** | Another node running | `systemctl stop kovanica-*` or change `KOVANICA_LISTEN` |
| **Genesis mismatch** | Old chain data in `KOVANICA_DATA` | Wipe data dir (`KOVANICA_ALLOW_RESET=1` + restart) or restore from backup |
| **No peers connecting** | Dialing Cloudflare-proxied hostname | Use `seed.kovanica.online` (grey-cloud DNS only) |
| **IPv6 dial stalls** | Ubuntu prefers IPv6 | Set `KOVANICA_PEERS=145.223.116.178:8000` |
| **Not producing blocks** | Not an authority or key not set | Verify `KOVANICA_AUTHORITIES` and `KOVANICA_AUTHORITY_KEY` |
| **ETXTBSY on upgrade** | Replaced binary without stopping service | Always `systemctl stop` before `cp`/`install` |
| **Deleted inode trap** | Binary replaced but process runs old code | Restart service after binary swap; verify `readlink /proc/<pid>/exe` |
| **Metrics not appearing** | `metrics` crate version mismatch | Ensure `metrics` and `metrics-exporter-prometheus` share minor version |

---

## 9. Consensus Parameters (Testnet)

| Parameter | Value | Source |
|-----------|-------|--------|
| GHOSTDAG **k** | 3 | `dag.rs` |
| Finality depth | 100 blocks | `ledger.rs` |
| Payload pruning depth | 1000 blocks | `dag.rs` |
| Consensus | PoA (authority signatures) | `dag.rs` |
| Slot duration | 3000 ms | `KOVANICA_SLOT_DURATION` |
| Authority set | Genesis-fixed + on-chain rotatable | `ledger.rs` |
| All RFC activation scores | 0 (active from genesis) | — |

---

## 10. Related Documents

- [TESTNET-GUIDE.md](./TESTNET-GUIDE.md) -- Complete testnet operator guide
- [DEPLOY-SEED.md](./DEPLOY-SEED.md) -- Seed node deployment guide
- [RPC-API.md](./RPC-API.md) -- Complete API reference
- [OPERATIONS.md](../OPERATIONS.md) -- Seed runbook, deploy pipeline, incident lessons
- [SECURITY.md](../SECURITY.md) -- Threat model, key handling, finality
- [SPEC-INDEX.md](./SPEC-INDEX.md) -- Specification index

---

*Last updated: 2026-09-21 | Network: kovanica-testnet*