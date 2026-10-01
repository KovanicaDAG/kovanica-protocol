# Android LightNode App — Implementation Plan (Slice 9+)

Continues `docs/plans/mobile-light-node.md` (slices 4–8 landed: FFI custody, SPV,
mobile packaging, wallet UX, release). Slice 9 is the first **phone app** built
on the landed FFI foundation. Rules that carry into every slice:

- Every slice ends green on its own gate: `cargo clippy --workspace --all-targets`
  (0 warnings) if Rust is touched, `./gradlew check` if Android is touched,
  AGENTS.md entry in the same change.
- No unrelated hunks: new files only, or strictly-scoped edits to `crates/kovanica-ffi`
  / `web`.
- The AAR is produced from `crates/kovanica-ffi` (`build-android.sh` +
  `android/` gradle module). The app module consumes it, never re-builds it.

---

## Verified facts this plan builds on (do not re-derive)

- **FFI AAR** (`crates/kovanica-ffi/android/build.gradle.kts`): library module,
  namespace `uniffi.kovanica`, AGP 8.5.2 / Kotlin 2.0.20, compileSdk 34,
  minSdk 24, ABIs `arm64-v8a x86_64` (armeabi-v7a mapped in `build-android.sh`),
  sole runtime dep `net.java.dev.jna:jna:5.14.0@aar`. Kotlin bindings are
  committed (`bindings/kotlin/uniffi/kovanica/kovanica.kt`) and compiled via
  `sourceSets["main"].java.srcDirs("../bindings/kotlin")`. Consumer R8 rules
  (`consumer-rules.pro`) already keep `com.sun.jna.**` and `uniffi.kovanica.**`.
- **Bindings are JNA-based** (uniffi 0.32): the generated Kotlin imports JNA
  and loads `libkovanica_ffi.so` on first use. No `System.loadLibrary` in app
  code. UniFFI's JNI bindgen is experimental and *not* in 0.32 — stays a
  flagged migration candidate, not this plan's path.
- **`LightNode` is 100% in-process** (`crates/kovanica-ffi/src/light_node.rs`).
  Sync is **byte-blob**: `export_blocks`/`receive_blocks` wrap the exact gossip
  wire format (`net::encode_records` framing). Blobs ride any transport (HTTP,
  BLE, QR). The phone is the transport layer.
- **Live HTTP surface on the seed** (`crates/kovanica-node/src/explorer.rs`):
  - `GET /api/bootstrap` → JSON `{network, genesis, tip, listen, peers, pow,
    min_fee, atom, token:"KVNC", k:3}` (metadata only — NOT a sync blob).
  - `GET /api/blocks` → `application/octet-stream` = `encode_records(&n.export())`
    → feed bytes directly into `receive_blocks`. **This is the working sync path today.**
  - `GET /api/state` → snapshot JSON (k, subsidy, issued, supply, utxos, etc.).
  - `GET /api/head`, `/api/history?address=`, `/api/utxos?address=`, `/api/origins`.
  - `POST /api/faucet` → open testnet faucet (KVNC).
  - `GET /api/mine/template` + `POST /api/mine/submit` — JSON block uplink
    (`parents: [hex]`, `work`, `timestamp_ms`, …). **Whether it accepts a
    staked (VRF) block is UNVERIFIED — slice 9d spike.**
- **Network identity**: live network is `kovanica-testnet` (RFC-006 activated);
  `/api/state` reports `network`, `k=3`; subsidy 10 KVNC/block (geometric decay
  ×¾ every 2M blocks), founder premine 0.2M KVNC, max supply 90.2M KVNC.
- **Genesis divergence risk (highest)**: `LightNode::new(config)` boots a fresh
  node with an *in-process* genesis (`genesis_with_finality`) whose hash depends
  on `LightConfig {k, subsidy, founder_amount, founder_seed, …}`. If the phone's
  config ≠ the network's real params, its genesis id won't match `GET
  /api/bootstrap → genesis` and `receive_blocks` may reject. **Slice 9a must
  prove genesis equality against the live network before any UI work.**
- **FFI needs k/subsidy to match the network, not `LightConfig::default()`**
  (default subsidy is 1000; live is 10 KVNC = 1_000_000_000 atoms). The app must derive `LightConfig`
  from live `/api/state` + `/api/bootstrap` content.
- **Stable Android stack (mid-2026, verified)**: AGP 8.13.2 / Gradle 8.13 /
  Kotlin 2.2.20–2.3.x; **targetSdk 36 is mandatory for Play by Aug 31 2026**;
  minSdk 24 (matches FFI floor); Compose BOM 2026.06.00, Material3 1.4.0,
  Navigation-compose 2.9.8, lifecycle 2.11, activity-compose 1.13,
  WorkManager 2.11.2. Kept loose in this plan — exact pins land in slice 9a.
- **Threading**: Rust ops (`sync`, `produce_block`) are blocking + CPU-bound;
  run them on a **dedicated single-thread `Executor.coroutineDispatcher()`**
  (UniFFI `ConcurrentHandleMap` makes the Rust object thread-safe, but
  serialized node ops need FIFO). Never call FFI on the main thread.
