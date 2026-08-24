# KovanicaDAG — Project Overview for Obsidian

## What is this?
**kovanica-protocol** is a **DAG-based distributed ledger** — a high-throughput, parallel-block cryptocurrency/ledger protocol built on a **Directed Acyclic Graph** (BlockDAG) rather than a single chain.

Blocks reference **multiple parents**, enabling parallel block production and high block rates (BPS). Consensus follows **GHOSTDAG** (Sompolinsky, Wyborski & Zohar — the protocol behind Kaspa).

---

## Repository Structure
```
kovanica-protocol/
├── crates/
│   ├── kovanica-dag/     # DAG + GHOSTDAG consensus core
│   ├── kovanica-state/   # UTXO ledger applied in GHOSTDAG order
│   ├── kovanica-node/    # Runnable node: mempool, block production, P2P
│   └── kovanica-cli/     # CLI wallet: keygen, send, queries (merged from kovanica-cli)
├── web/                  # React/TypeScript UI (merged from kovanica-web)
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/             # Landing, explorer, wallet, map
│   └── server/          # Nitro middleware
└── Cargo.toml           # Workspace root (4 crates)
```

---

## Core Domain Concepts
| Term | Meaning |
|------|---------|
| **DAG / BlockDAG** | Ledger is a DAG; blocks reference multiple parents/tips |
| **Tip** | Block with no children yet |
| **Past / ancestors** | All blocks reachable by following parent edges |
| **Selected parent** | Parent with heaviest blue work; forms chain backbone |
| **Mergeset** | `past(B) \ (past(sp) ∪ {sp})` — blocks merged by B |
| **Blue set / red set** | Well-connected honest cluster (blue) vs. side blocks (red) |
| **k parameter** | Max tolerated blue anticone size (every blue block ≤ k blue anticone) |
| **Blue score / work** | Size / total work of a block's blue set; drives selection |
| **Linearization** | Deterministic total order: `order(B) = order(sp) ++ mergeset ++ [B]` |

---

## Current Status (as of 2026-08-23)

### ✅ Stage 0 — Shipped: BlockDAG testnet
Deployed on `kovanica-testnet-1` (seed: `seed.kovanica.online:9000`, explorer: `explorer.kovanica.online`)

- Transactions + UTXO state, ed25519 signatures
- Block validation (structural + stateful)
- Recursive GHOSTDAG linearization
- Per-block UTXO state from selected parent
- Finality-depth pruning + implicit re-orgs
- Replay-log snapshots (state recomputed on load)
- **Reachability oracle**: interval-tree + future-covering sets, **incremental** (Kaspa reindexing)
- Node binary + line RPC (`serve`/`demo`)
- Mempool + block production + multi-node gossip
- Continuous P2P (`p2p::Mesh`: hello, delayed relay, tx flood)
- Long-lived TCP relay + WebSocket (`/ws`)
- Difficulty retargeting + **consensus enforcement**
- Wall-clock future-time bound (2h, node policy)
- **Real PoW** (opt-in, Nakamoto `H * work < 2^256`)
- Halving schedule, TX size limits, human addresses (`kvnc…dag`)
- Framed bidirectional TCP sync, multi-input transfers
- TAP micro-faucet, CI gate + dual-stack P2P

### ✅ Stage 1 — Operations hardening
- Auto-deploy armed (`VPS_HOST`, `DEPLOY_ENABLED`)
- Seed ops runbook: `OPERATIONS.md`
- Web proxy resolved (server-side)
- Wallet shows `kvnc…dag` addresses

### ✅ Stage 2 — Scale & persistence **COMPLETE**
- [x] **Headers-first sync** (tips/headers → fetch bodies by hash)
- [x] **DAG-level payload pruning**
  - `Block.payload = Option<Vec<u8>>` (`None` = pruned)
  - `Dag::set_payload_pruning_depth(depth)` evicts payloads > depth below tip
  - `Dag::prune_old_payloads()` auto-called on insert
  - Reachability queries work on pruned blocks (oracle never inspects payload)
  - Snapshots encode pruned blocks with empty payload; load → `payload = None`
  - `Ledger::with_payload_pruning()`, `with_finality_and_payload_pruning()`
  - `Node::genesis_with_finality()`, `set_payload_pruning_depth()`
  - `Node::receive_block` rejects blocks built on pruned history
- [x] **CLI and Web merged into protocol repo**
  - `crates/kovanica-cli`: wallet keygen, address, send, queries
  - `web/`: React/TS UI with Vite + TanStack Start
