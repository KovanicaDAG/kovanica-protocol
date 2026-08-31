/**
 * Human address: kvnc + base58(versioned 33-byte payload) + dag.
 * Legacy 64-hex is treated as Version 0x00 P2PK (32-byte pubkey) and padded.
 */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ADDR_LEN = 33;

function b58encode(data: Uint8Array): string {
  const zeros = data.findIndex((b) => b !== 0);
  const z = zeros === -1 ? data.length : zeros;
  const buf = Array.from(data);
  const digits: number[] = [];
  for (;;) {
    if (buf.every((b) => b === 0)) break;
    let rem = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = rem * 256 + buf[i];
      buf[i] = Math.floor(v / 58);
      rem = v % 58;
    }
    digits.push(rem);
  }
  digits.reverse();
  return "1".repeat(z) + digits.map((d) => B58[d]).join("");
}

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
  return acc.slice(acc.length - ADDR_LEN);
}

/** Render 32-byte pubkey (legacy P2PK) or 33-byte versioned address as kvnc…dag. */
export function hexToKvnc(hex: string): string {
  const h = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h) && !/^[0-9a-f]{66}$/.test(h)) return hex;
  let bytes: Uint8Array;
  if (h.length === 64) {
    // Legacy P2PK pubkey → version 0x00
    bytes = new Uint8Array(33);
    bytes[0] = 0x00;
    for (let i = 0; i < 32; i++) bytes[i + 1] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  } else {
    bytes = new Uint8Array(33);
    for (let i = 0; i < 33; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return `kvnc${b58encode(bytes)}dag`;
}

/** Returns 66-hex versioned address, or null. Accepts 64/66 hex or kvnc…dag. */
export function parseAddr(raw: string): string | null {
  const t = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(t)) {
    return "00" + t.toLowerCase();
  }
  if (/^[0-9a-f]{66}$/i.test(t)) {
    const v = parseInt(t.slice(0, 2), 16);
    if (v > 0x01) return null;
    return t.toLowerCase();
  }
  const m = t.match(/^kvnc([1-9A-HJ-NP-Za-km-z]+)dag$/i);
  if (!m) return null;
  const payload = t.slice(4, t.length - 3);
  const bytes = b58decode(payload);
  if (!bytes || bytes.length !== ADDR_LEN) return null;
  const version = bytes[0];
  if (version > 0x01) return null;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isAddr(raw: string): boolean {
  return parseAddr(raw) !== null;
}

/** True if the parsed address is a Version 0x01 P2SH address. */
export function isP2shAddr(raw: string): boolean {
  const parsed = parseAddr(raw);
  if (!parsed) return false;
  return parsed.length === 66 && parsed.startsWith("01");
}
