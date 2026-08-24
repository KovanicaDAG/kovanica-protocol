# Comprehensive Test Plan & Verification Strategy: Kademlia DHT Discovery & Multi-Seed Bootstrapping (`tests/dht_discovery.rs`)

**Author**: `survey_dht_explorer_3`  
**Date**: 2026-08-24  
**Target Subsystem**: `kovanica-node` (Kademlia DHT Peer Discovery, Multi-Seed DNS Bootstrapping, Routing Table Pruning & Replenishment, P2P Mesh Integration)  
**Primary Test Target**: `crates/kovanica-node/tests/dht_discovery.rs`  

---

## 1. Executive Summary & Verification Objectives

This document establishes the end-to-end verification strategy and test architecture for the **Kademlia-based Distributed Hash Table (DHT) peer routing** and **Multi-Seed DNS Bootstrapping** subsystems in `kovanica-node`. 

The objective is to ensure that `kovanica-node` achieves completely decentralized, autonomous peer discovery without reliance on single hardcoded IP addresses or centralized discovery servers, while strictly adhering to the protocol's determinism, performance, and safety invariants.

### Core Verification Goals
1. **Multi-Seed DNS Bootstrapping**: Verify that nodes can query multiple DNS seed hostnames, resolve them to active peer socket addresses, gracefully handle failed/offline seeds, and fall back to secondary mechanisms.
2. **Iterative Kademlia Multi-Hop Discovery**: Verify that an isolated node with zero knowledge of a target node's IP address can execute iterative `FindNode` lookups through intermediate DHT hops (XOR metric routing) and establish a direct P2P connection.
3. **Dynamic Pruning & Routing Table Replenishment**: Verify that unresponsive or disconnected peers are pruned from active P2P sets and replaced automatically by querying closest available contacts in the DHT routing table.
4. **Resilience & Adversarial Hardening**: Verify robust behavior under network churn, partition healing, packet loss, Sybil injection, and Eclipse attack attempts.

---

## 2. Analysis of Existing Test Infrastructure in `kovanica-node`

A rigorous inspection of `crates/kovanica-node/tests/` and `src/` reveals mature testing paradigms that form the foundation of the DHT discovery test suite:

| Test File | Key Patterns & Methodologies | Relevance to DHT Discovery Verification |
| :--- | :--- | :--- |
| `tests/p2p.rs` | Discrete-time in-process `Mesh` simulation (`Mesh::tick()`, `Mesh::drain()`, `now` step counter, `seen_blocks`/`seen_txs` dedup, `P2pHardening` rate limiting & scoring). | Provides the blueprint for deterministic, fast in-process DHT simulation (`DhtMesh`) without real TCP sockets. |
| `tests/relay.rs` | Long-lived persistent TCP socket framing (`RelaySession::accept`, `connect`), non-blocking timeouts (`set_read_timeout`), bidirectional framing. | Provides the model for multiplexing DHT wire messages (`Ping`, `Pong`, `FindNode`, `Nodes`) over persistent TCP/UDP streams. |
| `tests/network.rs` | In-process gossip, one-shot TCP dump sync, bidirectional framed TCP exchange, divergent DAG conflict convergence. | Demonstrates multi-node DAG convergence once DHT discovery successfully establishes overlay edges. |
| `tests/spv_sync.rs` | Request-response query handling (`handle_relay_query`), background worker threads with channels, header locator synchronization. | Models asynchronous request-response matching (`FindNode` -> `Nodes`, `Ping` -> `Pong`) with request nonces. |
| `tests/adversarial_spv.rs` | Framing fuzzing (20k pseudo-random iterations), byte truncation, bounds violations (`MAX_FRAME`, `MAX_HEADERS`), concurrent client load (30+ threads) + Byzantine probes. | Establishes the standard for fuzzing DHT wire decoders, testing frame size limits (`MAX_NODES_PER_RESPONSE`), and stress-testing concurrent DHT lookups. |
| `tests/challenger_consensus_sync.rs` | Mathematical property proofs (clamps, monotonic progression), boundary testing, exponential locator backoff. | Guides testing of mathematical properties of the 256-bit XOR metric, bucket index calculations, and routing table prefix trees. |
| `tests/timestamps.rs` | Injectable node clock (`Node::set_now_ms`), deterministic time progression. | Critical for testing contact timeout, LRU bucket eviction, and replacement cache expiration. |

