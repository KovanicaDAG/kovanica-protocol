# Technical Exploration & Drop-in Rust Implementation Blueprint
## DHT Wire Protocol, P2P Simulation, and Node/Explorer Integration

**Author**: `m1_dht_explorer_2`  
**Date**: 2026-08-24  
**Target Crates & Modules**:
- `crates/kovanica-node/src/relay.rs` (DHT wire messages, framing, codecs, `apply_relay`, `handle_relay_query`)
- `crates/kovanica-node/src/p2p.rs` (`Mesh` discrete-time DHT simulation, `add_with_dht`, `dht_find_node`, `dht_bootstrap`, `prune_unreachable_peers`)
- `crates/kovanica-node/src/node.rs` (`Node` DHT state, `NodeId`, `RoutingTable` delegates)
- `crates/kovanica-node/src/explorer.rs` (Live explorer runtime, DNS multi-seed bootstrap, background DHT peer replenishment)
- `crates/kovanica-node/src/main.rs` (CLI flags, environment variables, documentation)
- `crates/kovanica-node/src/lib.rs` (Module declarations and public re-exports)

---

## 1. Executive Overview & Problem Context

`kovanica-node` is the runnable node and networking layer for the Kovanica BlockDAG protocol. Up to this point:
1. **Network Bootstrapping**: Nodes rely on a single hardcoded DNS seed (`seed.kovanica.online:9000`) or static command-line configuration (`KOVANICA_PEERS`). If the seed is offline or unreachable, new nodes cannot connect.
2. **Peer Discovery**: Limited to 1-hop neighbor list exchange in `RelayMsg::Hello`. No structured, multi-hop routing exists. Isolated or partitioned nodes cannot discover peers across hops.
3. **Peer Lifecycle**: The in-process `Mesh` and live `Explorer` retain peers monotonically without liveness scoring or 3-strike dead-peer pruning.

This blueprint provides concrete, drop-in Rust code implementing **Multi-Seed DNS Discovery** and a **Lightweight Kademlia Distributed Hash Table (DHT)** across the wire protocol, in-process discrete simulation, and live node runtime.

---

## 2. Component 1: Wire Framing & Message Codecs (`crates/kovanica-node/src/relay.rs`)

### 2.1 Wire Message Tags
In `relay.rs`, DHT message tags occupy the unallocated `0x20..0x23` byte range:

```rust
pub const TAG_DHT_PING: u8 = 0x20;
pub const TAG_DHT_PONG: u8 = 0x21;
pub const TAG_DHT_FIND_NODE: u8 = 0x22;
pub const TAG_DHT_NODES: u8 = 0x23;

pub const MAX_DHT_NODES: usize = 256;
```

### 2.2 `RelayMsg` Enum Variants
We extend `RelayMsg` in `crates/kovanica-node/src/relay.rs`:

```rust
use crate::dht::{NodeId, PeerContact};

/// One message on a [`RelaySession`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RelayMsg {
    /// Peer-discovery hello: who we are and who we currently peer with.
    Hello {
        from: String,
        advertised: Vec<String>,
    },
    /// A block record, same payload as one-shot gossip.
    Block(BlockRecord),
    /// A mempool transaction.
    Tx(Transaction),
    /// SPV Request: Request headers along the selected chain matching locator.
    GetHeaders {
        locator: Vec<BlockId>,
        stop_hash: Option<BlockId>,
        max_count: u32,
    },
    /// SPV Response: Batch of block headers for the light client.
    Headers { headers: Vec<SpvHeader> },
    /// SPV / Node Request: Request blocks or inventory starting from locator.
    GetBlocks {
        locator: Vec<BlockId>,
        stop_hash: Option<BlockId>,
    },
    /// SPV Request: Request transaction inclusion proof for a block.
    GetMerkleProof { block_id: BlockId, tx_id: TxId },
    /// SPV Response: Merkle root, transaction count, sibling proof path, and matched transaction.
    MerkleBlock {
        block_id: BlockId,
        merkle_root: [u8; 32],
        tx_count: u32,
        proof: Option<MerkleProof>,
        matched_tx: Option<Transaction>,
    },
    /// DHT Request: Liveness ping to verify peer availability.
    DhtPing {
        sender: NodeId,
        nonce: u64,
    },
    /// DHT Response: Liveness pong acknowledging a ping.
    DhtPong {
        sender: NodeId,
        nonce: u64,
    },
    /// DHT Request: Query closest known nodes to a target NodeId.
    DhtFindNode {
        sender: NodeId,
        target: NodeId,
        nonce: u64,
    },
    /// DHT Response: List of closest known nodes to the requested target.
    DhtNodes {
        sender: NodeId,
        target: NodeId,
        nonce: u64,
        nodes: Vec<PeerContact>,
    },
}
```

