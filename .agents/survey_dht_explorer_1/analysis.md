# Comprehensive P2P Networking, Discovery, Relay, and Mesh Architecture Survey

**Document Target**: `/root/kovanica-protocol/.agents/survey_dht_explorer_1/analysis.md`  
**Author**: `survey_dht_explorer_1`  
**Date**: 2026-08-24  
**Scope**: `crates/kovanica-node/src/{p2p.rs, relay.rs, net.rs, node.rs, main.rs, explorer.rs, p2p_hardening.rs}` and integration test harnesses in `crates/kovanica-node/tests/`.

---

## 1. Executive Summary

`kovanica-node` is the runnable node and networking layer for the Kovanica BlockDAG protocol (GHOSTDAG consensus core). Currently, networking operates across two separate abstractions:
1. **In-process discrete-time simulation (`Mesh` in `p2p.rs`)**: An event-driven overlay tracking named `Node` instances, designed for deterministic multi-node consensus, flood gossip, mempool eviction, and rate-limiting tests without OS threads or network sockets.
2. **On-wire TCP networking (`net.rs`, `relay.rs`, `explorer.rs`)**:
   - One-shot and streaming sync over TCP (`serve_blocks`, `pull_blocks`, `serve_headers_first`, `sync_headers_first`).
   - Long-lived framed TCP sessions (`RelaySession` in `relay.rs`) carrying hello, block, transaction, and SPV query/response frames.
   - Self-hosted live node and web explorer (`explorer.rs`) with dual-stack TCP listeners (`KOVANICA_LISTEN`, default `0.0.0.0:9000`), polling static bootstrap peers (`KOVANICA_PEERS`, default `seed.kovanica.online:9000`).

### Core Problem Identified
The current node discovery relies on a single hardcoded seed (`seed.kovanica.online:9000`) and a rudimentary 1-hop neighbor advertisement inside `RelayMsg::Hello`. There is **no dynamic multi-seed DNS resolution**, **no routing table**, and **no distributed mechanism (DHT)** for nodes to find peers across arbitrary network partitions or behind private IPs/NATs without direct static configuration. Furthermore, `Mesh` and `Explorer` maintain append-only/monotonic peer sets without dead-peer eviction.

This report delivers a full architectural survey of existing networking code and provides a concrete, end-to-end integration blueprint for:
- **DNS Multi-Seed Discovery**: Querying multiple seed domains and resolving dynamic A/AAAA records with fallback and shuffling.
- **Kademlia-based Distributed Hash Table (DHT)**: A 256-bit XOR-metric routing table with $k$-buckets, `PING`/`PONG`/`FIND_NODE`/`NEIGHBORS` RPCs, iterative node lookup, and dead-peer pruning.
- **Integration Layer**: Seamless interoperability with `Mesh` (for deterministic simulation and integration testing in `tests/dht_discovery.rs`), `RelaySession` (for persistent TCP wire framing), and `Explorer`/`Node` (for live background peer discovery).

---

## 2. Deep Dive: Current Networking & Connection Structures

### 2.1 Peer and Connection Representation

#### A. In-Process Overlay: `Mesh` (`p2p.rs`)
In `p2p.rs:108-119`, `Mesh` models an in-process network:
```rust
pub struct Mesh {
    nodes: BTreeMap<String, Node>,
    peers: BTreeMap<String, BTreeSet<String>>,
    queue: Vec<Queued>,
    seen_blocks: BTreeMap<String, HashSet<BlockId>>,
    seen_txs: BTreeMap<String, HashSet<TxId>>,
    now: u64,
    events: Vec<GossipEvent>,
    hardening: P2pHardening,
}
```
- **Node Identifier**: Node instances are indexed by arbitrary `String` names (`"alpha"`, `"beta"`, etc.).
- **Peer Set**: `peers` stores directed relationships: `connect("a", "b")` inserts `"b"` into `peers["a"]`.
- **Discrete Time**: `Mesh::tick()` advances an integer clock `now` and delivers due envelopes (`Queued { due, from, to, envelope }`).

