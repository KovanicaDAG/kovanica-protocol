# Kovanica Protocol — Bug Bounty Program

**Status**: Draft (P2.3) — **scope must be re-cut before publication**  
**Effective**: Upon publication (target: Q4 2026)  
**Budget**: $10k–$50k initial pool (modest, scalable)  
**Consensus impact**: none (program document)

> > **Consensus decision (ratified 2026-09-25): Kovanica is PoA-only.**
> > Proof-of-Work is being removed from the protocol. See
> > `protocol/docs/RFC-POA-Migration.md` §0 (canonical). Items marked `[TARGET]`
> > are ratified but not yet implemented; `[CURRENT]` items describe shipped code.
>
> **Bounty framing is not weakened by this decision — it is redirected.** See §0.

---

## 0. What the PoA-Only Decision Means for This Program

**PoW is what made block admission permissionless.** Anyone could spend CPU to
enter the DAG; the protocol needed no privileged key set, and admission cost was
self-enforcing. PoA replaces this with a **permissioned** model: block
production is restricted to a small, on-chain-committed authority set.

**Removing PoW removes the protocol's permissionless admission path.** That is a
deliberate governance decision (RFC-POA-Migration §0.5), not a security
improvement, and the bounty program has to be honest about it rather than
quietly re-label PoW bugs as PoA bugs.

### 0.1 New in-scope targets under PoA

These are **new, high-value** bounty targets and are the direct replacement for
the PoW-focused scope:

| Target | Why it matters | Reference |
|--------|----------------|-----------|
| Forging a block `work` value to capture chain selection | Under PoA `work` must equal `POA_NOMINAL_WORK = 1`; if that pin leaks, an authority can unilaterally steer the selected parent of every successor | `Dag::check_poa` / `DagError::PoaWorkMismatch`; this bug class **already occurred once** (RFC-POA §6.1(b)) |
| Forking via non-canonical authority ordering | Two nodes holding the same keys in a different order must compute the same set hash and the same schedule; if they don't, they build different chains and reject each other's blocks | `AuthoritySet::new` sorting; RFC-POA §6.1(a) |
| Producing in a slot you are not scheduled for | Slot/schedule enforcement is the entire admission rule | `active_authority(slot)`, `check_poa` |
| Forging or replaying an `AuthorityUpdateTx` | A forged update silently rewrites who controls the chain | RFC-POA §3; threshold `t` |
| SPV authority-set sync / update-proof forgery | Light clients trust the authority set; a forged proof breaks them | M4 `apply_authority_update` |
| Surviving the PoW removal with a live `pow` / `difficulty` call path | Removal is consensus-critical: an orphan reachable PoW path is a re-admission bug | RFC-POA §0.1 |
| `KOVANICA_CONSENSUS` failing open | An unrecognised value must panic, not silently pick a mode | `consensus_mode_from_env()` |

### 0.2 Removed from scope, and why that is not a coverage gap

`difficulty` retargeting, `pow::meets_target`, and the PoW path of hybrid
admission are `[TARGET]`-removed — there is nothing left to exploit in them once
the code is gone. The bounty covers the **removal**, not the removed thing.

The coverage that PoW used to provide is **not** replaced by "PoA is fine":
under PoW, a bug in the hash-target rule was self-limiting, because no single
miner could profitably build on it. Under PoA there is no such self-limitation,
so consensus bugs in the authority path are more damaging per unit of severity
and deserve the same payout attention.

### 0.3 Governance risk is explicitly not a bug bounty

If `t` authorities collude, or the authority set is captured, that is a
**governance** failure, not a code vulnerability. The rotation *mechanism* is
settled (RFC-POA-Migration §0.7.2); the governance *inputs* are `[OPEN]` there
and cannot be paid out of this pool. Do not accept reports framed as
"the authority set is too small" — set size, threshold and key ceremony are a
governance decision that has not been made yet, and the maintainers should be
asked to make it rather than the bug pool asked to fix it.

### 0.4 Unchanged by the migration

RFC-006 supply math does not move: MAX_SUPPLY **90.2M KVNC**, s₀
**10 KVNC/block**, era **2,050,000 blocks**, α **3/4**, maturity **100 blocks**,
fee split **75% burned / 25% producer**, GHOSTDAG **k=3**, UTXO, Ed25519,
**1 KVNC = 100_000_000 atoms**. The curve is height-indexed and
`cumulative_minted` is capped in `apply_block`, so the cap bug class in §2
stays exactly as written, and remains bounty-eligible.

---

## 1. Scope

### In-Scope (Consensus-Critical)

| Component | Crate | Description |
|-----------|-------|-------------|
| **Consensus Core** | `kovanica-dag` | GHOSTDAG, reachability oracle, difficulty retargeting `[TARGET]`-removed, PoW `[TARGET]`-removed, VRF `[TARGET]`-removed, **PoA authority admission + nominal-work pin `[TARGET]`-required scope** |
| **Ledger/State** | `kovanica-state` | UTXO transitions, transaction validation, **RFC-005 vault/CSV + treasury vaults**, checkpoints, finality. Stake registry + hybrid admission `[TARGET]`-removed (§0.7.1) |
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
| **Critical** | Consensus safety violation: double-spend, chain split, invalid state accepted | GHOSTDAG k-cluster violation, stake registry bypass, value minting, **PoA: forged `work` capturing chain selection, non-canonical authority ordering, forged `AuthorityUpdateTx`** |
| **High** | Consensus liveness violation: chain stall, permanent fork, funds locked | Difficulty retarget break `[TARGET]`-removed, finality pruning corruption, hybrid admission deadlock `[TARGET]`-removed, **PoA: block accepted outside its scheduled slot; `KOVANICA_CONSENSUS` failing open** |
| **Medium** | State divergence: temporary fork, incorrect RPC output, DoS via valid messages | Mempool eviction bug, checkpoint roundtrip failure, P2P ban persistence, **PoA: SPV authority-set update-proof forgery** |
| **Low** | Non-exploitable: info leak, minor logic error, UX bug | Incorrect error message, off-by-one in non-critical path |

**Note on severity under PoA.** The removal of the permissionless admission path
means there is no longer a hash-power market to price an attack against. That
does not lower consensus-bug severity — it removes the attacker's ability to
*buy* the attack. An authority-path consensus bug is a chain split available to
one small, known set of keys, which is a worse position than a PoW-era bug
available to anyone with capital. See §0.

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