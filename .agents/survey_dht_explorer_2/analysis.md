# Architecture & Protocol Design: Multi-Seed Discovery & Lightweight Kademlia DHT for Kovanica-Node

**Author**: survey_dht_explorer_2  
**Date**: 2026-08-24  
**Target Subsystem**: `crates/kovanica-node` (`dht`, `routing`, `net`, `p2p`, `relay`, `explorer`)

---

## Executive Summary

This report defines the complete architectural design and specification for **Multi-Seed Discovery** (DNS & static IP seeds) and a **Lightweight Kademlia Distributed Hash Table (DHT)** for peer routing in `kovanica-node`. 

Currently, `kovanica-node` relies on a single hardcoded seed (`seed.kovanica.online:9000`) or explicit environment variables (`KOVANICA_PEERS`). This design introduces a fully decentralized peer discovery protocol:
1. **256-bit NodeId space** using BLAKE3 cryptographic hashes, with an exact XOR metric distance calculation and 256-bucket prefix tree indexing.
2. **Kademlia Routing Table** with $k$-capacity buckets ($k=8$ or $k=20$), LRU replacement, replacement caches, and stale-contact pinging.
3. **Framed DHT Wire Messages** (`DhtPing`, `DhtPong`, `DhtFindNode`, `DhtNodes`) cleanly integrated into `RelayMsg` framing (`0x20..0x23` tag range) with 64-bit nonce matching.
4. **Iterative Node Lookup Algorithm** with $\alpha=3$ concurrency, distance-sorted shortlists, and robust termination conditions.
5. **Multi-Seed DNS Resolver** supporting multiple DNS hostnames with A/AAAA multi-record extraction and static IP fallback.
6. **Automatic Maintenance & Replenishment** with failure counters, replacement cache promotion, periodic bucket refreshes, and automatic P2P mesh connection replenishment.

---

## 1. Node ID Generation & Distance Representations

### 1.1 Node ID Representation

The Kovanica DHT operates on a 256-bit metric space. Every node in the network is assigned a unique `NodeId`.

```rust
/// 256-bit identifier for a node in the Kademlia DHT.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct NodeId(pub [u8; 32]);

impl NodeId {
    /// Create a NodeId from raw 32 bytes.
    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// Access the underlying 32-byte array.
    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Derive a NodeId deterministically from an Address/public key.
    pub fn from_address(address: &kovanica_state::Address) -> Self {
        let hash = blake3::hash(address.as_bytes());
        Self(*hash.as_bytes())
    }

    /// Derive a NodeId deterministically from an integer seed (for tests/simulations).
    pub fn from_u64(seed: u64) -> Self {
        let hash = blake3::hash(&seed.to_le_bytes());
        Self(*hash.as_bytes())
    }

    /// Generate a random NodeId using a cryptographic RNG.
    pub fn random() -> Self {
        use rand_core::{OsRng, RngCore};
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        Self(bytes)
    }

    /// Convert to hex string.
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }

    /// Parse from hex string.
    pub fn from_hex(s: &str) -> Result<Self, hex::FromHexError> {
        let bytes = hex::decode(s)?;
        if bytes.len() != 32 {
            return Err(hex::FromHexError::InvalidStringLength);
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(Self(arr))
    }

    /// Short 8-character hex for logging.
    pub fn short_hex(&self) -> String {
        hex::encode(&self.0[..4])
    }
}

impl core::fmt::Debug for NodeId {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "NodeId({})", self.short_hex())
    }
}

impl core::fmt::Display for NodeId {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}", self.to_hex())
    }
}
```

### 1.2 XOR Metric Distance

The distance $d(A, B)$ between two nodes $A$ and $B$ is the bitwise exclusive OR ($\oplus$) of their IDs interpreted as a 256-bit unsigned integer:

$$d(A, B) = A \oplus B$$

```rust
/// Compute the bitwise XOR distance between two NodeIds.
pub fn distance(a: &NodeId, b: &NodeId) -> [u8; 32] {
    let mut dist = [0u8; 32];
    for i in 0..32 {
        dist[i] = a.0[i] ^ b.0[i];
    }
    dist
}

/// Compare two NodeIds by their distance to a target NodeId.
/// Returns Ordering for sorting nodes closest to target first.
pub fn distance_cmp(a: &NodeId, b: &NodeId, target: &NodeId) -> std::cmp::Ordering {
    for i in 0..32 {
        let da = a.0[i] ^ target.0[i];
        let db = b.0[i] ^ target.0[i];
        if da != db {
            return da.cmp(&db);
        }
    }
    std::cmp::Ordering::Equal
}
```

