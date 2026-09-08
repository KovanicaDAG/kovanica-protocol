# HTLC / Atomic Swap — RFC-004 (Slice 5A)

**Status:** ✅ SHIPPED (merged to `main` via PR #88, `fb13741`, 2026-09-08)
**Branch:** `consensus/htlc-atomic-swap-rfc-004` (merged; RFC-004 rebased onto `main` as a single clean commit, redundant RFC-003 stack dropped)
**Builds on:** RFC-003 script v2 (hash-lock + timelock primitives), RFC-001 multisig (template pattern), RFC-002 (per-asset conservation)
**Reference protocols:** Bitcoin HTLC (BIP-199), Tier Nolan atomic swap, Lightning Network (preimage revelation), BIP-65/BIP-113 (absolute locktime). BIP-68/BIP-112 (relative locktime) deferred to 5.2 vault.

## 0. Decision

**A dedicated, structurally-validated HTLC template with a new address version `0x04`** — not an extension of script v2. Follows the RFC-001 multisig pattern: versioned address = `version || BLAKE3(template_bytes)`, template validated at parse, ledger branches on owner version. Commits to all four HTLC parameters (preimage hash, recipient pk, sender pk, timeout) via the script hash; ledger enforces the two spend paths directly.

Two gaps in the current code force this design:

1. **Commitment gap** — script v2 has no immediate-data push and no `OP_IF/ELSE/ENDIF`, so it cannot commit to hash/pubkeys/timeout in the script. The existing hash-lock test puts the expected hash in the *witness*; the script hash commits to nothing.
2. **Time-enforcement gap** — script v2's CLTV/CSV are *decorative*: `CLTV` checks `tx.n_lock_time >= v` but **nothing checks the block's actual height**. A spender can bypass any CLTV by declaring `n_lock_time = 4_000_000_000`.

**No wire-format bump.** HTLC is an address version in the existing 33-byte `owner` field; tx encoding, checkpoint (v5), snapshot, and `kvnc…dag` rendering are unchanged. Old nodes reject version `0x04` at parse (`VERSION_MAX`) — soft incompatibility handled by activation gating. **No testnet reset.**

## 1. HTLC representation

### Template (`HtlcScript`, 100 bytes)

```
offset  size  field
0       32    preimage_hash   — BLAKE3(preimage), 32 bytes
32      32    recipient_pk    — Ed25519 public key, 32 bytes
64      32    sender_pk       — Ed25519 public key, 32 bytes
96      4     timeout         — u32 LE, absolute block height
```

No version byte inside the template — the address version (`0x04`) is the discriminator.

### Address

```rust
Address::VERSION_HTLC = 0x04
Address::htlc(script_hash)          // 0x04 || BLAKE3(template_bytes), 33 bytes
Address::from_htlc_script(script)   // htlc(BLAKE3(script))
Address::is_htlc()
VERSION_MAX bumps 0x03 → 0x04
```

Rendering unchanged (`kvnc…dag`). Update the `version_max_is_stealth` unit test in `keys.rs`.

### Parse-time validation (`HtlcScript::new` / `parse`)

Reject if: length ≠ 100 (`WrongLength`); `recipient_pk`/`sender_pk` not valid Ed25519 points (`InvalidRecipientKey`/`InvalidSenderKey`); `recipient_pk == sender_pk` (`DuplicateKeys` — mirrors multisig duplicate rule). `preimage_hash`: any 32 bytes accepted. `timeout`: any u32 accepted (`0` = immediately refundable).

### Why not reuse version `0x02`?

The owner version is the discriminator. Under `0x02` the ledger would have to distinguish HTLC template from script-v2 program by content — a coincidental 100-byte parse would misclassify. Dedicated version keeps the branch unambiguous.

## 2. Consensus rules

### Activation gating

- `HTLC_ACTIVATION_SCORE: u64 = 0` (default), `Ledger::set_htlc_activation_score(score)` + getter — same shape as RFC-001/002/003.
- Pre-activation (`blue_score <= activation_score`): reject HTLC outputs and spends with `PreActivationHtlc { tx, blue_score, activation_score }`.
- Threaded through `apply_block_inner`/`apply_regular` (both incremental `Ledger` and batch `apply_dag`/`apply_block` paths). Coinbase outputs exempt (coinbase path bypasses `apply_regular`).

### Conservation

HTLC outputs are ordinary `TxOutput::new(value, asset_id, Address::htlc(...))`. Per-asset conservation is owner-agnostic — no new rules. Fees in native KVNC only.

### Spend authorization (ledger branch in `apply_regular`)

`else if prev.owner.is_htlc()` after the script-v2 branch:

```
witness[0] = template bytes
1. witness non-empty                          else InvalidWitnessCount { expected: 2, actual: 0 }
2. BLAKE3(witness[0]) == owner.payload()      else ScriptHashMismatch
3. HtlcScript::parse(witness[0])              else InvalidRedeemScript { reason }
4. branch on witness.len():
   3  → REDEEM:  witness[1] = preimage (any length), witness[2] = recipient sig (64B)
        a. sig.len() == 64                    else BadSignatureSize
        b. BLAKE3(preimage) == preimage_hash  else HtlcPreimageMismatch
        c. verify_pk(recipient_pk, sighash, sig)  else BadSignature
   2  → REFUND:  witness[1] = sender sig (64B)
        a. sig.len() == 64                    else BadSignatureSize
        b. height >= timeout                  else HtlcTimeoutNotReached { height, timeout }
        c. verify_pk(sender_pk, sighash, sig) else BadSignature
   n  → InvalidWitnessCount { expected: 2, actual: n }
```

- Redeem has **no time constraint** (BIP-199: CLTV sits on the refund path only).
- Paths mutually exclusive by witness length — deterministic, no branch evaluation.
- `verify_pk` (stealth's verifier) rather than `verify` (P2PK-only).

### New `LedgerError` variants

```rust
PreActivationHtlc { tx: TxId, blue_score: u64, activation_score: u64 },
HtlcPreimageMismatch { tx: TxId, input: usize },
HtlcTimeoutNotReached { tx: TxId, input: usize, height: u64, timeout: u32 },
NonFinalTransaction { tx: TxId, n_lock_time: u32, height: u64 },
```

Reused: `ScriptHashMismatch`, `InvalidRedeemScript`, `InvalidWitnessCount`, `BadSignatureSize`, `BadSignature`.

### Companion consensus fix — CLTV becomes real (BIP-65/BIP-113)

In `apply_regular`, before the input loop:

```rust
// BIP-65/BIP-113: a transaction whose n_lock_time exceeds the block's height
// is non-final and cannot be mined.
if tx.n_lock_time() as u64 > height {
    return Err(NonFinalTransaction { tx: tx.id(), n_lock_time: tx.n_lock_time(), height });
}
```

Effective constraint: `block_height >= n_lock_time >= v` — Bitcoin's semantics. Blast radius tiny: `n_lock_time` defaults to `0` in every constructor; only the two CLTV tests set it (updated to real semantics). Consensus change → own rationale + adversarial tests. **Separable commit.** HTLC template does not depend on it. **CSV deferred to 5.2** (needs per-UTXO creation-height tracking `UtxoSet` doesn't store).

## 3. Atomic swap orchestration (`atomic_swap.rs`)

### Protocol (Tier Nolan / BIP-199)

```
1. Alice generates preimage x, computes H = BLAKE3(x).
2. Alice funds HTLC-A:  H, recipient=Bob, sender=Alice, timeout=T_A, value=amount_a (asset_a).
3. Bob verifies HTLC-A on-chain (script hash, recipient=Bob, timeout=T_A).
4. Bob funds HTLC-B:    H, recipient=Alice, sender=Bob, timeout=T_B < T_A, value=amount_b (asset_b).
5. Alice redeems HTLC-B with x → gets asset_b; x revealed on-chain.
6. Bob extracts x from HTLC-B's redeem witness, redeems HTLC-A with x → gets asset_a.
7. Fallback: Bob refunds HTLC-B after T_B; Alice refunds HTLC-A after T_A.
```

**Timeout ordering `T_B < T_A` is the safety invariant** — `SwapSession::new` enforces it. Margin `T_A − T_B` is off-chain policy (recommend ≥ 2× expected block propagation latency; on a DAG, height advances on the selected chain, so margin must cover gossip + linearization lag).

### Module contents (pure library, no node dependency)

```rust
pub struct SwapParams {
    pub amount_a: u64,
    pub asset_a: Option<AssetId>,
    pub amount_b: u64,
    pub asset_b: Option<AssetId>,
    pub timeout_a: u32,   // HTLC-A refund height (absolute)
    pub timeout_b: u32,   // HTLC-B refund height; must be < timeout_a
}

pub enum SwapRole { Alice, Bob }

pub struct SwapSession {
    pub preimage: [u8; 32],
    pub preimage_hash: [u8; 32],
    pub htlc_a: HtlcScript,   // recipient = Bob, sender = Alice
    pub htlc_b: HtlcScript,   // recipient = Alice, sender = Bob
}

impl SwapSession {
    pub fn new(params: &SwapParams, alice_pk: [u8; 32], bob_pk: [u8; 32],
               preimage: [u8; 32]) -> Result<Self, SwapError>;
    // SwapError::TimeoutOrdering   (timeout_b >= timeout_a)
    // SwapError::SameParty         (alice_pk == bob_pk)
    pub fn verify_against(&self, script: &HtlcScript, role: SwapRole) -> bool;
    // Bob's on-chain verification of HTLC-A before funding HTLC-B.
}

pub fn generate_preimage() -> [u8; 32];          // OsRng; tests inject a fixed preimage
pub fn preimage_hash(preimage: &[u8]) -> [u8; 32];
pub fn extract_preimage(tx: &Transaction, script: &HtlcScript) -> Option<Vec<u8>>;
// Scans tx inputs for a redeem of `script` (witness.len()==3, witness[0]==script.bytes())
// and returns witness[1] — the trustless preimage-revelation path.
```

### Node API (`node.rs`, mirroring `send_to_script_v2` / `build_transfer_with_outputs`)

```rust
pub struct HtlcInfo {
    pub script: HtlcScript,
    pub address: Address,
    pub tx_id: TxId,
    pub outpoint: OutPoint,
}

pub fn create_htlc(&mut self, kp: &KeyPair, amount: u64, asset_id: Option<AssetId>,
                   recipient_pk: [u8; 32], preimage_hash: [u8; 32],
                   timeout: u32) -> Result<HtlcInfo, NodeError>;
// Builds TxOutput::new(amount, asset_id, Address::from_htlc_script(&script)),
// mines a block on the tips (same flow as send_to_script_v2).

pub fn redeem_htlc(&mut self, kp: &KeyPair, outpoint: OutPoint, script: &HtlcScript,
                   preimage: &[u8], to: Address) -> Result<TxId, NodeError>;
// Native: single input, witness [script, preimage, recipient_sig],
//         output = TxOutput::native(htlc_value - min_fee, to).
// Asset:  HTLC input (asset output to `to`) + a native fee input selected
//         largest-first from kp's UTXOs (mirrors build_transfer_with_asset).

pub fn refund_htlc(&mut self, kp: &KeyPair, outpoint: OutPoint, script: &HtlcScript,
                   to: Address) -> Result<TxId, NodeError>;
// Same shape, witness [script, sender_sig]. Fails with HtlcTimeoutNotReached
// until the chain reaches script.timeout().

pub fn balance_of_htlc(&self, script: &HtlcScript) -> u64;
pub fn scan_for_htlc_redeem(&self, script: &HtlcScript, from_height: u64)
    -> Option<(TxId, Vec<u8>)>;
// Linearizes from `from_height`, decodes payloads, runs extract_preimage —
// Bob's trustless discovery of Alice's redeem.
```

### RPC (`rpc.rs`, line commands)

```
htlc_create <from-seed> <amount> <recipient-pk-hex> <preimage-hash-hex> <timeout>
    → ok <tx-id> <script-hex> <address>
htlc_redeem <from-seed> <outpoint-tx-hex> <outpoint-index> <script-hex> <preimage-hex> <to-addr>
    → ok <tx-id>
htlc_refund <from-seed> <outpoint-tx-hex> <outpoint-index> <script-hex> <to-addr>
    → ok <tx-id>
htlc_balance <script-hex>
    → ok <balance>
```

### FFI (`light_node.rs`)

```rust
pub struct HtlcInfo {
    pub script_hex: String,
    pub address: String,
    pub tx_id: String,
    pub outpoint_tx: String,
    pub outpoint_index: u32,
}
pub fn create_htlc(&self, signing_secret_hex: String, amount: u64,
                   asset_id_hex: Option<String>, recipient_pk_hex: String,
                   preimage_hash_hex: String, timeout: u32) -> Result<HtlcInfo, LightNodeError>;
pub fn redeem_htlc(&self, signing_secret_hex: String, outpoint_tx_hex: String,
                   outpoint_index: u32, script_hex: String, preimage_hex: String,
                   to_address: String) -> Result<String, LightNodeError>;
pub fn refund_htlc(&self, signing_secret_hex: String, outpoint_tx_hex: String,
                   outpoint_index: u32, script_hex: String,
                   to_address: String) -> Result<String, LightNodeError>;
pub fn balance_of_htlc(&self, script_hex: String) -> Result<u64, LightNodeError>;
pub fn htlc_script_hex(&self, preimage_hash_hex: String, recipient_pk_hex: String,
                       sender_pk_hex: String, timeout: u32) -> Result<String, LightNodeError>;
pub fn htlc_preimage_hash_hex(&self, preimage_hex: String) -> Result<String, LightNodeError>;
```

## 4. Test plan

Reference protocols named in the suite header: **BIP-199**, **Tier Nolan atomic swap**, **Lightning**, **BIP-65/BIP-113**, **RFC-001/002/003**.

**kovanica-state `tests/htlc.rs`** (~23 tests):

| Test | Asserts |
|---|---|
| `htlc_redeem_happy_path` | correct preimage + recipient sig moves funds |
| `htlc_refund_happy_path` | chain advanced past timeout, sender refunds |
| `htlc_refund_before_timeout_rejected` | `HtlcTimeoutNotReached` |
| `htlc_refund_at_timeout_boundary` | `height == timeout` succeeds (`>=` semantics) |
| `htlc_wrong_preimage_rejected` | `HtlcPreimageMismatch` |
| `htlc_wrong_recipient_key_rejected` | redeem signed by sender → `BadSignature` |
| `htlc_refund_wrong_key_rejected` | refund signed by recipient → `BadSignature` |
| `htlc_redeem_after_timeout_allowed` | BIP-199: redeem still valid post-timeout until refund |
| `htlc_script_hash_mismatch` | wrong `witness[0]` → `ScriptHashMismatch` |
| `htlc_malformed_script_rejected` | bad length / invalid pk / duplicate pks → `InvalidRedeemScript` |
| `htlc_witness_count_rejected` | 1 or 4 elements → `InvalidWitnessCount` |
| `htlc_parallel_double_spend` | parallel redeem + refund blocks both valid in own view; merger resolves deterministically |
| `htlc_activation_boundary` | pre / exact-boundary / post activation for outputs and spends |
| `htlc_checkpoint_roundtrip` | HTLC outputs + spends survive `write_checkpoint`/`read_checkpoint` |
| `htlc_snapshot_roundtrip` | same for `write_snapshot`/`read_snapshot` |
| `htlc_mixed_block` | HTLC + P2PK + P2SH + script v2 + stealth + native token in one block |
| `htlc_asset_swap` | asset HTLC redeem conserves the asset; fee in native |
| `htlc_duplicate_scripts` | two identical templates → distinct outputs, both spendable |
| `htlc_cross_version_confusion` | script-v2 spend of an HTLC output fails (version disambiguates) |
| `htlc_timeout_overflow` | `timeout = u32::MAX` → refund rejected at any reachable height |
| `htlc_determinism` | same DAG built twice → identical outcomes |
| `cltv_non_final_rejected` | `n_lock_time > block height` → `NonFinalTransaction` (companion fix) |
| `cltv_final_at_height` | `n_lock_time == block height` → OK |

**Updated:** `stealth_script_v2_consensus.rs` CLTV tests move to real semantics (`n_lock_time = 1`, `v = 1` pass; `n_lock_time = 1`, `v = 2` fail). CSV tests unchanged (deferred).

**kovanica-node `tests/htlc_node.rs`** (~4 tests):
- `swap_e2e_same_chain` — full two-party swap: Alice creates HTLC-A, Bob verifies + creates HTLC-B, Alice redeems B, Bob extracts preimage and redeems A; assert both balances.
- `swap_refund_path` — Alice never redeems; Bob refunds B after T_B; Alice refunds A after T_A.
- `swap_timeout_ordering_enforced` — `SwapSession::new` rejects `timeout_b >= timeout_a`.
- `htlc_rpc_commands` — the four line-RPC commands end-to-end.

**kovanica-ffi `tests/ffi.rs`** (+2): `htlc_over_ffi` (create/redeem/refund/balance), `swap_session_over_ffi` (construction + verification).

## 5. Scope split & implementation lanes

| Crate | Files | Est. lines | Content |
|---|---|---|---|
| **kovanica-state** | `src/htlc.rs` (new) | ~350 | `HtlcScript`, parse/validate, `HtlcScriptError`, constructors, `address()`, accessors, witness-shape helpers |
| | `src/keys.rs` | ~40 | `VERSION_HTLC = 0x04`, `VERSION_MAX` bump, `htlc()`/`from_htlc_script()`/`is_htlc()`, update `version_max_is_stealth` test |
| | `src/ledger.rs` | ~150 | `HTLC_ACTIVATION_SCORE`, setter/getter, threading, HTLC spend branch, `NonFinalTransaction` rule, 4 error variants |
| | `src/lib.rs` | ~10 | re-exports |
| | `tests/htlc.rs` (new) | ~700 | the 23-test suite |
| | `tests/stealth_script_v2_consensus.rs` | ~30 | CLTV tests → real semantics |
| **kovanica-node** | `src/atomic_swap.rs` (new) | ~300 | `SwapParams`, `SwapSession`, `SwapError`, preimage helpers, `extract_preimage` |
| | `src/node.rs` | ~250 | `HtlcInfo`, `create_htlc`, `redeem_htlc`, `refund_htlc`, `balance_of_htlc`, `scan_for_htlc_redeem` |
| | `src/rpc.rs` | ~80 | 4 line commands |
| | `tests/htlc_node.rs` (new) | ~300 | swap e2e + RPC |
| **kovanica-ffi** | `src/light_node.rs` | ~150 | 6 methods |
| | `tests/ffi.rs` | ~50 | 2 cases |
| **docs** | `docs/RFC-004-Htlc.md` (new) | ~350 | the spec |
| | `docs/plans/htlc-atomic-swap.md` (this file) | ~200 | plan doc |
| | `AGENTS.md`, `SOURCE_OF_TRUTH.md`, `README.md` | ~50 | status + roadmap updates |
| **Total** | | **~2,600–3,100** | |

**Lanes** (each ends green: `cargo fmt` + `clippy -D warnings` + `cargo test`):
1. **Lane A — state substrate:** `htlc.rs` + `keys.rs` + `ledger.rs` + `tests/htlc.rs` (full 23-test suite) + CLTV fix + updated CLTV tests.
2. **Lane B — docs:** RFC-004 spec + AGENTS.md + SOURCE_OF_TRUTH.md + README status updates.
3. **Lane C — node:** `atomic_swap.rs` + `node.rs` + `rpc.rs` + `tests/htlc_node.rs`.
4. **Lane D — FFI:** `light_node.rs` + `ffi.rs` cases (after C lands).

## 6. Risks & invariants

1. **Determinism.** Timeout uses the block's **height** — a pure function of the DAG, never wall-clock. Preimage generated off-chain; ledger never samples randomness. Path discrimination by witness length. Parallel double-spend test asserts deterministic resolution.
2. **Format bump: none.** Address version in existing 33-byte `owner` field. **No testnet reset.**
3. **Identity-preserving block replay.** HTLC adds no block fields; no `_with_htlc` readers needed (unlike hybrid).
4. **DAG-vs-chain locktime semantics.** `n_lock_time` = absolute block height; `height == blue_score` for every block, so the clock is unambiguous. A refund tx is valid iff **its own block's** height ≥ timeout. Margin `T_A − T_B` must cover DAG propagation latency (off-chain policy). CSV deferred to 5.2 (needs per-UTXO creation-height tracking).
5. **CLTV semantics change.** `NonFinalTransaction` changes shipped script-v2 behavior — own rationale + adversarial tests, **separable commit**. HTLC template does not depend on it.
6. **Activation default.** `HTLC_ACTIVATION_SCORE = 0` = immediately active on existing testnet (consistent with RFC-001/002/003).

## 7. Open items

- Exact `SwapError` variants and `SwapSession::verify_against` semantics (compare all four fields + role).
- `scan_for_htlc_redeem` scans from a height (linearized order is the scan order).
- Recommended `T_A − T_B` margin for the testnet (proposal: 100 blocks at 1 BPS, tunable).
- Explorer/SPV need no surface change (addresses render generically; SPV filters use the 33-byte owner) — verify with one test each.