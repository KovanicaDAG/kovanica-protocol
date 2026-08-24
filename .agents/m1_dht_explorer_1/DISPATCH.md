## 2026-08-24T00:35:47Z
You are m1_dht_explorer_1.
Your working directory is: /root/kovanica-protocol/.agents/m1_dht_explorer_1

Read the authoritative original user request at: /root/kovanica-protocol/.agents/ORIGINAL_REQUEST.md
Read the project architecture and interface contracts in: /root/kovanica-protocol/PROJECT.md
Read the test plan in: /root/kovanica-protocol/TEST_INFRA.md
Review project conventions in: /root/kovanica-protocol/AGENTS.md

Task:
Perform a deep technical exploration and write a concrete, drop-in Rust implementation blueprint for:
1. `crates/kovanica-node/src/dns_seed.rs`:
   - `DnsResolver` trait (`resolve(&self, host: &str, port: u16) -> Result<Vec<SocketAddr>, std::io::Error>`), `StdDnsResolver`, and deterministic `MockDnsResolver`.
   - `DnsSeedResolver` with multi-seed querying, deduplication, shuffling, and static fallback IP pipeline (`P2P_BOOTSTRAP_FALLBACKS`).
2. `crates/kovanica-node/src/dht.rs`:
   - `NodeId` (256-bit BLAKE3 space), XOR distance metric math, leading zero bit count, bucket index (0..255).
   - `PeerContact` (node_id, addr, last_seen_ms, failed_queries).
   - `KBucket` with capacity $k$ ($k=8$ or $k=20$), LRU ordering, and auxiliary replacement cache ($k$ items).
   - `RoutingTable` managing 256 buckets, contact updates, distance-sorted `closest_peers(target, count)`, 3-strike failure marking, dead-peer pruning, and stale bucket refresh targets.
   - Iterative node lookup state machine / helper algorithm.

Output:
Write your full analysis and precise code blueprint to `/root/kovanica-protocol/.agents/m1_dht_explorer_1/analysis.md` and structured `handoff.md`. Update `progress.md`.
When finished, send a brief message with your summary and handoff path.
