# iOS Build Guide — Kovanica Wallet

## Prerequisites

- macOS 14+ (Sonoma or later)
- Xcode 15.4+
- Xcode Command Line Tools: `xcode-select --install`
- Homebrew (recommended): `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
- Rust with the Apple targets:
  `rustup target add aarch64-apple-ios aarch64-apple-darwin x86_64-apple-darwin`

## Setup

There is **one** build definition: `xcodegen.yml`. There is deliberately no
`Package.swift` — a SwiftPM build would need the generated bindings compiled
into the app target (as here) *and* imported as a module, so both build systems
would carry their own copy of the FFI wiring, and a second definition is a
second thing that can drift.

```bash
brew install xcodegen

# 1. Build the Rust light node and the Swift bindings it exposes.
#    Produces protocol/target/kovanica.xcframework (the workspace target dir —
#    build-apple.sh asks `cargo metadata` where it is rather than assuming).
./protocol/crates/kovanica-ffi/build-apple.sh

# 2. Generate the Xcode project.
cd apps/ios
xcodegen generate --spec xcodegen.yml

# 3. Open it.
open KovanicaWallet.xcodeproj
```

⚠️ **Step 1 is not optional.** The app links the light-node framework and
compiles `protocol/crates/kovanica-ffi/bindings/swift/kovanica.swift` into its
target. Without the framework the build fails at link time, which is the
intended signal — see [Key derivation](#key-derivation) below.

## Key derivation

The derivation rule is **frozen**: a key stretch followed by the
fully-hardened SLIP-0010 ed25519 path `m/44'/3007'/0'/0'/i'`. It has exactly one
implementation, in Rust (`protocol/crates/kovanica-wallet`), pinned by
known-answer tests there and re-asserted across the FFI boundary in
`protocol/crates/kovanica-ffi/tests/ffi_deriv.rs` and
`apps/ios/KovanicaWalletTests/KovanicaKeysTests.swift`.

The app calls it through the light-node FFI
(`protocol/crates/kovanica-ffi/src/deriv.rs`) from
`KovanicaWallet/KovanicaKeys.swift`. **There is no Swift derivation code**, and
that is the point: the SwiftUI skeleton used to fake the address by base64'ing
the phrase behind a `kvnc1` prefix. That is not an address and holds nothing, so
the wallet showed a permanent zero balance. A second Swift implementation of
the rule would re-create exactly the divergence the frozen path prevents.

| Function | Returns |
|---|---|
| `mnemonicIsValid(phrase:)` | `Bool` — word list, word count, checksum |
| `deriveAccountFromMnemonic(mnemonic:passphrase:addressIndex:)` | address, public key, signing key, path |
| `deriveAddressFromMnemonic(mnemonic:passphrase:addressIndex:)` | `kvnc…dag` address |
| `deriveSigningSecretFromMnemonic(mnemonic:passphrase:addressIndex:)` | 32-byte key, hex — the `LightNode::send_*` argument |
| `accountFromSigningSecret(signingSecretHex:)` / `addressFromSigningSecret(signingSecretHex:)` | the raw-key (`m` only) path |
| `slip10DerivationPath(addressIndex:)`, `slip44CoinType()` | the frozen constants |

The signing key is **never** written to `UserDefaults`, a plist, or a log. This
build holds it only for as long as derivation takes: there is no send path yet,
and custody moves to the Keychain in the change that wires signing.

## Xcode Configuration

1. **Select Team**: Project → Signing & Capabilities → Team
2. **Bundle Identifier**: `com.kovanica.wallet` (already set)
3. **Capabilities** (add as needed):
   - Keychain Sharing
   - Face ID / Touch ID
   - Camera (for QR scanning)

## Build Commands

### Debug Build (Simulator)
```bash
xcodebuild -scheme KovanicaWallet -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  -derivedDataPath build
```

### Unit Tests
```bash
xcodebuild test -scheme KovanicaWallet \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  -derivedDataPath build
```
`KovanicaWalletTests` pins the derivation vectors from the client side.

#### Without a Mac

