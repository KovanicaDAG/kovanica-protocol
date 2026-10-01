# Run a Kovanica Node — Complete Guide

> **Testnet software — no investment advice. Funds can be lost.**

> > **Consensus decision (ratified 2026-09-25): Kovanica is PoA-only.**
> > Proof-of-Work is being removed from the protocol. See
> > `protocol/docs/RFC-POA-Migration.md` §0 (canonical). Items marked `[TARGET]`
> > are ratified but not yet implemented; `[CURRENT]` items describe shipped code.
> >
> > **What this means for you as a node operator.** `[TARGET]` `KOVANICA_POW`,
> > `KOVANICA_MINE`, `KOVANICA_MINE_SECS` and mining as a role are all **removed**.
> > `KOVANICA_POW` is **not** replaced by an equivalent — PoA is configured with
> > `KOVANICA_CONSENSUS`, `KOVANICA_AUTHORITIES`, `KOVANICA_AUTHORITY_THRESHOLD`
> > and `KOVANICA_SLOT_DURATION` (see the table in §3). `KOVANICA_CONSENSUS`
> > **already defaults to `poa` when unset** (`consensus_mode_from_env()`).
> >
> > `[CURRENT]` The commands in this guide work *today* — against the **pre-reset
> > PoW testnet**. They are annotated, not removed, so you can follow them if you
> > are reproducing the current chain.
> >
> > ⚠️ **`KOVANICA_POW` is inert.** It is not read anywhere in the node, so
> > setting it to `0` or `1` changes nothing in either era — the `KOVANICA_POW=1`
> > still shown in the `[CURRENT] pre-reset` examples below is a historical
> > snapshot, not a live switch. The legacy PoW admission path is still
> > reachable, but via **`KOVANICA_CONSENSUS=pow`** (see §3), not via
> > `KOVANICA_POW`. `KOVANICA_MINE` / `KOVANICA_MINE_SECS` *are* still read, as
> > deprecated fallbacks for `KOVANICA_PRODUCE` / `KOVANICA_PRODUCE_SECS`.
> >
> > ⚠️ **The testnet reset is mandatory, not routine.** A PoA chain cannot be
> > reconciled with a PoW chain: under PoA every block must carry
> > `work == POA_NOMINAL_WORK = 1`, and a real PoW block's work is orders of
> > magnitude higher, so it out-competes every PoA block in the GHOSTDAG blue-work
> > fold. PoA genesis also commits the authority set as a `KVA1` coinbase output,
> > so the genesis block id differs. See RFC-POA-Migration §0.6 and
> > `TESTNET-RESET-POLICY.md`.
> >
> > **Tokenomics are unaffected.** MAX_SUPPLY **90.2M KVNC**, s₀
> > **10 KVNC/block**, era **2,050,000 blocks**, α **3/4**, maturity **100
> > blocks**, fee split **75% burned / 25% producer**, GHOSTDAG **k=3**, UTXO,
> > Ed25519, **1 KVNC = 100_000_000 atoms**. The curve is height-indexed and
> > `cumulative_minted` is capped in `apply_block`, so supply does not depend on
> > admission. What changes is the *pace*: fixed `SLOT_DURATION_MS` (default
> > 3000 ms), no difficulty retarget, and **no gap-fill** — an offline authority
> > simply yields an empty slot.

---

## Quick Start (Prebuilt Binary)

```bash
# 1. Install from GitHub Release (Linux x86_64)
curl -sSfL https://raw.githubusercontent.com/KovanicaDAG/kovanica-node/main/scripts/install.sh | bash

# 2. Run as explorer (HTTP API + P2P + mining)   [CURRENT] pre-reset PoW path
KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000 \
KOVANICA_LISTEN=0.0.0.0:9000 KOVANICA_POW=1 \
kovanica-node explorer 127.0.0.1:8080

# [TARGET] after PoA-only: KOVANICA_POW=1 drops out entirely. PoA is the default
# when KOVANICA_CONSENSUS is unset, so on testnet this is simply:
KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000 \
KOVANICA_LISTEN=0.0.0.0:9000 \
kovanica-node explorer 127.0.0.1:8080
```

