# Time-Lock Vault / Escrow — RFC-005 (Slice 5.2)

**Status:** design locked, implementation in progress
**Branch:** `consensus/vault-rfc-005` (stacked on RFC-004 `c7fbbbe`)
**Reference protocols:** BIP-112 (CSV), BIP-68 (relative locktime), BIP-65/BIP-113 (CLTV), BIP-199 (HTLC), RFC-001/003/004 template + activation patterns, Bitcoin time-locked escrow / inheritance vaults, Lightning commitment delays.
**Files:** `crates/kovanica-state/src/vault.rs` (new), `crates/kovanica-state/tests/vault.rs` (new), plus `keys.rs`, `utxo.rs`, `ledger.rs`, `script_v2.rs`-adjacent changes, and 2 CSV test updates in `stealth_script_v2_consensus.rs`.
**Format bump:** checkpoint v5 → v6 (per-UTXO creation height). **No wire-format bump** (tx encoding, sighash, `kvnc…dag` rendering untouched).

---

## 1. Decision — dedicated `0x05` template (not script v2)

A dedicated, structurally-validated **72-byte template** with a new address version `0x05`, enforced by a direct ledger branch — exactly the RFC-004 HTLC pattern. Not a script v2 program.

**Why not script v2** (the same two gaps that forced the HTLC template, RFC-004 §2):
- **Commitment gap.** Script v2 has no immediate-data push — a script is a bare opcode sequence. A script-v2 "vault" commits to *nothing*: beneficiary key, owner key, and delays would live in the witness, spendable with any parameters.
- **Time-enforcement gap.** Even with CSV made real, script v2 cannot express "recovery only *before* the lock, claim only *after*" — the opcode set has no negation of a time check. The vault's mutually-exclusive paths need a ledger-level branch.

## 2. Template (`VaultScript`, 72 bytes)

```
offset  size  field
0       32    beneficiary_pk  — Ed25519 public key; claims after the lock expires
32      32    owner_pk        — Ed25519 public key; recovers before the lock expires
64      4     relative_delay  — u32 LE; blocks after deposit (CSV semantics)
68      4     absolute_time   — u32 LE; absolute block height (CLTV semantics)
```

- `VAULT_SCRIPT_LEN: usize = 72` (no version byte inside — the address version discriminates, mirroring HTLC).
- **Lock semantics (AND):** lock expired iff `height >= absolute_time` **AND** `height - created_at >= relative_delay`. Either field `0` disables that half: `relative_delay = 0` → pure CLTV vault; `absolute_time = 0` → pure CSV vault; both set → effective unlock `max(absolute_time, created_at + relative_delay)`.
- **Two mutually-exclusive spend paths**, discriminated by a **path byte** (explicit, auditable, one signature verification — both paths carry exactly one signature):
  - **CLAIM** (`VAULT_PATH_CLAIM = 0x01`): beneficiary signature; valid **only after** the lock expires.
  - **RECOVER** (`VAULT_PATH_RECOVER = 0x02`): owner signature; valid **only before** the lock expires.
  - At exactly the unlock height, claim wins, recovery rejected (strictly-before). Deterministic.
  - Path bytes `0x03+` reserved (future 2-of-2 / arbiter escrow) → rejected today with `InvalidVaultPath`.
- **Why recovery is time-limited to before expiry:** escrow soundness. If the owner could recover after expiry, the beneficiary's claim would race the owner's recovery and the seller could lose the payment. Recovery-before-expiry is the classic timelock-vault / inheritance / escrow shape. Pure single-party time-locked savings is already expressible with script v2 CLTV/CSV — the vault template is specifically the two-party case.

### Parse-time validation (`VaultScript::new` / `parse`)

```rust
pub enum VaultScriptError {
    WrongLength,            // "vault script must be 72 bytes"
    InvalidBeneficiaryKey,  // "invalid beneficiary public key"
    InvalidOwnerKey,        // "invalid owner public key"
    DuplicateKeys,          // "beneficiary and owner keys must differ"
}
```

