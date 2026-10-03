// Shared golden-vector consumer for the browser extension.
//
// The canonical file is `protocol/testvectors/vectors.json`, generated from the
// Rust core. Every implementation is supposed to reproduce its derivation
// vectors byte-for-byte. The extension currently has **no** BIP-39/SLIP-0010
// implementation at all: `src/utils/seedPhrase.ts` builds a cosmetic 24-word
// list by interleaving random English and Croatian words. That is not a valid
// BIP-39 mnemonic (no checksum, and Croatian is not a BIP-39 wordlist), so this
// test can only check wordlist coverage and record the gap as `todo` rather
// than fake a pass.
//
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const vectors = JSON.parse(read("../../../protocol/testvectors/vectors.json"));
const enWords = new Set(
  read("../src/bip39_en.txt")
    .split("\n")
    .map((w) => w.trim())
    .filter(Boolean),
);

const derivations = vectors.vectors.filter((v) => v.kind === "derivation");

test("shared vectors: every mnemonic word is in the shipped English wordlist", () => {
  assert.ok(derivations.length > 0, "no derivation vectors to check");
  for (const v of derivations) {
    for (const word of v.mnemonic.split(" ")) {
      assert.ok(enWords.has(word), `${v.name}: "${word}" missing from bip39_en.txt`);
    }
  }
});

// The extension does not implement the frozen path, so it cannot be checked
// against the shared vectors. This is a finding for the Phase 2 report, not
// something this test should paper over.
test.todo("extension derives the shared vectors via the frozen SLIP-0010 path");
