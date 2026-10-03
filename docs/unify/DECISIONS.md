# Unify Restructure — Decisions Log

**Project:** Kovanica Protocol Monorepo Restructure
**Branch:** `chore/unify-structure`
**Started:** 2026-10-02

---

## DECIDE Rows from `02-move-map.tsv` — Phase 0 Proposals

| Row | Path | Decision | Status | Notes |
|-----|------|----------|--------|-------|
| 13 | `wallet/android` | **ARCHIVE** | Proposed | Same `applicationId` as `mobile/android`; 4 unique files are app-shell only. Awaiting class/screen diff confirmation. |
| 14 | `wallet/ios` | **ARCHIVE** | Proposed | `mobile/ios` uses xcodegen; `wallet/ios` hand-made xcodeproj. 4 unique wallet-specific files. Awaiting class/screen diff confirmation. |
| 15 | `android-light-node` | **ARCHIVE** | Proposed | `mobile/android` contains `com.kovanica.lightnode` packages. Redundant. Awaiting confirmation no unique screens. |
| 20 | `protocol/web-playground` | **ARCHIVE** | Proposed | 0 refs; superseded by `web/site` playground components. |
| 27 | `node` | **KEEP (fold later)** | Proposed | Thin wrapper; used by `sync-public-node.yml`. Do not delete. Evaluate folding `kovanica-node-bin` into `protocol/` workspace in Phase 3. |
| 28 | `protocol/bindings` | **ARCHIVE (Phase 3)** | Proposed | Duplicate of `kovanica-ffi/bindings/` + nested kotlin duplicate. Consolidate in Phase 3 per bindings-drift guard. |
| 29 | `protocol/patch` | **ARCHIVE** | Proposed | 0 refs; one-off patches. Confirm obsolete. |
| 30 | `protocol/rfc006-step7-api-head.patch` | **ARCHIVE** | Proposed | 0 refs. Confirm obsolete. |
| 31 | `protocol/alerting_rules.yml` | **MOVE** | Proposed | 0 refs but referenced in deploy. Move to `ops/monitoring/alerting_rules.yml`. |

---

## Open Decisions Requiring Human Input

### 1. Keystore Rotation (CRITICAL)
- **Path:** `mobile/android/keystore/release.keystore`
- **Status:** Tracked in git, NOT ignored by `.gitignore`
- **Action Required:** Rotate keystore, remove from history (git filter-repo or BFG), add to `.gitignore`
- **Blocker:** Cannot push any changes until resolved
- **Assigned:** —

### 2. Dashboard Build Failure
- **Issue:** Missing npm dependencies (`@noble/*`, `@radix-ui/*`, `@scure/bip39`)
- **Impact:** `dashboard/frontend` build fails (exit=2)
- **Options:**
  - A: Fix `package.json` before Phase 1 (recommended)
  - B: Document as known-broken baseline, fix in Phase 2
- **Decision:** —

### 3. Android / iOS Baseline Verification
- **Missing Toolchains:** `gradle` (Android), `xcodebuild` (iOS)
- **Impact:** Cannot run `assembleDebug` or iOS build verification
- **Options:**
  - A: Install toolchains and run before Phase 1
  - B: Document as unverified, proceed with Phase 1 (moves only, no logic changes)
- **Decision:** —

### 4. Package Manager Unification (Phase 4)
- **Current State:** `build-all.yml` uses pnpm for consoles; apps have `package-lock.json` (npm)
- **Decision Point:** Phase 4 — choose pnpm workspaces vs npm workspaces
- **Decision:** —

### 5. Windows Tauri Support (Phase 2/5)
- **Current State:** `build-all.yml` has Linux Tauri job only
- **Decision Point:** Add `windows-latest` matrix in Phase 2 CI skeleton
- **Decision:** —

### 6. Console Shared Import Mechanism
- **Current State:** `mobile/console/shared` described as symlink into enterprise workspace
- **Impact:** Moving to `packages/console-shared` requires understanding import method (alias, relative, symlink)
- **Action Required:** Verify before Phase 1 move
- **Decision:** —

### 7. `node/` Wrapper Fate
- **Options:**
  - A: Keep as separate thin wrapper (current)
  - B: Fold `kovanica-node-bin` into `protocol/` workspace as a binary target
