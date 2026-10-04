# Phase 0 Verification Report

**Branch:** `chore/unify-structure`
**Commit:** `05ec3d7` (docs: PoA-only migration)
**Date:** 2026-10-02

---

## 1. Git State & Tracked Secrets

| Check | Result |
|-------|--------|
| Current branch | `chore/unify-structure` |
| HEAD commit | `05ec3d7` |
| Untracked files | `.unify-kit/`, `docs/`, `kovanica-unify-kit.zip` |

### Tracked files that look like secrets
- **`mobile/android/keystore/release.keystore`** — **TRACKED** and **NOT ignored** by `.gitignore`

> ⚠️ **CRITICAL**: A release keystore is committed and not ignored. This must be rotated and removed from history before any public push. Per rules: report path only and stop that thread.

---

## 2. Android Apps Analysis

### Kotlin File Counts
| App | Files | Notes |
|-----|-------|-------|
| `mobile/android` | 56 | Likely canonical; has UniFFI wired in; contains `com.kovanica.lightnode` packages |
| `wallet/android` | 13 | No UniFFI; same `applicationId` (`com.kovanica.wallet`) |
| `android-light-node` | 11 | `applicationId` `com.kovanica.lightnode` |

### Basename Overlap (excluding `uniffi/`)
- **Only in `wallet/android` (not in `mobile/android`):**
  - `KovApi.kt`
  - `KovanicaWalletApp.kt`
  - `Models.kt`
  - `SeedStore.kt`
- **Only in `android-light-node` (not in `mobile/android`):**
  - `Screens.kt`

### VERIFY: Superset claim
The finding claims `mobile/android` is a superset containing `com.kovanica.lightnode` packages. The basename diff shows `wallet/android` has 4 unique files (mostly app-shell / API client), while `android-light-node` has 1 unique `Screens.kt`. **Need class/screen diff before archiving `wallet/android` or `android-light-node`.** The `applicationId` collision between `mobile/android` and `wallet/android` confirms they cannot coexist.

---

## 3. iOS Apps Analysis

### Swift Basename Overlap
- **Only in `wallet/ios` (not in `mobile/ios`):**
  - `HistoryView.swift`
  - `KovAPIClient.swift`
  - `WalletModels.swift`
  - `WalletRepository.swift`

### VERIFY: Superset claim
`mobile/ios` uses xcodegen (12 Swift files), `wallet/ios` uses hand-made xcodeproj (10 files). The 4 unique files in `wallet/ios` are wallet-specific (history, API client, models, repo). **Need class/screen diff before archiving `wallet/ios`.**

---

## 4. Node Wrapper Analysis

### `node/kovanica-node-bin/src/main.rs`
- 95 lines — thin wrapper

### Path Dependencies (will need updating on moves)
| File | Dependency | Current Path |
|------|------------|--------------|
| `node/Cargo.toml` | kovanica-dag | `../protocol/crates/kovanica-dag` |
| `node/Cargo.toml` | kovanica-state | `../protocol/crates/kovanica-state` |
| `node/Cargo.toml` | kovanica-node | `../protocol/crates/kovanica-node` |
| `node/Cargo.toml` | kovanica-cli | `../protocol/crates/kovanica-cli` |
| `node/Cargo.toml` | kovanica-ffi | `../protocol/crates/kovanica-ffi` |
| `node/kovanica-node-bin/Cargo.toml` | kovanica-node | `../../protocol/crates/kovanica-node` |

---

## 5. Relative Path Dependencies (All `Cargo.toml`)

All internal `path =` dependencies are relative and **will break on moves**. Key cross-workspace deps:

| From | To | Current Path |
|------|----|--------------|
| `protocol/crates/kovanica-cli` | `kovanica-airdrop` | `../../../sdk/crates/kovanica-airdrop` |
| `protocol/crates/kovanica-cli` | `kovanica-types` | `../../../sdk/crates/kovanica-types` |
| `protocol/crates/kovanica-node` | `kovanica-types` | `../../../sdk/crates/kovanica-types` |
| `protocol/desktop-app` | `kovanica-dag` | `../crates/kovanica-dag` |
| `sdk/bindings/kovanica-wasm` | `kovanica-sdk` | `../../crates/kovanica-sdk` |
| `sdk/crates/kovanica-sdk` | examples | `../../examples/*.rs` |

### Gradle
- `android-light-node/settings.gradle.kts:27` — `project(":kovanica-ffi").projectDir = ffiAarDir`

### TypeScript / Vite
No `../` aliases found in `tsconfig*.json` or `vite.config.*` (grep returned empty for those patterns).

### Symlinks
None found outside `node_modules/`.

---

## 6. CI / Workflow Hazards

### All `.github/workflows` Directories
1. `./.github/workflows` — **ACTIVE** (root)
2. `./node/.github/workflows` — inert (1 file: `ci.yml`)
3. `./protocol/.github/workflows` — inert (7 files + README)
4. `./web/site/.github/workflows` — inert (1 file)

