# kovanica-testnet (RFC-006 activated)

Public BlockDAG testnet. Native token **KVNC** (8 decimals).

> > **Consensus decision (ratified 2026-09-25): Kovanica is PoA-only.**
> > Proof-of-Work is being removed from the protocol. See
> > `protocol/docs/RFC-POA-Migration.md` §0 (canonical). Items marked `[TARGET]`
> > are ratified but not yet implemented; `[CURRENT]` items describe shipped code.
> >
> > **This is the canonical testnet-economy document, so it is worth being blunt:
> > not one number in the table below changes because of the PoA-only decision.**
> > The emission curve is **height-indexed** (`subsidy_at(height)`) and issuance
> > is hard-capped inside `apply_block` (`kovanica-state/src/ledger.rs`), which
> > rejects any block where `cumulative_minted + claimed_native > MAX_SUPPLY`.
> > Neither depends on who produced a block or how. MAX_SUPPLY **90.2M KVNC**, s₀
> > **10 KVNC/block**, era **2,050,000 blocks**, α **3/4**, maturity **100
> > blocks**, fee split **75% burned / 25% producer**, GHOSTDAG **k=3**, UTXO,
> > Ed25519, **1 KVNC = 100_000_000 atoms** — all unchanged.
> >
> > What *does* change is the **pace**, not the cap: PoW difficulty was adaptive,
> > PoA is a fixed `SLOT_DURATION_MS` (default 3000 ms) with no retarget and no
> > gap-fill. "PoA is faster than PoW" is true in wall-clock terms and is
> > **irrelevant to the 90.2M ceiling.**
> >
> > `[TARGET]` the `PoW` row and the `KOVANICA_POW` / `KOVANICA_MINE` /
> > `KOVANICA_MINE_SECS` exports below are removed, and the reset the genesis
> > refers to becomes **mandatory** (RFC-POA §0.6).

| | |
| --- | --- |
| Explorer | https://explorer.kovanica.online |
| Wallet | https://wallet.kovanica.online |
| Node source | https://github.com/KovanicaDAG/kovanica-node |
| Network | `kovanica-testnet` |
| Premine | **0.2M KVNC** (founder) + **8M** treasury vaults |
| Subsidy | **10 KVNC / block** at genesis, geometric decay α=3/4 every **2 050 000** blocks |
| Max supply | **90.2M KVNC** hard cap |
| Coinbase maturity | **100 blocks** |
| Fee | Floor `max(1, subsidy/500_000)` atoms/byte; **75% burned / 25% producer** |
| Min fee (genesis) | tracks subsidy (dynamic) |
| k | 3 (GHOSTDAG) |
| PoW | `[CURRENT]` on (`KOVANICA_POW=1`) — pre-reset chain / **`[TARGET]`-removed** |
| PoA | `[CURRENT]` available, **default when `KOVANICA_CONSENSUS` is unset** · `[TARGET]` the only admission model |
| Authority set | `[CURRENT]` `KOVANICA_AUTHORITIES`; testnet placeholder from the public constant `AUTHORITY_PLACEHOLDER_BASE = 9001` (publicly derivable, testnet-only, mirroring the placeholder treasury keys) · rotation **mechanism settled** (genesis-fixed, on-chain M-of-N `AuthorityUpdateTx` only) · `[OPEN]` mainnet governance *inputs* (RFC-POA §0.7.2) |
| Slot duration | `[CURRENT]` `KOVANICA_SLOT_DURATION`, default 3000 ms · no gap-fill |
| P2P | **TCP only** `KOVANICA_LISTEN` (default `0.0.0.0:9000`) |
| Bootstrap | DNS-only `seed.kovanica.online:9000` (not the Cloudflare hostname) |
| Seeds | `seed.kovanica.online:9000` (primary) · `seed2.kovanica.online:9000` (secondary, Hostinger KVM2 VPS) · `seed3` = new VPS `187.7.27.139`, provisioned but not yet in service |

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
  "max_supply": 9020000000000000
}
```

Presence of these fields is the detection signal for the new economic model.

There is no second network path. libp2p / 30333 was removed.

`explorer.kovanica.online` is orange-cloud. TCP 9000 never reaches the seed
through that name. Grey-cloud `seed.kovanica.online` (or the origin IP) is the
peer address clones should dial. The primary seed dials its sibling
(`seed2.kovanica.online:9000`; the original AWS `seed3` was retired 2026-09-17 and replaced by a new VPS on `187.7.27.139`, pending DNS re-point + node start).


## Tokenomics (RFC-006)

- 1 KVNC = 10^8 atoms.
- New coins only from coinbase (issuance + fee share to the producer).
- **Hard cap** 90.2M KVNC enforced via cumulative `native_minted`.
- **Coinbase maturity 100 blocks** — early spends rejected (`CoinbaseImmature`).
- Fee split: 75% burned, 25% claimable by block producer.
- Curve emission: 82M KVNC over geometric eras (s₀=10 KVNC, E=2.05M, α=3/4).
- Treasury: 8 × 1M RFC-005 time-lock vaults (placeholder keys are
  **testnet-only and publicly derivable by design**; production must pass a
  real secret seed via key ceremony).
- Activation was a **consensus fork** — all pre-RFC-006 balances were wiped.

Full reference: `docs/TOKENOMICS.md`.


## Run

```bash
# [CURRENT] pre-reset PoW testnet. PoW vars are [TARGET]-removed; keep
# KOVANICA_MINE=0 / KOVANICA_FAUCET=0 / KOVANICA_ALLOW_RESET=0 as-is — those
# are still meaningful safety defaults and are NOT affected by the migration.
export KOVANICA_POW=1
export KOVANICA_MINE=0          # 1 only on intentional miners
export KOVANICA_MINE_SECS=120
export KOVANICA_FAUCET=0
export KOVANICA_ALLOW_RESET=0
export KOVANICA_OPERATOR=0
export KOVANICA_LISTEN=0.0.0.0:9000
export KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000
export KOVANICA_DATA="$PWD/data"

./target/release/kovanica-node explorer 127.0.0.1:8080
```

```bash
# [TARGET] PoA-only testnet: the three PoW/mining exports are gone. PoA is the
# default when KOVANICA_CONSENSUS is unset.
export KOVANICA_FAUCET=0
export KOVANICA_ALLOW_RESET=0
export KOVANICA_OPERATOR=0
export KOVANICA_LISTEN=0.0.0.0:9000
export KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000
export KOVANICA_DATA="$PWD/data"

./target/release/kovanica-node explorer 127.0.0.1:8080
```

See [README.md](./README.md) and [JOIN.md](./JOIN.md).


## Claiming mined KVNC

Coinbase outputs mature after **100 blocks** — **unchanged by the PoA-only
decision**, since maturity is a height offset and not an admission rule. Then
spend with the wallet (https://wallet.kovanica.online) or via
`POST /api/prepare` → Ed25519 sign → `POST /api/submit`. There is no separate
claim opcode.

`[TARGET]` The word "mined" becomes "produced". Under PoA the coinbase of a
given slot accrues to the **authority scheduled for that slot**, not to whoever
solved a hash target. If that authority is offline the slot is simply empty —
there is no gap-fill — and the next scheduled authority continues on the fixed
3000 ms clock. Maturity is still 100 blocks from the producing block.
