# Kovanica Protocol — Bug Bounty Program

**Status**: Draft (P2.3)  
**Effective**: Upon publication (target: Q4 2026)  
**Budget**: $10k–$50k initial pool (modest, scalable)

---

## 1. Scope

### In-Scope (Consensus-Critical)

| Component | Crate | Description |
|-----------|-------|-------------|
| **Consensus Core** | `kovanica-dag` | GHOSTDAG, reachability oracle, difficulty retargeting, PoW, VRF |
| **Ledger/State** | `kovanica-state` | UTXO transitions, transaction validation, stake registry, hybrid admission, checkpoints, finality |
| **Node RPC** | `kovanica-node` | Line RPC commands, block production, mempool, P2P gossip, snapshot/checkpoint I/O |

### In-Scope (High Impact)
- Cryptographic primitives (Ed25519, BLAKE3, ECVRF)
- Serialization/deserialization (block payloads, transactions, checkpoints)
- P2P message handling (rate limits, duplicate suppression, peer scoring)
- SPV light-sync (KVLS blobs, Golomb-Rice filters, Merkle proofs)

### Out of Scope
- `kovanica-ffi` / UniFFI bindings (mobile)
- `kovanica-cli` (CLI tooling)
- `android-light-node` (mobile app)
- `kovanica-web` (frontend)
- Infrastructure (VPS, Cloudflare, DNS seeds, seed nodes)
- Denial-of-service on public testnet endpoints (rate-limited by design)
- Social engineering / phishing
- Issues requiring physical access

---

## 2. Severity Classification

| Severity | Definition | Example |
|----------|------------|---------|
| **Critical** | Consensus safety violation: double-spend, chain split, invalid state accepted | GHOSTDAG k-cluster violation, stake registry bypass, value minting |
| **High** | Consensus liveness violation: chain stall, permanent fork, funds locked | Difficulty retarget break, finality pruning corruption, hybrid admission deadlock |
| **Medium** | State divergence: temporary fork, incorrect RPC output, DoS via valid messages | Mempool eviction bug, checkpoint roundtrip failure, P2P ban persistence |
| **Low** | Non-exploitable: info leak, minor logic error, UX bug | Incorrect error message, off-by-one in non-critical path |

---

## 3. Payouts (USD, paid in KVNC at market rate or stablecoin)

| Severity | Base Payout | Max Payout |
|----------|-------------|------------|
| **Critical** | $3,000 | $15,000 |
| **High** | $1,000 | $5,000 |
| **Medium** | $300 | $1,500 |
| **Low** | $50 | $300 |

**Multipliers**:
- +50%: Includes working exploit / PoC
- +25%: Includes fix / PR
- 2x: First report of a vulnerability class (e.g., first GHOSTDAG bug)

**Cap**: $25,000 per report, $50,000 per program year

---

## 4. Exclusions (No Payout)

- Issues in out-of-scope components
- Theoretical attacks without practical exploit path
- Reports already known internally (check GitHub Issues first)
- Reports from team members / contractors
- Vulnerabilities in dependencies (report upstream)
- Configuration / deployment issues (not code)
- Spam / duplicate / low-effort reports

---

## 5. Safe Harbor

**We authorize good-faith security research on the Kovanica Protocol codebase and testnet.**

You may:
- Test against public testnet (`seed.kovanica.online:9000`, `explorer.kovanica.online`)
- Run local nodes with modified code
- Analyze source code for vulnerabilities
- Submit findings via the channel below

You must NOT:
- Attack third-party infrastructure (VPS, Cloudflare, DNS)
- Disrupt testnet for other users (no DoS, no spam)
- Access or attempt to access private keys / seed phrases
- Publish findings before coordinated disclosure (90 days)
- Extort or threaten

**We will not pursue legal action** against researchers who:
- Follow this policy
- Report via the official channel
- Allow 90 days for fix before public disclosure
- Act in good faith

---

## 6. Submission Channel

**Primary**: GitHub Security Advisories (private)
- Go to: `https://github.com/KovanicaDAG/kovanica-protocol/security/advisories/new`
- Select "Report a vulnerability"
- Fill in details, mark severity

**Backup**: Email `security@kovanica.online` (PGP key: `0x...` — to be published)

**Required in report**:
1. Vulnerability description
2. Affected component(s) and file(s)
3. Steps to reproduce / PoC
4. Impact assessment (safety / liveness / funds)
5. Suggested fix (optional but rewarded)

---

## 7. Response Timeline

| Step | Target |
|------|--------|
| Acknowledgment | 48 hours |
| Triage (severity + scope) | 5 business days |
| Fix development | Critical: 14 days / High: 30 days / Medium: 60 days |
| Coordinated disclosure | 90 days from report (or sooner if fixed) |
| Payout | Within 14 days of fix merge |

---

## 8. Hall of Fame

| Researcher | Vulnerability | Severity | Date |
|------------|---------------|----------|------|
| — | — | — | — |

*To be populated after first valid reports.*

---

## 9. Program Updates

- Payouts may increase with mainnet launch
- Scope expands with new consensus features
- Updates announced via GitHub Discussions + Discord

---

*Related: [AUDIT-PLAN.md](./AUDIT-PLAN.md) · [LEGIT-BOARD.md](./LEGIT-BOARD.md) · [SECURITY.md](./SECURITY.md) (to be created)*