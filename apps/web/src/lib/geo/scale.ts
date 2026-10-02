import { quantile, extent } from "d3-array";
import { scaleThreshold } from "d3-scale";
import { CHLORO_STOPS, LAND_EMPTY } from "./metrics";

export type ColorScale = {
  color: (value: number | undefined) => string;
  breaks: number[];
  stops: readonly string[];
};

export function makeColorScale(values: number[]): ColorScale {
  const positive = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (positive.length === 0) {
    return { color: () => LAND_EMPTY, breaks: [], stops: CHLORO_STOPS };
  }

  const classes = CHLORO_STOPS.length;
  const breaks: number[] = [];
  for (let i = 1; i < classes; i += 1) {
    const q = quantile(positive, i / classes);
    if (q !== undefined) breaks.push(q);
  }

  const unique = [...new Set(breaks.map((b) => Number(b.toPrecision(6))))];
  if (unique.length === 0) {
    const [min, max] = extent(positive) as [number, number];
    unique.push(min === max ? min : (min + max) / 2);
  }

  const scale = scaleThreshold<number, string>().domain(unique).range([...CHLORO_STOPS]);

  return {
    color: (value) => {
      if (value === undefined || !Number.isFinite(value) || value <= 0) return LAND_EMPTY;
      return scale(value);
    },
    breaks: unique,
    stops: CHLORO_STOPS,
  };
}
