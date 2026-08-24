# Comprehensive Technical Exploration & Implementation Blueprint: DNS Multi-Seed & Kademlia DHT

## Executive Summary
This document provides the exhaustive technical exploration, architectural analysis, invariant proofs, and exact drop-in Rust implementation blueprints for:
1. **DNS Multi-Seed Discovery Subsystem** (`crates/kovanica-node/src/dns_seed.rs`): Abstract injectable `DnsResolver` trait, `StdDnsResolver`, `MockDnsResolver`, static fallback pipeline (`P2P_BOOTSTRAP_FALLBACKS`), multi-seed querying, deduplication, deterministic BLAKE3 shuffling, and error handling.
2. **Lightweight Kademlia Distributed Hash Table (DHT)** (`crates/kovanica-node/src/dht.rs`): 256-bit BLAKE3 `NodeId`, bitwise XOR metric engine, leading-zero prefix bucket indexing ($0..255$), `PeerContact` liveness records, $k$-capacity `KBucket` with LRU eviction and auxiliary replacement cache, 256-bucket `RoutingTable`, 3-strike dead-peer pruning, stale bucket refresh target generation, and iterative $\alpha=3$ node lookup state machine.

---

## 1. Subsystem Architecture & Invariant Specifications

### 1.1 DNS Multi-Seed Resolver (`dns_seed.rs`)
- **Abstract Resolution Interface**: The `DnsResolver` trait decouples network DNS resolution (`std::net::ToSocketAddrs`) from business logic, enabling zero-flakiness, deterministic unit and integration testing via `MockDnsResolver`.
- **Multi-Seed Aggregation & A/AAAA Extraction**: Iterates across configured seed hostnames (e.g. `seed.kovanica.online:9000`), resolving both IPv4 and IPv6 addresses.
- **Port Normalization**: Seeds without explicit ports default to `default_port: u16` (default 9000).
- **Deduplication & Deterministic Shuffling**: Avoids duplicate dialing while shuffling discovered addresses via Fisher-Yates driven by BLAKE3 hash permutations.
- **Static Fallback Pipeline**: When all DNS seeds fail or network is partitioned, transparently supplies static socket addresses (`P2P_BOOTSTRAP_FALLBACKS`).

### 1.2 Kademlia DHT Engine (`dht.rs`)

#### 1.2.1 256-Bit `NodeId` & XOR Metric Math
- **Cryptographic Space**: 256-bit identifier represented as `[u8; 32]`, derived from BLAKE3 public keys or cryptographic entropy.
- **Bitwise XOR Metric**:
  $$d(A, B) = A \oplus B = [A_0 \oplus B_0, A_1 \oplus B_1, \dots, A_{31} \oplus B_{31}]$$
- **Mathematical Invariants**:
  1. *Identity*: $d(x, x) = [0; 32] = 0$
  2. *Symmetry*: $d(x, y) = d(y, x)$
  3. *Triangle Inequality / Ultrametric Property*: $d(x, z) = d(x, y) \oplus d(y, z) \le d(x, y) \oplus d(y, z)$
  4. *Unidirectionality*: For any fixed $x$ and distance $\Delta > 0$, there exists exactly one node $y$ such that $d(x, y) = \Delta$.
- **Leading Zero Count & Bucket Indexing**:
  $$\text{leading\_zeros}(d(A, B)) = \sum_{i=0}^{31} \text{byte\_leading\_zeros}(A_i \oplus B_i)$$
  - When $A = B$, distance is 0, $\text{leading\_zeros} = 256 \implies \text{bucket\_index} = \text{None}$ (a node never stores itself in its routing table).
  - When $A \ne B$, $\text{leading\_zeros} \in [0, 255] \implies \text{bucket\_index} = \text{leading\_zeros}$.
  - Bucket $i$ holds peers sharing an $i$-bit common prefix with the local node. Bucket 0 holds the furthest peers (differing at the first bit), while bucket 255 holds the closest non-identical peers.

#### 1.2.2 `PeerContact`
- Tracks:
  - `node_id: NodeId`
  - `addr: String` (e.g. `"127.0.0.1:9000"`)
  - `last_seen_ms: u64`
  - `failed_queries: u32` (consecutive failed RPC queries)

#### 1.2.3 $k$-Bucket with LRU Eviction & Replacement Cache
- **Capacity**: $k \in \{8, 20\}$ (default 8 for lightweight testnet, 20 for production).
- **LRU Ordering**: `entries[0]` is the Least Recently Used (head/oldest seen), while `entries[len-1]` is the Most Recently Used (tail/freshest).
- **Update / Insertion Protocol**:
  1. *Existing Peer*: If `contact.node_id` is already present in `entries`, update `addr` and `last_seen_ms`, reset `failed_queries = 0`, and move the contact to the MRU tail. Return `UpdateResult::Updated`.
  2. *New Peer, Bucket Not Full* (`len < k`): Append contact to the MRU tail. Return `UpdateResult::Inserted`.
  3. *New Peer, Bucket Full* (`len >= k`):
     - Peer is inserted/updated into `replacements` cache (max capacity $k$, LRU managed).
     - Return `UpdateResult::BucketFull { head_candidate: entries[0].clone() }`.
     - (The host can then ping the head candidate. If the head fails, it is evicted and the first replacement is promoted).