#### B. Persistent TCP Relay: `RelaySession` (`relay.rs`)
In `relay.rs:81-84`, `RelaySession` provides long-lived, bidirectional stream communication:
```rust
pub struct RelaySession {
    stream: TcpStream,
}
```
- Operates over `std::net::TcpStream` with `TCP_NODELAY` set to `true`.
- Supports configurable timeouts via `set_read_timeout` and `set_write_timeout`.
- `Node` is deliberately `!Send` (due to interior ledger/DAG data structures), so `RelaySession` handles I/O only, while message processing occurs on the node-owning thread via `apply_relay(node, msg)` and `handle_relay_query(node, msg)`.

#### C. Live Node & Explorer: `Explorer` (`explorer.rs`)
In `explorer.rs:88-104`, the node manages runtime networking:
- **Listening Sockets**: `listen: Vec<TcpListener>` accepts incoming connections non-blockingly. Dual-stack binding (`explorer.rs:432-471`) binds IPv4 (`0.0.0.0:9000`) and IPv6 (`[::]:9000` with `IPV6_V6ONLY` via `socket2`).
- **Configured Peers**: `peers: Vec<String>` holds a static list of peer hostnames/IPs.
- **WebSocket Broadcast**: `ws_clients: Arc<Mutex<Vec<Arc<Mutex<TcpStream>>>>>` serves live JSON state updates to web clients.

---

### 2.2 Wire Framing and Message Protocol

#### A. Framing Specification
Across `relay.rs` and `net.rs`, messages use length-prefixed binary framing:
```
+--------------------------+-----------------------+-----------------------------+
| Length Prefix (4 bytes)  | Message Tag (1 byte)  | Payload (Variable length)   |
| u32 little-endian        | u8 Tag                | Serialized binary fields    |
+--------------------------+-----------------------+-----------------------------+
```
- **Safety Bound**: Maximum frame size is guarded by `MAX_FRAME = 4 * 1024 * 1024` (4 MB) in `relay.rs:34` and `MAX_FRAME_BYTES = 16 * 1024 * 1024` (16 MB) in `net.rs:367`.
- **Integer Encoding**: Little-endian (`to_le_bytes()` / `from_le_bytes()`).

#### B. Allocated Message Tags

| Tag Byte | Constant Identifier | Purpose | Defined In |
|---|---|---|---|
| `0x00` | `TAG_HELLO` | Peer discovery hello (`from`, `advertised` list) | `relay.rs:24` |
| `0x01` | `TAG_BLOCK` | Full `BlockRecord` (parents, work, timestamp, nonce, txs) | `relay.rs:25` |
| `0x02` | `TAG_TX` | Mempool `Transaction` broadcast | `relay.rs:26` |
| `0x10` | `TAG_INVENTORY` | Sorted list of all known `BlockId`s for sync | `net.rs:355` |
| `0x11` | `TAG_HEADERS` | Batch of `BlockHeader` or SPV `BlockHeader`s | `relay.rs:27`, `net.rs:356` |
| `0x12` | `TAG_GETHEADERS` | Header request with locator hashes & stop hash | `relay.rs:28`, `net.rs:357` |
| `0x13` | `TAG_GETBLOCKS` / `TAG_GETBODIES` | Block inventory or body request | `relay.rs:29`, `net.rs:358` |
| `0x14` | `TAG_BODIES` | Batch of full block bodies (`BlockRecord`s) | `net.rs:359` |
| `0x15` | `TAG_GET_MERKLE_PROOF` | SPV Merkle inclusion proof request | `relay.rs:30`, `net.rs:360` |
| `0x16` | `TAG_MERKLEBLOCK` | SPV Merkle proof response | `relay.rs:31`, `net.rs:361` |

*Note for DHT Integration*: The range `0x20`–`0x2F` is completely unallocated and ideal for DHT messages (`TAG_DHT_PING`, `TAG_DHT_PONG`, `TAG_DHT_FIND_NODE`, `TAG_DHT_NEIGHBORS`).

---

