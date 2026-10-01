# SW-PoA + SPV Consensus — Canonical Specification

> **Status:** Canonical (ratified 2026-09-25)  
> **Consensus impact:** **consensus-breaking (hard fork)** — block admission changes, genesis reset mandatory  
> **Canonical source:** [RFC-POA-Migration.md](./RFC-POA-Migration.md) §0 (canonical)  
> **Implementation:** M1–M4 ✅ shipped, M5 ✅ shipped, M6 🟡 testing/operational gates  
> **KVP:** KVP-201 (authority set + slot round-robin + authority signature)

---

## One-Line Summary
Replace **both** hybrid PoW+VRF block admission *and* the staked-VRF secondary path with pure **Proof-of-Authority (PoA)**: fixed authority set, slot-based round-robin scheduling, Ed25519 authority signatures on blocks, no permissionless or stake-weighted admission of any kind; keep GHOSTDAG (k=3), UTXO ledger, SPV, pruning, RFC-005 vaults, and all KVP-1xx features intact.

---

## Canonical Decision (§0)

**Kovanica's consensus is PoA-only. Proof-of-Work is being removed from the protocol entirely.**

- **Ratified:** 2026-09-25 by maintainer decision
- **Implementation status:** `[TARGET]` — ratified, not yet implemented
- **Consensus impact:** **consensus-breaking (hard fork)** — block admission changes, so a genesis reset is mandatory (§0.6)
- **Tokenomics unchanged:** MAX_SUPPLY 90.2M KVNC, s₀ 10 KVNC/block, era 2,050,000, α 3/4, maturity 100, fee split 75% burned / 25% producer

### What is removed (full surface, §0.1)
- PoW: `Dag::set_proof_of_work`, `pow` module, `KOVANICA_POW`, mining loop, `KOVANICA_MINE`, `KOVANICA_MINE_SECS`, `protocol/mine-kvnc.sh`
- Difficulty: `Dag::set_difficulty`, `difficulty` module, `Retarget`, `next_work`
- VRF: `vrf` module, `Block` VRF fields, `Dag::set_vrf`, `KOVANICA_HYBRID`
- Hybrid admission: `HybridConfig`, `StakedVrf`, `set_hybrid`, `insert_with_vrf`, `KOVANICA_HYBRID`
- Cargo features: `pow`, `pow-vrf`, `difficulty` → removed; `poa` is the only build

**This is a one-way door (§0.1.1):** Once deleted, there is **no permissionless admission path at all** in the codebase. Restoring one later would be a second consensus-breaking change.

---

## SPV Compatibility (§6)

Authority signatures replace PoW checks; light clients need only genesis authority set + update proofs.

### M4: SPV ✅ **Done**
| Component | Description |
|-----------|-------------|
| `BlockHeader` | Gains `authority_sig` / `authority_set_hash` / `hash_without_authority_sig` |
| `SpvClient::with_poa` + `add_header` | Verify scheduled authority per slot |
| `apply_authority_update` | Validates `AuthorityUpdateTx` + Merkle proof |
| KVLS v2 blob | Carries the PoA config |
| Relay `Headers` message | Encodes the PoA fields |
| FFI `export_light_sync` v2 / `receive_light_sync` / `apply_authority_update` | Light client surface |
| Tests | Live-parity tests `#[ignore]`d pending the PoA reset |

**SPV light clients** sync from genesis, verify authority sigs, process update transactions — **done**.

---

## SW-PoA Consensus Invariants (Hardened in M6)

### 1. Authority Signatures are Binding
- Every block **must** carry a valid Ed25519 signature from the authority scheduled for that slot
- The scheduled authority is `authorities[slot % n]` over the canonical (sorted) key order
- Invalid/missing signature → `DagError::PoaMissingAuthoritySig` / `PoaInvalidAuthoritySig`

### 2. Work is Pinned to Nominal
- Every block **must** carry `work == POA_NOMINAL_WORK = 1`
- `Dag::check_poa` enforces this at admission → `DagError::PoaWorkMismatch`
- Prevents the work-inflation exploit (§6.1(b))