---

## 3. Requirements Traceability Matrix

| Requirement ID | Specification Requirement (from `ORIGINAL_REQUEST.md`) | Test Case Coverage in `tests/dht_discovery.rs` |
| :--- | :--- | :--- |
| **REQ-DHT-1** | Distributed peer discovery via Kademlia DHT without hardcoded central seed IPs | `test_dynamic_mesh_formation_via_dht_discovery`, `test_bootstrap_cluster_convergence` |
| **REQ-DHT-2** | Newly joined isolated node finds target node via intermediate DHT routing hops | `test_multi_hop_isolated_node_target_discovery`, `test_iterative_lookup_alpha_concurrency` |
| **REQ-DHT-3** | Dynamic pruning of unreachable/disconnected peers and replenishment from DHT table | `test_dynamic_peer_pruning_and_dht_replenishment`, `test_bucket_lru_eviction_and_replacement_cache` |
| **REQ-DHT-4** | Multi-seed bootstrapping (DNS seed querying + mock DNS resolver fallback) | `test_multi_seed_dns_bootstrapping_with_fallbacks`, `test_dns_seed_failure_resilience` |
| **REQ-DHT-5** | XOR metric mathematical properties, bucket management, and wire message framing | `test_xor_distance_properties`, `test_k_bucket_invariants`, `test_dht_wire_framing_roundtrip_and_fuzz` |
| **REQ-DHT-6** | Adversarial resilience (churn, Sybil resistance, Eclipse attack defense) | `test_dht_high_churn_stress`, `test_sybil_poisoned_routing_table_resistance`, `test_eclipse_resistance_lru_protection` |

---

## 4. Test Harness & Infrastructure Architecture

To achieve both **blazing-fast deterministic unit/functional verification** and **full-fidelity end-to-end network integration testing**, the DHT test infrastructure uses a dual-harness architecture:

```
+-----------------------------------------------------------------------------+
|                          DHT VERIFICATION HARNESS                           |
+-----------------------------------------------------------------------------+
|                                                                             |
|  [ In-Process Discrete Harness ]            [ Real TCP Multi-Node Harness ] |
|  - `DhtMesh`: Step-by-step tick()           - `DhtTestCluster`: Ephemeral   |
|  - Simulated latency & drops                 ports (127.0.0.1:0)            |
|  - Zero OS socket overhead                  - Real RelaySession/TCP sockets |
|  - Deterministic random seeds               - Multi-threaded actors         |
|  - Inspects internal routing tables         - Real P2P Block & Tx gossip   |
|                                                                             |
|  [ Mock Injectable DNS Subsystem ]          [ Network Chaos & Fault Inject ]|
|  - `MockDnsResolver`: programmable          - Packet dropping simulator     |
|  - Simulates NXDOMAIN, timeouts, IPv4/v6    - Socket disconnect / reset     |
|                                                                             |
+-----------------------------------------------------------------------------+
```

### 4.1. Mock & Injectable DNS Resolver (`MockDnsResolver`)
To test DNS multi-seed discovery without real internet dependencies, we define a resolver trait:

```rust
pub trait DnsResolver: Send + Sync {
    fn resolve(&self, host: &str) -> Result<Vec<SocketAddr>, String>;
}

#[derive(Default, Clone)]
pub struct MockDnsResolver {
    records: Arc<Mutex<HashMap<String, Vec<SocketAddr>>>>,
    failures: Arc<Mutex<HashSet<String>>>,
}

impl MockDnsResolver {
    pub fn new() -> Self { Self::default() }
    pub fn add_record(&self, host: &str, addrs: Vec<SocketAddr>) {
        self.records.lock().unwrap().insert(host.to_string(), addrs);
    }
    pub fn set_failure(&self, host: &str) {
        self.failures.lock().unwrap().insert(host.to_string());
    }
}
```

### 4.2. In-Process Discrete DHT Simulation Harness (`DhtMesh`)
For Tier 1 and Tier 2 property and unit tests, `DhtMesh` coordinates nodes in discrete ticks without OS thread scheduling or networking delays:

