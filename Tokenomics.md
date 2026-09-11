# Kovanica Tokenomics — RFC-006

> **Status:** consensus changes partially implemented on
> `tokenomics/rfc-006-emission-curve`. Steps 1–4 (smooth emission curve,
> `MAX_SUPPLY` hard cap, coinbase maturity, fee burn) are landed and green
> (785 tests). Steps 5–6 (treasury genesis + mainnet profile) and Step 7
> (supply accounting / observability) are pending. Full spec: this document.

## 1. Motivation & goals

The economic model is designed around four goals:

1. **Predictable, capped supply.** Total native KVNC is hard-capped below
   100M, so the asset is scarce and the terminal supply is knowable today.
2. **Long-tail, fair emission.** Emission decays *smoothly* (geometric
   decay per era) rather than in Bitcoin-style step halvings, so there is
   no abrupt issuance cliff and late participants are not punished by a
   sudden drop.
3. **Security budget.** Block rewards (subsidy + a share of fees) fund
   proof-of-work and VRF-staked validation, keeping the DAG secure at high
   block rates.
4. **Deflationary fee market.** A majority of every transaction fee is
   burned, so sustained usage exerts net deflationary pressure on the
   circulating supply.

## 2. Units

- **1 KVNC = 10⁸ atoms** (`ATOM = 100_000_000`).
- All consensus amounts are `u64` atom counts; the maximum supply fits
  comfortably in `u64` (max ≈ 1.8 × 10¹⁹).
- Human-facing amounts render in KVNC; wire/ledger amounts are atoms.

## 3. Emission curve

The block subsidy follows a **smooth geometric decay**:

- Genesis subsidy **s₀ = 10 KVNC/block**.
- Era length **E = 2,000,000 blocks**.
- Per-era decay **α = 3/4**: `s(era) = s(era−1) × 3/4`, integer floor each
  step.
- `subsidy_at(height) = s(height / E)`; eras ≥ 256 return 0 (the subsidy
  reaches 0 long before, and the clamp keeps the computation bounded).

The geometric series gives a closed-form total:

```
total_emission = s₀ · E / (1 − α) = 10 × 2,000,000 × 4 = 80,000,000 KVNC
```

### Era table

| Era | Subsidy (KVNC) | Era emission (M KVNC) | Cumulative (M KVNC) |
|-----|----------------|-----------------------|---------------------|
| 0   | 10.000         | 20.00                 | 20.00               |
| 1   | 7.500          | 15.00                 | 35.00               |
| 2   | 5.625          | 11.25                 | 46.25               |
| 3   | 4.219          | 8.44                  | 54.69               |
| 4   | 3.164          | 6.33                  | 61.02               |
| 5   | 2.373          | 4.75                  | 65.76               |
| 6   | 1.780          | 3.56                  | 69.32               |
| 7   | 1.335          | 2.67                  | 71.99               |
| 8   | 1.001          | 2.00                  | 73.99               |
| 9   | 0.751          | 1.50                  | 75.49               |
| …   | → 0            | → 0                   | → 80.00             |

At 1 block/second the first era lasts ≈ 23 days; the tail extends for
decades, with issuance asymptotically approaching 80M KVNC.

**Reference protocols:** smooth geometric emission follows the Monero /
Kaspa design lineage (continuous decay instead of Bitcoin's step halving),
chosen so the subsidy never drops discontinuously and the security budget
declines gradually as the network matures.

## 4. Terminal supply & hard cap

The curve alone is **not** a real cap: in a parallel-block DAG, two blocks
in each other's anticone each mint the full subsidy, so cumulative minting
can exceed the curve total. The cap is therefore enforced by a
**per-block cumulative `native_minted` counter**:

- `MAX_SUPPLY = 90.2M KVNC = 90_200_000_000_000_000 atoms`.
- Every block's view state carries `native_minted` (its selected parent's
  cumulative minted + its own coinbase claim).
- A coinbase that would push `native_minted + claimed > MAX_SUPPLY` is
  rejected (`LedgerError::SupplyCapExceeded`), in both the batch
  (`apply_coinbase`) and incremental insert paths.
- Genesis records premine + treasury as the initial `native_minted`.
- The counter is serialized in the checkpoint (v7) so a restored ledger
  continues enforcing the cap correctly.

**Reference protocol:** Bitcoin's `MAX_MONEY` — a hard supply ceiling
independent of the issuance schedule.

## 5. Distribution

| Component        | Amount    | Mechanism                                        |
|------------------|-----------|--------------------------------------------------|
| Founder premine  | 0.2M KVNC | Genesis coinbase output (existing 200 KVNC)      |
| Treasury         | 10M KVNC  | 10 × 1M RFC-005 vault tranches at genesis        |
| Curve emission   | 80M KVNC  | Block subsidies over the emission schedule       |
| **Total**        | **90.2M KVNC** | **< 100M**                                  |