with `as_str()` (static messages, embedded in `LedgerError::InvalidRedeemScript`), `Display`, `std::error::Error`. `new(beneficiary_pk: [u8;32], owner_pk: [u8;32], relative_delay: u32, absolute_time: u32)` validates: exact length, both keys valid Ed25519 points, keys distinct.

### Address version `0x05` (keys.rs)

```rust
pub const VERSION_VAULT: u8 = 0x05;
pub const VERSION_MAX: u8 = Self::VERSION_VAULT;   // 0x04 → 0x05

pub const fn vault(script_hash: [u8; 32]) -> Self;   // 0x05 || hash, 33 bytes
pub fn from_vault_script(script: &[u8]) -> Self;     // vault(BLAKE3(script))
pub const fn is_vault(&self) -> bool;
```

Update `version_max_is_htlc` → `version_max_is_vault`. `kvnc…dag` rendering, `from_slice`/`parse` version bounds, 33-byte owner field unchanged — **no wire-format bump**.

### Module contents (`vault.rs`)

```rust
pub const VAULT_SCRIPT_LEN: usize = 72;
pub const VAULT_PATH_CLAIM: u8 = 0x01;
pub const VAULT_PATH_RECOVER: u8 = 0x02;

pub struct VaultScript { bytes: [u8; VAULT_SCRIPT_LEN] }   // wrapper, like HtlcScript

impl VaultScript {
    pub fn new(beneficiary_pk: [u8; 32], owner_pk: [u8; 32],
               relative_delay: u32, absolute_time: u32) -> Result<Self, VaultScriptError>;
    pub fn parse(bytes: &[u8]) -> Result<Self, VaultScriptError>;
    pub fn bytes(&self) -> [u8; VAULT_SCRIPT_LEN];
    pub fn encode(&self) -> Vec<u8>;
    pub fn beneficiary_pk(&self) -> &[u8; 32];
    pub fn owner_pk(&self) -> &[u8; 32];
    pub fn relative_delay(&self) -> u32;
    pub fn absolute_time(&self) -> u32;
    pub fn script_hash(&self) -> [u8; 32];          // BLAKE3
    pub fn address(&self) -> Address;               // Address::from_vault_script
    pub fn claim_witness(&self, sig: [u8; 64]) -> Vec<Vec<u8>>;    // [template, 0x01, sig]
    pub fn recover_witness(&self, sig: [u8; 64]) -> Vec<Vec<u8>>;  // [template, 0x02, sig]
}
```

## 3. CSV becomes real (BIP-112) — per-UTXO creation-height tracking

The companion consensus fix the vault's `relative_delay` shares machinery with. Makes script v2's decorative CSV opcode (`0x03`, currently just `sequence >= v`) actually constrain when a spend can be mined.

### 3.1 The rule (BIP-68/BIP-112 generalization)

In `apply_regular`, per input, after the pre-activation spend gates and before the version branch:

```rust
// BIP-112/BIP-68 relative locktime: a transaction with `sequence > 0` is
// non-final unless every input's output is at least `sequence` blocks old.
// Combined with the script's CSV check (`tx.sequence >= v`), the effective
// constraint is `block_height - created_at >= sequence >= v`. `sequence == 0`
// means final (no relative constraint), matching every constructor's default.
if tx.sequence() > 0 {
    let created_at = staging
        .created_at_of(&input.outpoint)
        .ok_or(LedgerError::UnknownOutputAge { tx: tx.id(), input: i })?;
    let age = height.checked_sub(created_at).unwrap_or(0);   // fail-closed on invariant violation
    if age < u64::from(tx.sequence()) {
        return Err(LedgerError::SequenceNotFinal {
            tx: tx.id(), input: i, sequence: tx.sequence(), height, created_at,
        });
    }
}
```

