import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import * as wasmModule from "@kovanica/sdk-wasm";

// The browser build relies on the global WebCrypto object; Node <19 keeps it
// behind node:crypto. Polyfill before any wallet/keys code runs (it only uses
// crypto inside functions, so import order is safe).
if (!globalThis.crypto) (globalThis as Record<string, unknown>).crypto = webcrypto;

// The wallet layer is Rust wasm now. Under `node --test` there is no `fetch`
// for a `file:` URL, so hand the module its bytes synchronously before the
// first wallet call. The browser path uses the generated async `init()`
// instead — see apps/web/src/lib/wallet/wasm.ts.
const wasmBytes = await readFile(
  new URL("../../../sdk/bindings/kovanica-wasm/pkg/kovanica_wasm_bg.wasm", import.meta.url),
);
(globalThis as { __kovanicaWasmInit?: () => void }).__kovanicaWasmInit = () => {
  wasmModule.initSync({ module: wasmBytes });
};

import {
  addressFromMnemonic,
  createMnemonic,
  entropyToMnemonic,
  importMnemonic,
  mnemonicToSeed,
} from "../src/lib/wallet/keys";
import { hexToKvnc } from "../src/lib/wallet/address";

const W = "abandon";
const M12 = [W, W, W, W, W, W, W, W, W, W, W, "about"].join(" ");
const M24 = [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, "art"].join(" ");

test("BIP-39: zero 128-bit entropy maps to the 12-word 'abandon … about' vector", async () => {
  const mnemonic = await entropyToMnemonic(new Uint8Array(16));
  assert.equal(mnemonic, M12);
  assert.equal(mnemonic.split(" ").length, 12);
});

test("BIP-39: zero 256-bit entropy maps to the 24-word 'abandon … art' vector", async () => {
  const mnemonic = await entropyToMnemonic(new Uint8Array(32));
  assert.equal(mnemonic, M24);
  assert.equal(mnemonic.split(" ").length, 24);
});

test("BIP-39: 64-byte PBKDF2 output prefixes match the canonical vector", async () => {
  const derived = await mnemonicToSeed(M12);
  assert.equal(derived.length, 64);
  const first16 = Buffer.from(derived.subarray(0, 16)).toString("hex");
  assert.equal(first16, "5eb00bbddcf069084889a8ab91555681");
});

test("importMnemonic: accepts valid 12- and 24-word phrases", async () => {
  assert.equal(await importMnemonic(M12), M12);
  assert.equal(await importMnemonic(M24), M24);
  // Case / whitespace tolerance.
  assert.equal(await importMnemonic(`  ${M12.toUpperCase()} `), M12);
});

test("importMnemonic: rejects a phrase with a bad checksum (12x abandon)", async () => {
  await assert.rejects(
    importMnemonic([W, W, W, W, W, W, W, W, W, W, W, W].join(" ")),
    /doesn't look valid/,
  );
});

test("importMnemonic: rejects a single swapped word (checksum breaks)", async () => {
  // The last word of the valid vector carries 4 checksum bits - "about" to "zoo"
  // keeps the wordlist membership but breaks the checksum.
  await assert.rejects(
    importMnemonic([W, W, W, W, W, W, W, W, W, W, W, "zoo"].join(" ")),
    /doesn't look valid/,
  );
});

test("importMnemonic: rejects an unknown word with a typo hint", async () => {
  await assert.rejects(
    importMnemonic([W, W, W, W, W, W, W, W, W, W, W, "aboutt"].join(" ")),
    /typo/,
  );
});

test("createMnemonic: default is 24 words, accepts 12; both round-trip via importMnemonic", async () => {
  const m24 = await createMnemonic();
  assert.equal(m24.split(" ").length, 24);
  assert.equal(await importMnemonic(m24), m24);
  const m12 = await createMnemonic(12);
  assert.equal(m12.split(" ").length, 12);
  assert.equal(await importMnemonic(m12), m12);
});

// ---------------------------------------------------------------------------
// SLIP-0010 derivation addresses: m/44'/3007'/0'/0'/i'. These are PUBLIC keys
// (wallet addresses), not secret material. The constants were produced by an
// independent node:crypto implementation and must match the Rust-side frozen
// vectors in docs/backlog/DERIVATION.md once that branch lands.
// ---------------------------------------------------------------------------
const EXPECTED_ADDRESSES_12W = {
  0: "862f70cfafc9b581699f8d67598eac699cbc92bdfc940e95ed7ee1e8d8100e7e",
  1: "c7add211265d1232a2bbc1dc7b01437d17d852f235eb7d09f6fe21b5f313f485",
  2: "cbe43a9458cdc916f7c21daf20cde2847a22ce07d6f64cb4c50f97d81ea4ec72",
} as const;

const EXPECTED_ADDRESSES_24W = {
  0: "56bfc981276ac7a3fb247b5e96bfc1ff9bb4e1b60a95c5df60e8b66a9984fd6f",
  1: "035dc99f7c861f734a09aef949c801d1d12a5a44149ea0b1abb42b9fee449a5f",
  2: "8c3fa2f9ab0d54b5d7bc60fa3184d9519d1b3a8c01663dbb3f84b2141deef719",
} as const;

for (const index of [0, 1, 2] as const) {
  test(`SLIP-0010 m/44'/3007'/0'/0'/${index}': 12-word phrase derives the frozen address`, async () => {
    assert.equal(await addressFromMnemonic(M12, index), EXPECTED_ADDRESSES_12W[index]);
  });

  test(`SLIP-0010 m/44'/3007'/0'/0'/${index}': 24-word phrase derives the frozen address`, async () => {
    assert.equal(await addressFromMnemonic(M24, index), EXPECTED_ADDRESSES_24W[index]);
  });
}

test("SLIP-0010: account index bounds are enforced", async () => {
  await assert.rejects(Promise.resolve(addressFromMnemonic(M12, -1)), /out of range/);
  await assert.rejects(Promise.resolve(addressFromMnemonic(M12, 0x80000000)), /out of range/);
});

// ---------------------------------------------------------------------------
// Shared golden vectors: protocol/testvectors/vectors.json, generated from the
// Rust implementation. The web must reproduce every empty-passphrase derivation
// vector byte-for-byte; a mismatch is a finding, not something to "fix" by
// editing the vector.
// ---------------------------------------------------------------------------
interface SharedVector {
  kind: string;
  name: string;
  mnemonic: string;
  passphrase: string;
  index: number;
  pubkey_hex: string;
  address: string;
}

const sharedVectors = JSON.parse(
  await readFile(
    new URL("../../../protocol/testvectors/vectors.json", import.meta.url),
    "utf8",
  ),
) as { vectors: SharedVector[] };

// The web `addressFromMnemonic` has no passphrase argument, so only the
// empty-passphrase cases apply here (the passphrase case is covered by Rust).
const webDerivationVectors = sharedVectors.vectors.filter(
  (v) => v.kind === "derivation" && v.passphrase === "",
);

test("shared vectors: the file has derivation cases to check", () => {
  assert.ok(webDerivationVectors.length > 0);
});

for (const v of webDerivationVectors) {
  test(`shared vectors: ${v.name} derives the pinned pubkey/address`, async () => {
    const pub = await addressFromMnemonic(v.mnemonic, v.index);
    assert.equal(pub, v.pubkey_hex);
    assert.equal(hexToKvnc(pub), v.address);
  });
}
