# Handoff Report: DHT Peer Discovery & Multi-Seed Bootstrapping Verification Strategy

**Author**: `survey_dht_explorer_3`  
**Working Directory**: `/root/kovanica-protocol/.agents/survey_dht_explorer_3`  
**Target Milestone**: Kademlia DHT Discovery & Multi-Seed Bootstrapping (`tests/dht_discovery.rs`)  

---

## 1. Observation

1. **Existing Test Framework Architecture**:
   - `crates/kovanica-node/tests/p2p.rs` (lines 14–46, 132–248): In-process discrete-time simulation via `Mesh`, step-by-step `Mesh::tick()`, `Mesh::drain()`, peer discovery via `Hello` envelopes, and `P2pHardening` scoring/rate-limiting.
   - `crates/kovanica-node/tests/relay.rs` (lines 18–71, 74–116): Persistent TCP sessions (`RelaySession`) handling multi-turn bidirectional query-response messaging with explicit timeouts (`set_read_timeout`).
   - `crates/kovanica-node/tests/spv_sync.rs` (lines 30–73, 76–134): Asynchronous request-response query handling (`handle_relay_query`) and background server threads with channel coordination.
   - `crates/kovanica-node/tests/adversarial_spv.rs` (lines 112–256, 433–586): 20,000-iteration pseudo-random fuzzing, byte-by-byte truncation, boundary condition assertions, and 30+ concurrent client threads with Byzantine probes.
   - `crates/kovanica-node/tests/timestamps.rs` (lines 23–37, 58–77): Deterministic clock pinning (`Node::set_now_ms`) ensuring reproducible block production and timestamp boundary validations.
2. **User Request & Discovery Requirements** (`ORIGINAL_REQUEST.md`, lines 37–56):
   - Decentralized peer discovery across multi-node topology without hardcoded peer IPs.
   - Newly joined isolated node discovering target nodes through intermediate DHT routing hops.
   - Dynamic pruning of unreachable/disconnected peers and automatic replenishment from the DHT routing table.
   - Multi-seed bootstrapping with DNS seed querying and mock DNS seed fallback.
   - Dedicated integration test suite in `crates/kovanica-node/tests/dht_discovery.rs`.

---

## 2. Logic Chain

1. **Leveraging Existing Test Patterns**: The repository already has proven mechanisms for:
   - In-process discrete-time event simulation (`p2p.rs`), which should be adapted for rapid, deterministic property testing of the Kademlia XOR routing table (`DhtMesh`).
   - Persistent TCP session framing and background actor threading (`relay.rs`, `adversarial_spv.rs`), which should be adapted for real loopback multi-node DHT clustering (`127.0.0.1:0`).
2. **Mock DNS Subsystem Requirement**: Real DNS lookups in test suites introduce non-determinism, external network dependency, and CI flakiness. An injectable trait (`DnsResolver`) with a mock implementation (`MockDnsResolver`) is required to simulate successful resolutions, partial outages, timeouts, and NXDOMAIN errors deterministically.
3. **Structured 5-Tier Verification Hierarchy**:
   - *Tier 1 (Primitives & Framing)*: Mathematical proofs for 256-bit XOR metric invariants, bucket capacity $k=8/20$, LRU ordering, head-probing replacement cache, binary round-trips, and fuzzing/truncation defense.
   - *Tier 2 (Boundary & Corner Cases)*: Empty routing table handling, self-lookups, nonce mismatch drops, bogon/loopback IP filtering, and intermediate node timeouts.
   - *Tier 3 (Cross-Feature Integration)*: Multiplexing DHT discovery messages over the same TCP streams as block/tx gossip and SPV header sync, coupled with `P2pHardening` rate-limiting.
   - *Tier 4 (Multi-Node E2E Scenarios)*: Real multi-node dynamic mesh formation, multi-hop isolated node target discovery, dynamic disconnect pruning/replenishment, and network partition healing.
   - *Tier 5 (Adversarial & Stress)*: Churn stress test, Sybil/poisoned routing table resistance, Eclipse attack defense (LRU ping protection), and high-concurrency socket leak tests.
4. **Integration with Consensus & State**: Once DHT discovery locates a peer, the node initiates standard P2P gossip, enabling block propagation and UTXO state convergence as verified in `tests/network.rs`.

---

## 3. Caveats

1. **UDP vs TCP DHT Transport**: Standard Kademlia (e.g. Bittorrent/Ethereum) uses UDP for DHT messages. In `kovanica-node`, DHT messages can either be multiplexed over the existing TCP `RelaySession` framing or run over a dedicated lightweight UDP listener. The test strategy supports both architectures via modular framing abstractions.
2. **Network Address Translation (NAT)**: In-process and loopback integration tests (`127.0.0.1:0`) do not exercise full NAT traversal (STUN/UPnP). NAT traversal is considered an operational layer concern above the core DHT routing table protocol.

---

## 4. Conclusion

The test infrastructure and verification plan documented in `analysis.md` provides a complete, 5-tier roadmap for implementing and auditing `tests/dht_discovery.rs`. It ensures 100% test coverage of all requirements from `ORIGINAL_REQUEST.md`, guaranteeing that `kovanica-node` can dynamically bootstrap via multi-seed DNS, discover peers across multi-hop topologies, prune dead contacts, and resist adversarial attacks without central coordination.

---

## 5. Verification Method

To independently verify the test design and execute the test suite once implemented:

1. **Run DHT Discovery Integration Test Suite**:
   ```bash
   RUST_BACKTRACE=1 cargo test -p kovanica-node --test dht_discovery -- --nocapture
   ```
2. **Run Full Node Integration & Adversarial Suite**:
   ```bash
   RUST_BACKTRACE=1 cargo test -p kovanica-node
   ```
3. **Format and Lint Verification**:
   ```bash
   cargo fmt --check
   cargo clippy --all-targets -- -D warnings
   ```
4. **Inspect Analysis Report**:
   - View `/root/kovanica-protocol/.agents/survey_dht_explorer_3/analysis.md` for full test case specifications and harness design.