- **Key custody**: Android Keystore holds a non-exportable `AES/GCM` wrapping
  key; the 32-byte VRF seed is stored encrypted at rest and decrypted only in
  memory when handed to `set_validator_seed`/send secrets. StrongBox/face-auth
  binding is a feature-gated later slice (API 28+).

---

## Slice 9a — App scaffold + FFI wiring (gate: genesis parity)

New repo module `android-light-node/` (root sibling of `web/`):

```
android-light-node/
├── settings.gradle.kts            # + include the AAR via project dir link
├── gradle/libs.versions.toml      # AGP, Kotlin, Compose BOM, JNA pin
├── gradle.properties
├── app/
│   ├── build.gradle.kts           # depends on kovanica-ffi AAR (implementation files()/project)
│   └── src/main/...               # MainActivity, Compose App, strings, themes
└── README.md                      # build + run instructions, AAR build steps
```

Steps:
1. Stand up the Gradle wrapper + version catalog (AGP/Kotlin/Compose verified pins
   from the stack table above; targetSdk 36, minSdk 24).
2. Consume the AAR: build it locally (or CI artifact) and wire in. Prefer a
   **project-dir link** to `crates/kovanica-ffi/android` on first slice (fastest
   iteration), swap to a published AAR (mavenLocal / GH artifact download) in the
   CI slice — mirrors how `deploy.yml` ships the Rust binary today.
3. **Genesis-parity spike (gate)**: app fetches `/api/bootstrap` + `/api/state`,
   builds `LightConfig` from live params, boots `LightNode`, pulls one
   `/api/blocks`, feeds `receive_blocks`, and asserts local genesis id ==
   bootstrap `genesis`. If mismatch: fix `LightConfig` derivation (or the FFI
   surface) BEFORE any UI. Prove it as an instrumented test / debug screen.
4. `produce_block` sanity through the JNA boundary on a debug screen (records a
   staked + PoW block, no network).
5. AGENTS.md entry.

## Slice 9b — Wallet UX (create / import / send / history)

- Screens (Compose, Material3): onboarding (create new / import mnemonic-seed),
  home (balance, staking toggle, history feed), send (amount+address validator),
  receive (address display), settings.
- Seed handling: 32-byte seed generated/imported on device; wrapped via Android
  Keystore `AES/GCM/NoPadding` (non-exportable, per-app); ciphertext in
  DataStore/private file. Seed bytes exist in memory only during FFI calls.
- Balance/history via `balance_of_address` + `history_of(address, max_blocks)`.
- Send via `send_from(secret_hex, amount, to)` → `SendReceipt` → confirmation
  screen from `block_id_hex`/`tx_id_hex`.
- Faucet: `POST /api/faucet` behind a "Get testnet KVNC" button (rate-limited).
- Address format reuse: document the address encoding the app renders (matches
  `/api/utxos` and the web wallet).
- Gate: app can create→fund→send→see history end-to-end on testnet.

## Slice 9c — Light sync (pull + incremental + persistence)

- **v0.1 sync = `GET /api/blocks` octet-stream → `receive_blocks`** on the
  dedicated dispatcher, on app start + WorkManager cadence (see 9e).
- Persistence: `save_snapshot(path)` / `load_snapshot(path)` between runs so
  restart doesn't re-pull history from genesis.
- Incremental: check `/api/head` while syncing; skip re-import when converged.
- **Open decision (needs user + node side):** full export pulls grow with the
  chain. SPV exists (`export_light_sync`/`receive_light_sync`, filters,
  `prove_tx`/`verify_tx_proof`) but the live node exposes **no light-sync
  blob endpoint**. Options:
    - (a) Ship v0.1 on `/api/blocks` pull; add `GET /api/light_sync` (and maybe
      `?from=<id>`) to `explorer.rs` in a node slice as follow-up.
    - (b) Plan the node endpoint now, app uses SPV blobs from day one.
  Default recommended: **(a)** — it ships today, with the node endpoint as the
  first post-v0.1 slice. SPV filters still power the watch-only address list
  during v0.1.
- Gate: fresh-install → full sync → balance/history correct; restart → load
  snapshot → delta sync.

## Slice 9d — Staking (bond / maturity / produce / uplink)

- Bond: `bond_stake(seed, amount)` → conf screen; show `total_stake` /
  `my_stake` and maturity ETA from `pending_unbond_height()` (maturity =
  `UNBOND_MATURITY`+100 heights, per slice-4 facts).
- Toggle ("Light Node Staking")): `set_validator_seed` (Keystore-wrapped seed) +
  `enable_hybrid(...)`; once ON, background loop calls `produce_block` /
  `produce_empty_block` on heartbeat → network uplink.
