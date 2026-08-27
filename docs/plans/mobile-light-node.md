# Mobile Light-Node Slices 4–8 — Implementation Plan

Continues Stage-3 slices 1–3 (hybrid consensus → enforcement → FFI). Baseline:
slice 3 landed (kovanica-ffi, Kotlin/Swift bindings committed, 37 suites green,
clippy 0). Rules that carry into every slice below:

- Tests + `cargo clippy --workspace --all-targets` (0 warnings) green before a
  slice counts as done; AGENTS.md gets its entry in the same change.
- Do not touch the pre-existing unrelated diffs in `docs/` and `web/`
  (baseline commit `479f1a8`); new files only.
- Generated bindings are committed; CI must prove they don't drift (Slice 6).

---

## Slice 4 — Custody & stake lifecycle in the FFI ✅ LANDED

The current FFI is seed-int demo custody. This slice makes transfers accept
real secrets and completes the stake lifecycle (bond → mature → unbond).

### Verified facts this slice builds on (do not re-derive)

- Unbond tag is exactly `b"KVU1"` (`stake::UNBOND_PREFIX`, `is_unbond_tag`
  compares the whole tag — no pk suffix, unlike bonds).
- Ledger rules (ledger.rs `apply_tx_with_stake`): frozen outpoints spend ONLY
  through unbond txs; an unbond's inputs must ALL be matured frozen outpoints
  (`check_unbond` errors otherwise); value-conserving like any tx.
- Maturity: `height >= bond_height + UNBOND_MATURITY(=100)` where height is
  the applying block's blue height = `height(selected_parent) + 1`
  (ledger.rs:1091). Predictable: a block on top of the selected tip gets
  `tip_blue_score() + 1`.
- `StakeState::{iter_frozen, check_unbond}` are public; `Freeze {vrf_pk,
  bond_height, value}` fields are public. Frozen outputs ARE UTXOs in
  ledger_state (owner = bonder address).
- Validator identity in FFI is ALREADY import-grade: `set_validator_seed`
  takes any client-generated 32 bytes (`vrf_keypair_from_seed`). No new
  validator API needed — document it.
- Hybrid un-retargeted PoW work target is legacy 1 ⇒ producing 100+ blocks in
  tests is instant (`mine_nonce` succeeds on first hash).

### 4a. Imported spending keys

**Node** — add:
```rust
pub fn send_with(&mut self, kp: &KeyPair, amount: u64, to: Address)
    -> Result<Sent, NodeError>
```
Body = today's `send_to`, signing via `kp` instead of `KeyPair::from_u64`.
Refactor: extract `build_transfer_with(&self, kp, amount, to_addr)` out of
`build_transfer_to`; `send_to`/`send` delegate to `send_with`.

**FFI**: `send_from(signing_secret_hex, amount, to_address) -> SendReceipt`
(`KeyPair::from_seed(hex-decoded 32)` → `send_with`). Error additions:
`BadSecretLength { expected, got }`. Doc contract: secrets cross the bridge
once per call, never stored.

### 4b. Unbonding

**Ledger** — add trivial read helper `tip_blue_score() -> u64` (selected tip's
ghostdag blue_score; mirrors finality_score internals).

**Node** — add (all under `kovanica-node/src/node.rs`):
```rust
pub fn chain_height(&self) -> Result<u64, NodeError>            // tip_blue_score
pub fn pending_unbond_height(&self, vrf_pk: &[u8;32])
    -> Result<Option<u64>, NodeError>   // min(bond_height+100) still > now
pub fn unbond_with(&mut self, kp: &KeyPair, vrf_pk: &[u8;32],
                   amount: u64, to: Address) -> Result<Sent, NodeError>
```
`unbond_with` algorithm:
1. `amount == 0` → ZeroAmount.
2. Stake view at selected tip (`ledger.stake_state(&dag.selected_tip())`,
   default-empty fallback); collect `(op, Freeze)` where `f.vrf_pk == *vrf_pk`
   AND owner(op) `== kp.address()` (owner mismatch on a pk-matching op →
   `UnbondOwnerMismatch { outpoint }`), sorted by `(bond_height, op)` FIFO.
