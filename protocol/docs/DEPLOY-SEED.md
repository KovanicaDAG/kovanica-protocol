# Seed Node Deployment Guide

> **One-line summary:** Production deployment guide for Kovanica seed nodes (seed.kovanica.online and seed2.kovanica.online).
>
> **Status:** Draft
>
> **Consensus impact:** none (operational documentation only)

---

## 1. Seed Topology

| Seed | Host | DNS | IP | P2P Port | HTTP Port | Systemd Unit |
|------|------|-----|-----|----------|-----------|--------------|
| **seed** (primary) | Hostinger VPS `srv1745734` | `seed.kovanica.online` | `145.223.116.178` | 9000 | 8080 (loopback) | `kovanica-explorer` |
| **seed2** (secondary) | Hostinger KVM2 `srv1991525` | `seed2.kovanica.online` | `76.13.250.65` | 9000 | 18080 (loopback, nginx `/api`) | `kovanica-seed2` |

> **Note:** `seed1.kovanica.online` is a CNAME alias to `seed2.kovanica.online`. The original `seed3.kovanica.online` (AWS `t3.micro`) was decommissioned 2026-09-21. **Do not describe its DNS as deleted/NXDOMAIN** — as of 2026-09-29 the name still resolves, but to Cloudflare proxy IPs, not to a node. A **new** `seed3` VPS (`187.7.27.139`, `srv2013143`) has been provisioned; its A record still needs to be re-pointed there as **DNS-only (grey-cloud)** before the name is usable for P2P.

---

## 2. Prerequisites

### VPS Requirements
- **OS:** Ubuntu 22.04+ or Debian 12+
- **CPU:** 2+ vCPU
- **RAM:** 4 GB minimum (8 GB recommended for seed2 with nginx)
- **Disk:** 100 GB SSD (chain data grows ~1 GB/day with pruning)
- **Network:** Public IPv4 + IPv6, raw TCP 9000 reachable

### Software
- Rust 1.82+ (via `rustup`)
- `cargo`, `git`, `curl`, `jq`
- `nginx` (seed2 only, for `/api` reverse proxy)
- `prometheus` + `alertmanager` (monitoring)
- `ufw` or `iptables` (firewall)

### DNS (Cloudflare)
- **Zone:** `kovanica.online` (ID: `6fc91866edb8c9fab9fd2458857b5939`)
- **Seeds must be DNS-only (grey cloud)** -- proxying breaks raw TCP 9000
- Records:
  - `seed.kovanica.online` A `145.223.116.178` (DNS only)
  - `seed.kovanica.online` AAAA `2a02:4780:41:1f43::1` (DNS only)
  - `seed2.kovanica.online` A `76.13.250.65` (DNS only)
  - `seed1.kovanica.online` CNAME `seed2.kovanica.online` (DNS only)

---

## 3. Deploy via Script (Recommended)

```sh
# On the target VPS as root
./scripts/deploy-seed.sh root@<host> --name seed2 --mine --peers seed.kovanica.online:9000
```

The script:
1. Ships a `git archive` tarball (no clone auth needed)
2. Installs prerequisites + swap file
3. Builds `kovanica-node` on-target (`cargo build --release --workspace`)
4. Creates systemd unit `kovanica-seed2` (or `kovanica-explorer` for primary)
5. Opens only the P2P port (9000) in firewall
6. Verifies genesis match against the primary seed

---

## 4. Manual Deploy Steps

### 4.1 Build the binary

```sh
cd /root/kovanica/node
cargo build --release --workspace
# Binary at ./target/release/kovanica-node
sudo install -m755 ./target/release/kovanica-node /usr/local/bin/kovanica-node
```

### 4.2 Create data directory (outside git)

```sh
mkdir -p /root/kovanica-data
# For seed2: /var/lib/kovanica-seed2
```

### 4.3 Systemd unit (primary seed -- `kovanica-explorer`)

