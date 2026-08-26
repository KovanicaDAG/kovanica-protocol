# kovanica-testnet

Public BlockDAG testnet. Native token **KVNC** (8 decimals).

| | |
| --- | --- |
| Explorer | https://explorer.kovanica.online |
| Wallet | https://wallet.kovanica.online |
| Node source | https://github.com/KovanicaDAG/kovanica-node |
| Network | `kovanica-testnet` |
| Premine | 200 KVNC (founder) |
| Subsidy cap | 200 KVNC / block, halves every 500000 blocks |
| Min fee | 0.0004 KVNC at genesis |
| k | 3 (GHOSTDAG) |
| PoW | on (`KOVANICA_POW=1`) |
| P2P | **TCP only** `KOVANICA_LISTEN` (default `0.0.0.0:9000`) |
| Bootstrap | DNS-only `seed.kovanica.online:9000` (not the Cloudflare hostname) |
| Seeds | `seed.kovanica.online:9000` · `seed2.kovanica.online:9001` · `seed3.kovanica.online:9000` |

Live genesis and tip: `GET https://explorer.kovanica.online/api/head`  
P2P status on a running node: `GET /api/p2p`  
Block dump (same bytes a clone pulls over TCP): `GET /api/blocks`  
Bootstrap blob: `GET https://explorer.kovanica.online/api/bootstrap`

There is no second network path. libp2p / 30333 was removed: it bound a port
and never gossiped blocks.

`explorer.kovanica.online` is orange-cloud. TCP 9000 never reaches the seed
through that name. Grey-cloud `seed.kovanica.online` (or the origin IP) is the
peer address clones should dial. The seed dials its sibling seeds
(`seed2.kovanica.online:9001`, `seed3.kovanica.online:9000`).


## Tokenomics

- 1 KVNC = 10^8 atoms.
- New coins only from coinbase (issuance + fees to the miner).
- The public seed **mines** ~1 block/min (`KOVANICA_MINE=1 KOVANICA_MINE_SECS=60`).
- Open faucet **on**: `POST /api/faucet` pays 1 KVNC from the operator's funds.
  The TAP micro-faucet (0.01 KVNC drip, 40/day) was **removed** project-wide
  (2026-08-24) — endpoint, rate-limit store, and `KOVANICA_TAP` are gone.
- Wallet `prepare` / `submit` stays open: you sign in the browser; the node never sees the seed.

## Run

See [README.md](./README.md).