### 1.3 Leading Zeros & Bucket Index

The bucket index is determined by the length of the shared prefix (number of leading zero bits in $A \oplus B$):

```rust
/// Count leading zero bits in a 256-bit distance array.
pub fn leading_zeros(dist: &[u8; 32]) -> usize {
    let mut lz = 0;
    for &byte in dist {
        if byte == 0 {
            lz += 8;
        } else {
            lz += byte.leading_zeros() as usize;
            break;
        }
    }
    lz
}

/// Calculate the routing table bucket index for `remote` relative to `local`.
///
/// Returns `None` if `local == remote` (self).
/// Returns `Some(0..=255)` corresponding to the common bit-prefix length:
/// - Bucket 0: differ at bit 0 (MSB) -> distance in [2^255, 2^256)
/// - Bucket 255: differ only at bit 255 (LSB) -> distance in [1, 2)
pub fn bucket_index(local: &NodeId, remote: &NodeId) -> Option<usize> {
    if local == remote {
        return None;
    }
    let dist = distance(local, remote);
    let lz = leading_zeros(&dist);
    // lz is in 0..=255 since local != remote
    Some(lz.min(255))
}
```

---

## 2. Kademlia Routing Table Data Structure

### 2.1 Contact and K-Bucket Definitions

```rust
use std::net::SocketAddr;

/// An entry in the Kademlia routing table.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Contact {
    pub id: NodeId,
    pub addr: SocketAddr,
    pub last_seen_ms: u64,
    pub failed_queries: u32,
}

impl Contact {
    pub fn new(id: NodeId, addr: SocketAddr, now_ms: u64) -> Self {
        Self {
            id,
            addr,
            last_seen_ms: now_ms,
            failed_queries: 0,
        }
    }

    pub fn mark_success(&mut self, now_ms: u64) {
        self.last_seen_ms = now_ms;
        self.failed_queries = 0;
    }

    pub fn mark_failed(&mut self) {
        self.failed_queries = self.failed_queries.saturating_add(1);
    }
}

/// A single k-bucket holding up to `k` active contacts, plus a replacement cache.
#[derive(Clone, Debug)]
pub struct KBucket {
    pub entries: Vec<Contact>,
    pub replacement_cache: Vec<Contact>,
    pub last_updated_ms: u64,
}

impl KBucket {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            replacement_cache: Vec::new(),
            last_updated_ms: 0,
        }
    }
}
```

### 2.2 Routing Table Implementation