- **Replacement Promotion & 3-Strike Eviction**:
  - `mark_failed(&node_id)` increments `failed_queries`.
  - When `failed_queries >= 3`, the peer is pruned from `entries`.
  - If `replacements` is non-empty, the oldest cached replacement (`replacements.remove(0)`) is immediately promoted to `entries`.

#### 1.2.4 `RoutingTable`
- **Structure**: 256 `KBucket` instances indexed by common prefix length $0..255$.
- **`closest_peers(target, count)`**:
  - Gathers candidate peers across all buckets.
  - Computes XOR distance to `target`.
  - Deterministically sorts candidates by XOR distance ascending (byte-by-byte comparison).
  - Returns up to `count` closest contacts.
- **`prune_unresponsive(max_failed)`**: Scans all 256 buckets, prunes any contact with `failed_queries >= max_failed`, promotes replacements, and returns pruned contacts.
- **`stale_buckets(max_idle_ms, now_ms)`**: Identifies inactive buckets needing periodic refresh queries.
- **`random_id_for_bucket(bucket_idx)`**: Synthesizes a deterministic target `NodeId` sharing exactly `bucket_idx` bits with `local_id` and differing at bit `bucket_idx`.

#### 1.2.5 Iterative Node Lookup State Machine ($\alpha=3$)
- **Algorithm**:
  1. *Initialization*: Seed shortlist with the $\alpha$ (or $k$) closest known contacts to `target` from local routing table.
  2. *Query Dispatch*: Concurrently dispatch `DhtFindNode { target }` to up to $\alpha=3$ closest `Unqueried` contacts.
  3. *Response Ingestion*:
     - On success: mark contact `Queried`, insert returned neighbors into shortlist (if novel), re-sort by distance to target.
     - On failure / timeout: mark contact `Failed`.
  4. *Convergence Criterion*: The lookup halts when all of the $k$ closest nodes in the shortlist have been queried, or no unqueried nodes closer than the $k$-th queried node exist.
  5. *Result*: Return the $k$ closest responsive contacts.

---

## 2. Drop-in Rust Blueprint: `crates/kovanica-node/src/dns_seed.rs`