### 2.3 Serialization: `encode_msg`
In `encode_msg(msg: &RelayMsg) -> Vec<u8>`:

```rust
        RelayMsg::DhtPing { sender, nonce } => {
            buf.push(TAG_DHT_PING);
            buf.extend_from_slice(sender.as_bytes());
            buf.extend_from_slice(&nonce.to_le_bytes());
        }
        RelayMsg::DhtPong { sender, nonce } => {
            buf.push(TAG_DHT_PONG);
            buf.extend_from_slice(sender.as_bytes());
            buf.extend_from_slice(&nonce.to_le_bytes());
        }
        RelayMsg::DhtFindNode {
            sender,
            target,
            nonce,
        } => {
            buf.push(TAG_DHT_FIND_NODE);
            buf.extend_from_slice(sender.as_bytes());
            buf.extend_from_slice(target.as_bytes());
            buf.extend_from_slice(&nonce.to_le_bytes());
        }
        RelayMsg::DhtNodes {
            sender,
            target,
            nonce,
            nodes,
        } => {
            buf.push(TAG_DHT_NODES);
            buf.extend_from_slice(sender.as_bytes());
            buf.extend_from_slice(target.as_bytes());
            buf.extend_from_slice(&nonce.to_le_bytes());
            buf.extend_from_slice(&(nodes.len() as u16).to_le_bytes());
            for contact in nodes {
                buf.extend_from_slice(contact.node_id.as_bytes());
                push_str(&mut buf, &contact.addr);
                buf.extend_from_slice(&contact.last_seen_ms.to_le_bytes());
                buf.extend_from_slice(&contact.failed_queries.to_le_bytes());
            }
        }
```

### 2.4 Deserialization: `decode_msg`
In `decode_msg(bytes: &[u8]) -> Result<RelayMsg, NetError>`:

```rust
        TAG_DHT_PING => {
            let mut r = Cursor { buf: rest, pos: 0 };
            let sender = NodeId::from_bytes(r.read_array::<32>()?);
            let nonce = u64::from_le_bytes(r.read_array::<8>()?);
            if r.remaining() != 0 {
                return Err(NetError::Decode("trailing bytes in dht_ping".into()));
            }
            Ok(RelayMsg::DhtPing { sender, nonce })
        }
        TAG_DHT_PONG => {
            let mut r = Cursor { buf: rest, pos: 0 };
            let sender = NodeId::from_bytes(r.read_array::<32>()?);
            let nonce = u64::from_le_bytes(r.read_array::<8>()?);
            if r.remaining() != 0 {
                return Err(NetError::Decode("trailing bytes in dht_pong".into()));
            }
            Ok(RelayMsg::DhtPong { sender, nonce })
        }
        TAG_DHT_FIND_NODE => {
            let mut r = Cursor { buf: rest, pos: 0 };
            let sender = NodeId::from_bytes(r.read_array::<32>()?);
            let target = NodeId::from_bytes(r.read_array::<32>()?);
            let nonce = u64::from_le_bytes(r.read_array::<8>()?);
            if r.remaining() != 0 {
                return Err(NetError::Decode("trailing bytes in dht_find_node".into()));
            }
            Ok(RelayMsg::DhtFindNode {
                sender,
                target,
                nonce,
            })
        }
        TAG_DHT_NODES => {
            let mut r = Cursor { buf: rest, pos: 0 };
            let sender = NodeId::from_bytes(r.read_array::<32>()?);
            let target = NodeId::from_bytes(r.read_array::<32>()?);
            let nonce = u64::from_le_bytes(r.read_array::<8>()?);
            let count = u16::from_le_bytes(r.read_array::<2>()?) as usize;
            if count > MAX_DHT_NODES {
                return Err(NetError::Decode("dht_nodes count exceeds limit".into()));
            }
            let mut nodes = Vec::with_capacity(count);
            for _ in 0..count {
                let node_id = NodeId::from_bytes(r.read_array::<32>()?);
                let addr = r.read_str()?;
                let last_seen_ms = u64::from_le_bytes(r.read_array::<8>()?);
                let failed_queries = u32::from_le_bytes(r.read_array::<4>()?);
                nodes.push(PeerContact {
                    node_id,
                    addr,
                    last_seen_ms,
                    failed_queries,
                });
            }
            if r.remaining() != 0 {
                return Err(NetError::Decode("trailing bytes in dht_nodes".into()));
            }
            Ok(RelayMsg::DhtNodes {
                sender,
                target,
                nonce,
                nodes,
            })
        }
```

