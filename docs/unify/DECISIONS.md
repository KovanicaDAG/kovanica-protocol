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

### 4. Package Manager Unification (Phase 4) — RESOLVED
- **Current State:** `build-all.yml` uses pnpm for consoles; apps have `package-lock.json` (npm)
- **Decision Point:** Phase 4 — choose pnpm workspaces vs npm workspaces
- **Decision (owner, 2026-10-04): npm workspaces.** Every tracked lockfile in the repo was
  already a `package-lock.json` (no `pnpm-lock.yaml` existed), CI already ran `npm ci`, and
  the desktop jobs were converted pnpm→npm in `c57656d` after `ERR_PNPM_NO_LOCKFILE`. pnpm
  would have meant rewriting eight lockfiles and every install step to buy nothing the
  existing npm 11 toolchain does not already provide. See #18 for the workspace itself.

### 5. Windows Tauri Support (Phase 2/5)
- **Current State:** `build-all.yml` has Linux Tauri job only
- **Decision Point:** Add `windows-latest` matrix in Phase 2 CI skeleton
- **Decision:** —

### 6. Console Shared Import Mechanism — RESOLVED
- **Current State:** `mobile/console/shared` described as symlink into enterprise workspace
- **Impact:** Moving to `packages/console-shared` requires understanding import method (alias, relative, symlink)
- **Action Required:** Verify before Phase 1 move
- **Decision (owner, 2026-10-04):** the Phase 1 move to `packages/console-shared` was a pure
  `git mv`, and the mechanism turned out to be **neither a symlink nor a relative import** —
  it is a TypeScript path alias. Both `apps/console-kovanica/tsconfig.json` and
  `apps/console-enterprise/tsconfig.json` map `"@console-shared/*"` to
  `../../packages/console-shared/src/*` (plus `"include": [..., "../../packages/console-shared/src"]`),
  and each Vite config repeats it as a `resolve.alias`. Phase 4 keeps the alias and adds a real
  `package.json` (see #20), so the two consoles need no source change.

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

### 13. Phase 3c — Android now uses the FFI for all key work (RESOLVED)
- **Context:** Phase 3c asks the mobile apps to route key work through the UniFFI
  surface instead of hand-written crypto. iOS already did (see #11; vectors on
  Linux per #14). Android held the last duplicate implementation.
- **Finding:** `ui/util/KovanicaKeys.kt` carried its own BouncyCastle SLIP-0010,
  `KovanicaAddress.kt` its own Ed25519 + base58, and `Bip39.kt` its own PBKDF2
  stretch. Android **unit tests run on the JVM**, so they need a *host*
  (`x86_64-unknown-linux-gnu`) `libkovanica_ffi.so` on the JNA search path; the
  `:uniffi` module ships Android ABIs only, which the JVM cannot load.
- **Decision (commit `88c4047`):**
  - `KovanicaKeys.kt` is now a thin adapter over `uniffi.kovanica`:
    `accountFromMnemonic`, `addressFromMnemonic`, `signingKeyHex`,
    `addressFromSigningKeyHex`, `isValidPhrase`, `derivationPath`, `coinType`.
    `KovanicaAddress.kt` derives the 33-byte form from `DerivedAccount`
    (`00` + `publicKeyHex`). `Bip39.kt` keeps generation only (the core has no
    generator export);
    validation, stretching and derivation go through the FFI.
    `Base58.kt` is deleted, as is the BouncyCastle dependency.
  - Call sites updated: `WalletRepository` (constructor loses `Context`),
    both `WalletViewModel`s, `MnemonicUtil` (unused helpers dropped).
  - `app/build.gradle.kts` gains a `buildHostFfi` `Exec` task
    (`cargo build -p kovanica-ffi`) that every `Test` task depends on, plus
    `systemProperty("jna.library.path", .../protocol/target/debug)`.
  - CI: the `android` job step is now
    `./gradlew :app:testDebugUnitTest assembleDebug --no-daemon`, so the vector
    gate runs in CI instead of being assembled around.
- **Evidence:** `:app:testDebugUnitTest` → 10 tests, 0 failures, 0 errors
  (frozen constants, per-index signing key, address round-trip, distinct
  indices, truncated-material regression, index bounds, malformed key
  rejection via `DerivationException`, phrase validation, and ALL 6 shared
  derivation vectors including the passphrase one). `clean` +
  `testDebugUnitTest` + `assembleDebug` → BUILD SUCCESSFUL.
- **Consensus impact:** none. Kotlin / Gradle / CI only; no FFI surface, ledger,
  or node change. The derivation path stays `m/44'/3007'/0'/0'/i'`.
- **Status:** Android and iOS both call the FFI. No hand-written crypto remains
  on either mobile surface.

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

### 16. Phase 3b — dashboard crypto now runs on the shared WASM core (RESOLVED)
- **Finding:** `apps/dashboard/frontend/src/lib/kvnc.ts` was a full and careful
  implementation. It covered derivation, phrase handling, `kvnc…dag` encoding,
  signing, and an optional AES-GCM at-rest store. Its public API is
  **synchronous**. Its `KeyVault` holds 64-byte material so that later indices
  can be derived. Two consumers rely on that shape: `src/hooks/useKeyVault.ts`
  and `src/components/WalletPanel.tsx`. The app had no tests at all.
- **Two steps, deliberately separate.** Step 1 (`fde6a46`) added
  `src/lib/kvnc.test.ts` (22 tests) pinning the *old* implementation against the
  shared derivation vectors and wired `npm run test` (`vitest run`) into the
  `web` CI job, so the swap had a net before any code moved. Step 2
  (decision commit `914cc49`) replaced the crypto.
- **Blockers that had to be cleared first:**
  - the wasm module initialises asynchronously while every `kvnc.ts` entry point
    is sync and runs during render → `src/main.tsx` now awaits `ready()` before
    the first `createRoot` (via `.then`, because top-level await needs es2022 and
    this app ships es2020), and `src/lib/wasm.ts` exposes a ready guard that
    fails loudly instead of returning undefined;
  - the core had no "secret → public key", "public key → address", or strict
    "verify signature" export → added `public_key_from_secret_bytes`,
    `address_from_public_key`, `address_to_hex`, `verify_signature`, and
    `signing_key_from_seed_hex` to `sdk/bindings/kovanica-wasm`, plus
    `kovanica_keys::verify_signature` (a `verify_strict` free function, same
    rules as `Keypair::verify`) and a `KeysError::InvalidPublicKey` variant.
- **What stayed in the browser:** only the AES-GCM at-rest envelope, which is
  WebCrypto, not key derivation. `src/lib/hex.ts` replaces
  `@noble/hashes/utils.js` and is explicitly documented as non-cryptographic.
  `@noble/hashes` **stays** for one non-secret use: the domain-separated asset-id
  hash in `AssetsPanel.tsx`. `@noble/curves` and `@scure/bip39` are gone from the
  dashboard manifest.
- **Behaviour change, deliberate:** `parseAddress` now reports one message
  (`unrecognised address format …`) for every rejected form instead of
  distinguishing a bad prefix from a bad base58 body. The vector test was
  updated to match; the rejection itself is unchanged.
- **Consensus impact:** none (client-only). Private-key handling is
  security-sensitive, so the conservative split was deliberate.
- **Evidence:** dashboard `vitest run` 22/22, `tsc --noEmit` exit 0,
  `vite build` emits `dist/assets/kovanica_wasm_bg-*.wasm` (517 kB); web 21/21,
  extension 12/12; `sdk` fmt/clippy/tests green (`kovanica-wasm` 13, new Rust
  helpers covered by host tests); `protocol` `cargo check --workspace --locked`
  green. The `web` CI job now builds the wasm package for the dashboard too.

### 17. Phase 3e — the node HTTP API gets one spec and one generated client
- **Finding:** the node speaks HTTP from a single file,
  `protocol/crates/kovanica-node/src/explorer.rs` (6823 lines, hand-rolled
  `if … return` chain at `:1819-2723` plus a POST catch-all at `:3366-3836`).
  `rpc.rs` is a **console** RPC, not HTTP — a naming collision that made the
  Phase 3 plan's "rpc.rs/explorer.rs" pairing read as if the API were split in
  two. It is not. Meanwhile every TS surface re-declared the response shapes by
  hand: `apps/dashboard/frontend/src/types.ts`, the extension's fetcher, the two
  consoles. Four copies of one contract, none of them checked against the node.
- **What already existed and was kept:** `apps/dashboard/frontend/scripts/api-contract.ts`
  compares a *live* node response against the declared interfaces in
  `src/types.ts`, both ways. Its header records the reason: a field the
  dashboard declares but the node never sends is a perfectly valid TypeScript
  type that simply has no runtime value, and `tsc` cannot catch it — the panels
  just render `0` / `—` / `No results` on a healthy network. That class of bug
  was hit four times. The script stays as the live check; the spec now replaces
  the hand-declared half.
- **Decision:** commit one OpenAPI 3.1 spec at
  `packages/api-client/openapi/kovanica-node.yaml` as the contract, generate
  `src/schema.d.ts` from it with `openapi-typescript`, and expose a thin
  `openapi-fetch` factory (`createKovanicaClient`) plus bigint amount helpers.
  `src/schema.d.ts` is committed so consumers type-check without running codegen,
  and `npm run check:drift` regenerates to a temp file and diffs so a
  hand-edited or stale `schema.d.ts` fails CI.
- **Tooling:** `openapi-typescript` + `openapi-fetch` over a heavier generator.
  A generator runtime is a supply-chain surface and a second thing to keep
  current; two small packages and a one-line script are easier to audit, and the
  generated output is types only, which is all these consumers need.
- **The spec records what the code does, not what it should do.** It therefore
  documents the traps rather than papering over them: two different shapes on
  `/api/fee_estimate` (GET returns `{fee_rate, unit, mempool, bytes}`, POST
  returns `{ok, slow, normal, fast}`), two pagination models (`limit`/`offset`/
  `total` on `/api/history` and `/api/utxos` vs `page`/`per_page`/`pages` on
  `/api/address/{address}`), three error encodings (JSON, `text/plain` for
  every `POST /api/{action}` route plus `/api/history` and `/api/utxos`, and a
  bare `not found`), `authority_set.hash` present on `/api/network` but absent
  on `/api/head`, `tx_id_hex` from `/api/multisig/submit` where every other
  tx-returning route uses `tx`, `?node=` silently ignored by `/api/block/{id}`
  and `/api/tx/{id}`, `/api/state` mutating the selected mesh node from a GET,
  and `/api/prepare` + `/api/submit` being query-string endpoints rather than
  JSON-body ones. Every operation declares `security: []` (there is no
  authentication anywhere) and flags role-gated routes with
  `x-kovanica-gating`.
- **Correction made while writing it.** An earlier draft of the `Atoms`
  description claimed MAX_SUPPLY (9,020,000,000,000,000) "sits just under
  `Number.MAX_SAFE_INTEGER`". It does not: 2^53−1 is 9,007,199,254,740,991,
  i.e. ~90,071,992 KVNC — **below** the cap. So `max_supply`, `native_minted`,
  `total` and `burned` are already rounded by the time `JSON.parse` returns
  them, because the node serialises atoms as JSON numbers. That is now stated in
  the spec, and `src/amounts.ts` exists because of it: every amount is a
  `bigint`, `atomsFromWire` **refuses** rather than rounds, and the safe way to
  read the cumulative supply fields is from the raw response text. A unit test
  pins `Number.isSafeInteger(Number(MAX_SUPPLY_ATOMS)) === false` so the claim
  cannot silently become true.
- **Consensus impact:** none. Client-only, and no Rust was touched — this
  decision adds a spec, a generated type file, a typed fetch wrapper and a CI
  gate. It also does **not** yet change any consumer: the dashboard still uses
  its own `src/types.ts`. Wiring the surfaces to the generated client is
  deliberately a separate follow-up, so this lands as a contract that is
  published and enforced before anything depends on it.
- **Evidence:** 55 paths / 56 operations / 59 schemas / 4 reusable responses /
  12 reusable parameters, zero unresolved `$ref`s, no duplicate `operationId`s,
  no undeclared or unused tags. `npm run typecheck` exit 0, `npm test` 13/13,
  `npm run check:drift` clean. `packages/api-client` is a new entry in the
  existing `web` CI matrix (`packages/**` was already in that job's path filter),
  so no new top-level job was needed.

### 18. Phase 4 — one npm workspace for the TypeScript surfaces
- **Finding:** the repo had **six independent npm trees** (`apps/web`,
  `apps/dashboard/frontend`, `apps/extension`, `apps/console-kovanica`,
  `apps/console-enterprise`, `packages/api-client`), each with its own
  `package-lock.json`, and no root manifest at all. Nothing was shared, so
  `react`, `vite` and `typescript` were installed up to six times per checkout.
- **Decision:** add a root `package.json` with an explicit `workspaces` list and a
  single root `package-lock.json`; delete the six per-app lockfiles. Members:
  `apps/web`, `apps/dashboard/frontend`, `apps/extension`, `apps/console-kovanica`,
  `apps/console-enterprise`, `packages/api-client`, `packages/console-shared`.
  The `nf3@0.3.17` override that lived in `apps/web` moved to the root manifest,
  because npm only applies `overrides` from the workspace root.
- **Deliberately excluded from the workspace:** `apps/dashboard` (stale, see #22),
  `apps/desktop-node/ui` (a Tauri v2 app with its own toolchain, not part of the
  browser/console surfaces) and `sdk/bindings/kovanica-wasm` (a publishable
  package, see #21).
- **Console tsconfig/Vite cleanup:** both consoles previously pinned `react`/
  `react-dom`/`react-router-dom` to **app-local** `./node_modules/...` paths in
  `paths` and `resolve.alias`. Those directories no longer exist once the tree is
  hoisted, so the entries were removed and Vite resolves react from the workspace
  root. `apps/web` gained the opposite entry: `react`/`react-dom` type paths
  pointing at **its own** `./node_modules/@types/react` (v19), because hoisted
  radix/tanstack packages would otherwise pull in the root `@types/react` (v18)
  and break the React-19 build.
- **CI:** the `web` job now installs once at the root (`npm ci`, cache keyed on
  the root lockfile) instead of per app; the per-app build/test/lint/typecheck
  steps are unchanged and still run with `working-directory: ${{ matrix.app }}`.
  The wasm build is no longer conditional, because a root install resolves the
  whole workspace tree and `@kovanica/sdk-wasm` is a `file:` dependency of three
  members. Both desktop jobs likewise install at the root. `package.json` and
  `package-lock.json` were added to the `web` path filter.
- **Consensus impact: none.** JavaScript tooling only; no Rust, ledger, node or
  wire format changed.
- **Verified:** root `npm ci` exit 0 (1098 lockfile entries); `apps/web`
  typecheck 0 / lint 0 errors / 21 tests / build OK; `apps/extension` 12 tests +
  build; `apps/dashboard/frontend` 22 tests + build; both consoles build;
  `packages/api-client` `check:drift` clean + 13 tests.

### 19. Phase 4 — version drift accepted when collapsing six lockfiles into one
- **What happened:** a workspace resolves to **one** version per range, so the six
  old lockfiles (which pinned different versions of the same package) had to
  collapse. A clean-room `npm install` (all `node_modules` and per-app lockfiles
  removed first) resolved **115 packages to a different version** than the union
  of the old lockfiles. The large majority are patch bumps within declared caret
  ranges; the notable ones are `react`/`react-dom` 19.2.8→19.3.0 (dedupe of the
  extension up to `apps/web`), `@tanstack/react-router` 1.170.31→1.170.41,
  `vite` 8.2.2→8.3.2, `better-auth` 1.6.30→1.6.33 and `zod` 4.4.3→4.6.5.
  Consoles and the dashboard are unaffected (they resolve to the same
  `react@18.3.1` / `vite@5.4.21` as before).
- **Why a fresh resolve and not a hand-merge:** the only way to keep the exact old
  versions is to merge six lockfiles by hand, which means reimplementing npm's
  hoisting decision. It is also not what npm is designed for. The alternative —
  seeding from per-app `node_modules` — **preserved versions but produced a
  lockfile that records only the current platform's optional binaries**
  (`@esbuild/linux-x64` present, `@esbuild/win32-x64` absent, `@tauri-apps/cli`
  linux-only). `npm ci` is strictly lockfile-driven, so that tree would break the
  Windows desktop job. A clean-room install records all platforms
  (49 `@esbuild/*` keys incl. `win32-x64`; 12 `@tauri-apps/cli` keys incl.
  `win32-x64-msvc`) and is the only version that is correct everywhere.
- **Mitigation:** the one real breakage the drift caused — `@tanstack/react-router`
  1.170.41 now types `ErrorComponentProps.error` as `unknown`, so
  `apps/web/src/lib/error-component.tsx` no longer compiled — was fixed in source
  by narrowing (`error instanceof Error && error.message ? … : …`), not by
  pinning the package back. Every suite was then re-run green (see #18).
- **Consensus impact: none.** Dependency versions only.
- **Follow-up:** if any of the bumped packages proves problematic, pin it with a
  root `overrides` entry rather than restoring per-app lockfiles.

### 20. Phase 4 — `packages/ui` scope is `console-shared` only
- **Finding:** three disjoint UI trees: `apps/dashboard/frontend/src/components/ui`
  (28 shadcn/radix files, React 18, Tailwind 3), `apps/web/src/components/ui`
  (2 files — `button.tsx`, `separator.tsx` — React 19, Tailwind 4) and
  `packages/console-shared/src/components` (6 files). The only basenames in common
  are `button.tsx` and `separator.tsx`, and they are **not the same components**:
  different React majors, different Tailwind majors, different radix ranges.
- **Decision:** Phase 4 formalizes **only** `console-shared` — it gains a real
  `package.json` (`@kovanica/console-shared`, private, `type: module`, an `exports`
  map for `./components`, `./hooks/useKovanica`, `./utils/format`, `./types`,
  `./api/client`) and declares `react`, `react-dom` and `react-router-dom` as
  **peerDependencies** (`^18 || ^19`, `^6 || ^7`) so it never pins a major. The
  `@console-shared/*` alias stays (see #6), so the consoles do not change.
  The dashboard and web `components/ui` trees stay where they are; merging them is
  a real refactor, not a move, and would force a React/Tailwind major decision that
  is out of scope for a structural phase.
- **Consensus impact: none.** Client-only.

### 21. Phase 4 — deferred: `sdk/bindings/kovanica-wasm` → `packages/wallet-wasm`
- **Why deferred (owner, 2026-10-04):** the Phase 4 plan lists this move, but the
  package is the input to `publish-sdk.yml`, which publishes `@kovanica/sdk-wasm`
  to npm and the Rust crates to crates.io. It is also a `file:` dependency of
  `apps/web`, `apps/extension` and `apps/dashboard/frontend`. `PROMPT.md` is
  explicit: do not move or rename `publish-sdk.yml` or anything feeding it without
  telling the owner first. Doing it here would also mix a publish-surface change
  into a structural commit.
- **Decision:** keep the path `sdk/bindings/kovanica-wasm` for now, and do the
  move later as its own change that updates the workflow, the three `file:` deps
  and the CI wasm-build steps together.
- **Consensus impact: none.**

### 22. Phase 4 — stale `apps/dashboard/package.json` + lockfile (report-only)
- **Finding:** `apps/dashboard/package.json` and `apps/dashboard/package-lock.json`
  are leftovers from the Phase 1 move (`git log` shows only
  `7eb47b0 chore(unify): Phase 1 - pure moves per move-map`). `apps/dashboard/`
  holds `backend/server.py`, `frontend/`, a gitignored `node_modules/`, the
  manifest and the lockfile — there is **no `src/`, no `index.html` and no Vite
  config**, so its `build` script cannot run. It is also named `kovanica-dashboard`,
  the same name as the real `apps/dashboard/frontend`, which npm workspaces rejects
  as a duplicate. Nothing in `.github/`, `ops/`, `tools/` or `scripts/` references
  it; the only `apps/dashboard` CI references are the path glob and the
  `apps/dashboard/frontend` matrix entry.
- **Decision:** exclude it from the workspace via the explicit member list. It was
  **not deleted** — the repo rule is "never delete, archive under `archive/` only
  after a DECIDE flip". Recommended follow-up: flip a DECIDE row and archive
  `apps/dashboard/package.json` + `apps/dashboard/package-lock.json`.
- **Consensus impact: none.**

---

## Approved Decisions (to be filled during review)

| Decision | Approved By | Date | Commit |
|----------|-------------|------|--------|
| #8 CI consolidation — Option A | owner | 2026-10-03 | `68f327c` |
| #9 pre-existing red gate — semantics-preserving cleanup | owner (carry-forward) | 2026-10-03 | `114c35e` |
| #10 keys/tx canonical API — SDK is canonical, protocol re-exports | owner (Phase 3 direction) | 2026-10-03 | `df41252` |
| #11 Phase 3d — one committed home for the UniFFI bindings | owner (Phase 3 direction) | 2026-10-03 | `b7875b3` |
| #12 untrack Gradle build output + stale UniFFI native libs | owner (Phase 3 direction) | 2026-10-03 | `9c6c91d` |
| #13 Phase 3c — Android uses the FFI for all key work | owner (Phase 3 direction) | 2026-10-04 | `88c4047` |
| #14 iOS golden vectors verified on Linux (no Xcode) | owner (Phase 3 direction) | 2026-10-03 | `efd21b1` |
| #15 Phase 3b — web + extension use the shared wasm keys | owner (Phase 3 direction) | 2026-10-03 | `7c2ff8c`, `af1ada5` |
| #16 Phase 3b — dashboard uses the shared WASM core | owner (Phase 3 direction) | 2026-10-04 | `fde6a46`, `914cc49` |
| #17 Phase 3e — one OpenAPI spec + generated client for the node HTTP API | owner (Phase 3 direction) | 2026-10-04 | `dc8a5fe` |
| #4/#18 Phase 4 — npm workspaces, one root manifest + lockfile | owner | 2026-10-04 | pending |
| #19 Phase 4 — version drift accepted when collapsing six lockfiles | owner (Phase 4 direction) | 2026-10-04 | pending |
| #6/#20 Phase 4 — `packages/ui` = console-shared only, peerDeps, alias kept | owner (Phase 4 direction) | 2026-10-04 | pending |
| #21 Phase 4 — defer `packages/wallet-wasm` move (publish-sdk gate) | owner | 2026-10-04 | pending |
| #22 Phase 4 — stale `apps/dashboard` manifest excluded, archive recommended | owner (Phase 4 direction) | 2026-10-04 | pending |

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

### Phase 4 (one TypeScript workspace)
Self-contained in one commit series. Revert the whole phase with:
```bash
git revert --no-commit <phase4-first>^..<phase4-last> && git commit
```
That restores the six per-app `package-lock.json` files and the per-app install
steps. Note the lockfile revert also restores the pre-Phase-4 dependency versions;
the 115-package drift in #19 is reverted with it. If only the dependency drift must
be undone, pin the affected packages in the root `overrides` instead of reverting.

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