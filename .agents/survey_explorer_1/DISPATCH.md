# DISPATCH — survey_explorer_1

**Objective**: Investigate P2P framing, message serialization, mesh and relay loops in `crates/kovanica-node`.
**Files to read**:
- `/root/kovanica-protocol/.agents/ORIGINAL_REQUEST.md`
- `/root/kovanica-protocol/AGENTS.md`
- `/root/kovanica-protocol/crates/kovanica-node/src/relay.rs`
- `/root/kovanica-protocol/crates/kovanica-node/src/p2p.rs`
- `/root/kovanica-protocol/crates/kovanica-node/src/net.rs`
- `/root/kovanica-protocol/crates/kovanica-node/src/node.rs`
- `/root/kovanica-protocol/crates/kovanica-node/src/lib.rs`
- `/root/kovanica-protocol/crates/kovanica-node/src/main.rs`

**Questions to answer**:
1. How are messages framed and serialized over TCP in `RelaySession` and in-process `Mesh`? What enum or structs represent wire messages (e.g. `RelayMsg`, `WireMsg`)?
2. How are hello/handshakes, block announcements, tx announcements, and block/inventory requests handled?
3. How should `getheaders`, `headers`, `getblocks`, and `merkleblock` messages be formatted, serialized/deserialized, and dispatched in `relay.rs` and `p2p.rs`?
4. What buffer limits, error handling, or protocol versioning exist?

**Output**:
Write full findings to `/root/kovanica-protocol/.agents/survey_explorer_1/analysis.md` and handoff to `/root/kovanica-protocol/.agents/survey_explorer_1/handoff.md`.
Then send a completion message with summary.