### 2.5 Message Handling: `apply_relay` and `handle_relay_query`

```rust
/// Apply a received relay message to `node`. Hellos, SPV messages, and DHT messages
/// are passed through to the caller.
pub fn apply_relay(node: &mut Node, msg: RelayMsg) -> Result<Option<RelayMsg>, NetError> {
    match msg {
        hello @ RelayMsg::Hello { .. } => Ok(Some(hello)),
        RelayMsg::Block(record) => {
            node.receive_block(record)
                .map_err(|e| NetError::Apply(e.to_string()))?;
            Ok(None)
        }
        RelayMsg::Tx(tx) => {
            node.submit_tx(tx)
                .map_err(|e| NetError::Apply(e.to_string()))?;
            Ok(None)
        }
        spv @ (RelayMsg::GetHeaders { .. }
        | RelayMsg::Headers { .. }
        | RelayMsg::GetBlocks { .. }
        | RelayMsg::GetMerkleProof { .. }
        | RelayMsg::MerkleBlock { .. }) => Ok(Some(spv)),
        dht @ (RelayMsg::DhtPing { .. }
        | RelayMsg::DhtPong { .. }
        | RelayMsg::DhtFindNode { .. }
        | RelayMsg::DhtNodes { .. }) => Ok(Some(dht)),
    }
}

/// Handle query-type relay messages that require an immediate response back over the wire.
pub fn handle_relay_query(node: &Node, msg: &RelayMsg) -> Option<RelayMsg> {
    match msg {
        RelayMsg::GetHeaders {
            locator,
            stop_hash,
            max_count,
        } => {
            let limit = if *max_count == 0 {
                2000
            } else {
                *max_count as usize
            };
            let headers = node
                .headers_from(locator, *stop_hash, limit)
                .unwrap_or_default();
            Some(RelayMsg::Headers { headers })
        }
        RelayMsg::GetBlocks { locator, stop_hash } => {
            let headers = node
                .headers_from(locator, *stop_hash, 2000)
                .unwrap_or_default();
            Some(RelayMsg::Headers { headers })
        }
        RelayMsg::GetMerkleProof { block_id, tx_id } => {
            if let Ok(mb) = node.merkle_block(block_id, tx_id) {
                Some(RelayMsg::MerkleBlock {
                    block_id: mb.block_id,
                    merkle_root: mb.merkle_root,
                    tx_count: mb.tx_count,
                    proof: mb.proof,
                    matched_tx: mb.matched_tx,
                })
            } else {
                None
            }
        }
        RelayMsg::DhtPing { sender: _, nonce } => {
            Some(RelayMsg::DhtPong {
                sender: node.node_id(),
                nonce: *nonce,
            })
        }
        RelayMsg::DhtFindNode {
            sender: _,
            target,
            nonce,
        } => {
            let nodes = node.dht_closest_peers(target, 8);
            Some(RelayMsg::DhtNodes {
                sender: node.node_id(),
                target: *target,
                nonce: *nonce,
                nodes,
            })
        }
        _ => None,
    }
}
```

---

## 3. Component 2: Discrete Simulation & Mesh Integration (`crates/kovanica-node/src/p2p.rs`)

### 3.1 `Mesh` Struct Enhancements
In `crates/kovanica-node/src/p2p.rs`:

```rust
use crate::dht::{NodeId, PeerContact, RoutingTable, UpdateResult, DEFAULT_K};

/// An in-process overlay of named nodes with continuous gossip and DHT routing simulation.
#[derive(Default)]
pub struct Mesh {
    nodes: BTreeMap<String, Node>,
    peers: BTreeMap<String, BTreeSet<String>>,
    dht_nodes: BTreeMap<String, NodeId>,
    routing_tables: BTreeMap<String, RoutingTable>,
    queue: Vec<Queued>,
    seen_blocks: BTreeMap<String, HashSet<BlockId>>,
    seen_txs: BTreeMap<String, HashSet<TxId>>,
    now: u64,
    events: Vec<GossipEvent>,
    hardening: P2pHardening,
}
```

