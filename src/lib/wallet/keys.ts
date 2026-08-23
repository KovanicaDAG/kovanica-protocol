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
  const words = phrase.trim().toLowerCase().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) throw new Error("Need 12 or 24 words");
  const list = await loadWordlist();
  for (const w of words) {
    if (!list.includes(w)) throw new Error(`Unknown word: ${w}`);
  }
  return words.join(" ");
}