```rust
pub struct DhtMesh {
    nodes: BTreeMap<String, DhtNodeInstance>,
    queue: Vec<DhtQueuedMessage>,
    now_ms: u64,
}
```

### 4.3. Real Multi-Node TCP Test Cluster (`DhtTestCluster`)
For Tier 4 and Tier 5 integration tests, `DhtTestCluster` manages real TCP listeners on ephemeral ports (`127.0.0.1:0`):

```rust
pub struct DhtTestCluster {
    nodes: Vec<RunningNodeHandle>,
    resolver: MockDnsResolver,
}
```

---

## 5. Comprehensive 5-Tier Test Case Enumeration

### Tier 1: Unit & Functional Tests (Primitives & Framing)

#### `T1.1: NodeId Generation, BLAKE3 Hashing & Representations`
* **Objective**: Verify that `NodeId` is a cryptographically robust 256-bit identifier derived deterministically (e.g. from public key or random generation), supports constant-time byte comparisons, hex formatting, and serialization.
* **Assertions**:
  - `NodeId::from_bytes` and `NodeId::as_bytes` round-trip identically.
  - `NodeId::from_hex` and `Display` (hex string) round-trip with 64 hex characters.
  - Distinct seeds produce distinct 256-bit `NodeId`s uniformly distributed across the keyspace.

#### `T1.2: XOR Distance Metric & Mathematical Invariants`
* **Objective**: Verify all formal mathematical invariants of the Kademlia XOR metric $d(x, y) = x \oplus y$.
* **Assertions**:
  - **Identity of Indiscernibles**: $d(x, y) = 0 \iff x = y$.
  - **Symmetry**: $d(x, y) = d(y, x)$ for all $x, y$.
  - **Triangle Inequality**: $d(x, z) \le d(x, y) \oplus d(y, z)$ (strict equality in XOR space).
  - **Bucket Index / Common Prefix Length**: `bucket_index(x, y) == 255 - (x ^ y).leading_zeros()`.
  - Prefix distance calculation correctly identifies the bucket $0 \le i < 256$.

#### `T1.3: K-Bucket Capacity, Insertion & LRU Ordering`
* **Objective**: Verify that each k-bucket maintains at most $k$ contacts (e.g., $k=8$ or $k=20$), orders contacts by last seen (LRU), and updates existing contacts to the most-recently-seen position.
* **Assertions**:
  - Inserting into an unfilled bucket appends the contact.
  - Re-inserting an existing contact moves it from its current position to the tail (most recently seen).
  - Querying `closest_nodes(target, count)` returns the $N$ contacts with strictly monotonic ascending XOR distance to `target`.

#### `T1.4: K-Bucket Saturation, Head Probing & Replacement Cache`
* **Objective**: Verify Kademlia's replacement policy when a bucket is full: ping the oldest contact (head); if it responds, keep it and store new contact in the replacement cache; if it fails, evict it and promote the replacement contact.
* **Assertions**:
  - Inserting a $(k+1)$-th contact into a full bucket triggers a probe of the oldest contact.
  - If the oldest contact responds to `Ping`, the bucket remains unchanged, and the new contact resides in `replacement_cache`.
  - If the oldest contact fails `Ping` (timeout), it is evicted and the candidate from `replacement_cache` is promoted.

#### `T1.5: DHT Wire Protocol Message Serialization & Deserialization`
* **Objective**: Verify binary encoding and decoding for all DHT wire messages (`TAG_DHT_PING`, `TAG_DHT_PONG`, `TAG_DHT_FIND_NODE`, `TAG_DHT_NODES`).
* **Message Formats Verified**:
  - `Ping { sender_id: NodeId, nonce: u64 }`
  - `Pong { echo_id: NodeId, nonce: u64 }`
  - `FindNode { target_id: NodeId, nonce: u64 }`
  - `Nodes { target_id: NodeId, nodes: Vec<PeerContact>, nonce: u64 }` where `PeerContact` holds `NodeId`, `SocketAddr`, and capabilities.
* **Assertions**:
  - Exact binary round-trip for all message variants.
  - Nonce preservation across request/response pairs.