### 3. Slot Clock is Fixed
- `SLOT_DURATION_MS = 3000` (default, `KOVANICA_SLOT_DURATION`)
- No gap-fill: an offline authority yields an **empty slot**; the chain continues on the fixed clock
- No difficulty retarget, no work accumulation race

### 4. Authority Set is Genesis-Fixed + On-Chain Rotatable
- Fixed at genesis, committed as `KVA1 \|\| set_hash` in genesis coinbase
- Rotation **only** by on-chain M-of-N `AuthorityUpdateTx` (threshold `t` of current set)
- No election, no external randomness, no off-chain path
- SPV light clients verify the authority set via `AuthorityUpdateTx` + Merkle proof

### 5. Genesis is Different from PoW
- PoA genesis commits the authority set as a `KVA1`-tagged coinbase output
- Genesis block id differs from the pre-reset PoW genesis
- A PoA chain and a PoW chain **cannot be reconciled** → reset mandatory (§0.6)

---

## SPV Light Client Protocol

### Header Verification (PoA)
```rust
// SpvClient::add_header verifies:
1. Slot number is correct (height / SLOT_DURATION_MS)
2. Active authority = authorities[slot % n]
3. authority_sig verifies against that authority's pubkey
4. Block hash_without_authority_sig matches the header
```

### Authority Update Processing
```rust
// SpvClient::apply_authority_update verifies:
1. AuthorityUpdateTx is well-formed (threshold met, valid signatures)
2. Merkle proof proves the update tx is included in the block
3. New authority set hash = BLAKE3(sorted_new_authorities)
4. Updates local authority set for subsequent slots
```

### KVLS v2 Blob Format
```text
KVLSv2 {
    magic: "KVLS",
    version: 2,
    poa_config: {
        slot_duration_ms: u32,
        authority_set: [AuthorityPubKey; n],
        threshold: u8,
        genesis_set_hash: [u8; 32],
    },
    headers: [PoAHeader; ...],
    filters: [GolombRiceFilter; ...],
}
```

---

## M1–M6 Implementation Status

| Milestone | Status | Key Deliverables |
|-----------|--------|------------------|
| **M1: Core Types** | ✅ | `AuthoritySet`, `AuthorityUpdateTx`, `Block.authority_sig`, `hash_without_authority_sig()` — 21 unit tests |
| **M2: Consensus** | ✅ | `BlockValidator` authority/slot check in `Dag::insert`; `insert_for_replay` skips PoW/VRF — 11 integration tests |
| **M3: Config/Genesis** | ✅ | `KOVANICA_CONSENSUS`, `KOVANICA_SLOT_DURATION`, `KOVANICA_AUTHORITIES`, genesis TOML — 9 node tests |
| **M4: SPV** | ✅ | Header `authority_sig`; light client authority set sync + update proofs — KVLS v2, FFI v2 |
| **M5: RPC/Explorer** | ✅ | Explorer displays authority set, slot, signatures; `staking` RPC |
| **M6: Testing** | 🟡 **Operational gates outstanding** | Code suite done: `tests/poa_m6_testing.rs` (authority update + SPV proof, GHOSTDAG re-org, SPV sync over post-re-org chain — 3 tests green). **Outstanding:** 24h multi-validator soak, resource measurement |

---

## Next Phases of Network Work (Extended)

### Phase 0: PoA Migration Completion (Active)
**Gate:** All code shipped, operational gates only
- [x] **Gate 1:** Real, random testnet authority keys (not `AUTHORITY_PLACEHOLDER_BASE = 9001`) — **COMPLETE 2026-09-26** (keys at `protocol/authority-keys/`, 3 authorities generated)
- [ ] **Gate 2:** 24h multi-validator soak (M6 exit criterion) — **2 validators (seed1, seed2) active; seed3 planned future** — authority failover, slot-clock drift, rotating set over a realistic day
- [x] **Gate 3:** PoA resource footprint measurement — **CLOSED 2026-09-26** (baseline: 112.7 µs/block, +7.4 KiB/block RSS)
- [ ] **Gate 4:** Mainnet key ceremony (independent, blocks mainnet, not testnet reset)