### Workflows Mentioning Deploy/Publish/Secrets (REVIEW BEFORE PORTING)

**Root (active):**
- `bindings-drift.yml`
- `build-all.yml`
- `ci-cd.yml`
- `config-gate.yml`
- `publish-sdk.yml` — **tag-driven, enforces version lockstep with `sdk/Cargo.toml`**
- `releases.yml`
- `rust-gate.yml`
- `sdk-wasm.yml`
- `secret-scan.yml`

**`protocol/.github/workflows` (inert but dangerous):**
- `deploy-kovi.yml`
- `deploy.yml`
- `sync-public-node.yml` — **mirrors `crates/**`, `Cargo.toml`, `Cargo.lock` to public `KovanicaDAG/kovanica-node` repo; paths relative to `protocol/` as root**
- `web-deploy.yml`

**`node/.github/workflows`:** `ci.yml` (no deploy/publish)

---

## 7. Reference Counts for Move Map Paths

| Refs | Path | Action (from map) |
|------|------|-------------------|
| 10097 | `node` | DECIDE |
| 285 | `deploy` | MOVE to `ops/deploy` |
| 44 | `installer` | MOVE to `ops/installer` |
| 40 | `dashboard` | MOVE to `apps/dashboard` |
| 36 | `android-light-node` | DECIDE to archive |
| 33 | `mobile/console/kovanica` | MOVE to `apps/console-kovanica` |
| 20 | `mobile/android` | MOVE to `apps/android` |
| 13 | `web/site` | MOVE to `apps/web` |
| 10 | `mobile/ios` | MOVE to `apps/ios` |
| 10 | `mobile/console/enterprise` | MOVE to `apps/console-enterprise` |
| 6 | `wallet/android` | DECIDE to archive |
| 6 | `ledger-app` | MOVE to `apps/ledger-app` |
| 5 | `wallet/ios` | DECIDE to archive |
| 5 | `protocol/desktop-app` | MOVE to `apps/desktop-node` |
| 5 | `protocol/bindings` | DECIDE to consolidate Phase 3 |
| 5 | `protocol/.github/workflows` | MERGE to root (Phase 2) |
| 3 | `wallet/extension` | MOVE to `apps/extension` |
| 2 | `wallet/shared` | MOVE to `packages/brand-assets` |
| 2 | `wallet/.gitignore` | MERGE to root |
| 2 | `mobile/console/shared` | MOVE to `packages/console-shared` |
| 2 | `mobile/.gitignore` | MERGE to root |
| 1 | `web/site/.github` | MERGE to root (Phase 2) |
| 1 | `test-android-apk.sh` | MOVE to `tools/test-android-apk.sh` |
| 1 | `protocol/deploy` | MOVE to `ops/deploy-protocol` |
| 1 | `deploy-consoles.sh` | MOVE to `tools/deploy-consoles.sh` |
| 0 | `protocol/web-playground` | DECIDE |
| 0 | `protocol/rfc006-step7-api-head.patch` | DECIDE |
| 0 | `protocol/patch` | DECIDE |
| 0 | `protocol/alerting_rules.yml` | MOVE to `ops/monitoring/alerting_rules.yml` |
| 0 | `node/.github/workflows` | MERGE to root (Phase 2) |

> **Note:** `node` has 10,097 references — overwhelmingly from `sync-public-node.yml` mirroring `crates/**` (which includes `node/` in the source tree scan). This inflates the count. Actual code references are likely few.

---

## 8. Files Citing Old Top-Level Directories (Hard-Coded Paths)

| File | References |
|------|------------|
| `.github/workflows/bindings-drift.yml` | multiple |
| `.github/workflows/build-all.yml` | multiple |
| `.github/workflows/build-android.yml` | multiple |
| `.github/workflows/ci-cd.yml` | multiple |
| `.gitignore` | anchored patterns |
| `.gitleaks.toml` | path allowlists |
| `deploy-consoles.sh` | hard-coded dirs |
| `dev.sh` | `component_dirs`, android loop |
| `installer/docker/docker-compose*.yml` | paths |
| `mobile/console/*/ecosystem.config.js` | paths |
| `mobile/console/*/vite.config.ts` | paths |
| `mobile/ios/BUILD.md` | paths |
| `mobile/ios/xcodegen.yml` | paths |
| `protocol/.github/workflows/*` | various |
| `protocol/AGENTS.md` | paths |
| `protocol/crates/kovanica-ffi/android/build.gradle.kts` | paths |
| `protocol/desktop-app/Cargo.toml` | paths |
| `protocol/desktop-app/playground/build-check.sh` | paths |
| `protocol/docs/*` | multiple docs |
| `protocol/web-playground/build-check.sh` | paths |
| `scripts/build-vault.py` | paths |
| `sdk/crates/kovanica-keys/src/lib.rs` | paths |
| `sdk/crates/kovanica-keys/tests/slip10_vectors.rs` | paths |
| `test-android-apk.sh` | paths |
| `web/site/DEPLOY.md` | paths |

---

## 9. Baseline Build Results