### 2.3 Handshake & Neighbor Discovery

The existing discovery protocol in `Mesh` (`p2p.rs:499-517`) and `RelaySession` (`relay.rs:43-48`) is structured as follows:

```rust
// relay.rs:43-48
RelayMsg::Hello {
    from: String,
    advertised: Vec<String>,
}
```

```
Node A                                     Node B
  |                                          |
  | -------- RelayMsg::Hello(A, [C, D]) ---> |
  |                                          | Node B updates peers with A, C, D
  | <------- RelayMsg::Hello(B, [E, F]) ---- | Node B replies with its own peers
  |                                          |
Node A updates peers with B, E, F
```

#### Detailed Execution in `Mesh::on_hello` (`p2p.rs:499-517`):
1. Node $B$ receives `Hello { from: "A", advertised: ["C", "D"] }`.
2. $B$ inserts `"A"` into `peers["B"]`. If `"A"` was not previously present, $B$ enqueues a reciprocal `Hello` back to `"A"`.
3. For each peer $P \in \{\text{"C"}, \text{"D"}\}$, if $P \neq B$, $P \neq A$, and $P$ exists in `self.nodes`, $B$ inserts $P$ into `peers["B"]` and enqueues a `Hello` to $P$.
4. **Key Finding**: This forms an in-process 1-hop gossip expansion. However, in live networking (`explorer.rs`), `RelayMsg::Hello` is received but discarded or only logged (`apply_relay` returns `Some(hello)` but `explorer.rs` does not ingest advertised peers into a persistent routing table).

---

### 2.4 P2P Hardening, Rate Limiting, and Scoring (`p2p_hardening.rs`)

`P2pHardening` provides defensive mechanisms for peer connections:
- **Rate Limiting** (`p2p_hardening.rs:68-104`): Token-bucket/windowed check limiting bytes (`max_bytes_per_window = 1 MB`) and messages (`max_messages_per_window = 1000`) per `rate_window_ticks = 100`.
- **Duplicate Suppression** (`p2p_hardening.rs:106-127`): Per-peer tracking of known block and transaction IDs to penalize spam.
- **Scoring & Auto-Banning** (`p2p_hardening.rs:129-172`):
  - Valid block: `+1`, Duplicate block: `-5`, Invalid block: `-20`.
  - Valid tx: `+1`, Duplicate tx: `-2`, Invalid tx: `-10`.
  - Auto-ban threshold: `-50` (peer is permanently dropped from relaying).
- **Integration Opportunity**: When integrating the DHT, failed DHT pings or malformed routing responses can directly adjust peer scores, triggering automatic eviction and banning of Byzantine nodes.

---

## 3. Seed Configuration & Bootstrapping Mechanisms

### 3.1 Hardcoded Constants & Defaults
- `P2P_BOOTSTRAP = "seed.kovanica.online:9000"` (`explorer.rs:37`): The sole default bootstrap seed node.
- `P2P_LISTEN_DEFAULT = "0.0.0.0:9000"` (`explorer.rs:36`): The default TCP listening port.

### 3.2 Configuration Channels
1. **Environment Variables**:
   - `KOVANICA_PEERS`: Comma-separated list of peer addresses (e.g. `KOVANICA_PEERS=seed1.kovanica.online:9000,seed2.kovanica.online:9000`). If empty or off (`0`, `off`, `none`, `false`), outbound peer sync is disabled (`peer_list()` in `explorer.rs:493-503`).
   - `KOVANICA_LISTEN`: Sockets to bind (e.g., `0.0.0.0:9000`). If `0`/`off`, listening is disabled (`bind_p2p()` in `explorer.rs:419-430`).
   - `KOVANICA_DATA`: Data directory (default `"data"`), storing `.snap`, `.miner`, `origins.txt`, `taps.txt`.
2. **CLI Modes (`main.rs`)**:
   - `kovanica-node serve`: Line-based RPC over stdin/stdout.
   - `kovanica-node demo`: Scripted test run.
   - `kovanica-node explorer [addr]`: Launches the explorer on HTTP `[addr]` (default `0.0.0.0:8080`) and starts TCP P2P networking on `KOVANICA_LISTEN`.

