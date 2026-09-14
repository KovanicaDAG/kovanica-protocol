# kovanica-testnet (RFC-006 activated)

Public BlockDAG testnet. Native token **KVNC** (8 decimals).

| | |
| --- | --- |
| Explorer | https://explorer.kovanica.online |
| Wallet | https://wallet.kovanica.online |
| Node source | https://github.com/KovanicaDAG/kovanica-node |
| Network | `kovanica-testnet` |
| Premine | **0.2M KVNC** (founder) + **10M** treasury vaults |
| Subsidy | **10 KVNC / block** at genesis, geometric decay α=3/4 every **2 000 000** blocks |
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

Post-RFC-006 `/api/head` also reports:

```json
{
  "subsidy": <atoms>,
  "native_minted": <atoms>,
  "total": <atoms>,
  "circulating": <atoms>,
  "burned": <atoms>,
  "max_supply": 90200000000000000
}
```

Presence of these fields is the detection signal for the new economic model.

There is no second network path. libp2p / 30333 was removed.

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
- Curve emission: 80M KVNC over geometric eras (s₀=10 KVNC, E=2M, α=3/4).
- Treasury: 10 × 1M RFC-005 time-lock vaults (placeholder keys are
  **testnet-only and publicly derivable by design**; production must pass a
  real secret seed via key ceremony).
- Activation was a **consensus fork** — all pre-RFC-006 balances were wiped.

Full reference: `docs/TOKENOMICS.md`.


## Run

```bash
export KOVANICA_POW=1
export KOVANICA_MINE=0          # 1 only on intentional miners
export KOVANICA_MINE_SECS=120
export KOVANICA_FAUCET=0
export KOVANICA_ALLOW_RESET=0
export KOVANICA_OPERATOR=0
export KOVANICA_LISTEN=0.0.0.0:9000
export KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9001,seed3.kovanica.online:9000
export KOVANICA_DATA="$PWD/data"

./target/release/kovanica-node explorer 127.0.0.1:8080
```

See [README.md](./README.md) and [JOIN.md](./JOIN.md).


## Claiming mined KVNC

Coinbase outputs mature after **100 blocks**. Then spend with the wallet
(https://wallet.kovanica.online) or via `POST /api/prepare` → Ed25519 sign →
`POST /api/submit`. There is no separate claim opcode.
