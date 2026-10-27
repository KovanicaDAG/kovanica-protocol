import { ATOM, DECIMALS } from "./types";

export function fmtKvnc(atoms: number): string {
  const v = atoms / ATOM;
  const s = v.toFixed(DECIMALS).replace(/\.?0+$/, "");
  return `${s || "0"} KUNA`;
}

export function parseKvnc(raw: string): number | null {
  const n = Number(String(raw).trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * ATOM);
}
