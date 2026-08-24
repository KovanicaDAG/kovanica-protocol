# Handoff Report — survey_dht_explorer_1

**Report Type**: Hard Handoff (Task Complete)  
**Author**: `survey_dht_explorer_1`  
**Date**: 2026-08-24  
**Working Directory**: `/root/kovanica-protocol/.agents/survey_dht_explorer_1`  
**Target Analysis File**: `/root/kovanica-protocol/.agents/survey_dht_explorer_1/analysis.md`

---

## 1. Observation

1. **Current P2P Simulation & Discovery in `Mesh` (`crates/kovanica-node/src/p2p.rs:108-119, 499-517`)**:
   - `Mesh` manages an in-process overlay using `BTreeMap<String, Node>` and `BTreeMap<String, BTreeSet<String>>` for peer edges.
   - Peer discovery in `on_hello` (`p2p.rs:499-517`) is a 1-hop neighbor advertisement (`Envelope::Hello { advertised: Vec<String> }`).
   - `Mesh` lacks any peer eviction or disconnection mechanism (peer sets grow monotonically).

2. **TCP Relay & Wire Protocol (`crates/kovanica-node/src/relay.rs:24-31, 81-133`)**:
   - Wire messages use length-prefixed framing (4-byte LE length prefix, max frame 4 MB).
   - Tags currently defined: `TAG_HELLO = 0`, `TAG_BLOCK = 1`, `TAG_TX = 2`, `TAG_HEADERS = 0x11`, `TAG_GETHEADERS = 0x12`, `TAG_GETBLOCKS = 0x13`, `TAG_GET_MERKLE_PROOF = 0x15`, `TAG_MERKLEBLOCK = 0x16`.
   - Tags `0x20`–`0x2F` are completely unallocated and open for DHT messages.

3. **Bootstrap Configuration & Explorer Loop (`crates/kovanica-node/src/explorer.rs:36-37, 88-104, 493-503`)**:
   - Hardcoded bootstrap constant: `P2P_BOOTSTRAP = "seed.kovanica.online:9000"`.
   - Single environment variable `KOVANICA_PEERS` splits comma-separated strings but does not dynamically resolve multiple A/AAAA records for DNS seed round-robins.
   - `Explorer.peers` is a static `Vec<String>` initialized at startup and never replenished dynamically from network discovery.

4. **Hardening & Scoring Infrastructure (`crates/kovanica-node/src/p2p_hardening.rs:48-66, 129-172`)**:
   - `P2pHardening` tracks rate limits, duplicate blocks/txs, and peer scores with auto-banning at threshold `-50`.
   - Existing scoring hooks can be directly extended to score DHT query responsiveness and malformed routing responses.

5. **Test Suite Status (`cargo test`)**:
   - Ran `cargo test` across workspace (`kovanica-dag`, `kovanica-state`, `kovanica-node`). All unit tests, integration tests (`tests/p2p.rs`, `tests/network.rs`, `tests/relay.rs`, `tests/spv_sync.rs`), and doc-tests passed with 0 errors.

---

## 2. Logic Chain

1. **Premise 1 (from Obs 1 & 3)**: Nodes currently depend on static configuration (`KOVANICA_PEERS` or `seed.kovanica.online:9000`). If that single seed node is unavailable, newly joined nodes cannot find peers or join the DAG network.
2. **Premise 2 (from Obs 3)**: Operating a robust decentralized network requires querying multiple independent DNS seed operators and extracting multiple IP addresses from DNS A/AAAA responses.
3. **Premise 3 (from Obs 1 & 2)**: 1-hop neighbor sharing in `Hello` is insufficient for scalable routing in large or partitioned networks. A structured Kademlia DHT ($k$-buckets with XOR metric $d(x,y) = x \oplus y$) allows $O(\log N)$ routing to discover arbitrary nodes without prior knowledge of their IP addresses.
4. **Premise 4 (from Obs 2 & 4)**: The existing wire framing in `relay.rs` and scoring in `p2p_hardening.rs` have clear extension points for DHT messages (`0x20`–`0x23`: `PING`, `PONG`, `FIND_NODE`, `NEIGHBORS`) and peer eviction scoring.
5. **Deduction (Conclusion)**: Introducing a modular `DnsSeedResolver` (`dns_seed.rs`) and a Kademlia `RoutingTable` (`dht.rs`), integrated with `Mesh` for deterministic testing and `RelaySession` / `Explorer` for live TCP discovery, fully satisfies all requirements without disrupting existing consensus or SPV wire protocols.

---

## 3. Caveats

- **No Live UDP Transport**: The current codebase strictly uses plaintext TCP (`KOVANICA_LISTEN`). The DHT design is specified over framed TCP (`RelaySession`) to preserve single-port simplicity and avoid introducing raw UDP sockets, though Kademlia is traditionally run over UDP. Running over TCP relay sessions is fully compatible and avoids NAT/firewall port divergence.
- **NAT Traversal / UPnP / STUN**: NAT traversal (UPnP, STUN, hole punching) was not in the scope of this survey and is not required for testnet/cluster discovery where public or routable test addresses are used.

---

## 4. Conclusion

1. **Architecture Blueprint Complete**: Comprehensive analysis written to `/root/kovanica-protocol/.agents/survey_dht_explorer_1/analysis.md`.
2. **Implementation Strategy**:
   - Implement `crates/kovanica-node/src/dns_seed.rs` for multi-host DNS A/AAAA resolution, shuffling, and fallback.
   - Implement `crates/kovanica-node/src/dht.rs` for 256-bit `NodeId`, XOR distance metric, $k$-buckets, iterative lookup, and dead-peer pruning.
   - Extend `crates/kovanica-node/src/relay.rs` with DHT message tags (`TAG_DHT_PING` through `TAG_DHT_NEIGHBORS`) and serialization.
   - Extend `crates/kovanica-node/src/p2p.rs` (`Mesh`) with DHT routing and deterministic testing hooks.
   - Write integration test `crates/kovanica-node/tests/dht_discovery.rs` verifying multi-hop discovery and peer pruning.

---

## 5. Verification Method

To independently verify the observations and analysis:
1. **Inspect Survey Report**:
   ```bash
   cat /root/kovanica-protocol/.agents/survey_dht_explorer_1/analysis.md
   ```
2. **Verify Existing Tests Pass**:
   ```bash
   cargo test
   ```
3. **Verify Wire Protocol Tag Space**:
   Inspect `crates/kovanica-node/src/relay.rs:24-32` and `crates/kovanica-node/src/net.rs:355-362` to confirm tags `0x20`–`0x2F` are unallocated.
4. **Verify Seed Constants**:
   Inspect `crates/kovanica-node/src/explorer.rs:36-37` and `crates/kovanica-node/src/explorer.rs:493-503` to confirm single seed dependency.
