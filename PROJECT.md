# Project: Multi-Seed Discovery and Lightweight Kademlia DHT

## Architecture
- **Distributed Peer Discovery & DNS Multi-Seed Resolver** (`crates/kovanica-node/src/dns_seed.rs`):
  - Multi-seed configuration supporting multiple DNS seed hostnames (e.g. `seed.kovanica.online`, `seed2.kovanica.online`, `seed.kovanica.net`).
  - Standard socket address resolution extracting all underlying IPv4 (`A`) and IPv6 (`AAAA`) records with shuffling and deduplication.
  - Injectable `DnsResolver` trait with production `StdDnsResolver` and deterministic `MockDnsResolver` for zero-flakiness testing.
  - Robust static IP fallback pipeline (`P2P_BOOTSTRAP_FALLBACKS`) if DNS resolution fails or network is partitioned.
- **Lightweight Kademlia-based DHT Subsystem** (`crates/kovanica-node/src/dht.rs`):
  - 256-bit `NodeId` cryptographic space (BLAKE3-derived or random), bitwise XOR metric $d(A, B) = A \oplus B$, and leading zero prefix bucket indexing (256 buckets).
  - Configurable $k$-capacity buckets ($k=8$ or $k=20$), contact entries with `last_seen_ms` and `failed_queries` tracking.
  - LRU tail insertion, auxiliary replacement cache ($k$ items), head-probing ping eviction, and 3-strike dead peer pruning.
  - Iterative node lookup algorithm ($\alpha=3$ concurrency) over distance-sorted shortlists returning the $k$ closest nodes.
  - Automatic bucket refreshing for inactive routing table buckets.
- **Wire Framing & P2P Mesh Integration** (`crates/kovanica-node/src/{relay.rs, p2p.rs, explorer.rs, node.rs}`):
  - Extended binary length-prefixed `RelayMsg` framing with dedicated DHT message tags: `TAG_DHT_PING (0x20)`, `TAG_DHT_PONG (0x21)`, `TAG_DHT_FIND_NODE (0x22)`, `TAG_DHT_NODES / TAG_DHT_NEIGHBORS (0x23)`.
  - 64-bit query nonces for asynchronous request-response matching.
  - Full discrete-time simulation support in `Mesh` (`dht_bootstrap`, `dht_find_node`, `prune_unreachable_peers`).
  - Active peer pool replenishment in `Explorer` / `Node` pulling candidates from the DHT routing table and pruning disconnected peers.
- **Integration & Verification Layer** (`crates/kovanica-node/tests/dht_discovery.rs`):
  - Comprehensive 5-tier test suite verifying XOR math, K-buckets, framing, boundary cases, multi-node dynamic discovery, multi-hop isolated target routing, and peer pruning/replenishment over loopback TCP and discrete simulation.

## Feature Inventory
| # | Feature | Description | Milestone | Source | Status |
|---|---------|-------------|-----------|--------|--------|
| 1 | DNS Multi-Seed Resolver & Fallback Pipeline | Multi-host DNS querying, A/AAAA record resolution, shuffling, and static fallback IP pipeline (`dns_seed.rs`) | M1 | Survey / ORIGINAL_REQUEST R1 | SHIPPED |
| 2 | 256-bit NodeId & XOR Metric Engine | 256-bit NodeId representation, bitwise XOR distance calculation, and bucket index derivation (`dht.rs`) | M1 | Survey / ORIGINAL_REQUEST R1 | SHIPPED |
| 3 | K-Bucket Routing Table & LRU Eviction | 256 $k$-buckets ($k=8/20$), contact liveness tracking, replacement cache, ping eviction, and dead-peer pruning (`dht.rs`) | M1 | Survey / ORIGINAL_REQUEST R1 | SHIPPED |
| 4 | DHT Wire Protocol Messages & Framing | Binary framing and message codecs for `DhtPing`, `DhtPong`, `DhtFindNode`, `DhtNodes` with 64-bit nonces (`relay.rs`) | M1 | Survey / ORIGINAL_REQUEST R1 | SHIPPED |
| 5 | Iterative Node Lookup & Routing Algorithm | $\alpha=3$ iterative node lookup over distance-sorted candidate shortlists converging to $k$ closest nodes (`dht.rs`) | M1 | Survey / ORIGINAL_REQUEST R1 | SHIPPED |
| 6 | Mesh & Relay DHT Integration | In-process discrete-time simulation in `Mesh`, query handling in `handle_relay_query`, and peer replenishment (`p2p.rs`, `relay.rs`) | M1 | Survey / ORIGINAL_REQUEST R1 | SHIPPED |
| 7 | Dedicated Integration Test Suite | 4-tier integration test suite in `tests/dht_discovery.rs` testing multi-node dynamic discovery, multi-hop routing, and peer pruning | M2 | Survey / ORIGINAL_REQUEST R2 | SHIPPED |
| 8 | 100% E2E Pass & Adversarial Hardening | Tier 5 adversarial stress testing (churn, Sybil/poisoning, eclipse resistance, socket leak tests) and 100% pass verification | M3 | Survey / Pattern | SHIPPED |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | DNS Seed Discovery & Kademlia DHT Engine | Implement `dns_seed.rs`, `dht.rs`, wire framing in `relay.rs`, and simulation hooks in `p2p.rs`/`node.rs` | none | SHIPPED |
| 2 | Integration Test Suite (`tests/dht_discovery.rs`) | Complete 4-tier integration test suite for multi-seed bootstrap, dynamic discovery, multi-hop routing, and pruning | M1 | SHIPPED |
| 3 | Final E2E Pass & Adversarial Hardening | 100% E2E pass + Tier 5 adversarial stress testing (churn, Sybil resistance, eclipse protection) | M2 | SHIPPED |

