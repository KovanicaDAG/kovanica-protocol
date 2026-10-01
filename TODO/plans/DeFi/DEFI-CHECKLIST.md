# DeFi Integration — Operational & Delivery Checklist

**Document:** DEFI-CHECKLIST  
**Date:** 2026-09-17  
**Related:** DEFI-PROJECT-PLAN, DEFI-TECHNICAL-DESIGN, DEFI-HTLC-DEX

## A. Pre-requisites (must be green)

- [ ] KVP-102 core ledger stable
- [ ] HTTP API returns stable `asset_id` on:
  - [ ] `/api/utxos`
  - [ ] `/api/history`
  - [ ] `/api/prepare`
- [ ] Web AssetPicker can select non-KVNC assets
- [ ] Explorer can display non-KVNC balances
- [ ] RFC-006 activated (or clearly scheduled) and fee-floor behaviour understood
- [ ] HTLC and vault script templates documented and tested

## B. Specification Freeze

- [ ] Swap Offer JSON schema frozen
- [ ] HTLC timeout calculation rules documented
- [ ] Preimage generation & storage rules documented
- [ ] Fee & change handling rules for multi-asset HTLCs frozen
- [ ] Lending position record schema (if Phase 2 is in scope)

## C. Atomic Swap MVP Checklist

### Core / CLI
- [ ] `htlc fund` (any asset_id)
- [ ] `htlc claim` (with preimage)
- [ ] `htlc refund` (after timeout)
- [ ] `htlc inspect <txid or address>`
- [ ] Unit tests for script construction and address derivation
- [ ] Integration test: full happy-path swap on local node

### Wallet
- [ ] Create Offer screen
- [ ] Take Offer / Fund counterparty HTLC
- [ ] Claim flow with preimage reveal
- [ ] Refund flow after timeout
- [ ] Clear display of remaining blocks until timeout
- [ ] Refusal to fund if timeout is already unsafe

### Explorer / Indexer
- [ ] HTLC badge or status on relevant transactions
- [ ] Detail view: claimable / refundable / claimed / refunded
- [ ] Optional: list of open offers (if indexer exists)

### Documentation & Demo
- [ ] This pack published
- [ ] Short “How to do your first atomic swap” guide
- [ ] Public testnet demo with txids recorded

## D. Lending / Escrow Checklist (Phase 2)

- [ ] Vault funding with collateral asset
- [ ] Multisig release path tested
- [ ] Timeout / liquidation path tested
- [ ] Wallet screens for open / repay / liquidate
- [ ] Demo with test token or RWA as collateral

## E. Security Checklist

- [ ] Preimages never logged or sent to the node
- [ ] Timeouts include GHOSTDAG k=3 safety margin
- [ ] All funding transactions go through `/api/prepare`
- [ ] No reliance on mutable HTTP metadata for settlement
- [ ] Issuer keys for any stable / RWA asset are M-of-N
- [ ] Clear user warnings about irreversible timeout behaviour

## F. Mainnet Readiness (later)

- [ ] Security review of all client-side HTLC / vault builders
- [ ] Monitoring for stuck HTLCs and abnormal timeout rates
- [ ] Incident playbook for preimage leakage or timeout misconfiguration
- [ ] Liquidity bootstrap plan (seed offers, market makers)
- [ ] Legal review of any RWA-collateralised products

## G. Do-Not-Ship Items

- [ ] Do not put price oracles into consensus rules
- [ ] Do not invent new consensus opcodes for v1 DeFi
- [ ] Do not allow funding of HTLCs with immature coinbases
- [ ] Do not ship wallet flows that hide the timeout from the user
- [ ] Do not treat off-chain offer signatures as on-chain guarantees

---

**Usage:** Copy relevant sections into GitHub issues / project boards and tick as completed.  
Update this checklist when Phase boundaries or security assumptions change.