`xcodebuild` is macOS-only, but the derivation code is not: the Swift sources
are Foundation-only and the FFI is plain C. On a Linux box with `swiftc` and
`cargo`, `tools/linux-vectors/verify-vectors.sh` compiles the **unmodified**
`KovanicaKeys.swift` plus the committed Swift binding against a host build of
`kovanica-ffi`, and runs every derivation vector from
`protocol/testvectors/vectors.json` (including the passphrase cases). See
`tools/linux-vectors/README.md` for what it does and does not cover.

### Release Build (Device)
```bash
xcodebuild -scheme KovanicaWallet -configuration Release \
  -destination generic/platform=iOS \
  -archivePath build/KovanicaWallet.xcarchive \
  archive
```

### Export IPA
```bash
xcodebuild -exportArchive \
  -archivePath build/KovanicaWallet.xcarchive \
  -exportPath build/Release \
  -exportOptionsPlist ExportOptions.plist
```

## ExportOptions.plist

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store</string>
    <key>teamID</key>
    <string>YOUR_TEAM_ID</string>
    <key>stripSwiftSymbols</key>
    <true/>
    <key>uploadBitcode</key>
    <false/>
    <key>uploadSymbols</key>
    <true/>
</dict>
</plist>
```

## Regenerating the Swift bindings

The bindings are **committed** and CI diffs them against a fresh generation
(the `protocol` job in `.github/workflows/ci.yml` at the repository root), so
any change to the Rust FFI surface must ship with regenerated bindings:

```bash
cd protocol
cargo build --release -p kovanica-ffi

for lang in kotlin swift; do
  cargo run -p kovanica-ffi --bin uniffi-bindgen -- generate \
    --library target/release/libkovanica_ffi.so \
    --language "$lang" --out-dir "crates/kovanica-ffi/bindings/$lang"
done
```

Commit the result, then re-run `build-apple.sh` to rebuild the xcframework.

## Dependencies

| Package | Purpose |
|---------|---------|
| `kovanica.xcframework` (local binary, built by `build-apple.sh`) | Light node, key derivation, Ed25519, BLAKE3 |
| KeychainSwift | Key custody (wiring pending) |

The mnemonic-handling Swift packages were removed: derivation is Rust-side, and
adding a second rule is the bug this app had.

## CI/CD (GitHub Actions)

`.github/workflows/ci.yml` has an `ios` job on `macos-latest` that selects the
latest stable Xcode, runs `build-apple.sh`, verifies the committed Swift
bindings, runs `xcodegen generate`, then `xcodebuild -configuration Release`,
and uploads the `.app`. It needs no secrets; code signing for device builds is a
local/App Store step.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `Undefined symbols: _uniffi_kovanica_ffi_...` | `build-apple.sh` not run, or the framework was rebuilt after `xcodegen generate` — re-run `xcodegen generate` |
| "No signing certificate" | Set Team in Xcode, enable Automatic signing |
| "Package resolution failed" | `xcodebuild -resolvePackageDependencies` |
| "Architecture mismatch" | Build for `arm64` only (iOS devices) |
| `xcodebuild: error: scheme 'KovanicaWallet' not found` | `xcodegen generate` was not run; nothing is committed as `.xcodeproj` |

## App Store Connect

1. Create app in App Store Connect with Bundle ID `com.kovanica.wallet`
2. Configure provisioning profiles (Xcode manages automatically)
3. Upload via Transporter or `xcrun altool`
4. TestFlight for beta, then App Store review

## Current Status

- ✅ SwiftUI Views (8 screens)
- ✅ ViewModel with REST API for head/balance
- ✅ **Real key derivation via the light-node FFI**, pinned by
  `KovanicaWalletTests`
- ✅ xcodegen.yml as the single build definition
- ✅ Info.plist
- ⏳ Xcode project (generate with xcodegen — nothing committed)
- ⏳ `LightNode` lifecycle in-app (sync, send) — blocked on the PoA authority
  set, RFC-POA §0.9 blocker B1; `send()` reports the gap rather than pretending
- ⏳ Keychain custody
- ⏳ QR code scanning
- ⏳ Push notifications (optional)
