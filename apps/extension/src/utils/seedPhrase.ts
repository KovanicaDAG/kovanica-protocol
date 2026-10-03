import { ensureWasmReady, wasm } from "./wasm";

/**
 * Recovery-phrase and key helpers for the extension.
 *
 * Everything cryptographic is delegated to the shared `@kovanica/sdk-wasm`
 * module (which wraps the published `kovanica-sdk` crates) so the extension
 * derives the exact same keys as the web wallet, the CLI and the node-side
 * Rust implementation.
 */

/** A fresh English BIP-39 recovery phrase. Defaults to 24 words. */
export async function generateMnemonic(wordCount: 12 | 24 = 24): Promise<string> {
  await ensureWasmReady();
  return wasm.generate_mnemonic(wordCount);
}

/** The setup screen renders the phrase one word per cell. */
export async function generateSeedPhrase(): Promise<string[]> {
  return (await generateMnemonic(24)).split(" ");
}

/** Normalise whitespace/case the way the phrase checkers do. */
export async function normalizeMnemonic(phrase: string): Promise<string> {
  await ensureWasmReady();
  return wasm.normalize_mnemonic(phrase);
}

/** True when the phrase is a well-formed BIP-39 mnemonic (checksum included). */
export async function mnemonicIsValid(phrase: string): Promise<boolean> {
  await ensureWasmReady();
  return wasm.mnemonic_is_valid(phrase);
}

/**
 * Public key (32 bytes, 64 hex chars) at `m/44'/3007'/0'/0'/index'`.
 * This is the wallet's address material, not secret data.
 */
export async function derivePublicKey(
  mnemonic: string,
  passphrase = "",
  index = 0,
): Promise<string> {
  await ensureWasmReady();
  return wasm.public_key_from_mnemonic(mnemonic, passphrase, index);
}

/** `kvnc1…` address at `m/44'/3007'/0'/0'/index'`. */
export async function deriveAddress(mnemonic: string, index = 0): Promise<string> {
  await ensureWasmReady();
  return wasm.address_from_mnemonic(mnemonic, index);
}