#### `T1.6: Wire Framing Fuzzing, Bounds Checking & Truncation`
* **Objective**: Stress test DHT message decoders with malformed payloads.
* **Assertions**:
  - Truncated frames at every possible byte offset return `Err(NetError::Decode)` without panic.
  - Trailing garbage bytes return `Err(NetError::Decode)`.
  - Frame length exceeding `MAX_FRAME` (4 MB) is rejected immediately.
  - `Nodes` response with `nodes.len() > MAX_NODES_PER_RESPONSE` (e.g., > 32) returns `Err(NetError::Decode)`.
  - 20,000 pseudo-random fuzz payloads executed against `decode_msg` with 0 panics.

---

### Tier 2: Boundary & Corner Cases (Robustness & Error Handling)

#### `T2.1: Lookup in Empty Routing Table`
* **Objective**: Ensure queries against a newly initialized node with an empty routing table behave gracefully.
* **Assertions**:
  - `FindNode` on an empty routing table returns a `Nodes` response containing an empty list or only the node's bootstrap seed contacts.
  - No panic or invalid memory access occurs.

#### `T2.2: Self-Lookup Behavior`
* **Objective**: Ensure that a node querying for its own `NodeId` returns its closest known neighbors and does not include itself as a candidate peer to connect to.
* **Assertions**:
  - `find_node(self_id)` returns the $k$ closest distinct contacts.
  - The node's own address/ID is excluded from returned neighbor lists.

#### `T2.3: Nonce Mismatch & Stale Response Handling`
* **Objective**: Verify that responses with mismatched or expired nonces are safely dropped.
* **Assertions**:
  - A `Pong` or `Nodes` message received with a nonce not present in the pending request table is discarded.
  - Expired requests are purged after timeout (e.g., 3 seconds) without memory leakage.

#### `T2.4: Bogon & Duplicate IP Filtering`
* **Objective**: Prevent poisoning of routing tables with loopback, unroutable, or duplicate addresses.
* **Assertions**:
  - Rejects unspecified addresses (`0.0.0.0`, `::`), broadcast addresses, or invalid port numbers (`port == 0`).
  - Deduplicates multiple contacts with the same `(NodeId, SocketAddr)`.

#### `T2.5: Unresponsive Peer Handling during Iterative Lookups`
* **Objective**: Ensure the iterative lookup algorithm gracefully handles offline nodes in intermediate hops.
* **Assertions**:
  - If 1 of $\alpha$ queried nodes fails to respond, the lookup continues using candidate nodes returned by responsive peers.
  - The unresponsive node is marked with an increased failure count and eventually evicted.

#### `T2.6: Concurrent DHT Lookups & Thread Safety`
* **Objective**: Verify that multiple simultaneous `find_node` queries can execute in parallel without lock contention or state corruption.
* **Assertions**:
  - 20 concurrent tasks issuing lookups complete successfully and produce consistent routing table updates.

---

### Tier 3: Cross-Feature Integration (P2P Mesh, SPV, & Hardening)

#### `T3.1: Multiplexed Wire Framing: DHT Messages + Consensus Envelopes`
* **Objective**: Verify that DHT discovery messages and consensus envelopes (`Hello`, `Block`, `Tx`, `GetHeaders`, `Headers`, `MerkleBlock`) operate seamlessly over the same persistent TCP relay session.
* **Assertions**:
  - A single TCP connection carries interleaved `DhtPing`, `Block`, `DhtFindNode`, `Headers`, `DhtNodes` messages.
  - Both nodes process each message type correctly without frame corruption or protocol desynchronization.

#### `T3.2: Automated Bridge: DHT Discovery to Active P2P Mesh Connection`
* **Objective**: Verify that when DHT discovery locates a new closest node, the node automatically initiates a P2P handshake (`Hello`) and begins exchanging blocks and mempool transactions.
* **Assertions**:
  - Node A discovers Node B via DHT -> Node A dials Node B -> Nodes exchange `Hello` -> Block produced on A immediately gossips to B.

#### `T3.3: DHT Rate Limiting & Peer Scoring Integration`
* **Objective**: Ensure `P2pHardening` protects the DHT subsystem against query flooding and spam.
* **Assertions**:
  - A peer sending excessive `FindNode` queries exceeding `max_messages_per_window` is rate-limited.
  - A peer returning malformed DHT responses or spoofed NodeIDs receives a score penalty and is banned once crossing `ban_threshold`.

