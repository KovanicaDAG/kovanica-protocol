# kovanica-testnet

Public BlockDAG testnet. Native token **KVNC** (8 decimals).

| | |
| --- | --- |
| Explorer | https://explorer.kovanica.online |
| Wallet | https://wallet.kovanica.online |
| Node source | https://github.com/KovanicaDAG/kovanica-node |
| Network | `kovanica-testnet` |
| Genesis | `9565fc20cb465eec0198a65c07da6b825e4211c4060d581a2c7dac6c96bafc97` |
| Premine | **0.2M KVNC** (founder) + **10M** treasury vaults |
| Subsidy | **10 KVNC / block** at genesis, geometric decay ×3/4 every **2 000 000** blocks |
| Max supply | **90.2M KVNC** hard cap |
| Coinbase maturity | **100 blocks** |
| Fee | Floor `max(1, subsidy/500_000)` atoms/byte; **75% burned / 25% producer** |
| Min fee (genesis) | tracks subsidy (dynamic) |
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


## Tokenomics (RFC-006)

- 1 KVNC = 10^8 atoms.
- New coins only from coinbase (issuance + fee share to the producer).
- **Hard cap** 90.2M KVNC enforced via cumulative `native_minted`.
- **Coinbase maturity 100 blocks** — early spends rejected (`CoinbaseImmature`).
- Fee split: 75% burned, 25% claimable by block producer.
- Curve emission: ≈80M KVNC over geometric eras (s₀=10 KVNC, E=2M, α=3/4).
- Treasury: 10 × 1M KVNC RFC-005 time-lock vaults in genesis, tranche k
  unlocking at height `k × 31 536 000` (≈1 year at 1 block/s). Placeholder
  keys are **testnet-only and publicly derivable by design** — production
  must pass a real secret seed via key ceremony.
- The public seed **mines** ~1 block/min (`KOVANICA_MINE=1 KOVANICA_MINE_SECS=60`).
- Open faucet **on**: `POST /api/faucet` pays 1 KVNC from the operator's funds.
  The TAP micro-faucet (0.01 KVNC drip, 40/day) was **removed** project-wide
  (2026-08-24) — endpoint, rate-limit store, and `KOVANICA_TAP` are gone.
- Wallet `prepare` / `submit` stays open: you sign in the browser; the node never sees the seed.

## Run

See [README.md](./README.md).