```rust
pub const NUM_BUCKETS: usize = 256;
pub const DEFAULT_K: usize = 8;
pub const MAX_REPLACEMENT_CACHE: usize = 8;
pub const MAX_FAILED_QUERIES: u32 = 3;

/// Result of an attempted contact insertion.
#[derive(Debug, PartialEq, Eq)]
pub enum InsertResult {
    /// Contact inserted or updated in the active bucket entries.
    Inserted,
    /// Bucket is full; contact added to replacement cache.
    /// Caller should ping `stale_candidate` to check if it can be evicted.
    BucketFull { stale_candidate: Contact },
    /// Contact was ignored (e.g. self).
    Ignored,
}

/// Kademlia routing table.
#[derive(Clone, Debug)]
pub struct RoutingTable {
    local_id: NodeId,
    k: usize,
    buckets: Vec<KBucket>,
}

impl RoutingTable {
    pub fn new(local_id: NodeId, k: usize) -> Self {
        let mut buckets = Vec::with_capacity(NUM_BUCKETS);
        for _ in 0..NUM_BUCKETS {
            buckets.push(KBucket::new());
        }
        Self {
            local_id,
            k: k.max(1),
            buckets,
        }
    }

    pub fn local_id(&self) -> &NodeId {
        &self.local_id
    }

    pub fn k(&self) -> usize {
        self.k
    }

    pub fn bucket_count(&self) -> usize {
        NUM_BUCKETS
    }

    /// Total number of active contacts across all buckets.
    pub fn total_contacts(&self) -> usize {
        self.buckets.iter().map(|b| b.entries.len()).sum()
    }

    /// Insert or update a contact in the routing table.
    pub fn update(&mut self, contact: Contact, now_ms: u64) -> InsertResult {
        let Some(idx) = bucket_index(&self.local_id, &contact.id) else {
            return InsertResult::Ignored;
        };

        let bucket = &mut self.buckets[idx];
        bucket.last_updated_ms = now_ms;

        // Check if contact already exists in active entries
        if let Some(pos) = bucket.entries.iter().position(|c| c.id == contact.id) {
            // Move to tail (most-recently seen)
            let mut existing = bucket.entries.remove(pos);
            existing.addr = contact.addr;
            existing.mark_success(now_ms);
            bucket.entries.push(existing);
            return InsertResult::Inserted;
        }

        // If bucket has capacity, insert at tail
        if bucket.entries.len() < self.k {
            bucket.entries.push(contact);
            return InsertResult::Inserted;
        }

        // Bucket is full: candidate for replacement cache
        if let Some(pos) = bucket.replacement_cache.iter().position(|c| c.id == contact.id) {
            bucket.replacement_cache.remove(pos);
        }
        if bucket.replacement_cache.len() >= MAX_REPLACEMENT_CACHE {
            bucket.replacement_cache.remove(0); // Evict oldest
        }
        bucket.replacement_cache.push(contact);

        // Return head of active entries (least recently seen) for health check
        InsertResult::BucketFull {
            stale_candidate: bucket.entries[0].clone(),
        }
    }

    /// Remove a dead contact and promote a replacement if available.
    pub fn remove_dead(&mut self, node_id: &NodeId) -> Option<Contact> {
        let Some(idx) = bucket_index(&self.local_id, node_id) else {
            return None;
        };
        let bucket = &mut self.buckets[idx];
        if let Some(pos) = bucket.entries.iter().position(|c| c.id == *node_id) {
            bucket.entries.remove(pos);
            // Promote from replacement cache
            if !bucket.replacement_cache.is_empty() {
                let replacement = bucket.replacement_cache.pop().unwrap();
                bucket.entries.push(replacement);
            }
        }
        bucket.replacement_cache.retain(|c| c.id != *node_id);
        None
    }

    /// Mark a contact as failed after a query timeout.
    /// If failed queries exceed threshold, evicts and promotes replacement.
    pub fn record_failure(&mut self, node_id: &NodeId) {
        let Some(idx) = bucket_index(&self.local_id, node_id) else {
            return;
        };
        let bucket = &mut self.buckets[idx];
        if let Some(pos) = bucket.entries.iter().position(|c| c.id == *node_id) {
            bucket.entries[pos].mark_failed();
            if bucket.entries[pos].failed_queries >= MAX_FAILURES {
                self.remove_dead(node_id);
            }
        }
    }

    /// Find the `count` closest contacts to `target` in the routing table.
    pub fn closest_nodes(&self, target: &NodeId, count: usize) -> Vec<Contact> {
        if count == 0 {
            return Vec::new();
        }

        let target_bucket = bucket_index(&self.local_id, target).unwrap_or(0);
        let mut candidates = Vec::new();

        // 1. Gather from target bucket
        candidates.extend(self.buckets[target_bucket].entries.iter().cloned());

        // 2. Expand outwards to adjacent buckets if more candidates needed
        let mut left = target_bucket as isize - 1;
        let mut right = target_bucket + 1;

        while (candidates.len() < count.max(self.k)) && (left >= 0 || right < NUM_BUCKETS) {
            if left >= 0 {
                candidates.extend(self.buckets[left as usize].entries.iter().cloned());
                left -= 1;
            }
            if right < NUM_BUCKETS {
                candidates.extend(self.buckets[right].entries.iter().cloned());
                right += 1;
            }
        }

        // 3. Sort by XOR distance to target
        candidates.sort_by(|a, b| distance_cmp(&a.id, &b.id, target));

        // 4. Truncate to requested count
        if candidates.len() > count {
            candidates.truncate(count);
        }
        candidates
    }
}
```

---

## 3. DHT Wire Protocol Messages & Framing

### 3.1 Message Frame Tags

In `crates/kovanica-node/src/relay.rs`, frame tags are allocated as follows:

| Tag Constant | Hex Value | Decimal | Description |
|---|---|---|---|
| `TAG_HELLO` | `0x00` | 0 | Mesh hello / peer advertisement |
| `TAG_BLOCK` | `0x01` | 1 | Block record |
| `TAG_TX` | `0x02` | 2 | Mempool transaction |
| `TAG_HEADERS` | `0x11` | 17 | SPV block headers batch |
| `TAG_GETHEADERS` | `0x12` | 18 | SPV getheaders query |
| `TAG_GETBLOCKS` | `0x13` | 19 | SPV getblocks query |
| `TAG_GET_MERKLE_PROOF` | `0x15` | 21 | SPV get merkle proof query |
| `TAG_MERKLEBLOCK` | `0x16` | 22 | SPV merkleblock response |
| **`TAG_DHT_PING`** | **`0x20`** | **32** | **DHT liveness ping** |
| **`TAG_DHT_PONG`** | **`0x21`** | **33** | **DHT liveness pong (ack)** |
| **`TAG_DHT_FIND_NODE`** | **`0x22`** | **34** | **DHT find closest nodes query** |
| **`TAG_DHT_NODES`** | **`0x23`** | **35** | **DHT closest nodes response** |

### 3.2 Wire Message Definitions

```rust
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

/// Contact record serialized on the wire.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WireContact {
    pub id: NodeId,
    pub addr: SocketAddr,
}

/// DHT wire messages, extending `RelayMsg`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DhtMsg {
    /// Liveness query.
    Ping {
        sender_id: NodeId,
        nonce: u64,
    },
    /// Liveness response (nonce must match query).
    Pong {
        sender_id: NodeId,
        nonce: u64,
    },
    /// Query for closest nodes to target.
    FindNode {
        sender_id: NodeId,
        nonce: u64,
        target: NodeId,
    },
    /// Response containing closest known nodes to target.
    Nodes {
        sender_id: NodeId,
        nonce: u64,
        nodes: Vec<WireContact>,
    },
}
```

### 3.3 Binary Encoding Format

All frames are length-prefixed with 4-byte LE length, matching `RelaySession`:
`[Length: 4B LE][Tag: 1B][Payload...]`

#### Binary Layouts:
1. **`Ping`** (41 bytes total payload):
   - `[TAG_DHT_PING (0x20): 1B]`
   - `[sender_id: 32B]`
   - `[nonce: 8B LE]`

2. **`Pong`** (41 bytes total payload):
   - `[TAG_DHT_PONG (0x21): 1B]`
   - `[sender_id: 32B]`
   - `[nonce: 8B LE]`

3. **`FindNode`** (73 bytes total payload):
   - `[TAG_DHT_FIND_NODE (0x22): 1B]`
   - `[sender_id: 32B]`
   - `[nonce: 8B LE]`
   - `[target: 32B]`

4. **`Nodes`** ($43 + N \times 39$ bytes for IPv4, $43 + N \times 51$ bytes for IPv6):
   - `[TAG_DHT_NODES (0x23): 1B]`
   - `[sender_id: 32B]`
   - `[nonce: 8B LE]`
   - `[count: 2B LE]` (number of contact records, max $k \le 64$)
   - For each contact record:
     - `[node_id: 32B]`
     - `[ip_type: 1B]` (`0` = IPv4, `1` = IPv6)
     - `[ip_bytes: 4B or 16B]`
     - `[port: 2B LE]`

```rust
pub fn encode_wire_contact(contact: &WireContact, buf: &mut Vec<u8>) {
    buf.extend_from_slice(contact.id.as_bytes());
    match contact.addr.ip() {
        IpAddr::V4(v4) => {
            buf.push(0u8);
            buf.extend_from_slice(&v4.octets());
        }
        IpAddr::V6(v6) => {
            buf.push(1u8);
            buf.extend_from_slice(&v6.octets());
        }
    }
    buf.extend_from_slice(&contact.addr.port().to_le_bytes());
}

pub fn decode_wire_contact(r: &mut Cursor<'_>) -> Result<WireContact, NetError> {
    let id_bytes = r.read_array::<32>()?;
    let id = NodeId::from_bytes(id_bytes);
    let ip_type = r.read_u8()?;
    let ip = match ip_type {
        0 => {
            let octets = r.read_array::<4>()?;
            IpAddr::V4(Ipv4Addr::from(octets))
        }
        1 => {
            let octets = r.read_array::<16>()?;
            IpAddr::V6(Ipv6Addr::from(octets))
        }
        _ => return Err(NetError::Decode("invalid ip type".into())),
    };
    let port = u16::from_le_bytes(r.read_array::<2>()?);
    Ok(WireContact {
        id,
        addr: SocketAddr::new(ip, port),
    })
}
```