---

### Tier 4: Real-World Multi-Node Discovery Scenarios (`tests/dht_discovery.rs`)

#### `T4.1: Multi-Seed DNS Bootstrapping with Fallback`
* **Scenario**:
  - Configure a node with 3 DNS seed hostnames (`seed-a.kovanica.online`, `seed-b.kovanica.online`, `seed-c.kovanica.online`).
  - `seed-a` fails (simulated NXDOMAIN / timeout).
  - `seed-b` resolves to 2 active seed nodes (`127.0.0.1:9101`, `127.0.0.1:9102`).
  - `seed-c` resolves to 1 active seed node (`127.0.0.1:9103`).
* **Assertions**:
  - The bootstrapping node resolves seeds in parallel.
  - Successfully handles `seed-a` failure without aborting.
  - Connects to reachable seeds from `seed-b` and `seed-c`, populating its routing table with initial contacts.

#### `T4.2: Dynamic Mesh Formation Across 6 Nodes without Hardcoded IPs`
* **Scenario**:
  - Spin up 6 real nodes: Seed 0, and Nodes 1..5.
  - Node 0 is the bootstrap seed. Nodes 1..5 are given ONLY Node 0's address.
  - Nodes 1..5 join sequentially and run DHT discovery.
* **Assertions**:
  - Each node executes iterative `FindNode` self-lookups.
  - Within bounded time (< 5 seconds), all nodes discover all other nodes.
  - A transaction pooled on Node 5 gossips across the DHT-discovered mesh and is included in a block produced by Node 1.

#### `T4.3: Multi-Hop Isolated Node Target Discovery`
* **Scenario**:
  - Setup a 5-node routing line: `Node A -> Node B -> Node C -> Node D -> Target T`.
  - Node A only knows B; B only knows C; C only knows D; D only knows T.
  - A newly spawned isolated Node `N` connects ONLY to Node A.
  - Node `N` has never seen Target `T`'s IP address.
  - Node `N` initiates `find_node(T.node_id)`.
* **Assertions**:
  - Node N queries A, receives B; queries B, receives C; queries C, receives D; queries D, receives T's exact `SocketAddr`.
  - Node N connects directly to Target T over TCP.
  - Node N sends 100 KVNC to Target T and Target T verifies the transaction.

#### `T4.4: Dynamic Peer Disconnection, Pruning & Routing Table Replenishment`
* **Scenario**:
  - Node A maintains a target connection count of 2 peers, currently connected to Peer B and Peer C.
  - Peer B is abruptly terminated (`TcpStream` closed).
  - Node A detects connection drop.
* **Assertions**:
  - Node A prunes Peer B from active peer list and marks B as failed in DHT table.
  - Node A triggers a DHT lookup to find the next closest candidate from its k-buckets (discovering Peer D).
  - Node A establishes connection to Peer D, restoring its target degree of 2 active peers.

#### `T4.5: Dynamic Network Partition Healing via Bridge Node`
* **Scenario**:
  - Cluster 1 (Nodes A, B, C) and Cluster 2 (Nodes D, E, F) are disjoint.
  - Bridge Node G comes online and joins both clusters via DHT.
* **Assertions**:
  - DHT routing tables merge across the bridge.
  - Cluster 1 nodes discover Cluster 2 nodes.
  - A block mined in Cluster 1 reaches Cluster 2 and both clusters converge on the same selected tip.

---

### Tier 5: Adversarial & Stress Tests

#### `T5.1: High Churn Stress Test`
* **Objective**: Evaluate DHT stability under continuous, aggressive node churn.
* **Scenario**:
  - 15 nodes active in a cluster.
  - A background churn thread randomly kills 3 nodes and spawns 3 new nodes on fresh ports every 200ms for 5 seconds.
  - Honest nodes continuously produce and transfer blocks.
* **Assertions**:
  - Zero panics, deadlocks, or unbounded memory growth.
  - Surviving nodes continuously discover new peers and maintain DAG synchronization.