```ini
# /etc/systemd/system/kovanica-explorer.service
[Unit]
Description=Kovanica Primary Seed + Explorer
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root
Environment=KOVANICA_LISTEN=0.0.0.0:9000
Environment=KOVANICA_PEERS=seed2.kovanica.online:9000
Environment=KOVANICA_MINE=1
Environment=KOVANICA_MINE_SECS=60
Environment=KOVANICA_FAUCET=1
Environment=KOVANICA_ALLOW_RESET=0
Environment=KOVANICA_OPERATOR=1
Environment=KOVANICA_DATA=/root/kovanica-data
Environment=KOVANICA_NETWORK=kovanica-testnet
ExecStart=/usr/local/bin/kovanica-node explorer 127.0.0.1:8080
Restart=always
RestartSec=10
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

### 4.4 Systemd unit (secondary seed -- `kovanica-seed2`)

```ini
# /etc/systemd/system/kovanica-seed2.service
[Unit]
Description=Kovanica Secondary Seed (Hostinger KVM2)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root
Environment=KOVANICA_LISTEN=0.0.0.0:9000
Environment=KOVANICA_PEERS=seed.kovanica.online:9000
Environment=KOVANICA_MINE=0
Environment=KOVANICA_FAUCET=0
Environment=KOVANICA_ALLOW_RESET=0
Environment=KOVANICA_OPERATOR=0
Environment=KOVANICA_DATA=/var/lib/kovanica-seed2
Environment=KOVANICA_NETWORK=kovanica-testnet
ExecStart=/usr/local/bin/kovanica-node explorer 127.0.0.1:18080
Restart=always
RestartSec=10
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

### 4.5 Nginx config (seed2 only -- `/api` backend)

```nginx
# /etc/nginx/sites-enabled/seed2-api
server {
    listen 127.0.0.1:18080;
    server_name localhost;

    location /api/ {
        proxy_pass http://127.0.0.1:18080;  # Node's internal HTTP
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 30s;
    }

    location /metrics {
        proxy_pass http://127.0.0.1:9090;  # Prometheus metrics
    }
}
```

### 4.6 Firewall

```sh
# Only P2P port needs to be public
ufw allow 9000/tcp comment 'Kovanica P2P'
# HTTP (8080/18080) and metrics (9090) stay loopback-only
ufw enable
```

### 4.7 Start and verify

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now kovanica-explorer  # or kovanica-seed2
sudo systemctl status kovanica-explorer

# Verify
curl -s http://127.0.0.1:8080/api/head | jq .
curl -s http://127.0.0.1:8080/api/p2p | jq .
curl -s http://127.0.0.1:9090/metrics | head
```

---

## 5. Post-Deploy Verification Checklist

- [ ] `GET /api/head` returns `network: "kovanica-testnet"` and matching genesis
- [ ] `GET /api/p2p` shows both seeds in `peers` list
- [ ] `GET /api/bootstrap` returns valid `light_config` for SPV clients
- [ ] P2P port 9000 reachable from internet: `nc -zv seed.kovanica.online 9000`
- [ ] Prometheus scrapes `:9090` (primary) and `76.13.250.65:9090` (seed2)
- [ ] Metrics show `kovanica_block_height`, `kovanica_dag_blue_score`, `kovanica_peer_count`
- [ ] Logs show successful peer exchange: `kovanica p2p exchanged with <peer>`
- [ ] No `ETXTBSY` errors on binary restart (stop -> copy -> start)

---

## 6. Upgrade Procedure

```sh
# 1. Build new binary
cd /root/kovanica/node && cargo build --release --workspace

# 2. Stop service, swap binary, restart (atomic replace)
sudo systemctl stop kovanica-explorer  # or kovanica-seed2
sudo install -m755 ./target/release/kovanica-node /usr/local/bin/kovanica-node.new
sudo mv -f /usr/local/bin/kovanica-node{.new,}
sudo systemctl start kovanica-explorer