### Treasury vesting

The 10M treasury is emitted at genesis as **10 vault tranches of 1M KVNC
each** (RFC-005 time-lock vault composition — zero new consensus rules):

- Tranche *k* (k = 1..=10) is a `VaultScript` with
  `absolute_time = k × 31,536,000` (≈ k years at 1 block/second;
  `relative_delay = 0`).
- **Beneficiary** (CLAIM path, valid only after expiry) = treasury — this
  is how a vested tranche is drawn.
- **Owner** (RECOVER path, valid only strictly before expiry) = treasury
  governance — this is the pre-vesting clawback / redirect control.
- Treasury keys are **placeholders** (deterministically derived, clearly
  marked) pending a real key ceremony before mainnet.

**Reference protocol:** vesting via RFC-005 vault composition (CLTV-style
absolute time locks), the same primitive shipped for user escrow.

## 6. Block subsidy & coinbase maturity

- Each block's coinbase may claim up to `subsidy_at(height)` (native),
  plus its fee share (see §7).
- **Coinbase maturity: `COINBASE_MATURITY = 100` blocks.** A coinbase
  output is spendable only at `height >= created_at + 100`; earlier spends
  are rejected (`LedgerError::CoinbaseImmature`). This reuses the RFC-005
  per-UTXO `created_at` machinery plus a new `coinbase_created` flag.
- The node's transaction builder (`prepare_transfer` and friends) skips
  immature coinbases when accumulating inputs, so wallets never build
  transactions that fail at apply time.
- Maturity applies to *all* coinbase outputs (founder premine, treasury
  tranches, and block subsidies alike). Treasury tranches are additionally
  time-locked, so maturity is irrelevant to them in practice.

**Reference protocol:** Bitcoin's `COINBASE_MATURITY` (100 blocks) —
prevents a producer from spending freshly minted value before the network
has had time to reorganize around it.

## 7. Fees

- **Fee floor:** `max(1, subsidy / 500_000)` atoms per byte of
  transaction — a minimum fee rate that tracks the subsidy so the mempool
  cannot be flooded for free as issuance declines.
- **Fee burn (75/25):** 75% of every transaction fee is **burned**; 25%
  goes to the block producer.
- Implementation is a *cap*, not a burn opcode: the coinbase allowance is
  `subsidy + total_fees / 4` (integer division). Fee value above the
  producer's claim is simply unclaimable and therefore destroyed — no
  special transaction type, no wire-format change.
- The mempool still prices fees normally; only the producer's claim is
  capped.

**Reference protocol:** EIP-1559's fee burn — sustained usage exerts
deflationary pressure on the circulating supply while still rewarding
producers.

## 8. Staking incentives & security budget

- The security budget per block = **subsidy + 25% of fees**.
- Admission is hybrid (Stage 3): **PoW** blocks require real hash work;
  **VRF-staked** blocks require a stake-weighted sortition win. Staked
  blocks pin nominal work so cheaply-inflatable blue weight stays out of
  chain selection — GHOSTDAG blue work (real PoW) remains the
  chain-selection work source.
- Bonded validators earn the same block reward as PoW miners when they
  win a slot, funded by the subsidy + fee share. The 10M treasury provides
  a long-term development budget independent of the declining subsidy.

## 9. Supply accounting

| Metric       | Definition                                                        |
|--------------|-------------------------------------------------------------------|
| `total`      | `native_minted` — cumulative minted (curve + premine + treasury)  |
| `circulating`| `total` − immature coinbases − unvested treasury tranches         |
| `burned`     | cumulative 75% fee burn                                           |

- `/api/head` reports subsidy, issuance, supply, and related fields.
- Prometheus series: `kovanica_supply_total`, `kovanica_supply_circulating`,
  `kovanica_supply_minted`, `kovanica_supply_burned`.

## 10. Activation & migration

- **Consensus fork.** RFC-006 changes block validity (emission curve,
  supply cap, coinbase maturity, fee burn) — the testnet **resets** at
  activation.
- **Checkpoint v6 → v7**: per-output coinbase flag (+1 byte/output) and
  the `native_minted` counter. Pre-v7 checkpoints decode with empty flags
  and `native_minted = 0` (acceptable: no legacy data survives a reset).
- **No transaction wire-format bump** — the sighash domain is untouched;
  only block/checkpoint semantics change.

## 11. Open questions & non-goals

- **Treasury key ceremony** — placeholder keys must be replaced with a
  real multi-party ceremony before mainnet.
- **Mainnet profile** — parameters are filled but the profile stays
  dormant until this RFC is reviewed and approved.
- **Fee floor tuning** — the `subsidy / 500_000` floor is a starting
  point; soak data may justify a different constant.
- **Non-goals:** no rebasing, no demurrage, no algorithmic stabilization
  of price, no governance token — KVNC is a pure ledger asset with a
  fixed, published issuance schedule.