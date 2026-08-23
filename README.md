# Kovanica web

TypeScript **UI only**. Protocol (GHOSTDAG, UTXO, Ed25519, PoW) lives in
[kovanica-ledger](https://github.com/KovanicaDAG/kovanica-ledger).

## Live

| Host | App |
| --- | --- |
| [kovanica.online](https://kovanica.online) | this repo `/` |
| [wallet.kovanica.online](https://wallet.kovanica.online) | `/wallet` |
| [map.kovanica.online](http://map.kovanica.online) | `/map` |
| [explorer.kovanica.online](https://explorer.kovanica.online) | **Rust node** — do not point at this app |

VPS: `pm2 kovanica-web` on `127.0.0.1:3010`. Node 20 is enough to **run** the built `.output`; build with Node 22.

Header **Preview / Live**:

- Preview = in-process demo DAG (different genesis)
- Live = proxy to `https://explorer.kovanica.online` (`kovanica-testnet-1`)

## Paths

| Path | What |
| --- | --- |
| `/` | Landing |
| `/explorer` | BlockDAG graph |
| `/wallet` | Create / import / send |
| `/map` | Origin choropleth |
| `/docs` | HTTP contract |
| `/api/*` | Same contract as the node; `?source=live` proxies Rust |

## Develop

```sh
npm ci
npm run dev
```

VPS rebuild: `npm run build:vps` then rsync `.output` and `pm2 restart kovanica-web`. Do not steal ports from other apps on the box — see [DEPLOY.md](./DEPLOY.md).
