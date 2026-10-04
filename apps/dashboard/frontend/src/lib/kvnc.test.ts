/**
 * Coverage for the dashboard key handling, which is a thin adapter over
 * @kovanica/sdk-wasm (see docs/unify/DECISIONS.md #16).
 *
 * These are the shared golden vectors in protocol/testvectors/vectors.json,
 * generated from the Rust implementation. They pin the frozen derivation path
 * and the kvnc…dag address encoding, so any drift in kvnc.ts fails here first.
 *
 * Verification of signatures also goes through the core
 * (`wasm.verify_signature`), which uses the node's strict rules, so the test no
 * longer needs a second Ed25519 implementation to check itself.
 */
import { describe, expect, test } from "vitest";
import { bytesToHex } from "./hex";
import { wasm } from "./wasm";

import vectorsFile from "../../../../../protocol/testvectors/vectors.json";
import {
  KVNC_COIN_TYPE,
  KVNC_DERIVATION_PATH,
  addressFromPublicKey,
  createWalletFromMnemonic,
  deriveAddresses,
  parseAddress,
  signHex,
  signingKey,
  walletFromRawSeed,
} from "./kvnc";

interface DerivationVector {
  kind: string;
  name: string;
  mnemonic: string;
  passphrase: string;
  index: number;
  pubkey_hex: string;
  address: string;
}

const derivationVectors = (vectorsFile.vectors as DerivationVector[]).filter(
  (v) => v.kind === "derivation",
);

// `createWalletFromMnemonic` takes no passphrase argument, so only the
// empty-passphrase vectors are in scope here. The passphrase case is covered by
// the Rust, wasm and iOS suites.
const inScope = derivationVectors.filter((v) => v.passphrase === "");

test("the vector file carries derivation cases", () => {
  expect(derivationVectors.length).toBeGreaterThan(0);
  expect(inScope.length).toBeGreaterThan(0);
});

test("frozen path constants match the protocol spec", () => {
  expect(KVNC_COIN_TYPE).toBe(3007);
  expect(KVNC_DERIVATION_PATH).toBe("m/44'/3007'/0'/0'/i'");
});

describe.each(inScope)("$name", (v) => {
  test("derives the pinned public key and kvnc…dag address", () => {
    const vault = createWalletFromMnemonic(v.mnemonic, v.index);
    expect(bytesToHex(vault.publicKey)).toBe(v.pubkey_hex);
    expect(vault.address).toBe(v.address);
  });

  test("the address round-trips back to the public key", () => {
    const vault = createWalletFromMnemonic(v.mnemonic, v.index);
    expect(bytesToHex(parseAddress(vault.address))).toBe(v.pubkey_hex);
    // The 64-hex form is accepted too.
    expect(bytesToHex(parseAddress(v.pubkey_hex))).toBe(v.pubkey_hex);
  });

  test("addressFromPublicKey matches the vector address", () => {
    const vault = createWalletFromMnemonic(v.mnemonic, v.index);
    expect(addressFromPublicKey(vault.publicKey)).toBe(v.address);
  });
});

test("signing a sighash verifies against the derived public key", () => {
  const v = inScope[0];
  const vault = createWalletFromMnemonic(v.mnemonic, v.index);
  const sighash = "ab".repeat(32);
  const signature = signHex(vault, sighash);
  expect(signature).toMatch(/^[0-9a-f]{128}$/);
  expect(wasm.verify_signature(bytesToHex(vault.publicKey), sighash, signature)).toBe(true);
});

test("account indices are independent and stable", () => {
  const v = inScope[0];
  const first = createWalletFromMnemonic(v.mnemonic, 0);
  const second = createWalletFromMnemonic(v.mnemonic, 1);
  expect(bytesToHex(first.publicKey)).not.toBe(bytesToHex(second.publicKey));
  expect(bytesToHex(createWalletFromMnemonic(v.mnemonic, 0).publicKey)).toBe(
    bytesToHex(first.publicKey),
  );
});

test("deriveAddresses returns the sequential account addresses", () => {
  const zero12 = derivationVectors.find((v) => v.name === "en-12-zero-i0");
  expect(zero12).toBeDefined();
  if (!zero12) return;
  const vault = createWalletFromMnemonic(zero12.mnemonic, 0);
  const expected = [0, 1, 2].map(
    (i) => derivationVectors.find((v) => v.name === `en-12-zero-i${i}`)!.address,
  );
  expect(deriveAddresses(vault, 3)).toEqual(expected);
});

test("raw-seed vaults use the seed directly and only at index 0", () => {
  const materialHex = "00".repeat(32);
  const vault = walletFromRawSeed(materialHex);
  expect(bytesToHex(vault.publicKey)).toBe(wasm.public_key_from_secret_bytes(materialHex));
  expect(bytesToHex(signingKey(vault, 0))).toBe(materialHex);
  expect(() => signingKey(vault, 1)).toThrow(/index 0/);
});

test("malformed addresses are rejected", () => {
  // One message for every rejected form now that parsing is the core's job:
  // a bad prefix and a bad base58 body are the same failure.
  expect(() => parseAddress("not-an-address")).toThrow(/unrecognised|malformed/);
  expect(() => parseAddress("kvnc1111dag")).toThrow(/unrecognised|malformed/);
});
