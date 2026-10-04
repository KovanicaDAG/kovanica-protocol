# Phase 5 — One desktop shell (evaluation only)

**Status:** evaluation + recommendation — **no application code changed**
**Date:** 2026-10-04
**Branch:** `chore/unify-structure-phase5`
**Scope gate** (`.unify-kit/plan/03-PHASES.md`):

> Phase 5 (optional, evaluate only): one desktop shell. `apps/desktop-node` + two console
> apps become one Tauri app with per-platform builds (Linux, Windows; macOS if wanted).
> Evaluate Tauri 2 mobile targets in a spike; do not replace the native Android/iOS apps
> without a written comparison.

This document *is* that written comparison. It is deliberately a document, not a migration.

---

## 1. Inventory — the three desktop surfaces

| | `apps/desktop-node` | `apps/console-kovanica` | `apps/console-enterprise` |
|---|---|---|---|
| Rust crate | `kovanica-desktop` | `kovanica-console` | `kovanica-enterprise-console` |
| Tauri | **v2** (`tauri 2`, `tauri-build 2`, `@tauri-apps/cli ^2`) | **v1** (`tauri 1.6` → 1.8.3, `tauri-build 1.5`, `@tauri-apps/cli ^1.5`) | **v1** (same as kovanica) |
| Rust role | **embedded node**: `NodeService` boots a real `kovanica-node::Node`, worker thread, genesis-parity gate, event stream — **2,481 lines** across 9 files (`worker.rs` 1327, `tauri_main.rs` 419, `profile.rs` 230, `service.rs` 197, `events.rs` 100, `datadir.rs` 87, `authority_keys.rs` 67, `lib.rs` 42, `main.rs` 12) | **bare shell**: `tauri::Builder::default().run(...)` — **8 lines** total, no `invoke_handler`, no plugins | **bare shell**: identical 8-line builder |
| Path-deps | `kovanica-dag`, `kovanica-node`, `kovanica-state` (real node core) | none | none |
| UI stack | vanilla JS — `main.js` 710 lines + `index.html` 301 lines | React 18 + react-router-dom 6 + Tailwind 3 + Vite 5 + TS 5 — **11 pages** | React 18 + Tailwind 3 + Vite 5 + TS 5 — **9 pages** |
| Shared code | none | `@kovanica/console-shared` | `@kovanica/console-shared` |
| Bundle id | `org.kovanica.desktop` | `com.kovanica.console` | `com.kovanica.enterprise-console` |
| Product name | Kovanica (Node) | Kovanica Console | Kovanica Enterprise Console |
| Category | — | `DeveloperTool` | `Business` |
| fs scope | `$APPDATA/Kovanica/**`, `$HOME/.local/share/kovanica/**`, `$HOME/Library/…` | `$APPDATA/kovanica/**`, `$DOWNLOAD/**` | `$APPDATA/kovanica-enterprise/**`, `$DOWNLOAD/**` |
| Cargo workspace | own `[workspace]` (standalone, deliberate) | `src-tauri` has its own `Cargo.lock`, not a workspace member | same |
| Purpose | run a Kovanica node on the desktop | explorer, node/validator monitoring, wallet, multisig, HTLC, developer tools | business wallet, API keys, asset management, RWA/NFT, reporting, webhooks |

**The two consoles are the same product shell with different pages.** Same Tauri major, same
Rust dependency set, same frontend stack, same shared component package, same CSP, same window
geometry, same icon set. They differ in: product name, bundle identifier, category, long/short
description, fs scope, and their page set.

**`apps/desktop-node` is a different category of application.** It embeds the node itself
(`kovanica-node::Node`), is already on Tauri 2, uses a hand-written vanilla UI, and carries a
genesis-parity gate plus an SPV/staking/asset event surface. It is not a console and does not
share the React stack.

### CI coverage today

| surface | built by any gate? |
|---|---|
| `apps/console-kovanica` | ✅ `ci.yml` `desktop-linux` (fails, webkit) + `desktop-windows` (passes); `build-all.yml` `linux-tauri` / `windows-tauri` / `macos-tauri-ios` (tag/manual) |
| `apps/console-enterprise` | ❌ **never built by anything** |
| `apps/desktop-node` | ❌ **never built by anything** — only matched by the `desktop` path filter |

The `desktop` path filter (`ci.yml:62`) is
`['apps/desktop-node/**', 'apps/console-*/**', 'protocol/crates/**']`, so a change to
`apps/desktop-node` *triggers* the desktop jobs — which then build `console-kovanica` only.
**2,481 lines of Rust in `desktop-node` and an entire second console have no compile gate.**

---

## 2. What "one desktop shell" can mean — options

### Option A — one binary, one installer, product switch inside the app
Fold both consoles into a single Tauri app (one Rust crate, one bundle) and select
Kovanica/Enterprise at runtime, or ship one frontend that routes between both page sets.

- **Buys:** one installer per platform; one Tauri version to maintain; one CSP; one code path.
- **Costs:** the two products have different bundle identifiers, product names, categories,
  fs scopes and audiences. One installer means the Enterprise customer downloads the
  "Kovanica Console" and vice versa. Auto-update channels, telemetry opt-ins and installer
  metadata all have to be reconciled. This is a **product/packaging decision**, not a refactor.
