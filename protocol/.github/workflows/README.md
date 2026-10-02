# These workflows do not run

Every file in this directory is **inert**. None of them has ever executed, and
adding or editing one changes nothing.

## Why

`protocol/` is a plain directory in the repository, not a git submodule
(there is no `.gitmodules` entry for it). GitHub Actions only discovers
workflows at **`<repo-root>/.github/workflows/`**, so it never descends into
`protocol/.github/workflows/`. A workflow placed here parses as valid YAML and
looks entirely plausible — it simply never gets scheduled.

The same applies to `web/site/.github/` and `node/.github/`.

## What is live instead

All real CI lives in the **repository root** `.github/workflows/`:

| Workflow | Covers |
| --- | --- |
| `bindings-drift.yml` | kotlin + swift binding drift (the real Slice 6 guard) |
| `rust-gate.yml` | `--locked`, fmt, clippy, test, release build over `protocol/` |
| `ci-cd.yml` | core tests, Tauri desktop builds, consoles, Android/iOS |
| `build-all.yml` | full app matrix + FFI binding artifacts |
| `build-android.yml` | Android SDK + AAR |
| `secret-scan.yml` | gitleaks |
| `config-gate.yml` | env vars, network identity, safety invariants |
| `sdk-wasm.yml` | wasm-pack |
| `publish-sdk.yml`, `releases.yml` | publishing |

## The one that caused real damage

`bindings.yml` in this directory was documented as the live binding drift
guard by `protocol/AGENTS.md`, `mobile/ios/BUILD.md` and
`protocol/docs/plans/mobile-light-node.md`. Because it never ran, a commit
could change the Rust FFI surface and ship stale Kotlin and Swift bindings
without any check failing — mobile clients then fail at runtime with
"method not found". Those three documents now point at the root-level
`bindings-drift.yml`.

## What to do with these files

They are kept only as a record of intent. **Do not edit them expecting CI to
react.** If a workflow here looks like it should be doing something, either
move it to the repository root and fix its paths, or delete it — but do not
leave it in place while believing it is active.