- **Constraint:** `sync-public-node.yml` mirrors `crates/**` — must not break public repo sync
- **Decision:** Deferred to Phase 3 evaluation

### 8. Root CI Consolidation — disposition of superseded workflows (Phase 2)
- **Context:** Phase 2.3 asks to consolidate CI into one root, path-filtered workflow
  (`templates/ci-root-skeleton.yml`). `.github/workflows/ci.yml` has been written and ports:
  `rust-gate.yml` + `bindings-drift.yml` (job `protocol`), `sdk-wasm.yml` (job `sdk`),
  `ci-cd.yml` web-consoles + nested `apps/web` CI (job `web`), `build-android.yml` + `ci-cd.yml`
  android (job `android`), `ci-cd.yml` ios (job `ios`), `build-all.yml` linux/windows Tauri
  (jobs `desktop-linux` / `desktop-windows`). The VPS deploy step and all release jobs are
  **not** ported (owner approval required). `config-gate.yml`, `secret-scan.yml`,
  `publish-sdk.yml`, `releases.yml` are intentionally kept separate.
- **Open question:** what happens to the now-superseded workflow files? `ci-cd.yml` and
  `build-all.yml` also carry deploy/release jobs (VPS deploy; app-artifact GitHub Release)
  that are not duplicated elsewhere, so deleting them outright would drop those.
- **Options:**
  - A (recommended): ci.yml becomes the only gate workflow — delete `rust-gate.yml`,
    `sdk-wasm.yml`, `build-android.yml`, `bindings-drift.yml`; strip `ci-cd.yml` and
    `build-all.yml` down to their deploy/release-only jobs (preserved, not auto-gated).
  - B (conservative): keep every existing workflow unchanged; ci.yml is additive and gates
    run twice on matching paths until a later cleanup.
  - C (middle): keep the files but re-trigger the old gate workflows to `workflow_dispatch`
    (manual) so there are no duplicate auto-runs; deploy/release also become manual.
- **Decision (approved by owner, 2026-10-03): Option A.**
  - `rust-gate.yml`, `sdk-wasm.yml`, `build-android.yml`, `bindings-drift.yml` moved to
    `archive/workflows/` (removed from active CI, preserved for history — the repo rule is
    "never delete, archive instead").
  - `ci-cd.yml` reduced to a deploy-only workflow (`Deploy Consoles`): builds the two web
    consoles and runs the VPS `pm2 reload`. Trigger changed to `workflow_dispatch` + tag `v*`
    (no PR / main-push auto-run), per the skeleton's "manual or tag-triggered" rule.
  - `build-all.yml` reduced to a release-only workflow (`Release Apps`): keeps
    `ffi-bindings`, `android`, `linux-tauri`, `windows-tauri`, `macos-tauri-ios`, `release`;
    the `protocol-test` gate was removed (now in ci.yml). Trigger changed to `workflow_dispatch`
    + tag `v*`.
  - `ci.yml` is the only gate workflow. `config-gate.yml`, `secret-scan.yml`,
    `publish-sdk.yml`, `releases.yml` untouched.
  - Docs updated: `apps/ios/BUILD.md`, `sdk/RELEASE.md` now point at `ci.yml`.

### 9. Pre-existing red gates on `main` (clippy + fmt) — RESOLVED
- **Context:** While porting the `protocol` gate into `ci.yml`, verification showed
  `main` was **already failing** `cargo clippy --workspace --all-targets -- -D warnings`
  and `cargo fmt --all --check` before any Phase 2 change.
- **Clippy findings** (`protocol/crates/kovanica-state/src/ledger.rs`):
  - `122:33` — `pub const MAX_MINT_PRICE: u64 = 1 * ATOM;` ("this operation has no effect")
  - `827:5` — unused variable `asset_logo_activation_score: u64`
  - `1489:28` — manual `!RangeInclusive::contains` for `mint_price < MIN || > MAX`
