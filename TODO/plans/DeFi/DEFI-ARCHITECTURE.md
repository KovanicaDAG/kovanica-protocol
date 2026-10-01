# DeFi Architecture — Kovanica Protocol

**Document:** DEFI-ARCHITECTURE  
**Date:** 2026-09-17  
**Status:** Draft

## 1. Design Philosophy

Kovanica is a **UTXO BlockDAG**. DeFi must respect that model:

- No global mutable contract state
- No reentrancy
- No automatic compound interest on-chain
- Every “contract” is a script locked UTXO (or set of UTXOs)
- Settlement is atomic via HTLC or multisig + time-locks

The architecture deliberately separates:

| Layer | Responsibility | On-chain? |
|-------|----------------|-----------|
| Consensus / Ledger | Ownership, conservation, script validation | Yes |
| Settlement | HTLC claim/refund, vault release | Yes |
| Matching / Discovery | Order books, RFQ, price feeds | No |
| Indexing / UX | Explorer, wallet, analytics | No |
| Legal / Custody | RWA title, KYC, real-world enforcement | No |

## 2. Core Building Blocks

```
┌─────────────────────────────────────────────────────────────┐
│                     Off-chain Layer                         │
│  Order book / RFQ  ·  Oracle  ·  Matcher  ·  Indexer        │
└──────────────────────────┬──────────────────────────────────┘
                           │ offers, hashes, preimages
┌──────────────────────────▼──────────────────────────────────┐
│                     Settlement Layer                        │
│  HTLC (KVP-104)  ·  Multisig (KVP-101)  ·  Vault (KVP-105)  │
└──────────────────────────┬──────────────────────────────────┘
                           │ signed txs
┌──────────────────────────▼──────────────────────────────────┐
│                   Ledger (UTXO + GHOSTDAG)                  │
│         KVP-102 multi-asset  ·  Ed25519  ·  script v2       │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 Atomic Swap (HTLC) — primary DEX primitive

Two parties lock assets of different `asset_id`s.  
Claim requires preimage; refund after timeout.

Supports:
- KVNC ↔ any KVP-102 token
- Token ↔ Token
- RWA / NFT ↔ fungible (once RFC-007 lands)

### 2.2 Escrow / Lending

- Borrower locks collateral into a KVP-105 vault or multisig
- Lender sends principal
- Release conditions: time, multisig signatures, or HTLC-style hash

### 2.3 Issuance & Stable assets

- Controlled mint of KVP-102 assets by issuer multisig
- Off-chain collateral / attestation (RWA path)
- Redemption = burn + off-chain settlement

## 3. Non-Goals (v1)

- On-chain AMM with continuous reserves (possible later via batch settlement)
- Automated liquidations without off-chain agent
- Protocol-enforced interest rates
- Cross-chain bridges that require new consensus rules
- Governance that can change consensus parameters

## 4. Security Model

| Threat | Mitigation |
|--------|------------|
| Preimage reuse | Wallet must generate unique secrets per swap |
| Timeout griefing | Conservative timeouts based on k=3 + observed block rate |
| Script malleability | Strict script templates + sighash rules |
| Issuer key compromise | Force M-of-N + hardware wallets for any mint authority |
| Oracle manipulation | Oracles never affect consensus; only inform off-chain matching |
| Fee underpayment | After RFC-006 the fee floor is consensus-enforced |

## 5. Composability Matrix

| Feature | HTLC | Multisig | Vault | Stealth | RWA/NFT |
|---------|------|----------|-------|---------|---------|
| Atomic swap | ● | ○ | ○ | ● | ● |
| Collateral lock | ○ | ● | ● | ● | ● |
| Vesting / cliff | ○ | ○ | ● | ○ | ● |
| Private settlement | ● | ○ | ○ | ● | ● |
| Controlled mint | ○ | ● | ○ | ○ | ● |

● = natural fit ○ = possible with extra work

## 6. Evolution Path

1. **v1** — Pure HTLC P2P / order-book DEX + simple vault escrow
2. **v1.5** — RWA & NFT as first-class collateral
3. **v2** — Batch settlement + simple constant-product pools (off-chain matching + on-chain net settlement)
4. **v3** — Optional light-client proofs for bridges / SPV consumers

## 7. References

- RFC-004 / KVP-104 (HTLC)
- RFC-001 / KVP-101 (Multisig)
- RFC-005 / KVP-105 (Vaults)
- RFC-002 / KVP-102 (Multi-asset)
- RFC-007 drafts (RWA + NFT)
- This pack: `DEFI-TECHNICAL-DESIGN.md`, `DEFI-HTLC-DEX.md`, `DEFI-LENDING.md`