- **Tx-level rule, all inputs** (kovanica has one `sequence` per tx, not per-input — the natural BIP-68 generalization): `sequence > 0` requires *every* input's output to be at least `sequence` blocks old. `sequence == 0` (every constructor's default) is final.
- **Composition with the script layer:** the script's CSV check (`sequence >= v`) still runs inside `ScriptV2::execute`; the consensus rule guarantees `age >= sequence`, so effective constraint `age >= sequence >= v`. Both layers must pass.
- **Placement after the activation gates** → a pre-activation vault/HTLC spend reports its activation error, not `SequenceNotFinal` — deterministic, keeps test diagnostics clean.
- **`UnknownOutputAge` unreachable in normal operation** — every output inserted via `add_outputs` gets a creation height. Exists only to fail closed on outputs decoded from pre-v6 checkpoints.

### 3.2 Where creation height lives — `UtxoSet` gains a parallel map

`crates/kovanica-state/src/utxo.rs`:

```rust
pub struct UtxoSet {
    map: HashMap<OutPoint, TxOutput>,
    /// Block height at which each output was created (BIP-112 relative
    /// locktime support). Every output in `map` has an entry here; the map is
    /// empty only for UTXO sets decoded from pre-v6 checkpoints.
    created_at: HashMap<OutPoint, u64>,
}

impl UtxoSet {
    pub fn insert(&mut self, op: OutPoint, out: TxOutput, created_at: u64) -> Option<TxOutput>;
    pub fn remove(&mut self, op: &OutPoint) -> Option<TxOutput>;
    pub fn get(&self, op: &OutPoint) -> Option<&TxOutput>;          // unchanged
    pub fn created_at_of(&self, op: &OutPoint) -> Option<u64>;      // new
    pub fn iter(&self) -> impl Iterator<Item = (&OutPoint, &TxOutput)>;  // unchanged
    pub fn encode(&self) -> Vec<u8>;                                // v6: +8 bytes/output
    pub fn encoded_len(&self) -> usize;                             // +8 per output
    pub fn decode(bytes: &mut &[u8], version: u16) -> Result<Self, UtxoDecodeError>;  // reads created_at iff version >= 6
}
```

- **Why NOT a `created_at` field on `TxOutput`:** `TxOutput` is in the canonical tx encoding and the **sighash domain**. Creation height is unknowable at signing time, so it cannot be signed — a field would split the encoding (signed vs stored) and bump the wire format. The parallel map keeps `TxOutput`, the tx encoding, and the sighash untouched.
- **Why NOT a separate `Ledger` map:** it would have to be maintained in parallel with `tip_state`, reconstructed from deltas, checkpointed separately, and pruned with finality — strictly more plumbing than the map living where the state lives.
- **Call-site churn is tiny:** `insert` callers are `add_outputs` (ledger.rs:1228), `apply_delta` (1485), and two utxo.rs unit tests. `decode` callers are `read_checkpoint_impl` (2707) and two utxo.rs unit tests. **Note:** `UtxoSet::decode` currently takes no version parameter — it must gain one (v6-aware).

### 3.3 Delta machinery — heights survive folding and reconstruction

`BlockDelta.created` gains the height so pruning/folding preserves it:

```rust
struct BlockDelta {
    spent: Vec<(OutPoint, TxOutput)>,
    created: Vec<(OutPoint, TxOutput, u64)>,   // u64 = creation height
}
```

- `diff_utxo(pre, post)`: for each created output, read `post.created_at_of(op)` (always `Some` — every output in a set has a height).
- `apply_delta`: `state.insert(*op, *out, *created_at)`.
- `compose_delta`: plain concatenation — heights ride along. **This is what makes `prune`'s delta folding correct**: a folded delta applied at a child's height would otherwise assign the child's height to outputs created by the pruned ancestor.
- `reconstruct_state` (checkpoint path) and `apply_new_block`'s mergeset application both go through `apply_delta`/`add_outputs` with real heights, so reconstruction is faithful.

### 3.4 Height threading and the checkpoint bump v5 → v6