```rust
//! DNS seed discovery: resolves multiple DNS seed hostnames into peer addresses
//! with deduplication, deterministic shuffling, and static fallback IP pipeline.

use std::collections::BTreeMap;
use std::net::{SocketAddr, ToSocketAddrs};
use std::sync::RwLock;

/// Static fallback socket addresses if all DNS seeds fail.
pub const P2P_BOOTSTRAP_FALLBACKS: &[&str] = &[
    "127.0.0.1:9000",
    "127.0.0.1:9001",
    "127.0.0.1:9002",
];

/// Abstract DNS resolver trait for decoupling DNS lookups from network sockets.
pub trait DnsResolver: Send + Sync {
    /// Resolve a hostname and port into a list of socket addresses.
    fn resolve(&self, host: &str, port: u16) -> Result<Vec<SocketAddr>, std::io::Error>;
}

/// Standard production DNS resolver utilizing `std::net::ToSocketAddrs`.
#[derive(Clone, Copy, Debug, Default)]
pub struct StdDnsResolver;

impl DnsResolver for StdDnsResolver {
    fn resolve(&self, host: &str, port: u16) -> Result<Vec<SocketAddr>, std::io::Error> {
        let addrs = (host, port).to_socket_addrs()?.collect();
        Ok(addrs)
    }
}

/// In-memory mock DNS resolver for deterministic testing.
#[derive(Debug, Default)]
pub struct MockDnsResolver {
    records: RwLock<BTreeMap<String, Vec<SocketAddr>>>,
}

impl MockDnsResolver {
    /// Create a new empty mock resolver.
    pub fn new() -> Self {
        Self {
            records: RwLock::new(BTreeMap::new()),
        }
    }

    /// Register a host mapping to one or more socket addresses.
    pub fn add_record(&self, host: impl Into<String>, addrs: Vec<SocketAddr>) {
        let mut map = self.records.write().expect("lock poisoned");
        map.insert(host.into(), addrs);
    }

    /// Set a single address for a given host.
    pub fn set_record(&self, host: impl Into<String>, addr: SocketAddr) {
        let mut map = self.records.write().expect("lock poisoned");
        map.entry(host.into()).or_default().push(addr);
    }

    /// Remove a host record.
    pub fn remove_record(&self, host: &str) {
        let mut map = self.records.write().expect("lock poisoned");
        map.remove(host);
    }

    /// Clear all registered records.
    pub fn clear(&self) {
        let mut map = self.records.write().expect("lock poisoned");
        map.clear();
    }
}

impl DnsResolver for MockDnsResolver {
    fn resolve(&self, host: &str, _port: u16) -> Result<Vec<SocketAddr>, std::io::Error> {
        let map = self.records.read().expect("lock poisoned");
        if let Some(addrs) = map.get(host) {
            Ok(addrs.clone())
        } else {
            Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("mock dns host not found: {host}"),
            ))
        }
    }
}

/// Multi-seed DNS resolver and fallback coordinator.
#[derive(Debug)]
pub struct DnsSeedResolver<R: DnsResolver = StdDnsResolver> {
    resolver: R,
    seeds: Vec<String>,
    default_port: u16,
    fallbacks: Vec<SocketAddr>,
}

impl DnsSeedResolver<StdDnsResolver> {
    /// Create a new resolver using standard DNS lookups.
    pub fn new(seeds: Vec<String>, default_port: u16, fallbacks: Vec<SocketAddr>) -> Self {
        Self {
            resolver: StdDnsResolver,
            seeds,
            default_port,
            fallbacks,
        }
    }

    /// Create with default static fallbacks.
    pub fn with_default_fallbacks(seeds: Vec<String>, default_port: u16) -> Self {
        let fallbacks = P2P_BOOTSTRAP_FALLBACKS
            .iter()
            .filter_map(|s| s.parse::<SocketAddr>().ok())
            .collect();
        Self::new(seeds, default_port, fallbacks)
    }
}

impl<R: DnsResolver> DnsSeedResolver<R> {
    /// Create a resolver with an explicit custom/mock resolver implementation.
    pub fn with_resolver(
        resolver: R,
        seeds: Vec<String>,
        default_port: u16,
        fallbacks: Vec<SocketAddr>,
    ) -> Self {
        Self {
            resolver,
            seeds,
            default_port,
            fallbacks,
        }
    }

    /// Configured DNS seed hostnames.
    pub fn seeds(&self) -> &[String] {
        &self.seeds
    }

    /// Configured static fallback addresses.
    pub fn fallbacks(&self) -> &[SocketAddr] {
        &self.fallbacks
    }

    /// Resolve an individual seed string (parsing custom `:port` if provided).
    pub fn resolve_seed(&self, seed: &str) -> Result<Vec<SocketAddr>, std::io::Error> {
        let (host, port) = if let Some((h, p)) = seed.rsplit_once(':') {
            let port = p.parse::<u16>().map_err(|e| {
                std::io::Error::new(std::io::ErrorKind::InvalidInput, format!("invalid port: {e}"))
            })?;
            (h, port)
        } else {
            (seed, self.default_port)
        };
        self.resolver.resolve(host, port)
    }

    /// Resolve all configured seeds, deduplicate, shuffle, and fall back to static IPs
    /// if resolution produces no addresses.
    pub fn resolve_all(&self) -> Vec<SocketAddr> {
        let mut discovered = Vec::new();
        let mut seen = std::collections::BTreeSet::new();

        for seed in &self.seeds {
            if let Ok(addrs) = self.resolve_seed(seed) {
                for addr in addrs {
                    if seen.insert(addr) {
                        discovered.push(addr);
                    }
                }
            }
        }

        if discovered.is_empty() {
            for fb in &self.fallbacks {
                if seen.insert(*fb) {
                    discovered.push(*fb);
                }
            }
        } else {
            Self::shuffle(&mut discovered);
        }

        discovered
    }

    /// Deterministic in-place Fisher-Yates shuffle using BLAKE3 pseudo-entropy.
    fn shuffle(addrs: &mut [SocketAddr]) {
        if addrs.len() <= 1 {
            return;
        }
        let mut state = blake3::hash(&(addrs.len() as u64).to_le_bytes());
        for i in (1..addrs.len()).rev() {
            let hash_bytes = state.as_bytes();
            let rand_val = u64::from_le_bytes(hash_bytes[0..8].try_into().unwrap());
            let j = (rand_val % ((i + 1) as u64)) as usize;
            addrs.swap(i, j);
            state = blake3::hash(hash_bytes);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    #[test]
    fn test_mock_dns_multi_seed_resolution() {
        let mock = MockDnsResolver::new();
        let addr1: SocketAddr = "192.168.1.10:9000".parse().unwrap();
        let addr2: SocketAddr = "192.168.1.11:9000".parse().unwrap();
        let addr3: SocketAddr = "192.168.1.12:9000".parse().unwrap();

        mock.add_record("seed1.kovanica.test", vec![addr1, addr2]);
        mock.add_record("seed2.kovanica.test", vec![addr2, addr3]); // addr2 duplicate

        let resolver = DnsSeedResolver::with_resolver(
            mock,
            vec!["seed1.kovanica.test".into(), "seed2.kovanica.test".into()],
            9000,
            vec!["127.0.0.1:9000".parse().unwrap()],
        );

        let resolved = resolver.resolve_all();
        assert_eq!(resolved.len(), 3);
        assert!(resolved.contains(&addr1));
        assert!(resolved.contains(&addr2));
        assert!(resolved.contains(&addr3));
    }

    #[test]
    fn test_fallback_when_dns_fails() {
        let mock = MockDnsResolver::new();
        let fallback_addr: SocketAddr = "10.0.0.1:9000".parse().unwrap();

        let resolver = DnsSeedResolver::with_resolver(
            mock,
            vec!["nonexistent.seed.test".into()],
            9000,
            vec![fallback_addr],
        );

        let resolved = resolver.resolve_all();
        assert_eq!(resolved, vec![fallback_addr]);
    }

    #[test]
    fn test_custom_port_parsing() {
        let mock = MockDnsResolver::new();
        let addr: SocketAddr = "1.2.3.4:9999".parse().unwrap();
        mock.add_record("custom.seed.test", vec![addr]);

        let resolver = DnsSeedResolver::with_resolver(
            mock,
            vec!["custom.seed.test:9999".into()],
            9000,
            vec![],
        );

        let resolved = resolver.resolve_all();
        assert_eq!(resolved, vec![addr]);
    }
}
```

