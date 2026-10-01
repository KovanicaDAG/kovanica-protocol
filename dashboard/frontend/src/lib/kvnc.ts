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
 * Key derivation matches the frozen protocol path `m/44'/3007'/0'/0'/i'` with
 * every segment hardened (see protocol AGENTS.md). Do not change this: the
 * SLIP-0010 test vectors pin it, and a second derivation implementation is a
 * standing instruction violation.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { wordlist as english } from '@scure/bip39/wordlists/english';
import { mnemonicToSeedSync, generateMnemonic, validateMnemonic } from '@scure/bip39';

// WebCrypto subtle is async and the noble sync API is not; a cached promise
// keeps the sync-looking call sites honest about that without forcing every
// caller to await twice.
const subtle = globalThis.crypto?.subtle;
if (!subtle) {
  throw new Error('WebCrypto unavailable — this surface requires a secure context (HTTPS or localhost).');
}

/** Hardened-only path, matching protocol crates/kovanica-wallet. */
export const KVNC_DERIVATION_PATH = "m/44'/3007'/0'/0'/i'";
export const KVNC_COIN_TYPE = 3007;

const HARDENED = 0x80000000;

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
 * SLIP-0010 ed25519 derivation (frozen path)
 *
 * Mirrors crates/kovanica-wallet/src/slip10.rs exactly:
 *   master:  I = HMAC-SHA512(key = "ed25519 seed", data = material)
 *   child:   I = HMAC-SHA512(key = chain_code, data = 0x00 || key || ser32(i))
 * where key = I[..32] and chain_code = I[32..]. The chain code — NOT the key —
 * is the child's HMAC key, and the child key is I[..32] verbatim (no "+ k mod n",
 * because an ed25519 secret is a byte string, not a scalar multiple).
 * ------------------------------------------------------------------ */

function hmacSha512(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha512, key, data);
}

/** Generic hardened-only SLIP-0010 walk. */
function slip10Path(material: Uint8Array, path: number[]): Uint8Array {
  let I = hmacSha512(utf8ToBytes('ed25519 seed'), material);
  let key = I.slice(0, 32);
  let chain = I.slice(32, 64);
  for (const segment of path) {
    const index = (segment | HARDENED) >>> 0;
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0x00;
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, index, false);
    I = hmacSha512(chain, data);
    key = I.slice(0, 32);
    chain = I.slice(32, 64);
  }
  return key;
}

/** The frozen Kovanica path. Requires 64-byte BIP-39 material. */
function deriveKey(vault: KeyVault, index: number): Uint8Array {
  if (vault.kind === 'raw') {
    // `KeyPair::from_seed` semantics: a 32-byte seed IS the signing key, and no
    // derivation path applies. Indices are therefore not meaningful here.
    if (index !== 0) throw new Error('raw-seed wallets only support index 0');
    return vault.seed;
  }
  return slip10Path(vault.seed, [44, KVNC_COIN_TYPE, 0, 0, index]);
}

/* ------------------------------------------------------------------ *
 * Address encoding — 0x00 || ed25519_pk, base58-wrapped as kvnc…dag
 * ------------------------------------------------------------------ */

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
  return out;
}

function base58Decode(str: string): Uint8Array {
  let zeros = 0;
  while (zeros < str.length && str[zeros] === '1') zeros++;
  const bytes: number[] = [];
  for (let i = zeros; i < str.length; i++) {
    const val = B58_ALPHABET.indexOf(str[i]);
    if (val < 0) throw new Error('invalid base58 character');
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i];
  return out;
}

/** `0x00 || pubkey` rendered as a kvnc…dag address. */
export function addressFromPublicKey(pub: Uint8Array): string {
  const payload = new Uint8Array(33);
  payload[0] = 0x00; // P2PK
  payload.set(pub, 1);
  return `kvnc${base58Encode(payload)}dag`;
}

/** Accepts a kvnc…dag address or a 64-hex public key. */
export function parseAddress(addr: string): Uint8Array {
  const a = addr.trim();
  if (/^[0-9a-fA-F]{64}$/.test(a)) return hexToBytes(a);
  if (a.startsWith('kvnc') && a.endsWith('dag')) {
    const raw = base58Decode(a.slice(4, -3));
    if (raw.length !== 33) throw new Error('malformed kvnc address');
    return raw.slice(1);
  }
  throw new Error('unrecognised address format — expected kvnc…dag or 64-hex public key');
}

/* ------------------------------------------------------------------ *
 * Vault construction
 * ------------------------------------------------------------------ */

function vaultFromSeed(seed: Uint8Array, kind: 'mnemonic' | 'raw', index: number): KeyVault {
  const vault: KeyVault = { seed, publicKey: new Uint8Array(32), address: '', kind };
  const sk = deriveKey(vault, index);
  const pub = ed25519.getPublicKey(sk);
  vault.publicKey = pub;
  vault.address = addressFromPublicKey(pub);
  return vault;
}

export function createWalletFromMnemonic(mnemonic: string, index = 0): KeyVault {
  if (!validateMnemonic(mnemonic, english)) {
    throw new Error('invalid BIP-39 mnemonic (checksum or wordlist mismatch)');
  }
  return vaultFromSeed(mnemonicToSeedSync(mnemonic), 'mnemonic', index);
}

export function createNewMnemonic(strengthBits: 128 | 256 = 128): string {
  return generateMnemonic(english, strengthBits);
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
  return bytesToHex(ed25519.sign(hexToBytes(sighashHex.trim()), signingKey(vault, index)));
}

/** Public keys for a range of derivation indices, for watch-only / multisig views. */
export function deriveAddresses(vault: KeyVault, count: number, from = 0): string[] {
  const out: string[] = [];
  for (let i = from; i < from + count; i++) {
    out.push(addressFromPublicKey(ed25519.getPublicKey(deriveKey(vault, i))));
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
