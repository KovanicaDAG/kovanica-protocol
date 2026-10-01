# Kovanica Protocol — Entity & Legal Blurb

**Status**: Draft (P2.5)  
**Purpose**: Public disclosure of who maintains the reference implementation, jurisdiction, and appropriate disclaimers.

---

## 1. Maintainer Identity

**Kovanica Protocol** is an open-source distributed ledger protocol developed by a distributed team of contributors. The reference implementation (`kovanica-protocol`, `kovanica-node`, `kovanica-web`) is maintained by:

| Role | Identity |
|------|----------|
| **Protocol Architect** | [Name / Handle] — lead design of GHOSTDAG consensus, UTXO ledger, hybrid PoW/VRF admission |
| **Core Engineers** | [Names / Handles] — Rust implementation, consensus, networking, FFI |
| **Operations** | [Names / Handles] — seed nodes, monitoring, deployments |

> **Note**: This project has no corporate entity, foundation, or legal wrapper at this time. Maintenance is performed by individual contributors. A legal entity (e.g., non-profit foundation) may be established prior to mainnet.

**Contact**: 
- GitHub: `https://github.com/KovanicaDAG`
- Discussions: `https://github.com/KovanicaDAG/kovanica-protocol/discussions`
- Security: `security@kovanica.online` (or GitHub Security Advisories)

---

## 2. Jurisdiction

**Primary jurisdiction**: **None / Decentralized**.

- No incorporated entity owns the protocol or reference implementation
- Contributors operate from multiple jurisdictions (EU, US, others)
- Code is licensed under **MIT OR Apache-2.0** (dual license, see `LICENSE-MIT` / `LICENSE-APACHE`)
- Testnet infrastructure (seed nodes, explorer) hosted on commodity VPS providers (Hostinger, AWS) under standard ToS

**Implication**: There is no central party to sue, regulate, or compel. The protocol is software — users run it at their own risk.

---

## 3. Disclaimers (Required on All Public Surfaces)

### Footer / Global Disclaimer
> **Kovanica Protocol is experimental testnet software. Use at your own risk. No guarantees of security, stability, or fitness for any purpose. Funds can be lost. This is not investment advice. KVNC on testnet has no monetary value.**

### Per-Page Disclaimers

| Page | Additional Disclaimer |
|------|----------------------|
| **Explorer / Wallet** | "Testnet KVNC (tKVNC) has no value. Do not send real funds. Wallet keys are stored locally in your browser — we cannot recover them." |
| **Faucet** | "Testnet faucet dispenses tKVNC only. No real currency exchanged. Rate limits apply." |
| **Docs / Specs** | "Specifications describe intended behavior. Implementation may differ. Audit not yet complete." |
| **Roadmap** | "Roadmap items are intentions, not promises. Timelines may change. Mainnet launch requires criteria in MAINNET-CRITERIA.md." |
| **Downloads / Releases** | "Binaries are provided as-is. Verify SHA256SUMS. Reproducible builds documented in REPRODUCIBLE-BUILDS.md." |

### Investment Language Prohibition
**Never use** on any official channel (site, docs, Discord, Twitter/X, GitHub):
- ❌ "Invest in KVNC"
- ❌ "KVNC will go up"
- ❌ "Early adopters profit"
- ❌ "Guaranteed returns"
- ❌ "Token sale", "ICO", "IEO", "IDO"
- ❌ "Buy now", "HODL", "to the moon"
- ❌ Any implication of financial return

**Always use**:
- ✅ "Testnet KVNC (tKVNC) has no monetary value"
- ✅ "Run a node to help test the network"
- ✅ "Earn testnet pulses by recording your origin"
- ✅ "Participate in consensus via staking (testnet only)"

---

## 4. Testnet vs Mainnet Distinction

