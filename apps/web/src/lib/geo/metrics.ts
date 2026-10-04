export const CHLORO_STOPS = [
  "#1c2e36",
  "#1a4f54",
  "#1c7c72",
  "#2fbaa4",
  "#7ee8d0",
] as const;

export const LAND_EMPTY = "#1c232c";
export const LAND_HOVER = "#24303a";
export const OCEAN = "#08090b";
export const STROKE = "#08090b";
export const STROKE_ACTIVE = "#d6dbe3";

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const integer = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export function formatPulses(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value >= 10_000 ? compact.format(value) : integer.format(value);
}

export function formatShare(part: number, total: number): string {
  if (!total) return "0%";
  const pct = (part / total) * 100;
  return `${pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%`;
}
