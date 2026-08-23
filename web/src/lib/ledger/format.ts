import { ATOM } from "./types";

export function fmtKvnc(atoms: number): string {
  const v = atoms / ATOM;
  const s = v.toFixed(8).replace(/\.?0+$/, "");
  return `${s || "0"} KVNC`;
}

export function parseKvnc(raw: string): number | null {
  const n = Number(String(raw).trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * ATOM);
}
