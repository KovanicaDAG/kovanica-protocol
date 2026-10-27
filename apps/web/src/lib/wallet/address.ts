import { blake3 } from "@noble/hashes/blake3.js";

/**
 * Human address: kvnc + 57 base32 characters (bech32 alphabet) + dag (PRO-21, 64 characters).
 * Checksum: First 29 bits of BLAKE3(publicKey).
 */

const PREFIX = "kvnc";
const SUFFIX = "dag";
/** bech32 data alphabet (BIP-173), lower case only. */
const ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const CHECKSUM_BITS = 29;
const BODY_CHARS = 57;
export const ADDRESS_LENGTH = PREFIX.length + BODY_CHARS + SUFFIX.length; // 64

// Base58 fallback for decoding legacy addresses
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const LEGACY_B58_ADDR_LEN = 33;

function b58decode(s: string): Uint8Array | null {
  if (!s) return null;
  const acc = new Uint8Array(40);
  for (const ch of s) {
    const val = B58.indexOf(ch);
    if (val < 0) return null;
    let carry = val;
    for (let i = acc.length - 1; i >= 0; i--) {
      const v = acc[i] * 58 + carry;
      acc[i] = v & 0xff;
      carry = v >> 8;
    }
    if (carry !== 0) return null;
  }
  return acc.slice(acc.length - LEGACY_B58_ADDR_LEN);
}

function checksum29(publicKey: Uint8Array): bigint {
  const d = blake3(publicKey);
  const word = (BigInt(d[0]) << 24n) | (BigInt(d[1]) << 16n) | (BigInt(d[2]) << 8n) | BigInt(d[3]);
  return word >> BigInt(32 - CHECKSUM_BITS);
}

function keyToBigInt(publicKey: Uint8Array): bigint {
  const hex = Array.from(publicKey, (b) => b.toString(16).padStart(2, "0")).join("");
  return BigInt(`0x${hex}`);
}

/**
 * Canonical address (PRO-21): `kvnc` + 57 base32 characters (bech32 alphabet) + `dag`,
 * 64 characters. 32-byte public key followed by first 29 bits of BLAKE3 over it.
 */
export function encodeAddress(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error("address payload must be 32 bytes");
  }
  let n = (keyToBigInt(publicKey) << BigInt(CHECKSUM_BITS)) | checksum29(publicKey);
  const chars: string[] = new Array(BODY_CHARS);
  for (let i = BODY_CHARS - 1; i >= 0; i -= 1) {
    chars[i] = ALPHABET[Number(n & 31n)];
    n >>= 5n;
  }
  return `${PREFIX}${chars.join("")}${SUFFIX}`;
}

/** Decode the canonical 64-character address and verify its checksum. */
export function decodeAddress(value: string): Uint8Array {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith(PREFIX) || !trimmed.endsWith(SUFFIX)) {
    throw new Error("address must start with kvnc and end with dag");
  }
  if (trimmed.length !== ADDRESS_LENGTH) {
    throw new Error(`address must be ${ADDRESS_LENGTH} characters`);
  }
  let n = 0n;
  for (const c of trimmed.slice(PREFIX.length, -SUFFIX.length)) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) {
      throw new Error("address contains a character outside the base32 alphabet");
    }
    n = (n << 5n) | BigInt(v);
  }
  const check = n & ((1n << BigInt(CHECKSUM_BITS)) - 1n);
  const key = n >> BigInt(CHECKSUM_BITS);
  const hex = key.toString(16).padStart(64, "0");
  const payload = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    payload[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  if (check !== checksum29(payload)) {
    throw new Error("address checksum mismatch");
  }
  return payload;
}

/**
 * Render 32-byte pubkey (64-hex) or canonical string as canonical kvnc…dag (64 chars).
 */
export function hexToKvnc(hexOrAddr: string): string {
  const trimmed = hexOrAddr.trim();
  if (
    trimmed.length === ADDRESS_LENGTH &&
    trimmed.toLowerCase().startsWith(PREFIX) &&
    trimmed.toLowerCase().endsWith(SUFFIX)
  ) {
    return trimmed.toLowerCase();
  }
  const parsed = parseAddr(trimmed);
  if (!parsed) return trimmed;
  // parsed is 64-hex pubkey
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(parsed.slice(i * 2, i * 2 + 2), 16);
  }
  return encodeAddress(bytes);
}

/**
 * Returns 64-hex public key (or null).
 * Accepts:
 * 1. Canonical 64-char kvnc...dag (bech32)
 * 2. 64-hex public key
 * 3. 66-hex versioned (00...)
 * 4. Legacy kvnc...dag (base58 fallback)
 * 5. Legacy 72-hex kvnc<hex>dag
 */
export function parseAddr(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;

  // 1. Bare 64 hex
  if (/^[0-9a-f]{64}$/i.test(t)) {
    return t.toLowerCase();
  }

  // 2. Versioned 66 hex (00 + 64 hex)
  if (/^00[0-9a-f]{64}$/i.test(t)) {
    return t.slice(2).toLowerCase();
  }

  // 3. Canonical 64-character kvnc...dag
  if (
    t.length === ADDRESS_LENGTH &&
    t.toLowerCase().startsWith(PREFIX) &&
    t.toLowerCase().endsWith(SUFFIX)
  ) {
    try {
      const bytes = decodeAddress(t);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      // not valid canonical
    }
  }

  // 4. Legacy Base58 kvnc...dag fallback
  const m = t.match(/^kvnc([1-9A-HJ-NP-Za-km-z]+)dag$/);
  if (m) {
    const payload = t.slice(PREFIX.length, -SUFFIX.length);
    const bytes = b58decode(payload);
    if (bytes && bytes.length === LEGACY_B58_ADDR_LEN) {
      return Array.from(bytes.slice(1), (b) => b.toString(16).padStart(2, "0")).join("");
    }
  }

  // 5. Legacy 72-hex kvnc<hex>dag
  if (t.toLowerCase().startsWith(PREFIX) && t.toLowerCase().endsWith(SUFFIX)) {
    const body = t.slice(PREFIX.length, -SUFFIX.length);
    if (/^[0-9a-f]{72}$/i.test(body)) {
      return body.slice(0, 64).toLowerCase();
    }
  }

  return null;
}

export function isAddr(raw: string): boolean {
  return parseAddr(raw) !== null;
}

/** Converts any valid address format to the canonical 64-char kvnc...dag form. */
export function toCanonicalAddress(raw: string): string | null {
  const parsedHex = parseAddr(raw);
  if (!parsedHex) return null;
  return hexToKvnc(parsedHex);
}
