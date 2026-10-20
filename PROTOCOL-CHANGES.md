# Protocol Changes

Append-only log of changes to published protocol parameters and specification.
Newest entries go at the top. Never rewrite or delete past entries.

Each entry records: the tag, the date, and what changed and why. Entries that
touch `protocol-params.toml` should say which parameters changed and whether a
`frozen` value was altered (a `frozen` value change is a protocol change and
must be called out explicitly).

---

## params-v0.1.0-draft — 2026-10-20

Initial draft of the public parameter set and specification.

- Published `protocol-params.toml` (schema 1, `protocol_version = "0.1.0-draft"`).
- Parameters inherited from the current `kovanica` node implementation
  (`5567bdfe3163e253c10dc63c736426815d891c4c`).
- `frozen` = values treated as stable for the public testnet.
- `pending` = values explicitly expected to change before mainnet; each carries
  a `pending_reason`.
- No value has yet been changed by a later published tag; this is the baseline.

### Decision: votes move to `KUNA/vote/v2` (Toni, 2026-10-20)

- Votes will move to domain `KUNA/vote/v2` with `genesis_hash` added to the
  signing preimage (106 B), per spec `00d` PR5.
- Current v1 preimage is 74 B: tag 16 + chain_id 8 + epoch 8 + voter 2 +
  leader_round 8 + leader_hash 32 (`crates/kovanica-types/src/vote.rs:30-50`).
- `wire.vote_domain` and `wire.vote_signature_len` are therefore `pending`
  (both will change). No `frozen` value was altered by this decision; both
  parameters were published as `pending` in this same draft.

### Planned (not yet a decision): block signature domain `KUNA/block/v2`

- A v2 block signature domain `KUNA/block/v2` with chain binding is **planned**
  in spec `00d` PR5 — this is a spec plan, not a made decision.
- Today the block signature has **no domain tag**: it is ed25519 over the raw
  32-byte `KVNC-BLOCK-v1` digest, with no chain_id/epoch
  (`crates/kovanica-dag/src/block_manager.rs:394`,
  `crates/kovanica-types/src/block.rs:56`).
- `wire.block_signature_domain` is published `pending`.
