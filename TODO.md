# TODO — Kovanica Protocol Development

## Current Session: Public Mirror Pipeline & seed3 (2026-08-24)

### Shipped

| Item | Status | Notes |
|------|--------|-------|
| `sync-public-node` workflow: mirror → build → release | ✅ Done | PRs #10–#14; mirrors `crates/{dag,state,node}` + filtered `Cargo.toml` into public KovanicaDAG/kovanica-node on every main push |
| Prebuilt binaries — rolling release `v0.1.0` | ✅ Done | Linux x86_64/aarch64 (static musl, zigbuild cross) + macOS x86_64/aarch64, sha256 per asset, tag replaced in place |
| `install.sh` prebuilt-first | ✅ Done | kovanica-node#2; downloads latest release asset, source build only as fallback |
| `deploy-seed.sh` Amazon Linux / RHEL support | ✅ Done | PR #15 — package-manager detection (apt/dnf), no curl-minimal conflict on AL2023 |
| **seed3** deployed — first true off-box node | ✅ Done | AWS EC2 t3.micro, eu-north-1, Amazon Linux 2023, systemd `kovanica-seed3`, mining on; genesis `76cc019d…` matches testnet, headers-first sync climbing past launch |
| DNS `seed3.kovanica.online` | ✅ Done | A record, DNS-only → `3.79.148.71`; P2P :9000 verified through hostname |
### Follow-ups

- [x] Rotate the AWS keypair whose `.pem` was shared in chat (leaked RSA removed
      from `authorized_keys`, local pems shredded, unknown third key stripped;
      only the two ops-box ed25519 keys remain)
- [x] **Fix default DNS-seed list** (`dns_seed.rs`): defaults are now the three
      live hosts — `seed`/`seed2`/`seed3.kovanica.online`; `seed.kovanica.net`
      is gone and seed2 resolves again (A `145.223.116.178`)
- [x] **Peers rollout**: `seed3.kovanica.online:9000` into the node binary's
      default `KOVANICA_PEERS` and the public `install.sh` (deploy-seed.sh
      already defaults to `seed…,seed3…`)
- [x] Decide `kovanica-cli` publication: included in public mirror workspace and release assets
- [x] Optional: Windows release assets for `install.ps1`: added Windows x86_64 target to GitHub Actions

### Next session — Testnet soak kickoff (roadmap item 4 ◀ ACTIVE)

1. [x] Peers rollout + DNS-seed list fix — nodes bootstrap across seed + seed3
2. [x] Prometheus armed on the VPS (`127.0.0.1:19080`; seed direct, seed3 over
       firewalled SSH tunnel), 15 alerts + 9 recording rules loaded
3. [x] Baseline captured 2026-08-24 16:20 UTC: height 448/447, peers 2/2,
       mempool 0, orphans 0, blue_score≈height, no reorgs (OPERATIONS.md §5)
4. [x] Public-API soak snapshot 2026-08-31 ~09:10 UTC (OPERATIONS.md §5):
       height 3817, genesis `596874ea…`, k=3, PoW on, work=1, supply checks,
       advertised seed2+seed3. Post-reset window was ~5.3 min/block; last 39 h
       recovered to ~1.18 min/block. **No retune** of k / finality / pruning /
       difficulty on this data.
5. [ ] VPS Prometheus scrape (orphan rate, propagation, fork/reorg, disk,
       `live_peers` on seed + seed3) — `/metrics` is not public
6. [ ] Revisit tuning after another week of recovered ~1/min mining

