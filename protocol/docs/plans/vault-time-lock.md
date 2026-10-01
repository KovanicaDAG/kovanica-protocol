# Time-Lock Vault / Escrow — RFC-005 (Slice 5B)

**Status:** ✅ SHIPPED (checkpoint commit `a470268` on `consensus/vault-rfc-005-csv`; draft PR open)
**Branch:** `consensus/vault-rfc-005-csv`
**Builds on:** RFC-004 HTLC (template + real CLTV enforcement), RFC-003 script v2 (CSV opcode, tx-level `sequence`), RFC-001 (versioned-hash template pattern), RFC-002 (per-asset outputs)
**Reference protocols:** Bitcoin BIP-65 (CLTV), BIP-68/BIP-112 (CSV / relative locktime), BIP-113 (height clock). BIP-68/BIP-112 were the deferred half of RFC-004 §5.2.

## 0. Decision

**Real CSV (relative locktime) + a dedicated Version `0x05` vault template.**

Two gaps force this design:

1. **CSV is decorative** — RFC-004 shipped real CLTV but deferred CSV: the
   ledger never records *when* a UTXO entered the set, so `sequence` is only
   checked inside script v2 against the raw field. BIP-68/BIP-112 relative
   locktime measures the age of the output being spent.
2. **No escrow primitive** — locking value until a height (inheritance timers,
   escrow releases, locked savings) needs a committed template + ledger
   enforcement, not a decorative script check.

**Format bump: checkpoint v6 only.** Every UTXO entry gains an 8-byte
`creation_height`. Snapshots (replay logs) and wire tx encoding are unchanged —
creation heights are recomputed on replay. Old checkpoints decode with
`creation_height = 0` (immediate unlock — safe, CSV only delays). **No testnet
reset.**

## 1. Vault representation

### Template (`VaultScript`, 40 bytes)

```
offset  size  field
0       4     unlock_height — u32 LE, absolute block height (CLTV-style); 0 = no absolute lock
4       4     csv           — u32 LE, relative blocks since this output's creation; 0 = no relative lock
8       32    owner_pk      — Ed25519 public key authorised to spend when unlocked
```

No version byte inside the template — the address version (`0x05`) is the
discriminator. `Address = 0x05 || BLAKE3(template)`, `kvnc…dag` rendering
unchanged. A template with both locks zero is invalid at parse (`NoLock`).

### Spend rule (both locks required)

- `block_height >= unlock_height` (absolute)
- `block_height >= creation_height + csv` (relative)

Equality (`>=`) is inclusive. Each lock is optional (0 = off) but at least one
must be set. Errors: `LedgerError::VaultAbsoluteNotReached` /
`VaultRelativeNotReached`. Activation: `VAULT_ACTIVATION_SCORE = 0` default;
pre-activation rejects `0x05` outputs/spends (`PreActivationVault`), coinbase
exempt.

## 2. Real CSV ledger rule

An input with `sequence != 0` is a relative block lock from its UTXO's creation
height. Final (no gate): `sequence == 0`, `sequence == u32::MAX`, or top bit
(`0x80000000`) set. Otherwise need
`block_height >= creation_height + sequence` (overflow pinned to `u64::MAX`).
Error: `NonFinalRelativeSequence`. This is a **transaction-finality rule** (like
RFC-004's CLTV fix) — not gated behind vault activation, active from genesis.

## 3. Implementation lanes

| Lane | Files | Status |
|---|---|---|
| L1 State: creation-height | `utxo.rs` (v6 entries) | ✅ |
| L2 Ledger: CSV + vault gates + checkpoint v6 | `ledger.rs` | ✅ |
| L3 Template | `vault.rs` (new) | ✅ |
| L4 Script doc fix | `script_v2.rs` | ✅ |
| L5 Node/RPC helpers | `node.rs`, `rpc.rs` | ✅ node/RPC; ⏳ FFI deferred |
| L6 Tests | `tests/vault.rs` (26), `tests/vault_node.rs` (5) | ✅ |
| L7 Docs | `AGENTS.md`, `KVP.md` (KVP-105), RFC-005, this plan | ✅ |

## 4. Hard-won lessons (do not re-litigate)

- **Chain height, not blue score.** CSV creation heights and absolute gates are
  **selected-parent chain heights**. Blue score counts *merged blue blocks* and
  exceeds chain height for mergeset blocks. The incremental `Ledger` tracks
  chain heights per block; `apply_dag` must compute the same values via
  `GhostdagData.selected_parent` + `Dag::linearize()`. `csv_grind_creation`
  regression-guards this parity.
- **The `>=` gate is equality-inclusive.** A release block sitting exactly at
  `unlock_height` / `creation_height + csv` is valid — measure "first release"
  expectations accordingly (a funding block consumes one height before an early
  release can even be attempted).
- **Coinbase outputs are exempt from the vault output gate** — the genesis
  block can freely seed a vault address for activation-boundary tests.
- **Node-side chain advancement needs `produce_empty`, not `produce_block`.**
  `produce_block` returns `Ok(None)` without inserting a block when the mempool
  is empty — tests that "extend the chain" with it hang. Use `produce_empty`.
- **FFI surface** for vaults is the deferred RFC-005 leftover (HTLC's FFI slice
  is the model); nothing about the ledger/checkpoint change blocks it.