#### `T5.2: Sybil & Poisoned Routing Table Resistance`
* **Objective**: Defend against malicious nodes injecting hundreds of fake, unroutable contacts in `Nodes` responses.
* **Scenario**:
  - Byzantine node replies to `FindNode` with 32 fake IP addresses (unreachable / bogus).
* **Assertions**:
  - The victim node inserts unverified contacts into a pending/probing queue or replacement cache.
  - Unresponsive fake contacts fail health check probes and are never promoted to displace verified, honest contacts in primary k-buckets.

#### `T5.3: Eclipse Attack Resistance (LRU Protection)`
* **Objective**: Verify that an attacker cannot displace established honest nodes from a victim's k-buckets by flooding the victim with attacker NodeIDs.
* **Scenario**:
  - Attacker generates 1,000 NodeIDs with common prefixes matching the victim's buckets and floods `Ping`/`Hello` messages.
* **Assertions**:
  - Because established honest nodes at the head of the k-buckets are responsive to ping challenges, they are retained.
  - Attacker contacts remain in replacement caches and fail to eclipse the victim.

#### `T5.4: High-Concurrency Discovery Load & Connection Leaks`
* **Objective**: Verify that 50 concurrent light clients querying a full node's DHT interface do not exhaust file descriptors or leak sockets.
* **Assertions**:
  - All 50 concurrent lookups complete within 3 seconds.
  - Active socket count returns to baseline after test completion.

---

## 6. Implementation Blueprint for `crates/kovanica-node/tests/dht_discovery.rs`

Below is the concrete code skeleton and test harness layout to be placed in `crates/kovanica-node/tests/dht_discovery.rs`:

```rust
//! Integration and End-to-End Verification Suite for Kademlia DHT Discovery,
//! Multi-Seed DNS Bootstrapping, Dynamic Pruning, and Peer Replenishment.

use std::net::{SocketAddr, TcpListener};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use kovanica_dag::BlockId;
use kovanica_node::dht::{
    DhtConfig, DhtNode, DhtMsg, KBucket, NodeId, PeerContact, RoutingTable,
    MockDnsResolver, DhtService,
};
use kovanica_node::relay::{RelayMsg, RelaySession};
use kovanica_node::{Node, NetError};

fn genesis_node() -> Node {
    let mut node = Node::new();
    node.set_now_ms(1_000);
    node.genesis(3, 1000, 1000, 1).unwrap();
    node
}

// ============================================================================
// 1. TIER 1: UNIT & FUNCTIONAL TESTS
// ============================================================================

#[test]
fn test_xor_distance_and_prefix_metric_properties() {
    let id_a = NodeId::from_bytes([0xAA; 32]);
    let id_b = NodeId::from_bytes([0x55; 32]);
    let id_c = NodeId::from_bytes([0xFF; 32]);

    // Identity
    assert_eq!(id_a.distance_to(&id_a), [0u8; 32]);
    // Symmetry
    assert_eq!(id_a.distance_to(&id_b), id_b.distance_to(&id_a));
    // Triangle Inequality / XOR metric
    let d_ab = id_a.distance_to(&id_b);
    let d_bc = id_b.distance_to(&id_c);
    let d_ac = id_a.distance_to(&id_c);
    assert_eq!(d_ac, NodeId::xor_bytes(&d_ab, &d_bc));
}

#[test]
fn test_k_bucket_insertion_and_lru_ordering() {
    let self_id = NodeId::from_bytes([0x00; 32]);
    let mut table = RoutingTable::new(self_id, 8); // k = 8

    for i in 1..=8 {
        let contact = PeerContact::new(
            NodeId::from_bytes([i as u8; 32]),
            format!("127.0.0.1:900{}", i).parse().unwrap(),
        );
        assert!(table.insert(contact));
    }

    // Bucket is now full (8 items)
    assert_eq!(table.total_contacts(), 8);

    // Re-inserting contact 1 moves it to most-recently-seen
    let contact_1 = PeerContact::new(
        NodeId::from_bytes([1u8; 32]),
        "127.0.0.1:9001".parse().unwrap(),
    );
    table.update_last_seen(&contact_1);

    // 9th contact goes to replacement cache
    let contact_9 = PeerContact::new(
        NodeId::from_bytes([9u8; 32]),
        "127.0.0.1:9009".parse().unwrap(),
    );
    table.insert(contact_9);
    assert_eq!(table.replacement_cache_len(), 1);
}

// ============================================================================
// 2. TIER 4: REAL-WORLD MULTI-NODE DISCOVERY INTEGRATION TESTS
// ============================================================================

#[test]
fn test_e2e_multi_seed_dns_bootstrapping() {
    let mock_resolver = MockDnsResolver::new();
    mock_resolver.set_failure("seed1.kovanica.online");
    mock_resolver.add_record(
        "seed2.kovanica.online",
        vec!["127.0.0.1:9801".parse().unwrap(), "127.0.0.1:9802".parse().unwrap()],
    );
    mock_resolver.add_record(
        "seed3.kovanica.online",
        vec!["127.0.0.1:9803".parse().unwrap()],
    );

    let seeds = vec![
        "seed1.kovanica.online".into(),
        "seed2.kovanica.online".into(),
        "seed3.kovanica.online".into(),
    ];

    let resolved = mock_resolver.resolve_seeds(&seeds);
    assert_eq!(resolved.len(), 3);
    assert!(resolved.contains(&"127.0.0.1:9801".parse().unwrap()));
    assert!(resolved.contains(&"127.0.0.1:9802".parse().unwrap()));
    assert!(resolved.contains(&"127.0.0.1:9803".parse().unwrap()));
}

#[test]
fn test_e2e_isolated_node_multi_hop_target_discovery_over_tcp() {
    // 1. Setup 3 nodes over TCP: Node A (seed), Node B (intermediate), Node C (target)
    let listener_c = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr_c = listener_c.local_addr().unwrap();
    let id_c = NodeId::from_bytes([0xCC; 32]);

    let listener_b = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr_b = listener_b.local_addr().unwrap();
    let id_b = NodeId::from_bytes([0xBB; 32]);

    let listener_a = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr_a = listener_a.local_addr().unwrap();
    let id_a = NodeId::from_bytes([0xAA; 32]);

    // Node B knows Node C. Node A knows Node B.
    // Node D (newly joined) connects to Node A and searches for Node C.
    // ... [Full background thread acceptor and iterative lookup assertion] ...
}

#[test]
fn test_e2e_dynamic_peer_pruning_and_dht_replenishment() {
    // 1. Node A is connected to Peer B and Peer C.
    // 2. Peer B disconnects.
    // 3. Node A detects drop, evicts B, queries DHT table, and connects to Peer D.
    // ... [Assertion: active peer count maintained and DAG blocks sync to D] ...
}
```