---

## 4. Iterative Node Lookup Algorithm

### 4.1 Lookup State & Parameters

- **$\alpha = 3$**: Concurrency parameter (number of parallel lookup paths).
- **$k = 8$**: Desired number of closest contacts.
- **Shortlist**: Sorted list of candidate contacts maintained throughout the lookup.

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CandidateStatus {
    Uncontacted,
    Pending(u64), // Query sent at timestamp ms
    Contacted,
    Failed,
}

#[derive(Clone, Debug)]
pub struct LookupCandidate {
    pub contact: Contact,
    pub status: CandidateStatus,
}

pub struct IterativeLookup {
    target: NodeId,
    alpha: usize,
    k: usize,
    shortlist: Vec<LookupCandidate>,
    completed: bool,
}
```

### 4.2 Lookup Step Execution

```rust
impl IterativeLookup {
    pub fn new(target: NodeId, initial_contacts: Vec<Contact>, alpha: usize, k: usize) -> Self {
        let mut shortlist = Vec::new();
        for c in initial_contacts {
            shortlist.push(LookupCandidate {
                contact: c,
                status: CandidateStatus::Uncontacted,
            });
        }
        shortlist.sort_by(|a, b| distance_cmp(&a.contact.id, &b.contact.id, &target));

        Self {
            target,
            alpha: alpha.max(1),
            k: k.max(1),
            shortlist,
            completed: false,
        }
    }

    /// Select next batch of up to `alpha` uncontacted nodes to query.
    pub fn next_queries(&mut self, now_ms: u64) -> Vec<Contact> {
        if self.completed {
            return Vec::new();
        }

        let mut to_query = Vec::new();
        for candidate in self.shortlist.iter_mut() {
            if candidate.status == CandidateStatus::Uncontacted {
                candidate.status = CandidateStatus::Pending(now_ms);
                to_query.push(candidate.contact.clone());
                if to_query.len() >= self.alpha {
                    break;
                }
            }
        }

        if to_query.is_empty() && !self.has_pending() {
            self.completed = true;
        }

        to_query
    }

    /// Handle successful response from a contact.
    pub fn on_response(&mut self, from_id: &NodeId, returned_nodes: Vec<Contact>, now_ms: u64) {
        // Mark responder as Contacted
        if let Some(c) = self.shortlist.iter_mut().find(|c| c.contact.id == *from_id) {
            c.status = CandidateStatus::Contacted;
            c.contact.mark_success(now_ms);
        }

        // Insert new candidates into shortlist
        for node in returned_nodes {
            if !self.shortlist.iter().any(|c| c.contact.id == node.id) {
                self.shortlist.push(LookupCandidate {
                    contact: node,
                    status: CandidateStatus::Uncontacted,
                });
            }
        }

        // Re-sort shortlist by distance to target
        let target = self.target;
        self.shortlist.sort_by(|a, b| distance_cmp(&a.contact.id, &b.contact.id, &target));

        // Trim shortlist if excessively large (keep up to 3*k)
        if self.shortlist.len() > self.k * 3 {
            self.shortlist.truncate(self.k * 3);
        }
    }

    /// Handle query timeout / failure.
    pub fn on_failure(&mut self, from_id: &NodeId) {
        if let Some(c) = self.shortlist.iter_mut().find(|c| c.contact.id == *from_id) {
            c.status = CandidateStatus::Failed;
        }
    }

    pub fn has_pending(&self) -> bool {
        self.shortlist.iter().any(|c| matches!(c.status, CandidateStatus::Pending(_)))
    }

    pub fn is_finished(&self) -> bool {
        self.completed || (!self.has_pending() && !self.has_uncontacted_in_top_k())
    }

    fn has_uncontacted_in_top_k(&self) -> bool {
        self.shortlist
            .iter()
            .take(self.k)
            .any(|c| c.status == CandidateStatus::Uncontacted)
    }

