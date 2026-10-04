// Shared golden-vector consumer for the browser extension.
//
// The canonical file is `protocol/testvectors/vectors.json`, generated from the
// Rust core. The extension delegates every key operation to the shared
// `@kovanica/sdk-wasm` module (see `src/utils/seedPhrase.ts`), so it must
// reproduce the derivation vectors byte-for-byte. The vector file only stores
// the empty-passphrase address, so the passphrase case is checked through the
// public key it pins.
//
// Run: npm test
// Needs a built wasm package first:
//   (cd ../../sdk/bindings/kovanica-wasm && wasm-pack build --target web --out-dir pkg)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import * as wasmModule from "@kovanica/sdk-wasm";
import { deriveAddress, derivePublicKey, mnemonicIsValid } from "../src/utils/seedPhrase.ts";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

// Node has no fetched asset path, so initialise from disk before the first call.
const wasmBytes = await readFile(
  new URL("../../../sdk/bindings/kovanica-wasm/pkg/kovanica_wasm_bg.wasm", import.meta.url),
);
globalThis.__kovanicaWasmInit = () => wasmModule.initSync({ module: wasmBytes });

const vectors = JSON.parse(await read("../../../protocol/testvectors/vectors.json"));
const derivations = vectors.vectors.filter((v) => v.kind === "derivation");

test("shared vectors: the file has derivation cases to check", () => {
  assert.ok(derivations.length > 0, "no derivation vectors to check");
});

for (const v of derivations) {
  test(`shared vectors: ${v.name} derives the pinned public key`, async () => {
    assert.equal(await derivePublicKey(v.mnemonic, v.passphrase, v.index), v.pubkey_hex);
  });

  if (v.passphrase === "") {
    test(`shared vectors: ${v.name} derives the pinned address`, async () => {
      assert.equal(await mnemonicIsValid(v.mnemonic), true);
      assert.equal(await deriveAddress(v.mnemonic, v.index), v.address);
    });
  }
}
