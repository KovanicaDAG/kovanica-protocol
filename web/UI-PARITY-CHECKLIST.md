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

---

## 2. High priority gaps

### 2.1 Native tokens (RFC-002) — multi-asset

| Task | Status | Owner |
| --- | --- | --- |
| Node HTTP: `asset_id` on prepare / submit / utxos / history | 🔒 | node (`kovanica-node` explorer API) |
| Contract types: `ApiUtxo.asset_id`, `ApiHistoryTx.asset_id` | ❌ | web |
| Wallet: asset selector on send | ❌ | web |
| Wallet: per-asset balance list | ❌ | web |
| Explorer: show asset_id on outputs | ❌ | web |
| Spec text update (`/api/spec`) | ❌ | web |

**Note:** RFC-002 landed 2026-09-06. Wire format bumped; testnet must activate native tokens before UI can go live against public node.

### 2.2 Network / status page

| Task | Status |
| --- | --- |
| Route `/network` — head, peers, pow, k, subsidy, finality, light_config | ❌ → implementing this PR |
| Link from shell nav | ❌ → this PR |
| Peer list + bootstrap seeds | ❌ → this PR |

### 2.3 Multisig polish

| Task | Status |
| --- | --- |
| Deep-link from wallet to multisig | 🟡 |
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

1. **Network status page** (this PR) — pure frontend + existing bootstrap/head API.
2. **Node API multi-asset endpoints** — required before wallet asset UI.
3. **Wallet multi-asset send + balances**.
4. **Explorer multi-asset display**.
5. **Staking / hybrid UI** after mainnet design freeze.
6. **Landing mobile download strip**.

---

## 5. Done in this PR

- [x] Checklist document
- [x] `/network` status page (bootstrap + head + p2p)
- [x] Nav entry (desktop + mobile)
- [x] Spec note about RFC-001 / RFC-002 readiness
