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