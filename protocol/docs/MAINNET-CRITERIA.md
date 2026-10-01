# Kovanica Protocol — Mainnet Exit Criteria

**Status**: Draft (P2.4)  
**Principle**: Mainnet date follows criteria, not the reverse.

---

## 1. Prerequisites (Must Be Complete)

### P0 — Transparent + Explainable (All Complete)
- [ ] **P0.1** Public source code: `kovanica-protocol` cloneable without invite
- [ ] **P0.2** GitHub Releases: `kovanica-node` binaries + SHA256SUMS + Android APK
- [ ] **P0.3** One-pager: `WHAT-IS-KOVANICA.md` surfaced on web (`/docs` or `/about`)
- [ ] **P0.4** Emission & tokenomics public: `TOKENOMICS.md` numbers match code + web
- [ ] **P0.5** Testnet reset policy: documented, announced, epoch-tagged
- [ ] **P0.6** Reliable web deploy: CI green on every `web/**` push to `main`
- [ ] **P0.7** Disclaimer: footer/Docs — testnet software, no investment advice

### P1 — Serious Testnet (Core Complete)
- [ ] **P1.1** KVP-104 (HTLC) landed on `main` with tests ✅
- [ ] **P1.2** Node HTTP `asset_id` (KVP-102) end-to-end on testnet
- [ ] **P1.3** Multiple public seeds/peers (≥2 geo/org-distinct, bootstrap published)
- [ ] **P1.4** Run-a-node guide: build, ports, env, disk, verify tip matches explorer

---

## 2. Audit Track (Must Be In Progress)

- [ ] **P2.1** Audit plan published (this repo: `docs/AUDIT-PLAN.md`)
- [ ] **P2.1** Firm selected, engagement signed
- [ ] **P2.1** Audit kickoff completed
- [ ] **P2.1** First audit report received (or audit in progress with interim findings)

---

## 3. Operational Maturity (Must Be Demonstrated)

### Network Stability
- [ ] **≥3 independent seed operators** running for **≥30 consecutive days**
  - Operators: distinct entities / geographies / ASNs
  - Each exposes `/metrics` (Prometheus) publicly
  - No single operator controls >50% of stake/hashrate
- [ ] **Zero unresolved Critical/High consensus bugs** (per bug bounty severity)
- [ ] **Fork rate < 0.1%** (orphan blocks / total blocks over 30 days)
- [ ] **Block propagation < 2s** p95 across seed mesh

### Monitoring & Alerting
- [ ] **Prometheus + Alertmanager** deployed on all seeds
- [ ] **Alert rules armed** (from `kovanica-node/alerting_rules.yml`):
  - Peer count < 2 for >5 min
  - Block rate drop >50% for >10 min
  - Reorg depth > 3 blocks
  - Disk usage > 80%
  - Mempool size > 90% capacity
  - DHT peer count < 3
- [ ] **On-call rotation** documented (even if just 1–2 people)

### Backup & Recovery
- [ ] **Automated daily backups** of `data/` (DAG + ledger + snapshots)
- [ ] **Restore drill completed** within last 30 days (documented)
- [ ] **RTO < 4 hours**, **RPO < 24 hours** verified

---

## 4. Release Engineering

- [ ] **P2.2** Reproducible builds: CI verifies binary hash from tagged commit
- [ ] **P2.2** Release artifacts: `kovanica-node` (linux-x86_64), SHA256SUMS, Android APK
- [ ] **P2.2** Version tagged: `v1.0.0-mainnet` (semver)
- [ ] **Changelog** generated from commits since testnet launch

---

## 5. Legal & Entity

- [ ] **P2.5** Entity & legal blurb: maintainer identity, jurisdiction, disclaimers
- [ ] **P2.5** No implied return / investment language on site or docs
- [ ] **P2.7** KVP-102 issuance policy documented: coinbase mint only, no regular tx minting

---

## 6. Community

- [ ] **P2.6** Primary community channel (Discord) with moderation rules
- [ ] **P2.6** Link from site (`kovanica.online`)
- [ ] **P1.7** Public issue tracker enabled on public repo
- [ ] **P1.7** Security contact path (GitHub Security Advisories or email)

---

## 7. Go/No-Go Decision

| Gate | Decision Maker | Evidence Required |
|------|----------------|-------------------|
| **All P0 complete** | Core team | Checklist + links |
| **P1.1–P1.4 complete** | Core team | Testnet verification |
| **Audit in progress + no Critical bugs** | Core team + auditor | Audit status + bug tracker |
| **30-day soak + monitoring armed** | Core team | Grafana dashboards + alert history |
| **Legal review sign-off** | Legal counsel | Documented review |

**Final Go/No-Go**: Unanimous core team consensus + legal sign-off.

**No-Go triggers**:
- Any Critical consensus bug unfixed
- Audit reveals unfixed High/Critical findings
- <3 independent seeds at go-time
- Legal blocker

---

## 8. Post-Launch (First 90 Days)

- [ ] Weekly ops review (metrics, alerts, peer health)
- [ ] Monthly audit finding remediation tracking
- [ ] Quarterly bug bounty payout review
- [ ] Community feedback integration

---

## 9. Sign-Off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Protocol Lead | | | |
| Core Engineer | | | |
| Operations Lead | | | |
| Legal Counsel | | | |

---

*Related: [LEGIT-BOARD.md](./LEGIT-BOARD.md) · [AUDIT-PLAN.md](./AUDIT-PLAN.md) · [REPRODUCIBLE-BUILDS.md](./REPRODUCIBLE-BUILDS.md) · [BUG-BOUNTY.md](./BUG-BOUNTY.md)*