3. `next_h = chain_height() + 1`; take matured ops (`bond_height +
   UNBOND_MATURITY <= next_h`) until sum ≥ `amount`.
4. Short → `InsufficientStake { requested, available }` (available =
   matured sum; distinguishes "bonded but immature" from "not bonded").
5. Build tx: inputs = selected ops, tag = `UNBOND_PREFIX.to_vec()`, one sig
   attached to every input (single-owner selection). Fee 0 (ledger allows;
   avoids whole-coin + fee edge): outputs `[amount → to]` plus
   `total − amount → to` change when > 0. Value-conserving by construction.
6. Seal exactly like `send_to`: parents = tips, `next_work_target().unwrap_or(1)`
   (correct under hybrid AND retargeting), `mine_nonce`, direct `ledger.insert`.

**NodeError additions**: `InsufficientStake { requested: u64, available: u64 }`,
`UnbondOwnerMismatch { outpoint: OutPoint }` (+ Display arms).

**FFI** (symmetric with `bond_stake(seed, amount)`):
- `unbond(from_seed: u64, amount: u64) -> SendReceipt` — signer/funds owner =
  seed actor (must be who bonded), vrf_pk = configured validator identity,
  change/self-pay to actor's own address.
- `pending_unbond_height() -> Option<u64>` and `chain_height() -> u64`.
- Error mapping: `InsufficientStake` passthrough as typed variant.

### 4c. Retarget-enabled hybrid e2e (fold into ffi.rs)

`enable_hybrid(1, 1, NOMINAL_WORK, true)` on two nodes: A produces PoW-fallback
block + bonded staked block; B receives A's blob — success proves A's PoW work
pinned exactly what B's retarget policy expects (`WorkTargetMismatch` would
reject otherwise). Staked block still pins nominal work.

### Tests

`crates/kovanica-node/tests/unbond_node.rs` (pure Rust, fast):
1. **lifecycle**: bond 500 → immediate `unbond` → InsufficientStake
   (nothing matured yet); produce ~105 empty blocks (cheap: legacy work 1);
   `unbond(500)` ok → total_stake 0, funds back and spendable via `send`;
   second unbond → InsufficientStake again.
2. **FIFO partial maturity**: bond 300 at h₁, produce K blocks, bond 300 at
   h₂ > h₁; advance so h₁+100 ≤ h < h₂+100; `unbond(300)` consumes ONLY the
   older coin; total_stake drops to 300; second `unbond(300)` short.
3. **ownership guard**: unbond signed by a non-owner key → UnbondOwnerMismatch.

`ffi.rs` additions: `send_from` happy path + bad-length error; retarget e2e
(4c); thin unbond smoke through FFI types (matured path reuses test-1 flow).

### Gotchas

- Blue score ≈ heights map along the selected chain; exact in linear test
  chains, authoritative answer always comes from `ledger.insert` errors.
- An unbond carried in a block whose selected parent predates enough maturity
  fails atomically at insert (`NodeError::Insert(LedgerInsertError::Stake …)`)
  — never partially applies.
- Unbonding frees eligibility immediately: pre-state of the NEXT block no
  longer counts the stake.

### Landed as built (deviations & additions)

- `Node::send_with(kp, amount, to)` + `build_transfer_with` refactor exactly
  as planned; `send`/`send_to` delegate. FFI gained `send_from(secret_hex,
  amount, to_address)` (secret used per-call, never stored) with typed
  `BadSecretLength` errors; demo founder secret is reproducible in tests via
  `KeyPair::from_u64` = 8 LE bytes zero-padded.
- Validator custody needed NO new API — `set_validator_seed` already accepts
  client-generated 32-byte secrets; documented, not re-plumbed.
- `Node::{chain_height, pending_unbond_height(vrf_pk), unbond_with(kp,
  vrf_pk, amount, to)}` + `Ledger::tip_blue_score()`; FFI mirrors as
  `unbond(from_seed, amount)`, `pending_unbond_height()`, `chain_height()`.
  New `NodeError::{InsufficientStake{requested,available},
  UnbondOwnerMismatch{outpoint}}`.
