# Kovanica Security Notes (PoA Threat Model)

**Version:** 1.0 (PoA-only consensus, RFC-POA §0.5)
**Audience:** Operators, auditors, developers, external integrators

---

## 1. What PoA + GHOSTDAG k=3 Protect

| Property | Mechanism | Notes |
|----------|-----------|-------|
| **Chain ordering** | GHOSTDAG k=3 | Honest majority of blocks by blue score; forks ≤ k blocks reorg naturally |
| **Block validity** | Authority signatures | Every block signed by scheduled authority; invalid sig = immediate rejection |
| **Emission schedule** | Height-indexed (RFC-006) | s₀=10 KVNC, era=2M blocks, α=¾; MAX_SUPPLY 90.2M KVNC hard cap |
| **Coinbase maturity** | 100 blocks | Enforced in UTXO selection; immature coinbases unspendable |
| **Fee burn** | 75% burned, 25% to producer | Hardcoded in `apply_block`; cannot be changed without hard fork |

---

## 2. What PoA Does **NOT** Protect Against

| Threat | Why | Mitigation |
|--------|-----|------------|
| **Majority authority collusion** (≥ t of n) | Authority set is permissioned; t signers can produce any block, rotate the set, censor | Social: small n (3–16), known operators, on-chain rotation transparency |
| **Single authority key compromise** | One key = one slot; compromised key signs valid blocks for its slots | Operational: HSM, offline backup, key rotation via `AuthorityUpdateTx` |
| **Offline authority (liveness)** | No gap-fill: missing slot = no block, no coinbase, no fee collection | Operational: monitoring, alerting, ≥ 3 authorities with geographic diversity |
| **Sybil on P2P layer** | Authority set admission is on-chain; P2P is unauthenticated gossip | Eclipse resistance: ≥ 3 seed nodes, grey-cloud DNS seeds, outbound peer diversity |
| **Permissionless admission** | **Removed** (PoW/hybrid deleted). No open entry to become authority. | Governance: `AuthorityUpdateTx` with ≥ t sigs is the only path |

---

## 3. Key Handling

### 3.1 Authority Signing Keys (Consensus-Critical)
- **One key per authority** — held by that operator only
- **Never shared, never on disk unencrypted** — use HSM, systemd Credentials, or operator prompt at boot
- **Distinct from treasury vault keys** — RFC-005 vault keys (`TREASURY_SEED`) guard funds; authority keys guard consensus
- **Rotation** — via on-chain `AuthorityUpdateTx` requiring ≥ t sigs from current set

### 3.2 Wallet/Client Keys (User Funds)
- **Stay client-side** — mobile wallet (FFI), browser wallet, CLI all derive from user seed
- **Never enter the node** — node only sees signed transactions
- **BIP39 mnemonic optional** — CLI supports 24-word recovery

### 3.3 Seed Keys (Operator Infrastructure)
- `KOVANICA_TREASURY_SEED` — 64 hex, required on mainnet, derives treasury vault keys
- `KOVANICA_AUTHORITY_KEY` — 64 hex, this operator's consensus signing key
- `KOVANICA_AUTHORITIES` — comma-separated public keys (not secrets)

---

## 4. Threat Model: Attacker Capabilities

| Attacker Type | Can Do | Cannot Do (without key) |
|---------------|--------|-------------------------|
| **Network observer** | See all blocks, txs, addresses | Forge authority signatures, reorg past finality |
| **P2P peer** | Eclipse a node, withhold blocks | Produce valid blocks, change authority set |
| **Single authority** | Sign blocks for own slots, propose `AuthorityUpdateTx` | Sign for other slots, rotate set alone (needs ≥ t) |
| **≥ t authorities** | Full control: any block, any set rotation, censorship | Break RFC-006 tokenomics (cap, emission, burn) |
| **User with funds** | Send, receive, create HTLC/vault/multisig | Spend others' coins, forge signatures |

---

## 5. Operational Security

### 5.1 Node Hardening
- `MemoryMax=6G` (or higher) cgroup limit — replay memory bug exists
- `RestartSec=30` — prevent OOM restart storms
- `LimitNOFILE=65536` — handle peer connections
- Run as non-root user, minimal capabilities

### 5.2 Seed Node Policy
- **3–4 geographically distributed seeds** (grey-cloud DNS, not orange-cloud)
- **Each seed runs exactly one authority** — never multiple on one host
- **Outbound peer diversity** — connect to ≥ 2 seeds + random peers

### 5.3 Monitoring & Alerting
- Block production: alert if no block for > 2× slot duration (6s)
- Authority set: alert on `AuthorityUpdateTx` (check signatures)
- Peer count: alert if < 2 peers
- Memory: alert if > 80% of `MemoryMax`

---

## 6. Incident Response

| Incident | Detection | Response |
|----------|-----------|----------|
| **Authority key compromise** | Unusual blocks from that authority | 1. Other authorities propose `AuthorityUpdateTx` replacing compromised key<br>2. ≥ t sigs required<br>3. Compromised operator generates new key offline |
| **Authority offline** | Missing slots, alerts | 1. Contact operator<br>2. If prolonged, propose `AuthorityUpdateTx` replacing |
| **P2P eclipse** | Peer count drops, sync stalls | 1. Restart node (new peer selection)<br>2. Verify seed DNS resolves correctly |
| **Replay OOM** | `MemoryMax` hit, restart loop | 1. Increase `MemoryMax` temporarily<br>2. Track as Phase-1 footprint fix |

---

## 7. Audit Scope

**In scope for consensus audit:**
- `kovanica-dag` — GHOSTDAG k=3, PoA admission, authority set logic
- `kovanica-state` — UTXO ledger, RFC-001..005, `apply_authority_update`
- `kovanica-node` — RPC surface, `genesis_poa`, `authority_update`, block production

**Out of scope:**
- Web explorer, wallet UI, mobile apps
- P2P gossip (standard TCP 9000, no encryption)
- Key generation ceremony (operational, not code)

---

## 8. Reporting

**Security contact:** `security@kovanica.online` or GitHub Security Advisories

**Disclosure policy:** 90-day coordinated disclosure for consensus-critical issues; no bounty program yet (see `BUG-BOUNTY.md` when published).
