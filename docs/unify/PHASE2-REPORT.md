# Phase 2 Report — Golden Test Vectors + Root CI Consolidation

**Branch:** `chore/unify-structure`
**Date:** 2026-10-03
**Scope:** Phase 2 of the unify kit (`plan/03-PHASES.md`): (1) emit golden
vectors from the canonical Rust implementation, (2) consume that **same file**
from every other implementation, (3) consolidate CI into one path-filtered root
workflow. No consensus logic changed.

---

## 1. Golden test vectors

### Canonical source
- Generator: `protocol/crates/kovanica-wallet/examples/gen_testvectors.rs`
- Output: `protocol/testvectors/vectors.json` (13 vectors, `version: 1`,
  `network: testnet`)
- Reproduce:
  ```sh
  cd protocol
  cargo run -q -p kovanica-wallet --example gen_testvectors > testvectors/vectors.json
  ```
- Determinism verified: a fresh run is byte-identical to the committed file.

### Inventory (13)
| Kind | Ids | Notes |
| --- | --- | --- |
| derivation | `en-12-zero-i0/i1/i2`, `en-24-zero-i0`, `en-12-zero-passphrase-i0`, `en-12-ab-i0` | frozen path `m/44'/3007'/0'/0'/i`; pubkey hex, `kvnc…` address, 33-byte `0x00`-prefixed `address_hex` |
| script | `multisig-2of3`, `htlc-1440`, `vault-1000-144` | script bytes, hash, address |
| address | `p2pk-aa`, `legacy-32-p2pk` | payload → `kvnc…` encoding |
| transaction | `native-multi-asset`, `stealth-lock-1000-seq-7` | encoded bytes, sighash, Ed25519 signature |

The script/address/sighash constants agree with the pre-existing
`kovanica-state` tests (`script_vectors.rs`, `sighash_vector.rs`), so the
vectors are a superset, not a new authority.

### Consumers
| Implementation | File | Status |
| --- | --- | --- |
| Rust (canonical) | `protocol/crates/kovanica-wallet/tests/shared_vectors.rs` | ✅ 4 passed |
| Rust SDK | `sdk/crates/kovanica-keys/tests/shared_vectors.rs` | ✅ 2 passed |
| Web (TS) | `apps/web/tests/wallet-keys.test.ts` (appended) | ✅ 21 passed (no divergence) |
| Browser extension | `apps/extension/tests/shared-vectors.test.mjs` | ⚠️ 1 pass / 1 todo — **no BIP-39/SLIP-0010 implementation** |
| Android | `apps/android/app/src/test/.../KovanicaKeysTest.kt` | ⛔ not run — no gradle/SDK toolchain |
| iOS | `apps/ios/KovanicaWalletTests/KovanicaKeysTests.swift` | ⛔ not run — no xcodebuild toolchain |

The Android/iOS tests load the vectors from the shared path
(`apps/android/.../resources.srcDir("../../../protocol/testvectors")` and an
`xcodegen.yml` resource entry) and must be executed on a machine with the
respective toolchains before the mobile gate is trusted.

---

## 2. Root CI consolidation

Per owner decision (DECISIONS.md #8, Option A), `.github/workflows/ci.yml` is
now the **only** gate workflow, path-filtered via `dorny/paths-filter@v3`:

| Job | Covers |
| --- | --- |
| `protocol` | `--locked` check, fmt, clippy, test, release build + kotlin/swift binding drift |
| `sdk` | wasm-pack build |
| `web` | web/dashboard/extension/consoles: `npm ci`, build, typecheck, lint |
| `android` | FFI AAR + APK |
| `ios` | Xcode build/test |
| `desktop-linux` / `desktop-windows` | Tauri builds (advisory, `continue-on-error`) |

- Archived (not deleted) to `archive/workflows/`: `rust-gate.yml`,
  `sdk-wasm.yml`, `build-android.yml`, `bindings-drift.yml`.
- `ci-cd.yml` → **Deploy Consoles** (manual / `v*` tag only).
- `build-all.yml` → **Release Apps** (manual / `v*` tag only).
- Untouched: `config-gate.yml`, `secret-scan.yml`, `publish-sdk.yml`,
  `releases.yml`.

The VPS deploy and GitHub-release jobs were **not** duplicated into `ci.yml`;
they remain in the deploy/release workflows and no longer auto-run on `main`
push. This is a deliberate reduction of unattended privilege.

---

## 3. Verification matrix

| Check | Result |
| --- | --- |
| `protocol` `cargo check --workspace --locked` | ✅ pass (1 pre-existing warning) |
| `protocol` vector test | ✅ 4 passed |
| `sdk` `cargo check --workspace --locked` | ✅ pass |
| `sdk` vector test | ✅ 2 passed |
| `node` `cargo check --workspace --locked` | ✅ pass |
| `apps/web` vector test | ✅ 21 passed |
| `apps/extension` test | ✅ 1 pass / 1 todo |
| JS builds: web, dashboard, extension, 2 consoles | ✅ all pass |
| Workflow YAML parse (root + archive) | ✅ all valid |
| Generator determinism | ✅ byte-identical |
| `cargo clippy … -D warnings` (protocol) | ❌ **pre-existing red** — see below |
| `cargo fmt --all --check` (protocol) | ❌ **pre-existing red** — see below |

### Pre-existing red gates (not introduced here)
`main` was already failing the protocol clippy + fmt gate before Phase 2
(origin `8f4cb30`, KVP-107). Details and the three lints are recorded in
DECISIONS.md #9. `kovanica-state` is consensus-critical, so no unilateral fix
was applied. **The new `protocol` job will be red until this is resolved.**

---

## 4. Findings (report-only, not fixed)

1. **Extension is not a Kovanica wallet.** `apps/extension/src/utils/seedPhrase.ts`
   fabricates a 24-word list by interleaving English and Croatian words with no
   BIP-39 checksum; `rpc.ts` speaks ETH JSON-RPC to `localhost:8545` with 18
   decimals. Its vector test is therefore a `todo`, not a pass.
2. **Tracked keystore.** `apps/android/keystore/release.keystore` is tracked and
   not gitignored (path reported only; not touched).
3. **Hardcoded signing secrets.** `apps/android/app/build.gradle.kts`
   `signingConfigs.release` contains literal `storePassword`/`keyPassword`
   (values not reproduced). Rotate + move to secrets.

---

## 5. Exit criteria

- [x] `vectors.json` produced from Rust and reproducible.
- [x] Consumer test exists in every implementation, loading the same file.
- [x] Rust canonical + SDK + web consumers green.
- [x] CI consolidated into one path-filtered root workflow; old gates archived.
- [ ] Android + iOS consumers executed (blocked on toolchains).
- [ ] Pre-existing clippy/fmt red gate resolved or explicitly waived.
- [ ] Extension vector `todo` resolved once a real derivation exists.