---

## 3. Drop-in Rust Blueprint: `crates/kovanica-node/src/dht.rs`

```rust
//! Lightweight Kademlia Distributed Hash Table (DHT) for peer routing.
//!
//! Implements 256-bit BLAKE3 NodeIds, bitwise XOR distance metrics, $k$-capacity
//! K-buckets with LRU ordering, replacement caches, 3-strike failure pruning,
//! and iterative node lookup state machine.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

/// Default K-bucket capacity ($k$).
pub const DEFAULT_K: usize = 8;

/// Default lookup concurrency parameter ($\alpha$).
pub const DEFAULT_ALPHA: usize = 3;

/// Maximum consecutive query failures before a peer is pruned.
pub const MAX_QUERY_FAILURES: u32 = 3;

/// Total number of buckets in a 256-bit routing table.
pub const NUM_BUCKETS: usize = 256;

/// 256-bit Node identifier in the DHT cryptographic keyspace.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct NodeId(pub [u8; 32]);

impl NodeId {
    /// Create a NodeId from raw 32 bytes.
    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// Access raw 32-byte identifier.
    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Generate a NodeId derived from an ed25519 public key or arbitrary input bytes.
    pub fn from_pubkey(pk: &[u8]) -> Self {
        Self(*blake3::hash(pk).as_bytes())
    }

    /// Generate a pseudorandom NodeId (useful for testing or bucket refreshes).
    pub fn random() -> Self {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let hash = blake3::hash(&nanos.to_le_bytes());
        Self(*hash.as_bytes())
    }

    /// Derive NodeId from hex string.
    pub fn from_hex(s: &str) -> Result<Self, hex::FromHexError> {
        let mut bytes = [0u8; 32];
        hex::decode_to_slice(s, &mut bytes)?;
        Ok(Self(bytes))
    }

    /// Format as hex string.
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }

    /// Calculate bitwise XOR distance between two NodeIds.
    pub fn distance(&self, other: &NodeId) -> [u8; 32] {
        let mut dist = [0u8; 32];
        for i in 0..32 {
            dist[i] = self.0[i] ^ other.0[i];
        }
        dist
    }

    /// Number of leading zero bits in the XOR distance to another NodeId.
    pub fn leading_zeros(&self, other: &NodeId) -> usize {
        let dist = self.distance(other);
        let mut count = 0;
        for &byte in &dist {
            if byte == 0 {
                count += 8;
            } else {
                count += byte.leading_zeros() as usize;
                break;
            }
        }
        count
    }

    /// Routing table bucket index ($0..255$) corresponding to the common prefix length.
    /// Returns `None` if `self == other` (distance is 0).
    pub fn bucket_index(&self, other: &NodeId) -> Option<usize> {
        if self == other {
            None
        } else {
            let lz = self.leading_zeros(other);
            if lz < NUM_BUCKETS {
                Some(lz)
            } else {
                Some(NUM_BUCKETS - 1)
            }
        }
    }
}

impl fmt::Debug for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "NodeId({}..{})", &self.to_hex()[..6], &self.to_hex()[58..])
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_hex())
    }
}

/// A peer contact entry in the Kademlia DHT.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PeerContact {
    /// 256-bit Node identifier.
    pub node_id: NodeId,
    /// Network address (e.g. `"127.0.0.1:9000"` or DNS hostname).
    pub addr: String,
    /// Timestamp of last successful contact (milliseconds).
    pub last_seen_ms: u64,
    /// Number of consecutive failed query attempts.
    pub failed_queries: u32,
}

impl PeerContact {
    /// Create a new peer contact with zero failed queries.
    pub fn new(node_id: NodeId, addr: impl Into<String>, now_ms: u64) -> Self {
        Self {
            node_id,
            addr: addr.into(),
            last_seen_ms: now_ms,
            failed_queries: 0,
        }
    }

    /// Mark contact as active and reset failure counter.
    pub fn touch(&mut self, now_ms: u64) {
        self.last_seen_ms = now_ms;
        self.failed_queries = 0;
    }

    /// Record a query failure.
    pub fn record_failure(&mut self) -> u32 {
        self.failed_queries += 1;
        self.failed_queries
    }

    /// Check if peer has exceeded failure threshold.
    pub fn is_dead(&self, max_failures: u32) -> bool {
        self.failed_queries >= max_failures
    }
}

/// Result of attempting to insert or update a contact in a K-bucket.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UpdateResult {
    /// Contact already existed and was updated / refreshed to MRU tail.
    Updated,
    /// New contact was inserted into the bucket.
    Inserted,
    /// Bucket was full; contact was added to the replacement cache.
    /// Holds the LRU head candidate that should be probed/pinged.
    BucketFull { head_candidate: PeerContact },
    /// Contact represents the local node itself and was ignored.
    SelfIgnored,
}

/// A single K-bucket storing up to $k$ contacts and up to $k$ replacement candidates.
#[derive(Clone, Debug)]
pub struct KBucket {
    /// Maximum capacity of active contacts ($k$).
    k: usize,
    /// Active contacts in LRU order: index 0 is oldest (LRU), last is freshest (MRU).
    entries: Vec<PeerContact>,
    /// Replacement cache for candidates waiting when the bucket is saturated.
    replacements: Vec<PeerContact>,
}

impl KBucket {
    /// Create a new K-bucket with capacity $k$.
    pub fn new(k: usize) -> Self {
        Self {
            k: if k == 0 { DEFAULT_K } else { k },
            entries: Vec::with_capacity(k),
            replacements: Vec::with_capacity(k),
        }
    }

    /// Number of active contacts currently in the bucket.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the bucket holds zero active contacts.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Slice of active entries in LRU order.
    pub fn entries(&self) -> &[PeerContact] {
        &self.entries
    }

    /// Slice of replacement candidates.
    pub fn replacements(&self) -> &[PeerContact] {
        &self.replacements
    }

    /// Update an existing contact or insert a new one according to Kademlia LRU rules.
    pub fn update(&mut self, contact: PeerContact) -> UpdateResult {
        // 1. Check if contact already exists in active entries
        if let Some(pos) = self.entries.iter().position(|e| e.node_id == contact.node_id) {
            let mut existing = self.entries.remove(pos);
            existing.addr = contact.addr;
            existing.last_seen_ms = contact.last_seen_ms;
            existing.failed_queries = 0;
            self.entries.push(existing);
            return UpdateResult::Updated;
        }

        // 2. If bucket has room, insert at MRU tail
        if self.entries.len() < self.k {
            self.entries.push(contact);
            return UpdateResult::Inserted;
        }

        // 3. Bucket is full: manage replacement cache
        if let Some(pos) = self.replacements.iter().position(|e| e.node_id == contact.node_id) {
            let mut existing = self.replacements.remove(pos);
            existing.addr = contact.addr;
            existing.last_seen_ms = contact.last_seen_ms;
            existing.failed_queries = 0;
            self.replacements.push(existing);
        } else {
            if self.replacements.len() >= self.k {
                self.replacements.remove(0); // evict oldest replacement
            }
            self.replacements.push(contact);
        }

        UpdateResult::BucketFull {
            head_candidate: self.entries[0].clone(),
        }
    }

    /// Remove a contact by NodeId. If removed and replacements exist, promotes
    /// the oldest replacement candidate into the active bucket.
    pub fn remove(&mut self, node_id: &NodeId) -> Option<PeerContact> {
        if let Some(pos) = self.entries.iter().position(|e| e.node_id == *node_id) {
            let removed = self.entries.remove(pos);
            if !self.replacements.is_empty() {
                let candidate = self.replacements.remove(0);
                self.entries.push(candidate);
            }
            Some(removed)
        } else {
            if let Some(pos) = self.replacements.iter().position(|e| e.node_id == *node_id) {
                self.replacements.remove(pos);
            }
            None
        }
    }

    /// Record a query failure. If failures reach `MAX_QUERY_FAILURES`, prunes the contact
    /// and promotes the next replacement candidate.
    pub fn mark_failed(&mut self, node_id: &NodeId) -> Option<PeerContact> {
        if let Some(pos) = self.entries.iter().position(|e| e.node_id == *node_id) {
            self.entries[pos].failed_queries += 1;
            if self.entries[pos].failed_queries >= MAX_QUERY_FAILURES {
                let pruned = self.entries.remove(pos);
                if !self.replacements.is_empty() {
                    let candidate = self.replacements.remove(0);
                    self.entries.push(candidate);
                }
                return Some(pruned);
            }
        }
        None
    }

    /// Prune any peer with `failed_queries >= max_failed`, promoting replacements.
    pub fn prune_unresponsive(&mut self, max_failed: u32) -> Vec<PeerContact> {
        let mut pruned = Vec::new();
        let mut i = 0;
        while i < self.entries.len() {
            if self.entries[i].failed_queries >= max_failed {
                let removed = self.entries.remove(i);
                pruned.push(removed);
                if !self.replacements.is_empty() {
                    let candidate = self.replacements.remove(0);
                    self.entries.push(candidate);
                }
            } else {
                i += 1;
            }
        }
        pruned
    }
}

/// 256-bucket Kademlia routing table.
#[derive(Clone, Debug)]
pub struct RoutingTable {
    /// Local node's 256-bit identifier.
    pub local_id: NodeId,
    /// Capacity parameter $k$.
    pub k: usize,
    /// 256 buckets indexed by leading zero common prefix length.
    buckets: Vec<KBucket>,
}

impl RoutingTable {
    /// Create a new routing table for the given local NodeId.
    pub fn new(local_id: NodeId, k: usize) -> Self {
        let bucket_capacity = if k == 0 { DEFAULT_K } else { k };
        let mut buckets = Vec::with_capacity(NUM_BUCKETS);
        for _ in 0..NUM_BUCKETS {
            buckets.push(KBucket::new(bucket_capacity));
        }
        Self {
            local_id,
            k: bucket_capacity,
            buckets,
        }
    }

    /// Update or insert a peer contact.
    pub fn update_contact(&mut self, contact: PeerContact) -> UpdateResult {
        if contact.node_id == self.local_id {
            return UpdateResult::SelfIgnored;
        }
        if let Some(idx) = self.local_id.bucket_index(&contact.node_id) {
            self.buckets[idx].update(contact)
        } else {
            UpdateResult::SelfIgnored
        }
    }

    /// Look up a contact by NodeId.
    pub fn get_contact(&self, node_id: &NodeId) -> Option<&PeerContact> {
        if let Some(idx) = self.local_id.bucket_index(node_id) {
            self.buckets[idx].entries().iter().find(|e| e.node_id == *node_id)
        } else {
            None
        }
    }

    /// Remove a contact by NodeId.
    pub fn remove_contact(&mut self, node_id: &NodeId) -> Option<PeerContact> {
        if let Some(idx) = self.local_id.bucket_index(node_id) {
            self.buckets[idx].remove(node_id)
        } else {
            None
        }
    }

    /// Mark a query failure for a node. Prunes after 3 strikes and promotes replacement.
    pub fn mark_failed(&mut self, node_id: &NodeId) -> Option<PeerContact> {
        if let Some(idx) = self.local_id.bucket_index(node_id) {
            self.buckets[idx].mark_failed(node_id)
        } else {
            None
        }
    }

    /// Total number of active contacts across all buckets.
    pub fn total_contacts(&self) -> usize {
        self.buckets.iter().map(|b| b.len()).sum()
    }

    /// Find the `count` closest contacts to `target`, sorted by XOR distance.
    pub fn closest_peers(&self, target: &NodeId, count: usize) -> Vec<PeerContact> {
        if count == 0 {
            return Vec::new();
        }

        let mut candidates = Vec::new();
        for bucket in &self.buckets {
            for entry in bucket.entries() {
                candidates.push(entry.clone());
            }
        }

        candidates.sort_by(|a, b| {
            let dist_a = a.node_id.distance(target);
            let dist_b = b.node_id.distance(target);
            dist_a.cmp(&dist_b)
        });

        candidates.truncate(count);
        candidates
    }

    /// Sweep and prune all peers with `failed_queries >= max_failed`.
    pub fn prune_unresponsive(&mut self, max_failed: u32) -> Vec<PeerContact> {
        let mut pruned = Vec::new();
        for bucket in &mut self.buckets {
            pruned.extend(bucket.prune_unresponsive(max_failed));
        }
        pruned
    }

    /// Synthesize a target NodeId that falls into `bucket_idx` for refreshing.
    pub fn random_id_for_bucket(&self, bucket_idx: usize) -> NodeId {
        let mut target = self.local_id.0;
        let byte_idx = bucket_idx / 8;
        let bit_idx = 7 - (bucket_idx % 8);
        target[byte_idx] ^= 1 << bit_idx;

        // Scramble remaining trailing bits with BLAKE3
        let scrambled = blake3::hash(&target);
        let scrambled_bytes = scrambled.as_bytes();
        for i in (byte_idx + 1)..32 {
            target[i] = scrambled_bytes[i];
        }

        NodeId(target)
    }

    /// Find bucket indices that have not been refreshed within `max_idle_ms`.
    pub fn stale_buckets(&self, max_idle_ms: u64, now_ms: u64) -> Vec<usize> {
        let mut stale = Vec::new();
        for (idx, bucket) in self.buckets.iter().enumerate() {
            if bucket.is_empty() {
                continue;
            }
            let newest_seen = bucket
                .entries()
                .iter()
                .map(|e| e.last_seen_ms)
                .max()
                .unwrap_or(0);
            if now_ms.saturating_sub(newest_seen) >= max_idle_ms {
                stale.push(idx);
            }
        }
        stale
    }
}

/// Query status of a candidate contact during iterative lookup.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QueryStatus {
    /// Not yet queried.
    Unqueried,
    /// Query is currently in flight.
    Pending,
    /// Successfully queried and returned neighbor list.
    Queried,
    /// Query timed out or failed.
    Failed,
}

/// Shortlist entry during iterative node lookup.
#[derive(Clone, Debug)]
pub struct ShortlistEntry {
    pub contact: PeerContact,
    pub distance: [u8; 32],
    pub status: QueryStatus,
}

/// Iterative node lookup state machine ($\alpha$ concurrency).
#[derive(Debug)]
pub struct LookupStateMachine {
    pub target: NodeId,
    pub k: usize,
    pub alpha: usize,
    pub shortlist: Vec<ShortlistEntry>,
    pub local_id: NodeId,
}

impl LookupStateMachine {
    /// Initialize a lookup state machine towards `target`.
    pub fn new(table: &RoutingTable, target: NodeId, alpha: usize, k: usize) -> Self {
        let alpha = if alpha == 0 { DEFAULT_ALPHA } else { alpha };
        let k = if k == 0 { DEFAULT_K } else { k };
        let initial_peers = table.closest_peers(&target, k);

        let mut shortlist = Vec::with_capacity(k * 2);
        for contact in initial_peers {
            let distance = contact.node_id.distance(&target);
            shortlist.push(ShortlistEntry {
                contact,
                distance,
                status: QueryStatus::Unqueried,
            });
        }

        Self {
            target,
            k,
            alpha,
            shortlist,
            local_id: table.local_id,
        }
    }

    /// Select the next batch of up to $\alpha$ unqueried candidate peers closest to `target`.
    pub fn next_queries(&mut self) -> Vec<PeerContact> {
        let mut selected = Vec::new();
        for entry in &mut self.shortlist {
            if entry.status == QueryStatus::Unqueried {
                entry.status = QueryStatus::Pending;
                selected.push(entry.contact.clone());
                if selected.len() >= self.alpha {
                    break;
                }
            }
        }
        selected
    }

    /// Process successful response containing returned neighbors.
    pub fn on_query_success(&mut self, from: &NodeId, returned: Vec<PeerContact>) {
        if let Some(entry) = self.shortlist.iter_mut().find(|e| e.contact.node_id == *from) {
            entry.status = QueryStatus::Queried;
        }

        for contact in returned {
            if contact.node_id == self.local_id {
                continue;
            }
            if !self.shortlist.iter().any(|e| e.contact.node_id == contact.node_id) {
                let distance = contact.node_id.distance(&self.target);
                self.shortlist.push(ShortlistEntry {
                    contact,
                    distance,
                    status: QueryStatus::Unqueried,
                });
            }
        }

        self.shortlist.sort_by(|a, b| a.distance.cmp(&b.distance));
    }

    /// Record query timeout or failure.
    pub fn on_query_failure(&mut self, from: &NodeId) {
        if let Some(entry) = self.shortlist.iter_mut().find(|e| e.contact.node_id == *from) {
            entry.status = QueryStatus::Failed;
        }
    }

    /// Check if the lookup has converged (no pending queries and all $k$ closest are resolved).
    pub fn is_converged(&self) -> bool {
        let pending = self.shortlist.iter().filter(|e| e.status == QueryStatus::Pending).count();
        if pending > 0 {
            return false;
        }

        let unqueried = self.shortlist.iter().filter(|e| e.status == QueryStatus::Unqueried).count();
        if unqueried == 0 {
            return true;
        }

        // Check if top $k$ items are all Queried or Failed
        let top_k = self.shortlist.iter().take(self.k);
        top_k.clone().all(|e| e.status == QueryStatus::Queried || e.status == QueryStatus::Failed)
    }

    /// Complete lookup and extract the $k$ closest discovered contacts.
    pub fn finish(self) -> Vec<PeerContact> {
        self.shortlist
            .into_iter()
            .filter(|e| e.status == QueryStatus::Queried || e.status == QueryStatus::Unqueried)
            .map(|e| e.contact)
            .take(self.k)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_xor_distance_math_properties() {
        let a = NodeId::from_bytes([0x0f; 32]);
        let b = NodeId::from_bytes([0xf0; 32]);
        let c = NodeId::from_bytes([0xaa; 32]);

        // Identity
        assert_eq!(a.distance(&a), [0u8; 32]);

        // Symmetry
        assert_eq!(a.distance(&b), b.distance(&a));

        // Bitwise XOR triangle equality: d(a, c) = d(a, b) ^ d(b, c)
        let dab = a.distance(&b);
        let dbc = b.distance(&c);
        let mut xor_combo = [0u8; 32];
        for i in 0..32 {
            xor_combo[i] = dab[i] ^ dbc[i];
        }
        assert_eq!(a.distance(&c), xor_combo);
    }

    #[test]
    fn test_bucket_index_calculation() {
        let local = NodeId::from_bytes([0x00; 32]);

        // Differ in first bit (0x80 = 1000_0000) -> 0 leading zeros -> bucket 0
        let mut d0 = [0x00; 32];
        d0[0] = 0x80;
        assert_eq!(local.bucket_index(&NodeId::from_bytes(d0)), Some(0));

        // Differ in bit 1 (0x40 = 0100_0000) -> 1 leading zero -> bucket 1
        let mut d1 = [0x00; 32];
        d1[0] = 0x40;
        assert_eq!(local.bucket_index(&NodeId::from_bytes(d1)), Some(1));

        // Differ in last bit (byte 31, bit 0) -> 255 leading zeros -> bucket 255
        let mut d255 = [0x00; 32];
        d255[31] = 0x01;
        assert_eq!(local.bucket_index(&NodeId::from_bytes(d255)), Some(255));

        // Self lookup -> None
        assert_eq!(local.bucket_index(&local), None);
    }

    #[test]
    fn test_kbucket_lru_and_replacement_cache() {
        let mut bucket = KBucket::new(2);
        let p1 = PeerContact::new(NodeId::from_bytes([1; 32]), "addr1", 100);
        let p2 = PeerContact::new(NodeId::from_bytes([2; 32]), "addr2", 200);
        let p3 = PeerContact::new(NodeId::from_bytes([3; 32]), "addr3", 300);

        assert_eq!(bucket.update(p1.clone()), UpdateResult::Inserted);
        assert_eq!(bucket.update(p2.clone()), UpdateResult::Inserted);

        // Bucket is full -> adds to replacement cache
        match bucket.update(p3.clone()) {
            UpdateResult::BucketFull { head_candidate } => {
                assert_eq!(head_candidate.node_id, p1.node_id);
            }
            other => panic!("expected BucketFull, got {other:?}"),
        }

        assert_eq!(bucket.len(), 2);
        assert_eq!(bucket.replacements().len(), 1);

        // Remove head -> replacement is promoted
        let removed = bucket.remove(&p1.node_id);
        assert_eq!(removed.unwrap().node_id, p1.node_id);
        assert_eq!(bucket.len(), 2);
        assert_eq!(bucket.entries()[1].node_id, p3.node_id);
        assert_eq!(bucket.replacements().len(), 0);
    }

    #[test]
    fn test_three_strike_failure_pruning() {
        let mut table = RoutingTable::new(NodeId::from_bytes([0; 32]), 8);
        let peer = PeerContact::new(NodeId::from_bytes([0x80; 32]), "127.0.0.1:9001", 100);
        table.update_contact(peer.clone());

        assert_eq!(table.total_contacts(), 1);
        assert_eq!(table.mark_failed(&peer.node_id), None);
        assert_eq!(table.mark_failed(&peer.node_id), None);
        // 3rd strike prunes
        let pruned = table.mark_failed(&peer.node_id);
        assert!(pruned.is_some());
        assert_eq!(table.total_contacts(), 0);
    }
}
```