**Activation:** Coordinated testnet reset → PoA genesis → 2-validator soak (seed1, seed2) → seed3 added later

---

### Phase 1: Consensus Hardening & Observability (Post-Reset)
**Goal:** Production-grade consensus layer with full observability
- [ ] **M6 Soak Completion:** 24h multi-validator soak on testnet (3+ independent operators, geographic/ASN diversity)
- [ ] **Adversarial Test Coverage:** Re-establish adversarial tests for PoA (eclipse resistance, authority key compromise, slot grinding)
- [ ] **Metrics Hardening:** Fix `kovanica_peer_count` metric (currently 0), enable DHT/reorg/sync/validation rejection metrics
- [ ] **Prometheus Alerting:** Arm `alerting_rules.yml` (peer count < 2, block-rate drop, reorg depth, mempool/DHT churn)
- [ ] **Fuzz Targets:** Extend `fuzz.rs` for PoA-specific paths (authority sig validation, slot scheduling, update tx processing)

---

### Phase 2: P2P & Network Hardening
**Goal:** Eclipse-resistant, Sybil-resistant, production-grade P2P
- [ ] **DHT Hardening:** 
  - Per-peer rate limits on framed reads
  - Duplicate-block suppression metrics
  - Peer scoring/banning (reward valid blocks +1, penalize duplicates -5, invalid -20)
  - Auto-ban when score ≤ -50
- [ ] **Eclipse Resistance:**
  - Verified handshake exchanges NodeId + address
  - Established contacts claim bucket slots first
  - `Mesh::connect` registers both endpoints as mutual DHT contacts
- [ ] **DNS Seed Diversity:** ≥3 independent operators, ≥2 continents, ≥2 ASNs
- [ ] **Seed Operator Onboarding:** Documented runbook, Discord ops channel, automated backups

---

### Phase 3: Light Client & SPV Ecosystem
**Goal:** Production-grade light clients for mobile/web
- [ ] **KVLS v2 Live Sync:** Enable live-parity tests (currently `#[ignore]`d)
- [ ] **Android LightNode App (Slices 9a–9f):**
  - 9a: Genesis gate ✅ (live genesis verified)
  - 9b: Wallet UX ✅ (onboarding, home, send/receive, history, settings)
  - 9c: Light sync ✅ (KVLS v1 blob, `/api/light_sync`, filter matching)
  - 9d: Staking uplink ✅ (bond/unbond, produce block, submit to `/api/mine/submit`)
  - 9e: WorkManager periodic sync + notifications
  - 9f: Testnet deployment
- [ ] **iOS LightNode:** Staticlib + xcframework build, Swift bindings
- [ ] **Browser Extension:** Web wallet SPV sync (IndexedDB persistence)

---

### Phase 4: Wallet & DeFi Primitives
**Goal:** End-user UX + native DeFi
- [ ] **Web Wallet Custody:** Hardware wallet (Ledger WebHID, Trezor WebUSB) in explorer
- [ ] **BIP39/BIP44 Derivation:** Transaction history, address management
- [ ] **Fee Estimation:** `POST /api/fee_estimate` from mempool p90
- [ ] **HTLC Atomic Swaps (KVP-104):** Web UI for create/verify/redeem/refund
- [ ] **Multisig UI (KVP-101):** Web wallet M-of-N P2SH creation/signing
- [ ] **DeFi MVP (HTLC-first DEX):** Order book on explorers, client-side swap composition
- [ ] **Lending Sketches:** Vault-backed lending (RFC-005 CSV + RFC-004 HTLC)

---