### 3.2 Discrete-Time DHT Simulation Methods

```rust
impl Mesh {
    /// Register `node` under `name` with an explicit 256-bit `NodeId` and initialize its DHT routing table.
    pub fn add_with_dht(&mut self, name: impl Into<String>, mut node: Node, node_id: NodeId) {
        let name = name.into();
        node.set_node_id(node_id);
        self.dht_nodes.insert(name.clone(), node_id);
        self.routing_tables
            .insert(name.clone(), RoutingTable::new(node_id, DEFAULT_K));
        self.nodes.insert(name.clone(), node);
        self.peers.entry(name.clone()).or_default();
        self.seen_blocks.entry(name.clone()).or_default();
        self.seen_txs.entry(name).or_default();
    }

    /// Get the registered `NodeId` for a node name.
    pub fn node_id(&self, name: &str) -> Option<NodeId> {
        self.dht_nodes.get(name).copied()
    }

    /// Access a node's routing table.
    pub fn routing_table(&self, name: &str) -> Option<&RoutingTable> {
        self.routing_tables.get(name)
    }

    /// Mutably access a node's routing table.
    pub fn routing_table_mut(&mut self, name: &str) -> Option<&mut RoutingTable> {
        self.routing_tables.get_mut(name)
    }

    /// Disconnect an overlay edge between two nodes.
    pub fn disconnect(&mut self, from: &str, to: &str) -> Result<(), P2pError> {
        self.require(from)?;
        self.require(to)?;
        if let Some(set) = self.peers.get_mut(from) {
            set.remove(to);
        }
        Ok(())
    }

    /// Remove a node entirely from the simulation (simulating crash / shutdown).
    pub fn remove_node(&mut self, name: &str) -> Result<(), P2pError> {
        self.require(name)?;
        self.nodes.remove(name);
        self.peers.remove(name);
        self.dht_nodes.remove(name);
        self.routing_tables.remove(name);
        self.seen_blocks.remove(name);
        self.seen_txs.remove(name);
        for peer_set in self.peers.values_mut() {
            peer_set.remove(name);
        }
        Ok(())
    }

    /// Simulate an iterative Kademlia lookup from node `from` searching for `target_id`.
    /// Queries closest known nodes, folds newly discovered contacts into `from`'s routing table,
    /// and converges to the $k$ closest nodes across the network.
    pub fn dht_find_node(&mut self, from: &str, target: &NodeId) -> Result<Vec<PeerContact>, P2pError> {
        self.require(from)?;
        let from_id = self
            .dht_nodes
            .get(from)
            .copied()
            .unwrap_or_else(|| NodeId::from_seed_str(from));

        let mut queried = HashSet::new();
        queried.insert(from.to_string());

        // Shortlist of candidates sorted by XOR distance to target
        let mut candidates: Vec<PeerContact> = self
            .routing_tables
            .get(from)
            .map(|t| t.closest_peers(target, DEFAULT_K))
            .unwrap_or_default();

        // If routing table is empty, seed from direct overlay peers
        if candidates.is_empty() {
            for peer in self.peers_of(from) {
                if let Some(peer_id) = self.dht_nodes.get(&peer) {
                    let contact = PeerContact {
                        node_id: *peer_id,
                        addr: peer.clone(),
                        last_seen_ms: self.now,
                        failed_queries: 0,
                    };
                    candidates.push(contact.clone());
                    if let Some(t) = self.routing_tables.get_mut(from) {
                        t.update_contact(contact);
                    }
                }
            }
        }

        candidates.sort_by(|a, b| crate::dht::distance_cmp(&a.node_id, &b.node_id, target));

        let mut round = 0;
        const MAX_ROUNDS: usize = 20;

        while round < MAX_ROUNDS {
            round += 1;
            // Pick alpha (3) closest unqueried candidates
            let unqueried: Vec<PeerContact> = candidates
                .iter()
                .filter(|c| !queried.contains(&c.addr))
                .take(3)
                .cloned()
                .collect();

            if unqueried.is_empty() {
                break;
            }

            let mut new_discovered = Vec::new();

            for contact in unqueried {
                queried.insert(contact.addr.clone());
                let target_node_name = &contact.addr;

                // Check if target node is alive in the mesh
                if let Some(remote_node) = self.nodes.get(target_node_name) {
                    let returned_nodes = if let Some(rt) = self.routing_tables.get(target_node_name) {
                        rt.closest_peers(target, DEFAULT_K)
                    } else {
                        remote_node.dht_closest_peers(target, DEFAULT_K)
                    };

                    // Mark successful query on sender's routing table
                    if let Some(rt) = self.routing_tables.get_mut(from) {
                        rt.update_contact(PeerContact {
                            node_id: contact.node_id,
                            addr: contact.addr.clone(),
                            last_seen_ms: self.now,
                            failed_queries: 0,
                        });
                    }

                    for mut discovered in returned_nodes {
                        if discovered.node_id != from_id && discovered.addr != from {
                            discovered.last_seen_ms = self.now;
                            new_discovered.push(discovered);
                        }
                    }
                } else {
                    // Node is unreachable/crashed: record failure
                    if let Some(rt) = self.routing_tables.get_mut(from) {
                        rt.mark_failed(&contact.node_id);
                    }
                }
            }

            // Ingest new discovered contacts into `from`'s routing table and candidates list
            for discovered in new_discovered {
                if let Some(rt) = self.routing_tables.get_mut(from) {
                    rt.update_contact(discovered.clone());
                }
                if !candidates.iter().any(|c| c.node_id == discovered.node_id) {
                    candidates.push(discovered);
                }
            }

            candidates.sort_by(|a, b| crate::dht::distance_cmp(&a.node_id, &b.node_id, target));
            if candidates.len() > DEFAULT_K * 4 {
                candidates.truncate(DEFAULT_K * 4);
            }
        }

        candidates.truncate(DEFAULT_K);
        Ok(candidates)
    }

    /// Bootstrap node `from` via known node `seed`.
    /// 1. Inserts `seed` into `from`'s routing table.
    /// 2. Connects overlay edge `from <-> seed`.
    /// 3. Performs an iterative lookup for `from`'s own NodeId to populate its buckets.
    /// Returns the total number of contacts in `from`'s routing table.
    pub fn dht_bootstrap(&mut self, from: &str, seed: &str) -> Result<usize, P2pError> {
        self.require(from)?;
        self.require(seed)?;

        let from_id = self
            .dht_nodes
            .get(from)
            .copied()
            .unwrap_or_else(|| NodeId::from_seed_str(from));
        let seed_id = self
            .dht_nodes
            .get(seed)
            .copied()
            .unwrap_or_else(|| NodeId::from_seed_str(seed));

        // 1. Mutual contact update
        let seed_contact = PeerContact {
            node_id: seed_id,
            addr: seed.to_string(),
            last_seen_ms: self.now,
            failed_queries: 0,
        };
        let from_contact = PeerContact {
            node_id: from_id,
            addr: from.to_string(),
            last_seen_ms: self.now,
            failed_queries: 0,
        };

        if let Some(rt) = self.routing_tables.get_mut(from) {
            rt.update_contact(seed_contact);
        }
        if let Some(rt) = self.routing_tables.get_mut(seed) {
            rt.update_contact(from_contact);
        }

        // 2. Connect overlay
        self.connect(from, seed)?;
        self.connect(seed, from)?;

        // 3. Iterative lookup for self to populate routing table
        let discovered = self.dht_find_node(from, &from_id)?;

        // Connect overlay to discovered peers
        for peer in discovered {
            if peer.addr != from && self.nodes.contains_key(&peer.addr) {
                let _ = self.connect(from, &peer.addr);
            }
        }

        let total = self
            .routing_tables
            .get(from)
            .map(|rt| rt.total_contacts())
            .unwrap_or(0);

        Ok(total)
    }

    /// Prune unreachable peers across all nodes in the mesh.
    /// Evicts dead contacts with $\ge 3$ failed queries and cleans up disconnected overlay edges.
    pub fn prune_unreachable_peers(&mut self) {
        let node_names: Vec<String> = self.nodes.keys().cloned().collect();

        for name in &node_names {
            // Prune routing table
            if let Some(rt) = self.routing_tables.get_mut(name) {
                rt.prune_unresponsive(3);
            }

            // Prune overlay edges pointing to removed nodes
            let dead_peers: Vec<String> = self
                .peers_of(name)
                .into_iter()
                .filter(|peer| !self.nodes.contains_key(peer))
                .collect();

            if let Some(peer_set) = self.peers.get_mut(name) {
                for dead in dead_peers {
                    peer_set.remove(&dead);
                }
            }
        }
    }
}
```

