# Kovanica Light Node (Android)

Compose (Material3) app wrapping the in-process Rust light node
(`crates/kovanica-ffi`) via UniFFI-generated JNA bindings.

## Module layout

```
android-light-node/
├── settings.gradle.kts          # includes :app + :kovanica-ffi (project-dir link)
├── gradle/libs.versions.toml    # AGP / Kotlin / Compose BOM pins
├── app/                         # the Compose app (MainActivity = slice-9a gate screen)
│   └── src/main/java/com/kovanica/lightnode/
│       ├── data/                # LightNodeRepository, WalletRepository, SecureSeedStorage, MultisigRepository
│       ├── ui/                  # Compose screens, ViewModel, theme (unchanged Material3)
│       └── work/                # WorkManager background sync + notifications (Slice 9e)
└── README.md
```

The FFI core is consumed as a **project-dir link** to
`crates/kovanica-ffi/android` (its `jniLibs` `.so` files are produced by
`crates/kovanica-ffi/build-android.sh`). Swap to a published AAR
(`mavenLocal` / GH artifact) in the release slice.

## Build

No Android SDK on the dev box — the `.github/workflows/android.yml` job
builds the APK in CI and uploads it as an artifact
(`kovanica-light-node-apk`). Pipeline:

1. Install Rust toolchain + `cargo-ndk` + Android NDK 27 (`sdkmanager "ndk;27.0.12077973"`).
2. `crates/kovanica-ffi/build-android.sh` → `android/src/main/jniLibs/{arm64-v8a,x86_64}/libkovanica_ffi.so`.
3. `gradle -p android-light-node :app:assembleDebug` (Gradle 8.13, JDK 17, AGP 8.10.1, Kotlin 2.2.20).

Local (with SDK): install the NDK per the script header, run the two calls above.

## Stack (verified 2026-08)

- Gradle 8.13 · AGP 8.10.1 · Kotlin 2.2.20 (compose plugin) · JDK 17
- compileSdk/targetSdk 36, minSdk 24 (FFI floor)
- Compose BOM 2026.06.00 · activity-compose 1.13.0 · Material3 (from BOM)
- UniFFI 0.32 JNA bindings, `net.java.dev.jna:jna:5.14.0@aar` (transitively via the AAR)
- WorkManager 2.10.0 (periodic background sync)
- androidx.biometric 1.1.0 + Android Keystore StrongBox opt-in

## Slice-9a gate screen

The main screen boots `LightNode(live config)` and proves parity with the
live network, per `docs/plans/android-light-node-app.md` slice 9a:

| Check | Expected |
| --- | --- |
| local genesis == `/api/bootstrap.genesis` | `596874eac2…` |
| `/api/blocks` import converges | 10 blocks |
| local tip == `/api/bootstrap.tip` | matches seed1 tip |

Live genesis params are pinned as app constants (the node endpoint that
reports them is a pre-mainnet slice). All FFI work runs on a single
serialized thread dispatcher.

## Phase 7 slices

- **Slice 9e (background sync):** `work/SyncWorker` runs a 15-minute periodic
  sync constrained to network + charging. It posts local notifications for
  newly received funds (rewards / faucet) and matured unbonds.
- **Keystore hardening:** `SecureSeedStorage` automatically opts into a
  StrongBox-backed AES key when the device supports it, with TEE fallback,
  and exposes a biometric-auth path for API 30+.
- **Multisig wrapper:** `MultisigRepository` provides the wallet-side shape
  for RFC-001 M-of-N operations; the FFI calls are stubs until
  `phase5-multisig-node` lands.