- **Verdict:** do not do this without an explicit owner decision. It is the one option that
  changes what users install.

### Option B — one shell *codebase*, two products (recommended)
Extract the duplicated Rust shell into a shared crate (e.g. `apps/desktop-shell` or
`packages/desktop-shell`) that owns the `Builder`, window config, plugin registration and the
common bundle defaults; each console keeps its own `tauri.conf.json` (identifier, name,
category, fs scope) and its own pages. Migrate both to **Tauri 2** as part of the same change.
One CI matrix builds both products for Linux + Windows (+ macOS).

- **Buys:** exactly the duplication that actually exists is removed (the shell, the plugin
  wiring, the version bump, the CI matrix). The v1→v2 migration happens **once**, not twice.
  Both products get CI coverage. Product identity is preserved.
- **Costs:** a shared Rust crate and a config-base pattern; two bundles per platform.
- **Verdict:** this is the honest reading of "one Tauri app" that does not require a product
  decision. It also subsumes the *mandatory* v1→v2 migration (see §4).

### Option C — three-in-one (fold `desktop-node` in)
Merge all three into one Tauri app.

- **Costs:** `desktop-node` is Tauri 2 + vanilla UI + embedded node; the consoles are Tauri 1 +
  React. One binary would both run a node and render two business frontends. The UI stacks do
  not compose without rewriting one of them.
- **Verdict:** rejected. `desktop-node` should instead get its **own** CI job so it stops being
  unverified.

### Option D — status quo
- **Costs:** two copies of a Tauri v1 shell that must each be migrated; `console-enterprise`
  and `desktop-node` remain unbuildable-by-CI; the Linux desktop job stays red forever.
- **Verdict:** not viable — the v1→v2 migration is forced anyway.

---

## 3. Tauri 2 mobile targets vs the native apps

Phase 5 asks for a spike evaluation and forbids replacing the native apps without a written
comparison. Comparison:

| aspect | native (`apps/android`, `apps/ios`) | Tauri 2 mobile (proposed) |
|---|---|---|
| UI | native Kotlin (54 files / 6,040 lines) and Swift (13 files / 1,388 lines) | system WebView rendering a JS/React app |
| Crypto boundary | **UniFFI** — Rust owns keys, derivation, sighash, tx building; keys never enter JS | wasm package in the WebView, or per-operation IPC into Rust |
| Key storage | Android Keystore / iOS Keychain via native APIs (already wired) | needs a plugin; mobile plugin ecosystem is materially thinner |
| Attack surface | native UI + a typed FFI surface | WebView + JS runtime + IPC bridge + wasm |
| Verification | Phase 3c/3d: golden vectors green on both platforms; Android job builds the FFI AAR + debug APK; iOS job builds the xcframework + app on macOS | none yet — would need a spike |
| Code reuse with web | none (by design) | reuses React frontends and `packages/*` |
| Maturity | shipped, CI-green | newer; wallet-grade secure storage is not a solved problem |

**Recommendation: do not replace the native apps.** For a wallet, moving key handling from a
native UniFFI boundary into a WebView is a **security regression**, not a refactor. It would
also discard the Phase 3c/3d work (Android-on-FFI, iOS vectors) that is currently green, in
exchange for a thinner secure-storage story. If frontend reuse is the goal, the cheaper and
already-taken path is Phase 4's shared TS packages (`@kovanica/api-client`,
`@kovanica/console-shared`); mobile remains native and FFI-backed.

A Tauri 2 mobile spike is only worth commissioning if the owner wants a *single* web UI for
desktop + mobile **and** accepts a security review of the resulting key-handling model. That
spike should be its own branch and should not touch `apps/android` / `apps/ios`.

---

## 4. Blockers and risks

1. **Tauri v1 → v2 is mandatory regardless of this evaluation.** Tauri v1 (`tauri 1.8.3` →
   `wry 0.24.12` → `webkit2gtk-sys 0.18.0`) hard-requires pkg-config `webkit2gtk-4.0`.
   Ubuntu 24.04 (`ubuntu-latest`) ships only `webkit2gtk-4.1`; upstream
   `tauri-apps/tauri#9662` is closed `not_planned`, and the only supported fix is Tauri v2.
   The `desktop-linux` job therefore fails today by construction and is `continue-on-error: true`.
2. **`apps/console-enterprise/src-tauri/tauri.conf.json` carries the same four v1 schema
   defects** that were fixed in `console-kovanica`:
   - `tauri.allowlist.http.scope` contains `"http://localhost:**"` and `"http://127.0.0.1:**"`
     — not parseable as a `url::Url` in v1;
   - `bundle.windows.nsis` references `icons/nsis-header.bmp`, `icons/nsis-welcome.bmp` and
     `../../../../LICENSE` — **none of those files exist**;
   - `deb` and `appimage` are nested under `bundle.windows` — not valid there in v1.

   Nobody has seen these because the app is never built. Any shell unification must fix them.