- [x] **Finality checkpointing** — persist UTXO set at finality depth
  - `Ledger::write_checkpoint()` / `read_checkpoint()`: UTXO set + tip segment (non-final blocks)
  - `LedgerStore::create_checkpoint()` / `open_checkpoint()`: file I/O
  - `Node::save_checkpoint()` / `load_checkpoint()` + RPC `checkpoint` / `load_checkpoint`
  - Format v2: stores checkpoint block height for correct subsidy calculation
  - Checkpoint block included in tip segment, reconstructed with original ID via `Block::new_pruned`
  - Restored ledger applies checkpoint UTXO set directly, replays only tip segment
- [x] **Reachability interval-reindex amortisation tuning**
  - `CHILD_RESERVE = 1<<40` caps child intervals → wide fans (5000+) reindex-free (0 relayout touches vs 1.1M before)
  - `Dag::reachability_reindex_metrics()` returns `(reindexes, relayout_touches)`
  - 3 new tests: wide fan amortised away, large fan stays reindex-free, deep chain still reindexes correctly

### 📋 Stage 3 — Protocol evolution
- [x] **VRF for leader selection / randomness beacon**
  - `kovanica-dag::vrf`: ECVRF over Ristretto255 (Ed25519 curve), following IRTF CFRG VRF draft
  - `vrf_prove`/`vrf_verify`: deterministic VRF evaluation with Schnorr-style proof `(Γ, c, s)`
  - Block gains VRF fields: `vrf_public_key`, `vrf_proof`, `vrf_output` (Option for backward compat)
  - `Dag::set_vrf(threshold)`: consensus-enforced leader eligibility
  - VRF input derived from parent tips: `H(tip1 || tip2 || ...)`
  - Leader eligible iff VRF output (as u64) < threshold; `u64::MAX` = all eligible (randomness beacon)
  - Composes with PoW + difficulty (independent opt-in switches)
  - Snapshot format v5 includes VRF fields
  - Tests: eligibility, invalid proof, wrong key, missing fields, composes with PoW, beacon
- [x] **P2P hardening: rate limits, duplicate suppression, peer scoring/banning**
  - `kovanica-node::p2p_hardening`: configurable hardening parameters
  - Rate limiting: max bytes/messages per peer per time window
  - Duplicate suppression: track known blocks/txs per peer, penalize resends
  - Peer scoring: reward valid blocks/txs (+1), penalize duplicates (-5/-2), heavy penalty for invalid (-20/-10)
  - Auto-ban when score <= threshold (default -50); manual ban/unban API
  - Integration: rate limits checked on `Mesh::enqueue`, duplicates checked on `Mesh::deliver`
  - Stats: `Mesh::peer_stats` / `all_peer_stats` for monitoring
  - Tests: rate limit enforcement, duplicate penalties, ban prevents relay, stats
- [x] **Mempool upgrades: orphan handling, fee-based eviction**
  - `kovanica-node::mempool_v2`: enhanced mempool with orphan pool and fee-based eviction
  - Orphan pool: txs with missing inputs held separately, auto-promoted when block adds inputs
  - Fee-based eviction: lowest fee-rate txs evicted first when capacity exceeded
  - Capacity limits: configurable max tx count (default 100k) and max bytes (default 100MB)
  - Minimum fee rate enforcement (default 1 atom/byte)
  - Orphan auto-expiry after configurable block age (default 100 blocks)
  - Backward-compatible `Mempool` wrapper for existing code
  - Tests: orphan promotion, fee ordering, capacity eviction, min fee rate

---

## Key Implementation Files (for reference)

| Feature | Files |
|---------|-------|
| Block + pruning | `crates/kovanica-dag/src/block.rs` |
| Dag + pruning | `crates/kovanica-dag/src/dag.rs` |
| Reachability oracle | `crates/kovanica-dag/src/reachability.rs` |
| Snapshot (pruning aware) | `crates/kovanica-dag/src/snapshot.rs` |
| Payload pruning tests | `crates/kovanica-dag/tests/payload_pruning.rs` |
| Ledger finality + payload pruning | `crates/kovanica-state/src/ledger.rs` |
| Node genesis/pruning/receive | `crates/kovanica-node/src/node.rs` |
| CLI wallet + queries | `crates/kovanica-cli/src/{main.rs,api.rs,wallet.rs}` |
| Web UI | `web/src/` (TanStack Start routes + components) |
| Roadmap / conventions | `AGENTS.md` |

---

