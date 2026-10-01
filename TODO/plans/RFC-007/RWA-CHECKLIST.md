# RWA Integration — Operational & Delivery Checklist

**Document:** RWA-CHECKLIST  
**Related:** RFC-007, RWA-PROJECT-PLAN, RWA-TECHNICAL-DESIGN  
**Date:** 2026-09-17  

## A. Pre-requisites (must be green before serious RWA work)

- [ ] KVP-102 core ledger is stable
- [ ] HTTP API surfaces `asset_id` on:
  - [ ] `/api/utxos`
  - [ ] `/api/history`
  - [ ] `/api/prepare`
- [ ] Web AssetPicker can select non-KVNC assets
- [ ] Explorer can display non-KVNC balances
- [ ] Testnet is healthy after any recent RFC-006 work

## B. Specification Freeze

- [ ] RFC-007 text reviewed and accepted as Draft
- [ ] `asset_id` derivation function frozen
- [ ] Metadata JSON schema frozen
- [ ] Burn convention decided (unspendable script vs other)

## C. MVP Delivery Checklist

### Core / Tooling
- [ ] Reference Rust function `derive_rwa_asset_id` in shared crate
- [ ] CLI: `rwa derive`
- [ ] CLI: `rwa issue`
- [ ] CLI: `rwa burn`
- [ ] CLI: `rwa info`

### Wallet
- [ ] “Issue RWA” form (name, symbol, class, supply, legal URI)
- [ ] Automatic `asset_id` derivation
- [ ] Metadata upload helper (or external IPFS pin)
- [ ] Transfer of RWA assets works
- [ ] Burn / redeem flow

### Explorer
- [ ] RWA badge on asset
- [ ] Asset detail page with metadata
- [ ] Supply and holder count
- [ ] Link to legal / custody documents

### Documentation
- [ ] RFC-007 published
- [ ] Technical design published
- [ ] Project plan published
- [ ] This checklist kept up to date
- [ ] Short user guide: “How to issue your first RWA on Kovanica”

## D. Security & Compliance Checklist

- [ ] Issuer key management guide (multisig recommended)
- [ ] Clear disclaimer: token ≠ automatic legal title
- [ ] Recommended legal wrapper template (at least one jurisdiction)
- [ ] Metadata immutability guidance (IPFS/Arweave)
- [ ] Process for handling compromised issuer keys

## E. Testnet Demo Checklist

- [ ] Create at least one public demo RWA asset
- [ ] Publish full metadata
- [ ] Transfer between two normal wallets
- [ ] Lock in multisig
- [ ] Lock in vault (time-lock)
- [ ] Perform atomic swap RWA ↔ KVNC (optional but valuable)
- [ ] Burn part of the supply
- [ ] Explorer shows everything correctly
- [ ] Demo documented with txids

## F. Mainnet Readiness (later)

- [ ] Mint authorization model finalized (A / B / C)
- [ ] Security review of any new validation rules
- [ ] Public registry / indexer operational
- [ ] Legal review of disclaimers and templates
- [ ] Monitoring for spam / malicious assets
- [ ] Incident response playbook for issuer key compromise

## G. Do-Not-Ship Items

- [ ] Do not enable free unlimited minting without social or technical controls on mainnet
- [ ] Do not claim that holding the token automatically transfers legal ownership
- [ ] Do not put mutable HTTP links as the only source of truth for legal documents
- [ ] Do not block RFC-006 activation because of RWA work

---

**Usage:**  
Copy this checklist into the relevant GitHub project / issue tracker and tick items as they are completed.  
Update the “Related” documents when major decisions change.