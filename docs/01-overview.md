# 01 — Overview

> Values referenced here live in [`../protocol-params.toml`](../protocol-params.toml).
> `pending` values will change before mainnet.

## 1. Purpose

Kovanica is a Layer-1 blockchain whose blocks form a **directed acyclic graph
(DAG)** rather than a linear chain. A deterministic ordering procedure turns the
DAG into a sequence of committed leaders, and state transitions execute against
that sequence.

This document describes the system as implemented in the current reference
node. It is a public-testnet draft: parameters marked `pending` are expected to
change.

## 2. Layers

| Layer | Responsibility |
|-------|----------------|
| Network (P2P) | Plaintext TCP gossip of blocks, votes, transactions, seals; block and state sync |
| Consensus | Round structure, VRF leader election, DAG ordering (MysticGhost), commit |
| Execution | Deterministic WASM contract runtime and transaction effects |
| Ledger / staking | Accounts, balances, validator set, staking and rewards |

## 3. Rounds and waves

Time is measured in **rounds**. One round is `round_duration_ms`
(`consensus.round_duration_ms`). Rounds are grouped into **waves** of
`consensus.wave_length` rounds; a wave produces one committed leader, giving a
committed-leader interval of `consensus.committed_leader_interval_ms`.

In each round, an author (validator) proposes at most one block. A block
references parents from earlier rounds. Blocks that are not on the selected
path become "red"; the rest are "blue".

## 4. Leader election

The leader of a round is chosen with a **verifiable random function** (VRF).
Validators publish a VRF public key and prove their leader claim; the choice is
verifiable by any node and does not depend on a trusted scheduler. See
[`02-consensus.md`](./02-consensus.md).

## 5. Ordering and commit

**MysticGhost** is a GHOSTDAG-style greedy ordering with `consensus.ghostdag_k`.
It walks the DAG selecting the heaviest merge-set at each step, producing a
deterministic linear order. A leader and its wave are **committed** once enough
stake has voted: the quorum threshold is
`total_stake * consensus.quorum_numerator / 3 + 1`.

## 6. Execution

Committed leaders are executed in order. Transactions are typed
(`transaction.rs`): transfers, stakes and unstakes, delegation, reward claims,
contract deploy/call, light-node registration and witnesses, commission
changes, and treasury claims. Contract calls run in a deterministic WASM
runtime (wasmi) with a per-transaction gas limit and a per-block gas budget.

## 7. Native asset

The native asset is **KUNA** with `token.decimals` decimals and a total supply
of `token.total_supply`. Issuance follows a geometric decay schedule; see
[`06-tokenomics.md`](./06-tokenomics.md).

## 8. Validators

Validators bond a minimum stake (`staking.min_validator_stake`) to be eligible.
The active set is bounded by `staking.min_active_validators` and
`staking.max_active_validators`. See
[`04-validators-staking.md`](./04-validators-staking.md).

## 9. What is not yet stable

At this draft: fee burn split, minimum fee floor, coinbase maturity, minimum
delegation, and the mainnet genesis hash are all `pending`. They will be fixed
before mainnet and recorded in [`../PROTOCOL-CHANGES.md`](../PROTOCOL-CHANGES.md).
