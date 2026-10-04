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
# The three default slices collapse into two libraries: iOS device, and a
# universal macOS (aarch64 + x86_64). That is what xcodebuild requires — see the
# platform_for comment below.
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
STAGE="$TARGET_DIR/xcframework"

# An xcframework is keyed by (platform, variant), and a platform must be ONE
# library. Passing the two Apple-silicon/Intel macOS slices as separate
# -library arguments makes xcodebuild refuse the bundle outright:
#
#   Both 'macos-x86_64' and 'macos-arm64' represent two equivalent library
#   definitions.
#
# Apple's guidance (TN3149, "Creating a multiplatform binary framework bundle")
# is that architectures of the same platform get merged into a single universal
# binary with lipo; only genuinely different platforms — iOS device vs iOS
# simulator vs macOS — stay separate libraries. So group the slices by platform
# and hand xcodebuild exactly one library per platform.
#
# Kept to indexed arrays and `set --` rather than `declare -A`: macOS /bin/bash
# is 3.2, which has no associative arrays.
platform_for() {
  case "$1" in
    *-apple-ios-sim) echo "ios-simulator" ;;
    *-apple-ios)     echo "ios" ;;
    *-apple-darwin)  echo "macos" ;;
    *) echo "unsupported slice: $1 (add a mapping)" >&2; exit 1 ;;
  esac
}

rm -rf "$STAGE"
mkdir -p "$STAGE"

# Pass 1: build each requested slice and record it under its platform.
for triple in $SLICES; do
  rustup target add "$triple"
  cargo build --release --target "$triple" -p kovanica-ffi

  lib="$TARGET_DIR/$triple/release/libkovanica_ffi.a"
  [ -f "$lib" ] || { echo "missing $lib" >&2; exit 1; }

  slice_dir="$STAGE/$(platform_for "$triple")"
  mkdir -p "$slice_dir"
  printf '%s\n' "$lib" >> "$slice_dir/libs"
done

# Pass 2: one universal archive per platform. The glob keeps this
# deterministic, and the loop below reads each recorded path through `set --`
# so a path containing spaces survives.
XCFRAMEWORK_ARGS=()
for slice_dir in "$STAGE"/*/; do
  # The glob leaves a trailing slash on every match; drop it so the paths that
  # end up in the xcframework metadata do not carry a doubled separator.
  slice_dir="${slice_dir%/}"
  merged="$slice_dir/libkovanica_ffi.a"

  set --
  while IFS= read -r lib; do set -- "$@" "$lib"; done < "$slice_dir/libs"
  lipo -create "$@" -output "$merged"

  cp bindings/swift/kovanicaFFI.h bindings/swift/kovanicaFFI.modulemap "$slice_dir/"

  XCFRAMEWORK_ARGS+=( -library "$merged" -headers "$slice_dir" )
done

rm -rf "$OUT"
xcodebuild -create-xcframework "${XCFRAMEWORK_ARGS[@]}" -output "$OUT"

echo
echo "Built $OUT:"
ls "$OUT"
echo "Next: add the framework to your app; compile bindings/swift/kovanica.swift"
echo "into the same target (module name kovanicaFFI via the bundled modulemap)."