| Aspect | Testnet (Current) | Mainnet (Future) |
|--------|-------------------|------------------|
| **Token** | tKVNC (no value) | KVNC (if launched) |
| **Chain** | `kovanica-testnet` | `kovanica-mainnet` (new genesis) |
| **Reset policy** | On wire-format bumps or safety incidents | Immutable after launch |
| **Faucet** | Open, rate-limited | None |
| **Disclaimer** | "No value, expect resets" | "Real value, real risk" |

---

## 5. Intellectual Property

- **Code**: MIT OR Apache-2.0 (permissive, commercial-friendly)
- **Specs (KVP/RFC/WHAT-IS/TOKENOMICS)**: CC-BY-4.0 (attribution required)
- **Brand assets** (`brand/`, logos): All rights reserved — do not use for derivative projects without permission
- **Name "Kovanica"**: Serbo-Croatian for "coin/mint" — descriptive term, not trademarked

---

## 6. Data & Privacy

- **No telemetry** in node software (metrics are opt-in, local Prometheus only)
- **No accounts, no emails, no KYC** — protocol is permissionless
- **Explorer** shows public blockchain data only (addresses, txs, blocks)
- **Wallet** keys never leave user's browser/device
- **Discord** (community): Standard Discord privacy policy applies

---

## 7. Export Controls

- Cryptography: Ed25519 (signatures), BLAKE3 (hashing), ECVRF (VRF) — all open standards, no restricted algorithms
- No sanctions-list screening in protocol (permissionless)
- Operators responsible for local compliance

---

## 8. Legal Foundation — Next Steps

### 8.1 Entity options

| Option | Jurisdiction | Cost | Timeline | Pros | Cons |
|--------|-------------|------|----------|------|------|
| **Foundation** | Switzerland (CHE) | ~$10k | 3-6 months | Credible, non-profit, token-agnostic | Expensive, complex |
| **Foundation** | Cayman Islands | ~$15k | 3-6 months | Tax-neutral, crypto-friendly | Expensive, complex |
| **LLC** | Wyoming (USA) | ~$500 | 1-2 weeks | Cheap, fast, US-based | Less credible for token projects |
| **DAO LLC** | Marshall Islands | ~$1k | 2-4 weeks | DAO-friendly, flexible | Less established |
| **Association** | Estonia | ~$500 | 2-4 weeks | EU-based, e-Residency | Limited token experience |

### 8.2 Recommended path

**Phase 1 (now → Q1 2027):**
- [ ] Form Wyoming LLC or Marshall Islands DAO LLC as interim entity
- [ ] Open bank account for the entity
- [ ] Establish basic governance (multi-sig, operating agreement)

**Phase 2 (Q2 2027 → mainnet):**
- [ ] Form Switzerland or Cayman Foundation
- [ ] Transfer IP and assets to Foundation
- [ ] Establish token holder governance
- [ ] Hire legal counsel for token classification

**Phase 3 (mainnet+):**
- [ ] Token listing on exchanges
- [ ] Compliance with relevant jurisdictions
- [ ] Insurance and audits

### 8.3 Immediate actions

1. **Decide on entity type** — LLC vs Foundation vs DAO LLC
2. **Choose jurisdiction** — Wyoming, Marshall Islands, Estonia, Switzerland
3. **Prepare documents** — Operating agreement, governance structure
4. **Open bank account** — For receiving funds and paying contributors
5. **Trademark** — File for "Kovanica" trademark in key jurisdictions

### 8.4 Governance

- **Multi-sig wallet** — 3-of-5 or 4-of-7 for treasury
- **Operating agreement** — Decision-making process, dispute resolution
- **Token holder voting** — For protocol upgrades and treasury spending
- **Transparency** — Regular financial reports, public treasury

---

## 9. Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-09-16 | Initial draft |
| 0.2 | 2026-09-29 | Added legal foundation next steps |

---

*Related: [LEGIT-BOARD.md](./LEGIT-BOARD.md) · [MAINNET-CRITERIA.md](./MAINNET-CRITERIA.md) · [SECURITY.md](./SECURITY.md) (to be created)*