### 3.3 Limitations & Failure Modes
1. **Single Point of Failure**: If `seed.kovanica.online` is down or unresolvable, new nodes with default settings fail to bootstrap entirely.
2. **No Dynamic DNS Multi-A/AAAA Record Resolution**: `ToSocketAddrs` is only called per connection attempt, without extracting multiple distinct node endpoints behind a single DNS round-robin name.
3. **Static Peer Lifecycle**: Once initialized, `Explorer.peers` is a fixed `Vec<String>`. Newly discovered peers over P2P are never added to `Explorer.peers`, nor are dead peers removed.

---

## 4. Mesh Lifecycle, Peer Management & Relay Mechanics

### 4.1 Discrete-Time Mesh Simulation vs Real TCP Sockets

| Feature | `Mesh` (`p2p.rs`) | Live TCP (`explorer.rs` / `relay.rs`) |
|---|---|---|
| **Time Model** | Discrete ticks (`now: u64`) | Real wall-clock / thread sleep (40ms tick) |
| **Concurrency** | Single-threaded synchronous | Non-blocking accept loop + optional worker threads |
| **Peer Storage** | `BTreeMap<String, BTreeSet<String>>` | `Vec<String>` (config) + ephemeral `TcpStream` |
| **Execution** | Deterministic across test runs | Asynchronous network I/O with timeouts |
| **Flood Queue** | In-memory `Vec<Queued>` with due timestamps | Direct TCP socket send/recv |

### 4.2 Flood Propagation & Seen-Sets
In `p2p.rs:423-452`:
- `announce_block(from, record)` and `announce_tx(from, tx)` calculate the content-addressed ID:
  - Block: BLAKE3 hash over parents, work, timestamp, nonce, encoded payload.
  - Tx: BLAKE3 transaction ID.
- The ID is added to `seen_blocks[from]` / `seen_txs[from]`.
- An envelope is queued for every peer $P \in \text{peers}[from]$.
- When delivered (`on_block` / `on_tx`), the receiving node checks its own seen-set. If already present, forwarding terminates immediately. Otherwise, it forwards to all its peers (excluding the sender), terminating the flood in $O(\text{diameter})$ ticks.

### 4.3 Peer Removal / Disconnect Gaps
- `Mesh` currently lacks `disconnect(&mut self, from: &str, to: &str)` and `remove_node(&mut self, name: &str)`.
- `peers` never shrinks unless manually reset.
- Banning via `P2pHardening` prevents message processing but does not prune routing edges.

---

## 5. Architectural Specification & Integration Blueprint for DHT & DNS Multi-Seed Discovery

To satisfy user requirements (R1: Distributed Peer Discovery, R2: Integration Verification in `tests/dht_discovery.rs`), we specify a three-part architecture:
1. **DNS Multi-Seed Resolver (`dns_seed.rs`)**
2. **Kademlia-style Distributed Hash Table (`dht/` or `kademlia.rs`)**
3. **Integration with `Mesh`, `RelaySession`, `Node`, and `Explorer`**

