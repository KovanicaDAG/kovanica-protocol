# 02 — Consensus

> Values referenced here live in [`../protocol-params.toml`](../protocol-params.toml).
> `pending` values will change before mainnet.

Kovanica consensus is a Mysticeti-style **uncertified DAG**. This document
describes rounds, leader election, voting, ordering and commit as implemented in
the current reference node.

## 1. Rounds

- One `round_duration_ms` (`consensus.round_duration_ms`) defines a round.
- `consensus.wave_length` rounds form a wave; a wave commits one leader, so the
  committed-leader interval is `consensus.committed_leader_interval_ms`.
- Each round, each validator may author at most one block. A block names parents
  from earlier rounds; the gap to the oldest parent is bounded by
  `consensus.max_parent_round_gap`.

## 2. Leader election

Leader election is **round-robin today**: the round leader is picked by the
deterministic rotation implemented in the node, not by a VRF. VRF leader
election (RFC 9381) is **specified and being finalized (pending)**:

- Each validator will register a VRF public key.
- The leader claim for a round will be proven against a VRF input derived from
  chain, round and the DAG beacon; the proof will be verifiable by any node.
- VRF leader election was reverted (`e0a2729`, `20857cf`) and the current
  genesis has no VRF keys, so `consensus.use_vrf_leader` is `pending` and
  leaders are round-robin until C1 + RFC 9381 test vectors land (C1, F23).

The round-robin rotation is a public, deterministic function of committed data,
so every node derives the same leader for the same round.

## 3. Voting

Validators vote for a leader hash in a round. A vote commits to
`(chain_id, epoch, voter, leader_round, leader_hash)` under the
`KUNA/vote/v1` domain (see [`08-addresses-keys.md`](./08-addresses-keys.md)).
The vote signature length is `wire.vote_signature_len`.

The **epoch** mixed into a vote is derived from the voted leader round
(`leader_round / epoch_rounds`), so it is identical on every node and stable
across a restart. A node verifies an incoming vote with the epoch of that vote's
own leader round, never with a boot-time value.

`consensus.late_vote_window_rounds` bounds how late a vote may arrive for a
leader the node has already moved past.

## 4. Ordering (MysticGhost)

**MysticGhost** is a GHOSTDAG-style greedy ordering with parameter
`consensus.ghostdag_k`:

1. Starting from the genesis block, repeatedly select the merge-set with the
   greatest "weight" (number of blue blocks in its past closure), breaking ties
   deterministically.
2. Walk the selected path; blocks in the merge-set that are not on the path are
   ordered as they are visited.
3. The result is a deterministic linear order of all blocks.

`consensus.ghostdag_k` must be `3` for the scoped MysticGhost rules to apply.
`consensus.max_mergeset_blocks` bounds the size of a merge-set considered in one
step.

## 5. Commit and quorum

A leader (and its wave) is **committed** when stake sufficient for quorum has
voted for it:

- `quorum_threshold = total_stake * consensus.quorum_numerator / 3 + 1`
- `validity_threshold = total_stake * consensus.validity_numerator / 3 + 1`

Thresholds are computed in wider arithmetic so large stake totals cannot
overflow.

## 6. Timeouts

- `consensus.leader_timeout_factor` sets the effective leader timeout as a
  multiple of `round_duration_ms`. When an explicit leader timeout is not set,
  the effective timeout is `round_duration_ms * leader_timeout_factor`.
- `consensus.lookahead_rounds` bounds how far ahead a node tracks rounds.
- `consensus.max_pending_rounds` and `consensus.prune_window_waves` are node
  buffer/retention bounds (`pending`: retunable without a protocol change).

## 7. Determinism

Consensus decisions depend only on committed data and pure functions of rounds
(leader choice, epoch derivation, thresholds). No wall-clock or local state
enters a consensus decision.