---

## 4. Integration Touchpoints & Verification Matrix

| Touchpoint | File | Integration Detail |
|---|---|---|
| Module Export | `crates/kovanica-node/src/lib.rs` | Expose `pub mod dns_seed; pub mod dht;` and re-export `DnsResolver`, `StdDnsResolver`, `MockDnsResolver`, `DnsSeedResolver`, `NodeId`, `PeerContact`, `KBucket`, `RoutingTable`, `LookupStateMachine`. |
| Wire Framing | `crates/kovanica-node/src/relay.rs` | Binary codecs for `RelayMsg::DhtPing { sender, nonce }`, `RelayMsg::DhtPong { sender, nonce }`, `RelayMsg::DhtFindNode { sender, target, nonce }`, `RelayMsg::DhtNodes { sender, target, nonce, nodes }` with tags `0x20..0x23`. |
| Discrete Simulation | `crates/kovanica-node/src/p2p.rs` | Integrate `mesh.add_with_dht(name, node, node_id)`, `mesh.dht_find_node(from, target)`, `mesh.dht_bootstrap(from, seed)`, and `mesh.prune_unreachable_peers()`. |
| Node Integration | `crates/kovanica-node/src/node.rs` | Node holds an optional `RoutingTable` and generates its `NodeId` from genesis seed/keypair. |
| Explorer Replenish | `crates/kovanica-node/src/explorer.rs` | Periodic tick triggers DNS multi-seed resolution and DHT neighbor queries to maintain active peer pool. |
| Integration Tests | `crates/kovanica-node/tests/dht_discovery.rs` | 4-tier integration test verifying multi-seed bootstrap, dynamic discovery, multi-hop routing, and peer pruning over loopback TCP and `Mesh`. |

