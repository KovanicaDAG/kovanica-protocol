#!/usr/bin/env bash
# Verify the iOS wallet-key code on a Linux box.
#
# The iOS target itself needs Xcode, but nothing in the derivation path is
# Apple-specific: `KovanicaWallet/KovanicaKeys.swift` is Foundation-only and
# calls the crate-owned UniFFI binding, which is plain C ABI. So on Linux we
# can compile the *unmodified* sources together with a host build of
# `kovanica-ffi` and run the golden vectors through the real Rust code.
#
# What this proves:
#   * the generated Swift binding still matches the Rust FFI surface
#     (a signature drift breaks the link or the checksum asserts),
#   * `KovanicaKeys.swift` derives the pinned addresses, honours the
#     passphrase, and normalises whitespace,
#   * every empty-*and* non-empty-passphrase derivation vector in
#     `protocol/testvectors/vectors.json` reproduces.
#
# What it does NOT prove: anything UIKit/SwiftUI/Keychain, or that the
# `.xcframework` links — that still needs macOS + `build-apple.sh`.
#
# Usage:  apps/ios/tools/linux-vectors/verify-vectors.sh
# Requires: swiftc (Swift 5.8+), cargo, and the workspace checked out.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"

ffi_dir="$repo/protocol/crates/kovanica-ffi"
wallet_src="$repo/apps/ios/KovanicaWallet/KovanicaKeys.swift"
vectors="$repo/protocol/testvectors/vectors.json"

command -v swiftc >/dev/null || { echo "swiftc not found on PATH" >&2; exit 1; }
[ -f "$wallet_src" ] || { echo "missing $wallet_src" >&2; exit 1; }
[ -f "$vectors" ] || { echo "missing $vectors" >&2; exit 1; }

echo "==> building host libkovanica_ffi"
( cd "$repo/protocol" && cargo build -p kovanica-ffi )
libdir="$repo/protocol/target/debug"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The Darwin modulemap uses `use "Darwin"`, which clang on Linux rejects.
# Regenerate the same module without that line rather than editing the
# committed binding (the binding itself stays byte-identical to what ships).
sed '/use "Darwin"/d' "$ffi_dir/bindings/swift/kovanicaFFI.modulemap" \
    > "$work/module.modulemap"
cp "$ffi_dir/bindings/swift/kovanicaFFI.h" "$work/"
cp "$ffi_dir/bindings/swift/kovanica.swift" "$work/"
cp "$wallet_src" "$work/"
cp "$here/main.swift" "$work/"

echo "==> compiling and running the golden-vector harness"
swiftc -o "$work/ios-vectors" \
    -I "$work" \
    -L "$libdir" -lkovanica_ffi \
    -Xlinker -rpath -Xlinker "$libdir" \
    "$work/main.swift" "$work/kovanica.swift" "$work/KovanicaKeys.swift"

VECTORS_JSON="$vectors" "$work/ios-vectors"