- `add_outputs(staging, txid, tx, height)` — new `height` param. Callers: `apply_regular` (has `height`), `apply_coinbase` (thread `height` in — it currently receives only `blue_score`; the `height == blue_score` invariant holds for every block, but pass the honest value).
- **`apply_dag` fix (latent bug, must land in this slice):** `apply_dag` currently calls `apply_block_inner(..., 0, blue_score, ...)` — height 0 for every block. That makes the batch path reject *any* tx with `n_lock_time > 0` (CLTV) today, and would set every output's `created_at = 0` (CSV always passes) after this change. Fix: pass `blue_score` as the height — since `height == blue_score` for every block (both = selected-parent value + 1, by induction from genesis), this is exact. One-line change; also makes CLTV real in batch mode.
- **Checkpoint v6:** `CHECKPOINT_VERSION: u16 = 5 → 6`. `UtxoSet::encode` appends `created_at` (8 bytes LE) per output record (after the stealth flag). `decode(bytes, version)` reads it iff `version >= 6`. `read_checkpoint_impl` accepts `3..=6`. **Pre-v6 checkpoints load fine** but their outputs have unknown ages → any CSV spend of them fails closed with `UnknownOutputAge` (conservative: cannot prove the age, so the relative lock is treated as unsatisfied). Deterministic across nodes.
- **Snapshots need no change:** `read_snapshot_impl` replays via `insert_raw_block` (the incremental path), which recomputes heights — `created_at` is derived, never trusted from disk.

### 3.5 The DAG subtlety — creation height is the creating block's own height

**Rule: `created_at(output) = height(creating_block)`** — the creating block's own selected-chain height (its blue score), a property fixed at insert, identical in every node's view. The spending block's height is likewise fixed. The relative age `h_spender − h_creator` is a pure function of the two blocks — independent of linearization order, mergeset composition, or which branch later wins a re-org.

Why this is the only correct choice: in GHOSTDAG, if block B's output is in block S's view, B is an ancestor of S, and blue score is monotone along ancestry (`blue_score(S) ≥ blue_score(B)`), so `h_B ≤ h_S` — the age never underflows (the `checked_sub` is defensive only). A merged block's outputs get `created_at = merged block's height` (the mergeset application in `apply_new_block` already uses `merged_height` from the heights map). Deterministic, no wall-clock, no view-dependence.

## 4. CLTV/CSV composition in the template

- **AND semantics:** claim requires `height >= absolute_time` **and** `age >= relative_delay`. Conservative superset — pure CLTV (`relative_delay = 0`), pure CSV (`absolute_time = 0`), or both.
- **The general CLTV rule already landed** (`NonFinalTransaction`: `n_lock_time > height` rejected, BIP-65/BIP-113) — the vault's `absolute_time` check is a template-level constraint on top of it, exactly as HTLC's timeout is. A vault claim tx may additionally carry `n_lock_time`/`sequence`; those are orthogonal tx-level constraints that also apply.
- **Script v2 CLTV/CSV composition** (general case, unchanged by this slice): `CLTV` checks `n_lock_time >= v` + consensus rule `height >= n_lock_time`; `CSV` checks `sequence >= v` + new consensus rule `age >= sequence`. `AND`/`OR` opcodes compose them as before.

## 5. Activation gating

Mirror HTLC exactly:

- `pub const VAULT_ACTIVATION_SCORE: u64 = 0;` in `ledger.rs` (next to `HTLC_ACTIVATION_SCORE`).
- `Ledger` struct: new field `vault_activation_score: u64` (init `VAULT_ACTIVATION_SCORE` in `Ledger::new`).
- `pub fn set_vault_activation_score(&mut self, score: u64)` + `pub fn vault_activation_score(&self) -> u64` (mirror `set_htlc_activation_score`/`htlc_activation_score`, ledger.rs:1750-1757).
- Threaded through `apply_regular` → `apply_block_inner` → `apply_new_block` (both the mergeset application and the block's own txs) → `apply_block` / `apply_block_with_stake` / `apply_dag` (pass `VAULT_ACTIVATION_SCORE` default, same as the other five scores).
- **Outputs:** `if blue_score <= vault_activation_score { for output in tx.outputs() { if output.owner.is_vault() { return Err(PreActivationVault { ... }) } } }` — placed after the HTLC gate.
- **Spends:** `if blue_score <= vault_activation_score && prev.owner.is_vault() { return Err(PreActivationVault { ... }) }` — placed after the HTLC spend gate.
- **Coinbase exempt:** `apply_coinbase` does not check vault (mirroring HTLC/stealth/script-v2) — genesis can fund a vault address directly, which the test suite relies on.
- **Not persisted** in snapshots/checkpoints (runtime policy, like all five existing scores).

## 6. `LedgerError` variants + spend-branch shape

### 6.1 New variants

```rust
/// RFC-005 vault output/spend attempted before activation.
PreActivationVault { tx: TxId, blue_score: u64, activation_score: u64 },
/// RFC-005 vault claim attempted before the lock expired.
VaultLockNotExpired { tx: TxId, input: usize, height: u64, created_at: u64,
                      absolute_time: u32, relative_delay: u32 },
