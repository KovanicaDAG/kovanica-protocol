## 2026-08-24T00:33:11Z

Task:
Investigate architectural requirements and protocol designs for Multi-Seed Discovery (DNS seed querying) and a lightweight Kademlia-based DHT for peer routing in `kovanica-node`.

Analyze:
1. Node ID generation and representations (e.g. 256-bit NodeId / Blake3 hash, XOR metric distance calculation, leading zero bit prefix / bucket index).
2. Kademlia routing table data structure (k-buckets with k capacity, e.g. k=8 or k=20, contact entries with NodeId + SocketAddr + last_seen/liveness, bucket update / LRU replacement, replacement caches, pinging stale contacts).
3. DHT wire protocol messages (`FindNode`, `Neighbors`/`Nodes`, `Ping`, `Pong`), message encodings, frame tag definitions, request-response matching / nonce tracking.
4. Iterative node lookup algorithm (closest nodes calculation, querying alpha nearest nodes, collecting candidate contacts, termination conditions).
5. DNS multi-seed querying mechanism (querying multiple DNS seed hostnames using standard socket address resolution, fallback to IP seeds, extracting peer socket addresses).
6. Routing table pruning of unresponsive/dead peers and automatic replenishment from DHT lookups.

Output:
Write a comprehensive specification and design report to `/root/kovanica-protocol/.agents/survey_dht_explorer_2/analysis.md` and a structured `handoff.md`. Update your `progress.md` throughout your work.
When finished, send a brief message with your findings summary and the path to your handoff file.