```
+-----------------------------------------------------------------------------------+
|                                  kovanica-node                                    |
|                                                                                   |
|  +---------------------------+       +-----------------------------------------+  |
|  |     DNS Multi-Seed        |       |          Kademlia DHT Engine            |  |
|  |     Resolver              | ----> |  - 256-bit NodeId (XOR metric)          |  |
|  | - seed1.kovanica.online   |       |  - 256 k-buckets (k=8 or k=20)          |  |
|  | - seed2.kovanica.online   |       |  - PING / PONG / FIND_NODE / NEIGHBORS  |  |
|  | - fallback seed IP list   |       |  - Iterative lookup (alpha=3)           |  |
|  +---------------------------+       |  - Dead peer pruning & bucket refresh   |  |
|                                      +-----------------------------------------+  |
|                                                           |                       |
|                 +-----------------------------------------+                       |
|                 |                                         |                       |
|                 v                                         v                       |
|  +-------------------------------+       +-------------------------------------+  |
|  |     In-Process Simulation     |       |          Live Wire Networking       |  |
|  |        (`p2p::Mesh`)          |       |        (`relay.rs` / `net.rs`)      |  |
|  | - Discrete-time DHT routing   |       | - Framed TCP Relay (tags 0x20-0x23) |  |
|  | - Deterministic unit tests    |       | - RelaySession message dispatch     |  |
|  | - `tests/dht_discovery.rs`    |       | - `Explorer` PeerManager loop       |  |
|  +-------------------------------+       +-------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

### 5.1 Subsystem 1: DNS Multi-Seed Resolver (`dns_seed.rs`)

#### A. Objectives
- Query multiple DNS seed hostnames.
- Resolve all distinct IPv4 and IPv6 addresses.
- Shuffle and deduplicate discovered endpoints.
- Provide graceful fallback if DNS resolution fails.

#### B. Data Structures & API
```rust
pub struct DnsSeedConfig {
    /// List of DNS seed hostnames (e.g. ["seed1.kovanica.online", "seed2.kovanica.online"])
    pub seeds: Vec<String>,
    /// Default port to attach if not specified (default: 9000)
    pub default_port: u16,
    /// Static fallback socket addresses if all DNS seeds fail
    pub fallbacks: Vec<std::net::SocketAddr>,
    /// Maximum IPs to return per seed
    pub max_ips_per_seed: usize,
}

pub struct DnsSeedResolver {
    config: DnsSeedConfig,
}

impl DnsSeedResolver {
    pub fn new(config: DnsSeedConfig) -> Self;
    
    /// Resolve all configured seeds to a shuffled list of unique SocketAddrs.
    pub fn resolve_all(&self) -> Vec<std::net::SocketAddr>;
    
