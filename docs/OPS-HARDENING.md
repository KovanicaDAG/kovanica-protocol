# Kovanica Protocol — Operations Hardening

**Status**: Draft (P2.8)  
**Goal**: Production-grade reliability for testnet → mainnet transition.

---

## 1. Backup & Restore

### What to Back Up
```
data/
├── dag/              # DAG blocks + reachability oracle
├── ledger/           # UTXO set + stake registry + checkpoints
├── snapshots/        # Periodic full-state snapshots
└── checkpoints/      # Finality-boundary checkpoints
```

### Backup Schedule
| Frequency | Retention | Method |
|-----------|-----------|--------|
| **Hourly** | 48 hours | `tar.gz` of `data/` (incremental via rsync) |
| **Daily** | 30 days | Full `tar.gz` + SHA256SUMS |
| **Weekly** | 90 days | Full `tar.gz` to off-site (S3 / Backblaze B2) |

### Automation (systemd timer)
```ini
# /etc/systemd/system/kovanica-backup.service
[Unit]
Description=Kovanica Node Data Backup
After=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/kovanica/scripts/backup.sh
User=kovanica
```

```ini
# /etc/systemd/system/kovanica-backup.timer
[Unit]
Description=Hourly Kovanica Backup

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

### Restore Drill (Quarterly)
**Procedure** (documented in `OPERATIONS.md`):
1. Stop node: `systemctl stop kovanica-node`
2. Rename current `data/` → `data.corrupt/`
3. Restore from latest daily backup: `tar -xzf backup-YYYYMMDD.tar.gz`
4. Start node: `systemctl start kovanica-node`
5. Verify: `curl localhost:9000/api/head` matches explorer
6. Verify: `curl localhost:9000/metrics` shows healthy peer count
7. Document: time taken, any issues, RTO/RPO achieved

**Target**: RTO < 4 hours, RPO < 24 hours

---

## 2. Rate Limits & Ban Persistence

### Current Implementation (kovanica-node)
- **Per-peer rate limits**: `p2p_hardening.rs` — max bytes/msgs per window
- **Duplicate suppression**: Track known blocks/txs per peer, penalize resends
- **Peer scoring**: +1 valid, -5 duplicate block, -2 duplicate tx, -20 invalid block, -10 invalid tx
- **Auto-ban**: Score ≤ -50 (configurable)

### Persistence Gap
Currently: **In-memory only** — lost on restart.

### Required: Persistent Ban List
```rust
// New: crates/kovanica-node/src/ban_store.rs
use std::collections::HashMap;
use std::net::SocketAddr;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct BanRecord {
    pub addr: SocketAddr,
    pub reason: String,
    pub banned_at: u64,      // Unix timestamp
    pub expires_at: u64,     // Unix timestamp (0 = permanent)
    pub score_at_ban: i32,
}

pub struct BanStore {
    path: PathBuf,
    bans: HashMap<SocketAddr, BanRecord>,
}
```

**Storage**: `data/bans.json` (JSON, human-readable)
**Load on startup**: Merge with in-memory peer scoring
**Expire**: Background task sweeps expired bans hourly

### Under Load Verification
- **Test**: `cargo test --test p2p_hardening` (existing)
- **Load test**: Simulate 100 peers, 50 malicious, verify:
  - Legitimate peers not banned
  - Malicious peers banned within 100 blocks
  - Ban list survives restart

---

## 3. Monitoring & Alerting

### Prometheus Metrics (Already Exported)
From `kovanica-node::metrics`:
- `kovanica_block_rate` (blocks/min)
- `kovanica_peer_count` (inbound/outbound)
- `kovanica_mempool_size` (tx count, bytes)
- `kovanica_reorg_depth` (blocks)
- `kovanica_disk_usage_bytes` (data dir)
- `kovanica_dht_peer_count`
- `kovanica_validation_errors_total` (by type)
- `kovanica_sync_latency_seconds`

### Alert Rules (`alerting_rules.yml`)
```yaml
groups:
  - name: kovanica.rules
    rules:
      # Peer health
      - alert: PeerCountLow
        expr: kovanica_peer_count < 2
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Peer count below 2 for 5 minutes"
          runbook: "https://github.com/KovanicaDAG/kovanica-protocol/blob/main/docs/OPERATIONS.md#peer-count-low"

      # Block production
      - alert: BlockRateDrop
        expr: rate(kovanica_block_rate[10m]) < 0.5 * rate(kovanica_block_rate[1h])
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Block rate dropped >50% vs 1h average"

      # Reorgs
      - alert: ReorgDepthHigh
        expr: kovanica_reorg_depth > 3
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Reorg depth > 3 blocks"

      # Disk
      - alert: DiskUsageHigh
        expr: kovanica_disk_usage_bytes / kovanica_disk_total_bytes > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Disk usage > 80%"

      # Mempool
      - alert: MempoolNearCapacity
        expr: kovanica_mempool_size_bytes / kovanica_mempool_max_bytes > 0.9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Mempool > 90% capacity"

      # DHT
      - alert: DHTPeerCountLow
        expr: kovanica_dht_peer_count < 3
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "DHT peer count < 3"
```

### Grafana Dashboards (To Create)
| Dashboard | Panels |
|-----------|--------|
| **Node Overview** | Block rate, peer count, mempool, disk, sync status |
| **Consensus** | GHOSTDAG blue score, reorg depth, fork rate, finality lag |
| **P2P** | In/out peers, ban list size, duplicate rate, DHT health |
| **Ledger** | UTXO count, stake registry size, checkpoint lag |
| **Hardware** | CPU, RAM, disk I/O, network throughput |

### Alertmanager Config
```yaml
# alertmanager.yml
route:
  group_by: ['alertname', 'instance']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'default'