---

## 7. Verification Checklist & Gate Exit Criteria

- [ ] All 6 unit tests for XOR distance, bucket capacity, and LRU ordering pass.
- [ ] Binary serialization round-trips for `Ping`, `Pong`, `FindNode`, `Nodes` pass.
- [ ] Framing fuzzing (20,000 random inputs) passes with zero panics.
- [ ] DNS multi-seed resolution test with simulated failures passes without blocking.
- [ ] Multi-hop iterative discovery integration test passes over real loopback TCP sockets.
- [ ] Peer disconnect and automatic DHT replenishment test passes.
- [ ] High-churn and Sybil attack resilience tests pass with zero state corruption.
- [ ] Clean compilation under `cargo test -p kovanica-node --test dht_discovery` and `cargo clippy --all-targets -- -D warnings`.

---

## 8. Summary of Findings

1. **Test Infrastructure Readiness**: Existing modules (`p2p.rs`, `relay.rs`, `adversarial_spv.rs`) provide robust foundations for connection management, framing, and adversarial testing that directly transfer to DHT discovery testing.
2. **Injectable DNS Resolver is Essential**: To guarantee hermetic and deterministic CI builds without external DNS queries, introducing a `DnsResolver` trait with a `MockDnsResolver` implementation is necessary.
3. **Iterative Multi-Hop Routing is Fully Verifiable**: Combining ephemeral TCP sockets (`127.0.0.1:0`) and request nonce tracking enables deterministic verification of multi-hop routing traversal.
4. **Dynamic Replenishment Protects Mesh Health**: Verifying automatic eviction of stale contacts upon connection failure and replacement from k-buckets guarantees long-term node liveness.