    /// Resolve a specific hostname to all underlying A and AAAA SocketAddrs.
    pub fn resolve_host(&self, host: &str, port: u16) -> Vec<std::net::SocketAddr>;
}
```

#### C. Environment & Configuration Parsing
In `explorer.rs` / `main.rs`:
- `KOVANICA_SEEDS` or `KOVANICA_DNS_SEEDS`: Comma-separated list of seed hostnames.
- Default seeds:
  ```rust
  const DEFAULT_DNS_SEEDS: &[&str] = &[
      "seed.kovanica.online:9000",
      "seed1.kovanica.online:9000",
      "seed2.kovanica.online:9000",
      "seed.kovanica.net:9000",
  ];
  ```
- If DNS resolution fails, fallback to hardcoded IP seeds or existing cache `data/peers.json`.

---

### 5.2 Subsystem 2: Kademlia-based DHT Routing Table (`dht.rs` or `kademlia.rs`)

#### A. Keyspace & Distance Metric
1. **Node ID (`NodeId`)**:
   ```rust
   #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
   pub struct NodeId(pub [u8; 32]);
   ```
   - Generated from a BLAKE3 hash of the node's public key or socket address, or generated randomly at startup.
2. **XOR Metric**:
   $$d(x, y) = x \oplus y$$
   ```rust
   impl NodeId {
       pub fn distance(&self, other: &NodeId) -> [u8; 32] {
           let mut dist = [0u8; 32];
           for i in 0..32 {
               dist[i] = self.0[i] ^ other.0[i];
           }
           dist
       }
       
       /// Leading zero bits of the XOR distance (0..256), determining the bucket index.
       pub fn leading_zeros(&self, other: &NodeId) -> usize {
           let dist = self.distance(other);
           let mut count = 0;
           for &b in &dist {
               if b == 0 {
                   count += 8;
               } else {
                   count += b.leading_zeros() as usize;
                   break;
               }
           }
           count
       }
   }
   ```

#### B. Routing Table & K-Buckets
- **Bucket Parameter $k$**: Standard $k=8$ (lightweight for embedded/testnet) or $k=20$ (standard Kademlia).
- **Concurrency $\alpha$**: $\alpha = 3$ concurrent queries per iterative lookup step.
- **Bucket Index**: $256 - \text{leading\_zeros}(d(\text{self}, \text{peer}))$. Bucket index ranges from $0$ to $255$.
- **Peer Entry**:
  ```rust
  #[derive(Clone, Debug, PartialEq, Eq)]
  pub struct PeerContact {
      pub node_id: NodeId,
      pub addr: String,          // e.g. "192.168.1.5:9000" or in-process node name
      pub last_seen_ms: u64,
      pub failed_queries: u32,
  }
  ```
- **K-Bucket Implementation**:
  ```rust
  pub struct KBucket {
      contacts: Vec<PeerContact>,
      replacement_cache: Vec<PeerContact>,
      max_size: usize,
  }
  ```
- **Eviction & Replacement Policy**:
  - When inserting a contact into a full bucket:
    1. Ping the oldest (head) contact in the bucket.
    2. If the oldest contact responds, move it to the tail (most recently seen) and place the new contact into `replacement_cache`.
    3. If the oldest contact fails/times out, evict it and append the new contact to the bucket.

#### C. DHT Wire Protocol Messages
In `relay.rs`, add new message tags and enum variants:

```rust
pub const TAG_DHT_PING: u8 = 0x20;
pub const TAG_DHT_PONG: u8 = 0x21;
pub const TAG_DHT_FIND_NODE: u8 = 0x22;
pub const TAG_DHT_NEIGHBORS: u8 = 0x23;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DhtMsg {
    Ping {
        sender: NodeId,
        nonce: u64,
    },
    Pong {
        sender: NodeId,
        nonce: u64,
    },
    FindNode {
        sender: NodeId,
        target: NodeId,
    },
    Neighbors {
        sender: NodeId,
        target: NodeId,
        peers: Vec<PeerContact>,
    },
}
```

#### D. Iterative Node Lookup Procedure
1. Given target `target_id`:
2. Select the $\alpha=3$ closest contacts to `target_id` from the local routing table.
3. Send `FindNode { sender: self.node_id, target: target_id }` to each.
4. On receiving `Neighbors { peers, .. }`:
   - Add new contacts into local routing table.
   - Select the closest unqueried contacts and query them.
5. Terminate when the $k$ closest nodes have all been queried and no closer nodes are discovered.
6. Return the $k$ closest active contacts.

---

### 5.3 Subsystem 3: Integration into `Mesh`, `RelaySession`, and `Node`

#### A. In-Process `Mesh` Integration (`p2p.rs`)
To enable discrete-time deterministic testing (such as `tests/dht_discovery.rs`), `Mesh` must support DHT operations:
```rust
impl Mesh {
    /// Register a node with an explicit NodeId for DHT routing.
    pub fn add_with_dht(&mut self, name: impl Into<String>, node: Node, node_id: NodeId);

    /// Trigger a DHT iterative lookup from node `from` searching for `target_id`.
    pub fn dht_find_node(&mut self, from: &str, target_id: &NodeId) -> Result<Vec<PeerContact>, P2pError>;

    /// Bootstrap node `from` by querying a known bootstrap node `seed`.
    pub fn dht_bootstrap(&mut self, from: &str, seed: &str) -> Result<(), P2pError>;