receivers:
  - name: 'default'
    email_configs:
      - to: 'ops@kovanica.online'
        send_resolved: true
    webhook_configs:
      - url: 'https://discord.com/api/webhooks/...'  # Discord ops channel
```

---

## 4. Seed Node Hardening Checklist

### Network
- [ ] **Firewall**: Only ports 9000 (P2P), 9090 (metrics), 22 (SSH, key-only) open
- [ ] **Cloudflare**: P2P port **grey-clouded** (not proxied) — DNS `seed.kovanica.online` → A/AAAA
- [ ] **Dual-stack**: IPv4 + IPv6 listeners (`0.0.0.0:9000` + `[::]:9000`)
- [ ] **IPv6_V6ONLY**: Set on IPv6 socket for clean dual-stack

### System
- [ ] **User**: Dedicated `kovanica` user (no sudo, no shell)
- [ ] **Limits**: `ulimit -n 65536` (file descriptors)
- [ ] **Swap**: Disabled (or minimal) — node uses mmap for DAG
- [ ] **Time**: `chrony`/`ntpd` synced (critical for timestamp validation)
- [ ] **Logs**: `journald` + logrotate (max 1GB, daily rotate)

### Process Management
- [ ] **systemd unit**: `kovanica-node.service` with:
  - `Restart=on-failure`
  - `RestartSec=10`
  - `StartLimitBurst=5`
  - `StartLimitIntervalSec=60`
  - `MemoryLimit=4G` (adjust for RAM)
  - `CPUQuota=200%` (2 cores)
- [ ] **Health check**: `ExecStartPre=curl -f localhost:9090/metrics || exit 1`

---

## 5. Incident Response Runbook

### Severity Levels
| Level | Definition | Response Time | Escalation |
|-------|------------|---------------|------------|
| **SEV-1** | Consensus halt, funds at risk | 15 min | Page all engineers |
| **SEV-2** | Major degradation (peer loss, block stall) | 1 hour | Page on-call |
| **SEV-3** | Minor issue (metric anomaly, single peer) | 4 hours | Ticket + Slack |

### Common Scenarios

#### SEV-1: Chain Halt (No New Blocks)
1. Check `kovanica_block_rate` = 0
2. Check peer count: `curl localhost:9090/metrics | grep peer_count`
3. If peers > 0: Check logs for validation errors
4. If peers = 0: Check firewall, Cloudflare, seed connectivity
5. Restart node if stuck: `systemctl restart kovanica-node`
6. If multiple seeds halted: Coordinate via Discord ops channel

#### SEV-2: High Reorg Depth
1. Alert: `ReorgDepthHigh` firing
2. Check `kovanica_reorg_depth` trend
3. If > 10: Possible consensus bug — stop mining, investigate
4. Check recent commits for consensus changes
5. Rollback if recent deploy caused it

#### SEV-3: Disk Near Full
1. Alert: `DiskUsageHigh` firing
2. Check `data/` size: `du -sh data/`
3. Clean old snapshots: `find data/snapshots -mtime +30 -delete`
4. Prune old payloads: `curl -X POST localhost:9000/api/prune?depth=1000`
5. Plan disk expansion

---

## 6. Deployment Automation

### Current (Manual)
```bash
# On VPS
cd /opt/kovanica/kovanica-protocol
git pull origin main
cargo build --release --workspace --locked
systemctl restart kovanica-node
```

### Target: CI/CD Pipeline
```yaml
# .github/workflows/deploy-seed.yml
on:
  push:
    branches: [main]
    paths:
      - 'crates/**'
      - 'Cargo.toml'
      - 'Cargo.lock'

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - name: Build release
        run: cargo build --release --workspace --locked
      - name: Deploy to seed
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SEED_HOST }}
          username: ${{ secrets.SEED_USER }}
          key: ${{ secrets.SEED_SSH_KEY }}
          script: |
            cd /opt/kovanica/kovanica-protocol
            git pull origin main
            cargo build --release --workspace --locked
            systemctl restart kovanica-node
            sleep 10
            curl -f localhost:9090/metrics || exit 1
```

---

## 7. Verification Checklist (Per Deploy)

- [ ] `curl -f https://explorer.kovanica.online/api/head` → 200
- [ ] `curl -f https://seed.kovanica.online:9090/metrics` → 200
- [ ] `curl -f https://seed2.kovanica.online:9090/metrics` → 200
- [ ] `curl -f https://seed3.kovanica.online:9090/metrics` → 200
- [ ] Peer count ≥ 2 on all seeds
- [ ] Block rate > 0 on all seeds
- [ ] No critical alerts firing in Alertmanager
- [ ] Grafana dashboards show healthy trends

---

## 8. Documentation Links

- `OPERATIONS.md` — Seed ops runbook (backup/restore, restart drill, post-deploy checks)
- `alerting_rules.yml` — Prometheus alert definitions
- `grafana-dashboards/` — JSON dashboard exports (to be created)
- `deploy-seed.sh` — Seed deployment script (to be created)

---

*Related: [LEGIT-BOARD.md](./LEGIT-BOARD.md) · [MAINNET-CRITERIA.md](./MAINNET-CRITERIA.md) · [OPERATIONS.md](./OPERATIONS.md)*