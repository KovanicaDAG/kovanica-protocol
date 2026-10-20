# 06 — Tokenomics

> Values referenced here live in [`../protocol-params.toml`](../protocol-params.toml).
> `pending` values will change before mainnet.

## 1. Native asset

- Ticker: `KUNA` (`token.ticker`)
- Decimals: `token.decimals`
- Base unit: `token.base_unit` atoms per KUNA

## 2. Supply

- Total supply (also the hard maximum): `token.total_supply`.
- Allocations:
  - Founder premine: `token.founder_premine`
  - Treasury (vested): `token.treasury_total`
  - Genesis validator allocation: `token.genesis_validator_allocation`
  - Mining subsidy budget: `token.mining_subsidy_budget`, i.e.
    `total_supply − founder_premine − treasury_total − genesis_validator_allocation`.

## 3. Treasury

The treasury vests at `token.treasury_annual` per year for
`token.treasury_years` years. Treasury claims are a transaction kind and are
subject to the treasury balance.

## 4. Emission schedule

- Initial block reward `s0 = emission.initial_block_reward`, paid to the
  committing leader of each committed leader block.
- Era length: `emission.subsidy_era_blocks` committed leader blocks.
- Decay: the reward is multiplied by
  `emission.decay_numerator / emission.decay_denominator` each era.

The emission budget is finite and sized so total issuance never exceeds
`token.total_supply`. Genesis validators receive
`token.genesis_validator_allocation` split across the genesis validator set
deterministically.

## 5. Light-node rewards

`emission.light_reward_bps` basis points of the block reward are placed in the
light-node escrow, from which registered light nodes are rewarded for witnesses.
This is not additional issuance; it is a share of the block reward.

## 6. Fees (pending)

The fee **burn / producer split** and the **minimum fee floor** are `pending`:
no such consensus constant exists in the current implementation. Only a
node-local minimum fee rate (`fees.min_fee_rate`, default `0`, settable via the
node's environment) is present. Coinbase maturity (`fees.coinbase_maturity`) is
also `pending`.

These will be fixed before mainnet and recorded in
[`../PROTOCOL-CHANGES.md`](../PROTOCOL-CHANGES.md).