---

## 4. Component 3: Node & Explorer Integration (`node.rs`, `explorer.rs`, `main.rs`)

### 4.1 `Node` DHT State and Methods (`crates/kovanica-node/src/node.rs`)

```rust
use crate::dht::{NodeId, PeerContact, RoutingTable, UpdateResult, DEFAULT_K};

pub struct Node {
    ledger: Option<Ledger>,
    mempool: MempoolV2,
    clock: Clock,
    miner: Option<Address>,
    node_id: NodeId,
    routing_table: RoutingTable,
}

impl Default for Node {
    fn default() -> Self {
        let node_id = NodeId::random();
        let routing_table = RoutingTable::new(node_id, DEFAULT_K);
        Self {
            ledger: None,
            mempool: MempoolV2::default(),
            clock: Clock::default(),
            miner: None,
            node_id,
            routing_table,
        }
    }
}

impl Node {
    /// Return the node's 256-bit DHT identifier.
    pub fn node_id(&self) -> NodeId {
        self.node_id
    }

    /// Set or override the node's DHT identifier (e.g. deterministic testing).
    pub fn set_node_id(&mut self, node_id: NodeId) {
        self.node_id = node_id;
        self.routing_table = RoutingTable::new(node_id, DEFAULT_K);
    }

    /// Access the node's DHT routing table.
    pub fn routing_table(&self) -> &RoutingTable {
        &self.routing_table
    }

    /// Mutably access the node's DHT routing table.
    pub fn routing_table_mut(&mut self) -> &mut RoutingTable {
        &mut self.routing_table
    }

    /// Update or insert a peer contact in the node's routing table.
    pub fn dht_update_contact(&mut self, contact: PeerContact) -> UpdateResult {
        self.routing_table.update_contact(contact)
    }

    /// Query closest known peers to `target`.
    pub fn dht_closest_peers(&self, target: &NodeId, count: usize) -> Vec<PeerContact> {
        self.routing_table.closest_peers(target, count)
    }

    /// Mark a peer contact as failed after a timed-out query.
    pub fn dht_mark_failed(&mut self, node_id: &NodeId) -> Option<PeerContact> {
        self.routing_table.mark_failed(node_id)
    }

    /// Prune unresponsive contacts exceeding failure threshold.
    pub fn dht_prune_unresponsive(&mut self, max_failed: u32) -> Vec<PeerContact> {
        self.routing_table.prune_unresponsive(max_failed)
    }
}
```

