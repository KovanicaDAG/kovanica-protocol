# RFC-003 — Stealth Addresses (6A) + Script v2 (3B)

- **Status:** Spec (implementation-targeted)
- **Reference implementation:** `crates/kovanica-state/src/keys.rs`, `crates/kovanica-state/src/tx.rs`,
  `crates/kovanica-state/src/utxo.rs`, `crates/kovanica-state/src/ledger.rs`,
  `crates/kovanica-state/src/script_v2.rs` (new), `crates/kovanica-node/src/node.rs`,
  `crates/kovanica-ffi/src/light_node.rs`
- **Consensus test suite:** `crates/kovanica-state/tests/stealth_script_v2_consensus.rs` (combined)
- **Activation:** gated on blue score (see [Activation gating](#activation-gating))

This document is the specification that the stealth-address and script-v2 code in
`kovanica-state` references as "RFC-003". It describes the `v0x03` stealth address
format, the `v0x02` script-v2 address format, the per-output stealth extension
encoding, the deterministic bounded script execution model, and the consensus
activation gates for both. It is grounded in the planned implementation — do not
change the formats here without changing the code, and vice versa.

---

## 1. Overview

This RFC ships **two consensus upgrades** in a single work package because they
share a single **address-version bump** and a single **per-output encoding bump**:

- **6A — Stealth addresses** (`v0x03`): CryptoNote-style one-time public keys.
  A recipient publishes a **scan key** and a **spend key**; a sender derives a
  one-time output key per transaction via elliptic-curve Diffie-Hellman. The
  on-chain output carries the ephemeral point `R`, a one-byte **view tag** for
  SPV filtering, and the derived one-time public key `P`. Only the recipient can
  derive the one-time private key and spend.

- **3B — Script v2** (`v0x02`): a deterministic, non-Turing-complete, bounded
  script language that locks funds behind a small program rather than a single
  key or a threshold multisig. The initial opcode set covers Ed25519 signature
  verification, locktime/sequence checks, BLAKE3 hashing, equality, boolean
  combinators, and inline M-of-N threshold. No loops, no recursion, a hard step
  budget.

The two address versions coexist with the existing `v0x00` (P2PK) and `v0x01`
(P2SH) from RFC-001/RFC-002. The upgrade is **additive** — P2PK and P2SH remain
valid forever.

**Design rationale (deterministic script, no VM):** script v2 is deliberately
not a VM. It is a bounded stack machine with a fixed opcode table and a step
budget. This keeps execution time predictable and auditable on a BlockDAG (no
halting-problem concerns, no gas metering needed). DeFi primitives — HTLC (5.1),
time-lock vaults (5.2), token-staking sortition (5.3) — build on top of script
v2, so 3B must land before them.

**Reference protocols:** CryptoNote/Monero stealth addresses (one-time keys,
view-tag filter), Kaspa stealth-address research, BIP-65 (CLTV), BIP-112 (CSV),
Bitcoin script (stack-based Forth model, adapted here to a bounded non-Turing-
complete subset), Cardano Plutus (deterministic-script, no-VM rationale), Algorand
TEAL (bounded-step execution as a budget reference).

---

## 2. Address versions

The protocol carries four address versions after this RFC:

|| Version | Name | Payload | Shape |
|---|---|---|---|---|
| `0x00` | P2PK | 32-byte Ed25519 pubkey | `0x00 || pk` |
| `0x01` | P2SH | 32-byte BLAKE3(redeem_script) | `0x01 || hash` |
| `0x02` | Script v2 | 32-byte BLAKE3(script_bytes) | `0x02 || hash` |
| `0x03` | Stealth | 32-byte scan_pk \|\| 32-byte spend_pk | `0x03 \| scan_pk \| spend_pk` |

- `0x00` and `0x01` are existing (RFC-001, RFC-002).
- `0x02` and `0x03` are new in this RFC.
- All addresses are 33 bytes on the wire: 1 version byte + 32-byte payload,
  except `v0x03` which is the **canonical address form** (see §2.3).

### 2.1 P2PK and P2SH (existing)

Unchanged from RFC-001/RFC-002. `Address::VERSION_P2PK = 0x00`,
`Address::VERSION_P2SH = 0x01`. The `keys.rs` parser already accepts versions
`0x00..=0x01`; this RFC extends the accepted range to `0x00..=0x03`.

### 2.2 Script v2 address (`v0x02`)

```text
script_hash = BLAKE3(script_bytes)      # 32 bytes
address     = 0x02 || script_hash       # 33 bytes
```

- The payload is a **32-byte BLAKE3 digest** of the serialized v2 script
  (see §5 for the script format).
- Same shape as P2SH (`0x01`): a script hash, not the script itself. The script
  is revealed at spend time in the witness (see §4.2).
- `Address::script_v2(script_bytes)` constructs the address from raw script bytes.
- `Address::is_script_v2()` returns true for `v0x02`.
- Rendering: `kvnc…dag` (base58 over the 33 bytes), indistinguishable in shape
  from P2PK/P2SH to humans; `Address::parse` accepts 66-hex, 64-hex (legacy
  P2PK), or `kvnc…dag`.

### 2.3 Stealth address (`v0x03`)

```text
address = 0x03 || scan_pk (32 bytes) || spend_pk (32 bytes)   # 65 bytes total
```

- `scan_pk` — the recipient's **scan public key**. Anyone can derive the view
  tag for an output sent to this address (see §3.2).
- `spend_pk` — the recipient's **spend public key**. Only the recipient, holding
  `spend_sk`, can derive the one-time private key and spend (see §4.1).
- The canonical on-wire form is **65 bytes** (1 version + 64 payload). This is
  the only address version whose payload is longer than 32 bytes — the decoder
  must handle the variable-length payload (see §3.3 and §10).
- `Address::stealth(scan_pk, spend_pk)` constructs the address.
- `Address::is_stealth()` returns true for `v0x03`.
- Rendering: `kvnc…dag` over the 65 bytes.
- `Address::parse` accepts 130-hex (65 bytes), 66-hex, 64-hex (legacy P2PK), or
  `kvnc…dag`.

### 2.4 Predicate summary

|| Method | `0x00` | `0x01` | `0x02` | `0x03` |
|---|---|---|---|---|---|
| `is_p2pk()` | ✓ | — | — | — |
| `is_p2sh()` | — | ✓ | — | — |
| `is_script_v2()` | — | — | ✓ | — |
| `is_stealth()` | — | — | — | ✓ |

---

## 3. Output format & encoding

### 3.1 TxOutput extension

`TxOutput` gains a **stealth flag** and, when set, a per-output stealth
extension:

```rust
pub struct TxOutput {
    pub value: u64,
    pub asset_id: Option<AssetId>,   // None = native KVNC (RFC-002)
    pub owner: Address,               // versioned address (any of 0x00..0x03)
    pub stealth: Option<StealthExt>, // None = ordinary, Some = stealth output
}

pub struct StealthExt {
    pub r: [u8; 32],       // R = r·G, ephemeral pubkey
    pub view_tag: u8,      // first byte of BLAKE3(scan_pk · r)
    pub p: [u8; 32],       // P = H(r · spend_pk)·G, one-time pubkey (ledger verifies against this)
}
```

- For an **ordinary** output (`owner.is_p2pk()` / `is_p2sh()` / `is_script_v2()`),
  `stealth` is `None` and the output serializes exactly as in RFC-002.
- For a **stealth** output (`owner.is_stealth()`), `stealth` is `Some(...)` and
  the canonical encoding appends the stealth extension after the owner address.
- The `owner` field of a stealth output is the **`v0x03` address**
  (`scan_pk || spend_pk`). The `p` field is the derived one-time pubkey; it is
  stored for ledger verification and is **not** the owner — the owner is the
  long-lived `v0x03` address.

### 3.2 Canonical transaction encoding (stealth extension)

Per output, after the existing RFC-002 fields (value, asset_flag + asset_id,
owner), the encoder writes:

```text
value (8 bytes)
asset_flag (1 byte): 0 = native (None), 1 = asset present
[asset_id (32 bytes)]            # only when asset_flag == 1
stealth_flag (1 byte): 0 = ordinary, 1 = stealth
[stealth extension (65 bytes)]   # only when stealth_flag == 1:
    r (32 bytes)
    view_tag (1 byte)
    p (32 bytes)
owner (variable: 33 bytes for 0x00/0x01/0x02, 65 bytes for 0x03)
```

- `stealth_flag == 0` → ordinary output, no extension.
- `stealth_flag == 1` → the next 65 bytes are `r || view_tag || p`, followed by
  the owner address (which must be a `v0x03` address).

**Minimum output size:**

- Ordinary, native: 8 (value) + 1 (asset_flag=0) + 1 (stealth_flag=0) + 33 (owner
  P2PK) = **43 bytes**.
- Ordinary, asset: 8 + 1 (flag=1) + 32 (asset) + 1 (stealth_flag=0) + 33 = **75 bytes**.
- Stealth, native: 8 + 1 (asset_flag=0) + 1 (stealth_flag=1) + 65 (ext) + 65 (owner
  v0x03) = **140 bytes**.
- Stealth, asset: 8 + 1 + 32 + 1 + 65 + 65 = **172 bytes**.

The decoder's `read_count` bound for outputs uses the 140-byte minimum (the
smallest stealth output), since a decoder must be able to skip past a stealth
output to reach the next one.

### 3.3 View tag derivation

The view tag is **one byte**: the first byte of `BLAKE3(scan_pk · r)` where `·`
denotes elliptic-curve scalar multiplication / ECDH on Ristretto255
(curve25519-dalek, the same curve as ed25519/VRF already in workspace deps).

- A light client that knows its `scan_sk` can compute `scan_pk = scan_sk·G`, then
  for each output on chain compute the view tag from `R` and match against its own
  scan key's expected view tag — **without** doing a full ECDH to recover the
  one-time private key. This makes SPV filtering practical (matches the existing
  `kovanica-node::spv` filter infrastructure).
- The view tag is **not** a secret; it is embedded in every stealth output and is
  visible to everyone. Its purpose is filtering, not hiding.

### 3.4 Format bump (breaking)

Adding `v0x02` and `v0x03` address versions plus the stealth flag byte and the
65-byte stealth extension is a **wire-format bump** on the same scale as RFC-002:

- Old wire blobs / checkpoints are **undecodable** by the new code.
- The **genesis block id changes** (genesis coinbase encoding changes — if the
  genesis carries any output, its encoding now includes the stealth_flag byte
  even when zero).
- The **live testnet chain resets at activation** — `crates/kovanica-ffi/tests/
  live_sync_spike.rs` live-chain tests are `#[ignore]`d until the testnet is
  re-captured on the new chain.

---

## 4. Spend authorization

### 4.1 P2PK and P2SH (existing)

Unchanged from RFC-001/RFC-002. P2PK spends carry a single 64-byte signature
verified against the output's public key over the sighash. P2SH spends carry the
redeem script + `M` signatures (see RFC-001 §4).

### 4.2 Script v2 spend (`v0x02`)

A spend of a `v0x02` output reveals the script in the witness:

```text
witness[0] = script_bytes          # the full serialized v2 script
witness[1..] = stack elements      # operands the script runs against
```

The ledger:

1. **Script-hash match** — `BLAKE3(witness[0])` must equal the output's address
   payload (`ScriptHashMismatch` otherwise).
2. **Script validity** — `witness[0]` must parse as a valid v2 script
   (`InvalidScript` otherwise; see §5.2 for validation rules).
3. **Execution** — run the script against the witness stack (after `witness[0]`)
   with the sighash available as an environment value and the enclosing
   transaction's `nLockTime`/`sequence` available for CLTV/CSV (see §5.3).
4. **Result** — the script must leave exactly one value on the stack, and that
   value must be **non-zero** (truthy). A zero result, an empty stack, or a stack
   with more than one element after execution fails the spend
   (`ScriptExecutionFailed`).

### 4.3 Stealth spend (`v0x03`)

A spend of a `v0x03` output is authorized by a **single 64-byte Ed25519
signature**, like P2PK — but the verifying key is the **one-time public key `P`**
derived from the output's stealth extension, not a long-term published key.

**Derivation (recipient side):**

```text
c = H(spend_sk · r)              # ECDH on Ristretto255: scalar × point
one_time_sk = c                  # the one-time private key (32 bytes)
one_time_pk = c·G = P            # matches the output's p field
```

- `spend_sk · r` is the ECDH shared secret: the recipient's spend private key
  scalar multiplied by the sender's ephemeral point `R = r·G`.
- `H` is BLAKE3 (the same hash used everywhere in the protocol).
- The recipient signs the transaction sighash with `one_time_sk` (an Ed25519
  signing key on Ristretto255 — same curve, same signing operation as ordinary
  P2PK).

**Verification (ledger side):**

The ledger, when spending a stealth output:

1. Reads the output's `StealthExt` (`r`, `view_tag`, `p`).
2. Reads the input's witness: a single 64-byte signature.
3. Verifies the signature against `p` (the one-time pubkey) over the sighash.
4. Rejects (`BadStealthSignature`) if verification fails.

The ledger does **not** re-derive `c` — it only verifies the signature against
the published `p`. Derivation is the recipient's job.

**Spend authorization summary:**

|| Address version | Witness | Verifying key |
|---|---|---|---|
| `0x00` P2PK | 1× 64B sig | output's pk |
| `0x01` P2SH | script + M× 64B sigs | script's authorized keys |
| `0x02` Script v2 | script + stack | script execution result |
| `0x03` Stealth | 1× 64B sig | output's `p` (one-time pk) |

---

## 5. Script v2 language

### 5.1 Opcodes (initial set)

Script v2 is a stack-based, Forth-like language with a fixed opcode table. The
initial opcode set:

|| Opcode | Byte | Semantics | Reference |
|---|---|---|---|---|
| `ED25519_VERIFY` | `0x01` | Pop `sig` (64B) + `pk` (32B); verify `sig` over the sighash against `pk`. Push 1 on success, fail on failure. | ed25519 (existing) |
| `CHECKLOCKTIMEVERIFY` (CLTV) | `0x02` | Pop `v` (u32 little-endian). Fail if `tx.nLockTime < v`. Push nothing. | BIP-65 |
| `CHECKSEQUENCEVERIFY` (CSV) | `0x03` | Pop `v` (u32 little-endian). Fail if `tx.sequence < v`. Push nothing. | BIP-112 |
| `HASH_BLAKE3` | `0x04` | Pop `input` (any length). Push `BLAKE3(input)` (32 bytes). | hash primitive |
| `EQUAL` | `0x05` | Pop `a` + `b` (same length). Push 1 if `a == b`, else 0. | comparison |
| `AND` | `0x06` | Pop `a` + `b` (both must be 0 or 1). Push 1 if both non-zero, else 0. | boolean |
| `OR` | `0x07` | Pop `a` + `b` (both must be 0 or 1). Push 1 if either non-zero, else 0. | boolean |
| `THRESHOLD` | `0x08` | Pop `M` (u8) then `N` (u8) then `N` signatures (each 64B) then `N` pubkeys (each 32B). Verify exactly `M` distinct valid signatures against the `N` pubkeys over the sighash. Push 1 on success, fail otherwise. | multisig-like (inlined) |

- Opcodes `0x00` and `0x09..=0xFF` are **reserved** (invalid for now; future
  expansion).
- All stack values are raw byte vectors (`Vec<u8>`). Integers are little-endian
  byte vectors (CLTV/CSV read u32, THRESHOLD reads u8).
- The sighash is available as a **pre-loaded environment value** on the stack
  before execution begins (pushed by the interpreter, not by the script). This is
  how `ED25519_VERIFY` accesses the sighash to verify against.

### 5.2 Script format & validation

A v2 script is a sequence of opcodes with their immediate arguments:

```text
script_bytes = [op0, imm0..., op1, imm1..., ...]
```

Each opcode is one byte; immediates follow the opcode and are consumed according
to the opcode's arity:

- `ED25519_VERIFY`: 0 immediates (pops from stack).
- `CHECKLOCKTIMEVERIFY`: 0 immediates (pops u32 from stack).
- `CHECKSEQUENCEVERIFY`: 0 immediates (pops u32 from stack).
- `HASH_BLAKE3`: 0 immediates (pops from stack).
- `EQUAL`: 0 immediates (pops two from stack).
- `AND`: 0 immediates (pops two from stack).
- `OR`: 0 immediates (pops two from stack).
- `THRESHOLD`: immediates = `M` (1 byte) + `N` (1 byte) + `N * (64 + 32)` bytes
  (signatures + pubkeys inline). **The signatures and pubkeys are embedded in the
  script**, not on the stack — this is what makes the script self-contained. The
  stack must still provide the sighash (via the environment push).

**Script validation rules (`ScriptV2::parse` / `ScriptV2::new`):**

A script is strictly validated at parse time and rejected if any of the following
holds:

- Empty script (zero bytes).
- Unknown opcode (not in `0x01..0x08`).
- Stack underflow during a dry-run parse (an opcode requires more stack elements
  than available given the script's inline data and the pre-loaded sighash).
- `THRESHOLD` with `M < 1`, `N < 1`, `M > N`, or `N > 16` (same constraints as
  RFC-001 multisig).
- `THRESHOLD` script byte length does not match `2 + N * (64 + 32)` (truncated
  or trailing garbage).
- Any pubkey in a `THRESHOLD` is not a valid Ed25519 point.
- Any two pubkeys within a `THRESHOLD` are identical (duplicate keys rejected).
- Any signature in a `THRESHOLD` is not exactly 64 bytes.
- Total script length exceeds a consensus maximum (default e.g. 1024 bytes).

### 5.3 Execution model

- The script runs against a **stack** initialized with the pre-loaded sighash
  (pushed by the interpreter before execution begins), followed by the witness
  elements after `witness[0]` (the script itself).
- The enclosing transaction's `nLockTime` (u32) and `sequence` (u32) are
  available to CLTV/CSV. These fields must exist on `Transaction` (add if
  missing — see §6.2).
- Execution is **deterministic**: no HashMap iteration order, no wall-clock, no
  unstable sorts. Only stack operations and the fixed opcode semantics.
- **Step budget**: every opcode execution counts as one step. A consensus parameter
  `SCRIPT_V2_STEP_BUDGET` (default 1000) caps total steps. Exceeding the budget
  fails the spend (`ScriptStepBudgetExceeded`).
- **No loops, no recursion, no indirect jumps** — the opcode sequence is executed
  linearly. This guarantees bounded execution time and avoids the halting problem.

### 5.4 Execution failure modes

Execution fails (output not spendable) on:

- Unknown opcode.
- Stack underflow (opcode needs more elements than available).
- Step budget exhaustion.
- `ED25519_VERIFY` signature verification failure.
- `CHECKLOCKTIMEVERIFY` / `CHECKSEQUENCEVERIFY` locktime/sequence failure.
- `EQUAL` / `AND` / `OR` / `THRESHOLD` result failure (pushed 0, or threshold
  not met).
- Post-execution stack does not have exactly one non-zero element.

### 5.5 Transaction fields for CLTV/CSV

`Transaction` gains two new fields (add if missing):

```rust
pub struct Transaction {
    // ... existing fields ...
    pub nLockTime: u32,    // absolute locktime (BIP-65 style)
    pub sequence: u32,     // relative locktime / sequence (BIP-112 style)
}
```

- The sighash domain includes `nLockTime` and `sequence` so signatures cover
  these values (a signature on a transaction with a given locktime cannot be
  reused on a transaction with a different locktime).
- Default values: `nLockTime = 0`, `sequence = 0` (no lock when zero, matching
  BIP-65/BIP-112 semantics).

---

## 6. Conservation & activation gating

### 6.1 Conservation (unchanged)

Stealth outputs and script-v2 outputs participate in **per-asset conservation**
identically to ordinary outputs (RFC-002 §4):

- Inputs and outputs are grouped by `Option<AssetId>`; for each asset the input
  sum and output sum are compared.
- `out_val > in_val` is rejected (`AssetNotConserved`).
- `out_val < in_val` is allowed (burned).
- Any asset appearing only in outputs (no input) is rejected (`AssetNotConserved`).
- Fee must be native KVNC.
- Zero-value outputs rejected regardless of address version.

### 6.2 Activation gating

Both upgrades are **consensus upgrades gated on blue score**, using the same
template as RFC-001 (`MULTISIG_ACTIVATION_SCORE`) and RFC-002 (`NATIVE_TOKEN_
ACTIVATION_SCORE`).

#### 6.2.1 Stealth activation

- Default threshold: `STEALTH_ACTIVATION_SCORE = 0` (active from genesis by
  default).
- Configurable via `Ledger::set_stealth_activation_score(score)`; readable via
  `Ledger::stealth_activation_score()`.
- The gate is **inclusive**: a block is *pre-activation* when
  `blue_score <= stealth_activation_score`.

**Pre-activation rules** (while `blue_score <= STEALTH_ACTIVATION_SCORE`):
the ledger rejects (`PreActivationStealth`) in `apply_regular`:

- Any **output** whose `owner.is_stealth()` (a `v0x03` output).
- Any **spend** of a `v0x03` output (a stealth input).

**Post-activation:** once `blue_score > STEALTH_ACTIVATION_SCORE`, stealth
outputs may be created and spent normally. P2PK/P2SH/script-v2 outputs remain
valid forever.

#### 6.2.2 Script v2 activation

- Default threshold: `SCRIPT_V2_ACTIVATION_SCORE = 0` (active from genesis by
  default).
- Configurable via `Ledger::set_script_v2_activation_score(score)`; readable via
  `Ledger::script_v2_activation_score()`.
- The gate is **inclusive**: a block is *pre-activation* when
  `blue_score <= script_v2_activation_score`.

**Pre-activation rules** (while `blue_score <= SCRIPT_V2_ACTIVATION_SCORE`):
the ledger rejects (`PreActivationScriptV2`) in `apply_regular`:

- Any **output** whose `owner.is_script_v2()` (a `v0x02` output).
- Any **spend** of a `v0x02` output, or any input whose witness stack first
  element is a v2 script (a script-v2 spend).

**Post-activation:** once `blue_score > SCRIPT_V2_ACTIVATION_SCORE`, script-v2
outputs may be created and spent normally. P2PK/P2SH/stealth outputs remain valid
forever.

#### 6.2.3 Enforcement paths

The gates are threaded through `apply_block_inner`, which takes explicit score
parameters. They are enforced identically on the incremental `Ledger` path
(`Ledger::insert`, which passes `self.*_activation_score`) and the batch paths
(`apply_block`, `apply_block_with_stake`, `apply_dag`, which pass the constants).
The checkpoint restore path re-initializes the ledger with the constants.

The two gates are **independent**: a block may be post-stealth but pre-script-v2
or vice versa. Each address version's rule is enforced against its own activation
score.

---

## 7. Node & FFI surface

### 7.1 Node layer (`crates/kovanica-node/src/node.rs`)

The node exposes new transfer and balance helpers for the two new address types.
Existing P2PK/P2SH helpers remain unchanged.

**Script v2:**

- `send_to_script_v2(kp, amount, script_bytes)` — send from actor to a
  script-v2 address (constructs the address from `script_bytes`, builds and signs
  the transfer).
- `build_transfer_to_script_v2(kp, amount, script_bytes)` — build a signed
  transfer to a script-v2 address.
- `prepare_transfer_to_script_v2(from, amount, script_bytes)` — build an
  **unsigned** transfer, selecting covering UTXOs of the script-v2 output.
- `balance_of_script_v2(script_bytes)` — spendable balance of a script-v2
  address.

**Stealth:**

- `send_to_stealth(kp, amount, scan_pk, spend_pk)` — send from actor to a
  stealth address (constructs the `v0x03` address, derives `R` and `view_tag`
  using an ephemeral `r`, builds and signs the transfer).
- `build_transfer_to_stealth(kp, amount, scan_pk, spend_pk)` — build a signed
  transfer to a stealth address.
- `prepare_transfer_to_stealth(from, amount, scan_pk, spend_pk)` — build an
  **unsigned** transfer, selecting covering UTXOs of the stealth output.
- `balance_of_stealth(scan_pk, spend_pk)` — spendable balance of a stealth
  address.

`Node::balance(owner)` continues to count **native KVNC only** (filters on
`asset_id.is_none()`); the new balance helpers are asset-aware where applicable.

### 7.2 FFI layer (`crates/kovanica-ffi/src/light_node.rs`)

The mobile FFI exposes:

- `send_to_script_v2(signing_secret_hex, amount, script_hex)` — send to a
  script-v2 address using an imported secret.
- `send_to_stealth(signing_secret_hex, amount, scan_pk_hex, spend_pk_hex)` —
  send to a stealth address.
- `balance_of_script_v2(script_hex)` — script-v2 balance as a decimal string.
- `balance_of_stealth(scan_pk_hex, spend_pk_hex)` — stealth balance as a decimal
  string.

The history/record types gain optional fields for the new address versions:

- `HistoryEntry.address_type: AddressType` — enum `{ P2PK, P2SH, ScriptV2, Stealth }`
  distinguishing the output's address version.
- `HistoryEntry.owner_hex: String` — the full owner address hex (33 bytes for
  P2PK/P2SH/script-v2, 65 bytes for stealth).

---

## 8. Persistence

### 8.1 UTXO set encoding (v5)

`UtxoSet::encode` / `UtxoSet::decode` (`crates/kovanica-state/src/utxo.rs`) are
bumped to **v5**:

- Each entry writes the existing v4 fields (value, asset_flag + asset_id, owner)
  plus, when the owner is a stealth address, the stealth extension (`r || view_tag
  || p`).
- The owner's address is written in its full variable-length form: 33 bytes for
  `0x00`/`0x01`/`0x02`, 65 bytes for `0x03`. The decoder reads the version byte
  first, then branches on the expected payload length.
- This is the encoding used inside checkpoints.

### 8.2 Checkpoint format (v5)

`CHECKPOINT_VERSION` in `crates/kovanica-state/src/ledger.rs` is **5**. v5 adds:

- The variable-length owner encoding (33 or 65 bytes depending on version).
- The stealth extension when present.
- The reader accepts versions `4..=5` (v4 = asset_id in UTXO, v5 = variable-length
  owner + stealth extension).

### 8.3 Snapshot format

The ledger snapshot (`LEDGER_VERSION`) and the DAG snapshot (`VERSION` in
`crates/kovanica-dag/src/snapshot.rs`) are **not** bumped for this RFC. A
snapshot stores the replay log of blocks, not per-output state; on load the blocks
are replayed through the new transaction encoding (which carries the stealth flag
and variable-length owner), so outputs round-trip without a format change. Only the
checkpoint — which stores the materialized UTXO set directly — requires a bump.

---

## 9. Test coverage summary

`crates/kovanica-state/tests/stealth_script_v2_consensus.rs` (combined suite)
covers:

### 9.1 Stealth addresses

1. **Address encode/decode roundtrip** — `v0x03` parse from 130-hex, 66-hex
   legacy P2PK reject, `kvnc…dag` roundtrip, `Address::stealth` constructor.
2. **`kvnc…dag` rendering roundtrip** — parse a rendered stealth address back to
   the same bytes.
3. **View-tag derivation** — known `scan_pk` + `r` produce the expected view tag;
   different scan keys produce different view tags.
4. **Spend with derived key** — constructive spend: sender derives `R`, view_tag,
   `P`; recipient derives one-time key `c` and signs; ledger verifies against `P`.
5. **Wrong scan/spend key rejected** — a signature from a key that is not the
   derived one-time key fails (`BadStealthSignature`); a different `scan_pk` gives
   a different view tag (filter mismatch).
6. **Conservation** — stealth outputs conserve per-asset identically; native + asset
   stealth outputs; burning stealth asset allowed; fee in native.
7. **Activation boundary** — pre-activation `v0x03` output rejected, pre-activation
   stealth spend rejected, post-activation allowed, exact boundary transition
   (`blue_score == activation_score` rejected, `blue_score == activation_score + 1`
   allowed).
8. **Mixed block** — block with P2PK + P2SH + script-v2 + stealth outputs coexisting.
9. **Parallel-DAG conflict** — double-spend of a stealth output across parallel
   blocks, resolved by linearization.
10. **Checkpoint/snapshot roundtrip** — checkpoint v5 roundtrip preserves stealth
    outputs; snapshot roundtrip preserves balances.
11. **Edge cases** — zero-value stealth output rejected; `r` is 32 bytes; view_tag
    is 1 byte; `p` is 32 bytes; `owner` is 65 bytes; `Address::is_stealth`
    predicate.

### 9.2 Script v2

1. **Script parse/validate** — valid script parses; empty script rejected; unknown
   opcode rejected; `THRESHOLD` with bad M/N rejected; `THRESHOLD` with duplicate
   pubkeys rejected; `THRESHOLD` with invalid Ed25519 points rejected; truncated
   script rejected; oversized script rejected.
2. **Each opcode executes correctly** — `ED25519_VERIFY` with valid sig passes,
   with bad sig fails; `CHECKLOCKTIMEVERIFY` enforces `nLockTime`; `CHECKSEQUENCE
   VERIFY` enforces `sequence`; `HASH_BLAKE3` produces correct digest; `EQUAL`
   true/false; `AND`/`OR` truth tables; `THRESHOLD` M-of-N success and failure.
3. **Step-budget exhaustion fails** — a script that hits the step budget fails
   (`ScriptStepBudgetExceeded`); a script under the budget succeeds.
4. **CLTV/CSV enforce locktime/sequence** — transaction with `nLockTime` too low
   for a CLTV script fails; transaction with `sequence` too low for a CSV script
   fails; signature covers `nLockTime`/`sequence` (sighash domain).
5. **Hash-lock redeem/refund pattern** — script that requires a preimage hash
   (via `HASH_BLAKE3` + `EQUAL`) and a refund path (via `CHECKLOCKTIMEVERIFY` +
   `ED25519_VERIFY`).
6. **AND/OR/threshold logic** — combined boolean scripts; threshold scripts with
   various M/N combinations (1-of-1, 2-of-2, 2-of-3, 3-of-5, 16-of-16, 1-of-16).
7. **Activation boundary** — pre-activation `v0x02` output rejected, pre-activation
   script-v2 spend rejected, post-activation allowed, exact boundary transition.
8. **Conservation** — script-v2 outputs conserve per-asset identically; native +
   asset script-v2 outputs; burning allowed; fee in native.
9. **Mixed block** — block with all four address versions coexisting.
10. **Parallel-DAG conflict** — double-spend of a script-v2 output across parallel
    blocks, resolved by linearization.
11. **Checkpoint/snapshot roundtrip** — checkpoint v5 roundtrip preserves script-v2
    outputs; snapshot roundtrip preserves balances.
12. **Edge cases** — zero-value script-v2 output rejected; script max length enforced;
    stack underflow during execution fails; post-execution stack with zero/multiple
    elements fails.

### 9.3 Cross-cutting invariants

- **Address-version invariant:** every blue block's spent outputs are validly
  authorized by their address version's rule (P2PK signature, P2SH threshold, v2
  script success, stealth derived-key signature) — a general assertion over the
  applied ledger.
- **Determinism:** script execution produces the same result on every node given
  the same inputs (no HashMap order, no wall-clock).
- **Activation independence:** a block may be post-stealth but pre-script-v2 (or
  vice versa) and each address version's rule is enforced against its own score.

---

## 10. Wire & persistence notes

- **Variable-length owner:** `v0x03` is the only address version with a 65-byte
  payload. The transaction decoder, UTXO encoder/decoder, and checkpoint reader
  must read the version byte first and branch on payload length (33 vs 65).
- **No separate address type on wire:** all addresses are versioned byte strings.
  `v0x02` and `v0x03` are distinguished from `0x00`/`0x01` only by their version
  byte and payload length.
- **Stealth extension is per-output:** the `stealth_flag` byte and the 65-byte
  extension are written per output, not per transaction. A transaction may mix
  ordinary and stealth outputs.
- **Asset flag + stealth flag are independent:** a stealth output may be native or
  asset; an ordinary output may be native or asset. The two flag bytes are written
  in order: asset_flag first (RFC-002), then stealth_flag.
- **Sighash domain includes locktime/sequence:** signatures on transactions that
  use CLTV/CSV cover `nLockTime` and `sequence`, preventing replay across
  different locktime values.
- **Format bump:** pre-RFC-003 wire blobs and checkpoints are undecodable; the
  genesis id changes; the live testnet chain resets at activation.
- **Curve:** stealth ECDH uses Ristretto255 (curve25519-dalek, already in workspace
  deps) — no new curve dependency. The same curve as ed25519/VRF.

---

## 11. Future work (out of scope for this RFC)

- **HTLC / atomic swap (5.1):** builds on script v2 hash-lock + CLTV/CSV.
- **Time-lock vault (5.2):** builds on script v2 CLTV/CSV.
- **Token staking extensions (5.3):** `stake.rs` already exists; v2 script may
  extend it later.
- **DEX design doc (5.4), VM research gate (5.5):** deferred.
- **CoinJoin (6.2), CT/Bulletproofs research (6.3), P2P privacy (6.4):** later.
- **Mint/burn authority via tag convention:** not in scope for script v2; the
  RFC-002 mint/burn rules apply unchanged (coinbase may mint any asset; regular
  tx cannot mint; burning is unrestricted).

---

*End of RFC-003.*