- **Uplink spike (gate, unverified):** does `POST /api/mine/submit` accept a
  staked (`vrf`) block — i.e. does it carry the vrf/txids/payload fields the way
  `mine/template`+submit expects? If not, options:
    - (a) Extend `explorer.rs` submit to accept the gossip wire format
      (encode_records block) for staked blocks.
    - (b) App→phone P2P relay: upload blob to the seed over the gossiped block
      channel (node `net` framing), needing an endpoint or WebSocket.
  Default recommended: **(a)** — smallest change, one endpoint, reuses the
  existing octet-stream framing the phone already speaks for download.
- Gate: bond → mature → phone wins the VRF sortition → produced block lands on
  the explorer → reward posted. Proven on testnet.

## Slice 9e — Background sync & notifications

- WorkManager periodic sync (constraints: network + charging), petting the
  light node + producing staked blocks while app is backgrounded; exact cadence
  chosen from testnet soak (do not burn battery — the guide's battery promise).
- Foreground-service only if OS kills WorkManager too eagerly (feature-gate,
  with explicit opt-in and a battery-miser mode).
- Local notifications for: new reward, unbond maturity, faucet received.

## Slice 9f — Polish & release

- Branding from `docs`/vault assets (kvnc concepts in
  `Poslovno/KovanicaDAG/assets/`), dark-first Material3 theme, icon/splash.
- CI: GitHub Actions job mirrors `build-web` — build AAR (cargo-ndk) + assemble
  APK (debug) as an artifact; drift-guard binding check stays as-is.
- Signing: Play requires a signed release keystore → **needs user decision**
  (obtain/repo-managed keystore vs local debug builds for v0.1).
- Release gates: lint clean, `./gradlew test`, manual soak; bump to the app
  workspace alongside `kovanica-ffi` version bumps.

---

## Sequencing & risk

| Slice | Depends on | Risk | Mitigation |
|-------|-----------|------|------------|
| 9a | FFI facts (landed) | **High** — genesis parity with live network; AAR wiring | Genesis spike gates the slice; project-dir AAR link; instrumented debug screen |
| 9a→9b wallet | 9a | Medium | seed custody (Keystore) is the only crypto-crit; reuse slice-7 `history_of` |
| 9c sync | 9a | Medium | full `/api/blocks` pull size; snapshot persistence + `/api/head` delta |
| 9d staking uplink | 9b | **High** — submit-for-staked UNVERIFIED | spike first; fallback extend `explorer.rs` submit (encode_records) |
| 9e background | 9c,9d | Medium | WorkManager choice; battery-saver constraints |
| 9f release | all | Low-Med | signing decision needed; CI APK artifact |

Recommended order: **9a (genesis gate) → 9b → 9c → 9d (uplink gate) → 9e → 9f**.
9d's uplink spike can jump ahead (does not block on wallet UI) to de-risk the
hardest unknown earliest.

## Decisions (locked by owner)

1. **Sync transport (9c):** (a) full `/api/blocks` pull in v0.1; node
   `GET /api/light_sync` endpoint is the first post-v0.1 slice.
2. **Staked uplink (9d):** (a) extend `POST /api/mine/submit` to accept the
   gossip wire format (encode_records) for staked blocks.
3. **AAR consumption:** project-dir link during dev → published AAR for CI.
4. **Signing:** debug-signed APKs for testnet v0.1.

## Landed as built (deviations & additions)

### Slice 9a — genesis gate: **LANDED (proof first)**

`crates/kovanica-ffi/tests/live_sync_spike.rs` + committed fixture
`tests/fixtures/live-alpha-blocks.bin` (fresh `GET /api/blocks` capture from
seed1, 1,466 bytes, 10 blocks). Three tests prove the whole phone sync path
at the Rust layer — the exact flow the Android app will run:

1. `default_config_genesis_diverges_from_live_network` — `LightConfig::default()`
   (subsidy 1000) does NOT reproduce the live network genesis (divergence risk
   was real).
2. `live_params_reproduce_testnet_genesis` — with `LightConfig { k:3,
   subsidy: 10*ATOM, founder_amount: 200_000*ATOM, founder_seed:1,
   finality_depth: MAX, payload_pruning_depth: MAX }` (ATOM=100_000_000) the
   node boots to the exact live genesis `9565fc20…`, founder balance
   `20000000000000` atoms (200,000 KVNC = 0.2M KVNC).
3. `light_node_imports_live_testnet_chain` — `receive_blocks(live blob)` → 10
   blocks applied/known, `selected_tip` == live tip, tip block present.

**Live genesis parameters (hard requirement for the app, RFC-006):** `k=3`,
`subsidy=10*ATOM` (10 KVNC/block), `founder_amount=200_000*ATOM` (0.2M KVNC),
`founder_seed=1`, pruning MAX. Derived from `crates/kovanica-node/src/explorer.rs`
`genesis_node()` + RFC-006 constants. `GET /api/bootstrap` exposes `k`,
`atom`, `pow`, `subsidy`, `founder_amount`, `founder_seed` — v0.1 testnet pins
these params as app constants. Genesis is deterministic (no wall-clock), so
param-equality ⇒ genesis-equality, proven above.

**Self-healing of the fixture:** if the network boots a new chain the fixture
becomes stale; re-capture `GET /api/blocks` and update the `LIVE_*` constants.