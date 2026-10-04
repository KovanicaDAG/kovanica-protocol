#!/usr/bin/env bash
# Build the kovanica-ffi static library for iOS and macOS and bundle it as an
# XCFRAMEWORK for Swift consumption.
#
# Prerequisites (macOS only):
#   rustup target add aarch64-apple-ios aarch64-apple-darwin x86_64-apple-darwin
#   Xcode with command-line tools (xcodebuild on PATH)
#
# Usage:
#   ./build-apple.sh                 # all three slices
#   SLICES="aarch64-apple-ios" ./build-apple.sh   # subset, space-separated
#
# Output:
#   protocol/target/kovanica.xcframework   # drag into Xcode / add via SPM local path
#   (Swift sources + modulemap come from the committed bindings/swift/ —
#    kovanica.swift is compiled into your app target; kovanicaFFI.h +
#    kovanicaFFI.modulemap are embedded in the framework headers.)
#
# The Swift side has no external runtime dependency: uniffi 0.32 generates
# everything inline (the modulemap names the FFI symbols).
set -euo pipefail

cd "$(dirname "$0")"

SLICES="${SLICES:-aarch64-apple-ios aarch64-apple-darwin x86_64-apple-darwin}"

# Cargo writes build artifacts to the WORKSPACE target directory, not to a
# crate-local one. This script cd's into crates/kovanica-ffi, so a relative
# `target/...` path points at crates/kovanica-ffi/target/ — a directory Cargo
# never creates. Asking Cargo where the target directory actually is removes
# the whole class of bug (it also picks up a CARGO_TARGET_DIR override).
#
# Parsed with sed rather than jq: jq is not installed on a stock macOS runner,
# and `cargo metadata` emits its JSON on a single line, so this is safe.
TARGET_DIR="$(cargo metadata --format-version 1 --no-deps \
  | sed -n 's/.*"target_directory":"\([^"]*\)".*/\1/p')"
[ -n "$TARGET_DIR" ] || { echo "could not resolve the cargo target_directory" >&2; exit 1; }

OUT="$TARGET_DIR/kovanica.xcframework"

XCFRAMEWORK_ARGS=()
for triple in $SLICES; do
  rustup target add "$triple"
  cargo build --release --target "$triple" -p kovanica-ffi

  lib="$TARGET_DIR/$triple/release/libkovanica_ffi.a"
  [ -f "$lib" ] || { echo "missing $lib" >&2; exit 1; }

  slice_dir="$TARGET_DIR/xcframework/$triple"
  mkdir -p "$slice_dir"
  cp bindings/swift/kovanicaFFI.h bindings/swift/kovanicaFFI.modulemap "$slice_dir/"

  XCFRAMEWORK_ARGS+=( -library "$lib" -headers "$slice_dir" )
done

rm -rf "$OUT"
xcodebuild -create-xcframework "${XCFRAMEWORK_ARGS[@]}" -output "$OUT"

echo
echo "Built $OUT:"
ls "$OUT"
echo "Next: add the framework to your app; compile bindings/swift/kovanica.swift"
echo "into the same target (module name kovanicaFFI via the bundled modulemap)."