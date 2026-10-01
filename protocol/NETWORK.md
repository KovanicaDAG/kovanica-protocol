# Kovanica Network & Domain Architecture

> Last updated: 2026-09-14  
> Status: Pre-Mainnet (RFC-006 activated on testnet)

This document is the single source of truth for how the Kovanica public domains and networks are organised.

---

## 1. Domain Map

| Hostname                          | Purpose                                      | Notes |
|-----------------------------------|----------------------------------------------|-------|
| **kovanica.online**               | Project landing / marketing site             | Pure homepage. No live network UI. |
| **testnet.kovanica.online**       | Full Testnet surface                         | Explorer, wallet, protocol tools, faucet |
| **mainnet.kovanica.online**       | Full Mainnet surface                         | Ready. Identical UI to testnet. |
| **faucet.testnet.kovanica.online**| Testnet faucet                               | Testnet only |
| **api.kovanica.online**           | Public HTTP API entry                        | Shared for now |
| **explorer.kovanica.online**      | Block explorer                               | Shared (pre-mainnet) |
| **wallet.kovanica.online**        | Web wallet                                   | Shared (pre-mainnet) |
| **docs.kovanica.online**          | Specifications, RFCs, KVP standards          | Canonical docs |
| **status.kovanica.online**        | Network health / monitoring                  | Height, supply, uptime |
| **seed.kovanica.online**            | Primary P2P seed (TCP 9000)                | DNS-only (grey cloud); Hostinger VPS `srv1745734` |
| **seed2.kovanica.online**           | Secondary seed (TCP 9000)                  | DNS-only; Hostinger KVM2 VPS `76.13.250.65` (`srv1991525`) |
| **kovi.kovanica.online**          | Reserved / brand short link                  | Kept |
| **monitor / pool / opencode**     | Internal / experimental                      | — |

---

## 2. Network Configuration

| Property              | Testnet                      | Mainnet                      |
|-----------------------|------------------------------|------------------------------|
| Network ID            | `kovanica-testnet`           | `kovanica`                   |
| Primary hostname      | `testnet.kovanica.online`    | `mainnet.kovanica.online`    |
| API base              | `https://api.kovanica.online`| `https://api.kovanica.online`|
| Faucet                | Yes                          | No                           |
| Consensus             | GHOSTDAG k=3                 | GHOSTDAG k=3                 |
| Token                 | KVNC (test)                  | KVNC                         |
| Current phase         | Live (RFC-006 activated)     | Not yet open                 |

### Detection logic (client-side)

```ts
// src/lib/network.ts
export function detectNetwork(): "testnet" | "mainnet" {
  const host = window.location.hostname.toLowerCase();
  if (host === "mainnet.kovanica.online" || host.startsWith("mainnet.")) {
    return "mainnet";
  }
  return "testnet"; // default while pre-mainnet
}
```

The network switcher performs a **hard redirect** (changes hostname) so that cookies, localStorage and API clients stay cleanly isolated.

---

## 3. Redirect Rules (Cloudflare)

Active Redirect Rules (in priority order):

1. `map.kovanica.online` → `api.kovanica.online`
2. `kovanica.kovanica.online` → `faucet.testnet.kovanica.online`
3. `www.kovanica.online` → `kovanica.online`
4. Selected paths on the root (`/explorer`, `/wallet`, `/faucet`, `/stealth`, `/htlc`, `/vaults`, `/multisig` …) → `testnet.kovanica.online`

These rules protect old bookmarks and external links during the migration.

---

## 4. Design Principles

- **Root is sacred**  
  `kovanica.online` must remain a clean project face. No live explorers, no faucet, no protocol playgrounds.

- **Networks live on subdomains**  
  Full interactive surfaces belong on `testnet.` and `mainnet.`.

- **Hard isolation**  
  Switching networks changes the hostname. This gives natural separation of storage, CORS and configuration.

- **Shared services are temporary**  
  `explorer.` and `wallet.` are currently shared. They will become network-aware closer to mainnet launch if needed.

- **Seeds stay grey-cloud**  
  P2P seeds (`seed`, `seed2`) must never be proxied through Cloudflare.

---

## 5. Developer Quick Reference

```ts
import { getCurrentNetwork, switchNetwork } from "@/lib/network";

const net = getCurrentNetwork();

// API
fetch(`${net.apiBase}/api/head`);

// Badge
<span style={{ color: net.badgeColor }}>{net.badgeLabel}</span>

// Switch
switchNetwork("mainnet"); // hard redirect
```

---

## 6. Future Mainnet Activation Checklist

When mainnet is ready:

- [ ] Deploy production binaries / genesis to the mainnet infrastructure
- [ ] Point `mainnet.kovanica.online` to the production frontend
- [ ] Update root landing badge from “Pre-Mainnet” → “Mainnet Live”
- [ ] Disable or remove temporary root → testnet path redirects (Rule 4)
- [ ] Announce and update all documentation
- [ ] Keep testnet running indefinitely for developers and testing

---

## 7. Related Documents

- RFC-006 Tokenomics & Activation
- `docs/LEGIT-BOARD.md`
- `src/lib/network.ts` (canonical client config)
- Cloudflare DNS export (authoritative record list)

---

*This file should be updated whenever the domain or network topology changes.*
```