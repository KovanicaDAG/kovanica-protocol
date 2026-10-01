# Kovanica Protocol — Product Polish (P2.9)

**Status**: Draft (P2.9)  
**Goal**: End-user UX readiness for mainnet — hardware wallet support, stable deep-links, fee estimation.

---

## 1. Hardware Wallet Support

### Target Devices
| Device | Interface | Status | Priority |
|--------|-----------|--------|----------|
| **Ledger Nano S / S Plus / X** | WebHID / WebUSB | 🔄 Planned | High |
| **Trezor Model One / Safe 3 / Safe 5** | WebUSB | 🔄 Planned | High |
| **Keystone / Coldcard** | PSBT / QR | ⏳ Later | Medium |

### Implementation Path

#### Ledger (WebHID)
```typescript
// web/src/lib/hw/ledger.ts
import TransportWebHID from "@ledgerhq/hw-transport-webhid";
import { KovanicaApp } from "./ledger-app";  // Custom app (to be developed)

export async function connectLedger(): Promise<KovanicaApp> {
  const transport = await TransportWebHID.create();
  return new KovanicaApp(transport);
}
```

**Requirements**:
- [ ] Custom Ledger app (`kovanica-ledger-app`) — Rust + C, signed by Ledger
- [ ] App supports: `getAddress`, `signTx`, `getPublicKey`
- [ ] BIP-44 path: `m/44'/3007'/0'/0/0` (coin type 3007 = Kovanica, unregistered)
- [ ] WebHID in browser (Chrome/Edge/Opera), WebUSB fallback

#### Trezor (WebUSB)
```typescript
// web/src/lib/hw/trezor.ts
import TrezorConnect from "@trezor/connect";

export async function connectTrezor(): Promise<TrezorSession> {
  await TrezorConnect.init({ manifest: { ... } });
  return TrezorConnect;
}
```

**Requirements**:
- [ ] Trezor firmware support (core team submits PR to trezor-firmware)
- [ ] Coin definition: `KOVANICA_TESTNET` / `KOVANICA_MAINNET`
- [ ] Address format: `kvnc...dag` (base58)

### Web Wallet Integration
- [ ] "Connect Hardware Wallet" button in wallet UI
- [ ] Device selection modal (Ledger / Trezor)
- [ ] Address derivation display + verification on device screen
- [ ] Transaction signing flow: prepare → send to device → user confirms → broadcast
- [ ] Fallback: "Use software wallet" (current behavior)

### Testing
- [ ] Physical device testing (at least 1 Ledger + 1 Trezor)
- [ ] Testnet integration: send tKVNC from hardware wallet
- [ ] Edge cases: device locked, app not open, wrong app, firmware outdated

---

## 2. Explorer Deep-Links (Stable Across Deploys)

### Current Problem
Explorer URLs change on every deploy because TanStack Router generates hash-based routes with content hashes.

### Solution: Stable Route Aliases

#### Route Map (Never Changes)
| Resource | Stable URL | Resolves To |
|----------|------------|-------------|
| Block | `/b/<block-id>` | `/explorer/block/<block-id>` |
| Transaction | `/tx/<tx-id>` | `/explorer/tx/<tx-id>` |
| Address | `/addr/<kvnc-address>` | `/explorer/address/<kvnc-address>` |
| Output | `/out/<outpoint>` | `/explorer/output/<tx-id>/<index>` |

#### Implementation
```tsx
// web/src/routes/__root.tsx - Add before TanStack Router
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

export function DeepLinkResolver() {
  const navigate = useNavigate();
  
  useEffect(() => {
    const path = window.location.pathname;
    
    // /b/<id> → block
    const blockMatch = path.match(/^\/b\/([a-f0-9]{64})$/);
    if (blockMatch) {
      navigate({ to: `/explorer/block/${blockMatch[1]}`, replace: true });
      return;
    }
    
    // /tx/<id> → transaction
    const txMatch = path.match(/^\/tx\/([a-f0-9]{64})$/);
    if (txMatch) {
      navigate({ to: `/explorer/tx/${txMatch[1]}`, replace: true });
      return;
    }
    
    // /addr/<address> → address
    const addrMatch = path.match(/^\/addr\/(kvnc[a-zA-Z0-9]+)$/);
    if (addrMatch) {
      navigate({ to: `/explorer/address/${addrMatch[1]}`, replace: true });
      return;
    }
    
    // /out/<txid>/<index> → output
    const outMatch = path.match(/^\/out\/([a-f0-9]{64})\/(\d+)$/);
    if (outMatch) {
      navigate({ to: `/explorer/output/${outMatch[1]}/${outMatch[2]}`, replace: true });
      return;
    }
  }, [navigate]);
  
  return null;
}
```

