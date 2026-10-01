const ATOM = 100_000_000;

export function formatKVNC(atoms: string | number): string {
  const n = typeof atoms === 'string' ? BigInt(atoms) : BigInt(atoms);
  const whole = n / BigInt(ATOM);
  const frac = n % BigInt(ATOM);
  return `${whole}.${frac.toString().padStart(8, '0')}`;
}

export function parseKVNC(kvnc: string): bigint {
  const parts = kvnc.split('.');
  const whole = BigInt(parts[0] || '0');
  const frac = parts[1] ? BigInt(parts[1].padEnd(8, '0').slice(0, 8)) : BigInt(0);
  return whole * BigInt(ATOM) + frac;
}

export function shortenHex(hex: string, chars: number = 8): string {
  if (hex.length <= chars * 2 + 2) return hex;
  return `${hex.slice(0, chars + 2)}...${hex.slice(-chars)}`;
}

export function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}