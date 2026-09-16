# Kovanica Testnet Soak Plan

**Status**: Draft (Post-Stage 3 #4)  
**Goal**: Run 24/7 testnet with multiple independent seeds for ≥30 days, collect operational metrics, validate mainnet readiness.

---

## 1. Seed Operator Requirements

### Current Seeds
| Seed | Host | Operator | Status |
|------|------|----------|--------|
| `seed.kovanica.online` | Hostinger VPS | Core team | ✅ Live |
| `seed2.kovanica.online` | TBD | TBD | 🔄 Needed |
| `seed3.kovanica.online` | AWS eu-north-1 | Core team | ✅ Live (since 2026-08-24) |

### Target: ≥3 Independent Operators
- **Geographic diversity**: ≥2 continents (currently EU only)
- **Organizational diversity**: ≥2 distinct entities
- **ASN diversity**: Different autonomous systems
- **Each operator** runs:
  - Full node with mining/staking enabled
  - Prometheus metrics on `:9090` (public)
  - Alertmanager webhook to shared Discord ops channel
  - Automated backups (per OPS-HARDENING.md)

### Seed Operator Onboarding Checklist
- [ ] Provision VPS (2 vCPU, 4GB RAM, 100GB SSD minimum)
- [ ] Install Rust 1.82.0, build from `main` tag
- [ ] Configure `KOVANICA_PEERS` with bootstrap list
- [ ] Open ports: 9000 (P2P, grey-cloud), 9090 (metrics), 22 (SSH key-only)
- [ ] Deploy systemd unit + backup timer + logrotate
- [ ] Verify: `curl localhost:9090/metrics` → healthy output
- [ ] Join Discord ops channel for coordination
- [ ] Sign operator agreement (informal: "I'll run this for 30 days")

---

## 2. Metrics to Collect

### Primary Metrics (Prometheus)
| Metric | Query | Target | Alert Threshold |
|--------|-------|--------|-----------------|
| **Block rate** | `rate(kovanica_block_rate[5m])` | > 0.5/min | < 0.1/min for 10m |
| **Peer count** | `kovanica_peer_count` | ≥ 3 | < 2 for 5m |
| **Fork rate** | `kovanica_orphan_blocks_total / kovanica_blocks_total` | < 0.1% | > 1% |
| **Propagation latency** | `histogram_quantile(0.95, kovanica_block_propagation_seconds_bucket)` | < 2s | > 5s p95 |
| **Reorg depth** | `kovanica_reorg_depth` | 0–1 | > 3 |
| **Disk growth** | `rate(kovanica_disk_usage_bytes[1h])` | < 1GB/day | > 5GB/day |
| **Mempool size** | `kovanica_mempool_size_bytes` | < 50% capacity | > 90% capacity |
| **DHT peers** | `kovanica_dht_peer_count` | ≥ 5 | < 3 for 10m |
| **Sync latency** | `kovanica_sync_latency_seconds` | < 30s | > 120s |

### Secondary Metrics (Grafana Dashboards)
- UTXO set size over time
- Stake registry size (bonds/unbonds)
- Checkpoint frequency
- P2P ban list size
- Validation errors by type
- Hardware: CPU, RAM, disk I/O, network

---

## 3. Soak Duration & Gates

### Phase 1: Stabilization (Days 1–7)
- All seeds running, peering, producing blocks
- No SEV-1 incidents
- Metrics baseline established

### Phase 2: Measurement (Days 8–30)
- Daily metric snapshots recorded
- Weekly ops review (Discord ops channel)
- Any Critical/High bugs → pause, fix, restart clock

### Phase 3: Validation (Day 30+)
- Compile 30-day report
- Verify all MAINNET-CRITERIA.md gates met
- Go/No-Go decision

---

## 4. Data Collection & Reporting

### Automated Collection
```bash
# Daily cron on each seed (or central Prometheus)
0 0 * * * curl -s localhost:9090/metrics | grep -E 'kovanica_(block_rate|peer_count|reorg_depth|disk_usage|mempool_size|dht_peer_count|sync_latency)' >> /var/log/kovanica/soak-$(date +%Y%m%d).log
```

### Weekly Report Template
```markdown
# Week N Soak Report (YYYY-MM-DD to YYYY-MM-DD)

## Summary
- Uptime: XX%
- Blocks produced: N
- Forks: N (X%)
- SEV-1 incidents: 0
- SEV-2 incidents: N

## Metrics (7-day avg)
| Metric | Avg | Min | Max | Target Met? |
|--------|-----|-----|-----|-------------|
| Block rate | X/min | | | ✅/❌ |
| Peer count | X | | | ✅/❌ |
| Fork rate | X% | | | ✅/❌ |
| Propagation p95 | Xs | | | ✅/❌ |
| Reorg depth max | X | | | ✅/❌ |
| Disk growth/day | X GB | | | ✅/❌ |

## Issues
- [ ] Issue description → fix / workaround

## Next Week Focus
- ...
```

---

## 5. Incident Response During Soak

### SEV-1 (Consensus Halt)
- **Action**: All seeds stop mining, coordinate fix in Discord ops
- **Clock**: Soak day counter pauses until resolved + 24h observation

### SEV-2 (Major Degradation)
- **Action**: On-call investigates, applies workaround
- **Clock**: Continues if resolved < 4h; pauses if > 4h

### SEV-3 (Minor)
- **Action**: Ticket created, fixed in next deploy
- **Clock**: Unaffected

---

## 6. Success Criteria (Maps to MAINNET-CRITERIA.md)

| Criterion | Measurement | Pass Threshold |
|-----------|-------------|----------------|
| ≥3 independent seeds | Operator count | 3+ |
| 30-day uptime | Days without SEV-1 | 30 |
| Fork rate | Orphan/total blocks | < 0.1% |
| Propagation | p95 block propagation | < 2s |
| Reorg depth | Max observed | ≤ 3 |
| Disk growth | Daily avg | < 1GB/day |
| Monitoring armed | Alert rules firing correctly | 100% |
| Backup/restore | Drill completed | ✅ |

---

## 7. Next Steps

1. [ ] Recruit seed2 operator (target: different continent/org)
2. [ ] Deploy seed2 with full monitoring
3. [ ] Verify all 3 seeds peering, metrics flowing
4. [ ] Start Day 1 clock
5. [ ] Weekly ops reviews in Discord
6. [ ] Day 30: compile report, Go/No-Go

---

*Related: [OPS-HARDENING.md](./OPS-HARDENING.md) · [MAINNET-CRITERIA.md](./MAINNET-CRITERIA.md) · [alerting_rules.yml](../kovanica-node/alerting_rules.yml)*