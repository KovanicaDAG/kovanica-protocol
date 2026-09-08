# Web UI ↔ Protocol parity checklist

Goal: every consensus / ledger feature that is live on `kovanica-testnet` should be reachable from the public web UI (or clearly marked as mobile/CLI-only).

Status key: ✅ done · 🟡 partial · ❌ missing · 🔒 node API not exposed yet

---

## 1. Core user flows

| Feature | Status | Notes |
| --- | --- | --- |
| Explorer DAG + selected chain | ✅ | |
| Wallet create / import / HW / send | ✅ | |
| Multisig M-of-N | ✅ | `/multisig` |
| Network status | ✅ | `/network` |
| Origins map / Pool / Docs | ✅ | |

---

## 2. Native tokens (RFC-002)

| Task | Status |
| --- | --- |
| Node HTTP `asset_id` on prepare/submit/utxos/history | 🔒 deferred |
| Contract types + helpers + AssetPicker | ✅ |
| **Wallet wire-up** (picker, prepare/submit URLs, history label) | ✅ |
| **Explorer** show asset_id on tx outputs | ✅ |
| Live multi-asset on public testnet | 🔒 needs node API |

---

## 3. Medium priority (later)

| Feature | Status |
| --- | --- |
| Hybrid staking UI | ❌ |
| SPV / light client in browser | ❌ |
| Mobile download strip | 🟡 |
| Metrics dashboard | ❌ |

---

## Done in PR #89

- [x] Checklist
- [x] `/network` page + nav
- [x] Landing Multisig + Network cards
- [x] RFC-002 contract types + `assets.ts` + `AssetPicker`
- [x] Wallet send form wired to AssetPicker / prepareUrl / submitUrl
- [x] Explorer Graph panel lists outputs with asset badges