    /// Return the `k` closest contacted nodes.
    pub fn result(self) -> Vec<Contact> {
        self.shortlist
            .into_iter()
            .filter(|c| c.status == CandidateStatus::Contacted)
            .take(self.k)
            .map(|c| c.contact)
            .collect()
    }
}
```

---

## 5. DNS Multi-Seed Querying Mechanism

### 5.1 Multi-Seed Architecture

Nodes should not depend on a single hardcoded seed IP. The multi-seed mechanism supports:
1. Multiple DNS hostnames configured via environment variable or default list.
2. Standard socket resolution via `std::net::ToSocketAddrs`.
3. Extraction of multiple A (IPv4) and AAAA (IPv6) records returned by DNS seeds.
4. Fallback to a hardcoded static IP list if DNS resolution fails completely (e.g. offline, DNS outage).

```rust
use std::net::{SocketAddr, ToSocketAddrs};
use std::time::Duration;

/// Configuration for network bootstrapping seeds.
#[derive(Clone, Debug)]
pub struct SeedConfig {
    /// DNS seed hostnames (e.g. `["seed1.kovanica.online:9000", "seed2.kovanica.online:9000"]`).
    pub dns_seeds: Vec<String>,
    /// Fallback static IP socket addresses.
    pub fallback_ips: Vec<SocketAddr>,
    /// Timeout for DNS resolution and initial connection.
    pub resolve_timeout: Duration,
}

impl Default for SeedConfig {
    fn default() -> Self {
        Self {
            dns_seeds: vec![
                "seed.kovanica.online:9000".to_string(),
                "seed2.kovanica.online:9000".to_string(),
                "backup-seed.kovanica.org:9000".to_string(),
            ],
            fallback_ips: vec![
                // Static IP seeds for testnet fallback
                "159.65.120.10:9000".parse().unwrap(),
                "167.99.210.50:9000".parse().unwrap(),
            ],
            resolve_timeout: Duration::from_secs(3),
        }
    }
}
```

### 5.2 Multi-Seed Resolution Algorithm

```rust
/// Resolve configured DNS seeds to a list of distinct SocketAddrs.
/// If all DNS seeds fail, falls back to the configured static IP seeds.
pub fn discover_seed_addresses(config: &SeedConfig) -> Vec<SocketAddr> {
    let mut resolved_addrs = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for dns_seed in &config.dns_seeds {
        if let Ok(iter) = dns_seed.to_socket_addrs() {
            for addr in iter {
                if seen.insert(addr) {
                    resolved_addrs.push(addr);
                }
            }
        }
    }

    // Sort IPv4 first, then IPv6
    resolved_addrs.sort_by_key(|a| if a.is_ipv4() { 0u8 } else { 1 });

    // If DNS resolution yielded no addresses, use fallback IP list
    if resolved_addrs.is_empty() {
        for &addr in &config.fallback_ips {
            if seen.insert(addr) {
                resolved_addrs.push(addr);
            }
        }
    }

    resolved_addrs
}
```

### 5.3 DHT Bootstrap Sequence

1. **Resolve Seeds**: Query `discover_seed_addresses(&config)`.
2. **Ping Seeds**: Connect to each resolved seed via TCP relay session and send `DhtPing { sender_id: local_id, nonce }`.
3. **Seed Response**: On receiving `DhtPong`, insert seed contact into routing table.
4. **Bootstrap Iterative Lookup**: Initiate `IterativeLookup` for `target = local_id` (Self-Lookup).
5. **Populate Neighborhood**: As neighbor contacts are returned, add them to routing table and recursively query them.
6. **Convergence**: Once self-lookup completes, the node has populated its routing table buckets across all distance ranges and is fully routable.

---

## 6. Routing Table Pruning & Automatic Replenishment

### 6.1 Unresponsive Peer Pruning State Machine

```
   [Active Contact]
          │
     Query Timeout
          ▼
   [failed_queries += 1]
          │
     >= MAX_FAILURES (3)?
     ├── No ───► Stay in Active Bucket
     └── Yes ──► Evict from Bucket
                     │
         Replacement Cache available?
         ├── Yes ──► Promote Cache Candidate & Ping
         └── No  ──► Bucket size decreases