### 4.2 Multi-Seed Bootstrap & Replenishment in `Explorer` (`crates/kovanica-node/src/explorer.rs`)

```rust
use crate::dns_seed::{DnsSeedResolver, StdDnsResolver, P2P_BOOTSTRAP_FALLBACKS, P2P_BOOTSTRAP_SEEDS};
use crate::dht::PeerContact;

pub const DEFAULT_TARGET_PEERS: usize = 8;

impl Explorer {
    /// Discover seeds using the DNS multi-seed resolver and fallbacks on boot.
    fn resolve_bootstrap_seeds() -> Vec<String> {
        let resolver = DnsSeedResolver::new(
            StdDnsResolver,
            P2P_BOOTSTRAP_SEEDS.iter().map(|s| s.to_string()).collect(),
            9000,
            P2P_BOOTSTRAP_FALLBACKS.to_vec(),
        );
        let addrs = resolver.resolve_all();
        addrs.into_iter().map(|a| a.to_string()).collect()
    }

    /// Periodic DHT maintenance tick:
    /// 1. Prunes dead peers with >= 3 failures.
    /// 2. If active connected peer count < DEFAULT_TARGET_PEERS, queries DHT to replenish.
    fn tick_dht(&mut self) {
        if self.ticks % 250 == 0 {
            // 1. Prune dead peers
            self.mesh.prune_unreachable_peers();

            // 2. Replenish peer pool from DHT routing table if needed
            if let Some(node) = self.mesh.node("alpha") {
                let current_peers = self.mesh.peers_of("alpha");
                if current_peers.len() < DEFAULT_TARGET_PEERS {
                    let closest = node.dht_closest_peers(&node.node_id(), DEFAULT_TARGET_PEERS);
                    for contact in closest {
                        if !self.peers.contains(&contact.addr) && contact.addr != self.listen_addr {
                            self.peers.push(contact.addr.clone());
                            let _ = self.mesh.connect("alpha", &contact.addr);
                        }
                    }
                }
            }
        }
    }
}
```

