# PoA Phase 1 — Governance, Adversarial Tests, CLI/TUI/Web
**Status:** Planning — created 2026-10-02  
**Prerequisites:** PoA code removal complete (§0.1, §0.7.1), B1–B5 resolved (§0.9.1)  
**Gate dependencies:** Authority governance (items 1,3) → Gate 1 & 4; Adversarial tests → Gate 2; CLI/TUI → Phase 4 SPV wallet

---

## Track 1: Authority Set Governance (§0.7.2 items 1–6)

### Deliverables
| ID | Deliverable | Type | Consensus impact |
|----|-------------|------|------------------|
| G1 | **RFC-POA-GOVERNANCE** (KVP-202) | Decision document | **consensus-breaking** (sets mainnet genesis params) |
| G2 | Design analysis + options matrix | Analysis | Informational |
| G3 | Code stubs: governance hooks | Implementation | `ledger-safe` (on-chain mechanism exists; config only) |
| G4 | Testnet key ceremony procedure | Ops doc | Operational |
| G5 | Mainnet key ceremony procedure | Ops doc | Operational |

### §0.7.2 Items — Decision Matrix

| # | Item | Options | Recommendation | Status |
|---|------|---------|----------------|--------|
| 1 | **Initial mainnet authority set selection** | A) Maintainer-appointed (3–4 keys)<br>B) Public ceremony with known entities<br>C) Stake-weighted election (requires hybrid)<br>D) Invitation + multi-sig attestation | **B** — transparent, auditable, matches §0.5 social trust model | `[OPEN]` |
| 2 | **Eligibility & nomination** | A) Any Ed25519 key holder<br>B) KYC'd entities only<br>C) Prior testnet operators<br>D) Mix: core team + invited operators | **D** — core team (3) + 1–2 invited testnet operators | `[OPEN]` |
| 3 | **Key ceremony (generation, custody, multi-sig)** | A) `generate_authority_keys` writes 0600 files (PR #53)<br>B) External HSM / hardware signer<br>C) Threshold key generation (FROST)<br>D) Split: generation offline, custody per-operator | **A + D** — offline generation, per-operator custody, PR #53 pattern | `[OPEN]` |
| 4 | **Threshold `t` per set** | A) `t = ceil(2n/3)` (Byzantine fault tolerance)<br>B) `t = n-1` (strict majority, current default)<br>C) `t = n/2 + 1` (simple majority)<br>D) Configurable per `AuthorityUpdateTx` | **A** — BFT standard, `n≤16` cap means `t≤11` | `[OPEN]` |
| 5 | **Expansion from launch toward `n≤16`** | A) Fixed at launch size (no expansion)<br>B) Add 1 authority per `AuthorityUpdateTx` (slow)<br>C) Epoch-based expansion (e.g., +2/year)<br>D) Governance proposal + threshold vote | **B** — conservative, each addition requires `t` signatures | `[OPEN]` |
| 6 | **Dissolution / recovery if `t` lost/collude** | A) No recovery (current — SPF)<br>B) Emergency multisig (maintainer keys)<br>C) Social fork + new genesis<br>D) Time-locked recovery vault (RFC-005) | **D** — RFC-005 vault with `t`-of-`n` recovery keys, time-locked | `[OPEN]` |

### Milestones

| Milestone | Exit Criteria | Target |
|-----------|---------------|--------|
| M1.1 | Options matrix reviewed, recommendations recorded | Week 1 |
| M1.2 | RFC-POA-GOVERNANCE v0.1 drafted (KVP-202) | Week 2 |
| M1.3 | Code stubs: `AuthorityGovernance` trait + config hooks | Week 2 |
| M1.4 | Testnet ceremony procedure written + dry-run | Week 3 |
| M1.5 | RFC ratified, mainnet ceremony procedure finalized | Week 4 |

