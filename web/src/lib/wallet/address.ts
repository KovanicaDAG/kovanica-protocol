/** Human address: kvnc + base58(32-byte pubkey) + dag. Ledger still uses 64 hex. */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

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
  return acc.slice(acc.length - 32);
}

export function hexToKvnc(hex: string): string {
  const h = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) return hex;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return `kvnc${b58encode(bytes)}dag`;
}

/** Returns 64-hex or null. Accepts hex or kvnc…dag. */
export function parseAddr(raw: string): string | null {
  const t = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(t)) return t.toLowerCase();
  const m = t.match(/^kvnc([1-9A-HJ-NP-Za-km-z]+)dag$/i);
  if (!m) return null;
  const payload = t.slice(4, t.length - 3);
  const bytes = b58decode(payload);
  if (!bytes || bytes.length !== 32) return null;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isAddr(raw: string): boolean {
  return parseAddr(raw) !== null;
}