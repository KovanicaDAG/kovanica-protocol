# Handoff Report: Multi-Seed Discovery & Lightweight Kademlia DHT Design

**Agent**: `survey_dht_explorer_2`  
**Working Directory**: `/root/kovanica-protocol/.agents/survey_dht_explorer_2`  
**Target Milestone**: Multi-Seed Discovery (DNS seed querying) and Lightweight Kademlia DHT for `kovanica-node`

---

## 1. Observation

1. **Current Bootstrap & Peer Discovery Mechanism**:
   - `crates/kovanica-node/src/explorer.rs:37`: Hardcodes a single bootstrap seed:
     ```rust
     const P2P_BOOTSTRAP: &str = "seed.kovanica.online:9000";
     ```
   - `crates/kovanica-node/src/explorer.rs:493-503`: Reads `KOVANICA_PEERS` from the environment or defaults to `vec![P2P_BOOTSTRAP.to_string()]`.
   - `crates/kovanica-node/src/p2p.rs:1-17`: `Mesh` uses an in-process discrete-time simulation for continuous gossip and 1-hop peer discovery via `Hello` envelopes advertising immediate neighbors.
2. **Persistent TCP Framing & Message Envelopes**:
   - `crates/kovanica-node/src/relay.rs:24-32`: Existing tags:
     ```rust
     pub const TAG_HELLO: u8 = 0;
     pub const TAG_BLOCK: u8 = 1;
     pub const TAG_TX: u8 = 2;
     pub const TAG_HEADERS: u8 = 0x11;
     pub const TAG_GETHEADERS: u8 = 0x12;
     pub const TAG_GETBLOCKS: u8 = 0x13;
     pub const TAG_GET_MERKLE_PROOF: u8 = 0x15;
     pub const TAG_MERKLEBLOCK: u8 = 0x16;
     ```
   - `crates/kovanica-node/src/relay.rs:112-132`: Messages are framed over persistent TCP sockets with a 4-byte LE length prefix (`[length: 4B LE][tag: 1B][payload...]`) bounded by `MAX_FRAME = 4 * 1024 * 1024`.
3. **Workspace Dependencies**:
   - `Cargo.toml:13-18`: Contains `blake3 = { version = "1", features = ["pure"] }`, `hex = "0.4"`, `ed25519-dalek = { version = "2", features = ["std"] }`, `rand_core = { version = "0.6", features = ["std"] }`.
   - `crates/kovanica-node/Cargo.toml:10-20`: Depends on `kovanica-dag`, `kovanica-state`, `socket2 = "0.5"`, `serde = { version = "1.0", features = ["derive"] }`, `serde_json = "1.0"`.
4. **Current Test Suite Status**:
   - `cargo check --all-targets` and `cargo test` pass completely across all crates (`kovanica-dag`, `kovanica-state`, `kovanica-node`).

---

## 2. Logic Chain

1. **Decentralized Bootstrapping & Multi-Seed Discovery**:
   - *From Observation 1*, reliance on a single hardcoded DNS/IP host (`seed.kovanica.online:9000`) creates a single point of failure and vulnerability to DNS/network partition.
   - *Reasoning*: A multi-seed resolver (`SeedConfig`) supporting multiple DNS seed hostnames (e.g. `seed.kovanica.online`, `seed2.kovanica.online`, `backup-seed.kovanica.org`) using `std::net::ToSocketAddrs` can extract all A and AAAA records. Adding a static IP seed fallback guarantees bootstrap even during a total DNS outage.
2. **Kademlia DHT Metric & Routing Structure**:
   - *From Observation 3*, BLAKE3 and 256-bit hashes are already the standard in Kovanica (`BlockId`, `TxId`, `Address`).
   - *Reasoning*: A 256-bit `NodeId` derived via BLAKE3 matches the cryptographic primitives of the ledger. The XOR distance metric $d(A, B) = A \oplus B$ combined with bitwise prefix matching yields 256 $k$-buckets with $O(\log N)$ routing complexity.
3. **K-Bucket Data Structure & LRU Replacement**:
   - *Reasoning*: A 256-bucket routing table with configurable bucket capacity $k$ ($k=8$ or $k=20$), LRU ordering, and a replacement cache of capacity $k$ ensures stable long-lived contacts are preserved against Sybil/churn attacks while allowing dead peers to be replaced instantly.
4. **Wire Protocol Integration**:
   - *From Observation 2*, `RelayMsg` already handles binary-framed length-prefixed protocol messages over persistent TCP connections.
   - *Reasoning*: DHT messages (`DhtPing`, `DhtPong`, `DhtFindNode`, `DhtNodes`) can be assigned tags `0x20..0x23` without conflicting with existing tags `0x00..0x02` and `0x11..0x16`. 64-bit query nonces enable deterministic asynchronous request-response matching.
5. **Iterative Node Lookup**:
   - *Reasoning*: An $\alpha$-concurrent lookup ($\alpha=3$) querying the $\alpha$ closest uncontacted nodes to a target $ID_{target}$ and updating a distance-sorted shortlist converges in $O(\log N)$ network hops, returning the $k$ closest nodes.
6. **Maintenance & P2P Mesh Bridge**:
   - *Reasoning*: By tracking failed queries, evicting dead peers after 3 consecutive failures, refreshing inactive buckets every 15 minutes / 100 ticks with synthetic random target lookups, and feeding discovered contacts into the active P2P mesh connection pool, the node maintains a robust, self-healing overlay.

---

## 3. Caveats

1. **NAT Traversal / UPnP**: This survey focuses on multi-seed DNS resolution and Kademlia DHT routing over routable TCP/UDP endpoints. ICE/STUN/TURN NAT hole punching is out of scope for the lightweight DHT phase.
2. **Sybil Resistance / S/Kademlia Crypto Puzzles**: Node IDs can be derived from ed25519 addresses or random hashes. Cryptographic proof-of-work puzzles on Node IDs (S/Kademlia) can be added as a future security hardening if Sybil attacks are observed on mainnet.

---

## 4. Conclusion

A lightweight Kademlia DHT and multi-seed DNS resolver can be cleanly integrated into `crates/kovanica-node` without architectural friction. The protocol integrates directly into the existing `RelaySession` framing, provides deterministic discrete-time simulation for tests, and completely eliminates the single hardcoded seed dependency.

Detailed specification, algorithms, packet encodings, and test plans have been documented in `/root/kovanica-protocol/.agents/survey_dht_explorer_2/analysis.md`.

---

## 5. Verification Method

To independently verify the survey and existing test suite baseline:
1. Run `cargo check --all-targets` to confirm compilation.
2. Run `cargo test` to confirm all existing unit, integration, and doctests pass cleanly.
3. Inspect `/root/kovanica-protocol/.agents/survey_dht_explorer_2/analysis.md` for the complete design specification, struct definitions, framing tags, and lookup algorithms.
