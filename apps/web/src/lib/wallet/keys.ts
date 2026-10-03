import { ensureWasmReady, wasm } from "./wasm";

export { loadWordlist } from "./bip39";

/**
 * Wallet key / derivation facade.
 *
 * Every cryptographic operation is delegated to the Rust `kovanica-sdk` wasm
 * package (`@kovanica/sdk-wasm`); this module is the async surface the React
 * app already calls and adds no crypto of its own. That keeps the browser, the
 * extension and the node on one implementation of the frozen SLIP-0010 path
 * `m/44'/3007'/0'/0'/index'` and the same BIP-39 / Ed25519 rules.
 *
 * All functions except {@link normalizeMnemonic} are async: the wasm module is
 * initialised on first use (see `./wasm`).
 */

/** Account index must fit the hardened-only SLIP-0010 child range. */
const MAX_ACCOUNT_INDEX = 0x80000000;

function assertAccountIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_ACCOUNT_INDEX) {
    throw new Error("account index out of range");
  }
}

/** Lowercase / NFKD-normalise / collapse whitespace, without touching crypto. */
export function normalizeMnemonic(phrase: string): string {
  return phrase.normalize("NFKD").trim().toLowerCase().split(/\s+/).join(" ");
}

/**
 * English BIP-39 mnemonic from caller-supplied entropy (16 or 32 bytes). The
 * checksum is computed by the Rust `bip39` crate, so the wordlist is always the
 * canonical one.
 */
export async function entropyToMnemonic(entropy: Uint8Array): Promise<string> {
  await ensureWasmReady();
  return wasm.entropy_to_mnemonic(entropy);
}

/** Generate a fresh recovery phrase. Default 24 words. */
export async function createMnemonic(wordCount: 12 | 24 = 24): Promise<string> {
  await ensureWasmReady();
  return wasm.generate_mnemonic(wordCount);
}

/** 64-byte BIP-39 seed (PBKDF2-HMAC-SHA512). Optional passphrase = 25th word. */
export async function mnemonicToSeed(mnemonic: string, passphrase = ""): Promise<Uint8Array> {
  await ensureWasmReady();
  return wasm.mnemonic_to_seed(mnemonic, passphrase);
}

/**
 * 32-byte Ed25519 signing seed at `m/44'/3007'/0'/0'/index'`. This is secret
 * material — never log or transmit it.
 */
export async function seedFromMnemonic(mnemonic: string, index = 0): Promise<Uint8Array> {
  await ensureWasmReady();
  assertAccountIndex(index);
  return wasm.seed_from_mnemonic(mnemonic, "", index);
}

/**
 * Public key (64 hex chars) at `m/44'/3007'/0'/0'/index'`. This is the value
 * the wallet shows and matches `v.pubkey_hex` in `protocol/testvectors`.
 */
export async function addressFromMnemonic(mnemonic: string, index = 0): Promise<string> {
  await ensureWasmReady();
  assertAccountIndex(index);
  return wasm.public_key_from_mnemonic(mnemonic, "", index);
}

/** Sign a prepare sighash (hex) with the key at `index`; returns 128 hex chars. */
export async function signSighash(
  mnemonic: string,
  index: number,
  sighashHex: string,
): Promise<string> {
  await ensureWasmReady();
  assertAccountIndex(index);
  return wasm.sign_sighash(mnemonic, "", index, sighashHex);
}

/** Sign a prepare sighash with a raw 32-byte Ed25519 seed (64 hex chars). */
export async function signSighashWithSeedHex(
  seedHex: string,
  sighashHex: string,
): Promise<string> {
  await ensureWasmReady();
  return wasm.sign_sighash_with_seed_hex(seedHex, sighashHex);
}

/**
 * Validate and normalise an imported BIP-39 phrase: word count, wordlist
 * membership (so a typo gets its own message) and — via the Rust `bip39` crate
 * — the checksum. Rejects anything the node would reject.
 */
export async function importMnemonic(phrase: string): Promise<string> {
  await ensureWasmReady();
  const normalized = wasm.normalize_mnemonic(phrase);
  const words = normalized.length > 0 ? normalized.split(" ") : [];
  if (words.length !== 12 && words.length !== 24) {
    throw new Error("Your recovery phrase needs 12 or 24 words.");
  }
  const unknown = wasm.mnemonic_unknown_words(normalized);
  if (unknown.length > 0) {
    throw new Error(`"${unknown[0]}" isn't a recovery word — check for a typo.`);
  }
  if (!wasm.mnemonic_is_valid(normalized)) {
    throw new Error(
      "That recovery phrase doesn't look valid — please check for a typo or a wrong word.",
    );
  }
  return normalized;
}
