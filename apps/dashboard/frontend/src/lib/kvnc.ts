/**
 * Kovanica client-side key handling.
 *
 * SECURITY MODEL — read before touching anything in this file.
 *
 * 1. Private keys live in a JS closure variable and NOTHING ELSE. They are never
 *    written to localStorage, sessionStorage, IndexedDB, cookies, a URL, or the
 *    dashboard backend. `useKeyVault` keeps them in a `useRef` that dies with
 *    the tab.
 * 2. The ONLY permitted egress is a signature computed locally over a sighash
 *    the node produced via POST /api/prepare. Signing is never delegated.
 * 3. An optional encrypted store (AES-GCM, key derived from a passphrase via
 *    PBKDF2) may persist a seed at the operator's explicit opt-in. It is off by
 *    default and stores ciphertext only.
 * 4. Keys are never logged, never placed in error messages, and never included
 *    in a fetch body other than the signed transaction hex itself.
 *
 * Key derivation is NOT implemented here. Every operation below is a thin
 * adapter over `@kovanica/sdk-wasm`, the WASM build of the Rust client core, so
 * the frozen protocol path `m/44'/3007'/0'/0'/i'` (every segment hardened, see
 * protocol AGENTS.md) has exactly one implementation. The SLIP-0010 test
 * vectors in `protocol/testvectors/vectors.json` pin it, and `kvnc.test.ts`
 * replays them against this module on every run.
 *
 * The only primitives still computed in the browser are the AES-GCM envelope
 * for the opt-in encrypted store, which is WebCrypto, not key handling.
 */
import { bytesToHex, hexToBytes, utf8ToBytes } from './hex';
import { requireWasm } from './wasm';

// WebCrypto subtle is async and the WASM key calls are sync; a cached promise
// keeps the sync-looking call sites honest about that without forcing every
// caller to await twice.
const subtle = globalThis.crypto?.subtle;
if (!subtle) {
  throw new Error('WebCrypto unavailable — this surface requires a secure context (HTTPS or localhost).');
}

/** Hardened-only path, matching the Rust core. */
export const KVNC_DERIVATION_PATH = "m/44'/3007'/0'/0'/i'";
export const KVNC_COIN_TYPE = 3007;

const PBKDF2_ITERATIONS = 210_000;

/**
 * In-memory only. Never serialise this.
 *
 * `seed` is the raw BIP-39 material (64 bytes) for a mnemonic wallet, or the
 * 32-byte raw seed for a `from_seed` wallet. `kind` records which derivation
 * applies, because the two are not interchangeable — see `deriveKey`.
 */
export interface KeyVault {
  seed: Uint8Array;
  publicKey: Uint8Array;
  address: string;
  kind: 'mnemonic' | 'raw';
}

/* ------------------------------------------------------------------ *
 * Derivation and address encoding — delegated to the Rust core
 * ------------------------------------------------------------------ */

/**
 * The 32-byte signing key for this vault's index.
 *
 * `raw` keeps `KeyPair::from_seed` semantics: a 32-byte seed IS the signing key
 * and no derivation path applies, so indices are not meaningful. `mnemonic`
 * walks the frozen hardened path inside the core.
 */
function deriveKey(vault: KeyVault, index: number): Uint8Array {
  const { signing_key_from_seed_hex } = requireWasm();
  if (vault.kind === 'raw') {
    if (index !== 0) throw new Error('raw-seed wallets only support index 0');
    return vault.seed;
  }
  const keyHex = signing_key_from_seed_hex(bytesToHex(vault.seed), index);
  return hexToBytes(keyHex);
}

/** `0x00 || pubkey` rendered as a kvnc…dag address. */
export function addressFromPublicKey(pub: Uint8Array): string {
  return requireWasm().address_from_public_key(bytesToHex(pub));
}

/**
 * Accepts a kvnc…dag address or a 64-hex public key; returns the 32-byte
 * public key.
 */
export function parseAddress(addr: string): Uint8Array {
  const { address_to_hex } = requireWasm();
  let versioned: string;
  try {
    versioned = address_to_hex(addr);
  } catch {
    throw new Error('unrecognised address format — expected kvnc…dag or 64-hex public key');
  }
  // `address_to_hex` always yields the 33-byte versioned form (`00 || pubkey`).
  return hexToBytes(versioned.slice(2));
}

/* ------------------------------------------------------------------ *
 * Vault construction
 * ------------------------------------------------------------------ */

