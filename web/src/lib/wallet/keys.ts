import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { loadWordlist } from "./bip39";

ed.hashes.sha512 = sha512;

const DOMAIN = "kovanica-wallet-v2";

export { loadWordlist } from "./bip39";

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

/** PBKDF2-derived 64-byte seed from a BIP39 mnemonic (matches Rust explorer.html). */
export async function mnemonicToSeed(mnemonic: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(mnemonic.normalize("NFKD")), "PBKDF2", false, ["deriveBits"],
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

/** 32-byte ed25519 seed — same domain the address is derived from. */
export function seedFromMnemonic(mnemonic: string, index = 0): Uint8Array {
  return sha256(utf8ToBytes(`${normalizeMnemonic(mnemonic)}|${index}|${DOMAIN}`));
}

/** Address is the ed25519 public key (64 hex). Matches live `Address` bytes. */
export async function addressFromMnemonic(mnemonic: string, index = 0): Promise<string> {
  return bytesToHex(ed.getPublicKey(seedFromMnemonic(mnemonic, index)));
}

/** Sign prepare's sighash bytes. Returns 128 hex (64-byte ed25519 sig). */
export async function signSighash(mnemonic: string, index: number, sighashHex: string): Promise<string> {
  const hex = sighashHex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) throw new Error("bad sighash");
  const sig = ed.sign(hexToBytes(hex), seedFromMnemonic(mnemonic, index));
  return bytesToHex(sig);
}

export async function importMnemonic(phrase: string): Promise<string> {
  const words = phrase.trim().toLowerCase().split(/\\s+/);
  if (words.length !== 12 && words.length !== 24) throw new Error("Need 12 or 24 words");
  const list = await loadWordlist();
  for (const w of words) {
    if (!list.includes(w)) throw new Error(`Unknown word: ${w}`);
  }
  return words.join(" ");
}

/** BIP44 seed derivation: HMAC-SHA512 chain from the 32-byte ed25519 seed. */
export async function bip44Seed(
  seed64: Uint8Array,
  coinType: number,
  account: number,
  change: number,
  index: number,
): Promise<Uint8Array> {
  const hardened = (i: number) => 0x80000000 | i;

  const masterKey = await crypto.subtle.importKey(
    "raw", seed64, { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );

  let chainCode = new Uint8Array(
    await crypto.subtle.sign("HMAC", masterKey, new Uint8Array([0, 0, 0, hardened(44)])),
  );
  let privateKey = chainCode.slice(0, 32);
  chainCode = chainCode.slice(32);

  const coinTypeKey = await crypto.subtle.importKey(
    "raw", privateKey, { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  let hmac = new Uint8Array(
    await crypto.subtle.sign("HMAC", coinTypeKey, new Uint8Array([0, 0, 0, hardened(coinType)])),
  );
  privateKey = hmac.slice(0, 32);
  chainCode = hmac.slice(32);

  const accountKey = await crypto.subtle.importKey(
    "raw", privateKey, { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  hmac = new Uint8Array(
    await crypto.subtle.sign("HMAC", accountKey, new Uint8Array([0, 0, 0, hardened(account)])),
  );
  privateKey = hmac.slice(0, 32);
  chainCode = hmac.slice(32);

  const changeKey = await crypto.subtle.importKey(
    "raw", privateKey, { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  hmac = new Uint8Array(
    await crypto.subtle.sign("HMAC", changeKey, new Uint8Array([0, 0, 0, change])),
  );
  privateKey = hmac.slice(0, 32);
  chainCode = hmac.slice(32);

  const indexKey = await crypto.subtle.importKey(
    "raw", privateKey, { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  hmac = new Uint8Array(
    await crypto.subtle.sign("HMAC", indexKey, new Uint8Array([0, 0, 0, index])),
  );

  return hmac.slice(0, 32);
}

/** Derive Ed25519 JWK + address from a 32-byte seed. */
export async function keysFromSeed32(seed32: Uint8Array) {
  const pkcs8 = ed25519Pkcs8(seed32);
  const priv = await crypto.subtle.importKey(
    "pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", priv);
  const rawPriv = await crypto.subtle.importKey(
    "jwk", jwk, { name: "Ed25519" }, true, ["sign"],
  );
  const pubJwk = { kty: "OKP", crv: "Ed25519", x: jwk.x };
  const pub = await crypto.subtle.importKey(
    "jwk", pubJwk, { name: "Ed25519" }, true, ["verify"],
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