## Build & Test Commands
```bash
# From kovanica-protocol/
cargo build           # Build all crates
cargo test            # Run all tests (unit + integration + doctest)
cargo clippy --all-targets  # Lint (must be warning-clean)
cargo fmt             # Format (CI runs fmt --check)

# Run node demo
cargo run -p kovanica-node -- demo

# Run node REPL
cargo run -p kovanica-node   # then type: help

# Run CLI wallet
cargo run -p kovanica-cli -- keygen --key alice.key
cargo run -p kovanica-cli -- balance kvnc…dag

# Run web UI
cd web
npm ci
npm run dev
```

---

## Design Principles (from AGENTS.md)
1. **Consensus correctness is paramount** — changes to SP, mergeset, k-cluster, linearization need rationale + adversarial tests
2. **Determinism** — consensus output must be a pure function of the DAG
3. **Tie-breaks** fall back to `BlockId` byte order
4. **Tests** — prefer property/invariant + adversarial (Byzantine parents, wide forks, tie-breaks)
5. **No `unsafe`** — forbidden crate-wide via `#![forbid(unsafe_code)]`

---

## Migration Notes (2026-08-23)
- Merged `kovanica-cli` into `crates/kovanica-cli` workspace member
- Merged `kovanica-web` into `web/` directory
- Renamed repo: `kovanica-ledger` → `kovanica-protocol`
- All workspace dependencies reference `kovanica-protocol` GitHub URL
- CLI and web UIs included in single workspace for easier development

---

## Post-Stage 3 Roadmap (suggested order)

1. ~~**Light clients / SPV proofs**~~ ✅ **DONE**
   - `kovanica-state::spv`: BlockHeader, MerkleProof, BlockFilter, SpvClient
   - Header chain verification: PoW, difficulty, timestamp, work monotonicity
   - Merkle proof verification for transaction inclusion
   - Compact block filters (Golomb-Rice) for address watching
   - `SpvClient` state machine with checkpoint-based trust
   - Next: wire protocol (`getheaders`/`getblocks` with proofs)
2. **Multi-seed discovery** — DNS seeds / DHT for decentralized bootstrap
3. **Observability & reliability** — Prometheus metrics, fuzzing, alerting
4. **Testnet soak & parameter tuning** — 24/7 multi-seed testnet
5. **Wallet & explorer polish** — hardware wallet, BIP39, fee estimation

---

## Links
- **Testnet seed**: `seed.kovanica.online:9000`
- **Explorer**: `explorer.kovanica.online`
- **GitHub (protocol)**: https://github.com/KovanicaDAG/kovanica-protocol
- **Web UI**: https://kovanica.online
- **Wallet**: https://wallet.kovanica.online
- **Obsidian vault**: This file + project notes in `/home/antonio/Documents/Obsidian Vault`

## Recent Updates (2026-08-24)
- **Test Successes**: Full workspace `cargo test` suite resolved! Restored determinism for finality checkpointing, VRF verification, and mempool V2. See details in [[kovanica-test-results]].
- **Antigravity Skills**: 5 new custom skills created in `.agents/skills/` to automate the repository:
  1. `rust-workflow`: High-performance deterministic Rust guidelines.
  2. `obsidian-vault`: Strict docs sync rules.
  3. `node-operations`: Local testnet instructions.
  4. `consensus-adversarial-testing`: Templates for Byzantine forks/double-spends.
  5. `code-review-assistant`: PR audit checklists.
  6. *(Autonomously generated by `skill-creator`)* `manage-kovanica-node` and `web-frontend-scripts`.
- **SPV & Finality Bug Fixes**:
  - Fixed SPV `block_filter_basic` deadlock: mapped raw 64-bit addresses into a bounded interval for the Golomb-Rice encoder (tools used: `view_file`, `replace_file_content`, `run_command`).
  - Fixed SPV `header_chain_verification` panic: reversed the sliding window of headers passed to `verify_difficulty` to ensure oldest-first chronological order (tools used: `view_file`, `multi_replace_file_content`, `run_command`).
  - Fixed Ledger `checkpoint_is_stable_across_second_roundtrip` equality failure: explicitly pruned the checkpoint block using `Block::new_pruned_with_vrf` in `write_checkpoint` to ensure byte-slice parity upon restoration without payload bloat (tools used: `view_file`, `grep_search`, `replace_file_content`, `run_command`).

---

*Updated: 2026-08-24 — Stage 3 complete (VRF, P2P hardening, Mempool upgrades); Post-Stage 3 roadmap added; Full testsuite fixes and 5 new Antigravity Skills deployed.*
