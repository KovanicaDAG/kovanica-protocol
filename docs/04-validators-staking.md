# 04 — Validators & Staking

> Values referenced here live in [`../protocol-params.toml`](../protocol-params.toml).
> `pending` values will change before mainnet.

## 1. Becoming a validator

A validator bonds at least `staking.min_validator_stake` of KUNA. On joining, a
record is created with the validator's address, stake, commission, and (for
leader eligibility) a VRF public key.

## 2. Active set

The active validator set is:

- at least `staking.min_active_validators` (a floor for the network),
- at most `staking.max_active_validators`,
- selected by stake, with deterministic tie-breaking.

A validator is eligible only while active **and** holding at least
`staking.min_validator_stake`. Committee order (the authority-index ordering)
is: eligible validators sorted by stake descending, ties by address, truncated
to `staking.max_active_validators`, then re-sorted by address for stable index
assignment.

## 3. Epochs

An **epoch** is `staking.epoch_rounds` leader rounds. The committee for an epoch
is frozen at the epoch boundary: the first seal of an epoch records the
committee snapshot, and every seal and light-client check for that epoch uses
that snapshot. This keeps the committee hash stable within an epoch even if the
active set changes mid-epoch.

The epoch used in the consensus signing context is a pure function of the leader
round (`leader_round / epoch_rounds`).

## 4. Bonding and unbonding

- _Bond:_ add stake to an active validator's record.
- _Unbond:_ remove stake. If the remaining self-stake reaches zero the validator
  is deactivated. Unbonded stake is released after
  `staking.unbonding_rounds` rounds.

## 5. Going offline and re-entry

A validator that misses `staking.max_missed_leaders_before_offline` consecutive
leader rounds is marked offline (deactivated). There is **no automatic
refill**: an inactive validator is not silently replaced from a spare pool.

An inactive validator returns only by an **explicit stake transaction**:
re-staking at least `staking.min_validator_stake` reactivates the record,
resets the missed-leader counter, and respects
`staking.max_active_validators`. A record whose stake has fallen below the
minimum (for example after slashing) stays out of the committee.

## 6. Commission

A validator sets a commission in basis points, bounded by
`staking.max_commission_bps`. Commission may be changed at most once per
`staking.commission_change_cooldown`.

## 7. Slashing

Slashing is a **skeleton: pending**. A prototype (test-only, `staking.slash_pct_bps`)
exists, but there is no signed evidence handling, no jail/downtime mechanism, and
the percentage and destination are still open. Do not rely on slashing behaviour.

## 8. Rewards

Each committed leader pays the block reward to the committing leader. A share of
the reward is placed in the light-node escrow
(`emission.light_reward_bps`). See [`06-tokenomics.md`](./06-tokenomics.md).

## 9. Delegation

Delegation to a validator is supported. A minimum delegation bound
(`staking.min_delegation`) is **pending** and will be set before mainnet.
