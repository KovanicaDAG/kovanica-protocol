import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { loadWordlist } from "./bip39";

ed.hashes.sha512 = sha512;

const DOMAIN = "kovanica-wallet-v2";

export { loadWordlist } from "./bip39";

/** Copy into a plain ArrayBuffer-backed Uint8Array for WebCrypto BufferSource. */
function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

function entropyToMnemonic(entropy: Uint8Array, words: string[]): string {
  const bits: number[] = [];
  for (const b of entropy) for (let i = 7; i >= 0; i -= 1) bits.push((b >> i) & 1);
  const cs = (entropy.length * 8) / 32;
  let sum = 0;
  for (const b of entropy) sum = (sum + b) & 0xff;
  for (let i = 7; i >= 8 - cs; i -= 1) bits.push((sum >> i) & 1);
  const out: string[] = [];
  for (let i = 0; i < bits.length; i += 11) {
    let v = 0;
    for (let j = 0; j < 11; j += 1) v = (v << 1) | (bits[i + j] ?? 0);
    out.push(words[v % words.length]);
  }
  return out.join(" ");
}

export async function createMnemonic(): Promise<string> {
  const words = await loadWordlist();
  const entropy = crypto.getRandomValues(new Uint8Array(16));
  return entropyToMnemonic(entropy, words);
}

export async function mnemonicToSeed(mnemonic: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(mnemonic.normalize("NFKD")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode("mnemonic"), iterations: 2048, hash: "SHA-512" },
    key,
    512,
  );
  return new Uint8Array(bits);
}

export function normalizeMnemonic(phrase: string): string {
  return phrase.normalize("NFKD").trim().toLowerCase().split(/\s+/).join(" ");
}

export function seedFromMnemonic(mnemonic: string, index = 0): Uint8Array {
  return sha256(utf8ToBytes(`${normalizeMnemonic(mnemonic)}|${index}|${DOMAIN}`));
}

export async function addressFromMnemonic(mnemonic: string, index = 0): Promise<string> {
  return bytesToHex(ed.getPublicKey(seedFromMnemonic(mnemonic, index)));
}

export async function signSighash(mnemonic: string, index: number, sighashHex: string): Promise<string> {
  const hex = sighashHex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) throw new Error("bad sighash");
  const sig = ed.sign(hexToBytes(hex), seedFromMnemonic(mnemonic, index));
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

export async function importMnemonic(phrase: string): Promise<string> {
  const words = phrase.trim().toLowerCase().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) throw new Error("Need 12 or 24 words");
  const list = await loadWordlist();
  for (const w of words) {
    if (!list.includes(w)) throw new Error(`Unknown word: ${w}`);
  }
  return words.join(" ");
}

export async function bip44Seed(
  seed64: Uint8Array,
  coinType: number,
  account: number,
  change: number,
  index: number,
): Promise<Uint8Array> {
  const hardened = (i: number) => 0x80000000 | i;

  const masterKey = await crypto.subtle.importKey(
    "raw",
    asBufferSource(seed64),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );

  let chainCode = new Uint8Array(
    await crypto.subtle.sign("HMAC", masterKey, asBufferSource(new Uint8Array([0, 0, 0, hardened(44) >>> 0]))),
  );
  // hardened path uses 4-byte BE; rebuild properly
  const pathStep = async (keyBytes: Uint8Array, indexVal: number): Promise<Uint8Array> => {
    const data = new Uint8Array(5);
    data[0] = 0;
    const v = indexVal >>> 0;
    data[1] = (v >>> 24) & 0xff;
    data[2] = (v >>> 16) & 0xff;
    data[3] = (v >>> 8) & 0xff;
    data[4] = v & 0xff;
    const k = await crypto.subtle.importKey(
      "raw",
      asBufferSource(keyBytes),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"],
    );
    return new Uint8Array(await crypto.subtle.sign("HMAC", k, asBufferSource(data)));
  };

  // BIP44-ish chain from 64-byte seed material (first 32 as key, rest as chain — simplified)
  let privateKey = chainCode.slice(0, 32);
  chainCode = chainCode.slice(32);

  let hmac = await pathStep(privateKey, hardened(coinType));
  privateKey = hmac.slice(0, 32);

  hmac = await pathStep(privateKey, hardened(account));
  privateKey = hmac.slice(0, 32);

  hmac = await pathStep(privateKey, change);
  privateKey = hmac.slice(0, 32);

  hmac = await pathStep(privateKey, index);
  return hmac.slice(0, 32);
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
  const rawPriv = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "Ed25519" },
    true,
    ["sign"],
  );
  const pubJwk = { kty: "OKP", crv: "Ed25519", x: jwk.x };
  const pub = await crypto.subtle.importKey(
    "jwk",
    pubJwk,
    { name: "Ed25519" },
    true,
    ["verify"],
  );
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pub));
  return {
    jwk,
    address: bytesToHex(pubRaw),
    _priv: rawPriv,
  };
}

function ed25519Pkcs8(seed32: Uint8Array): Uint8Array {
  const p = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
  const out = new Uint8Array(p.length + 32);
  out.set(p, 0);
  out.set(seed32, p.length);
  return out;
}
