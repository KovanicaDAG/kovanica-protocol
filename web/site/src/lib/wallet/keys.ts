import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { loadWordlist } from "./bip39";

ed.hashes.sha512 = sha512;

export { loadWordlist } from "./bip39";

/** Copy into a plain ArrayBuffer-backed Uint8Array for WebCrypto BufferSource. */
function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

/**
 * BIP-39 mnemonic from entropy. The checksum is the first ENT/32 bits of
 * SHA-256(entropy) — 4 bits for 128-bit entropy (12 words), 8 bits for
 * 256-bit entropy (24 words) — NOT a byte-sum of the entropy.
 */
export async function entropyToMnemonic(entropy: Uint8Array, words: string[]): Promise<string> {
  if (entropy.length !== 16 && entropy.length !== 32) {
    throw new Error("entropy must be 16 or 32 bytes");
  }
  const bits: number[] = [];
  for (const b of entropy) for (let i = 7; i >= 0; i -= 1) bits.push((b >> i) & 1);
  const checksumBits = (entropy.length * 8) / 32;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", asBufferSource(entropy)));
  for (let i = 0; i < checksumBits; i += 1) bits.push((hash[i >> 3] >> (7 - (i & 7))) & 1);
  const out: string[] = [];
  for (let i = 0; i < bits.length; i += 11) {
    let v = 0;
    for (let j = 0; j < 11; j += 1) v = (v << 1) | (bits[i + j] ?? 0);
    out.push(words[v]);
  }
  return out.join(" ");
}

/** Generate a fresh recovery phrase. Default 24 words to match the Rust `Wallet::generate_with_mnemonic`. */
export async function createMnemonic(wordCount: 12 | 24 = 24): Promise<string> {
  const words = await loadWordlist();
  const entropy = crypto.getRandomValues(new Uint8Array(wordCount === 24 ? 32 : 16));
  return entropyToMnemonic(entropy, words);
}

export async function mnemonicToSeed(mnemonic: string, passphrase = ""): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(mnemonic.normalize("NFKD")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  // BIP-39: salt is "mnemonic" + optional passphrase (empty by default).
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(`mnemonic${passphrase}`),
      iterations: 2048,
      hash: "SHA-512",
    },
    key,
    512,
  );
  return new Uint8Array(bits);
}

export function normalizeMnemonic(phrase: string): string {
  return phrase.normalize("NFKD").trim().toLowerCase().split(/\s+/).join(" ");
}

const SLIP10_MASTER_KEY = "ed25519 seed";
const HARDENED = 0x80000000;

async function hmacSha512(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    asBufferSource(keyBytes),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, asBufferSource(data)));
}

/**
 * SLIP-0010 hardened ed25519 derivation.
 * Master: I = HMAC-SHA512(key = "ed25519 seed", data = 64-byte seed) —
 * here the seed is the 64-byte BIP-39 PBKDF2 seed. IL = master key,
 * IR = chain code.
 * Child (hardened i): data = 0x00 || key(32B) || ser32(i | 0x80000000);
 * I = HMAC-SHA512(key = chain code, data); new key = IL, new chain code = IR.
 */
async function deriveSlip10Ed25519(
  seed64: Uint8Array,
  path: readonly number[],
): Promise<Uint8Array> {
  let I = await hmacSha512(utf8ToBytes(SLIP10_MASTER_KEY), seed64);
  let key = I.subarray(0, 32);
  let chainCode = I.subarray(32);
  for (const segment of path) {
    const index = (segment | HARDENED) >>> 0;
    const data = new Uint8Array(37);
    data[0] = 0x00;
    data.set(key, 1);
    data[33] = (index >>> 24) & 0xff;
    data[34] = (index >>> 16) & 0xff;
    data[35] = (index >>> 8) & 0xff;
    data[36] = index & 0xff;
    I = await hmacSha512(chainCode, data);
    key = I.subarray(0, 32);
    chainCode = I.subarray(32);
  }
  return new Uint8Array(key);
}

/**
 * Derive the per-account Ed25519 seed from a BIP-39 mnemonic using
 * SLIP-0010 hardened derivation at m/44'/3007'/0'/0'/index'.
 * All segments are hardened — ed25519 has no non-hardened children.
 */