- **Fmt drift** (pre-existing) in 7 files: `protocol/crates/kovanica-ffi/src/light_node.rs`,
  `protocol/crates/kovanica-node/src/{explorer.rs,node.rs}`,
  `protocol/crates/kovanica-node/tests/poa_adversarial.rs`,
  `protocol/crates/kovanica-state/src/{ledger.rs,lib.rs}`,
  `protocol/crates/kovanica-state/tests/native_token_consensus.rs`.
- **Origin:** commit `8f4cb30` — "feat(kvp-107): implement mint price & asset logos for KVP-102 tokens".
- **Resolution (commit `114c35e`, 2026-10-03):** option (a), a strictly
  **semantics-preserving** cleanup. Only expression form changed, never a value:
  - `MAX_MINT_PRICE = ATOM` (dropped the no-op `1 *`); the value is identical.
  - the not-yet-enforced `asset_logo_activation_score` parameter is prefixed `_` and
    documented as forward-compat (KVP-107 logo validation is *not* enforced); the
    parameter and its call sites are unchanged.
  - `!(MIN_MINT_PRICE..=MAX_MINT_PRICE).contains(&mint_price)` — same bounds, same
    result as the manual comparison.
  - `cargo fmt` applied to the remaining files.
  - **Consensus impact: none.** No constant, comparison, or emission/maturity/fee
    rule was altered; `kovanica-state` and `kovanica-node` test suites stay green.

### 10. Phase 3a — canonical Rust keys/tx API (RESOLVED)
- **Context:** key derivation existed twice — `protocol/crates/kovanica-wallet/src/slip10.rs`
  and the inline `slip10` module in `sdk/crates/kovanica-keys`. The two agreed, but the
  whole point of Phase 3 is that a divergence cannot silently move every derived address.
  The SDK is a **separate, publishable workspace**, so the dependency direction is forced:
  the protocol tree may consume the SDK, never the reverse (an unpublished node crate
  cannot appear in a published crate's dependency graph).
- **Existing precedent:** `protocol/crates/kovanica-node` and `kovanica-cli` already consume
  `sdk/crates/kovanica-types` by path. Phase 3a formalizes that direction rather than
  inventing a new one.
- **Decision:**
  - **Keys → canonical API is `kovanica-keys` (published).** `slip10` there is the single
    implementation of SLIP-0010 ed25519 (it now also exposes the generic `derive_path`,
    which the official-spec vector test needs). `kovanica-wallet::slip10` is a thin
    `pub use` re-export, so node / CLI / FFI import paths are unchanged. `kovanica-wallet`
    keeps its node-tree-only responsibilities: `kovanica_state::KeyPair` binding, key-file
    load/save with `0600` permissions, passphrase-on-raw-seed rejection.
  - **Tx → canonical client API is `kovanica-tx` (published).** It is the builder/signer a
    client uses to produce an unsigned `kovanica-types::Transaction` and then a signed one.
    The node's `kovanica-state::Transaction` + validation path stays untouched: node-side
    tx construction is consensus-critical and is **not** replaced by the client builder.
    No protocol crate consumes `kovanica-tx` today; none should, because building a tx and
    validating a tx are different layers.
  - **Local storage / mnemonic file handling is not part of the SDK API** and stays in
    `kovanica-wallet` (it depends on `kovanica-state` types and filesystem policy).
- **Consensus impact: none (client-only / ledger-safe).** No consensus crate changed.
  Addresses, derivation outputs, and the frozen vectors are byte-identical before and
  after — proven by `kovanica-wallet`'s `shared_vectors` + `slip10_vectors` suites, which
  still pin the same literals, and by `kovanica-keys`' (now including the official
  SLIP-0010 spec vector).
- **Dropped deps:** `hmac` (now unused in the protocol workspace) removed from
  `protocol/Cargo.toml`; `hmac`/`sha2` removed from `kovanica-wallet`'s own manifest.

### 11. Phase 3d — one committed home for the UniFFI bindings (RESOLVED)
- **Context:** the same generated interface lived in three places:
  1. `protocol/crates/kovanica-ffi/bindings/{kotlin,swift}` — the canonical copy,
     regenerated and drift-checked by the `protocol` job in `ci.yml`;
  2. `apps/android/uniffi/src/main/java/kovanica/kovanica.kt` — a hand-copied fork
     declaring `package kovanica` and missing the eight derive/validity entry points
     added to `kovanica-ffi/src/deriv.rs`;
  3. `archive/protocol-bindings/**` — an older copy, already archived in Phase 1 and
     kept only as history.