- Retarget e2e proved by peer-rejection symmetry: a PoW-fallback block whose
  work did not pin the retarget target would fail the peer's admission
  (`WorkTargetMismatch`), so successful blob sync IS the pin proof.
- Test-window surprise worth remembering: a release's own unbond block
  advances the chain height by 1, so maturity windows must be measured from
  the post-release tip — two bonds only ~2 heights apart can BOTH mature by
  the time the second release applies (`height >= matures_at` passes on
  equality). The FIFO test now separates bonds by ≥5 heights.

### 4c. Retarget-enabled hybrid e2e (small, fold into 4b's test run)

- ffi.rs test with `enable_hybrid(1, 2, nominal, retarget=true)`: PoW-fallback
  block work must equal `work_target_with(parents, default_retarget)` (compute
  expected via a second fresh node's dag query or pin to a computed constant);
  staked block still pins nominal; two-node blob sync converges under
  retargeting.

---

## Slice 5 — SPV / filter surface over the FFI ✅ LANDED

Phones verify payments without full payload download. All building blocks
exist (`kovanica-state/src/spv.rs`, `kovanica-node/src/spv.rs`: header chain,
merkle proofs, Golomb-Rice compact filters, `SpvClient`). **First step of this
slice: read both spv.rs modules and inventory their public API** — the notes
below assume the obvious shape, adjust to what's actually exported.

**FFI additions (new file `crates/kovanica-ffi/src/spv_api.rs`, re-exported)**
- `block_filter(block_id_hex) -> Vec<u8>`: serialized filter for a known block
  (delegate to spv module's filter builder).
- `filter_matches(blob: Vec<u8>, address: String) -> bool`: Golomb-Rice
  membership query for one address (decode via existing filter reader).
- `export_light_sync() -> Vec<u8>`: header-chain (+filters) blob for the
  linearized selected chain down to finality — the phone-sized sync payload.
- `receive_light_sync(blob) -> u32`: verify headers chain + store filters;
  returns headers applied.
- `prove_tx(block_id_hex, tx_id_hex) -> Vec<u8>` / `verify_tx_proof(proof,
  block_id_hex, tx_id_hex) -> bool`: merkle inclusion proofs.

**Sync flow to document in the module docs**: full node exports light-sync
blob → phone verifies headers + stores filters → phone watches addresses via
`filter_matches` → requests only matching full blocks through the existing
`export_blocks`/`receive_blocks` byte channel.

**Tests**: roundtrip filter match/no-match; light-sync blob between two
LightNodes converges tip knowledge without full payloads; tampered proof
rejected (mirror adversarial_spv.rs cases through FFI types).

### Landed as built (deviations & additions)

- Kept everything in `light_node.rs` (no separate `spv_api.rs`): the surface
  is small and shares `LightNode`'s lock/poison handling.
- Node gained two helpers instead of FFI reaching into ledger internals:
  `Node::block_filter(id, k)` (distinct output addresses → `BlockFilter`) and
  `Node::merkle_proof(id, tx_id)`. `export_spv_headers()` already existed.
- Wire formats are FFI-owned and versioned: light-sync blob = `KVLS` + v1 +
  u32 count, then fixed-160-byte headers + `k‖n‖len‖data` filters; proofs =
  `tx_id‖root‖path_len‖path…‖index‖count`. All hand-rolled BE (the protocol
  crates expose pub structs but no serialization — deliberate layering).
- `receive_light_sync` verifies via the real `SpvClient`
  (`require_pow=false`, retarget None — hybrid staked blocks carry nominal
  work; linkage/timestamp/monotone blue work still enforced), then stores
  header+filter pairs for local queries: `synced_height`,
  `synced_filter_matches(block_id, address)` (phone-side watch without blob
  round-trips).
- `verify_tx_proof` requires BOTH internal verification AND root equality
  with the synced header; unknown block errors rather than returning false.
- Surprise worth remembering: single-payload-tx blocks prove as bare leaves
  (`generate_merkle_proof` yields an empty path; proof blob is exactly 84
  bytes). Tamper tests must corrupt the root region, not path/index padding.

---

## Slice 6 — Mobile packaging & CI drift guard ✅ LANDED

### Landed as built (deviations & additions)

- `build-android.sh`: cargo-ndk (`--platform 24`), default ABIs
  `arm64-v8a x86_64` (mapping table includes armeabi-v7a for later); lays
  `.so` files straight into `android/src/main/jniLibs/`.
- `android/` Gradle module (library, namespace `uniffi.kovanica`, minSdk 24)
  compiles the **committed** `bindings/kotlin` tree via `sourceSets` and
  packages jniLibs into the AAR. Sole runtime dep:
  `net.java.dev.jna:jna:5.14.0@aar`; consumer R8 rules ship alongside.
- `build-apple.sh`: iOS arm64 + macOS arm64/x86_64 → one
  `target/kovanica.xcframework` from **staticlibs**, with the uniffi-emitted
  header + modulemap embedded per slice. Required adding `"staticlib"` to
  the crate-type list (App Store rules forbid shipping our own dylibs on
  iOS; cdylib stays for Android/JNA).
- Drift guard (`.github/workflows/bindings.yml`): release-build the cdylib,
  regenerate kotlin+swift into /tmp, `diff -r -x README.md` against the
  committed trees (READMEs are hand-written neighbours, not bindgen output),
  plus shellcheck of both scripts. Verified locally: generated output is
  byte-identical today.
- Mirror decision resolved as recommended: `kovanica-ffi` now rides
  `sync-public-node.yml` (rsync loop + header note); kovanica-cli stays out.
- Un-vendored as planned: no pods/mavens; runtime versions documented in
  `bindings/{kotlin,swift}/README.md` (uniffi 0.32, JNA 5.14).

---

## Slice 7 — Wallet UX layer (thin) ✅ LANDED

Only after 4–6 land:
- Balance/history helpers over FFI: `history_of(address, max_blocks)` scanning
  stored blocks (client-side cache lives in app, not Rust).
- Fee policy knob: today min fee is fixed (`max(1, subsidy/500_000)`); expose
  `set_fee_floor` if testnet soak shows congestion (defer unless needed).
- Multi-address watch support comes free via Slice 5 filters (one query per
  address; batch helper `filter_matches_any(blob, [addresses])`).

### Landed as built (deviations & additions)

- `Node::history_of(owner, max_blocks)`: scans `dag.linearize()` canonically,
  tracking seen outpoints owned by the address — spends become `Sent` events,
  owned outputs `Received` events (change back to the sender is its own
  `Received`). `max_blocks` bounds the window from the tip (`0` = all);
  exports `WalletEvent`/`WalletDirection`.
- FFI: `history_of` passthrough returning `HistoryEntry` records (hex ids,
  decimal-string amounts), plus `filter_matches_any(blob, [addresses])`
  decoding the filter once for multi-address watch; empty list never matches.
- Fee-floor knob deferred as planned (no congestion signal yet).
- Tests: `crates/kovanica-node/tests/wallet_history.rs` (3) + two ffi.rs cases
  (`history_over_ffi_matches_utxo_semantics`,
  `filter_matches_any_batches_watch_addresses`). Gate green at landing.

## Slice 8 — Docs & release ✅ LANDED

- Update this plan file: mark slices landed, move surprises into AGENTS.md
  hard-won lessons (per-slice rule).
- README section "Run a light node from Kotlin/Swift" with a copy-paste
  snippet mirroring ffi.rs sync test.
- Workspace version bump + changelog entry in AGENTS.md Stage-3 section.

---

## Sequencing & risk

| Slice | Depends on | Risk | Mitigation |
|-------|-----------|------|------------|
| 4a | – | Low | pure refactor + delegation |
| 4b | – | Medium | whole-coin unbond semantics; maturity gate testing |
| 4c | 4b (test run) | Low | retarget path already unit-tested in state crate |
| 5 | – (parallelizable with 4) | Medium | depends on actual spv.rs API shape |
| 6 | 4 (stable surface) | Low | scripts are mechanical; CI diff is the safety net |
| 7 | 5 | Low | app-layer mostly |
| 8 | all | – | – |

Recommended order: 4a → 4b+4c → 5 → 6 → 7 → 8. Slice 5 can interleave with 4b
if spv.rs API turns out larger than expected.
