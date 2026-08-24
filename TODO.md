# TODO — Kovanica Protocol Development

## Current Session: Multi-Seed Discovery & Kademlia DHT

### Implementation Status

| Task | Status | Notes |
|------|--------|-------|
| Create `dns_seed.rs` - DNS multi-seed resolver with injectable trait | ✅ Done | |
| Create `dht.rs` - Kademlia DHT (NodeId, XOR metric, K-buckets, iterative lookup) | ✅ Done | |
| Update `relay.rs` - Add DHT wire protocol messages (tags 0x20-0x23) | ⏳ In Progress | |
| Update `p2p.rs` - Mesh integration for DHT simulation | ⏳ Pending | |
| Update `node.rs` - Node DHT routing state and helper methods | ⏳ Pending | |
| Update `explorer.rs` - Live explorer background task with multi-seed resolution | ⏳ Pending | |
| Update `lib.rs` - Export new modules | ⏳ Pending | |
| Create `tests/dht_discovery.rs` - Integration test suite | ⏳ Pending | |
| Run tests and verify implementation | ⏳ Pending | |

---

## Next Sessions

### Phase 2: Integration Test Suite
- [ ] Implement `tests/dht_discovery.rs` with 5-tier test coverage
- [ ] Test multi-node dynamic bootstrapping via DNS seeds
- [ ] Test multi-hop isolated target discovery
- [ ] Test dynamic disconnect & routing pruning
- [ ] Test routing table replenishment
- [ ] Test partition healing

### Phase 3: Adversarial Hardening (Tier 5)
- [ ] High churn stress test
- [ ] Sybil / poisoned routing table defense
- [ ] Eclipse attack defense
- [ ] 100% E2E test pass verification

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
- **Seeds**: `seed.kovanica.online`, `seed2.kovanica.online`, `seed.kovanica.net`
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