- **Decision:** delete the Android fork. The `:uniffi` module now adds the canonical
  directory as a Kotlin source dir (`../../../protocol/crates/kovanica-ffi/bindings/kotlin`)
  in `apps/android/uniffi/build.gradle.kts`, and the eleven app files that imported the
  binding were rewritten from `import kovanica.*` to `import uniffi.kovanica.*`. The
  package name is the generated one and is part of the interface, so the imports move,
  not the binding. `apps/android/app/proguard-rules.pro` already had
  `-keep class uniffi.kovanica.** { *; }`: the canonical package was the intended one
  all along, and the fork was silently shadowing it with an older surface.
- **iOS was already correct and needs no change:** `apps/ios/xcodegen.yml` compiles
  `bindings/swift/kovanica.swift` straight out of the Rust crate, and
  `KovanicaWallet/KovanicaKeys.swift` is a thin wrapper that calls the FFI (there is no
  Swift cryptography). Its stale comment pointing at the archived `bindings.yml` was
  updated to `ci.yml`.
- **Consensus impact: none (client-only).** No consensus crate, constant, or rule changed.
- **Verified:** `./gradlew :uniffi:compileDebugKotlin :app:compileDebugKotlin` then
  `./gradlew clean :app:testDebugUnitTest :app:assembleDebug` — BUILD SUCCESSFUL;
  the Android unit suite ran `KovanicaKeysTest` (10 tests, 0 failures), which reads the
  canonical `protocol/testvectors/vectors.json` through the app's test resource dir.
  Compiled output lands in `apps/android/uniffi/build/tmp/kotlin-classes/debug/uniffi/kovanica/`,
  confirming the module really compiled the crate-owned file.

### 12. Committed build artifacts under apps/android (RESOLVED)
- **Context:** Phase 1's move commit (`696da77`) used `git add -A` while `.gitignore` had
  no Gradle rule, so ~2.2k generated files under `apps/android/{build,app/build,uniffi/build}/`
  and `apps/android/.gradle/` became tracked. Separately, the three
  `apps/android/uniffi/src/main/jniLibs/*/libkovanica_ffi.so` files were tracked.
- **Why the native libs had to go:** `nm -D --defined-only` on the committed x86_64 copy
  lists 242 symbols; a current build of `kovanica-ffi` lists 268. The committed copy predates
  `deriv.rs` and lacks every derivation export (`derive_address_from_mnemonic`,
  `*_from_signing_secret`, `mnemonic_is_valid`, `slip10_derivation_path`, `slip44_coin_type`,
  plus `DerivationError` / `DerivedAccount`) that the checked-in Kotlin binding now declares —
  a fresh-checkout debug APK would raise `UnsatisfiedLinkError` on the first derive call.
- **Decision (commit `9c6c91d`):** untrack them and add documented `.gitignore` rules —
  bare `build/`, `.gradle/`, `.kotlin/` (bare because anchoring is exactly what missed the
  nested modules; the repo has no legitimate source dir named `build`) and `**/jniLibs/`.
  The native libs are regenerated by `kovanica-ffi/build-android.sh` and by the `android`
  job in `ci.yml`, which runs before Gradle, so CI is unaffected; local APK builds must run
  that script first. Files stay on disk locally (only the index changed).
- **Note:** the bare `build/` rule would also hide `dist/`-style dirs at any depth by design;
  a future package that genuinely needs a `build/` source dir should negate it explicitly
  (`!path/to/build/`). The `.gitignore` comment records this.