    /// Prune unreachable or failed peers from all nodes' routing tables.
    pub fn prune_unreachable_peers(&mut self);
}
```

#### B. RelaySession Query Handling (`relay.rs`)
Update `apply_relay` and `handle_relay_query` to process DHT messages:
```rust
pub fn handle_relay_query(node: &Node, msg: &RelayMsg) -> Option<RelayMsg> {
    match msg {
        // ... existing GetHeaders, GetBlocks, GetMerkleProof ...
        RelayMsg::Dht(DhtMsg::Ping { sender, nonce }) => {
            Some(RelayMsg::Dht(DhtMsg::Pong {
                sender: node.node_id(),
                nonce: *nonce,
            }))
        }
        RelayMsg::Dht(DhtMsg::FindNode { sender, target }) => {
            let neighbors = node.dht_closest_peers(target, 8);
            Some(RelayMsg::Dht(DhtMsg::Neighbors {
                sender: node.node_id(),
                target: *target,
                peers: neighbors,
            }))
        }
        _ => None,
    }
}
```

#### C. Live Node `Explorer` Background Task (`explorer.rs`)
In `Explorer::tick_p2p`:
1. **Periodic DHT Refresh**: Every $N$ ticks, execute `dht.refresh_stale_buckets()`.
2. **Peer Pool Replenishment**: If active connections count $< \text{TARGET\_PEERS}$ (e.g. 8), pull closest uncontacted peers from the DHT routing table and attempt TCP handshake (`sync_headers_first` / `RelaySession`).
3. **Dead Peer Pruning**: If connection attempts to a peer fail 3 consecutive times, evict the peer from both `self.peers` and the DHT bucket.

---

## 6. Gap Analysis & Proposed File Changes

| File | Current State | Proposed Implementation Changes |
|---|---|---|
| `crates/kovanica-node/src/lib.rs` | Exports `p2p`, `relay`, `net`, `node`, `spv`, `p2p_hardening`. | Export new modules `dns_seed` and `dht`. |
| `crates/kovanica-node/src/dht.rs` | **New file** | Implement `NodeId`, XOR distance, `KBucket`, `RoutingTable`, `PeerContact`, iterative lookup algorithm. |
| `crates/kovanica-node/src/dns_seed.rs` | **New file** | Implement `DnsSeedResolver`, multi-host resolution, fallback pipelines, shuffling, and IP filtering. |
| `crates/kovanica-node/src/p2p.rs` | String-based monotonic peer graph. | Integrate DHT routing table into `Mesh`, implement `dht_bootstrap`, `dht_find_node`, and peer pruning methods. |
| `crates/kovanica-node/src/relay.rs` | Frame tags `0x00`–`0x16`. | Add DHT tags `0x20`–`0x23` and `RelayMsg::Dht(DhtMsg)` variants with binary encoding/decoding. |
| `crates/kovanica-node/src/explorer.rs` | Single static seed `seed.kovanica.online:9000`, static `peers: Vec<String>`. | Integrate `DnsSeedResolver` and DHT routing table into `Explorer`, add dynamic peer replenishment and dead-peer pruning. |
| `crates/kovanica-node/src/main.rs` | Environment variable help text. | Document `KOVANICA_SEEDS` / `KOVANICA_DNS_SEEDS` in `--help` output. |
| `crates/kovanica-node/tests/dht_discovery.rs` | **New integration test** | Multi-node cluster test asserting isolated nodes discover target nodes via DHT routing and prune unreachable peers. |

---

## 7. Adversarial & Edge-Case Considerations

1. **Eclipse Attacks on DHT**:
   - *Threat*: Malicious actor floods the node with fake NodeIds close to the victim's NodeId to monopolize its routing table.
   - *Mitigation*: Limit the number of peer entries sharing the same `/24` IPv4 subnet (or `/48` IPv6 subnet) in any single $k$-bucket (IP diversity rule).
2. **Sybil Resistance for NodeId**:
   - *Threat*: An attacker generates millions of virtual NodeIds.
   - *Mitigation*: Require NodeIds to match a BLAKE3 commitment of their static public key, and verify signatures during the initial handshake.
3. **Churn & Dead Peer Accumulation**:
   - *Threat*: Transient nodes join and leave, filling routing buckets with unreachable entries.
   - *Mitigation*: Strictly enforce the Kademlia replacement policy (favoring long-lived responding peers over unverified newcomers) and prune contacts after $3$ consecutive failed queries.
4. **DNS Poisoning / Hijacking**:
   - *Threat*: Malicious DNS server returns attacker-controlled IP addresses.
   - *Mitigation*: Multi-seed querying across distinct domain TLDs and operators, combined with fallback to hardcoded bootstrap IPs and local historical peer caches (`data/peers.json`).
