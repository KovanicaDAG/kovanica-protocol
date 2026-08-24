# BRIEFING — 2026-08-24T00:35:00Z

## Mission
Investigate architectural requirements and design specifications for Multi-Seed Discovery (DNS seed querying) and lightweight Kademlia-based DHT peer routing for `kovanica-node`.

## 🔒 My Identity
- Archetype: explorer
- Roles: investigator, protocol designer
- Working directory: /root/kovanica-protocol/.agents/survey_dht_explorer_2
- Original parent: d32ae92a-d48f-4bab-a3a0-c1ed5fdb5c73
- Milestone: Multi-Seed Discovery and Lightweight Kademlia DHT Design

## 🔒 Key Constraints
- Read-only investigation — do NOT implement in crates/
- Write reports and analysis only in own directory (/root/kovanica-protocol/.agents/survey_dht_explorer_2/)

## Current Parent
- Conversation ID: d32ae92a-d48f-4bab-a3a0-c1ed5fdb5c73
- Updated: not yet

## Investigation State
- **Explored paths**: `crates/kovanica-node/src/` (relay.rs, net.rs, p2p.rs, p2p_hardening.rs, explorer.rs, spv.rs), `Cargo.toml`, test suites.
- **Key findings**:
  - Node ID: 256-bit BLAKE3 identifier, bitwise XOR metric distance $d(A, B) = A \oplus B$, 256 prefix buckets.
  - Routing table: 256 $k$-buckets with LRU ordering, replacement cache ($k$ entries), ping health checks.
  - Wire protocol: `DhtPing` (0x20), `DhtPong` (0x21), `DhtFindNode` (0x22), `DhtNodes` (0x23) framed inside `RelayMsg` with 64-bit nonces.
  - Iterative lookup: $\alpha=3$ concurrency, distance-sorted shortlists, termination on $k$ closest contacted.
  - Multi-seed discovery: DNS A/AAAA multi-record parsing with static fallback IP list.
  - Self-healing: 3-failure pruning, replacement cache promotion, 15-min bucket refreshing, automatic mesh replenishment.
- **Unexplored areas**: None for this specification milestone.

## Key Decisions Made
- Fully specified NodeId, distance metric, routing table data structure, wire message framing, iterative lookup, multi-seed resolver, and maintenance state machines in `analysis.md` and `handoff.md`.

## Artifact Index
- `/root/kovanica-protocol/.agents/survey_dht_explorer_2/analysis.md` — Comprehensive architecture & design report
- `/root/kovanica-protocol/.agents/survey_dht_explorer_2/handoff.md` — 5-component handoff report
- `/root/kovanica-protocol/.agents/survey_dht_explorer_2/progress.md` — Progress log & heartbeat
- `/root/kovanica-protocol/.agents/survey_dht_explorer_2/DISPATCH.md` — Inbound dispatch log