### Risks
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| No recovery path (item 6) blocks mainnet | High | Critical | Prioritize RFC-005 vault recovery design |
| Ceremony key leakage (PR #53 stdout issue) | Medium | Critical | Enforce 0600 file output before ceremony |
| Threshold `t` too high → liveness failure | Medium | High | Model `t = ceil(2n/3)` with `n=4` → `t=3` |
| Governance capture (item 2 eligibility) | Medium | High | Document nomination process transparently |

---

## Track 2: Adversarial Test Re-establishment (§0.7.3)

### Attack Vectors (6 total)

| Vector | Description | PoA-specific? | Priority |
|--------|-------------|---------------|----------|
| V1: `wrong_producer` | Valid sig from authority not scheduled for slot | Yes | P0 |
| V2: `double_sign` / slot violation | Same authority signs two blocks in one slot | Yes | P0 |
| V3: `stale_slot` | Block with timestamp from past/future slot | Yes | P1 |
| V4: `missing_authority_sig` | Block lacks authority signature | Yes | P0 |
| V5: `work_inflation` | Block claims `work != POA_NOMINAL_WORK` (regression for §6.1(b)) | Yes | P0 |
| V6: `authority_update_abuse` | Malformed/wrongly-thresholded/replayed `AuthorityUpdateTx` | Yes | P1 |

### Deliverables
| ID | Deliverable | Location |
|----|-------------|----------|
| A1 | Test harness: `poa_adversarial.rs` (new test binary) | `kovanica-node/tests/` |
| A2 | Vector implementations (V1–V6) | `kovanica-node/tests/poa_adversarial/` |
| A3 | Property-based fuzzing for authority sig validation | `kovanica-node/tests/poa_fuzz.rs` |
| A4 | CI integration (run on PR + nightly) | `.github/workflows/` |
| A5 | Coverage report showing PoA adversarial parity with old challenger_* | `docs/ADVERSARIAL-COVERAGE.md` |

### Milestones

| Milestone | Exit Criteria | Target |
|-----------|---------------|--------|
| M2.1 | Harness compiles, runs against local PoA node | Week 1 |
| M2.2 | V1, V2, V4, V5 implemented + passing (adversarial asserts) | Week 2 |
| M2.3 | V3, V6 implemented + passing | Week 3 |
| M2.4 | Property-based fuzzing + CI integration | Week 4 |
| M2.5 | Coverage doc: PoA adversarial ≥ old mining challenger_* | Week 4 |

### Risks
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Test environment complexity (multi-authority) | Medium | Medium | Use `genesis_poa` + simulated authority set |
| False positives from slot timing | Medium | Low | Deterministic slot clock in test harness |
| Missing client-surface coverage (FFI) | Medium | High | Include FFI send paths (lesson from §0.10) |

---

## Track 3: CLI/TUI/Web + Security Audit + RFC Authoring

### Deliverables

| Area | Items | Status |
|------|-------|--------|
| **CLI/TUI** | `kovanica-cli` PoA commands (`genesis_poa`, `authority_key`, `authority_update`, `produce`) | `[OPEN]` |
| **CLI/TUI** | Interactive REPL with slot-aware produce | `[OPEN]` |
| **CLI/TUI** | `--json` output for all commands | `[OPEN]` |
| **Web: Explorer** | Authority set view, slot schedule, signature verification | `[OPEN]` |
| **Web: Wallet** | Broadcast-only mode (submit to authority, poll inclusion) | `[OPEN]` |
| **Web: Map** | Authority node geo-visualization | `[OPEN]` |
| **Security Audit** | Crypto correctness (Ed25519, BLAKE3, GHOSTDAG) | `[OPEN]` |
| **Security Audit** | P2P trust boundary (seed policy, eclipse resistance) | `[OPEN]` |
| **Security Audit** | Authority key handling (env var, memory, external signer) | `[OPEN]` |
| **Security Audit** | Replay/DoS (nominal work pin, authority sig verification) | `[OPEN]` |
| **RFC Authoring** | RFC-POA-GOVERNANCE (KVP-202) | `[OPEN]` |
| **RFC Authoring** | RFC-007 / KVP-106 (NFT) — client-only | `[OPEN]` |
| **RFC Authoring** | RFC-008 (Oracle Pruning) — activate | `[OPEN]` |

### Milestones

| Milestone | Exit Criteria | Target |
|-----------|---------------|--------|
| M3.1 | `kovanica-cli` PoA command set complete + `--json` | Week 2 |
| M3.2 | Explorer authority/slot views live on testnet | Week 3 |
| M3.3 | Wallet broadcast-only mode designed + prototype | Week 4 |
| M3.4 | Security audit report (4 areas) delivered | Week 5 |
| M3.5 | RFC-POA-GOVERNANCE + RFC-007 published to docs.kovanica.online | Week 5 |

### Risks
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Wallet broadcast-only needs authority RPC endpoint | High | High | Design `/api/submit` + polling before implementation |
| Security audit scope creep | Medium | Medium | Time-box each area; use checklist from `kovanica-security` skill |
| CLI/TUI UX inconsistency | Low | Medium | Apply `kovanica-cli-ux` skill patterns throughout |

---

## Cross-Track Dependencies

| Dependency | From | To | Resolution |
|------------|------|----|------------|
| Governance threshold `t` | Track 1 (G1) | Track 2 (A6) | Adversarial test uses ratified `t` |
| Testnet ceremony keys | Track 1 (G4) | Track 2 (A1) | Adversarial tests use real ceremony keys |
| CLI `authority_update` | Track 3 (CLI) | Track 1 (G3) | CLI exercises governance hooks |
| Security audit on authority keys | Track 3 (Audit) | Track 1 (G3) | Audit informs key handling design |

---

## Resource Allocation (Suggested)

| Track | Primary | Reviewer | Notes |
|-------|---------|----------|-------|
| 1 Governance | `docs-writer` + `oracle` | `reviewer` + `security-audit` | Consensus-breaking — highest review bar |
| 2 Adversarial | `security-audit` + `fixer` | `reviewer` | Must achieve parity with old challenger_* |
| 3 CLI/TUI/Web | `cli-tui-dev` + `explorer-web` | `deploy-ops` | Web surfaces deploy via pm2 |

---

## Definition of Done (Phase 1 Complete)

- [ ] RFC-POA-GOVERNANCE (KVP-202) ratified and published
- [ ] Testnet key ceremony executed (Gate 1 closed)
- [ ] 24h multi-validator soak on real keys passes (Gate 2 closed)
- [ ] Adversarial test suite passes in CI (V1–V6)
- [ ] `kovanica-cli` PoA command set complete
- [ ] Explorer authority/slot views live
- [ ] Security audit report delivered with 0 critical findings
- [ ] Mainnet key ceremony procedure documented (Gate 4 ready)

---

## Next Actions (This Session)

1. **Draft RFC-POA-GOVERNANCE v0.1** (Track 1, M1.2)
2. **Create adversarial test harness skeleton** (Track 2, M2.1)
3. **Audit `kovanica-cli` for PoA command gaps** (Track 3, M3.1)

Shall I start with the RFC draft and test harness in parallel?