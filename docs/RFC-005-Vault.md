# RFC-005 — Time-Lock Vault / Escrow (5.2)

- **Status:** Specification (design locked; implementation in progress on branch `consensus/vault-rfc-005`)
- **Reference implementation:** `crates/kovanica-state/src/vault.rs`, `crates/kovanica-state/src/keys.rs`,
  `crates/kovanica-state/src/utxo.rs`, `crates/kovanica-state/src/ledger.rs`
- **Consensus test suite:** `crates/kovanica-state/tests/vault.rs` (~29 tests)
- **Updated tests:** `crates/kovanica-state/tests/stealth_script_v2_consensus.rs` (2 CSV tests → real BIP-112 semantics)
- **Activation:** gated on blue score (see [Activation gating](#6-activation-gating))
- **Format bump:** **checkpoint v5 → v6** (per-UTXO creation height); **no wire-format bump** — no testnet reset (see [Wire & persistence](#8-wire--persistence))

This document is the specification that the time-lock vault / escrow code in
`kovanica-state` references as "RFC-005". It describes the `v0x05` vault
address format, the 72-byte vault template, the two mutually-exclusive spend
paths (claim / recover), the companion CSV enforcement fix (BIP-112/BIP-68)
with per-UTXO creation-height tracking, and the checkpoint v6 bump. The design
is locked; the implementation lanes are dispatched and must match this spec —
do not change the formats here without changing the code, and vice versa.

**Reference protocols:** BIP-112 (CSV), BIP-68 (relative locktime), BIP-65/BIP-113
(CLTV), BIP-199 (HTLC), RFC-001/003/004 template + activation patterns, Bitcoin
time-locked escrow / inheritance vaults, Lightning commitment delays.

---

## 1. Overview

This RFC ships **one consensus upgrade** — the time-lock vault / escrow
(slice 5.2) — plus a **companion consensus fix** that makes script v2's CSV
opcode real (BIP-112/BIP-68). The two are separable commits; the vault
template does not depend on the CSV fix, but the fix is required for the
vault's `relative_delay` half to be meaningful on-chain (see §5).

A **time-lock vault / escrow** locks value behind a two-party time contract:

- the **beneficiary** can **claim** the funds **after** the lock expires
  (payment / inheritance / escrow release), and
- the **owner** can **recover** the funds **strictly before** the lock expires
  (escrow cancellation / inheritance revocation).

The lock is an **AND** of two independent halves — an absolute height
(`absolute_time`, CLTV semantics) and a relative delay since deposit
(`relative_delay`, CSV semantics) — so a vault can be a pure CLTV vault, a
pure CSV vault, or both. The two spend paths are mutually exclusive and
discriminated by an explicit **path byte**, so the ledger enforces them
directly with no script interpreter in the consensus path.

The design follows the RFC-004 HTLC pattern exactly: a **dedicated,
structurally validated template** with a **new address version `0x05`**,
rather than an extension of script v2. The template commits to all four vault
parameters (beneficiary pk, owner pk, relative delay, absolute time) via the
script hash; the ledger branches on owner version and enforces the two paths.

**Design rationale (dedicated template, not script v2):** two gaps in the
current code force a dedicated template — see [§2](#2-decision--a-dedicated-0x05-template-not-a-script-v2-extension).

---

## 2. Decision — a dedicated `0x05` template, not a script v2 extension

The vault is **not** expressed as a script-v2 program. It is a dedicated
72-byte template with its own address version `0x05`, validated at parse time
and enforced directly by the ledger — exactly the RFC-004 HTLC pattern.

Two gaps in the current code force this design:

### 2.1 Commitment gap

Script v2 has **no immediate-data push** — a script is a bare opcode sequence.
A script-v2 "vault" would commit to *nothing*: the beneficiary key, the owner
key, and the delays would live in the witness, spendable with any parameters.
The dedicated template commits to all four parameters via
`BLAKE3(template_bytes)`.

### 2.2 Time-enforcement gap

Even with CSV made real, script v2 **cannot express "recovery only *before*
the lock, claim only *after*"** — the opcode set has no negation of a time
check. The vault's mutually-exclusive paths need a ledger-level branch: the
ledger must reject a claim before expiry *and* a recovery after expiry, which
is a two-sided time constraint no single script-v2 program can state. The
dedicated template's path byte makes the branch deterministic and auditable.

### 2.3 Why not reuse version `0x02` or `0x04`?

The owner version byte is the discriminator. Under `0x02` the ledger would have
to distinguish a vault template from a script-v2 program by content; under
`0x04` it would have to distinguish it from an HTLC template — a coincidental
72-byte parse would misclassify. A dedicated version keeps the branch
unambiguous: `is_vault()` is a single byte check, and a cross-version spend
fails deterministically.

---

## 3. Vault representation

### 3.1 Template (`VaultScript`, 72 bytes)

```
offset  size  field
0       32    beneficiary_pk  — Ed25519 public key; claims after the lock expires
32      32    owner_pk        — Ed25519 public key; recovers before the lock expires
64      4     relative_delay  — u32 LE; blocks after deposit (CSV semantics)
68      4     absolute_time   — u32 LE; absolute block height (CLTV semantics)
```

- `VAULT_SCRIPT_LEN: usize = 72` — **no version byte inside** the template;
  the address version (`0x05`) is the discriminator, mirroring HTLC.
- **Lock semantics (AND):** lock expired iff `height >= absolute_time` **AND**
  `height - created_at >= relative_delay`. Either field `0` disables that half:
  - `relative_delay = 0` → pure CLTV vault (absolute-time only);
  - `absolute_time = 0` → pure CSV vault (relative-delay only);
  - both set → effective unlock `max(absolute_time, created_at + relative_delay)`.
- `created_at` is the **creating block's own height** (see §5.5) — a pure
  function of the DAG, never wall-clock.

### 3.2 The two spend paths

Two **mutually-exclusive spend paths**, discriminated by a **path byte**
(explicit, auditable, one signature verification — both paths carry exactly one
signature):

- **CLAIM** (`VAULT_PATH_CLAIM = 0x01`): beneficiary signature; valid **only
  after** the lock expires.
- **RECOVER** (`VAULT_PATH_RECOVER = 0x02`): owner signature; valid **only
  before** the lock expires.
- At exactly the unlock height, **claim wins, recovery is rejected**
  (strictly-before). Deterministic.
- Path bytes `0x03+` are **reserved** (future 2-of-2 / arbiter escrow) →
  rejected today with `InvalidVaultPath`.

**Why recovery is time-limited to before expiry:** escrow soundness. If the
owner could recover after expiry, the beneficiary's claim would race the
owner's recovery and the seller could lose the payment. Recovery-before-expiry
is the classic timelock-vault / inheritance / escrow shape. Pure single-party
time-locked savings is already expressible with script v2 CLTV/CSV — the vault
template is specifically the **two-party** case.

### 3.3 Address version `0x05`

```rust
pub const VERSION_VAULT: u8 = 0x05;
pub const VERSION_MAX: u8 = Self::VERSION_VAULT;   // 0x04 → 0x05

pub const fn vault(script_hash: [u8; 32]) -> Self;   // 0x05 || hash, 33 bytes
pub fn from_vault_script(script: &[u8]) -> Self;     // vault(BLAKE3(script))
pub const fn is_vault(&self) -> bool;
```

- Same shape as P2SH (`0x01`), script v2 (`0x02`), and HTLC (`0x04`): a 32-byte
  BLAKE3 digest of the template, not the template itself. The template is
  revealed at spend time in the witness (§4.3).
- Rendering unchanged: `kvnc…dag` (base58 over the 33 bytes), indistinguishable
  in shape from every other address; `Address::parse` accepts 66-hex or
  `kvnc…dag`.
- `VERSION_MAX` bump means old nodes reject version `0x05` at parse — a soft
  incompatibility handled by activation gating (§6). The
  `version_max_is_htlc` unit test in `keys.rs` is updated to
  `version_max_is_vault`.
- `from_slice`/`parse` version bounds and the 33-byte owner field are
  unchanged — **no wire-format bump**.

### 3.4 Parse-time validation (`VaultScript::new` / `parse`)

```rust
pub enum VaultScriptError {
    WrongLength,            // "vault script must be 72 bytes"
    InvalidBeneficiaryKey,  // "invalid beneficiary public key"
    InvalidOwnerKey,        // "invalid owner public key"
    DuplicateKeys,          // "beneficiary and owner keys must differ"
}
```

with `as_str()` (static messages, embedded in `LedgerError::InvalidRedeemScript`),
`Display`, `std::error::Error`. `new(beneficiary_pk: [u8;32], owner_pk: [u8;32],
relative_delay: u32, absolute_time: u32)` validates: exact length, both keys
valid Ed25519 points, keys distinct.

### 3.5 Module contents (`vault.rs`)

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

---

## 4. Consensus rules

### 4.1 AND lock semantics

A vault output is spendable by **claim** iff:

```text
height >= absolute_time  AND  height - created_at >= relative_delay
```

- `relative_delay = 0` → the relative half always passes (pure CLTV vault).
- `absolute_time = 0` → the absolute half always passes (pure CSV vault).
- Both set → effective unlock `max(absolute_time, created_at + relative_delay)`.
- The comparison is done as **two independent `>=` checks, no addition** —
  overflow hygiene (see §9.8).

### 4.2 Spend authorization — the two paths

The ledger branches in `apply_regular`, slotting in after the HTLC branch
(`else if prev.owner.is_htlc() { … }`) and before `is_stealth()`. Order of
checks mirrors HTLC (witness-empty → hash → parse → discriminator → sig size →
time → verify):

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

- **Claim wins at the boundary:** at exactly the unlock height, `lock_expired`
  is true, so claim passes and recovery is rejected (`VaultLockExpired`) —
  strictly-before semantics, deterministic.
- **Both paths carry exactly one signature** verified with `verify_pk`
  (stealth's strict Ed25519 verifier against a raw 32-byte pubkey).
- Conservation, fees, stake rules, and `add_outputs` are untouched — vault
  outputs are ordinary `TxOutput`s; `asset_id` is orthogonal (RFC-002).

### 4.3 New `LedgerError` variants

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

Reused from RFC-001/003/004: `ScriptHashMismatch`, `InvalidRedeemScript`,
`InvalidWitnessCount`, `BadSignatureSize`, `BadSignature`.

---

## 5. Companion consensus fix — CSV becomes real (BIP-112/BIP-68)

The companion fix the vault's `relative_delay` half shares machinery with.
Makes script v2's decorative CSV opcode (`0x03`, currently just
`sequence >= v`) actually constrain when a spend can be mined.

### 5.1 The rule (BIP-68/BIP-112 generalization)

In `apply_regular`, per input, **after the pre-activation spend gates and
before the version branch**:

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

- **Tx-level rule, all inputs** (kovanica has one `sequence` per tx, not
  per-input — the natural BIP-68 generalization): `sequence > 0` requires
  *every* input's output to be at least `sequence` blocks old. `sequence == 0`
  (every constructor's default) is final.
- **Composition with the script layer:** the script's CSV check
  (`sequence >= v`) still runs inside `ScriptV2::execute`; the consensus rule
  guarantees `age >= sequence`, so the effective constraint is
  `age >= sequence >= v`. Both layers must pass.
- **Placement after the activation gates** → a pre-activation vault/HTLC spend
  reports its activation error, not `SequenceNotFinal` — deterministic, keeps
  test diagnostics clean.
- **`UnknownOutputAge` is unreachable in normal operation** — every output
  inserted via `add_outputs` gets a creation height. It exists only to fail
  closed on outputs decoded from pre-v6 checkpoints.

### 5.2 Where creation height lives — `UtxoSet` gains a parallel map

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

- **Why NOT a `created_at` field on `TxOutput`:** `TxOutput` is in the
  canonical tx encoding and the **sighash domain**. Creation height is
  unknowable at signing time, so it cannot be signed — a field would split the
  encoding (signed vs stored) and bump the wire format. The parallel map keeps
  `TxOutput`, the tx encoding, and the sighash untouched.
- **Why NOT a separate `Ledger` map:** it would have to be maintained in
  parallel with `tip_state`, reconstructed from deltas, checkpointed
  separately, and pruned with finality — strictly more plumbing than the map
  living where the state lives.
- **Call-site churn is tiny:** `insert` callers are `add_outputs`,
  `apply_delta`, and two utxo.rs unit tests. `decode` callers are
  `read_checkpoint_impl` and two utxo.rs unit tests. **Note:** `UtxoSet::decode`
  currently takes no version parameter — it must gain one (v6-aware).

### 5.3 Delta machinery — heights survive folding and reconstruction

`BlockDelta.created` gains the height so pruning/folding preserves it:

```rust
struct BlockDelta {
    spent: Vec<(OutPoint, TxOutput)>,
    created: Vec<(OutPoint, TxOutput, u64)>,   // u64 = creation height
}
```

- `diff_utxo(pre, post)`: for each created output, read `post.created_at_of(op)`
  (always `Some` — every output in a set has a height).
- `apply_delta`: `state.insert(*op, *out, *created_at)`.
- `compose_delta`: plain concatenation — heights ride along. **This is what
  makes `prune`'s delta folding correct**: a folded delta applied at a child's
  height would otherwise assign the child's height to outputs created by the
  pruned ancestor.
- `reconstruct_state` (checkpoint path) and `apply_new_block`'s mergeset
  application both go through `apply_delta`/`add_outputs` with real heights, so
  reconstruction is faithful.

### 5.4 Height threading and the checkpoint bump v5 → v6

- `add_outputs(staging, txid, tx, height)` — new `height` param. Callers:
  `apply_regular` (has `height`), `apply_coinbase` (thread `height` in — it
  currently receives only `blue_score`; the `height == blue_score` invariant
  holds for every block, but pass the honest value).
- **`apply_dag` fix (latent bug, must land in this slice):** `apply_dag`
  currently calls `apply_block_inner(..., 0, blue_score, ...)` — height 0 for
  every block. That makes the batch path reject *any* tx with `n_lock_time > 0`
  (CLTV) today, and would set every output's `created_at = 0` (CSV always
  passes) after this change. Fix: pass `blue_score` as the height — since
  `height == blue_score` for every block (both = selected-parent value + 1, by
  induction from genesis), this is exact. One-line change; also makes CLTV real
  in batch mode.
- **Checkpoint v6:** `CHECKPOINT_VERSION: u16 = 5 → 6`. `UtxoSet::encode`
  appends `created_at` (8 bytes LE) per output record (after the stealth flag).
  `decode(bytes, version)` reads it iff `version >= 6`. `read_checkpoint_impl`
  accepts `3..=6`. **Pre-v6 checkpoints load fine** but their outputs have
  unknown ages → any CSV spend of them fails closed with `UnknownOutputAge`
  (conservative: cannot prove the age, so the relative lock is treated as
  unsatisfied). Deterministic across nodes.
- **Snapshots need no change:** `read_snapshot_impl` replays via
  `insert_raw_block` (the incremental path), which recomputes heights —
  `created_at` is derived, never trusted from disk.

### 5.5 The DAG subtlety — creation height is the creating block's own height

**Rule: `created_at(output) = height(creating_block)`** — the creating block's
own selected-chain height (its blue score), a property fixed at insert,
identical in every node's view. The spending block's height is likewise fixed.
The relative age `h_spender − h_creator` is a pure function of the two blocks —
independent of linearization order, mergeset composition, or which branch later
wins a re-org.

Why this is the only correct choice: in GHOSTDAG, if block B's output is in
block S's view, B is an ancestor of S, and blue score is monotone along
ancestry (`blue_score(S) ≥ blue_score(B)`), so `h_B ≤ h_S` — the age never
underflows (the `checked_sub` is defensive only). A merged block's outputs get
`created_at = merged block's height` (the mergeset application in
`apply_new_block` already uses `merged_height` from the heights map).
Deterministic, no wall-clock, no view-dependence.

### 5.6 CLTV/CSV composition in the template

- **AND semantics:** claim requires `height >= absolute_time` **and**
  `age >= relative_delay`. Conservative superset — pure CLTV
  (`relative_delay = 0`), pure CSV (`absolute_time = 0`), or both.
- **The general CLTV rule already landed** (`NonFinalTransaction`:
  `n_lock_time > height` rejected, BIP-65/BIP-113, RFC-004 §5) — the vault's
  `absolute_time` check is a template-level constraint on top of it, exactly as
  HTLC's timeout is. A vault claim tx may additionally carry `n_lock_time`/
  `sequence`; those are orthogonal tx-level constraints that also apply.
- **Script v2 CLTV/CSV composition** (general case, unchanged by this slice):
  `CLTV` checks `n_lock_time >= v` + consensus rule `height >= n_lock_time`;
  `CSV` checks `sequence >= v` + new consensus rule `age >= sequence`.
  `AND`/`OR` opcodes compose them as before.

---

## 6. Activation gating

Mirror HTLC exactly:

- `pub const VAULT_ACTIVATION_SCORE: u64 = 0;` in `ledger.rs` (next to
  `HTLC_ACTIVATION_SCORE`).
- `Ledger` struct: new field `vault_activation_score: u64` (init
  `VAULT_ACTIVATION_SCORE` in `Ledger::new`).
- `pub fn set_vault_activation_score(&mut self, score: u64)` +
  `pub fn vault_activation_score(&self) -> u64` (mirror
  `set_htlc_activation_score`/`htlc_activation_score`).
- Threaded through `apply_regular` → `apply_block_inner` → `apply_new_block`
  (both the mergeset application and the block's own txs) → `apply_block` /
  `apply_block_with_stake` / `apply_dag` (pass `VAULT_ACTIVATION_SCORE` default,
  same as the other five scores).
- **Outputs:** `if blue_score <= vault_activation_score { for output in
  tx.outputs() { if output.owner.is_vault() { return Err(PreActivationVault
  { ... }) } } }` — placed after the HTLC gate.
- **Spends:** `if blue_score <= vault_activation_score && prev.owner.is_vault()
  { return Err(PreActivationVault { ... }) }` — placed after the HTLC spend
  gate.
- **Coinbase exempt:** `apply_coinbase` does not check vault (mirroring
  HTLC/stealth/script-v2) — genesis can fund a vault address directly, which
  the test suite relies on.
- **Not persisted** in snapshots/checkpoints (runtime policy, like all five
  existing scores).

The gate is **inclusive**: a block is *pre-activation* when
`blue_score <= vault_activation_score`. Post-activation, vault outputs may be
created and spent normally; P2PK/P2SH/script-v2/stealth/HTLC outputs remain
valid forever.

---

## 7. Test coverage summary

Reference protocols named in the suite header: **BIP-112**, **BIP-68**,
**BIP-65/BIP-113**, **BIP-199**, **RFC-001/003/004** patterns.

### 7.1 `crates/kovanica-state/tests/vault.rs` (~29 tests)

Mirrors the `htlc.rs` suite structure (helpers: `generate_key`, `make_vault`,
`vault_funded_ledger` — genesis coinbase funds a vault address directly,
`build_vault_claim` / `build_vault_recover` with a dummy-input-then-sign
pattern).

**Template & address (4):**

| Test | Asserts |
|---|---|
| `vault_template_roundtrip` | `new`/`parse`/`bytes`/`hash`/`address` roundtrip |
| `vault_wrong_length_rejected` | wrong length → `WrongLength` |
| `vault_invalid_key_rejected` | invalid beneficiary/owner key → `InvalidBeneficiaryKey`/`InvalidOwnerKey` |
| `vault_duplicate_keys_rejected` | duplicate keys → `DuplicateKeys` |

**Claim path (5):**

| Test | Asserts |
|---|---|
| `vault_claim_after_csv_delay` | mine `relative_delay` blocks, then claim ✓ |
| `vault_claim_before_delay_rejected` | claim before delay → `VaultLockNotExpired` |
| `vault_claim_after_cltv_time` | claim after pure-CLTV time ✓ |
| `vault_claim_before_time_rejected` | claim before time → `VaultLockNotExpired` |
| `vault_claim_and_semantics` | `relative_delay=10, absolute_time=20`, claim at height 15 rejected, at height 20 ✓ |

**Recovery path (4):**

| Test | Asserts |
|---|---|
| `vault_recover_before_lock` | recover before lock ✓ |
| `vault_recover_after_lock_rejected` | recover after lock → `VaultLockExpired` |
| `vault_recover_at_boundary_rejected` | recover at exact boundary (height == unlock) rejected (claim wins) |
| `vault_recover_wrong_key_rejected` | beneficiary sig on recover path → `BadSignature` |

**Witness anomalies (5):**

| Test | Asserts |
|---|---|
| `vault_bad_path_byte_rejected` | bad path byte `0x03` → `InvalidVaultPath` |
| `vault_wrong_witness_count_rejected` | 2 or 4 elements → `InvalidWitnessCount` |
| `vault_bad_signature_size_rejected` | bad sig size → `BadSignatureSize` |
| `vault_script_hash_mismatch` | template hash mismatch → `ScriptHashMismatch` |
| `vault_malformed_template_rejected` | malformed template bytes → `InvalidRedeemScript` |

**Activation gating (3):**

| Test | Asserts |
|---|---|
| `vault_pre_activation_output_rejected` | `set_vault_activation_score(10)` — vault output in a regular tx at `blue_score ≤ 10` → `PreActivationVault` |
| `vault_pre_activation_spend_rejected` | vault spend at `blue_score ≤ 10` → `PreActivationVault` |
| `vault_coinbase_funding_exempt` | genesis coinbase funding a vault address exempt (the `vault_funded_ledger` helper itself proves it) |

**CSV consensus rule (4):**

| Test | Asserts |
|---|---|
| `csv_sequence_not_final` | `sequence=10` spending a 2-block-old output → `SequenceNotFinal` |
| `csv_sequence_final_after_delay` | same tx after 10 blocks ✓ |
| `csv_sequence_zero_final` | `sequence=0` always final |
| `csv_unknown_age_fails_closed` | unknown-age output (constructed via `UtxoSet::decode(version=5)`) spent with `sequence > 0` → `UnknownOutputAge` |

**Parallel-DAG (2):**

| Test | Asserts |
|---|---|
| `vault_parallel_double_claim` | two parallel blocks both claim the same vault output — one applies, the other `MissingInput` |
| `vault_parallel_claim_vs_recover` | parallel claim (after lock) vs recover (before lock) — only the valid one applies |

**Checkpoint/snapshot (2):**

| Test | Asserts |
|---|---|
| `vault_checkpoint_roundtrip` | `write_checkpoint`/`read_checkpoint` roundtrip preserves `created_at` (a CSV spend still enforced after restore) |
| `vault_snapshot_roundtrip` | `write_snapshot`/`read_snapshot` roundtrip likewise (replay recomputes heights) |

### 7.2 Updates to existing tests (same commit — they break otherwise)

`crates/kovanica-state/tests/stealth_script_v2_consensus.rs`:

- `test_script_v2_csv_spend` (sequence=100, v=50, spends at height 1): now
  rejected with `SequenceNotFinal` (age 1 < 100). **Fix:** mine 100 blocks
  first, then spend — the test now exercises the full BIP-112 composition
  (`age ≥ sequence ≥ v`).
- `test_script_v2_csv_rejected` (sequence=50, v=100): now rejected with
  `SequenceNotFinal` before the script runs. **Fix:** mine 100 blocks, then
  spend with `sequence=100, v=150` → script fails → `BadSignature`.

(The two CLTV tests were already updated to real semantics in RFC-004 — no
further change.)

### 7.3 Unit tests

- `utxo.rs`: `created_at` roundtrip (insert/`created_at_of`/remove);
  `encode`/`decode(version=6)` roundtrip preserves heights;
  `decode(version=5)` leaves `created_at` empty.
- `keys.rs`: `version_max_is_vault`; `Address::vault`/`from_vault_script`/
  `is_vault` roundtrip.
- `ledger.rs` (internal): `diff_utxo`/`apply_delta`/`compose_delta` preserve
  heights through fold (extend the existing prune tests).

### 7.4 Cross-cutting invariants

- **Address-version invariant:** every blue block's spent outputs are validly
  authorized by their address version's rule — vault adds the `v0x05` branch
  (claim by path 0x01, recover by path 0x02).
- **Determinism:** creation height = the creating block's own height (blue
  score) — a pure function of the DAG, never the linearization position or
  wall-clock. The vault time checks use block height only.
- **Error precedence is deterministic:** activation gates → CSV rule → version
  branch → witness shape → time → signature. Any order is consensus-safe, but
  tests assert specific errors — keep this order.
- **Activation independence:** vault's gate is independent of RFC-001/002/003/004
  gates; a block may be post-vault but pre-HTLC or vice versa.

---

## 8. Wire & persistence

**Checkpoint v6 is a format bump; there is NO wire-format bump — no testnet
reset.**

- **Checkpoint v5 → v6:** `CHECKPOINT_VERSION: u16 = 5 → 6`. `UtxoSet::encode`
  appends `created_at` (8 bytes LE) per output record (after the stealth flag);
  `decode(bytes, version)` reads it iff `version >= 6`; `read_checkpoint_impl`
  accepts `3..=6`. **Old readers misparse v6 checkpoints** (trailing 8 bytes
  per record) — the bump is real.
- **Pre-v6 checkpoints still load:** v3–v5 checkpoints load fine, but their
  outputs have **unknown ages** → any CSV spend of them fails closed with
  `UnknownOutputAge` (conservative: cannot prove the age, so the relative lock
  is treated as unsatisfied). Deterministic across nodes. **Do not default
  unknown ages to 0** — that would silently disable the relative lock.
- **No wire-format bump:** tx encoding, sighash, and `kvnc…dag` rendering are
  untouched (owner stays 33 opaque bytes). `TxOutput` must NOT gain a
  `created_at` field — it would split the sighash domain.
- **Snapshots unchanged:** `read_snapshot_impl` replays via `insert_raw_block`
  (the incremental path), which recomputes heights — `created_at` is derived,
  never trusted from disk.
- **Identity-preserving replay:** no new block fields, so no VRF-style replay
  hazard — keep using `insert_raw_block`/`insert_prepared_block` for
  snapshot/checkpoint replay as today.

---

## 9. Risks & invariants (do not break)

1. **Determinism:** creation height = the creating block's own height (blue
   score) — a pure function of the DAG, never the linearization position or
   wall-clock. The vault time checks use block height only.
2. **`height == blue_score` invariant** underpins the `apply_dag` fix (pass
   `blue_score` as height) and `apply_coinbase`'s height threading. Do not
   "fix" one without the other.
3. **Checkpoint v6 is a format bump:** old readers misparse v6 checkpoints
   (trailing 8 bytes per record). v3–v5 checkpoints still load; their outputs
   have unknown ages and CSV spends of them fail closed (`UnknownOutputAge`).
   Do not default unknown ages to 0 — that would silently disable the relative
   lock.
4. **No wire-format bump:** tx encoding, sighash, and `kvnc…dag` rendering are
   untouched (owner stays 33 opaque bytes). `TxOutput` must NOT gain a
   `created_at` field — it would split the sighash domain.
5. **Identity-preserving replay:** no new block fields, so no VRF-style replay
   hazard — but keep using `insert_raw_block`/`insert_prepared_block` for
   snapshot/checkpoint replay as today.
6. **The CSV consensus rule changes existing test expectations** — the two
   `stealth_script_v2_consensus.rs` CSV tests must be updated in the same
   commit as the rule, or CI breaks.
7. **Activation default 0:** vault is active from genesis on new testnets. The
   live testnet must set `VAULT_ACTIVATION_SCORE` before any vault output
   appears (same discipline as HTLC).
8. **Overflow hygiene:** `age = height.checked_sub(created_at).unwrap_or(0)`
   (fail-closed on the invariant `created_at ≤ height`); the vault's
   `created_at + relative_delay` comparison is done as two independent `>=`
   checks, no addition.
9. **Error precedence is deterministic:** activation gates → CSV rule → version
   branch → witness shape → time → signature. Any order is consensus-safe, but
   tests assert specific errors — keep this order.
10. **Coinbase exemption:** vault outputs in coinbase bypass the output gate
    (genesis funding pattern). Do not add vault to `apply_coinbase`'s checks.
11. **Recovery is strictly before expiry; claim wins at the boundary**
    (`height == unlock`). This is what makes escrow sound — do not "relax"
    recovery to anytime without re-deriving the escrow safety argument.

---

## 10. Future work (out of scope for this RFC)

- **Node/FFI surface — deferred:** the 5.2 spec lists only `vault.rs` +
  `tests/vault.rs`; the consensus core is where the correctness risk lives and
  where review should focus. The node surface (`create_vault`/`claim_vault`/
  `recover_vault`/`balance_of_vault`, RPC, FFI) is mechanical and can land as a
  follow-up without any consensus change.
- **Token staking extensions (5.3):** `stake.rs` already exists; v2 script may
  extend it later.
- **DEX design doc (5.4), VM research gate (5.5):** deferred.
- **Reserved vault path bytes `0x03+`:** future 2-of-2 / arbiter escrow
  extensions slot into the existing path-byte discriminator without a format
  change.

---

*End of RFC-005.*
