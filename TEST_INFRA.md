# E2E Test Infra: Kovanica Multi-Seed Discovery & Kademlia DHT

## Test Philosophy
- Opaque-box, requirement-driven: test against user specifications and network wire protocols over real TCP sockets and deterministic in-process simulation.
- Comprehensive 5-Tier testing methodology (Category-Partition, Boundary Value Analysis, Pairwise Combinatorial, Real-World Workload, Adversarial Stress).

## Feature Inventory
| # | Feature | Source | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---------|--------|:------:|:------:|:------:|:------:|
| 1 | DNS Multi-Seed Resolver & Fallback Pipeline | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 2 | 256-bit NodeId & XOR Metric Engine | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 3 | K-Bucket Routing Table & LRU Eviction | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 4 | DHT Wire Protocol Messages & Framing | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 5 | Iterative Node Lookup & Routing Algorithm | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 6 | Mesh Simulation & Query Handling | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 7 | Multi-Node Dynamic Discovery & Bootstrapping | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 8 | Multi-Hop Isolated Target Routing | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 9 | Unreachable Peer Pruning & Replenishment | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- Test Suite Location: `crates/kovanica-node/tests/dht_discovery.rs`
- Runner: `cargo test -p kovanica-node --test dht_discovery`
- Network: Real TCP loopback connections (`127.0.0.1:0`), ephemeral ports, bounded timeouts, plus discrete-time in-process simulation (`Mesh`).
- DNS: Injectable `MockDnsResolver` ensuring zero external network dependencies and 100% deterministic test execution.

## Test Tier Coverage
- **Tier 1 - Feature Coverage (>=5 per feature)**:
  1. 256-bit XOR metric distance properties: identity $d(x, x) = 0$, symmetry $d(x, y) = d(y, x)$, triangle inequality $d(x, z) \le d(x, y) \oplus d(y, z)$.
  2. Bucket index derivation: exact leading zero bits mapped to 256 buckets.
  3. K-bucket insertion, LRU ordering, and duplicate contact update.
  4. DHT wire message binary serialization/deserialization (`Ping`, `Pong`, `FindNode`, `Nodes`) with 64-bit query nonces.
  5. DNS multi-seed resolver: multiple seeds queried, A/AAAA extraction, duplicate deduplication, shuffling.
  6. Static IP fallback resolution when all DNS seeds fail.
- **Tier 2 - Boundary & Corner Cases (>=5 per feature)**:
  1. Empty routing table lookup returns empty candidate list gracefully without panic.
  2. Full bucket saturation: insertion triggers replacement cache or ping eviction.
  3. Self-lookup: searching for local NodeId returns closest neighboring nodes.
  4. Query nonce mismatch: unsolicited or stale Pong/Nodes messages are ignored.
  5. Unresponsive intermediate node during iterative lookup: algorithm continues querying alternative candidates.
  6. Dead peer 3-strike failure accumulation and automatic eviction from bucket.
- **Tier 3 - Cross-Feature Combinations**:
  1. Multiplexed TCP framing: DHT messages (`Ping`, `FindNode`, `Nodes`) seamlessly interleaved with P2P block/tx gossip and SPV queries on the same connection.
  2. DHT discovery coupled with P2P mesh connection: discovered peers are automatically dialed and added to active gossip overlay.
  3. Block and transaction dissemination across dynamically discovered DHT peers.
- **Tier 4 - Real-World Application Scenarios (>=5 scenarios)**:
  1. **Multi-Seed Dynamic Bootstrapping**: Cluster of 5 nodes bootstraps via DNS multi-seed resolver and forms a connected DHT routing table.
  2. **Multi-Hop Isolated Target Discovery**: Node A knows only Seed Node B. Node C knows only Seed Node B. Node A discovers and connects directly to Node C via DHT iterative routing without knowing C's IP upfront.
  3. **Dynamic Disconnect & Routing Pruning**: An active node in a 6-node cluster crashes. Neighbors detect 3 consecutive query failures, prune it from routing tables, and promote replacement candidates.
  4. **Routing Table Replenishment**: Node's active peer count drops below target; node queries DHT to replenish active P2P mesh connections.
  5. **Partition Healing**: Two initially partitioned sub-clusters are bridged by a single mutual contact; iterative lookups merge their routing tables into a single unified overlay.
- **Tier 5 - Adversarial Coverage Hardening**:
  - High churn stress test (nodes rapidly joining and leaving).
  - Sybil / poisoned routing table defense (rate limiting and IP diversity).
  - Eclipse attack defense (LRU ping preservation prevents malicious newcomers from evicting established honest nodes).

