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

### 9. Pre-existing red gates on `main` (clippy + fmt) — OPEN
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
- **Impact:** `ci.yml` ports the gate faithfully, so the new `protocol` job is red until this is
  addressed. `kovanica-state` is consensus-critical, so the fix is **not** applied unilaterally.
- **Decision:** OPEN — owner to choose between (a) a semantics-preserving cleanup commit
  (`cargo fmt`, `#[allow]`/refactor the three lints) before Phase 2 is declared green, or
  (b) leave red and track separately. Phase 2 report records the gate as "ported, pre-existing red".

---

## Approved Decisions (to be filled during review)

| Decision | Approved By | Date | Commit |
|----------|-------------|------|--------|
| — | — | — | — |

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