### 4.3 CLI and Environment Updates (`crates/kovanica-node/src/main.rs`)

In `main.rs`, update `help` command output:
```rust
println!("                 KOVANICA_PEERS=seed.kovanica.online:9000 (comma-separated)");
println!("                 KOVANICA_DNS_SEEDS=seed.kovanica.online,seed2.kovanica.online");
```

---

## 5. Component 4: Crate Exports (`crates/kovanica-node/src/lib.rs`)

In `crates/kovanica-node/src/lib.rs`:

```rust
pub mod dht;
pub mod dns_seed;
pub mod explorer;
pub mod mempool;
pub mod mempool_v2;
pub mod net;
pub mod node;
pub mod p2p;
pub mod p2p_hardening;
pub mod relay;
pub mod rpc;
pub mod spv;

pub use dht::{
    distance, distance_cmp, leading_zeros, Contact, KBucket, NodeId, PeerContact,
    RoutingTable, UpdateResult, DEFAULT_K, MAX_FAILURES, NUM_BUCKETS,
};
pub use dns_seed::{
    DnsResolver, DnsSeedResolver, MockDnsResolver, StdDnsResolver, P2P_BOOTSTRAP_FALLBACKS,
    P2P_BOOTSTRAP_SEEDS,
};
pub use explorer::serve as serve_explorer;
pub use mempool::Mempool;
pub use mempool_v2::{Added, MempoolConfig, MempoolError, MempoolV2};
pub use net::{
    decode_bodies, decode_getbodies, decode_getheaders, decode_headers, decode_inventory,
    encode_bodies, encode_getbodies, encode_getheaders, encode_headers, encode_inventory,
    exchange_full_dump, serve_headers_first, sync_headers_first, NetError, SyncStats,
};
pub use node::{BlockHeader, BlockRecord, MerkleBlock, Node, NodeError, Prepared, Sent};
pub use p2p::{GossipEvent, GossipKind, Mesh, P2pError};
pub use p2p_hardening::{P2pHardening, P2pHardeningConfig, PeerStats};
pub use relay::{
    apply_relay, handle_relay_query, RelayMsg, RelaySession, TAG_BLOCK, TAG_DHT_FIND_NODE,
    TAG_DHT_NODES, TAG_DHT_PING, TAG_DHT_PONG, TAG_GETBLOCKS, TAG_GETHEADERS,
    TAG_GET_MERKLE_PROOF, TAG_HEADERS, TAG_HELLO, TAG_MERKLEBLOCK, TAG_TX,
};
pub use spv::{
    build_locator, request_merkle_block, sync_headers_via_relay,
    sync_headers_via_relay_with_clock, verify_merkle_block,
};
```

---

## 6. Verification and Integration Strategy

The implementation directly unblocks the 5-Tier test suite in `tests/dht_discovery.rs`:
- **Tier 1 (Feature Unit Tests)**:
  - Wire codec roundtrips for `DhtPing`, `DhtPong`, `DhtFindNode`, `DhtNodes` with 64-bit nonces.
  - Multi-seed resolution, A/AAAA record extraction, deduplication, and shuffling.
- **Tier 2 (Boundary & Corner Cases)**:
  - Nonce matching and stale query rejection.
  - Full bucket saturation and replacement cache promotion.
  - 3-strike failure accumulation and dead-peer pruning.
- **Tier 3 (Multiplexed Wire Framing)**:
  - Interleaving DHT ping/find_node messages with blocks, transactions, and SPV queries on the same `RelaySession`.
- **Tier 4 (Real-World Network Scenarios)**:
  - Multi-seed dynamic bootstrapping.
  - Multi-hop isolated target routing ($A \to B \to C$).
  - Dynamic peer disconnect, pruning, and routing table replenishment.
- **Tier 5 (Adversarial Stress Hardening)**:
  - Churn tolerance under node departures and reconnects.
  - Eclipse attack defense via LRU ping-probing preservation.