- **Report-only, untouched:** the tracked Android release keystore and the hardcoded signing
  material in `apps/android/app/build.gradle.kts` (DECISIONS #1 — rotation still pending).

### 13. Phase 3c (Android/iOS hand-written crypto → FFI) — NOT DONE, scoped
- iOS already calls the FFI through `KovanicaKeys.swift` (see #11), so there is nothing to
  replace there (its vectors are verified on Linux per #14).
- Android still holds **one** hand-written Kotlin derivation in
  `apps/android/app/src/main/java/com/kovanica/lightnode/ui/util/KovanicaKeys.kt`, and
  `KovanicaKeysTest.kt` pins it against `protocol/testvectors/vectors.json` (10 tests, green).
  Replacing it with `uniffi.kovanica` calls is a separate sub-PR: Android **unit tests run on
  the JVM**, so they need a *host* (`x86_64-unknown-linux-gnu`) `libkovanica_ffi.so` on the JNA
  search path, not the Android ABI builds. That is build/test-harness work with its own
  setup, so it is deliberately left out of 3d.
- **Status:** tracked as remaining Phase 3 work. Current state is safe: the Kotlin
  derivation is vector-correct, and it is a second *implementation* rather than a routing
  bug. Note also that the FFI derivation functions are not usable from Android unit tests
  until the host cdylib is on the JNA path, so 3c cannot be validated by the existing test
  harness without that setup.

### 14. iOS golden vectors, verified on Linux (RESOLVED)
- **Context:** the Phase 2 exit criterion asked every implementation to consume
  `protocol/testvectors/vectors.json`. Android was closed by the 3d toolchain work;
  iOS stayed open because `xcodebuild` is macOS-only and this workspace is Linux.
- **Finding:** Swift 6.1.3 is already installed (`/usr/bin/swiftc`), and the iOS
  derivation path has no Apple-specific code — `KovanicaWallet/KovanicaKeys.swift`
  is Foundation-only and calls the crate-owned UniFFI binding over a C ABI. So the
  vectors can be checked without Xcode.
- **Decision (commit `efd21b1`):** add `apps/ios/tools/linux-vectors/` — a script
  that builds `kovanica-ffi` for the host, compiles the **unmodified**
  `KovanicaKeys.swift` + `bindings/swift/kovanica.swift` against
  `target/debug/libkovanica_ffi.so`, and runs a harness mirroring
  `KovanicaWalletTests/KovanicaKeysTests.swift` plus all 6 `derivation` vectors
  (including the passphrase cases the web consumer cannot reach). It regenerates
  `kovanicaFFI.modulemap` without the Darwin-only `use "Darwin"` line rather than
  editing the committed binding, which stays byte-identical.
- **Evidence:** `apps/ios/tools/linux-vectors/verify-vectors.sh` →
  `iOS Swift harness: 35/35 checks passed`. The 10-test XCTest suite still needs
  macOS; the harness is case-for-case equivalent for the answers.
- **Not wired into CI:** hosted Linux runners have no Swift toolchain by default;
  the `ios` job stays Xcode-on-macOS. Documented in the tool's README.
- **Consensus impact:** none. Client-only; no FFI surface, ledger, or node change.
- **Status:** Phase 2 exit criterion for iOS recorded as satisfied on Linux, with
  the macOS-only parts (xcframework link, UIKit/Keychain) explicitly out of scope.

### 15. Phase 3b — one crypto implementation for the browser surfaces (RESOLVED)
- **Context:** Phase 3b says the browser app, the extension and the dashboard
  should do their key work through `sdk/bindings/kovanica-wasm`, gated by the
  shared vectors.
- **Finding:** the wasm crate exported four functions only. None covered
  passphrases, material, or signing. No app imported it, so this was a fresh
  integration. The web app had its own `@noble` derivation. The extension had
  none: its word list was cosmetic and its vector test was a `todo`.
- **Decision:**
  - Grow `kovanica-keys` and the wasm module to cover what the browser layer
    needs (commit `7c2ff8c`; see `sdk/bindings/kovanica-wasm/src/lib.rs`).
  - Point the web wallet's `keys.ts` at the package through a lazy loader in
    `wasm.ts`. `entropyToMnemonic` no longer takes a word-list argument, since
    the module always uses the canonical English list (commit `7c2ff8c`).
  - Rewrite the extension's `seedPhrase.ts` the same way. Delete its two fake
    word-list files and the generator behind them. Its vector test now runs for
    real (commit `af1ada5`).
  - Consume the package as a `file:` dependency on the crate. Keep the npm
    identity in sync with `stamp-pkg-manifest.mjs`. Have CI build the wasm
    before `npm ci` for both browser apps.
- **Evidence:** the web suite passes 21/21, typecheck and lint are clean, and
  its build emits the wasm asset. The extension suite passes 12/12 with no
  `todo`, and its lint and build are clean. In `sdk`, fmt and clippy are clean
  and the unit suites pass. `protocol` `cargo check --workspace --locked` is OK.
- **Consensus impact:** none. Client-only; no consensus, ledger, or node crate
  was modified.
- **Status:** the web app and the extension are done. The dashboard is split
  out to #16.

### 16. Phase 3b — dashboard crypto migration deferred, scoped
- **Finding:** `apps/dashboard/frontend/src/lib/kvnc.ts` is a full and careful
  implementation. It covers derivation, phrase handling, `kvnc…dag` encoding,
  signing, and an optional AES-GCM at-rest store. Its public API is
  **synchronous**. Its `KeyVault` holds 64-byte material so that later indices
  can be derived. Two consumers rely on that shape: `src/hooks/useKeyVault.ts`
  and `src/components/WalletPanel.tsx`. The app has no tests at all (`vitest` is
  configured; no spec files exist), so a key-handling rewrite has no net.
- **Blocker:** the wasm module initialises asynchronously, but every `kvnc.ts`
  entry point is sync and is called during render. A faithful swap needs a
  bootstrap that awaits `init()` first, extra wasm exports that take a raw
  secret or public key rather than a phrase, and a ready-guarded API across
  `useKeyVault` and `WalletPanel`.
- **Decision:** do not fold this into the web and extension swap. Give the
  dashboard its own sub-PR. It must begin by adding a vector test over the
  current `kvnc.ts`, so the shared vectors gate the swap before any code moves.
- **Consensus impact:** none (client-only). Private-key handling is
  security-sensitive, so the conservative split is deliberate.
- **Status:** open, scoped follow-up. Step 1 landed: `src/lib/kvnc.test.ts`
  (22 tests) pins the current implementation against the shared derivation
  vectors and is wired into the `web` CI job (`npm run test` is now
  `vitest run`). The crypto swap itself is still pending.
  `@noble/curves`, `@noble/hashes`, and `@scure/bip39` stay in the dashboard
  manifest until then.

---

## Approved Decisions (to be filled during review)

| Decision | Approved By | Date | Commit |
|----------|-------------|------|--------|
| #8 CI consolidation — Option A | owner | 2026-10-03 | `68f327c` |
| #9 pre-existing red gate — semantics-preserving cleanup | owner (carry-forward) | 2026-10-03 | `114c35e` |
| #10 keys/tx canonical API — SDK is canonical, protocol re-exports | owner (Phase 3 direction) | 2026-10-03 | `df41252` |
| #11 Phase 3d — one committed home for the UniFFI bindings | owner (Phase 3 direction) | 2026-10-03 | `b7875b3` |
| #12 untrack Gradle build output + stale UniFFI native libs | owner (Phase 3 direction) | 2026-10-03 | `9c6c91d` |
| #13 Phase 3c Android FFI migration — scoped, not done | owner (Phase 3 direction) | 2026-10-03 | — |
| #14 iOS golden vectors verified on Linux (no Xcode) | owner (Phase 3 direction) | 2026-10-03 | `efd21b1` |
| #15 Phase 3b — web + extension use the shared wasm keys | owner (Phase 3 direction) | 2026-10-03 | `7c2ff8c`, `af1ada5` |
| #16 Phase 3b — dashboard crypto migration deferred, scoped | owner (Phase 3 direction) | 2026-10-03 | — |

---

## Revert Procedures

### Phase 0 (read-only)
No changes made. Revert by deleting branch:
```bash
git checkout main && git branch -D chore/unify-structure
```

### Phase 1 (pure moves)
Each move uses `git mv`. Revert any single move:
```bash
git mv <new-path> <old-path>
# Fix references in same commit
```

### Phase 2+ (behavior changes)
Tag each phase end. Revert via:
```bash
git revert <phase-tag>..HEAD
```

---

## Sign-off Format

For each decision, record:
```
## Decision: <short title>
**Date:** YYYY-MM-DD
**Approved by:** <name>
**Commit:** <sha>
**Details:** <rationale>
```