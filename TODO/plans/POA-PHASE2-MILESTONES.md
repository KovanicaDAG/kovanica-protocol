# Phase 2 — Post-Phase 1 Milestone Table (Active)
**Started:** 2026-10-02  
**Entry criteria met:** Gates 2 & 4 closed; RFC-POA-GOVERNANCE drafted; adversarial harness skeleton compiled; protocol cleanup verified; cargo check/test/bench pass.

**Remaining Phase 1 close-outs (non-blocking):**
- M1.3 Adversarial BODIES (assert real rejections for V1–V6) — ~20% complete (skeleton)
- M1.4 RFC-POA-GOVERNANCE review tag [DRAFT → REVIEWED] — 6 selections recorded, committee sign-off pending
- M1.5 Seed3 fail2ban verified (KOVANICA_DATA = /root/kovanica-data, outside git, 0600 keys) — DATA OK
- M1.6 Testnet genesis reset executed (mandatory §0.6) — **NOT EXECUTED** (highest priority; new PoA authority set must become genesis)
- M1.7 Gate 2 soak-snapshot baseline re-captured (old PoW-era baseline obsolete) — **NOT DONE** (must recapture post-reset)

---

## Milestones (Phase 2)

| Milestone | Exit Criteria | Target | Consensus | Status |
|-----------|---------------|--------|-----------|--------|
| M2.1 | Adversarial BODIES filled (V1–V6 assert real rejections) | Week 1 | ledger-safe | OPEN |
| M2.2 | Harness CI integration (run on PR + nightly) | Week 2 | ledger-safe | OPEN |
| M2.3 | Security audit (crypto, P2P, authority keys, replay/DoS) | Week 3 | ledger-safe | OPEN |
| M2.4 | CLI `kovanica-cli` PoA command set complete + `--json` | Week 3 | client-only | OPEN |
| M2.5 | Explorer authority/slot views live on testnet | Week 4 | client-only | OPEN |
| M2.6 | RFC-POA-GOVERNANCE ratified + genesis reset executed | Week 4 | consensus-breaking | BLOCKED on M1.6 |

---

## Critical Path (Phase 2)

M1.6 (genesis reset) → M1.7 (baseline re-capture) → M2.1 (bodies) + M2.4 (CLI) → M2.3 (audit) → M2.6 (ratification)

---

## Gate Dependencies (Verified)

- Gate 2 (soak): [CLOSED] — seed1/seed2/seed3 running; 24h complete
- Gate 4 (ceremony): [CLOSED] — 3 keys at `/root/kovanica-secrets/mainnet-authority-keys/`; threshold=2
- No remaining blocking dependencies for Phase 2 entry.

---

## Risk Register (Updated)

| Risk | Likelihood | Impact | Mitigation | Status |
|------|------------|--------|------------|--------|
| Genesis reset not executed (§0.6 mandatory) | High | Critical | Execute immediately — new authority set required | **OPEN — M1.6** |
| Old soak baseline never re-captured | Medium | High | Re-capture post-reset; discard PoW-era baseline | **OPEN — M1.7** |
| RFC not ratified before mainnet | Medium | High | Committee review scheduled; M2.6 follows M1.6 | **OPEN — M2.6** |
| Adversarial harness never exercises real paths | Low | Medium | Fill BODIES in M2.1; CI in M2.2 | **OPEN — M2.1** |

---

## Consensus Impact Classification

- **Consensus-breaking:** M1.6 (genesis reset), M2.6 (ratification → hard fork)
- **Ledger-safe:** M2.1, M2.2, M2.3
- **Client-only:** M2.4, M2.5

---

Next action: Execute M1.6 (testnet genesis reset with new PoA authority set from `/root/kovanica-secrets/mainnet-authority-keys/`) to unblock M1.7 and M2.6.
