# RFC-007 / KVP-106 — RWA (Real World Assets) Integration

**Status:** Draft  
**Public name:** KVP-106 (RWA Tokenization Standard)  
**Depends on:** KVP-102 (native multi-asset), KVP-101 (multisig), KVP-105 (vaults), KVP-103 (script v2)  
**Author:** Kovanica Protocol Core  
**Date:** 2026-09-17  

## 1. Summary

This RFC defines how Real World Assets (RWA) are represented, issued, transferred, and redeemed on the Kovanica Protocol using the existing native multi-asset (KVP-102) primitive.

RWA tokens are **first-class native assets** (`asset_id ≠ 0`), not wrapped ERC-20 style tokens.  
Legal ownership, valuation, custody and compliance remain off-chain. The ledger only enforces cryptographic ownership and supply conservation.

## 2. Goals

- Enable tokenization of real-world assets (real estate, bonds, invoices, commodities, funds, etc.)
- Reuse existing UTXO + `asset_id` model with zero consensus changes where possible
- Support controlled issuance via issuer multisig
- Provide clear separation between on-chain rights and off-chain legal claims
- Keep the design simple enough for testnet experiments and mainnet readiness

## 3. Non-Goals

- On-chain legal enforcement of ownership
- Automatic price oracles as consensus rule
- Forced KYC/AML at protocol level
- Complex fractional ownership logic inside the consensus engine

## 4. Core Design Principles

1. **Ledger-minimal** — only cryptographic facts live on-chain.
2. **Issuer-controlled mint** — new RWA assets can only be created by authorized issuers.
3. **Per-asset conservation** — already provided by KVP-102.
4. **Off-chain truth** — legal documents, valuation, custody proofs live in IPFS / Arweave / traditional registries.
5. **Composable** — works with multisig, HTLC, vaults and stealth addresses.

## 5. Asset Model

Every RWA is identified by a unique 32-byte `asset_id`.

```text
asset_id = BLAKE2b-256(
    "KVP106-RWA" ||
    issuer_pubkey ||
    asset_class ||          // e.g. "RE", "BOND", "INVOICE"
    unique_id ||            // issuer-defined
    version
)
```

Special rules:
- `asset_id = 0x00…00` is reserved for native KVNC.
- RWA assets MUST have non-zero `asset_id`.
- Decimals are recommended to be 0 (whole units) or 8 (for fractional).

### Metadata (off-chain, referenced on-chain)

Recommended JSON schema (stored on IPFS / Arweave):

```json
{
  "kvp": "106",
  "asset_id": "0x...",
  "name": "Belgrade Office Tower Unit 12A",
  "symbol": "BOT-12A",
  "decimals": 0,
  "asset_class": "REAL_ESTATE",
  "issuer": "kov1...",
  "legal_uri": "ipfs://...",
  "custody_uri": "ipfs://...",
  "total_supply": "100",
  "description": "...",
  "jurisdiction": "RS",
  "created_at": "2026-09-17T00:00:00Z"
}
```

## 6. Issuance (Mint)

Two supported models:

### 6.1 Single Issuer Mint
- Issuer pubkey is embedded in `asset_id` derivation.
- Only transactions signed by that key (or its multisig) may create new outputs of that `asset_id` with positive amount that were not previously conserved.

### 6.2 Multisig Issuer (recommended for production)
- Use KVP-101 M-of-N.
- Mint authority is a P2SH multisig address.
- All mint transactions must satisfy the multisig script.

**Ledger rule (new validation):**
A transaction may increase the total supply of a non-KVNC `asset_id` only if:
1. It is a coinbase **or**
2. It is authorized by the registered issuer of that `asset_id` (via signature or script).

(Exact enforcement can be done via a new script template or via a soft registry of authorized minters.)

## 7. Transfer & Ownership

Standard UTXO rules apply:
- Spend any UTXO that carries the RWA `asset_id`.
- Create new outputs with the same `asset_id`.
- Conservation must hold per asset.

Supports:
- Simple transfers
- Multisig custody
- Stealth addresses (KVP-103)
- Time-locked vaults (KVP-105)
- Atomic swaps via HTLC (KVP-104)

## 8. Redemption / Burn

To redeem the underlying real-world asset:
1. Holder burns the RWA tokens (sends to an unspendable script or explicit burn opcode).
2. Issuer (or designated custodian) verifies the burn on-chain.
3. Off-chain legal transfer of the underlying asset is executed.
4. Optional: issuer publishes a redemption receipt on IPFS linked to the burn transaction.

## 9. Registry & Discovery

Two-tier registry:

| Layer | Content | Storage |
|-------|---------|---------|
| On-chain | `asset_id` existence + supply | UTXO set + optional checkpoint metadata |
| Off-chain | Full metadata, legal docs, custody proofs | IPFS / Arweave + optional indexer |

Recommended public indexers:
- Explorer shows RWA badge + link to metadata
- Optional dedicated RWA registry API (off-chain)

## 10. Security Considerations

- **Issuer key compromise** → use M-of-N multisig + hardware wallets.
- **Metadata mutability** → prefer immutable IPFS/Arweave CIDs.
- **Supply inflation** → strict mint authorization checks.
- **Legal risk** → protocol never claims to transfer legal title; only cryptographic rights.
- **Oracle risk** → price feeds are optional and never consensus-critical.

## 11. Compatibility

| Feature | Status |
|---------|--------|
| KVP-102 multi-asset | Required base |
| KVP-101 multisig | Recommended for issuers |
| KVP-103 stealth | Fully supported |
| KVP-104 HTLC | Fully supported (RWA ↔ KVNC swaps) |
| KVP-105 vaults | Fully supported (escrow / vesting) |
| RFC-006 tokenomics | Orthogonal (RWA assets have independent supply) |

## 12. Migration & Activation

- No hard fork required if mint rules are enforced via script templates.
- If a new consensus rule for authorized mint is needed → soft fork or testnet activation.
- Existing KVP-102 assets remain valid; RWA is a convention + optional extra validation on top.

## 13. Open Questions

1. Should authorized minters be registered on-chain (small registry UTXO) or purely off-chain convention?
2. Do we need an explicit `OP_BURN` or is sending to unspendable script enough?
3. Should fractional ownership and dividend distribution be standardized in a follow-up RFC?
4. How deep should the explorer go into legal metadata display?

## 14. References

- RFC-002 / KVP-102 — Native multi-asset tokens
- RFC-001 / KVP-101 — Multisig
- RFC-005 / KVP-105 — Time-lock vaults
- Kovanica project plan playbook
- Existing file: `KVP-102-HTTP-asset_id-gap.md`

---

**Next steps:** See `RWA-PROJECT-PLAN.md` for phased delivery.