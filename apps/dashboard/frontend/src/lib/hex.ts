/**
 * Minimal byte/hex helpers.
 *
 * These replace `@noble/hashes/utils.js`, which the dashboard only used for
 * hex <-> bytes conversion. Key handling lives in the Rust core behind
 * `@kovanica/sdk-wasm` (see `lib/kvnc.ts`); nothing here is cryptographic.
 *
 * TypeScript 5.7 narrowed `Uint8Array` to `Uint8Array<ArrayBufferLike>`, which
 * WebCrypto's `BufferSource` rejects. Everything crossing into `crypto.subtle`
 * or wasm is produced in a plain `ArrayBuffer`-backed array.
 */

const HEX = '0123456789abcdef';

/** Lowercase hex for a byte array. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 0x0f];
  return out;
}

/** Bytes from a hex string. Accepts upper or lower case; throws on anything else. */
export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const t = hex.trim();
  if (t.length % 2 !== 0) throw new Error('hex string must have an even length');
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(t.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('hex string contains a non-hex character');
    out[i] = byte;
  }
  return out;
}

/** UTF-8 encode into a plain `ArrayBuffer`-backed array. */
export function utf8ToBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
}

/** Concatenate byte arrays into one plain `ArrayBuffer`-backed array. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}