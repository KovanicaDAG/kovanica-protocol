# Web UI ↔ Protocol parity checklist

Goal: every consensus / ledger feature that is live on `kovanica-testnet` should be reachable from the public web UI (or clearly marked as mobile/CLI-only).

Status key: ✅ done · 🟡 partial · ❌ missing · 🔒 node API not exposed yet

---

## 1. Core user flows (already solid)

| Feature | Status | Notes |
| --- | --- | --- |
| Explorer DAG graph + selected chain | ✅ | `/explorer` |
| Live mine / pause (operator) | ✅ | |
| Software wallet create / import / encrypt | ✅ | PBKDF2 + AES-GCM |
| Accounts 0–2 | ✅ | |
| Send native KVNC (prepare → sign → submit) | ✅ | |
| Hardware wallet connect + sign | ✅ | |
| Watch-only address | ✅ | |
| Fee estimate tiers | ✅ | |
| Origins map + pulse | ✅ | |
| Multisig M-of-N create / spend / combine | ✅ | `/multisig` — full UI shipped |
| Mining pool page | ✅ | `/pool` |
| Docs / HTTP contract | ✅ | `/docs` |
| Network status | ✅ | `/network` |

---

## 2. High priority gaps

### 2.1 Native tokens (RFC-002) — multi-asset

| Task | Status | Owner |
| --- | --- | --- |
| Node HTTP: `asset_id` on prepare / submit / utxos / history | 🔒 | node (`kovanica-node` explorer API) |
| Contract types: `ApiUtxo.asset_id`, `ApiHistoryTx.asset_id`, balances[] | ✅ | web — `contract.ts` |
| URL helpers: prepareUrl / submitUrl / assetOptionsFromUtxos | ✅ | web — `lib/api/assets.ts` |
| AssetPicker component | ✅ | web — `components/wallet/asset-picker.tsx` |
| Wallet: wire AssetPicker + helpers into send form | 🟡 | next — use helpers in `wallet-view.tsx` |
| Wallet: per-asset balance list in header | 🟡 | depends on node returning asset UTXOs |
| Explorer: show asset_id on outputs | ❌ | web |
| Spec text update (`/api/spec`) | 🟡 | partial |

**Note:** RFC-002 landed 2026-09-06. Wire format bumped; testnet must activate native tokens before UI can go live against public node. Web foundations are ready so the UI lights up as soon as the node starts returning `asset_id`.

### 2.2 Network / status page

| Task | Status |
| --- | --- |
| Route `/network` — head, peers, pow, k, subsidy, finality | ✅ |
| Link from shell nav | ✅ |
| Peer list + bootstrap seeds | ✅ |

### 2.3 Multisig polish

| Task | Status |
| --- | --- |
| Deep-link from wallet to multisig | 🟡 |
| Landing card for Multisig | ✅ |
| Show multisig balance in wallet when watching P2SH | ❌ |
| Cosigner QR / share flow | 🟡 (JSON copy exists) |

---

## 3. Medium priority

| Feature | Status | Notes |
| --- | --- | --- |
| Hybrid staking / bond UI | ❌ | Protocol has bondStake + VRF |
| SPV / light-sync indicators | ❌ | FFI exists; no web light client |
| Mobile download section (APK / IPA sideload) | 🟡 | Docs mention iOS sideload; landing needs links |
| Metrics dashboard (Prometheus scrape public) | ❌ | |
| Peer / DHT map | ❌ | |

---

## 4. Implementation order (recommended)

1. ~~**Network status page**~~ ✅
2. ~~**Web contract + AssetPicker foundations**~~ ✅ (this PR)
3. **Node API multi-asset endpoints** — required before live multi-asset UX
4. **Wallet wire-up** — drop AssetPicker into send form using `assets.ts` helpers
5. **Explorer multi-asset display**
6. **Staking / hybrid UI** after mainnet design freeze
7. **Landing mobile download strip**

---

## 5. Done in this PR

- [x] Checklist document
- [x] `/network` status page (bootstrap + head + p2p)
- [x] Nav entry (desktop + mobile)
- [x] Landing cards for Multisig + Network
- [x] RFC-002 contract types (`asset_id` on UTXO / history / prepare)
- [x] `lib/api/assets.ts` helpers
- [x] `AssetPicker` component
