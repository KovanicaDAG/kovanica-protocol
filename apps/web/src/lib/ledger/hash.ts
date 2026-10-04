import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/** 32-byte SHA-256 as 64 lowercase hex. First half is never a copy of the second. */
export function hashHex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

export function shortId(id: string, n = 8): string {
  return (id || "").slice(0, n);
}

/** Old preview addresses repeated the first 32 hex as padding. */
export function isRepeatedHex(hex: string): boolean {
  const h = hex.trim().toLowerCase();
  return h.length === 64 && h.slice(0, 32) === h.slice(32);
}
