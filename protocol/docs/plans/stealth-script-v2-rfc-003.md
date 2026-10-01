# Plan: Stealth Addresses (6A) + Script v2 (3B) — RFC-003

> **Source:** `Obsidian-Vault/Poslovno/KovanicaDAG/Notes/2026-09-05-protocol-evolution-6-points.md`
> **Critical path:** `3A → 6A+3B → 5A → 5B → 5C` — this is the next slice after RFC-002 (shipped).
> **Branch naming:** `consensus/stealth-script-v2-rfc-003`
> **Status:** LANDED (2026-09-08) — the full implementation shipped on branch
> `consensus/stealth-script-v2-rfc-003`: `keys.rs` `StealthAddress` + `verify_pk`,
> `tx.rs` `StealthExt` + locktime/sequence, `script_v2.rs` engine, `ledger.rs`
> spend branches + activation gates + checkpoint v5, the 25-test consensus suite,
> node + FFI surface. The plan below documents the design as built.

## What shipped

- **`crates/kovanica-state/src/keys.rs`** — `verify_pk(pubkey, message, sig)`;
  `StealthAddress([u8; 65])` (`0x03 || scan_pk || spend_pk`) with
  `new`/`scan_pk`/`spend_pk`/`to_bytes`/`as_bytes`/`from_slice`/`to_hex`/
  `to_kvnc`/`parse`/`address`/`derive_output`/`derive_one_time_key`/
  `view_tag_for`; `KeyPair::seed()`; `Address` versions `0x00` P2PK, `0x01`
  P2SH, `0x02` script v2, `0x03` stealth-hash (33-byte hashed owner =
  `0x03 || BLAKE3(scan_pk || spend_pk)`).
- **`crates/kovanica-state/src/tx.rs`** — `StealthExt { r, view_tag, p }`;
  `TxOutput.stealth: Option<StealthExt>`; `Transaction.n_lock_time`/`sequence`
  (u32) with `new_with_lock`; canonical encoding carries a `stealth_flag` byte +
  65-byte extension per output and locktime/sequence after the outputs.
