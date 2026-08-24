# E2E Test Infra: Kovanica SPV Wire Protocol

## Test Philosophy
- Opaque-box, requirement-driven: test against user specifications and network wire protocols over real TCP sockets.
- Comprehensive 4-Tier + Tier 5 Adversarial testing methodology.

## Feature Inventory
| # | Feature | Source | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---------|--------|:------:|:------:|:------:|:------:|
| 1 | SPV Wire Messages (`getheaders`, `headers`, `getblocks`, `merkleblock`) | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 2 | Full Node SPV Serving | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 3 | Light Client Header Sync over TCP | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 4 | Merkle Proof Request & Verification | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 5 | Difficulty Retargeting Bounds Enforcement | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 6 | Wall-Clock Future Drift Limits ($\le 2\text{h}$) | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- Test Suite Location: `crates/kovanica-node/tests/spv_sync.rs`
- Runner: `cargo test -p kovanica-node --test spv_sync`
- Network: Real TCP loopback connections (`127.0.0.1:0`), ephemeral ports, bounded timeouts (`set_read_timeout(2s)`).
- Clocks: Pinned deterministic clocks using `node.set_now_ms(...)`.

## Test Tier Coverage
- **Tier 1 - Feature Coverage**:
  1. Wire message serialization/deserialization for all SPV message variants.
  2. Single header response over TCP.
  3. Batch headers response with locator pagination.
  4. Merkle proof generation and inclusion verification.
  5. `merkleblock` wire exchange and verification.
- **Tier 2 - Boundary & Corner Cases**:
  1. Empty DAG / genesis-only header sync.
  2. Maximum batch size limits (`MAX_HEADERS = 10_000`, frame limit `MAX_FRAME = 4MB`).
  3. Wall-clock future drift exact boundary (`now + 2h` accepted, `now + 2h + 1ms` rejected).
  4. Difficulty retargeting clamp limits ($4\times$ upward clamp, $1/4\times$ downward clamp).
  5. Single-transaction block Merkle proof vs multi-transaction odd/even leaf counts.
  6. Non-existent transaction / non-existent block Merkle proof requests.
- **Tier 3 - Cross-Feature Combinations**:
  1. Multi-block header chain sync followed by selective Merkle proof verification for specific txs over the same TCP session.
  2. Concurrent light clients querying full node simultaneously.
  3. Dynamic block production while SPV client performs incremental sync.
  4. DAG fork / alternative tip header sync.
- **Tier 4 - Real-World Application Scenarios**:
  1. Mobile wallet payment receipt: light client syncs 100 headers with $>90\%$ bandwidth reduction vs full block sync, receives payment, requests and validates Merkle proof.
  2. Adversarial tampering detection: full node serves altered transaction or invalid Merkle branch, SPV client detects fraud and rejects proof.
  3. Far-future time-warp attack: malicious peer advertises headers with future timestamps $>2\text{h}$, SPV client rejects headers and terminates sync.
- **Tier 5 - Adversarial Coverage Hardening**:
  - Code-coverage audit, fuzzing malformed wire payloads, edge-case race conditions in TCP buffers.