```

### 6.2 Periodic Bucket Refreshing

To prevent routing table decay in quiet or sparse network partitions:
- Every bucket tracks `last_updated_ms`.
- A periodic maintenance loop checks all buckets.
- If `now_ms - bucket.last_updated_ms > BUCKET_REFRESH_INTERVAL_MS` (e.g. 15 minutes / 100 discrete ticks):
  - Construct a synthetic `target_id` whose prefix matches that bucket index.
  - Spawn an iterative lookup for `target_id`.
  - Discovered nodes naturally replenish the underpopulated bucket.

```rust
/// Generate a random NodeId matching the prefix constraint of `bucket_idx` relative to `local_id`.
pub fn generate_random_id_for_bucket(local_id: &NodeId, bucket_idx: usize) -> NodeId {
    let mut random_id = NodeId::random();
    // Force the distance between local_id and random_id to have exactly `bucket_idx` leading zeros
    // 1. Copy the first `bucket_idx` bits from local_id
    let full_bytes = bucket_idx / 8;
    let rem_bits = bucket_idx % 8;

    for i in 0..full_bytes {
        random_id.0[i] = local_id.0[i];
    }
    if rem_bits > 0 {
        let mask = 0xFFu8 << (8 - rem_bits);
        random_id.0[full_bytes] = (local_id.0[full_bytes] & mask) | (random_id.0[full_bytes] & !mask);
    }
    // 2. Invert the (bucket_idx + 1)-th bit to guarantee distance differs at exactly bit `bucket_idx`
    let bit_pos = 7 - rem_bits;
    random_id.0[full_bytes] ^= 1 << bit_pos;

    random_id
}
```

### 6.3 Automatic P2P Mesh Connection Replenishment

The P2P `Mesh` and `RelaySession` pool requires a healthy set of active outbound TCP connections (e.g. target $N_{out} = 8$).

- If `mesh.outbound_peer_count() < TARGET_OUTBOUND_PEERS`:
  1. Query `routing_table.closest_nodes(&NodeId::random(), 16)`.
  2. Filter out already-connected or banned peers.
  3. Attempt TCP connection (`RelaySession::connect(candidate.addr)`).
  4. On successful handshake, promote to active gossip mesh peer.

---

## 7. Integration Verification & Test Plan

### 7.1 Integration Test Specification (`tests/dht_discovery.rs`)

The test suite must verify the following end-to-end scenarios:

#### Test 1: Multi-Node DHT Routing & Blind Discovery
- **Setup**:
  - Spin up 5 nodes in a ring/line DHT topology:
    - Node A connected only to Seed S.
    - Node B connected only to Seed S.
    - Node C connected only to Node B.
  - Node A does NOT know Node C's IP or Node ID initially.
- **Action**:
  - Node A initiates an iterative lookup for Node C's NodeId (or runs bootstrap self-lookup).
- **Assertion**:
  - Node A successfully discovers Node C through intermediate DHT hops (S -> B -> C).
  - Node A establishes direct connection and verifies DAG sync.

#### Test 2: Dead Peer Pruning & Replacement Cache Promotion
- **Setup**:
  - Fill a bucket to capacity $k=4$ with active contacts.
  - Add 2 extra candidates to the bucket's `replacement_cache`.
- **Action**:
  - Simulate 3 consecutive query timeouts on one active contact.
- **Assertion**:
  - The dead contact is evicted from the active bucket.
  - The freshest contact from `replacement_cache` is promoted to active entries.
  - Total bucket size remains $k=4$.

#### Test 3: Multi-Seed DNS Fallback
- **Setup**:
  - Configure `SeedConfig` with 2 invalid/unresolvable DNS seed hostnames (`invalid.test.example:9000`) and 1 valid static fallback IP address.
- **Action**:
  - Run `discover_seed_addresses(&config)`.
- **Assertion**:
  - Resolution gracefully skips failed DNS seeds without panicking or hanging.
  - The fallback static IP is correctly returned and used for bootstrap.

---

## 8. Summary of Architectural Impact

| Component | Current State | Proposed Design |
|---|---|---|
| **Peer Bootstrapping** | Single hardcoded `P2P_BOOTSTRAP` host or manual `KOVANICA_PEERS` | Multi-Seed DNS resolution with multi-A/AAAA record parsing & static IP fallback |
| **Peer Discovery** | 1-hop Hello gossip flooding | Kademlia DHT iterative routing over 256-bit XOR metric space |
| **Routing Table** | Unbounded/flat peer list in `Mesh` | 256 $k$-buckets with LRU, replacement cache, and ping health checks |
| **Wire Protocol** | 8 tags (hello, block, tx, SPV) | 12 tags (+ `DhtPing`, `DhtPong`, `DhtFindNode`, `DhtNodes`) with 64-bit nonce tracking |
| **Peer Maintenance** | Static or manual disconnection | Automatic dead peer eviction, replacement cache promotion, periodic bucket refreshes |