#### Nginx Fallback (For Non-SPA Access)
```nginx
# /etc/nginx/sites-enabled/explorer.kovanica.online
location ~ ^/b/[a-f0-9]{64}$ {
    rewrite ^/b/(.*)$ /explorer/block/$1 permanent;
}
location ~ ^/tx/[a-f0-9]{64}$ {
    rewrite ^/tx/(.*)$ /explorer/tx/$1 permanent;
}
location ~ ^/addr/kvnc[a-zA-Z0-9]+$ {
    rewrite ^/addr/(.*)$ /explorer/address/$1 permanent;
}
location ~ ^/out/[a-f0-9]{64}/\d+$ {
    rewrite ^/out/(.*)$ /explorer/output/$1 permanent;
}
```

### Verification
- [ ] Deploy v1, note deep-link URLs
- [ ] Deploy v2 (different content hashes), verify same deep-links work
- [ ] Test: block, tx, address, output links from external sources
- [ ] Document in explorer UI: "Shareable links: /b/..., /tx/..., /addr/..."

---

## 3. Fee Estimation (Mempool p90)

### Current State
- Fixed fee: 1 atom/byte (minimum)
- No dynamic estimation

### Target: p90 Fee Rate API

#### Backend (kovanica-node)
```rust
// crates/kovanica-node/src/rpc.rs
pub async fn estimate_fee(&self, target_blocks: u32) -> Result<FeeEstimate, RpcError> {
    let mempool = self.mempool.read().await;
    let txs: Vec<_> = mempool.iter().map(|(_, tx)| tx).collect();
    
    if txs.is_empty() {
        return Ok(FeeEstimate { rate_atoms_per_byte: 1, next_block: 1 });
    }
    
    // Sort by fee rate descending
    let mut rates: Vec<u64> = txs.iter()
        .map(|tx| tx.fee_rate_with_utxo(&self.utxo()).unwrap_or(1))
        .collect();
    rates.sort_unstable_by(|a, b| b.cmp(a));
    
    // p90 = 90th percentile
    let idx = (rates.len() as f64 * 0.9).ceil() as usize - 1;
    let p90 = rates.get(idx).copied().unwrap_or(1);
    
    Ok(FeeEstimate { rate_atoms_per_byte: p90, next_block: target_blocks })
}
```

#### Frontend (web)
```typescript
// web/src/lib/api/client.ts
export async function estimateFee(targetBlocks = 1): Promise<number> {
  const res = await fetch("/api/fee_estimate?target=1");
  const data = await res.json();
  return data.rate_atoms_per_byte;
}

// Wallet send flow: show "Recommended fee: X atoms/byte (p90)"
```

#### UI Integration
- [ ] Fee slider: "Low (p50)" / "Medium (p90)" / "High (p99)"
- [ ] Show estimated confirmation time based on target_blocks
- [ ] Mempool visualization: fee rate histogram

---

## 4. Wallet UX Polish

### Address Book
- [ ] Save/label addresses (localStorage, encrypted with wallet password)
- [ ] Auto-suggest on send screen
- [ ] Import/export JSON

### Transaction History
- [ ] Infinite scroll (load more)
- [ ] Filter by: sent/received, asset, date range
- [ ] Export CSV

### Multi-Asset Display
- [ ] Balance card per asset (native + each KVP-102 asset)
- [ ] "Hide zero balances" toggle
- [ ] Fiat value (optional, via coingecko API — opt-in)

---

## 5. Mobile Web PWA

### Manifest
```json
// web/public/manifest.json
{
  "name": "Kovanica Wallet",
  "short_name": "Kovanica",
  "start_url": "/wallet",
  "display": "standalone",
  "background_color": "#09090b",
  "theme_color": "#241a04",
  "icons": [...]
}
```

### Service Worker
- [ ] Cache static assets (CSS, JS, fonts)
- [ ] Offline fallback: "Connect to view balance"
- [ ] Background sync for pending txs (when online)

---

## 6. Accessibility (WCAG 2.1 AA)

- [ ] Color contrast ratios (gold on dark: verify)
- [ ] Focus indicators on all interactive elements
- [ ] ARIA labels on icon-only buttons
- [ ] Keyboard navigation: tab order, skip links
- [ ] Screen reader testing (NVDA, VoiceOver)
- [ ] Reduced motion: `prefers-reduced-motion` disables animations

---

## 7. Checklist Summary

| Item | Status | Target |
|------|--------|--------|
| Ledger hardware wallet | 🔄 Planned | Mainnet |
| Trezor hardware wallet | 🔄 Planned | Mainnet |
| Stable deep-links (/b/, /tx/, /addr/, /out/) | 🔄 Planned | Pre-mainnet |
| Fee estimation (p90 API) | 🔄 Planned | Pre-mainnet |
| Address book | 🔄 Planned | Post-mainnet |
| PWA / offline support | 🔄 Planned | Post-mainnet |
| Accessibility audit | 🔄 Planned | Pre-mainnet |

---

*Related: [LEGIT-BOARD.md](./LEGIT-BOARD.md) · [MAINNET-CRITERIA.md](./MAINNET-CRITERIA.md) · [WHAT-IS-KOVANICA.md](./WHAT-IS-KOVANICA.md)*