## Interface Contracts
### DNS Multi-Seed Resolver (`dns_seed.rs`)
- `pub trait DnsResolver: Send + Sync { fn resolve(&self, host: &str, port: u16) -> Result<Vec<SocketAddr>, std::io::Error>; }`
- `pub struct StdDnsResolver;`
- `pub struct MockDnsResolver { records: HashMap<String, Vec<SocketAddr>> }`
- `pub struct DnsSeedResolver<R: DnsResolver> { resolver: R, seeds: Vec<String>, default_port: u16, fallbacks: Vec<SocketAddr> }`
- `resolver.resolve_all() -> Vec<SocketAddr>`

### Kademlia DHT (`dht.rs`)
- `pub struct NodeId(pub [u8; 32]);`
- `NodeId::random() -> Self` / `NodeId::from_bytes(b: [u8; 32]) -> Self` / `NodeId::distance(&self, other: &NodeId) -> [u8; 32]` / `NodeId::bucket_index(&self, other: &NodeId) -> Option<usize>`
- `pub struct PeerContact { pub node_id: NodeId, pub addr: String, pub last_seen_ms: u64, pub failed_queries: u32 }`
- `pub struct RoutingTable { pub local_id: NodeId, pub k: usize, buckets: Vec<KBucket> }`
- `table.update_contact(contact: PeerContact) -> UpdateResult`
- `table.closest_peers(target: &NodeId, count: usize) -> Vec<PeerContact>`
- `table.mark_failed(node_id: &NodeId) -> Option<PeerContact>` (prunes on 3 strikes, promotes from replacement cache)
- `table.prune_unresponsive(max_failed: u32) -> Vec<PeerContact>`

### Wire Protocol (`RelayMsg` & `relay.rs`)
- `TAG_DHT_PING = 0x20` / `RelayMsg::DhtPing { sender: NodeId, nonce: u64 }`
- `TAG_DHT_PONG = 0x21` / `RelayMsg::DhtPong { sender: NodeId, nonce: u64 }`
- `TAG_DHT_FIND_NODE = 0x22` / `RelayMsg::DhtFindNode { sender: NodeId, target: NodeId, nonce: u64 }`
- `TAG_DHT_NODES = 0x23` / `RelayMsg::DhtNodes { sender: NodeId, target: NodeId, nonce: u64, nodes: Vec<PeerContact> }`

### Simulation & Mesh API (`p2p.rs`)
- `mesh.add_with_dht(name: &str, node: Node, node_id: NodeId)`
- `mesh.dht_find_node(from: &str, target: &NodeId) -> Result<Vec<PeerContact>, P2pError>`
- `mesh.dht_bootstrap(from: &str, seed: &str) -> Result<usize, P2pError>`
- `mesh.prune_unreachable_peers()`

## Code Layout
- `crates/kovanica-node/src/dns_seed.rs`: DNS multi-seed resolver with injectable trait, standard and mock resolvers, and static fallback pipeline.
- `crates/kovanica-node/src/dht.rs`: NodeId, XOR metric math, K-buckets, routing table, LRU replacement cache, iterative lookup, and peer pruning.
- `crates/kovanica-node/src/relay.rs`: DHT wire message tags (`0x20`..`0x23`), codecs, and query handling.
- `crates/kovanica-node/src/p2p.rs`: Discrete-time simulation integration in `Mesh`.
- `crates/kovanica-node/src/node.rs`: `Node` DHT routing state and helper methods.
- `crates/kovanica-node/src/explorer.rs`: Live explorer background task integrating multi-seed resolution, DHT discovery, and peer pool replenishment.
- `crates/kovanica-node/tests/dht_discovery.rs`: Dedicated integration test suite.