/// RFC-005 vault recovery attempted after the lock expired.
VaultLockExpired { tx: TxId, input: usize, height: u64, created_at: u64,
                   absolute_time: u32, relative_delay: u32 },
/// RFC-005 vault witness carried an unknown path byte.
InvalidVaultPath { tx: TxId, input: usize, path: u8 },
/// BIP-112: a transaction with `sequence > 0` spent an output younger than `sequence`.
SequenceNotFinal { tx: TxId, input: usize, sequence: u32, height: u64, created_at: u64 },
/// BIP-112: an output's creation height is unknown (pre-v6 checkpoint).
UnknownOutputAge { tx: TxId, input: usize },
```

### 6.2 The vault branch in `apply_regular`

Slots in after the HTLC branch (`else if prev.owner.is_htlc() { … }`), before `is_stealth()`. Order of checks mirrors HTLC (witness-empty → hash → parse → discriminator → sig size → time → verify):

```rust
} else if prev.owner.is_vault() {
    // Pay-to-Vault (RFC-005): witness[0] = template bytes; BLAKE3(template)
    // must match the owner's script hash; the template then authorises one of
    // two mutually-exclusive paths discriminated by a path byte — deterministic,
    // no branch evaluation:
    //   path 0x01 → CLAIM (beneficiary signature, only after the lock expires)
    //   path 0x02 → RECOVER (owner signature, only before the lock expires)
    if input.witness.is_empty() {
        return Err(LedgerError::InvalidWitnessCount { tx: tx.id(), input: i, expected: 3, actual: 0 });
    }
    let template_bytes = &input.witness[0];
    let script_hash = *blake3::hash(template_bytes).as_bytes();
    if script_hash != *prev.owner.payload() {
        return Err(LedgerError::ScriptHashMismatch { tx: tx.id(), input: i });
    }
    let script = VaultScript::parse(template_bytes).map_err(|e| {
        LedgerError::InvalidRedeemScript { tx: tx.id(), input: i, reason: e.as_str() }
    })?;
    if input.witness.len() != 3 {
        return Err(LedgerError::InvalidWitnessCount { tx: tx.id(), input: i, expected: 3, actual: input.witness.len() });
    }
    let sig_bytes = &input.witness[2];
    if sig_bytes.len() != 64 {
        return Err(LedgerError::BadSignatureSize { tx: tx.id(), input: i, len: sig_bytes.len() });
    }
    let created_at = staging.created_at_of(&input.outpoint)
        .ok_or(LedgerError::UnknownOutputAge { tx: tx.id(), input: i })?;
    let age = height.checked_sub(created_at).unwrap_or(0);
    let lock_expired = height >= u64::from(script.absolute_time())
        && age >= u64::from(script.relative_delay());
    match input.witness[1] {
        VAULT_PATH_CLAIM => {
            if !lock_expired {
                return Err(LedgerError::VaultLockNotExpired { tx: tx.id(), input: i, height, created_at,
                    absolute_time: script.absolute_time(), relative_delay: script.relative_delay() });
            }
            let mut sig_arr = [0u8; 64];
            sig_arr.copy_from_slice(sig_bytes);
            if !verify_pk(script.beneficiary_pk(), &sighash, &sig_arr) {
                return Err(LedgerError::BadSignature { tx: tx.id(), input: i });
            }
        }
        VAULT_PATH_RECOVER => {
            if lock_expired {
                return Err(LedgerError::VaultLockExpired { tx: tx.id(), input: i, height, created_at,
                    absolute_time: script.absolute_time(), relative_delay: script.relative_delay() });
            }
            let mut sig_arr = [0u8; 64];
            sig_arr.copy_from_slice(sig_bytes);
            if !verify_pk(script.owner_pk(), &sighash, &sig_arr) {
                return Err(LedgerError::BadSignature { tx: tx.id(), input: i });
            }
        }
        path => return Err(LedgerError::InvalidVaultPath { tx: tx.id(), input: i, path }),
    }
}
```

Conservation, fees, stake rules, and `add_outputs` are untouched (vault outputs are ordinary `TxOutput`s; `asset_id` is orthogonal).

## 7. Test plan

### 7.1 `crates/kovanica-state/tests/vault.rs` (~29 tests)

Mirror the `htlc.rs` suite structure (helpers: `generate_key`, `make_vault`, `vault_funded_ledger` — genesis coinbase funds a vault address directly, `build_vault_claim` / `build_vault_recover` with a dummy-input-then-sign pattern).

**Template & address (4):** roundtrip (`new`/`parse`/`bytes`/`hash`/`address`); wrong length → `WrongLength`; invalid beneficiary/owner key → `InvalidBeneficiaryKey`/`InvalidOwnerKey`; duplicate keys → `DuplicateKeys`.

**Claim path (5):** claim after pure-CSV delay (mine `relative_delay` blocks, then claim ✓); claim before delay → `VaultLockNotExpired`; claim after pure-CLTV time ✓; claim before time → `VaultLockNotExpired`; **AND semantics** — `relative_delay=10, absolute_time=20`, claim at height 15 rejected, at height 20 ✓.

**Recovery path (4):** recover before lock ✓; recover after lock → `VaultLockExpired`; recover at exact boundary (height == unlock) rejected (claim wins); beneficiary sig on recover path → `BadSignature`.

**Witness anomalies (5):** bad path byte `0x03` → `InvalidVaultPath`; wrong witness count (2 or 4 elements) → `InvalidWitnessCount`; bad sig size → `BadSignatureSize`; template hash mismatch → `ScriptHashMismatch`; malformed template bytes → `InvalidRedeemScript`.

**Activation gating (3):** `set_vault_activation_score(10)` — vault output in a regular tx at `blue_score ≤ 10` → `PreActivationVault`; vault spend at `blue_score ≤ 10` → `PreActivationVault`; genesis coinbase funding a vault address exempt (the `vault_funded_ledger` helper itself proves it).

**CSV consensus rule (4):** `sequence=10` spending a 2-block-old output → `SequenceNotFinal`; same tx after 10 blocks ✓; `sequence=0` always final; unknown-age output (constructed via `UtxoSet::decode(version=5)`) spent with `sequence > 0` → `UnknownOutputAge`.

**Parallel-DAG (2):** two parallel blocks both claim the same vault output — one applies, the other `MissingInput`; parallel claim (after lock) vs recover (before lock) — only the valid one applies.

**Checkpoint/snapshot (2):** `write_checkpoint`/`read_checkpoint` roundtrip preserves `created_at` (a CSV spend still enforced after restore); `write_snapshot`/`read_snapshot` roundtrip likewise (replay recomputes heights).

### 7.2 Updates to existing tests (same commit — they break otherwise)

`crates/kovanica-state/tests/stealth_script_v2_consensus.rs`:
- `test_script_v2_csv_spend` (sequence=100, v=50, spends at height 1): now rejected with `SequenceNotFinal` (age 1 < 100). **Fix:** mine 100 blocks first, then spend — the test now exercises the full BIP-112 composition (`age ≥ sequence ≥ v`).
- `test_script_v2_csv_rejected` (sequence=50, v=100): now rejected with `SequenceNotFinal` before the script runs. **Fix:** mine 100 blocks, then spend with `sequence=100, v=150` → script fails → `BadSignature`.

(The two CLTV tests were already updated to real semantics in RFC-004 — no further change.)

### 7.3 Unit tests

- `utxo.rs`: `created_at` roundtrip (insert/`created_at_of`/remove); `encode`/`decode(version=6)` roundtrip preserves heights; `decode(version=5)` leaves `created_at` empty.
- `keys.rs`: `version_max_is_vault`; `Address::vault`/`from_vault_script`/`is_vault` roundtrip.
- `ledger.rs` (internal): `diff_utxo`/`apply_delta`/`compose_delta` preserve heights through fold (extend the existing prune tests).

## 8. Scope split — non-overlapping lanes

**Lane A — state core (consensus; the reviewable risk):**
- `vault.rs` (new), `keys.rs` (version 0x05), `utxo.rs` (created_at map + v6 encode/decode), `ledger.rs` (activation score, vault branch, CSV rule, `BlockDelta.created`, `CHECKPOINT_VERSION=6`, `apply_dag` height fix, 6 new error variants), `tests/vault.rs` (new), the 2 CSV test updates, unit tests.

**Lane B — docs (can land in parallel, no code overlap):**
- `docs/RFC-005-Vault.md` (mirror RFC-004's structure: overview → decision → representation → consensus rules → CSV companion fix → test summary → follow-ups), `AGENTS.md` RFC-005 section + roadmap checkbox, `SOURCE_OF_TRUTH.md` §5.2 mark landed.

**Lane C — node/FFI surface: NOT warranted for this slice — defer.** Rationale: the 5.2 spec lists only `vault.rs` + `tests/vault.rs`; the consensus core is where the correctness risk lives and where review should focus; the node surface (`create_vault`/`claim_vault`/`recover_vault`/`balance_of_vault`, RPC, FFI) is mechanical and can land as a follow-up without any consensus change.

## 9. Risks & invariants (do not break)

1. **Determinism:** creation height = the creating block's own height (blue score) — a pure function of the DAG, never the linearization position or wall-clock. The vault time checks use block height only.
2. **`height == blue_score` invariant** underpins the `apply_dag` fix (pass `blue_score` as height) and `apply_coinbase`'s height threading. Do not "fix" one without the other.
3. **Checkpoint v6 is a format bump:** old readers misparse v6 checkpoints (trailing 8 bytes per record). v3–v5 checkpoints still load; their outputs have unknown ages and CSV spends of them fail closed (`UnknownOutputAge`). Do not default unknown ages to 0 — that would silently disable the relative lock.
4. **No wire-format bump:** tx encoding, sighash, and `kvnc…dag` rendering are untouched (owner stays 33 opaque bytes). `TxOutput` must NOT gain a `created_at` field — it would split the sighash domain.
5. **Identity-preserving replay:** no new block fields, so no VRF-style replay hazard — but keep using `insert_raw_block`/`insert_prepared_block` for snapshot/checkpoint replay as today.
6. **The CSV consensus rule changes existing test expectations** — the two `stealth_script_v2_consensus.rs` CSV tests must be updated in the same commit as the rule, or CI breaks.
7. **Activation default 0:** vault is active from genesis on new testnets. The live testnet must set `VAULT_ACTIVATION_SCORE` before any vault output appears (same discipline as HTLC).
8. **Overflow hygiene:** `age = height.checked_sub(created_at).unwrap_or(0)` (fail-closed on the invariant `created_at ≤ height`); the vault's `created_at + relative_delay` comparison is done as two independent `>=` checks, no addition.
9. **Error precedence is deterministic:** activation gates → CSV rule → version branch → witness shape → time → signature. Any order is consensus-safe, but tests assert specific errors — keep this order.
10. **Coinbase exemption:** vault outputs in coinbase bypass the output gate (genesis funding pattern). Do not add vault to `apply_coinbase`'s checks.
11. **Recovery is strictly before expiry; claim wins at the boundary** (`height == unlock`). This is what makes escrow sound — do not "relax" recovery to anytime without re-deriving the escrow safety argument.