# seed2 Deployment — Testnet Soak

**Status**: ✅ **Done — superseded** (2026-09-20). "seed2" is the **Hostinger
KVM2 VPS `srv1991525`** (`76.13.250.65`; `kovanica-seed2` unit; DNS
`seed2.kovanica.online`). The separate old AWS box (`seed3` unit) is
**retired and decommissioned 2026-09-21** — host unreachable as of 2026-09-29
(do not deploy to it).
The old plan below (dedicated VPS on a third provider) is **cancelled** —
seed2 is VPS #2, not a new third-provider box; a true third provider remains
an open future item.

---

## Target (as deployed)
- **Name**: seed2 (unit `kovanica-seed2` on Hostinger KVM2 VPS `srv1991525`)
- **Hostname**: `seed2.kovanica.online` → `76.13.250.65` (grey cloud)
- **P2P Port**: 9000
- **Explorer**: 8080 (loopback)
- **Metrics**: 9090 (loopback)
- **Peers**: `seed.kovanica.online:9000,seed2.kovanica.online:9000`

> The VPS itself also runs `kovanica-seed2` (P2P `:9001`, HTTP `127.0.0.1:18080`)
> — a different, local unit. Do not confuse the two.

---

## Requirements
- **Provider**: Hostinger KVM2 VPS (`srv1991525`, org-distinct VPS #2; seed3 = AWS, retired, creds `/root/seeds/seed3`).
- **Region**: Different continent/ASN preferred — ⏳ still open (both Hostinger VPSs are EU; a true third-provider seed is a separate future item)
- **Specs**: 2 vCPU, 4GB RAM, 100GB SSD
- **OS**: Ubuntu 22.04+ or Debian 12+ (AWS: Amazon Linux 2023, systemd unit)
- **IP**: Static IPv4 (+ IPv6 if available)

---

## Deploy Script (superseded — seed2 already deployed)
```bash
cd /root/kovanica/protocol
./scripts/deploy-seed2.sh root@<VPS_IP> --name seed2
```

### Script Does:
- [ ] Ships source via SSH tarball
- [ ] Installs build deps + swap + Rust
- [ ] Builds `kovanica-node` release
- [ ] Installs systemd unit (`kovanica-seed2`)
- [ ] Configures Prometheus metrics (`:9090`)
- [ ] Installs fail2ban + node-exporter
- [ ] Verifies genesis matches `seed.kovanica.online`

---

## Post-Deploy Checklist (historical — seed2 is live)
- [x] DNS A/AAAA: `seed2.kovanica.online` → `76.13.250.65`
- [x] Cloudflare: Grey-cloud P2P port 9000
- [ ] Verify: `curl https://seed2.kovanica.online:8080/api/head` (from outside)
- [ ] Verify metrics: `ssh -L 9090:127.0.0.1:9090 ubuntu@76.13.250.65 'curl localhost:9090/metrics'`
- [x] Update bootstrap list in `NETWORK.md` and node config
- [x] Add to Cloudflare DNS (grey-cloud for P2P port 9000)

---

## Testnet Soak Requirements
Per `kovanica-protocol/docs/TESTNET-SOAK.md`:
- [ ] 30-day continuous operation
- [ ] ≥3 independent seed operators
- [ ] Metrics: orphan rate, propagation latency, fork rate, disk growth
- [ ] All seeds expose `/metrics` publicly
- [ ] Alerting rules armed (peer count, block rate, reorg depth, disk)

---

## Notes
- seed1 (primary): Hostinger VPS (`kovanica-explorer` unit, P2P :9000)
- seed2: Hostinger KVM2 VPS (`srv1991525`) — `76.13.250.65`
- seed3 (AWS): retired — creds kept at `/root/seeds/seed3`
- ~~seed2 target: Different provider/region~~ → a dedicated
  third-provider seed remains an open future item (DR/geo diversity)

---

**Done**: seed2 live on Hostinger KVM2 VPS `srv1991525` (see `OPERATIONS.md` §1).