# 3. Verify
curl -s http://127.0.0.1:8080/api/head | jq .
journalctl -u kovanica-explorer -f
```

> **Critical:** Always stop the service before replacing the binary. A running binary cannot be overwritten (ETXTBSY), and replacing the file without restart leaves the old code running with `(deleted)` in `/proc/<pid>/exe`.

---

## 7. Backup & Restore

### Automated daily backup (systemd timer)

```sh
# /etc/systemd/system/kovanica-backup.service
[Unit]
Description=Kovanica Seed Backup
[Service]
Type=oneshot
Environment=KOV_BACKUP_PASSPHRASE_FILE=/run/secrets/kov-backup-passphrase
ExecStart=/root/kovanica/scripts/backup-node.sh --data /root/kovanica-data
```

```sh
# /etc/systemd/system/kovanica-backup.timer
[Unit]
Description=Daily Kovanica Backup
[Timer]
OnCalendar=daily
Persistent=true
[Install]
WantedBy=timers.target
```

```sh
sudo systemctl enable --now kovanica-backup.timer
```

### Restore drill (quarterly)

```sh
mkdir -p /tmp/kov-restore-drill
KOV_BACKUP_PASSPHRASE="..." ./scripts/restore-node.sh \
  --data-dir /tmp/kov-restore-drill/data --force
KOVANICA_DATA=/tmp/kov-restore-drill/data KOVANICA_PEERS=seed.kovanica.online:9000 \
  /usr/local/bin/kovanica-node explorer 127.0.0.1:18081 &
curl -s http://127.0.0.1:18081/api/head | jq .genesis
```

---

## 8. Monitoring & Alerting

### Prometheus targets (on VPS)

```yaml
# /etc/prometheus/prometheus.yml
scrape_configs:
  - job_name: 'kovanica-explorer'
    static_configs:
      - targets: ['127.0.0.1:8080', '127.0.0.1:9090']
  - job_name: 'kovanica-seed1'
    static_configs:
      - targets: ['127.0.0.1:28080', '127.0.0.1:29090']
  - job_name: 'kovanica-seed2'
    static_configs:
      - targets: ['76.13.250.65:9090']  # Direct scrape, no tunnel
```

### Key alerts (from `alerting_rules.yml`)

| Alert | Condition | Severity |
|-------|-----------|----------|
| `KovanicaPeerCountLow` | `kovanica_peer_count < 2` for 5m | Critical |
| `KovanicaBlockRateDrop` | `rate(kovanica_block_rate[5m]) < 0.1/min` for 10m | Critical |
| `KovanicaReorgDepthHigh` | `kovanica_reorg_depth > 3` | Warning |
| `KovanicaDiskUsageHigh` | `disk usage > 80%` | Warning |
| `KovanicaMempoolHigh` | `mempool size > 90% capacity` | Warning |
| `KovanicaDHTPeersLow` | `kovanica_dht_peer_count < 3` for 10m | Warning |

---

## 9. Incident Runbook

| Incident | Detection | Response |
|----------|-----------|----------|
| **Chain stall** (no new blocks) | `block_rate` alert, `tip` not advancing | Check `journalctl -u kovanica-explorer -f`; ensure `MINE=1` on at least one seed; verify peers connected |
| **Peer count 0** | `kovanica_peer_count` alert | Verify firewall, DNS resolution (`dig seed.kovanica.online`), check `KOVANICA_PEERS` env |
| **OOM kill** (seed3 historical) | `dmesg` shows `Out of memory`, process flapping | Resize VPS to >= 2 GB RAM; add swap; set `OOMScoreAdjust=-1000` |
| **Genesis mismatch** | `/api/head` genesis differs from explorer | Wipe data dir (`KOVANICA_ALLOW_RESET=1` + restart) or restore from backup |
| **Binary upgrade failed** | `ETXTBSY` or old version still running | Verify `readlink /proc/$(pidof kovanica-node)/exe` matches disk file; restart service |

---

## 10. Related Documents

- [TESTNET-GUIDE.md](./TESTNET-GUIDE.md) -- Complete testnet operator guide
- [NODE-OPERATOR.md](./NODE-OPERATOR.md) -- Full node operator reference
- [OPERATIONS.md](../OPERATIONS.md) -- Seed runbook, deploy pipeline, incident lessons
- [NETWORK.md](../NETWORK.md) -- Domain map, DNS, redirect rules
- [SPEC-INDEX.md](./SPEC-INDEX.md) -- Specification index

---

*Last updated: 2026-09-21 | Seeds: seed.kovanica.online, seed2.kovanica.online*