| Workspace | Command | Exit Code | Status |
|-----------|---------|-----------|--------|
| `protocol/` | `cargo check --workspace --locked` | 0 | PASS |
| `sdk/` | `cargo check --workspace --locked` | 0 | PASS |
| `node/` | `cargo check --workspace --locked` | 0 | PASS |
| `web/site/` | `npm ci && npm run build` | 0 | PASS |
| `dashboard/frontend/` | `npm ci && npm run build` | 2 | **FAIL** (missing deps: `@noble/*`, `@radix-ui/*`, `@scure/bip39`) |
| `wallet/extension/` | `npm ci && npm run build` | 0 | PASS |
| `mobile/console/kovanica/` | `npm ci && npm run build` | 0 | PASS |
| `mobile/console/enterprise/` | `npm ci && npm run build` | 0 | PASS |
| Android (`gradle assembleDebug`) | — | — | **NOT RUN** (gradle missing) |
| iOS (`xcodebuild`) | — | — | **NOT RUN** (xcodebuild missing) |

### Dashboard Build Failure Details
Missing npm dependencies (not installed by `npm ci`):
- `@noble/hashes/sha2.js`, `@noble/hashes/utils.js`, `@noble/hashes/hmac.js`
- `@noble/curves/ed25519.js`
- `@radix-ui/react-avatar`, `react-hover-card`, `react-progress`, `react-scroll-area`, `react-separator`
- `@scure/bip39`, `@scure/bip39/wordlists/english`

This is a **pre-existing issue** in the repo (package.json missing deps), not introduced by this work.

---

## 10. DECIDE Rows — Proposed Flips with Reasoning

| Row | Path | Current | Proposed | Reasoning |
|-----|------|---------|----------|-----------|
| 13 | `wallet/android` | DECIDE | **ARCHIVE** | Same `applicationId` as `mobile/android`; 4 unique files are app-shell only; `mobile/android` has UniFFI + lightnode packages (superset). Archive after class diff confirmation. |
| 14 | `wallet/ios` | DECIDE | **ARCHIVE** | `mobile/ios` uses xcodegen (maintained); `wallet/ios` hand-made xcodeproj; 4 unique files are wallet-specific UI. Archive after class diff confirmation. |
| 15 | `android-light-node` | DECIDE | **ARCHIVE** | `mobile/android` already contains `com.kovanica.lightnode` packages; separate `applicationId` but redundant. Archive after confirming no unique screens. |
| 20 | `protocol/web-playground` | DECIDE | **ARCHIVE** | 0 refs; likely superseded by `web/site` playground components. |
| 27 | `node` | DECIDE | **KEEP (fold later)** | Thin wrapper (95 lines). Path-deps on `protocol/crates`. **Do not delete** — used by `sync-public-node.yml`. Option: fold `kovanica-node-bin` into `protocol/` workspace in Phase 3. |
| 28 | `protocol/bindings` | DECIDE | **ARCHIVE (Phase 3)** | Duplicate of `protocol/crates/kovanica-ffi/bindings/` + nested kotlin duplicate. Consolidate in Phase 3 per bindings-drift guard. |
| 29 | `protocol/patch` | DECIDE | **ARCHIVE** | 0 refs; one-off patches; confirm obsolete. |
| 30 | `protocol/rfc006-step7-api-head.patch` | DECIDE | **ARCHIVE** | 0 refs; confirm obsolete. |
| 31 | `protocol/alerting_rules.yml` | MOVE | **MOVE** (0 refs but referenced in deploy) | Move to `ops/monitoring/alerting_rules.yml` as planned. |

---

## 11. Open Decisions (Record in `docs/unify/DECISIONS.md`)

1. **Keystore rotation** — `mobile/android/keystore/release.keystore` is tracked and not ignored. Must rotate and purge from history (separate task).
2. **Dashboard deps** — Missing npm dependencies cause build failure. Fix before Phase 1 or document as known-broken.
3. **`node/` wrapper** — Keep as-is for now (sync-public-node dependency); evaluate folding in Phase 3.
4. **Package manager** — `build-all.yml` uses pnpm for consoles; apps have `package-lock.json`. Decide in Phase 4 (pnpm vs npm workspaces).
5. **Windows Tauri** — `build-all.yml` has Linux Tauri only. Add `windows-latest` matrix in Phase 2 CI.
6. **Console shared import** — `mobile/console/shared` imported via symlink in enterprise. Verify import mechanism before moving to `packages/console-shared`.

---

## 12. How to Revert Phase 0

Phase 0 is read-only. No changes to revert. Simply:

```bash
git checkout main
git branch -D chore/unify-structure
rm -rf .unify-kit docs/unify kovanica-unify-kit.zip
```

---

## 13. Next Steps (Awaiting Approval)

1. **Approve edited move map** (DECIDE rows flipped as proposed above)
2. **Confirm keystore handling** (rotate + untrack before any push)
3. **Confirm dashboard deps fix** (or accept as known-broken baseline)
4. Then proceed to **Phase 1: Layout (pure moves)**