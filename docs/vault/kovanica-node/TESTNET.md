# kovanica-testnet

Public BlockDAG testnet. Native token **KVNC** (8 decimals).

| | |
| --- | --- |
| Explorer | https://explorer.kovanica.online |
| Wallet | https://wallet.kovanica.online |
| Node source | https://github.com/KovanicaDAG/kovanica-node |
| Network | `kovanica-testnet` |
| Premine | 50 KVNC (founder) |
| Subsidy cap | 50 KVNC / block, halves every 1000 blocks |
| Min fee | 0.0001 KVNC at genesis |
| k | 3 (GHOSTDAG) |
| PoW | on (`KOVANICA_POW=1`) |
| P2P | **TCP only** `KOVANICA_LISTEN` (default `0.0.0.0:9000`) |
| Bootstrap | DNS-only `seed.kovanica.online:9000` (not the Cloudflare hostname) |

Live genesis and tip: `GET https://explorer.kovanica.online/api/head`  
P2P status on a running node: `GET /api/p2p`  
Block dump (same bytes a clone pulls over TCP): `GET /api/blocks`  
Bootstrap blob: `GET https://explorer.kovanica.online/api/bootstrap`

There is no second network path. libp2p / 30333 was removed: it bound a port
and never gossiped blocks.

`explorer.kovanica.online` is orange-cloud. TCP 9000 never reaches the seed
through that name. Grey-cloud `seed.kovanica.online` (or the origin IP) is the
peer address clones should dial. The seed itself keeps `KOVANICA_PEERS=off`.
On connect the seed **serves** its dump then **reads** the clone's dump, so extra
blocks on a clone can land on the seed.


## Tokenomics

- 1 KVNC = 10^8 atoms.
- New coins only from coinbase (issuance + fees to the miner).
- Open faucet **on**: `POST /api/faucet` pays 1 KVNC from operator funds. The
  TAP micro-faucet (0.01 KVNC, 40/day) was removed project-wide (2026-08-24).
- The public seed mines ~1 block/min (`KOVANICA_MINE_SECS=60`; clones default to mine off).
- Wallet `prepare` / `submit` stays open: you sign in the browser; the node never sees the seed.

Join a clone: [JOIN.md](./JOIN.md) (one-click install, Windows/Linux/macOS, USB stick).

## Run

See [README.md](./README.md).