### Phase 5: Mainnet Readiness
**Goal:** All gates green for mainnet launch
- [ ] **MAINNET-CRITERIA.md** gates all verified
- [ ] **Authority Key Ceremony:** Real mainnet authority set frozen (Gate 4)
- [ ] **Security Audit:** External audit (AUDIT-PLAN.md scope)
- [ ] **Legal/Regulatory:** MiCA compliance, HANFA registration, GDPR
- [ ] **Incident Response:** Runbooks, on-call rotation, Discord ops channel
- [ ] **Backup/Restore Drills:** Quarterly automated drills
- [ ] **Disaster Recovery:** Multi-region seed deployment

---

## Configuration Reference (PoA)

```sh
# Participant node (default)
export KOVANICA_LISTEN=0.0.0.0:9000
export KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000
export KOVANICA_CONSENSUS=poa        # default when unset
export KOVANICA_MINE=0
export KOVANICA_FAUCET=0
export KOVANICA_ALLOW_RESET=0
export KOVANICA_OPERATOR=0
export KOVANICA_DATA="$PWD/data"

# Authority node (operator)
export KOVANICA_LISTEN=0.0.0.0:9000
export KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000
export KOVANICA_CONSENSUS=poa
export KOVANICA_AUTHORITIES=<comma-separated-32-byte-hex-pubkeys>
export KOVANICA_AUTHORITY_THRESHOLD=2
export KOVANICA_SLOT_DURATION=3000
export KOVANICA_AUTHORITY_KEY=<32-byte-hex-secret>  # via EnvironmentFile, mode 0600
export KOVANICA_MINE=1          # auto-produce when scheduled
export KOVANICA_FAUCET=1
export KOVANICA_OPERATOR=1
export KOVANICA_DATA=/var/lib/kovanica-seed
```

---

## Testnet Reset Procedure (Mandatory for PoA)

1. **Announce** ≥ 24h before on Discord + docs.kovanica.online
2. **Snapshot** both seeds' `data/` to cold storage
3. **Stop** seed units; delete `KOVANICA_DATA` on both
4. **Deploy** new genesis binary; start seed1, verify `/api/head` genesis hash matches release notes, then start seed2
5. **Verify:** both seeds agree on `/api/head` genesis + block count; pristine clone with `KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000` cold-bootstraps to same tip
6. **Update** `protocol/TESTNET.md` genesis hash and reset date

---

## Authority Key Management

**Rule:** A **public** key set (`KOVANICA_AUTHORITIES`) is safe to commit. A **signing** key (`KOVANICA_AUTHORITY_KEY`) must **never** be committed, pasted, or written into a systemd unit. Put it in a mode-`0600` `EnvironmentFile=`.

### Generate Keys (on the host that will hold the secret)
```sh
cargo run --release --example generate_authority_keys -- \
  --out-dir /etc/kovanica/authority-keys \
  --count 3 \
  --threshold 2 \
  --slot-duration 3000
```

Secrets are written to mode-`0600` files and **never to stdout**.

See [AUTHORITY-KEY-CEREMONY.md](./AUTHORITY-KEY-CEREMONY.md) for full ceremony.

---

## Related Documents
- **RFC-POA-Migration.md** — Canonical PoA-only decision (§0), full removal table, SPV §6, M1–M6 status
- **RFC-006-EmissionCurve.md** — Tokenomics (unchanged by PoA)
- **TESTNET.md** — Complete testnet operational reference
- **OPERATIONS.md** — Seed runbook, deploy pipeline, incident lessons
- **SPEC-INDEX.md** — Specification index with `[CURRENT]`/`[TARGET]` parameters
- **NETWORK.md** — Domain map, DNS, redirect rules
- **MAINNET-CRITERIA.md** — Exit checklist for mainnet launch

---

*Canonical SW-PoA+SPV consensus specification — `protocol/docs/SW-PoA-SPV-CONSENSUS.md`*
*Ratified 2026-09-25 | KVP-201 | GHOSTDAG k=3 | UTXO | Ed25519 | SPV ✅ | M1–M4 ✅ M5 ✅ M6 🟡*