- **`crates/kovanica-state/src/script_v2.rs`** — the stack machine (opcodes
  `0x01` ED25519_VERIFY, `0x02` CLTV, `0x03` CSV, `0x04` HASH_BLAKE3, `0x05`
  EQUAL, `0x06` AND, `0x07` OR, `0x08` THRESHOLD), `SCRIPT_V2_MAX_LENGTH =
  1024`, `SCRIPT_V2_STEP_BUDGET = 1000`, `ScriptV2::new` / `ScriptV2::execute`.
  Note: `execute` does **not** pre-load the sighash onto the stack — the initial
  stack is the witness elements only; the sighash is an environment value
  available to `ED25519_VERIFY`/`THRESHOLD` (deliberate divergence from the
  RFC's original §5.3 wording).
- **`crates/kovanica-state/src/ledger.rs`** — spend branches for `is_script_v2()`
  (witness[0] = script, BLAKE3 match → `ScriptHashMismatch`, `ScriptV2::new` →
  `InvalidRedeemScript`, execute → `BadSignature`) and `is_stealth()` (witness
  exactly 1 × 64B sig, `verify_pk(&stealth.p, &sighash, &sig)` → `BadSignature`);
  activation gates `STEALTH_ACTIVATION_SCORE = 0` / `SCRIPT_V2_ACTIVATION_SCORE
  = 0` with setters/getters; `CHECKPOINT_VERSION = 5` (checkpoint encoding
  carries the stealth flag + 65-byte `StealthExt` per output).
- **Consensus suite** — `crates/kovanica-state/tests/stealth_script_v2_consensus.rs`
  (25 tests: 12 stealth + 13 script v2).
- **Node surface** — `crates/kovanica-node/src/node.rs`:
  `send_to_script_v2(kp, amount, script)`, `send_to_stealth(kp, amount,
  &StealthAddress)`, `balance_of_script(script)`, `balance_of_stealth(&StealthAddress)`.
  ⚠️ `r_secret` is derived deterministically (`BLAKE3(kp.seed() || amount_le ||
  counter_le)` with a node-local `AtomicU64` counter) — production should use a
  random `r` for unlinkability.
- **FFI surface** — `crates/kovanica-ffi/src/light_node.rs`:
  `send_to_script_v2(signing_secret_hex, amount, script_hex)`,
  `send_to_stealth(signing_secret_hex, amount, stealth_address_hex)`,
  `balance_of_script(script_hex)`, `balance_of_stealth(stealth_address_hex)`.
- **Tests** — `crates/kovanica-node/tests/stealth_script_v2_node.rs` (4 tests)
  and `crates/kovanica-ffi/tests/ffi.rs` (`send_to_script_v2_and_stealth_over_ffi`).

---

## Why these two together

The 6-point plan puts **6A stealth addresses** and **3B script v2** in the same work package because they share a single **address-version bump** and a single **encoding bump**. RFC-002 already took `0x00` (P2PK) and `0x01` (P2SH). This slice adds:

- **6A:** `0x03` stealth addresses (CryptoNote-style scan/spend key pair, view-tag filter for SPV)
- **3B:** `0x02` script v2 addresses (BLAKE3(script), with `ED25519_VERIFY`, `CHECKLOCKTIMEVERIFY`, `CHECKSEQUENCEVERIFY`, hash-lock, AND/OR, threshold)

Note: the plan skips `0x02` for stealth and uses `0x03` — stealth is `0x03`, script v2 is `0x02`. Both are new address versions beyond the RFC-002 `0x00`/`0x01` pair, so they share one encoding/version bump and one activation gate.

**Decision (owner-locked, from plan):** Script v2 is deterministic and **not Turing-complete** — no loops, no recursion, a bounded execution budget. This keeps it auditable on a BlockDAG and avoids the VM decision (5.5, deferred). DeFi primitives (5.1 HTLC, 5.2 vault) build on top of script v2, so 3B must land before them.

---

## 6A — Stealth Addresses (CryptoNote-style)

### What it is

A stealth address lets a sender deliver funds to a recipient who never reveals their spend key on-chain. The recipient publishes a **scan key** (for detecting their outputs) and a **spend key** (for spending them); the sender derives an one-time output key per transaction using elliptic-curve Diffie-Hellman.

This is the same shape Kaspa's stealth-address research and Monero's rationale use: the on-chain output carries an elliptic-curve point `R = r·G` plus a short **view tag** so a light client can filter the chain for its own outputs without decoding every output.

### Address version `0x03`

```
Address v0x03 = scan_pk (32B) || spend_pk (32B)   # 64 bytes, versioned as 0x03 || 64
```

- `scan_pk` — the recipient's scan public key; anyone can derive the view tag.
- `spend_pk` — the recipient's spend public key; only the recipient can derive the one-time private key and spend.
- On-chain: `0x03 || scan_pk || spend_pk` = 65 bytes (version + 64). Renders as `kvnc…dag` like other addresses.

### Output extension

A stealth output locks value to a one-time public key `R = r·G` (32 bytes) plus a **view tag** (1 byte, first byte of `H(scan_pk · r)`), so the per-output extension is:

```
TxOutput (existing) || R (32B) || view_tag (1B)   # only for v0x03 outputs
```

The canonical encoding gains a **second flag byte** per output (or a combined flag):

- flag byte 1 (existing RFC-002): `0` = native KVNC, `1` = asset present
- flag byte 2 (new): `0` = ordinary address (P2PK/P2SH/script), `1` = stealth (`R` + view_tag follow)

So the minimum output size grows: `8 (value) + 1 (asset flag) + [32 asset] + 1 (stealth flag) + [32 R + 1 view_tag] + 33 (owner)`.

For a stealth output, the `owner` field is the **scan key** (or a derivation of it) — the exact representation is a design decision; the plan says output carries `R` + view_tag and the owner is implicit from the derivation.

### Spend authorisation

To spend a stealth output, the recipient computes the one-time private key `c = r · spend_sk` (ECDH over the curve used — Curve25519/ Ristretto, matching the existing ed25519/VRF curve), then signs the sighash with `c` as the signing key. The witness is a single 64-byte signature (like P2PK), but the verifying key is the derived one-time key, not a long-term published key.

### View-tag filter (SPV-friendly)

The view tag (1 byte) is the first byte of `H(scan_pk · r)`. A light client that knows its scan key can compute the view tag for each output it scans and match without doing a full ECDH — matching the existing `kovanica-node::spv` filter infrastructure. This is why the plan calls stealth "SPV-friendly" and pairs it with the existing SPV/filter work (Slice 5).

### What validates

- Encoding: `v0x03` address parse/encode roundtrip, `R` + view_tag encoding/decoding.
- Spend: derived one-time key verifies the signature against the sighash.
- Conservation: stealth outputs participate in per-asset conservation identically to ordinary outputs (asset_id still applies).
- Activation gate: stealth is a consensus upgrade gated on blue score (`STEALTH_ACTIVATION_SCORE`, default 0), same template as RFC-001/RFC-002. Pre-activation, `v0x03` outputs and spends are rejected (`PreActivationStealth`).

---

## 3B — Script v2 (deterministic, non-Turing-complete)

### What it is

A script-v2 address locks funds behind a small deterministic program rather than a single key or a threshold multisig. The program executes against the transaction sighash and the input's witness stack, with a bounded execution budget (step count), no loops, no recursion.

This is the substrate for HTLC (5.1), time-lock vaults (5.2), and token-staking sortition that already lives in `stake.rs` (5.3). It is **not** a VM — see 5.5 for the deferred VM research gate.

### Address version `0x02`

```
Address v0x02 = BLAKE3(script_bytes)   # 32-byte script hash, versioned as 0x02 || 32
```

Same shape as P2SH (`0x01`), but the redeem script is the v2 script itself. The witness for a v2 spend is `vec![script_bytes, witness_elem_1, ..., witness_elem_N]` — the script + the stack the script runs against.

### Opcodes (initial set)

The plan names these explicitly:

| Opcode | Semantics | Source reference |
|--------|-----------|-----------------|
| `ED25519_VERIFY` | Pop sig (64B) + pk (32B); verify sig over sighash against pk | ed25519 (existing) |
| `CHECKLOCKTIMEVERIFY` (CLTV) | Fail if tx nLockTime < stack value | BIP-65 |
| `CHECKSEQUENCEVERIFY` (CSV) | Fail if tx sequence/relative lock < stack value | BIP-112 |
| `HASH_BLAKE3` | Pop input, push `BLAKE3(input)` | hash primitive |
| `EQUAL` | Pop two values, push 1 if equal else 0 | comparison |
| `AND` / `OR` | Boolean combine of top stack values | control flow |
| `THRESHOLD` / threshold logic | M-of-N within the script (composes with the multisig idea but inline) | multisig-like |

The script language is stack-based, Forth-like, with a bounded step counter. Execution fails (output not spendable) on: unknown opcode, stack underflow, step budget exhaustion, signature verification failure, locktime/sequence failure, equality/threshold failure. No loops, no recursion, no indirect jumps — deterministic and bounded.

### Execution model

- The script runs against a **stack** built from the witness (after the script itself).
- The sighash is available as an environment value (so `ED25519_VERIFY` can check the spend).
- Locktime/sequence checks reference the enclosing transaction's `nLockTime` / `sequence` fields — these need to exist on `Transaction` (add if missing).
- The step budget is a consensus parameter (default e.g. 1000 steps); exceeding it fails the spend.

### Conservation & activation

- Script-v2 outputs conserve value identically to other outputs (native or asset).
- Activation gate: `SCRIPT_V2_ACTIVATION_SCORE` (default 0), same blue-score template. Pre-activation, `v0x02` outputs and v2 spends are rejected (`PreActivationScriptV2`).
- The minting rules from RFC-002 (coinbase may mint any asset; regular tx cannot mint) apply unchanged.

---

## Format bump (shared by 6A + 3B)

Adding `v0x02` and `v0x03` address versions, plus the per-output stealth flag + `R`/view_tag extension, is a **wire-format bump** on the same scale as RFC-002:

- Old wire blobs/checkpoints are undecodable by the new code.
- The genesis id changes (genesis coinbase encoding changes).
- The live testnet chain resets at activation (same as RFC-002) — the `live_sync_spike` tests go `#[ignore]` until re-captured.

The activation gate is the release mechanism: nodes set the activation blue score, pre-activation the new address versions are rejected, post-activation they work. This is the same template as `MULTISIG_ACTIVATION_SCORE` and `NATIVE_TOKEN_ACTIVATION_SCORE`.

---

## Scope of this slice (in scope / out of scope)

### In scope

1. **`keys.rs`:** add `VERSION_SCRIPT_V2 = 0x02` and `VERSION_STEALTH = 0x03` constants; extend `from_slice` / `parse` to accept versions up to `0x03`; add `Address::script_v2(script)` and `Address::stealth(scan_pk, spend_pk)` constructors; add `is_script_v2` / `is_stealth` predicates.
2. **`tx.rs`:** extend `TxOutput` encoding with the stealth flag byte + `R` (32B) + view_tag (1B) when the output is stealth; extend `decode` accordingly; add `Transaction` fields for `nLockTime` / `sequence` if missing (needed by CLTV/CSV); add sighash domain that includes locktime/sequence.
3. **`utxo.rs` / `ledger.rs`:** stealth outputs participate in conservation identically; activation gate for stealth + script v2 (two new score thresholds, same template as existing gates); v2 script execution in the spend path (run the script against the witness stack with step budget).
4. **`validation.rs`:** context-free structural checks for v2 script (valid opcodes, bounded size, no loops); context-free checks for stealth output encoding.
5. **Node surface:** `send_to_script_v2(kp, amount, script)`, `send_to_stealth(kp, amount, scan_pk, spend_pk)`, `balance_of_script`/`balance_of_stealth` as appropriate; FFI surface for the new send paths.
6. **Tests:** a `tests/stealth_script_v2_consensus.rs` suite covering:
   - Stealth: address encode/decode roundtrip, `kvnc…dag` roundtrip, view-tag derivation, spend with derived key, wrong scan/spend key rejected, conservation, activation boundary (pre/post/exact), mixed block with native/asset/stealth, parallel-DAG conflict, checkpoint/snapshot roundtrip.
   - Script v2: script parse/validate, each opcode executes correctly, step-budget exhaustion fails, CLTV/CSV enforce locktime/sequence, hash-lock redeem/refund, AND/OR/threshold logic, activation boundary, conservation, mixed block, parallel-DAG conflict, checkpoint/snapshot roundtrip.
7. **`docs/RFC-003-ScriptV2.md`** (or combined `RFC-003-ScriptV2-and-Stealth.md`): full spec for both, mirroring the RFC-002 structure.
8. **AGENTS.md:** update the address-version table, add the RFC-003 section, update the roadmap/upgrade-phases table.

### Out of scope (next slices)

- HTLC / atomic swap (5.1) — builds on script v2.
- Time-lock vault (5.2) — builds on script v2 CLTV/CSV.
- Token staking extensions (5.3) — `stake.rs` already exists; v2 script may extend it later.
- DEX design doc (5.4), VM research gate (5.5) — deferred.
- CoinJoin (6.2), CT/Bulletproofs research (6.3), P2P privacy (6.4) — later.

---

## Reference protocols (name them in code/comments)

- **Stealth addresses:** CryptoNote (v2/v3 one-time keys, view-tag filter), Monero stealth-address rationale, Kaspa stealth-address research.
- **Script v2:** BIP-65 (CLTV), BIP-112 (CSV), Bitcoin script (stack-based Forth model, but bounded and non-Turing-complete here), Cardano Plutus/MAYBE (for the "deterministic script, no VM" rationale), Algorand TEAL (for bounded-step execution as a reference for the budget).
- **Activation gating:** the template is the existing RFC-001/RFC-002 blue-score gate — cite that.

---

## Test strategy

Per AGENTS.md conventions: **deterministic + adversarial** tests for consensus-affecting code.

- Deterministic: roundtrip encode/decode, known-key spends, known-script executions with expected stack results, activation boundary at exact blue scores.
- Adversarial: wrong scan/spend key, malformed script (invalid opcodes, unbounded size, loop attempts), script that exceeds step budget, double-spend of a stealth output across parallel blocks, script that tries to bypass locktime, mixed-version blocks, parallel-DAG conflicts resolved by linearization.
- Invariant: every blue block's spent outputs are validly authorised by their address version's rule (P2PK signature, P2SH threshold, v2 script success, stealth derived-key signature) — a general assertion over the applied ledger.

---

## Dependencies & ordering within the slice

1. **`keys.rs` address versions + constructors + parse** — foundation; nothing else compiles without it.
2. **`tx.rs` output encoding extension (stealth flag + R + view_tag)** — needed by utxo/ledger.
3. **`Transaction` locktime/sequence fields + sighash domain** — needed by CLTV/CSV.
4. **Activation gates in `ledger.rs`** (two new score thresholds) — needed before any spend validation.
5. **v2 script execution** — needed by script-v2 spend validation.
6. **Stealth spend derivation + verification** — needed by stealth spend validation.
7. **Node surface + FFI** — last, after the ledger path is solid.
8. **Tests** — throughout, but the full suite last.

---

## Risk notes (from AGENTS.md hard-won lessons)

- **Format bump:** this slice bumps the wire format again. Old blobs are undecodable. The live testnet resets at activation — coordinate with the testnet operators before merging to `main` (or keep the branch as a ready-to-activate PR).
- **Identity-preserving block replay:** once new address versions and encoding exist, never rebuild a received block with a fresh template — use the identity-preserving insert paths. Existing lesson still applies.
- **`unsafe` forbidden:** the ECDH for stealth derivation must use the existing curve libraries (Ristretto/ed25519) with no `unsafe`.
- **Determinism:** script execution must be pure — no HashMap iteration order, no wall-clock, no unstable sorts. The step budget is a hard bound so execution time is bounded and deterministic.
- **Tie-breaks:** any address/script ordering falls back to `BlockId` byte order.

---

## Estimated size

- `keys.rs` additions: ~80–120 lines (two new versions, constructors, predicates, parse extensions, roundtrip tests).
- `tx.rs` encoding extension: ~60–100 lines (stealth flag, R, view_tag encode/decode; locktime/sequence fields if missing).
- `ledger.rs` activation gates: ~40–60 lines (two new score thresholds, same template).
- v2 script execution: ~200–350 lines (opcode table, stack machine, step budget, CLTV/CSV/hash-lock/threshold).
- Stealth spend derivation: ~40–80 lines (ECDH one-time key, verify).
- Node surface: ~60–100 lines (new send paths, FFI passthrough).
- RFC doc: ~150–250 lines.
- Tests: ~400–700 lines (stealth + script v2 adversarial suites).
- AGENTS.md update: ~30–50 lines.

Total estimate: **~1200–1800 lines** across ~10 files, plus the RFC doc and AGENTS.md update.

---

## Next after this slice

Once 6A+3B lands and passes, the critical path continues with **5A HTLC / atomic swap** (built on script v2 hash-lock + CLTV/CSV), then **5B time-lock vault**, then **5C token staking extensions**. The DeFi primitives (5.1, 5.2) are the payoff for 3B — they're why script v2 exists.
