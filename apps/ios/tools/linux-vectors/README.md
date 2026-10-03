# iOS wallet-key vectors on Linux

`verify-vectors.sh` runs the iOS wallet-key derivation against the canonical
golden vectors **without Xcode**. It exists because the derivation path has no
Apple-specific code: `KovanicaWallet/KovanicaKeys.swift` is Foundation-only and
calls the crate-owned UniFFI binding (`protocol/crates/kovanica-ffi/bindings/swift/kovanica.swift`),
whose ABI is plain C.

The script:

1. builds `kovanica-ffi` for the host (`cargo build -p kovanica-ffi`),
2. copies the **unmodified** `KovanicaKeys.swift`, the generated binding, and
   `main.swift` into a temp dir, regenerating `kovanicaFFI.modulemap` without
   its Darwin-only `use "Darwin"` line,
3. compiles them with `swiftc` against `target/debug/libkovanica_ffi.so`,
4. runs every `derivation` vector in `protocol/testvectors/vectors.json`,
   including the passphrase cases the web consumer cannot reach.

## Run

```sh
apps/ios/tools/linux-vectors/verify-vectors.sh
```

Requires `swiftc` (Swift 5.8+) and `cargo`. Verified with Swift 6.1.3 and the
Android/host toolchain in this workspace.

## What it covers

- the frozen SLIP-44 constants and derivation path,
- the pinned addresses at indices 0/1/2 for the zero-entropy phrase,
- signing-key ↔ address round-trip through the raw-key path,
- passphrase separation and whitespace normalisation,
- rejection of malformed phrases and keys,
- all 6 `derivation` vectors in the shared vector file.

## What it does not cover

- UIKit / SwiftUI / Keychain and anything above the crypto layer,
- that the real `.xcframework` links (that is the macOS-only
  `protocol/crates/kovanica-ffi/build-apple.sh`,
  see `apps/ios/BUILD.md`),
- the XCTest suite itself (`apps/ios/KovanicaWalletTests/KovanicaKeysTests.swift`),
  which still needs `xcodebuild`.

The harness mirrors that XCTest suite case-for-case, so a green run here means
the answers are right even though the Xcode runner could not be used.

## Why not in CI

GitHub's hosted Linux runners do not ship a Swift toolchain by default.
Add it to `ci.yml` only together with a pinned Swift setup step; until then
this is a local reproducer, and the `ios` job stays Xcode-on-macOS.
