# kovanica-protocol

A **DAG-based distributed ledger** — a high-throughput BlockDAG protocol with
**GHOSTDAG** consensus (Sompolinsky, Wyborski & Zohar; the protocol behind
Kaspa). Blocks reference multiple parents so many blocks can be produced in
parallel and merged later; consensus deterministically linearizes the DAG and a
UTXO ledger applies transactions in that order. Hybrid admission combines
Nakamoto proof-of-work with VRF-staked block production (Algorand/Praos-style
sortition), and phones sync as light nodes through UniFFI bindings.

> **Working on this repo?** Read [`AGENTS.md`](./AGENTS.md) first — it is the
> source of truth for conventions, layout details, and the roadmap.

## Layout

| Crate | What |
| --- | --- |
| `crates/kovanica-dag` | DAG + GHOSTDAG consensus core: reachability oracle, colouring, linearization, PoW/difficulty/VRF |
| `crates/kovanica-state` | UTXO ledger applied in GHOSTDAG order: ed25519 spends, stake registry, hybrid admission, snapshots/checkpoints, SPV (`spv.rs`) |
| `crates/kovanica-node` | Runnable node: RPC/mempool/P2P mesh + DHT/DNS discovery, metrics, self-hosted explorer |
| `crates/kovanica-ffi` | `LightNode` — UniFFI bindings for Kotlin/Swift mobile light nodes |
| `crates/kovanica-cli` | CLI wallet |
| `web/` | TanStack Start web UI |

## Build, test & run

Rust workspace (edition 2021). From the repo root:

```sh
cargo build                 # build everything
cargo test                  # unit + integration + doctests
cargo clippy --all-targets  # keep warning-clean
cargo fmt --check           # CI gate

cargo run -p kovanica-node -- demo   # scripted end-to-end scenario
cargo run -p kovanica-node           # serve REPL (try `help`)
```

`unsafe` is forbidden crate-wide. Never commit to the default branch — feature
branch + draft PR (see `AGENTS.md` §6).

## Run a light node from Kotlin / Android

Build the native library and the AAR first (min SDK 24):

```sh
./crates/kovanica-ffi/build-android.sh   # cargo-ndk → jniLibs/{arm64-v8a,x86_64}
```

Add the Gradle module at `crates/kovanica-ffi/android/` to your app (its only
runtime dependency is `net.java.dev.jna:jna:5.14.0@aar`). The bindings live in
package `uniffi.kovanica`. The snippet below mirrors the Rust integration test
`sync_blob_between_two_nodes_converges`
([`tests/ffi.rs`](./crates/kovanica-ffi/tests/ffi.rs)): two genesis-identical
nodes converge purely from an exported byte blob.

```kotlin
import uniffi.kovanica.LightConfig
import uniffi.kovanica.LightNode
import uniffi.kovanica.U128Parts

val config = LightConfig(
    k = 3u, subsidy = 1000uL, founderAmount = 1000uL, founderSeed = 1uL,
    finalityDepth = ULong.MAX_VALUE, payloadPruningDepth = ULong.MAX_VALUE,
)
val nominalWork = U128Parts(high = 0uL, low = 7uL)

// Producer: bonded validator producing staked blocks.
val producer = LightNode(config)
producer.setValidatorSeed(ByteArray(32) { 0xAB.toByte() })
producer.enableHybrid(1uL, 1uL, nominalWork, false)
producer.bondStake(1uL, 500uL)
producer.produceEmptyBlock()
producer.send(fromSeed = 1uL, amount = 400uL, toSeed = 2uL)

// Peer starts identical (genesis) and catches up purely from bytes.
val peer = LightNode(config)
peer.setValidatorSeed(ByteArray(32) { 0xCD.toByte() })
peer.enableHybrid(1uL, 1uL, nominalWork, false)
peer.receiveBlocks(producer.exportBlocks())
check(peer.selectedTip() == producer.selectedTip())  // tips converge
```

Both nodes are `AutoCloseable`; prefer wrapping in `.use { … }` in real apps.

## Run a light node from Swift / iOS

Build the xcframework first (macOS host, iOS arm64 + macOS arm64/x86_64):

```sh
./crates/kovanica-ffi/build-apple.sh      # → target/kovanica.xcframework
```

Add the framework to your Xcode project and compile
[`bindings/swift/kovanica.swift`](./crates/kovanica-ffi/bindings/swift/kovanica.swift)
into the app target (same module, no import needed). Same test, mirrored:

```swift
let config = LightConfig(k: 3, subsidy: 1000, founderAmount: 1000, founderSeed: 1,
                         finalityDepth: .max, payloadPruningDepth: .max)
let nominalWork = U128Parts(high: 0, low: 7)

let producer = try LightNode(config: config)
try producer.setValidatorSeed(seed: Data(repeating: 0xAB, count: 32))
try producer.enableHybrid(rateNum: 1, rateDen: 1, nominalWork: nominalWork, retarget: false)
try producer.bondStake(seed: 1, amount: 500)
try producer.produceEmptyBlock()
_ = try producer.send(fromSeed: 1, amount: 400, toSeed: 2)

let peer = try LightNode(config: config)
try peer.setValidatorSeed(seed: Data(repeating: 0xCD, count: 32))
try peer.enableHybrid(rateNum: 1, rateDen: 1, nominalWork: nominalWork, retarget: false)
try peer.receiveBlocks(blob: producer.exportBlocks())
assert(try peer.selectedTip() == try producer.selectedTip())
```

### SPV mode for watch-only wallets

Instead of full payloads you can exchange compact light-sync blobs — verified
headers plus one Golomb-Rice block filter each — and prove inclusion locally:

- `export_light_sync()` / `receive_light_sync(blob)` — sync headers + filters
  (`KVLS` v1 blobs, verified through a real `SpvClient`)
- `filter_matches(filter, address)` / `filter_matches_any(blob, [addresses])`
  and `synced_filter_matches` / `synced_height` — watch-only address queries
- `prove_tx(blockIdHex, txIdHex)` / `verify_tx_proof(proof)` — merkle inclusion
  proofs rooted at a synced header

See `crates/kovanica-ffi/tests/ffi.rs` for runnable examples of every method.
The generated bindings are committed under
`crates/kovanica-ffi/bindings/`; CI regenerates them on every PR touching the
crate and fails on drift (`.github/workflows/bindings.yml`) — never hand-edit.