function vaultFromSeed(seed: Uint8Array, kind: 'mnemonic' | 'raw', index: number): KeyVault {
  const vault: KeyVault = { seed, publicKey: new Uint8Array(32), address: '', kind };
  const pub = hexToBytes(requireWasm().public_key_from_secret_bytes(bytesToHex(deriveKey(vault, index))));
  vault.publicKey = pub;
  vault.address = addressFromPublicKey(pub);
  return vault;
}

export function createWalletFromMnemonic(mnemonic: string, index = 0): KeyVault {
  const { mnemonic_is_valid, mnemonic_to_seed } = requireWasm();
  if (!mnemonic_is_valid(mnemonic)) {
    throw new Error('invalid BIP-39 mnemonic (checksum or wordlist mismatch)');
  }
  return vaultFromSeed(new Uint8Array(mnemonic_to_seed(mnemonic, '')), 'mnemonic', index);
}

export function createNewMnemonic(strengthBits: 128 | 256 = 128): string {
  return requireWasm().generate_mnemonic(strengthBits === 256 ? 24 : 12);
}

export function walletFromRawSeed(hex: string): KeyVault {
  const seed = hexToBytes(hex.trim());
  if (seed.length !== 32) throw new Error('raw seed must be exactly 32 bytes (64 hex chars)');
  return vaultFromSeed(seed, 'raw', 0);
}

/** The 32-byte signing key for this vault's derived index. */
export function signingKey(vault: KeyVault, index = 0): Uint8Array {
  return deriveKey(vault, index);
}

/** 64-byte Ed25519 signature, hex encoded. This is the only thing that leaves the browser. */
export function signHex(vault: KeyVault, sighashHex: string, index = 0): string {
  const key = deriveKey(vault, index);
  return requireWasm().sign_sighash_with_seed_hex(bytesToHex(key), sighashHex.trim());
}

/** Public keys for a range of derivation indices, for watch-only / multisig views. */
export function deriveAddresses(vault: KeyVault, count: number, from = 0): string[] {
  const out: string[] = [];
  for (let i = from; i < from + count; i++) {
    out.push(addressFromPublicKey(hexToBytes(
      requireWasm().public_key_from_secret_bytes(bytesToHex(deriveKey(vault, i))),
    )));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Optional encrypted at-rest store (explicit opt-in only)
 * ------------------------------------------------------------------ */

const STORE_PREFIX = 'kovanica.vault.v1';

/**
 * TypeScript 5.7 narrowed `Uint8Array` to `Uint8Array<ArrayBufferLike>`, which
 * WebCrypto's `BufferSource` rejects (it wants a non-shared `ArrayBuffer`).
 * Everything crossing into subtle.* passes through here.
 */
function buf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', buf(utf8ToBytes(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: buf(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

interface StoredVault {
  v: 1;
  kind: 'mnemonic' | 'raw';
  salt: string;
  iv: string;
  data: string;
  index: number;
  address: string;
}

/** Persist ONLY ciphertext. Requires an explicit passphrase from the operator. */
export async function saveVaultEncrypted(vault: KeyVault, passphrase: string, index = 0): Promise<void> {
  if (passphrase.length < 10) throw new Error('passphrase must be at least 10 characters');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(vault.seed)));
  const rec: StoredVault = {
    v: 1,
    kind: vault.kind,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    data: bytesToHex(ct),
    index,
    address: vault.address,
  };
  localStorage.setItem(`${STORE_PREFIX}.${index}`, JSON.stringify(rec));
}

export function hasStoredVault(index = 0): boolean {
  return localStorage.getItem(`${STORE_PREFIX}.${index}`) !== null;
}

export async function unlockVault(passphrase: string, index = 0): Promise<KeyVault> {
  const raw = localStorage.getItem(`${STORE_PREFIX}.${index}`);
  if (!raw) throw new Error('no stored vault for this index');
  let rec: StoredVault;
  try {
    rec = JSON.parse(raw);
  } catch {
    throw new Error('stored vault is corrupt');
  }
  if (rec.v !== 1) throw new Error(`unsupported vault version ${rec.v}`);
  const key = await deriveAesKey(passphrase, hexToBytes(rec.salt));
  let seed: Uint8Array;
  try {
    seed = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: buf(hexToBytes(rec.iv)) }, key, buf(hexToBytes(rec.data))));
  } catch {
    // Do not distinguish wrong passphrase from tampering in the message.
    throw new Error('could not unlock vault — wrong passphrase or corrupted data');
  }
  const vault = vaultFromSeed(seed, rec.kind ?? "mnemonic", rec.index);
  if (vault.address !== rec.address) throw new Error('decrypted seed does not match stored address');
  return vault;
}

export function forgetStoredVault(index = 0): void {
  localStorage.removeItem(`${STORE_PREFIX}.${index}`);
}