export async function seedFromMnemonic(mnemonic: string, index = 0): Promise<Uint8Array> {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED) {
    throw new Error("account index out of range");
  }
  const seed64 = await mnemonicToSeed(normalizeMnemonic(mnemonic));
  return deriveSlip10Ed25519(seed64, [44, 3007, 0, 0, index]);
}

export async function addressFromMnemonic(mnemonic: string, index = 0): Promise<string> {
  return bytesToHex(ed.getPublicKey(await seedFromMnemonic(mnemonic, index)));
}

export async function signSighash(
  mnemonic: string,
  index: number,
  sighashHex: string,
): Promise<string> {
  const hex = sighashHex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) throw new Error("bad sighash");
  const sig = ed.sign(hexToBytes(hex), await seedFromMnemonic(mnemonic, index));
  return bytesToHex(sig);
}

/** Sign prepare sighash with a raw 32-byte Ed25519 seed (64 hex). */
export async function signSighashWithSeedHex(seedHex: string, sighashHex: string): Promise<string> {
  const seed = seedHex.trim().toLowerCase();
  const hex = sighashHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(seed)) throw new Error("seed must be 64-char hex (32 bytes)");
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) throw new Error("bad sighash");
  const sig = ed.sign(hexToBytes(hex), hexToBytes(seed));
  return bytesToHex(sig);
}

/**
 * Validate and normalize an imported BIP-39 phrase: word count, wordlist
 * membership, and — critically — the checksum (recomputed from the words'
 * entropy via SHA-256). Rejects phrases the Rust `bip39` crate would reject.
 */
export async function importMnemonic(phrase: string): Promise<string> {
  const words = normalizeMnemonic(phrase).split(" ");
  if (words.length !== 12 && words.length !== 24) {
    throw new Error("Your recovery phrase needs 12 or 24 words.");
  }
  const list = await loadWordlist();
  const wordIndex = new Map(list.map((w, i) => [w, i] as const));
  const indices: number[] = [];
  for (const w of words) {
    const i = wordIndex.get(w);
    if (i === undefined) {
      throw new Error(`"${w}" isn't a recovery word — check for a typo.`);
    }
    indices.push(i);
  }
  // words -> bitstream -> entropy + checksum bits
  const totalBits = words.length * 11;
  const entropyBits = (totalBits / 33) * 32; // 128 or 256
  const checksumBits = totalBits - entropyBits; // 4 or 8
  const bits: number[] = [];
  for (const i of indices) for (let b = 10; b >= 0; b -= 1) bits.push((i >> b) & 1);
  const entropy = new Uint8Array(entropyBits / 8);
  for (let i = 0; i < entropyBits; i += 1) {
    if (bits[i] === 1) entropy[i >> 3] |= 0x80 >> (i & 7);
  }
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", asBufferSource(entropy)));
  for (let i = 0; i < checksumBits; i += 1) {
    const expected = (hash[i >> 3] >> (7 - (i & 7))) & 1;
    if (bits[entropyBits + i] !== expected) {
      throw new Error(
        "That recovery phrase doesn't look valid — please check for a typo or a wrong word.",
      );
    }
  }
  return words.join(" ");
}

export async function keysFromSeed32(seed32: Uint8Array) {
  const pkcs8 = ed25519Pkcs8(asBufferSource(seed32));
  const priv = await crypto.subtle.importKey(
    "pkcs8",
    asBufferSource(pkcs8),
    { name: "Ed25519" },
    true,
    ["sign"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", priv);
  const rawPriv = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, true, ["sign"]);
  const pubJwk = { kty: "OKP", crv: "Ed25519", x: jwk.x };
  const pub = await crypto.subtle.importKey("jwk", pubJwk, { name: "Ed25519" }, true, ["verify"]);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pub));
  return {
    jwk,
    address: bytesToHex(pubRaw),
    _priv: rawPriv,
  };
}

function ed25519Pkcs8(seed32: Uint8Array): Uint8Array {
  const p = [
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ];
  const out = new Uint8Array(p.length + 32);
  out.set(p, 0);
  out.set(seed32, p.length);
  return out;
}