**That's it.** `[CURRENT]` Your node will sync, mine blocks every ~60s, and serve:
- Explorer UI: `http://127.0.0.1:8080`
- HTTP API: `http://127.0.0.1:8080/api/*`
- Prometheus metrics: `http://127.0.0.1:9090/metrics`

`[TARGET]` Under PoA the same node syncs and serves identically; the "mine blocks
every ~60s" line becomes "participates in a ~3 s slot clock" — and only if it is
an authority with a signing key configured. A non-authority node validates and
relays, it does not produce.

---

## Table of Contents

1. [Installation Methods](#1-installation-methods)
2. [Network Profiles](#2-network-profiles)
3. [Configuration](#3-configuration)
4. [Running as a Seed](#4-running-as-a-seed)
5. [Running as Explorer Only](#5-running-as-explorer-only)
6. [P2P Networking](#6-p2p-networking)
7. [Monitoring & Metrics](#7-monitoring--metrics)
8. [Backup & Restore](#8-backup--restore)
9. [Troubleshooting](#9-troubleshooting)
10. [Verifying Sync](#10-verifying-sync)

---

## 1. Installation Methods

### 1.1 Prebuilt Binary (Recommended)

```bash
# Linux x86_64
curl -sSfL https://raw.githubusercontent.com/KovanicaDAG/kovanica-node/main/scripts/install.sh | bash

# Linux ARM64
curl -sSfL https://raw.githubusercontent.com/KovanicaDAG/kovanica-node/main/scripts/install.sh | bash -s -- --arch aarch64

# macOS (Intel)
curl -sSfL https://raw.githubusercontent.com/KovanicaDAG/kovanica-node/main/scripts/install.sh | bash -s -- --arch x86_64 --os darwin

# macOS (Apple Silicon)
curl -sSfL https://raw.githubusercontent.com/KovanicaDAG/kovanica-node/main/scripts/install.sh | bash -s -- --arch aarch64 --os darwin
```

**Installs to:** `/usr/local/bin/kovanica-node` (and `kovanica-cli` if present)
**Verifies:** SHA256 checksum from GitHub Release

### 1.2 Build from Source

```bash
# Prerequisites: Rust 1.75+, cargo, git
git clone https://github.com/KovanicaDAG/kovanica-node
cd kovanica-node
cargo build --release --workspace

# Binary at: target/release/kovanica-node
```

### 1.3 Docker (Experimental)

```bash
docker run -d \
  --name kovanica-node \
  -p 9000:9000 -p 8080:8080 -p 9090:9090 \
  -v kovanica-data:/data \
  -e KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000 \
  -e KOVANICA_LISTEN=0.0.0.0:9000 \
  -e KOVANICA_POW=1 \                      # [CURRENT] pre-reset; [TARGET] removed
  ghcr.io/kovanicadag/kovanica-node:latest \
  explorer 127.0.0.1:8080
```

---

## 2. Network Profiles

Each profile owns a **separate data directory** — a mainnet node cannot destroy testnet state.

| Profile | Data Dir | Genesis | Status |
|---------|----------|---------|--------|
| `kovanica-testnet` | `/root/kovanica-data` or `./data` | `9565fc20cb465eec0198a65c07da6b825e4211c4060d581a2c7dac6c96bafc97` | **Active** |
| `kovanica-mainnet` | `/root/kovanica-mainnet-data` | TBD | **Dormant** |

**Select at boot:**
```bash
# Testnet (default)
KOVANICA_NETWORK=kovanica-testnet kovanica-node explorer 127.0.0.1:8080

# Mainnet (requires override — parameters not finalized)
KOVANICA_NETWORK=kovanica-mainnet KOVANICA_MAINNET_OVERRIDE=1 kovanica-node explorer 127.0.0.1:8080
```

---

## 3. Configuration

All config via environment variables:

| Variable | Default | Description | Status |
|----------|---------|-------------|--------|
| `KOVANICA_DATA` | `./data` | Data directory (chain state, wallets) | current |
| `KOVANICA_NETWORK` | `kovanica-testnet` | Network profile | current |
| `KOVANICA_LISTEN` | `0.0.0.0:9000` | P2P listen address (TCP 9000 only) | current |
| `KOVANICA_PEERS` | `seed.kovanica.online:9000,seed2.kovanica.online:9000` | Bootstrap peers | current |
| `KOVANICA_CONSENSUS` | `poa` when unset | Admission mode: `poa` or `pow`. **Any other value panics.** | current |
| `KOVANICA_AUTHORITIES` | *(unset → testnet placeholder; mainnet refuses to boot)* | PoA genesis authority set, comma-separated 64-hex Ed25519 public keys | current |
| `KOVANICA_AUTHORITY_THRESHOLD` | strict majority | Signatures required to execute an `AuthorityUpdateTx` | current |
| `KOVANICA_SLOT_DURATION` | `3000` (ms) | PoA slot length (`SLOT_DURATION_MS`) | current |
| `KOVANICA_POW` | *(no effect)* | **Inert — the node never reads it.** PoW admission is selected by `KOVANICA_CONSENSUS=pow` | **removed (unread)** |
| `KOVANICA_MINE` | `1` (explorer profile) | Auto-mine empty blocks | **`[TARGET]`-removed** |
| `KOVANICA_MINE_SECS` | `60` | Target block interval when mining | **`[TARGET]`-removed** |
| `KOVANICA_FAUCET` | `0` | Enable faucet (testnet explorer only) | current |
| `KOVANICA_HYBRID` | `0` | Enable hybrid PoW+staked admission | **`[CURRENT]` / `[TARGET]`-removed** — see below |
| `KOVANICA_OPERATOR` | `0` | Enable operator wallet (mining rewards) | current |
| `KOVANICA_ALLOW_RESET` | `0` | Allow genesis reset (dev only) | current |
| `KOVANICA_TREASURY_SEED` | — | 64-hex mainnet treasury seed (required for mainnet) | current |

**There is no `KOVANICA_DIFFICULTY` variable, and none is planned.** PoW
difficulty was always a node-local `Retarget` policy, never operator-tunable.
Under `[TARGET]` PoA there is nothing to retarget at all.

### 3.0a `KOVANICA_HYBRID` is being removed — do not use it

`KOVANICA_HYBRID` enables `HybridConfig` (PoW **+** stake-weighted VRF
sortition). **Both halves are being removed** — decided 2026-09-25
(RFC-POA-Migration **§0.7.1**, Option A). The "PoA + staked-VRF secondary tier"
option was considered and rejected.

**For operators this simplifies things: there is no hybrid mode to configure.**
`KOVANICA_HYBRID` is `[TARGET]`-for-removal and a `[TARGET]` runbook must set
neither it nor `KOVANICA_POW` — a plain participant or authority node just sets
`KOVANICA_CONSENSUS=poa` and the `KOVANICA_AUTHORITY*` vars if it is an
authority. Bonding and unbonding (`bond_stake` / `unbond_stake`) are
`[TARGET]`-for-removal along with the stake registry, so there is no
staking-with-`KVNC` runbook to write.

⚠️ **Do not confuse this with RFC-005.** Vault/CSV time-locks and the treasury
vaults are **unaffected** — they do not depend on the stake registry. Vault
operators are unaffected by this removal.

### 3.1 Example: Testnet Seed with Mining `[CURRENT]` — pre-reset PoW testnet

```bash
export KOVANICA_DATA=/root/kovanica-data
export KOVANICA_NETWORK=kovanica-testnet
export KOVANICA_LISTEN=0.0.0.0:9000
export KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000
export KOVANICA_POW=1
export KOVANICA_MINE=1
export KOVANICA_MINE_SECS=60
export KOVANICA_OPERATOR=1
export KOVANICA_FAUCET=1  # explorer only

kovanica-node explorer 127.0.0.1:8080
```

### 3.1b Example: Testnet Seed under PoA `[TARGET]`

Everything PoW-specific is gone. The node no longer mines; it syncs, serves, and
relays.

```bash
export KOVANICA_DATA=/root/kovanica-data
export KOVANICA_NETWORK=kovanica-testnet
export KOVANICA_LISTEN=0.0.0.0:9000
export KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000
export KOVANICA_CONSENSUS=poa            # already the default when unset
export KOVANICA_SLOT_DURATION=3000       # optional; this is the default
export KOVANICA_OPERATOR=1
export KOVANICA_FAUCET=1  # explorer only

kovanica-node explorer 127.0.0.1:8080
```

Notes for this path:

- **Do not set `KOVANICA_AUTHORITIES` casually.** On **testnet**, leaving it
  unset derives a deterministic **placeholder** set from the public constant
  `AUTHORITY_PLACEHOLDER_BASE = 9001` — publicly derivable by design, mirroring
  the placeholder treasury keys. A placeholder-booted node loads those signing
  keys so a single node can produce in every slot (convenient for testnet,
  **never** for real funds). On **mainnet**, an unset `KOVANICA_AUTHORITIES`
  **refuses to boot** — the same fail-fast guard as the treasury seed.
- An explicit `KOVANICA_AUTHORITIES` set **never** loads keys into the node. Each
  authority operator supplies their own signing key via
  `Node::set_authority_signing_key` (or the equivalent operator surface).
- `KOVANICA_AUTHORITY_THRESHOLD` defaults to a strict majority of the set.
- `[OPEN]` **How anyone *becomes* an authority is not settled** — the rotation
  mechanism is settled (set fixed at genesis, changed only by an on-chain M-of-N
  `AuthorityUpdateTx`), but eligibility, the initial set, the key ceremony,
  threshold `t`, expansion and dissolution are not (RFC-POA-Migration §0.7.2).
  There is no documented application process to point an operator at.

### 3.2 Example: Light Node (No Mining)

```bash
export KOVANICA_DATA=/root/kovanica-data
export KOVANICA_PEERS=seed.kovanica.online:9000
export KOVANICA_POW=0        # [CURRENT]; [TARGET] simply omit — PoA default

kovanica-node serve  # REPL mode, or
kovanica-node explorer 127.0.0.1:8080  # with HTTP API
```

---

## 4. Running as a Seed

### 4.1 Systemd Service (Production)

```ini
# /etc/systemd/system/kovanica-seed.service
[Unit]
Description=Kovanica seed node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/root/kovanica-data
Environment=KOVANICA_LISTEN=0.0.0.0:9000
Environment=KOVANICA_POW=1              # [CURRENT] pre-reset; [TARGET] removed
Environment=KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000
Environment=KOVANICA_OPERATOR=1
Environment=KOVANICA_MINE=1
Environment=KOVANICA_MINE_SECS=60
Environment=KOVANICA_FAUCET=0
Environment=KOVANICA_DATA=/root/kovanica-data
ExecStart=/usr/local/bin/kovanica-node explorer 127.0.0.1:8080
Restart=always
RestartSec=5
LimitNOFILE=65536
MemoryMax=10G

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kovanica-seed
```

### 4.2 Firewall

```bash
# Only P2P port needs to be public
sudo ufw allow 9000/tcp comment 'Kovanica P2P'

# Explorer + metrics stay on loopback (or behind nginx)
# Do NOT open 8080/9090 to the internet directly
```

### 4.3 Cloudflare DNS (Grey-Cloud)

```bash
# DNS-only (no proxy) for P2P
Type: A
Name: seed
Content: <YOUR_VPS_IP>
Proxy: DNS only (grey cloud)
```

---

## 5. Running as Explorer Only

```bash
# [CURRENT] No mining, just sync + HTTP API
KOVANICA_POW=0 KOVANICA_MINE=0 KOVANICA_FAUCET=1 \
kovanica-node explorer 127.0.0.1:8080

# [TARGET] Under PoA "no mining" is the only mode, so the flags are simply omitted:
KOVANICA_FAUCET=1 \
kovanica-node explorer 127.0.0.1:8080
```

**NGINX Reverse Proxy (for public explorer):**

```nginx
# /etc/nginx/sites-enabled/explorer.kovanica.online
server {
    listen 80;
    server_name explorer.kovanica.online;
    
    # API & metrics
    location /api/ { proxy_pass http://127.0.0.1:8080; }
    location /metrics { proxy_pass http://127.0.0.1:8080; }
    
    # WebSocket
    location /ws { proxy_pass http://127.0.0.1:8080; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
    
    # Static pages
    location / { proxy_pass http://127.0.0.1:3000; }  # kovanica-web on :3000
}
```

---

## 6. P2P Networking

### 6.1 Bootstrap Peers

| Seed | Address | Notes |
|------|---------|-------|
| seed1 | `seed.kovanica.online:9000` | Primary (Hostinger VPS) |
| seed2 | `seed2.kovanica.online:9000` | Secondary (Hostinger KVM2 VPS) |
| seed3 | `seed3.kovanica.online:9000` | Tertiary — **new VPS, not yet in service** (`187.7.27.139`, `srv2013143`). Node not running, TCP 9000 closed, and the A record still points at Cloudflare proxy IPs, so the name does not work yet. Do not list it in `KOVANICA_PEERS` until both are fixed. |

### 6.2 Connectivity Verification

```bash
# Check peer count
curl -s http://127.0.0.1:8080/api/head | jq .peers

# Expected: 2+ peers (other seeds)
# If 0: check firewall, DNS, port 9000
```

### 6.3 DHT Discovery

```bash
# Manual connect (bypasses DNS)
kovanica-node connect 0.0.0.0:9000 <PEER_ID> <PEER_IP>:9000
```

---

## 7. Monitoring & Metrics

### 7.1 Prometheus Scraping

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'kovanica-seed'
    static_configs:
      - targets: ['127.0.0.1:9090']  # node metrics
        labels:
          instance: 'seed1'
  - job_name: 'kovanica-explorer'
    static_configs:
      - targets: ['127.0.0.1:8080']  # explorer also exposes /metrics
        labels:
          instance: 'explorer'
```

### 7.2 Key Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `kovanica_block_height` | Local chain height | Stalled > 5 min |
| `kovanica_dag_blue_score` | Blue score (finality clock) | Stalled |
| `kovanica_peer_count` | Connected P2P peers | < 2 |
| `kovanica_dag_reorg_depth_total` | Total reorg depth | > 0 |
| `kovanica_mempool_tx_count` | Pending transactions | — |
| `kovanica_blocks_produced_total` | Blocks mined | — |

### 7.3 Grafana Dashboard

Import `kovanica-protocol/monitoring/kovanica-dashboard.json` (if available) or build panels from metrics above.

---

## 8. Backup & Restore

### 8.1 Create Backup

```bash
# From repo root
KOV_BACKUP_PASSPHRASE="$(cat /run/secrets/kov-backup-passphrase)" \
  ./scripts/backup-node.sh

# Or specify data dir
KOV_BACKUP_PASSPHRASE="..." ./scripts/backup-node.sh --data /root/kovanica-data
```

**Output:** Encrypted archives in `/root/kovanica-backups/` (700 dir, 600 files)

### 8.2 Restore

```bash
# Auto-picks newest backup
KOV_BACKUP_PASSPHRASE="..." ./scripts/restore-node.sh --data-dir /root/kovanica-data

# Specific archives
KOV_BACKUP_PASSPHRASE="..." ./scripts/restore-node.sh \
  --data-archive /root/kovanica-backups/...data-....tar.gz.enc \
  --seed-archive /root/kovanica-backups/...seeds-....tar.gz.enc \
  --data-dir /root/kovanica-data
```

### 8.3 Quarterly Restore Drill

```bash
mkdir -p /tmp/kov-restore-drill
KOV_BACKUP_PASSPHRASE="..." ./scripts/restore-node.sh \
  --data-dir /tmp/kov-restore-drill/data --force

# Verify
KOVANICA_DATA=/tmp/kov-restore-drill/data KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000 \
  /usr/local/bin/kovanica-node explorer 127.0.0.1:18081 &
curl -s http://127.0.0.1:18081/api/head | jq .genesis
# Must match live genesis
```

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `dial tcp :22 i/o timeout` on deploy | GitHub runner IP filtered by VPS | Use SSH port 2222 |
| `ETXTBSY` on binary replace | Running process holds binary | `systemctl stop` → `cp` → `systemctl start` |
| Genesis mismatch on seed deploy | Deploy script expects old genesis | Update `EXPECTED_GENESIS` in `deploy-seed-prebuilt.sh` |
| `kovanica-node` OOM killed | < 2GB RAM on seed3 | Resize to ≥2GB (t3.small or Oracle Always Free) |
| Peer count 0 | Port 9000 blocked / Cloudflare proxy | Open 9000/tcp; grey-cloud DNS |
| Block height stalled | No miner running | Set `KOVANICA_MINE=1` on at least one seed |
| `KOVANICA_MAINNET_OVERRIDE` required | Mainnet profile dormant | Parameters not finalized; don't use in prod |

---

## 10. Verifying Sync

### 10.1 Genesis Match

```bash
curl -s https://explorer.kovanica.online/api/head | jq -r .genesis
# Must equal: 9565fc20cb465eec0198a65c07da6b825e4211c4060d581a2c7dac6c96bafc97
```

### 10.2 Block Production

```bash
# Should increment every ~60s
watch -n 10 'curl -s http://127.0.0.1:8080/api/head | jq .blocks'
```

### 10.3 Smoke Tests

| Test | Command |
|------|---------|
| Faucet | `curl -X POST http://127.0.0.1:8080/api/faucet -H "Content-Type: application/json" -d '{"address":"kvnc1A4XLkrefPBsXLwRH7kcRutGm3pgzrC7zJvAf8uiLLHqgdag"}'` |
| Transfer | `kovanica-node send <from-seed> <amount> <to-address>` |
| Multisig | Create 2-of-2, fund, spend with 2 sigs |
| HTLC | Create, redeem with preimage |
| Vault | Create with CSV, wait maturity, release |

---

## Appendix: Useful Commands

```bash
# Health checks
curl -s http://127.0.0.1:8080/api/head          # seed head
systemctl status kovanica-seed                  # systemd status
curl -s http://127.0.0.1:9090/metrics | head    # Prometheus metrics

# Logs
journalctl -u kovanica-seed -f                  # follow logs
journalctl -u kovanica-seed --since "1 hour ago" # recent logs

# Cold bootstrap (pristine sync)
KOVANICA_DATA=/tmp/cbt KOVANICA_LISTEN=127.0.0.1:19000 \
KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000 \
/usr/local/bin/kovanica-node explorer 127.0.0.1:18081

# RPC REPL
kovanica-node serve
> help
> balance <address>
> send <from-seed> <amount> <to-address>
```

---

## Related Documents

- `SECURITY.md` — Threat model, key handling, finality
- `OPERATIONS.md` — Seed runbook, deploy pipeline, incident lessons
- `NETWORK.md` — Domain map, DNS, redirect rules
- `LEGIT-BOARD.md` — Public visibility checklist
- `TOKENOMICS.md` — Emission curve, supply parameters

---

*Last updated: 2026-09-17*
*Testnet: `kovanica-testnet` — Genesis: `9565fc20cb465eec0198a65c07da6b825e4211c4060d581a2c7dac6c96bafc97`*