Also this session: process manager unified on systemd — pm2 retired for node
processes after a supervisor port fight; auto-deploy now swaps the binary
atomically into `/usr/local/bin/kovanica-node` and restarts units (#25, #26).
Branch hygiene: every merged feature branch deleted; one archive tag
(`archive/geo-origin-node-policy`) preserves the only unique unshipped patch.

---

## Previous Session: Multi-Seed Discovery & Kademlia DHT

### Implementation Status

| Task | Status | Notes |
|------|--------|-------|
| Create `dns_seed.rs` - DNS multi-seed resolver with injectable trait | ✅ Done | |
| Create `dht.rs` - Kademlia DHT (NodeId, XOR metric, K-buckets, iterative lookup) | ✅ Done | |
| Update `relay.rs` - Add DHT wire protocol messages (tags 0x20-0x23) | ✅ Done | shipped with the Tier 1–5 suite below |
| Update `p2p.rs` - Mesh integration for DHT simulation | ✅ Done | |
| Update `node.rs` - Node DHT routing state and helper methods | ✅ Done | |
| Update `explorer.rs` - Live explorer background task with multi-seed resolution | ✅ Done | |
| Update `lib.rs` - Export new modules | ✅ Done | |
| Create `tests/dht_discovery.rs` - Integration test suite | ✅ Done | |
| Run tests and verify implementation | ✅ Done | full workspace green incl. Tier 5 |

---

## Next Sessions

### Phase 2: Integration Test Suite
- [x] Implement `tests/dht_discovery.rs` with 5-tier test coverage
- [x] Test multi-node dynamic bootstrapping via DNS seeds
- [x] Test multi-hop isolated target discovery
- [x] Test dynamic disconnect & routing pruning
- [x] Test routing table replenishment
- [x] Test partition healing

### Phase 3: Adversarial Hardening (Tier 5)
- [x] High churn stress test (`test_adversarial_high_churn`)
- [x] Sybil / poisoned routing table defense (`test_adversarial_sybil_resistance` — honest contacts must survive a 100-node flood)
- [x] Eclipse attack defense (`test_adversarial_eclipse_resistance` — fixed: `Mesh::connect` now registers handshake-verified mutual DHT contacts)
- [x] 100% E2E test pass verification (full workspace suite, incl. previously-ignored Tier 5)

### Post-DHT Roadmap
- [x] Light clients / SPV wire protocol (headers-first sync, Merkle proofs)
- [x] Multi-seed DNS discovery (DNS seed records, DHT fallback)
- [x] Prometheus metrics & structured logging (real recorder wiring, /metrics, alerting rules, fuzz targets)
- [x] Testnet soak & parameter tuning (infrastructure scripts)
- [x] Wallet & explorer polish (hardware wallet, fee estimation, DAG viz)

---

## Architecture Notes

### DHT Design Decisions
- **NodeId**: 256-bit BLAKE3-derived or random
- **Metric**: XOR distance `d(A,B) = A ⊕ B`
- **Buckets**: 256 k-buckets (leading zero prefix indexing)
- **Bucket capacity**: k=8 (configurable to k=20)
- **Replacement cache**: k items per bucket
- **Eviction**: Head-probing ping, 3-strike dead peer pruning
- **Lookup**: Iterative, α=3 concurrency, distance-sorted shortlist
- **Wire tags**: 0x20 (Ping), 0x21 (Pong), 0x22 (FindNode), 0x23 (Nodes)

### DNS Seed Resolver
- **Seeds**: `seed.kovanica.online`, `seed2.kovanica.online`, `seed3.kovanica.online`
- **Port**: 9000 (default)
- **Fallbacks**: `127.0.0.1:9000`, `[::1]:9000`
- **Injectable trait**: `DnsResolver` with `StdDnsResolver` and `MockDnsResolver`

---

## Commands

```bash
# Build
cargo build

# Test DHT unit tests
cargo test -p kovanica-node --lib dht

# Test DNS seed unit tests
cargo test -p kovanica-node --lib dns_seed

# Run all kovanica-node tests
cargo test -p kovanica-node

# Run specific integration test (when created)
cargo test -p kovanica-node --test dht_discovery

# Format check
cargo fmt --check

# Lint
cargo clippy --all-targets -D warnings
```

---

## References
- Kademlia: Petar Maymounkov & David Mazières (2002)
- Kaspa DHT: DAGKNIGHT / GHOSTDAG peer discovery
- Bitcoin: `addr`/`getaddr` relay, DNS seeds (BIP 37, 111)
- Ethereum: devp2p discovery v4/v5 (Kademlia-based)