3. **No compile gate for `desktop-node` or `console-enterprise`** (see §1). The committed
   `apps/desktop-node/Cargo.lock` is also stale relative to its `Cargo.toml`: `cargo check
   --locked` fails with *"cannot update the lock file … because `--locked` was passed"*.
   Running it without `--locked` resolves cleanly (RC=0, 19.3s) but rewrites the lockfile
   (+44/−2) — it was missing `kovanica-keys` (a Phase 3a path-dependency that arrived
   transitively), `pbkdf2` and `zeroize_derive`. Nothing noticed because nothing checks this
   crate. The crate itself is healthy; only the lockfile is behind.
4. **macOS bundling is unexercised and misconfigured**: both consoles set
   `bundle.macOS.entitlements: "entitlements.plist"`, and no such file exists anywhere.
   `macos-tauri-ios` in `build-all.yml` is tag/manual only.
5. **No signing story.** Windows Authenticode and macOS codesign/notarization are not wired
   up; `build-all.yml` produces unsigned artifacts. "Per-platform builds" is not the same as
   shippable installers.
6. **No `LICENSE` file in the repo**, yet the nsis configs reference one and the manifests
   declare `MIT` / `MIT OR Apache-2.0`.
7. `build-all.yml` used to use **pnpm** in its (tag/manual) release jobs while the rest of the repo
   is npm workspaces (Phase 4). **Fixed** — it and `ci-cd.yml` now install from the root
   `package-lock.json` and run `npm run tauri build`, so no workflow still carries the old pnpm
   steps or the dangling per-app lockfile paths.

---

## 5. Rough effort

| work item | size | notes |
|---|---|---|
| Fix `console-enterprise` `tauri.conf.json` v1 schema defects | S | mirrors the `console-kovanica` fix |
| Add CI coverage for `desktop-node` (`cargo check` / `cargo test`) | S | standalone workspace; no webkit needed without the `tauri` feature |
| Refresh `apps/desktop-node/Cargo.lock` | S | `cargo update`/regenerate, commit |
| Migrate both consoles Tauri v1 → v2 | M–L | config schema, plugin registration, allowlist → capabilities/permissions, `@tauri-apps/api` v2 |
| Extract the shared shell crate (Option B) | M | after the v2 migration |
| One CI matrix building both products, Linux + Windows | S–M | extends the existing two jobs |
| macOS bundles + signing/notarization | L | needs an Apple Developer account and secrets |
| Windows Authenticode signing | M | needs a certificate |
| Tauri 2 mobile spike | L + security review | separate branch; do not touch native apps |

---

## 6. Recommendation

1. **Do not merge the three apps into one binary.** Adopt **Option B**: one shared Tauri shell
   *codebase*, two products (Kovanica Console, Enterprise Console), each with its own bundle
   identity, built per platform by one CI matrix.
2. **Migrate both consoles to Tauri 2** — this is required anyway to un-red the Linux job.
3. **Keep `apps/desktop-node` separate**, but give it a CI job so it stops being unverified,
   and refresh its stale `Cargo.lock`.
4. **Do not replace `apps/android` / `apps/ios`** with a Tauri 2 mobile shell. The UniFFI
   boundary is the wallet's security boundary; moving it into a WebView is a regression.
5. **Decide the signing/notarization story before promising installers.** Per-platform builds
   without Authenticode/notarization are not shippable.

Items 1–2 need an owner decision because they change what gets installed; item 4 is a
recommendation to *not* act.

---

## 7. Report-only findings surfaced by this evaluation

- `apps/console-enterprise/src-tauri/tauri.conf.json` has the four v1 schema defects listed in §4.2.
- `apps/desktop-node/Cargo.lock` is stale (`cargo check --locked` refuses to run).
- ~~`apps/desktop-node` and `apps/console-enterprise` have no CI coverage at all.~~ **Fixed** —
  `desktop-node (fmt / clippy / test)`, `desktop (Tauri config gate)` and the two-console
  `desktop (Windows Tauri — …)` matrix landed (DECISIONS #24), and both consoles are now on
  Tauri v2 (DECISIONS #25).
- ~~`entitlements.plist` referenced by both consoles does not exist.~~ **Fixed** — the dangling
  reference was removed from both configs; the entitlements *policy* is still an open owner
  decision.
- No `LICENSE` file in the repo.
- ~~`build-all.yml` still uses pnpm.~~ **Fixed** — it and `ci-cd.yml` now use the root npm
  workspace.

---

## 8. What was not verified

- **No Tauri bundle could be built on this host.** There is no `xcodebuild`, no Windows host,
  and the Linux host lacks `webkit2gtk-4.0` (and any webkit at all), so `tauri build` cannot
  complete for any of the three apps.
- **No Tauri 2 mobile spike was run.** It requires a mobile-capable toolchain and, per the
  plan, its own branch. This document evaluates it on architecture and security grounds only.
- **`apps/console-enterprise` was never compiled**, so the §4.2 defects are read from the
  config, not observed from a failing build.
- The `desktop-node` crate itself **was** compiled during this evaluation: `cargo check`
  → RC=0 in 19.3s. Only the `--locked` variant fails, because the committed lockfile is
  stale (§4.3).
